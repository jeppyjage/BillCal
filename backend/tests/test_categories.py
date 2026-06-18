"""BillCal backend tests for Category Management, Category Rules,
Auto-categorization on signup, and Transaction Recategorization."""
import os
import time
import pytest
import requests
from urllib.parse import quote

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://bill-reminder-hub-6.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@billcal.app"
DEMO_PASSWORD = "demo1234"

EXPECTED_DEFAULTS = [
    "Rent & Utilities",
    "Internet",
    "Phone",
    "Subscriptions",
    "Insurance",
    "Credit Card",
    "Food",
    "Groceries",
    "Transportation",
    "Shopping",
    "Health",
    "Entertainment",
    "Income",
    "Other",
]


# -------- Fixtures --------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_token(session):
    r = session.post(
        f"{API}/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Demo login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------
# 1. GET /api/categories — defaults present, shape correct
# ---------------------------------------------------------------
def test_list_categories_returns_defaults(session, auth):
    r = session.get(f"{API}/categories", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data.keys()) >= {"defaults", "custom", "all"}
    assert isinstance(data["defaults"], list)
    assert isinstance(data["custom"], list)
    assert isinstance(data["all"], list)
    assert data["defaults"] == EXPECTED_DEFAULTS
    assert len(data["defaults"]) == 14
    # all includes all defaults
    for cat in EXPECTED_DEFAULTS:
        assert cat in data["all"], f"Default {cat} missing in 'all'"


# Cleanup helper — make sure "Pets" doesn't already exist before running create tests
@pytest.fixture(scope="module", autouse=True)
def _cleanup_pets(session, auth):
    session.delete(f"{API}/categories/Pets", headers=auth, timeout=10)
    yield
    session.delete(f"{API}/categories/Pets", headers=auth, timeout=10)


# ---------------------------------------------------------------
# 2. POST /api/categories — create new custom category
# ---------------------------------------------------------------
def test_create_custom_category_pets(session, auth):
    r = session.post(
        f"{API}/categories", headers=auth, json={"name": "Pets"}, timeout=15
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"ok": True, "name": "Pets"}

    # Verify persisted via GET
    r2 = session.get(f"{API}/categories", headers=auth, timeout=15)
    assert r2.status_code == 200
    data = r2.json()
    assert "Pets" in data["custom"]
    assert "Pets" in data["all"]


# ---------------------------------------------------------------
# 3. POST /api/categories duplicate of default -> 400
# ---------------------------------------------------------------
def test_create_duplicate_default_category_rejected(session, auth):
    r = session.post(
        f"{API}/categories",
        headers=auth,
        json={"name": "Rent & Utilities"},
        timeout=15,
    )
    assert r.status_code == 400
    assert "default" in r.json().get("detail", "").lower()


# ---------------------------------------------------------------
# 4. POST /api/categories duplicate of existing custom -> 400
# ---------------------------------------------------------------
def test_create_duplicate_custom_category_rejected(session, auth):
    # Pets was created in previous test
    r = session.post(
        f"{API}/categories", headers=auth, json={"name": "Pets"}, timeout=15
    )
    assert r.status_code == 400
    detail = r.json().get("detail", "").lower()
    assert "already exists" in detail


# ---------------------------------------------------------------
# 5. POST /api/categories empty name -> 400
# ---------------------------------------------------------------
def test_create_empty_name_rejected(session, auth):
    r = session.post(
        f"{API}/categories", headers=auth, json={"name": ""}, timeout=15
    )
    assert r.status_code == 400
    assert "name required" in r.json().get("detail", "").lower()


# ---------------------------------------------------------------
# 6. DELETE /api/categories/Pets — succeeds + persisted
# ---------------------------------------------------------------
def test_delete_custom_category_pets(session, auth):
    r = session.delete(f"{API}/categories/Pets", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    r2 = session.get(f"{API}/categories", headers=auth, timeout=15)
    assert r2.status_code == 200
    assert "Pets" not in r2.json()["custom"]


# ---------------------------------------------------------------
# 7. DELETE built-in category -> 400
# ---------------------------------------------------------------
def test_delete_builtin_category_rejected(session, auth):
    url = f"{API}/categories/{quote('Rent & Utilities', safe='')}"
    r = session.delete(url, headers=auth, timeout=15)
    assert r.status_code == 400
    assert "built-in" in r.json().get("detail", "").lower()


# ---------------------------------------------------------------
# 8. DELETE non-existent -> 404
# ---------------------------------------------------------------
def test_delete_nonexistent_category_404(session, auth):
    r = session.delete(f"{API}/categories/NonExistent_zzz", headers=auth, timeout=15)
    assert r.status_code == 404


# ---------------------------------------------------------------
# 9. GET /api/category_rules
# ---------------------------------------------------------------
def test_list_category_rules_builtin(session, auth):
    r = session.get(f"{API}/category_rules", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "user_rules" in data
    assert "built_in" in data
    assert isinstance(data["built_in"], list)
    assert len(data["built_in"]) >= 50, f"Expected >=50 built-ins, got {len(data['built_in'])}"
    # Shape check
    for rule in data["built_in"]:
        assert "pattern" in rule and "category" in rule
    # Sample checks
    bi = {r["pattern"].lower(): r["category"] for r in data["built_in"]}
    assert bi.get("spotify") == "Subscriptions"
    assert bi.get("whole foods") == "Groceries"
    assert bi.get("uber") == "Transportation"


# ---------------------------------------------------------------
# 10. POST /api/category_rules — create user rule
# ---------------------------------------------------------------
@pytest.fixture(scope="module")
def created_rule_id(session, auth):
    r = session.post(
        f"{API}/category_rules",
        headers=auth,
        json={"pattern": "petsmart", "category": "Pets"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert "id" in body and isinstance(body["id"], str) and len(body["id"]) > 0
    rule_id = body["id"]
    yield rule_id
    # teardown — best-effort
    session.delete(f"{API}/category_rules/{rule_id}", headers=auth, timeout=10)


def test_create_user_rule_and_persists(session, auth, created_rule_id):
    r = session.get(f"{API}/category_rules", headers=auth, timeout=15)
    assert r.status_code == 200
    user_rules = r.json().get("user_rules", [])
    found = next((u for u in user_rules if u.get("id") == created_rule_id), None)
    assert found is not None, "Created rule not found in user_rules"
    assert found["pattern"] == "petsmart"
    assert found["category"] == "Pets"


# ---------------------------------------------------------------
# 11. POST /api/category_rules empty pattern -> 400
# ---------------------------------------------------------------
def test_create_rule_empty_pattern_rejected(session, auth):
    r = session.post(
        f"{API}/category_rules",
        headers=auth,
        json={"pattern": "", "category": "Pets"},
        timeout=15,
    )
    assert r.status_code == 400


# ---------------------------------------------------------------
# 12 + 13. DELETE rule (valid + invalid)
# ---------------------------------------------------------------
def test_delete_user_rule(session, auth):
    # Create a fresh one to delete
    r = session.post(
        f"{API}/category_rules",
        headers=auth,
        json={"pattern": "tempmart_test_delete", "category": "Other"},
        timeout=15,
    )
    assert r.status_code == 200
    rid = r.json()["id"]

    d = session.delete(f"{API}/category_rules/{rid}", headers=auth, timeout=15)
    assert d.status_code == 200
    assert d.json() == {"ok": True}


def test_delete_invalid_rule_404(session, auth):
    r = session.delete(f"{API}/category_rules/invalid_id_xyz", headers=auth, timeout=15)
    assert r.status_code == 404


# ---------------------------------------------------------------
# 14. POST /api/transactions/recategorize
# ---------------------------------------------------------------
def test_recategorize_transactions(session, auth):
    r = session.post(f"{API}/transactions/recategorize", headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert "scanned" in body and isinstance(body["scanned"], int)
    assert "updated" in body and isinstance(body["updated"], int)
    assert body["scanned"] >= 0

    # Now verify some seeded transactions have expected categories
    tx_r = session.get(f"{API}/bank/transactions", headers=auth, timeout=20)
    assert tx_r.status_code == 200
    txs = tx_r.json()
    by_desc = {t["description"]: t for t in txs}

    expectations = {
        "Spotify Premium": "Subscriptions",
        "Whole Foods Market": "Groceries",
        "Salary - Acme Corp": "Income",
        "Electricity - Powerlink": "Rent & Utilities",
    }
    missing = []
    wrong = []
    for desc, expected in expectations.items():
        if desc not in by_desc:
            missing.append(desc)
            continue
        actual = by_desc[desc].get("category")
        if actual != expected:
            wrong.append((desc, expected, actual))
    assert not missing, f"Expected transactions missing for demo user: {missing}"
    assert not wrong, f"Wrong categories after recategorize: {wrong}"


# ---------------------------------------------------------------
# 15. Auto-categorize on new signup
# ---------------------------------------------------------------
def test_autocategorize_on_new_signup(session):
    ts = int(time.time() * 1000)
    email = f"testautocat+{ts}@billcal.app"
    payload = {"email": email, "password": "test1234", "full_name": "Auto Cat Tester"}
    r = session.post(f"{API}/auth/register", json=payload, timeout=20)
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    body = r.json()
    assert "token" in body and "user" in body
    token = body["token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Give backend a moment to finish seeding
    time.sleep(1.0)

    tx_r = session.get(f"{API}/bank/transactions", headers=headers, timeout=20)
    assert tx_r.status_code == 200
    txs = tx_r.json()
    assert len(txs) > 0, "No transactions seeded for new user"
    by_desc = {t["description"]: t for t in txs}

    expectations = {
        "Spotify Premium": "Subscriptions",
        "Whole Foods Market": "Groceries",
        "Salary - Acme Corp": "Income",
        "Electricity - Powerlink": "Rent & Utilities",
        "Netflix": "Subscriptions",
        "Internet - Fastnet": "Internet",  # 'internet' rule should fire over the seeded 'Rent & Utilities'
        "Coffee - BluePeak": "Food",
        "Rent - Maple Properties": "Rent & Utilities",
    }
    issues = []
    for desc, expected in expectations.items():
        if desc not in by_desc:
            issues.append(f"MISSING: {desc}")
            continue
        actual = by_desc[desc].get("category")
        if actual != expected:
            issues.append(f"{desc}: expected={expected} actual={actual}")
    assert not issues, "Auto-categorize on signup mismatches: " + "; ".join(issues)


# ---------------------------------------------------------------
# 16. Regression — quick smoke
# ---------------------------------------------------------------
def test_regression_calendar_status(session, auth):
    r = session.get(f"{API}/calendar/status", headers=auth, timeout=15)
    assert r.status_code == 200
    data = r.json()
    # Backwards compat keys
    assert "google" in data and "microsoft" in data


def test_regression_bills_list(session, auth):
    r = session.get(f"{API}/bills", headers=auth, timeout=15)
    assert r.status_code == 200
    bills = r.json()
    assert isinstance(bills, list)
    # Nullable event id fields
    for b in bills:
        # Should be either missing/None or a string
        gid = b.get("google_event_id")
        mid = b.get("microsoft_event_id")
        assert gid is None or isinstance(gid, str)
        assert mid is None or isinstance(mid, str)


def test_regression_bank_accounts(session, auth):
    r = session.get(f"{API}/bank/accounts", headers=auth, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_bank_transactions(session, auth):
    r = session.get(f"{API}/bank/transactions", headers=auth, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_bills_auto_detect(session, auth):
    r = session.post(f"{API}/bills/auto_detect", headers=auth, timeout=20)
    assert r.status_code == 200
    body = r.json()
    # auto_detect returns List[Bill]
    assert isinstance(body, list)


def test_regression_oauth_start_paths(session, demo_token):
    # OAuth start endpoints require `token` query param (not header)
    for prov in ("google", "microsoft"):
        r = session.get(
            f"{API}/oauth/{prov}/start",
            params={"token": demo_token},
            timeout=15,
            allow_redirects=False,
        )
        assert r.status_code in (200, 302, 307), f"{prov} start unexpected {r.status_code}: {r.text[:200]}"


def test_regression_calendar_sync_all(session, auth):
    r = session.post(f"{API}/calendar/sync_all", headers=auth, timeout=20)
    # If neither provider connected, endpoint should still return success/empty
    assert r.status_code in (200, 400)


def test_regression_calendar_list_microsoft(session, auth):
    r = session.get(f"{API}/calendar/list/microsoft", headers=auth, timeout=15)
    # For unconnected demo user, expect 400 'not connected'
    assert r.status_code in (200, 400)


def test_regression_calendar_disconnect_idempotent(session, auth):
    r = session.post(f"{API}/calendar/disconnect/microsoft", headers=auth, timeout=15)
    assert r.status_code in (200, 400)
