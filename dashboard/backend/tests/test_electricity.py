import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestElectricityEndpoints:
    def test_historical_returns_da_prices(self, client):
        resp = client.get("/api/electricity/historical?start=2024-01-01&end=2024-01-31")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["da_prices"]) > 100

    def test_duration_curve(self, client):
        resp = client.get("/api/electricity/duration-curve?year=2024")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sorted_prices"]) > 1000
        prices = data["sorted_prices"]
        assert prices[0] >= prices[-1]
        assert "negative_hours" in data
        assert "peak_hours" in data

    def test_heatmap(self, client):
        resp = client.get("/api/electricity/heatmap?year=2024")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["hours"]) == 24
        assert len(data["months"]) == 12
        assert len(data["values"]) == 24
