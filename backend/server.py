from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT config
JWT_SECRET = os.environ.get('JWT_SECRET', 'billcal-dev-secret-change-in-prod-32chars')
JWT_ALG = 'HS256'
JWT_EXP_DAYS = 30

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer()


# ---------- Models ----------
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class BillBase(BaseModel):
    title: str
    amount: float
    due_date: str  # ISO date string YYYY-MM-DD
    category: str = "Other"
    recurrence: str = "none"  # none | weekly | monthly | yearly
    notes: Optional[str] = ""


class BillCreate(BillBase):
    pass


class BillUpdate(BaseModel):
    title: Optional[str] = None
    amount: Optional[float] = None
    due_date: Optional[str] = None
    category: Optional[str] = None
    recurrence: Optional[str] = None
    notes: Optional[str] = None
    paid: Optional[bool] = None


class Bill(BillBase):
    id: str
    user_id: str
    paid: bool = False
    created_at: str


class BankAccount(BaseModel):
    id: str
    name: str
    type: str
    masked_number: str
    balance: float
    institution: str


class BankTransaction(BaseModel):
    id: str
    account_id: str
    date: str
    description: str
    amount: float
    category: str


# ---------- Auth helpers ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXP_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ---------- Auth Routes ----------
@api_router.post("/auth/register", response_model=AuthResponse)
async def register(payload: UserRegister):
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "full_name": payload.full_name or email.split("@")[0],
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    # seed mock bank accounts/transactions for the user on first signup
    await seed_mock_bank_for_user(user_id)
    token = create_token(user_id)
    return AuthResponse(
        token=token,
        user=UserPublic(id=user_id, email=email, full_name=user_doc["full_name"]),
    )


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(payload: UserLogin):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_token(user["id"])
    return AuthResponse(
        token=token,
        user=UserPublic(id=user["id"], email=user["email"], full_name=user.get("full_name")),
    )


@api_router.get("/auth/me", response_model=UserPublic)
async def me(current_user: dict = Depends(get_current_user)):
    return UserPublic(id=current_user["id"], email=current_user["email"], full_name=current_user.get("full_name"))


# ---------- Bills Routes ----------
@api_router.get("/bills", response_model=List[Bill])
async def list_bills(current_user: dict = Depends(get_current_user)):
    docs = await db.bills.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(2000)
    return [Bill(**d) for d in docs]


