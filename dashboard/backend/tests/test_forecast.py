import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _get_full_scenario(client):
    """Return the first v17 scenario which has all required files (DA, ID3, annual stats)."""
    resp = client.get("/api/scenarios/list")
    scenarios = resp.json()["scenarios"]
    # Prefer v17 scenarios which have Annual_statistics xlsx and ID3 feather files
    for s in scenarios:
        if s.startswith("v17"):
            return s
    return scenarios[0]


class TestForecastEndpoints:
    def test_da_forecast(self, client):
        scenario = _get_full_scenario(client)
        resp = client.get(f"/api/forecast/da?start=2025-01-01&end=2025-12-31&scenario={scenario}&max_points=500")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["datetime"]) > 0
        assert len(data["datetime"]) <= 500
        assert "price_predicted" in data

    def test_id3_imbalance(self, client):
        scenario = _get_full_scenario(client)
        resp = client.get(f"/api/forecast/id3-imbalance?start=2025-01-01&end=2025-03-31&scenario={scenario}&max_points=1000")
        assert resp.status_code == 200
        data = resp.json()
        assert "da_price" in data
        assert "id3_price" in data
        assert "imb_long" in data

    def test_annual_stats(self, client):
        scenario = _get_full_scenario(client)
        resp = client.get(f"/api/forecast/annual-stats?scenario={scenario}")
        assert resp.status_code == 200
        data = resp.json()
        assert "years" in data
        assert len(data["years"]) > 20
        assert "avg_da" in data
        assert "bess_4h" in data
