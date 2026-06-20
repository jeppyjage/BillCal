from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Query, BackgroundTasks, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import bcrypt
import jwt
import httpx
from urllib.parse import urlencode
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
from datetime import datetime, timedelta, timezone, date


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

# ---------- OAuth / External Calendar Config ----------
BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "").rstrip("/")
# Public success page redirect (deep link back to the app on success)
OAUTH_SUCCESS_REDIRECT = os.environ.get("OAUTH_SUCCESS_REDIRECT", "")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
]

MS_CLIENT_ID = os.environ.get("MS_CLIENT_ID", "")
MS_CLIENT_SECRET = os.environ.get("MS_CLIENT_SECRET", "")
MS_TENANT_ID = os.environ.get("MS_TENANT_ID", "common")
MS_AUTH_ENDPOINT = f"https://login.microsoftonline.com/{MS_TENANT_ID}/oauth2/v2.0/authorize"
MS_TOKEN_ENDPOINT = f"https://login.microsoftonline.com/{MS_TENANT_ID}/oauth2/v2.0/token"
MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "https://graph.microsoft.com/Calendars.ReadWrite",
]

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
    google_event_id: Optional[str] = None
    microsoft_event_id: Optional[str] = None


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
async def create_bill(payload: BillCreate, background: BackgroundTasks, current_user: dict = Depends(get_current_user)):
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
    background.add_task(_sync_bill_create, current_user["id"], bill_id)
    return Bill(**{k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/bills/{bill_id}", response_model=Bill)
async def get_bill(bill_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.bills.find_one({"id": bill_id, "user_id": current_user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    return Bill(**doc)


@api_router.put("/bills/{bill_id}", response_model=Bill)
async def update_bill(bill_id: str, payload: BillUpdate, background: BackgroundTasks, current_user: dict = Depends(get_current_user)):
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
    background.add_task(_sync_bill_update, current_user["id"], bill_id)
    return Bill(**result)


@api_router.delete("/bills/{bill_id}")
async def delete_bill(bill_id: str, background: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    doc = await db.bills.find_one({"id": bill_id, "user_id": current_user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    await db.bills.delete_one({"id": bill_id, "user_id": current_user["id"]})
    background.add_task(_sync_bill_delete, current_user["id"], doc)
    return {"ok": True}


@api_router.post("/bills/{bill_id}/toggle_paid", response_model=Bill)
async def toggle_paid(bill_id: str, background: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    doc = await db.bills.find_one({"id": bill_id, "user_id": current_user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    new_paid = not doc.get("paid", False)
    await db.bills.update_one({"id": bill_id, "user_id": current_user["id"]}, {"$set": {"paid": new_paid}})
    doc["paid"] = new_paid
    background.add_task(_sync_bill_update, current_user["id"], bill_id)
    return Bill(**doc)


@api_router.post("/bills/seed_examples", response_model=List[Bill])
async def seed_example_bills(current_user: dict = Depends(get_current_user)):
    """Create a starter set of example bills for the current user, relative to today."""
    today = datetime.now(timezone.utc).date()
    def offset(days: int) -> str:
        return (today + timedelta(days=days)).isoformat()
    examples = [
        {"title": "Electricity Bill",   "amount":   84.50, "due_date": offset(3),   "category": "Essentials",     "recurrence": "monthly"},
        {"title": "Internet",           "amount":   59.00, "due_date": offset(3),   "category": "Essentials",      "recurrence": "monthly"},
        {"title": "Phone Plan",         "amount":   45.00, "due_date": offset(-7),  "category": "Phone",         "recurrence": "monthly"},
        {"title": "Netflix",            "amount":   15.49, "due_date": offset(10),  "category": "Subscriptions", "recurrence": "monthly"},
        {"title": "Car Insurance",      "amount":  120.00, "due_date": offset(10),  "category": "Insurance",     "recurrence": "monthly"},
        {"title": "Apartment Rent",     "amount": 1450.00, "due_date": offset(18),  "category": "Essentials", "recurrence": "monthly"},
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


@api_router.post("/bills/auto_detect", response_model=List[Bill])
async def auto_detect_recurring(current_user: dict = Depends(get_current_user)):
    """Scan bank transactions for recurring patterns and create/update matching Bill records."""
    txs = await db.bank_transactions.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).to_list(500)
    # Group transactions by (category, rounded amount)
    groups: dict = {}
    for t in txs:
        if t["amount"] >= 0:  # expenses only
            continue
        amt = round(abs(t["amount"]))
        key = (t["category"], amt)
        groups.setdefault(key, []).append(t)

    result: List[Bill] = []
    for (category, amt), items in groups.items():
        if len(items) < 2:
            continue
        # Sort by date
        items.sort(key=lambda x: x["date"])
        # Check if gaps look monthly (25-35 day spacing)
        gaps = []
        for i in range(1, len(items)):
            d1 = datetime.fromisoformat(items[i - 1]["date"])
            d2 = datetime.fromisoformat(items[i]["date"])
            gaps.append((d2 - d1).days)
        if not gaps or not all(20 <= g <= 40 for g in gaps):
            continue
        # Predict next due date: last tx + 30 days
        last_date = datetime.fromisoformat(items[-1]["date"])
        next_due = (last_date + timedelta(days=30)).date().isoformat()
        title = items[-1]["description"]
        # Use the actual transaction amount (not rounded)
        real_amt = round(abs(items[-1]["amount"]), 2)
        # Find existing bill matching category + amount (within $1)
        existing = await db.bills.find_one({
            "user_id": current_user["id"],
            "category": category,
        }, {"_id": 0})
        if existing and abs(existing["amount"] - real_amt) < 2:
            await db.bills.update_one(
                {"id": existing["id"]},
                {"$set": {"title": title, "amount": real_amt, "due_date": next_due, "recurrence": "monthly"}},
            )
            existing.update({"title": title, "amount": real_amt, "due_date": next_due, "recurrence": "monthly"})
            result.append(Bill(**existing))
        else:
            new_id = str(uuid.uuid4())
            doc = {
                "id": new_id,
                "user_id": current_user["id"],
                "title": title,
                "amount": real_amt,
                "due_date": next_due,
                "category": category,
                "recurrence": "monthly",
                "notes": "Auto-detected from bank transactions",
                "paid": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.bills.insert_one(doc)
            result.append(Bill(**{k: v for k, v in doc.items() if k != "_id"}))
    return result


# ---------- External Calendar Sync (Google + Microsoft Outlook) ----------
# Token storage in `calendar_tokens` collection keyed by (user_id, provider).
# Each doc: {user_id, provider, access_token, refresh_token, expires_at, scope, default_calendar_id}

OAUTH_STATE_SECRET = JWT_SECRET  # reuse JWT secret for OAuth state signing
OAUTH_STATE_EXP_MINUTES = 15


def _sign_oauth_state(user_id: str, provider: str) -> str:
    payload = {
        "uid": user_id,
        "p": provider,
        "n": uuid.uuid4().hex,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=OAUTH_STATE_EXP_MINUTES),
    }
    return jwt.encode(payload, OAUTH_STATE_SECRET, algorithm=JWT_ALG)


def _verify_oauth_state(state: str, provider: str) -> Optional[str]:
    try:
        data = jwt.decode(state, OAUTH_STATE_SECRET, algorithms=[JWT_ALG])
        if data.get("p") != provider:
            return None
        return data.get("uid")
    except Exception:
        return None


async def _get_user_from_query_token(token: str) -> dict:
    """Resolve a user from a query-string JWT (used when starting OAuth from browser)."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _resolve_backend_base_url(request) -> str:
    if BACKEND_BASE_URL:
        return BACKEND_BASE_URL
    # Build from request (works behind the ingress)
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    return f"{scheme}://{host}"


def _google_redirect_uri(request) -> str:
    return f"{_resolve_backend_base_url(request)}/api/oauth/google/callback"


def _ms_redirect_uri(request) -> str:
    return f"{_resolve_backend_base_url(request)}/api/oauth/microsoft/callback"


async def _upsert_calendar_token(user_id: str, provider: str, data: dict):
    await db.calendar_tokens.update_one(
        {"user_id": user_id, "provider": provider},
        {"$set": {**data, "user_id": user_id, "provider": provider}},
        upsert=True,
    )


async def _get_calendar_token(user_id: str, provider: str) -> Optional[dict]:
    doc = await db.calendar_tokens.find_one({"user_id": user_id, "provider": provider}, {"_id": 0})
    return doc


def _success_html(provider: str, ok: bool, msg: str = "") -> HTMLResponse:
    title = "Connected!" if ok else "Connection failed"
    color = "#16a34a" if ok else "#dc2626"
    detail = msg or ("Your calendar is now linked. Return to the BillCal app to start syncing." if ok else "Please try again from the app.")
    html = f"""<!doctype html><html><head><meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>BillCal — {provider.capitalize()}</title>
    <style>body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;padding:24px}}
    .card{{background:#1e293b;border-radius:16px;padding:32px;max-width:380px;text-align:center;border:1px solid #334155}}
    .badge{{width:64px;height:64px;border-radius:32px;background:{color};display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:32px;color:#fff}}
    h1{{margin:0 0 8px;font-size:20px;font-weight:500}}p{{margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.5}}
    button{{background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer}}</style></head>
    <body><div class="card"><div class="badge">{'✓' if ok else '!'}</div><h1>{title}</h1><p>{detail}</p>
    <button onclick="window.close()">Close</button></div></body></html>"""
    return HTMLResponse(content=html)


# ---- Token refresh helpers ----
async def _refresh_google_token(token: dict) -> dict:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Google not configured")
    async with httpx.AsyncClient(timeout=20.0) as client_:
        resp = await client_.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": token["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Google token refresh failed: {resp.text}")
    data = resp.json()
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 3600)))).isoformat()
    update = {"access_token": data["access_token"], "expires_at": expires_at}
    if data.get("refresh_token"):
        update["refresh_token"] = data["refresh_token"]
    await _upsert_calendar_token(token["user_id"], "google", update)
    return {**token, **update}


async def _refresh_ms_token(token: dict) -> dict:
    if not MS_CLIENT_ID or not MS_CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Microsoft not configured")
    async with httpx.AsyncClient(timeout=20.0) as client_:
        resp = await client_.post(
            MS_TOKEN_ENDPOINT,
            data={
                "client_id": MS_CLIENT_ID,
                "client_secret": MS_CLIENT_SECRET,
                "refresh_token": token["refresh_token"],
                "grant_type": "refresh_token",
                "scope": " ".join(MS_SCOPES),
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Microsoft token refresh failed: {resp.text}")
    data = resp.json()
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 3600)))).isoformat()
    update = {"access_token": data["access_token"], "expires_at": expires_at}
    if data.get("refresh_token"):
        update["refresh_token"] = data["refresh_token"]
    await _upsert_calendar_token(token["user_id"], "microsoft", update)
    return {**token, **update}


async def _get_valid_access_token(user_id: str, provider: str) -> Optional[str]:
    token = await _get_calendar_token(user_id, provider)
    if not token:
        return None
    try:
        expires_at = datetime.fromisoformat(token["expires_at"])
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    if expires_at <= datetime.now(timezone.utc) + timedelta(seconds=60):
        if provider == "google":
            token = await _refresh_google_token(token)
        else:
            token = await _refresh_ms_token(token)
    return token.get("access_token")


# ---------- OAuth Start / Callback ----------
@api_router.get("/oauth/google/start")
async def google_oauth_start(request: Request, token: str = Query(...)):
    user = await _get_user_from_query_token(token)
    if not GOOGLE_CLIENT_ID:
        return _success_html("google", False, "Google OAuth is not configured on this server. Please set GOOGLE_CLIENT_ID + SECRET.")
    state = _sign_oauth_state(user["id"], "google")
    params = {
        "response_type": "code",
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": _google_redirect_uri(request),
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}")


@api_router.get("/oauth/google/callback")
async def google_oauth_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    if error:
        return _success_html("google", False, f"Google returned: {error}")
    if not code or not state:
        return _success_html("google", False, "Missing code or state.")
    user_id = _verify_oauth_state(state, "google")
    if not user_id:
        return _success_html("google", False, "Invalid or expired state.")
    async with httpx.AsyncClient(timeout=20.0) as client_:
        resp = await client_.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": _google_redirect_uri(request),
                "grant_type": "authorization_code",
            },
        )
    if resp.status_code != 200:
        return _success_html("google", False, f"Token exchange failed: {resp.text[:200]}")
    data = resp.json()
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        # User may have already granted before; check existing token
        existing = await _get_calendar_token(user_id, "google")
        if existing and existing.get("refresh_token"):
            refresh_token = existing["refresh_token"]
        else:
            return _success_html("google", False, "No refresh token returned. Revoke access in Google account and try again.")
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 3600)))).isoformat()
    await _upsert_calendar_token(user_id, "google", {
        "access_token": data["access_token"],
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "scope": data.get("scope"),
        "default_calendar_id": "primary",
        "connected_at": datetime.now(timezone.utc).isoformat(),
    })
    return _success_html("google", True)


@api_router.get("/oauth/microsoft/start")
async def microsoft_oauth_start(request: Request, token: str = Query(...)):
    user = await _get_user_from_query_token(token)
    if not MS_CLIENT_ID:
        return _success_html("microsoft", False, "Microsoft OAuth is not configured on this server. Please set MS_CLIENT_ID + SECRET.")
    state = _sign_oauth_state(user["id"], "microsoft")
    params = {
        "client_id": MS_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": _ms_redirect_uri(request),
        "response_mode": "query",
        "scope": " ".join(MS_SCOPES),
        "state": state,
        "prompt": "select_account",
    }
    return RedirectResponse(f"{MS_AUTH_ENDPOINT}?{urlencode(params)}")


@api_router.get("/oauth/microsoft/callback")
async def microsoft_oauth_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None, error_description: Optional[str] = None):
    if error:
        return _success_html("microsoft", False, f"Microsoft returned: {error_description or error}")
    if not code or not state:
        return _success_html("microsoft", False, "Missing code or state.")
    user_id = _verify_oauth_state(state, "microsoft")
    if not user_id:
        return _success_html("microsoft", False, "Invalid or expired state.")
    async with httpx.AsyncClient(timeout=20.0) as client_:
        resp = await client_.post(
            MS_TOKEN_ENDPOINT,
            data={
                "client_id": MS_CLIENT_ID,
                "client_secret": MS_CLIENT_SECRET,
                "code": code,
                "redirect_uri": _ms_redirect_uri(request),
                "grant_type": "authorization_code",
                "scope": " ".join(MS_SCOPES),
            },
        )
    if resp.status_code != 200:
        return _success_html("microsoft", False, f"Token exchange failed: {resp.text[:200]}")
    data = resp.json()
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        existing = await _get_calendar_token(user_id, "microsoft")
        if existing and existing.get("refresh_token"):
            refresh_token = existing["refresh_token"]
        else:
            return _success_html("microsoft", False, "No refresh token returned. Ensure 'offline_access' scope is granted.")
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 3600)))).isoformat()
    await _upsert_calendar_token(user_id, "microsoft", {
        "access_token": data["access_token"],
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "scope": data.get("scope"),
        "default_calendar_id": None,  # primary calendar
        "connected_at": datetime.now(timezone.utc).isoformat(),
    })
    return _success_html("microsoft", True)


# ---------- Calendar status / disconnect ----------
@api_router.get("/calendar/status")
async def calendar_status(current_user: dict = Depends(get_current_user)):
    google = await _get_calendar_token(current_user["id"], "google")
    microsoft = await _get_calendar_token(current_user["id"], "microsoft")
    return {
        "google": {
            "connected": bool(google),
            "connected_at": google.get("connected_at") if google else None,
            "configured": bool(GOOGLE_CLIENT_ID),
            "default_calendar_id": google.get("default_calendar_id") if google else None,
            "default_calendar_name": google.get("default_calendar_name") if google else None,
        },
        "microsoft": {
            "connected": bool(microsoft),
            "connected_at": microsoft.get("connected_at") if microsoft else None,
            "configured": bool(MS_CLIENT_ID),
            "default_calendar_id": microsoft.get("default_calendar_id") if microsoft else None,
            "default_calendar_name": microsoft.get("default_calendar_name") if microsoft else None,
        },
    }


@api_router.post("/calendar/disconnect/{provider}")
async def calendar_disconnect(provider: str, current_user: dict = Depends(get_current_user)):
    if provider not in ("google", "microsoft"):
        raise HTTPException(status_code=400, detail="Invalid provider")
    # Best-effort: delete all event mappings for this user/provider
    await db.calendar_tokens.delete_one({"user_id": current_user["id"], "provider": provider})
    # Clear external event IDs from bills
    field = "google_event_id" if provider == "google" else "microsoft_event_id"
    await db.bills.update_many({"user_id": current_user["id"], field: {"$exists": True}}, {"$unset": {field: ""}})
    return {"ok": True, "provider": provider}


# ---------- List external calendars / change default ----------
@api_router.get("/calendar/list/{provider}")
async def list_external_calendars(provider: str, current_user: dict = Depends(get_current_user)):
    if provider not in ("google", "microsoft"):
        raise HTTPException(status_code=400, detail="Invalid provider")
    access = await _get_valid_access_token(current_user["id"], provider)
    if not access:
        raise HTTPException(status_code=400, detail=f"{provider} not connected")
    token = await _get_calendar_token(current_user["id"], provider)
    current_default = (token or {}).get("default_calendar_id") if token else None
    calendars: list = []
    if provider == "microsoft":
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(
                f"{MS_GRAPH_BASE}/me/calendars?$select=id,name,isDefaultCalendar,canEdit&$top=50",
                headers={"Authorization": f"Bearer {access}"},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to list calendars: {r.text[:200]}")
        for item in r.json().get("value", []):
            if not item.get("canEdit", True):
                continue
            calendars.append({
                "id": item["id"],
                "name": item.get("name") or "Calendar",
                "is_primary": bool(item.get("isDefaultCalendar")),
                "is_current": (current_default == item["id"]) or (current_default is None and item.get("isDefaultCalendar")),
            })
    else:  # google
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(
                f"{GOOGLE_CALENDAR_API_BASE}/users/me/calendarList?maxResults=50",
                headers={"Authorization": f"Bearer {access}"},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to list calendars: {r.text[:200]}")
        for item in r.json().get("items", []):
            role = item.get("accessRole", "")
            if role not in ("owner", "writer"):
                continue
            calendars.append({
                "id": item["id"],
                "name": item.get("summary") or "Calendar",
                "is_primary": bool(item.get("primary")),
                "is_current": (current_default == item["id"]) or (current_default == "primary" and item.get("primary")),
            })
    return {"calendars": calendars}


class SetDefaultCalendar(BaseModel):
    calendar_id: str
    calendar_name: Optional[str] = None


@api_router.post("/calendar/set_default/{provider}")
async def set_default_calendar(provider: str, payload: SetDefaultCalendar, background: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    if provider not in ("google", "microsoft"):
        raise HTTPException(status_code=400, detail="Invalid provider")
    token = await _get_calendar_token(current_user["id"], provider)
    if not token:
        raise HTTPException(status_code=400, detail=f"{provider} not connected")
    old_cal_id = token.get("default_calendar_id")
    new_cal_id = payload.calendar_id

    if old_cal_id == new_cal_id:
        return {"ok": True, "unchanged": True, "moved": 0}

    field = "microsoft_event_id" if provider == "microsoft" else "google_event_id"
    bills_with_events = await db.bills.find({"user_id": current_user["id"], field: {"$exists": True, "$ne": None}}, {"_id": 0}).to_list(2000)

    # Delete events from OLD calendar first (uses current default_calendar_id)
    for b in bills_with_events:
        try:
            if provider == "microsoft":
                await _ms_delete_event(current_user["id"], b)
            else:
                await _google_delete_event(current_user["id"], b)
        except Exception as e:
            logger.warning("delete during cal switch failed: %s", e)

    # Clear external event IDs from bills (so they get recreated)
    await db.bills.update_many(
        {"user_id": current_user["id"], field: {"$exists": True}},
        {"$unset": {field: ""}},
    )

    # Update default calendar id (and name for display)
    update = {"default_calendar_id": new_cal_id}
    if payload.calendar_name:
        update["default_calendar_name"] = payload.calendar_name
    await _upsert_calendar_token(current_user["id"], provider, update)

    # Background: re-push all bills to NEW calendar
    moved = len(bills_with_events)

    async def repush():
        all_bills = await db.bills.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(2000)
        for bill in all_bills:
            await _sync_bill_update(current_user["id"], bill["id"])

    background.add_task(repush)
    return {"ok": True, "moved": moved, "calendar_id": new_cal_id}


# ---------- Event push helpers ----------
def _format_event_title(bill_doc: dict) -> str:
    amt = float(bill_doc.get("amount", 0))
    # Format as (-$65) or (-$1,450) — drop cents if whole dollars to match in-app pill
    if amt == int(amt):
        amt_str = f"-${int(amt):,}"
    else:
        amt_str = f"-${amt:,.2f}"
    return f"({amt_str}) {bill_doc.get('title', 'Bill')}"


def _bill_event_body_google(bill_doc: dict) -> dict:
    due = bill_doc["due_date"]
    try:
        d = datetime.fromisoformat(due).date()
    except Exception:
        d = datetime.now(timezone.utc).date()
    end = (d + timedelta(days=1)).isoformat()
    desc = f"Category: {bill_doc.get('category', 'Other')}"
    if bill_doc.get("notes"):
        desc += f"\n\n{bill_doc['notes']}"
    return {
        "summary": _format_event_title(bill_doc),
        "description": desc,
        "start": {"date": d.isoformat()},
        "end": {"date": end},
        "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 1440}]},
        "colorId": "6",  # Tangerine / orange
        "source": {"title": "BillCal", "url": "https://billcal.app"},
    }


def _bill_event_body_ms(bill_doc: dict) -> dict:
    due = bill_doc["due_date"]
    try:
        d = datetime.fromisoformat(due).date()
    except Exception:
        d = datetime.now(timezone.utc).date()
    end = d + timedelta(days=1)
    desc = f"Category: {bill_doc.get('category', 'Other')}"
    if bill_doc.get("notes"):
        desc += f"<br/><br/>{bill_doc['notes']}"
    return {
        "subject": _format_event_title(bill_doc),
        "body": {"contentType": "HTML", "content": desc},
        "isAllDay": True,
        "start": {"dateTime": f"{d.isoformat()}T00:00:00", "timeZone": "UTC"},
        "end": {"dateTime": f"{end.isoformat()}T00:00:00", "timeZone": "UTC"},
        "isReminderOn": True,
        "reminderMinutesBeforeStart": 1440,
        "categories": ["BillCal"],
    }


# Cache: per-user flag so we only POST master category once per session
_MS_CATEGORY_ENSURED: set = set()


async def _ms_ensure_billcal_category(user_id: str) -> None:
    """Ensure a master category 'BillCal' with orange color exists in the user's mailbox.
    Without this, the `categories: ['BillCal']` on events won't render with a color.
    Idempotent: a single 409 on create means it already exists."""
    if user_id in _MS_CATEGORY_ENSURED:
        return
    access = await _get_valid_access_token(user_id, "microsoft")
    if not access:
        return
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{MS_GRAPH_BASE}/me/outlook/masterCategories",
                headers={"Authorization": f"Bearer {access}", "Content-Type": "application/json"},
                json={"displayName": "BillCal", "color": "preset1"},  # preset1 = Orange
            )
        if r.status_code in (200, 201, 409):
            _MS_CATEGORY_ENSURED.add(user_id)
        else:
            logger.info("ms ensure category: %s %s", r.status_code, r.text[:200])
            # Mark as ensured anyway so we don't spam (some accounts disallow this endpoint)
            _MS_CATEGORY_ENSURED.add(user_id)
    except Exception as e:
        logger.warning("ms category ensure failed: %s", e)


async def _google_create_event(user_id: str, bill_doc: dict) -> Optional[str]:
    access = await _get_valid_access_token(user_id, "google")
    if not access:
        return None
    token = await _get_calendar_token(user_id, "google")
    cal_id = (token or {}).get("default_calendar_id") or "primary"
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.post(
            f"{GOOGLE_CALENDAR_API_BASE}/calendars/{cal_id}/events",
            headers={"Authorization": f"Bearer {access}"},
            json=_bill_event_body_google(bill_doc),
        )
    if r.status_code not in (200, 201):
        logger.warning("google create event failed: %s %s", r.status_code, r.text[:300])
        return None
    return r.json().get("id")


async def _google_update_event(user_id: str, bill_doc: dict) -> None:
    event_id = bill_doc.get("google_event_id")
    if not event_id:
        return
    access = await _get_valid_access_token(user_id, "google")
    if not access:
        return
    token = await _get_calendar_token(user_id, "google")
    cal_id = (token or {}).get("default_calendar_id") or "primary"
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.put(
            f"{GOOGLE_CALENDAR_API_BASE}/calendars/{cal_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access}"},
            json=_bill_event_body_google(bill_doc),
        )
    if r.status_code not in (200, 201):
        logger.warning("google update event failed: %s %s", r.status_code, r.text[:300])


async def _google_delete_event(user_id: str, bill_doc: dict) -> None:
    event_id = bill_doc.get("google_event_id")
    if not event_id:
        return
    access = await _get_valid_access_token(user_id, "google")
    if not access:
        return
    token = await _get_calendar_token(user_id, "google")
    cal_id = (token or {}).get("default_calendar_id") or "primary"
    async with httpx.AsyncClient(timeout=20.0) as c:
        await c.delete(
            f"{GOOGLE_CALENDAR_API_BASE}/calendars/{cal_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access}"},
        )


async def _ms_create_event(user_id: str, bill_doc: dict) -> Optional[str]:
    access = await _get_valid_access_token(user_id, "microsoft")
    if not access:
        return None
    # Ensure the orange "BillCal" master category exists so events render in orange
    await _ms_ensure_billcal_category(user_id)
    token = await _get_calendar_token(user_id, "microsoft")
    cal_id = (token or {}).get("default_calendar_id")
    # If a specific calendar is selected, post to /me/calendars/{id}/events; else default to /me/calendar/events
    path = f"/me/calendars/{cal_id}/events" if cal_id else "/me/calendar/events"
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.post(
            f"{MS_GRAPH_BASE}{path}",
            headers={"Authorization": f"Bearer {access}", "Content-Type": "application/json"},
            json=_bill_event_body_ms(bill_doc),
        )
    if r.status_code not in (200, 201):
        logger.warning("ms create event failed: %s %s", r.status_code, r.text[:300])
        return None
    return r.json().get("id")


async def _ms_update_event(user_id: str, bill_doc: dict) -> None:
    event_id = bill_doc.get("microsoft_event_id")
    if not event_id:
        return
    access = await _get_valid_access_token(user_id, "microsoft")
    if not access:
        return
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.patch(
            f"{MS_GRAPH_BASE}/me/events/{event_id}",
            headers={"Authorization": f"Bearer {access}", "Content-Type": "application/json"},
            json=_bill_event_body_ms(bill_doc),
        )
    if r.status_code not in (200, 201):
        logger.warning("ms update event failed: %s %s", r.status_code, r.text[:300])


async def _ms_delete_event(user_id: str, bill_doc: dict) -> None:
    event_id = bill_doc.get("microsoft_event_id")
    if not event_id:
        return
    access = await _get_valid_access_token(user_id, "microsoft")
    if not access:
        return
    async with httpx.AsyncClient(timeout=20.0) as c:
        await c.delete(
            f"{MS_GRAPH_BASE}/me/events/{event_id}",
            headers={"Authorization": f"Bearer {access}"},
        )


async def _sync_bill_create(user_id: str, bill_id: str):
    """Create events in connected providers for a bill. Best-effort, ignore failures."""
    doc = await db.bills.find_one({"id": bill_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        return
    update = {}
    try:
        if await _get_calendar_token(user_id, "google"):
            ev = await _google_create_event(user_id, doc)
            if ev:
                update["google_event_id"] = ev
    except Exception as e:
        logger.warning("google sync failed: %s", e)
    try:
        if await _get_calendar_token(user_id, "microsoft"):
            ev = await _ms_create_event(user_id, doc)
            if ev:
                update["microsoft_event_id"] = ev
    except Exception as e:
        logger.warning("ms sync failed: %s", e)
    if update:
        await db.bills.update_one({"id": bill_id, "user_id": user_id}, {"$set": update})


async def _sync_bill_update(user_id: str, bill_id: str):
    doc = await db.bills.find_one({"id": bill_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        return
    try:
        if await _get_calendar_token(user_id, "google"):
            if doc.get("google_event_id"):
                await _google_update_event(user_id, doc)
            else:
                ev = await _google_create_event(user_id, doc)
                if ev:
                    await db.bills.update_one({"id": bill_id, "user_id": user_id}, {"$set": {"google_event_id": ev}})
    except Exception as e:
        logger.warning("google update sync failed: %s", e)
    try:
        if await _get_calendar_token(user_id, "microsoft"):
            if doc.get("microsoft_event_id"):
                await _ms_update_event(user_id, doc)
            else:
                ev = await _ms_create_event(user_id, doc)
                if ev:
                    await db.bills.update_one({"id": bill_id, "user_id": user_id}, {"$set": {"microsoft_event_id": ev}})
    except Exception as e:
        logger.warning("ms update sync failed: %s", e)


async def _sync_bill_delete(user_id: str, bill_doc: dict):
    try:
        if bill_doc.get("google_event_id") and await _get_calendar_token(user_id, "google"):
            await _google_delete_event(user_id, bill_doc)
    except Exception as e:
        logger.warning("google delete sync failed: %s", e)
    try:
        if bill_doc.get("microsoft_event_id") and await _get_calendar_token(user_id, "microsoft"):
            await _ms_delete_event(user_id, bill_doc)
    except Exception as e:
        logger.warning("ms delete sync failed: %s", e)


@api_router.post("/calendar/sync_all")
async def calendar_sync_all(background: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Force-push all of the user's bills to connected providers.
    Always performs a full re-push: deletes existing events first (so they move to the currently selected calendar),
    clears stale event IDs, then re-creates each event in the user's current default calendar."""
    google_connected = bool(await _get_calendar_token(current_user["id"], "google"))
    ms_connected = bool(await _get_calendar_token(current_user["id"], "microsoft"))
    if not google_connected and not ms_connected:
        raise HTTPException(status_code=400, detail="No calendar connected")
    bills = await db.bills.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(2000)

    async def push():
        # 1. Delete existing events first so we don't leave orphans in old calendars
        for b in bills:
            try:
                if google_connected and b.get("google_event_id"):
                    await _google_delete_event(current_user["id"], b)
            except Exception as e:
                logger.warning("sync_all: google delete failed: %s", e)
            try:
                if ms_connected and b.get("microsoft_event_id"):
                    await _ms_delete_event(current_user["id"], b)
            except Exception as e:
                logger.warning("sync_all: ms delete failed: %s", e)
        # 2. Clear stale event IDs from all bills
        unset_fields: dict = {}
        if google_connected:
            unset_fields["google_event_id"] = ""
        if ms_connected:
            unset_fields["microsoft_event_id"] = ""
        if unset_fields:
            await db.bills.update_many(
                {"user_id": current_user["id"]},
                {"$unset": unset_fields},
            )
        # 3. Re-create each bill in the currently selected calendar
        fresh_bills = await db.bills.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(2000)
        for bill in fresh_bills:
            await _sync_bill_update(current_user["id"], bill["id"])

    background.add_task(push)
    return {"ok": True, "scheduled": len(bills), "google": google_connected, "microsoft": ms_connected}


# ---------- Categories & Auto-categorization ----------
DEFAULT_CATEGORIES = [
    "Essentials",
    "Phone",
    "Subscriptions",
    "Insurance",
    "Credit Card",
    "Food & Drink",
    "Groceries",
    "Transportation",
    "Shopping",
    "Health",
    "Entertainment",
    "Income",
    "Other",
]

# Built-in auto-categorize rules: substring -> category (case-insensitive). Order matters.
BUILT_IN_RULES: List[dict] = [
    {"pattern": "spotify",        "category": "Subscriptions"},
    {"pattern": "netflix",        "category": "Subscriptions"},
    {"pattern": "hulu",           "category": "Subscriptions"},
    {"pattern": "disney",         "category": "Subscriptions"},
    {"pattern": "apple.com/bill", "category": "Subscriptions"},
    {"pattern": "youtube premium","category": "Subscriptions"},
    {"pattern": "amazon prime",   "category": "Subscriptions"},
    {"pattern": "whole foods",    "category": "Groceries"},
    {"pattern": "trader joe",     "category": "Groceries"},
    {"pattern": "kroger",         "category": "Groceries"},
    {"pattern": "safeway",        "category": "Groceries"},
    {"pattern": "costco",         "category": "Groceries"},
    {"pattern": "walmart",        "category": "Groceries"},
    {"pattern": "coffee",         "category": "Food & Drink"},
    {"pattern": "starbucks",      "category": "Food & Drink"},
    {"pattern": "doordash",       "category": "Food & Drink"},
    {"pattern": "uber eats",      "category": "Food & Drink"},
    {"pattern": "grubhub",        "category": "Food & Drink"},
    {"pattern": "mcdonald",       "category": "Food & Drink"},
    {"pattern": "chipotle",       "category": "Food & Drink"},
    {"pattern": "restaurant",     "category": "Food & Drink"},
    {"pattern": "cafe",           "category": "Food & Drink"},
    {"pattern": "bar ",           "category": "Food & Drink"},
    {"pattern": "uber",           "category": "Transportation"},
    {"pattern": "lyft",           "category": "Transportation"},
    {"pattern": "shell",          "category": "Transportation"},
    {"pattern": "chevron",        "category": "Transportation"},
    {"pattern": "exxon",          "category": "Transportation"},
    {"pattern": "electric",       "category": "Essentials"},
    {"pattern": "powerlink",      "category": "Essentials"},
    {"pattern": "water",          "category": "Essentials"},
    {"pattern": "gas company",    "category": "Essentials"},
    {"pattern": "rent",           "category": "Essentials"},
    {"pattern": "internet",       "category": "Essentials"},
    {"pattern": "fastnet",        "category": "Essentials"},
    {"pattern": "comcast",        "category": "Essentials"},
    {"pattern": "xfinity",        "category": "Essentials"},
    {"pattern": "verizon",        "category": "Phone"},
    {"pattern": "att ",           "category": "Phone"},
    {"pattern": "t-mobile",       "category": "Phone"},
    {"pattern": "insurance",      "category": "Insurance"},
    {"pattern": "geico",          "category": "Insurance"},
    {"pattern": "progressive",    "category": "Insurance"},
    {"pattern": "salary",         "category": "Income"},
    {"pattern": "payroll",        "category": "Income"},
    {"pattern": "deposit",        "category": "Income"},
    {"pattern": "venmo",          "category": "Other"},  # often p2p — neutral default
    {"pattern": "amazon",         "category": "Shopping"},
    {"pattern": "target",         "category": "Shopping"},
    {"pattern": "best buy",       "category": "Shopping"},
    {"pattern": "cvs",            "category": "Health"},
    {"pattern": "walgreens",      "category": "Health"},
    {"pattern": "pharmacy",       "category": "Health"},
    {"pattern": "movie",          "category": "Entertainment"},
    {"pattern": "amc theatre",    "category": "Entertainment"},
]


async def _get_user_rules(user_id: str) -> List[dict]:
    """Returns user custom rules followed by built-in rules. User rules win on first match."""
    user_rules = await db.category_rules.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    return user_rules + BUILT_IN_RULES


def _apply_rules(description: str, rules: List[dict], fallback: str) -> str:
    """Match a transaction description against rules. Returns category or fallback."""
    desc_l = (description or "").lower()
    for r in rules:
        pat = (r.get("pattern") or "").lower().strip()
        if pat and pat in desc_l:
            return r.get("category", fallback)
    return fallback


class CategoryCreate(BaseModel):
    name: str


class RuleCreate(BaseModel):
    pattern: str
    category: str


@api_router.get("/categories")
async def list_categories(current_user: dict = Depends(get_current_user)):
    custom = await db.categories.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).to_list(200)
    custom_names = [c["name"] for c in custom]
    # union of defaults + custom (de-duped)
    all_names = list(DEFAULT_CATEGORIES) + [n for n in custom_names if n not in DEFAULT_CATEGORIES]
    return {
        "defaults": DEFAULT_CATEGORIES,
        "custom": custom_names,
        "all": all_names,
    }


@api_router.post("/categories")
async def create_category(payload: CategoryCreate, current_user: dict = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if name in DEFAULT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Category already exists as a default")
    existing = await db.categories.find_one({"user_id": current_user["id"], "name": name})
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")
    await db.categories.insert_one({"id": str(uuid.uuid4()), "user_id": current_user["id"], "name": name})
    return {"ok": True, "name": name}


@api_router.delete("/categories/{name}")
async def delete_category(name: str, current_user: dict = Depends(get_current_user)):
    if name in DEFAULT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Cannot delete built-in category")
    r = await db.categories.delete_one({"user_id": current_user["id"], "name": name})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"ok": True}


@api_router.get("/category_rules")
async def list_category_rules(current_user: dict = Depends(get_current_user)):
    user_rules = await db.category_rules.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).to_list(500)
    return {
        "user_rules": user_rules,
        "built_in": BUILT_IN_RULES,
    }


@api_router.post("/category_rules")
async def create_rule(payload: RuleCreate, current_user: dict = Depends(get_current_user)):
    pattern = payload.pattern.strip()
    category = payload.category.strip()
    if not pattern or not category:
        raise HTTPException(status_code=400, detail="Pattern and category required")
    rule_id = str(uuid.uuid4())
    await db.category_rules.insert_one({
        "id": rule_id,
        "user_id": current_user["id"],
        "pattern": pattern,
        "category": category,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "id": rule_id}


@api_router.delete("/category_rules/{rule_id}")
async def delete_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.category_rules.delete_one({"id": rule_id, "user_id": current_user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


@api_router.post("/transactions/recategorize")
async def recategorize_all_transactions(current_user: dict = Depends(get_current_user)):
    """Re-apply rules (user + built-in) to all transactions for the current user."""
    rules = await _get_user_rules(current_user["id"])
    txs = await db.bank_transactions.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(2000)
    updated = 0
    for t in txs:
        if t["amount"] >= 0:
            new_cat = "Income" if any(p in (t.get("description","").lower()) for p in ["salary","payroll","deposit"]) else (t.get("category") or "Income")
        else:
            new_cat = _apply_rules(t.get("description", ""), rules, t.get("category") or "Other")
        if new_cat != t.get("category"):
            await db.bank_transactions.update_one({"id": t["id"], "user_id": current_user["id"]}, {"$set": {"category": new_cat}})
            updated += 1
    return {"ok": True, "scanned": len(txs), "updated": updated}


# ---------- Shopping List ----------
class ShoppingItemCreate(BaseModel):
    name: str


class ShoppingItemUpdate(BaseModel):
    name: Optional[str] = None
    done: Optional[bool] = None


@api_router.get("/shopping_list")
async def list_shopping_items(current_user: dict = Depends(get_current_user)):
    items = await db.shopping_list.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).sort("created_at", 1).to_list(500)
    return {"items": items}


@api_router.post("/shopping_list")
async def create_shopping_item(payload: ShoppingItemCreate, current_user: dict = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    item = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "name": name,
        "done": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.shopping_list.insert_one(item)
    return {k: v for k, v in item.items() if k not in ("user_id", "_id")}


@api_router.put("/shopping_list/{item_id}")
async def update_shopping_item(item_id: str, payload: ShoppingItemUpdate, current_user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    if "name" in updates:
        updates["name"] = str(updates["name"]).strip()
        if not updates["name"]:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
    r = await db.shopping_list.find_one_and_update(
        {"id": item_id, "user_id": current_user["id"]},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0, "user_id": 0},
    )
    if not r:
        raise HTTPException(status_code=404, detail="Item not found")
    return r


@api_router.delete("/shopping_list/{item_id}")
async def delete_shopping_item(item_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.shopping_list.delete_one({"id": item_id, "user_id": current_user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


@api_router.post("/shopping_list/clear_done")
async def clear_done_shopping_items(current_user: dict = Depends(get_current_user)):
    r = await db.shopping_list.delete_many({"user_id": current_user["id"], "done": True})
    return {"ok": True, "deleted": r.deleted_count}


# ---------- Tasks ----------
class TaskCreate(BaseModel):
    name: str


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    done: Optional[bool] = None


@api_router.get("/tasks")
async def list_tasks(current_user: dict = Depends(get_current_user)):
    items = await db.tasks.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).sort("created_at", 1).to_list(500)
    return {"items": items}


@api_router.post("/tasks")
async def create_task(payload: TaskCreate, current_user: dict = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    item = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "name": name,
        "done": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tasks.insert_one(item)
    return {k: v for k, v in item.items() if k not in ("user_id", "_id")}


@api_router.put("/tasks/{item_id}")
async def update_task(item_id: str, payload: TaskUpdate, current_user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    if "name" in updates:
        updates["name"] = str(updates["name"]).strip()
        if not updates["name"]:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
    r = await db.tasks.find_one_and_update(
        {"id": item_id, "user_id": current_user["id"]},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0, "user_id": 0},
    )
    if not r:
        raise HTTPException(status_code=404, detail="Task not found")
    return r


@api_router.delete("/tasks/{item_id}")
async def delete_task(item_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.tasks.delete_one({"id": item_id, "user_id": current_user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@api_router.post("/tasks/clear_done")
async def clear_done_tasks(current_user: dict = Depends(get_current_user)):
    r = await db.tasks.delete_many({"user_id": current_user["id"], "done": True})
    return {"ok": True, "deleted": r.deleted_count}


# ---------- Photo → List Import (Claude Sonnet OCR) ----------
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")


class ListImportRequest(BaseModel):
    image_base64: str
    list_type: Literal["shopping", "tasks"]


@api_router.post("/list_import/scan")
async def scan_list_image(payload: ListImportRequest, current_user: dict = Depends(get_current_user)):
    """OCR an image with Claude Sonnet 4.5 and return extracted list items.
    Also matches each extracted name against the user's existing items (case-insensitive substring match)
    so the client can preview + auto-uncheck matched-done items."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")
    if not payload.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 required")

    # Strip data URL prefix if present
    img_b64 = payload.image_base64
    if "," in img_b64 and img_b64.lstrip().startswith("data:"):
        img_b64 = img_b64.split(",", 1)[1]

    # Call Claude with image attachment
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Integration library missing: {e}")

    system_prompt = (
        "You extract list items from a photo of a handwritten or printed list. "
        "Return ONLY a JSON object of the form {\"items\": [\"item1\", \"item2\", ...]}. "
        "Each item should be a short, normalized noun phrase suitable for a shopping or todo list. "
        "Ignore prices, totals, decorative text, headers like 'Shopping List' or 'To Do', and any non-list content. "
        "Do not include numbering, bullets, or check marks. "
        "If the photo contains no list items, return {\"items\": []}. "
        "Output strictly valid JSON, no commentary, no markdown fences."
    )

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"list-import-{current_user['id']}-{uuid.uuid4().hex[:8]}",
        system_message=system_prompt,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    user_msg = UserMessage(
        text=(
            f"Extract every item from this {payload.list_type} list. "
            "Return ONLY the JSON object as instructed."
        ),
        file_contents=[ImageContent(image_base64=img_b64)],
    )

    try:
        response_text = await chat.send_message(user_msg)
    except Exception as e:
        logger.exception("LLM call failed")
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    # Parse JSON robustly
    import json as _json
    import re as _re
    text = (response_text or "").strip()
    # strip code fences if present
    if text.startswith("```"):
        text = _re.sub(r"^```(?:json)?\s*", "", text)
        text = _re.sub(r"\s*```$", "", text)
    items: List[str] = []
    try:
        parsed = _json.loads(text)
        raw_items = parsed.get("items", []) if isinstance(parsed, dict) else []
        for it in raw_items:
            if isinstance(it, str):
                s = it.strip()
                if s:
                    items.append(s)
            elif isinstance(it, dict) and "name" in it:
                s = str(it["name"]).strip()
                if s:
                    items.append(s)
    except Exception:
        # Fallback: extract bullet-like lines
        for line in text.split("\n"):
            line = _re.sub(r"^[\-\*•\d\.\)\(\s\[\]xX✓✗]+", "", line).strip()
            if line and len(line) < 80:
                items.append(line)

    # Dedupe (case-insensitive, preserve first-seen casing)
    seen: set = set()
    deduped: List[str] = []
    for it in items:
        k = it.lower()
        if k not in seen:
            seen.add(k)
            deduped.append(it)

    # Match against user's existing items
    coll = db.shopping_list if payload.list_type == "shopping" else db.tasks
    existing = await coll.find({"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}).to_list(2000)
    existing_by_name = {(e["name"] or "").lower(): e for e in existing}

    results = []
    for name in deduped:
        match = existing_by_name.get(name.lower())
        results.append({
            "name": name,
            "matches_existing_id": match["id"] if match else None,
            "existing_done": match["done"] if match else None,
        })

    return {"list_type": payload.list_type, "extracted": results}


class ListImportApply(BaseModel):
    list_type: Literal["shopping", "tasks"]
    add_items: List[str] = []  # names to create new
    uncheck_ids: List[str] = []  # existing item IDs to mark not-done


@api_router.post("/list_import/apply")
async def apply_list_import(payload: ListImportApply, current_user: dict = Depends(get_current_user)):
    coll = db.shopping_list if payload.list_type == "shopping" else db.tasks
    created = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    docs = []
    for name in payload.add_items:
        n = (name or "").strip()
        if not n:
            continue
        docs.append({
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "name": n,
            "done": False,
            "created_at": now_iso,
        })
    if docs:
        await coll.insert_many(docs)
        created = len(docs)
    unchecked = 0
    if payload.uncheck_ids:
        r = await coll.update_many(
            {"user_id": current_user["id"], "id": {"$in": payload.uncheck_ids}},
            {"$set": {"done": False}},
        )
        unchecked = r.modified_count
    return {"ok": True, "created": created, "unchecked": unchecked}


# ---------- Mock Bank Sync ----------
MOCK_BANKS = [
    {"name": "Everyday Checking", "type": "checking", "masked_number": "****4521", "balance": 3284.55, "institution": "Greenleaf Bank"},
    {"name": "Savings", "type": "savings", "masked_number": "****8810", "balance": 12450.10, "institution": "Greenleaf Bank"},
    {"name": "Visa Platinum", "type": "credit", "masked_number": "****2341", "balance": -842.33, "institution": "Vertex Card"},
]

MOCK_TX_TEMPLATES = [
    ("Electricity - Powerlink", -84.50, "Essentials"),
    ("Spotify Premium", -10.99, "Subscriptions"),
    ("Whole Foods Market", -56.32, "Groceries"),
    ("Salary - Acme Corp", 2400.00, "Income"),
    ("Internet - Fastnet", -59.00, "Essentials"),
    ("Netflix", -15.49, "Subscriptions"),
    ("Coffee - BluePeak", -4.75, "Food & Drink"),
    ("Rent - Maple Properties", -1450.00, "Essentials"),
]


async def seed_mock_bank_for_user(user_id: str):
    accounts = []
    for b in MOCK_BANKS:
        acc = {"id": str(uuid.uuid4()), "user_id": user_id, **b}
        accounts.append(acc)
    await db.bank_accounts.insert_many(accounts)
    txs = []
    today = datetime.now(timezone.utc)
    rules = await _get_user_rules(user_id)
    for i, tpl in enumerate(MOCK_TX_TEMPLATES):
        desc, amt, cat = tpl
        d = (today - timedelta(days=i * 2)).strftime("%Y-%m-%d")
        # Apply auto-categorization to override the seeded category when a rule matches
        final_cat = _apply_rules(desc, rules, cat) if amt < 0 else ("Income" if any(p in desc.lower() for p in ["salary","payroll","deposit"]) else cat)
        txs.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "account_id": accounts[i % len(accounts)]["id"],
            "date": d,
            "description": desc,
            "amount": amt,
            "category": final_cat,
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
@app.on_event("startup")
async def _migrate_categories():
    """One-time migrations: merge legacy categories into renamed/consolidated ones."""
    try:
        # Legacy → Essentials
        legacy_essentials = ["Rent", "Utilities", "Rent & Utilities", "Internet"]
        await db.bills.update_many({"category": {"$in": legacy_essentials}}, {"$set": {"category": "Essentials"}})
        await db.bank_transactions.update_many({"category": {"$in": legacy_essentials}}, {"$set": {"category": "Essentials"}})
        await db.category_rules.update_many({"category": {"$in": legacy_essentials}}, {"$set": {"category": "Essentials"}})
        # Eating & Drinking / Food → Food & Drink
        legacy_food = ["Food", "Eating & Drinking"]
        await db.bills.update_many({"category": {"$in": legacy_food}}, {"$set": {"category": "Food & Drink"}})
        await db.bank_transactions.update_many({"category": {"$in": legacy_food}}, {"$set": {"category": "Food & Drink"}})
        await db.category_rules.update_many({"category": {"$in": legacy_food}}, {"$set": {"category": "Food & Drink"}})
    except Exception:
        pass


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