@api_router.post("/bills", response_model=Bill)
async def create_bill(payload: BillCreate, current_user: dict = Depends(get_current_user)):
    bill_id = str(uuid.uuid4())
    doc = {
        "id": bill_id,
        "user_id": current_user["id"],
        "title": payload.title,
        "amount": float(payload.amount),
        "due_date": payload.due_date,
        "category": payload.category,
        "recurrence": payload.recurrence,
        "notes": payload.notes or "",
        "paid": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.bills.insert_one(doc)
    return Bill(**{k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/bills/{bill_id}", response_model=Bill)
async def get_bill(bill_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.bills.find_one({"id": bill_id, "user_id": current_user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    return Bill(**doc)


@api_router.put("/bills/{bill_id}", response_model=Bill)
async def update_bill(bill_id: str, payload: BillUpdate, current_user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    result = await db.bills.find_one_and_update(
        {"id": bill_id, "user_id": current_user["id"]},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Bill not found")
    return Bill(**result)


@api_router.delete("/bills/{bill_id}")
async def delete_bill(bill_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.bills.delete_one({"id": bill_id, "user_id": current_user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bill not found")
    return {"ok": True}


@api_router.post("/bills/{bill_id}/toggle_paid", response_model=Bill)
async def toggle_paid(bill_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.bills.find_one({"id": bill_id, "user_id": current_user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    new_paid = not doc.get("paid", False)
    await db.bills.update_one({"id": bill_id, "user_id": current_user["id"]}, {"$set": {"paid": new_paid}})
    doc["paid"] = new_paid
    return Bill(**doc)


@api_router.post("/bills/seed_examples", response_model=List[Bill])
async def seed_example_bills(current_user: dict = Depends(get_current_user)):
    """Create a starter set of example bills for the current user, relative to today."""
    today = datetime.now(timezone.utc).date()
    def offset(days: int) -> str:
        return (today + timedelta(days=days)).isoformat()
    examples = [
        {"title": "Electricity Bill",   "amount":   84.50, "due_date": offset(3),   "category": "Utilities",     "recurrence": "monthly"},
        {"title": "Internet",           "amount":   59.00, "due_date": offset(3),   "category": "Internet",      "recurrence": "monthly"},
        {"title": "Phone Plan",         "amount":   45.00, "due_date": offset(-7),  "category": "Phone",         "recurrence": "monthly"},
        {"title": "Netflix",            "amount":   15.49, "due_date": offset(10),  "category": "Subscriptions", "recurrence": "monthly"},
        {"title": "Car Insurance",      "amount":  120.00, "due_date": offset(10),  "category": "Insurance",     "recurrence": "monthly"},
        {"title": "Apartment Rent",     "amount": 1450.00, "due_date": offset(18),  "category": "Rent",          "recurrence": "monthly"},
        {"title": "Visa Credit Card",   "amount":  342.75, "due_date": offset(25),  "category": "Credit Card",   "recurrence": "monthly"},
    ]
    created: List[Bill] = []
    for e in examples:
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "title": e["title"],
            "amount": float(e["amount"]),
            "due_date": e["due_date"],
            "category": e["category"],
            "recurrence": e["recurrence"],
            "notes": "",
            "paid": e["title"] == "Phone Plan",  # mark Phone Plan paid as a demo
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.bills.insert_one(doc)
        created.append(Bill(**{k: v for k, v in doc.items() if k != "_id"}))
    # Also seed mock bank if the user has none yet
    has_accounts = await db.bank_accounts.count_documents({"user_id": current_user["id"]})
    if has_accounts == 0:
        await seed_mock_bank_for_user(current_user["id"])
    return created


# ---------- Mock Bank Sync ----------
MOCK_BANKS = [
    {"name": "Everyday Checking", "type": "checking", "masked_number": "****4521", "balance": 3284.55, "institution": "Greenleaf Bank"},
    {"name": "Savings", "type": "savings", "masked_number": "****8810", "balance": 12450.10, "institution": "Greenleaf Bank"},
    {"name": "Visa Platinum", "type": "credit", "masked_number": "****2341", "balance": -842.33, "institution": "Vertex Card"},
]

MOCK_TX_TEMPLATES = [
    ("Electricity - Powerlink", -84.50, "Utilities"),
    ("Spotify Premium", -10.99, "Subscriptions"),
    ("Whole Foods Market", -56.32, "Groceries"),
    ("Salary - Acme Corp", 2400.00, "Income"),
    ("Internet - Fastnet", -59.00, "Utilities"),
    ("Netflix", -15.49, "Subscriptions"),
    ("Coffee - BluePeak", -4.75, "Food"),
    ("Rent - Maple Properties", -1450.00, "Rent"),
]


async def seed_mock_bank_for_user(user_id: str):
    accounts = []
    for b in MOCK_BANKS:
        acc = {"id": str(uuid.uuid4()), "user_id": user_id, **b}
        accounts.append(acc)
    await db.bank_accounts.insert_many(accounts)
    txs = []
    today = datetime.now(timezone.utc)
    for i, tpl in enumerate(MOCK_TX_TEMPLATES):
        desc, amt, cat = tpl
        d = (today - timedelta(days=i * 2)).strftime("%Y-%m-%d")
        txs.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "account_id": accounts[i % len(accounts)]["id"],
            "date": d,
            "description": desc,
            "amount": amt,
            "category": cat,
        })
    await db.bank_transactions.insert_many(txs)


@api_router.get("/bank/accounts", response_model=List[BankAccount])
async def list_accounts(current_user: dict = Depends(get_current_user)):
    docs = await db.bank_accounts.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).to_list(100)
    return [BankAccount(**d) for d in docs]


@api_router.get("/bank/transactions", response_model=List[BankTransaction])
async def list_transactions(current_user: dict = Depends(get_current_user)):
    docs = await db.bank_transactions.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).sort("date", -1).to_list(200)
    return [BankTransaction(**d) for d in docs]


@api_router.post("/bank/sync")
async def trigger_sync(current_user: dict = Depends(get_current_user)):
    # Mocked: just return a fake last_synced timestamp
    last_synced = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"last_synced": last_synced}})
    count = await db.bank_transactions.count_documents({"user_id": current_user["id"]})
    return {"ok": True, "last_synced": last_synced, "transactions_synced": count}


# ---------- Health ----------
@api_router.get("/")
async def root():
    return {"message": "BillCal API", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
