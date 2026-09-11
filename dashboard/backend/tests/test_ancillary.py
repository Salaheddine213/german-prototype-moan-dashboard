import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _get_full_scenario(client):
    """Return the first v17 scenario which has all required files (aFRR, annual stats)."""
    scenarios = client.get("/api/scenarios/list").json()["scenarios"]
    for s in scenarios:
        if s.startswith("v17"):
            return s
    return scenarios[0]


class TestAncillaryEndpoints:
    def test_capacity_prices(self, client):
        scenario = _get_full_scenario(client)
        resp = client.get(f"/api/ancillary/capacity?start=2025-01-01&end=2025-12-31&scenario={scenario}")
        assert resp.status_code == 200
        data = resp.json()
        assert "datetime" in data
        assert "afrr_cap_up" in data
        assert "fcr_cap_price" in data

    def test_revenue(self, client):
        scenario = _get_full_scenario(client)
        resp = client.get(f"/api/ancillary/revenue?scenario={scenario}")
        assert resp.status_code == 200
        data = resp.json()
        assert "years" in data
        assert "afrr_cap_revenue" in data
        assert "fcr_cap_revenue" in data

    def test_regulation_states(self, client):
        scenario = _get_full_scenario(client)
        resp = client.get(f"/api/ancillary/regulation-states?year=2025&scenario={scenario}")
        assert resp.status_code == 200
        data = resp.json()
        assert "states" in data
        assert len(data["states"]) >= 2
