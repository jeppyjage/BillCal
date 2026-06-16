"""BillCal backend API tests (auth, bills CRUD, bank mock)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://bill-reminder-hub-6.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@billcal.app"
DEMO_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_token(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Demo login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


# -------- Health --------
def test_health(session):
    r = session.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# -------- Auth --------
def test_login_demo_user(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=20)
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["email"] == DEMO_EMAIL


def test_login_wrong_password(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrong"}, timeout=20)
    assert r.status_code == 401


def test_me_requires_token(session):
    r = session.get(f"{API}/auth/me", timeout=15)
    assert r.status_code in (401, 403)


def test_me_invalid_token(session):
    r = session.get(f"{API}/auth/me", headers={"Authorization": "Bearer not.a.real.jwt"}, timeout=15)
    assert r.status_code == 401


def test_me_with_token(session, auth_headers):
    r = session.get(f"{API}/auth/me", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["email"] == DEMO_EMAIL


def test_register_new_user_and_duplicate(session):
    email = f"test_{uuid.uuid4().hex[:8]}@billcal.app"
    r = session.post(f"{API}/auth/register", json={"email": email, "password": "secret123", "full_name": "TEST User"}, timeout=20)
    assert r.status_code == 200, r.text
    assert "token" in r.json()
    # duplicate
    r2 = session.post(f"{API}/auth/register", json={"email": email, "password": "secret123"}, timeout=20)
    assert r2.status_code == 400


# -------- Bills --------
def test_list_bills_seeded(session, auth_headers):
    r = session.get(f"{API}/bills", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    bills = r.json()
    assert isinstance(bills, list)
    assert len(bills) >= 1, "Demo user should have seeded bills"


def test_bills_requires_auth(session):
    r = session.get(f"{API}/bills", timeout=15)
    assert r.status_code in (401, 403)


def test_bill_crud_flow(session, auth_headers):
    payload = {
        "title": "TEST_Bill",
        "amount": 99.99,
        "due_date": "2026-02-15",
        "category": "Utilities",
        "recurrence": "monthly",
        "notes": "pytest",
    }
    r = session.post(f"{API}/bills", headers=auth_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    bill = r.json()
    bid = bill["id"]
    assert bill["title"] == "TEST_Bill"
    assert bill["paid"] is False

    # GET single
    rg = session.get(f"{API}/bills/{bid}", headers=auth_headers, timeout=15)
    assert rg.status_code == 200
    assert rg.json()["amount"] == 99.99

    # Update
    ru = session.put(f"{API}/bills/{bid}", headers=auth_headers, json={"title": "TEST_Bill_Updated"}, timeout=15)
    assert ru.status_code == 200
    assert ru.json()["title"] == "TEST_Bill_Updated"

    # Toggle paid
    rt = session.post(f"{API}/bills/{bid}/toggle_paid", headers=auth_headers, timeout=15)
    assert rt.status_code == 200
    assert rt.json()["paid"] is True
    rt2 = session.post(f"{API}/bills/{bid}/toggle_paid", headers=auth_headers, timeout=15)
    assert rt2.json()["paid"] is False

    # Delete
    rd = session.delete(f"{API}/bills/{bid}", headers=auth_headers, timeout=15)
    assert rd.status_code == 200

    # Verify deleted
    rg2 = session.get(f"{API}/bills/{bid}", headers=auth_headers, timeout=15)
    assert rg2.status_code == 404


def test_update_nonexistent_bill(session, auth_headers):
    r = session.put(f"{API}/bills/{uuid.uuid4()}", headers=auth_headers, json={"title": "x"}, timeout=15)
    assert r.status_code == 404


# -------- Bank --------
def test_bank_accounts(session, auth_headers):
    r = session.get(f"{API}/bank/accounts", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    accs = r.json()
    assert isinstance(accs, list)
    assert len(accs) >= 1
    assert "balance" in accs[0]


def test_bank_transactions(session, auth_headers):
    r = session.get(f"{API}/bank/transactions", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    txs = r.json()
    assert isinstance(txs, list)
    assert len(txs) >= 1


def test_bank_sync(session, auth_headers):
    r = session.post(f"{API}/bank/sync", headers=auth_headers, timeout=20)
    assert r.status_code == 200
    j = r.json()
    assert j.get("ok") is True
    assert "last_synced" in j
