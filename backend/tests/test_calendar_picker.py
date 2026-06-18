"""Backend tests for new Calendar Picker endpoints:
- GET /api/calendar/list/{provider}
- POST /api/calendar/set_default/{provider}
- Updated GET /api/calendar/status with default_calendar_id/name fields
"""
import pytest
import requests

BASE_URL = "https://bill-reminder-hub-6.preview.emergentagent.com/api"

DEMO_EMAIL = "demo@billcal.app"
DEMO_PASS = "demo1234"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_headers(session):
    r = session.post(f"{BASE_URL}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def ensure_disconnected(session, auth_headers):
    """Ensure demo user is disconnected from both providers before tests."""
    session.post(f"{BASE_URL}/calendar/disconnect/microsoft", headers=auth_headers)
    session.post(f"{BASE_URL}/calendar/disconnect/google", headers=auth_headers)
    yield


# ---------- Updated /calendar/status ----------
class TestCalendarStatusWithDefaults:
    def test_status_includes_default_calendar_fields(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/calendar/status", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "google" in data and "microsoft" in data
        # Google fields
        g = data["google"]
        assert "default_calendar_id" in g, f"google missing default_calendar_id: {g}"
        assert "default_calendar_name" in g, f"google missing default_calendar_name: {g}"
        assert g["default_calendar_id"] is None
        assert g["default_calendar_name"] is None
        # Microsoft fields
        m = data["microsoft"]
        assert "default_calendar_id" in m, f"microsoft missing default_calendar_id: {m}"
        assert "default_calendar_name" in m, f"microsoft missing default_calendar_name: {m}"
        assert m["default_calendar_id"] is None
        assert m["default_calendar_name"] is None
        # connection should be false (demo user not connected)
        assert g["connected"] is False
        assert m["connected"] is False


# ---------- GET /calendar/list/{provider} ----------
class TestCalendarList:
    def test_list_microsoft_not_connected(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/calendar/list/microsoft", headers=auth_headers)
        assert r.status_code == 400, r.text
        assert "microsoft not connected" in r.json().get("detail", "").lower()

    def test_list_google_not_connected(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/calendar/list/google", headers=auth_headers)
        assert r.status_code == 400, r.text
        assert "google not connected" in r.json().get("detail", "").lower()

    def test_list_invalid_provider(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/calendar/list/invalid_provider", headers=auth_headers)
        assert r.status_code == 400, r.text
        assert "invalid provider" in r.json().get("detail", "").lower()

    def test_list_requires_auth(self, session):
        r = session.get(f"{BASE_URL}/calendar/list/microsoft")
        # FastAPI HTTPBearer rejects with 403 when no Authorization header
        assert r.status_code in (401, 403), r.text


# ---------- POST /calendar/set_default/{provider} ----------
class TestCalendarSetDefault:
    def test_set_default_microsoft_not_connected(self, session, auth_headers):
        r = session.post(
            f"{BASE_URL}/calendar/set_default/microsoft",
            json={"calendar_id": "xyz"},
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text
        assert "microsoft not connected" in r.json().get("detail", "").lower()

    def test_set_default_google_not_connected(self, session, auth_headers):
        r = session.post(
            f"{BASE_URL}/calendar/set_default/google",
            json={"calendar_id": "primary"},
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text
        assert "google not connected" in r.json().get("detail", "").lower()

    def test_set_default_invalid_provider(self, session, auth_headers):
        r = session.post(
            f"{BASE_URL}/calendar/set_default/invalid",
            json={"calendar_id": "x"},
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text
        assert "invalid provider" in r.json().get("detail", "").lower()

    def test_set_default_missing_calendar_id(self, session, auth_headers):
        r = session.post(
            f"{BASE_URL}/calendar/set_default/microsoft",
            json={},
            headers=auth_headers,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code} {r.text}"

    def test_set_default_with_calendar_name_optional(self, session, auth_headers):
        # Provider not connected so will still 400, but body shape with calendar_name is valid
        r = session.post(
            f"{BASE_URL}/calendar/set_default/microsoft",
            json={"calendar_id": "xyz", "calendar_name": "Work"},
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text
        assert "microsoft not connected" in r.json().get("detail", "").lower()

    def test_set_default_requires_auth(self, session):
        r = session.post(
            f"{BASE_URL}/calendar/set_default/microsoft",
            json={"calendar_id": "xyz"},
        )
        assert r.status_code in (401, 403), r.text
