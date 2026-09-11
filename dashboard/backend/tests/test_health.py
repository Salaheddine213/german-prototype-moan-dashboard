import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"

    def test_health_shows_data_loaded(self, client):
        resp = client.get("/api/health")
        data = resp.json()
        assert "data_loaded" in data
        assert "last_model" in data
        assert "last_forecast" in data
        assert "scenarios" in data
