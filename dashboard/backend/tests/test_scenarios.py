import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestScenariosEndpoints:
    def test_list_scenarios(self, client):
        resp = client.get("/api/scenarios/list")
        assert resp.status_code == 200
        data = resp.json()
        assert "scenarios" in data
        assert len(data["scenarios"]) >= 1

    def test_get_scenario_data(self, client):
        list_resp = client.get("/api/scenarios/list")
        scenarios = list_resp.json()["scenarios"]
        scenario = scenarios[0]

        resp = client.get(f"/api/scenarios?scenario={scenario}")
        assert resp.status_code == 200
        data = resp.json()
        assert "years" in data
        assert len(data["years"]) > 20
        assert "solar_pv_gw" in data
        assert "gas_price" in data

    def test_invalid_scenario_404(self, client):
        resp = client.get("/api/scenarios?scenario=nonexistent")
        assert resp.status_code == 404
