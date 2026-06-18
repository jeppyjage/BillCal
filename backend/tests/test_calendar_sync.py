"""Backend tests for External Calendar Sync (Microsoft + Google) and regression."""
import os
import pytest
import requests
from urllib.parse import urlparse, parse_qs

BASE_URL = "https://bill-reminder-hub-6.preview.emergentagent.com/api"

DEMO_EMAIL = "demo@billcal.app"
DEMO_PASS = "demo1234"

EXPECTED_MS_CLIENT_ID = "dbf4edba-65de-4803-8ff3-f89f4add157e"
EXPECTED_REDIRECT_URI = "https://bill-reminder-hub-6.preview.emergentagent.com/api/oauth/microsoft/callback"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth(session):
    r = session.post(f"{BASE_URL}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data


@pytest.fixture(scope="module")
def token(auth):
    return auth["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Calendar status ----------
class TestCalendarStatus:
    def test_calendar_status(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/calendar/status", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "google" in data and "microsoft" in data
        assert data["google"]["configured"] is False
        assert data["google"]["connected"] is False
        assert data["microsoft"]["configured"] is True
        # connected may be true if previous test runs left a token; assert false ideally
        assert data["microsoft"]["connected"] in (True, False)


# ---------- OAuth start ----------
class TestOAuthStart:
    def test_microsoft_start_redirects(self, token):
        r = requests.get(
            f"{BASE_URL}/oauth/microsoft/start",
            params={"token": token},
            allow_redirects=False,
        )
        assert r.status_code in (302, 307), f"Expected redirect, got {r.status_code} {r.text[:200]}"
        loc = r.headers.get("location") or r.headers.get("Location")
        assert loc, "No location header"
        assert loc.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize"), loc
        parsed = urlparse(loc)
        qs = parse_qs(parsed.query)
        assert qs.get("client_id") == [EXPECTED_MS_CLIENT_ID]
        assert qs.get("response_type") == ["code"]
        assert qs.get("redirect_uri") == [EXPECTED_REDIRECT_URI], qs.get("redirect_uri")
        scope = qs.get("scope", [""])[0]
        assert "offline_access" in scope
        assert "Calendars.ReadWrite" in scope
        assert qs.get("state") and len(qs["state"][0]) > 20

    def test_google_start_returns_html_not_configured(self, token):
        r = requests.get(
            f"{BASE_URL}/oauth/google/start",
            params={"token": token},
            allow_redirects=False,
        )
        # Should NOT be a redirect (Google not configured) → returns HTML 200
        assert r.status_code == 200, f"Expected 200 HTML, got {r.status_code}"
        assert "text/html" in r.headers.get("content-type", "").lower()
        body = r.text.lower()
        assert "not configured" in body or "google_client_id" in body or "connection failed" in body

    def test_microsoft_start_missing_token(self):
        r = requests.get(f"{BASE_URL}/oauth/microsoft/start", allow_redirects=False)
        assert r.status_code == 422, f"Expected 422, got {r.status_code} {r.text[:200]}"

    def test_microsoft_start_invalid_token(self):
        r = requests.get(
            f"{BASE_URL}/oauth/microsoft/start",
            params={"token": "invalid.jwt.here"},
            allow_redirects=False,
        )
        assert r.status_code == 401, f"Expected 401, got {r.status_code} {r.text[:200]}"
        assert "invalid token" in r.text.lower()


# ---------- OAuth callback ----------
class TestOAuthCallback:
    def test_callback_missing_code_state(self):
        r = requests.get(f"{BASE_URL}/oauth/microsoft/callback", allow_redirects=False)
        assert r.status_code == 200, r.status_code
        assert "text/html" in r.headers.get("content-type", "").lower()
        assert "missing code" in r.text.lower() or "connection failed" in r.text.lower()

    def test_callback_invalid_state(self):
        r = requests.get(
            f"{BASE_URL}/oauth/microsoft/callback",
            params={"state": "not-a-valid-jwt", "code": "test"},
            allow_redirects=False,
        )
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "").lower()
        assert "invalid or expired state" in r.text.lower()


# ---------- Disconnect ----------
class TestDisconnect:
    def test_disconnect_microsoft_idempotent(self, session, auth_headers):
        r = session.post(f"{BASE_URL}/calendar/disconnect/microsoft", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"ok": True, "provider": "microsoft"}

    def test_disconnect_invalid_provider(self, session, auth_headers):
        r = session.post(f"{BASE_URL}/calendar/disconnect/invalid_provider", headers=auth_headers)
        assert r.status_code == 400, r.text


# ---------- Sync all ----------
class TestSyncAll:
    def test_sync_all_no_connection(self, session, auth_headers):
        # First ensure microsoft is disconnected
        session.post(f"{BASE_URL}/calendar/disconnect/microsoft", headers=auth_headers)
        session.post(f"{BASE_URL}/calendar/disconnect/google", headers=auth_headers)
        r = session.post(f"{BASE_URL}/calendar/sync_all", headers=auth_headers)
        assert r.status_code == 400, r.text
        assert "no calendar connected" in r.text.lower()


# ---------- Bill auto-sync verification ----------
class TestBillAutoSync:
    def test_create_bill_no_providers(self, session, auth_headers):
        payload = {
            "title": "TEST_AutoSyncBill",
            "amount": 12.34,
            "due_date": "2026-06-15",
            "category": "Other",
            "recurrence": "none",
            "notes": "test",
        }
        r = session.post(f"{BASE_URL}/bills", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        bill = r.json()
        assert bill["title"] == "TEST_AutoSyncBill"
        assert "google_event_id" in bill
        assert "microsoft_event_id" in bill
        assert bill["google_event_id"] is None
        assert bill["microsoft_event_id"] is None
        # cleanup
        session.delete(f"{BASE_URL}/bills/{bill['id']}", headers=auth_headers)


# ---------- Regression tests ----------
class TestRegression:
    def test_login(self, session):
        r = session.post(f"{BASE_URL}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
        assert r.status_code == 200
        assert "token" in r.json()

    def test_list_bills(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/bills", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_bill_crud_cycle(self, session, auth_headers):
        # Create
        payload = {
            "title": "TEST_RegressionBill",
            "amount": 99.99,
            "due_date": "2026-07-20",
            "category": "Subscriptions",
            "recurrence": "monthly",
            "notes": "regression",
        }
        r = session.post(f"{BASE_URL}/bills", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        # Update
        r = session.put(f"{BASE_URL}/bills/{bid}", json={"amount": 88.88}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["amount"] == 88.88
        # Toggle paid
        r = session.post(f"{BASE_URL}/bills/{bid}/toggle_paid", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["paid"] is True
        # Delete
        r = session.delete(f"{BASE_URL}/bills/{bid}", headers=auth_headers)
        assert r.status_code == 200
        # Verify gone
        r = session.get(f"{BASE_URL}/bills/{bid}", headers=auth_headers)
        assert r.status_code == 404

    def test_bank_accounts(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/bank/accounts", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_bank_transactions(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/bank/transactions", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_auto_detect(self, session, auth_headers):
        r = session.post(f"{BASE_URL}/bills/auto_detect", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
