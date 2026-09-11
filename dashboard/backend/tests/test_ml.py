import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestMLEndpoints:
    def test_metrics(self, client):
        resp = client.get("/api/ml/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert "training" in data
        assert "validation" in data
        assert data["training"]["mae"] > 0
        assert "price_bands" in data
        assert len(data["price_bands"]) == 4
        assert "bess" in data
        assert "capture_rate" in data["bess"]
        assert "weights" in data
        assert "feature_importance" in data

    def test_predictions(self, client):
        resp = client.get("/api/ml/predictions?set=validation&max_points=500")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["actual"]) > 0
        assert len(data["actual"]) <= 500
        assert len(data["predicted"]) == len(data["actual"])
        assert "datetime" in data

    def test_predictions_training(self, client):
        resp = client.get("/api/ml/predictions?set=training&max_points=500")
        assert resp.status_code == 200

    def test_correlation_matrix(self, client):
        resp = client.get("/api/ml/correlation-matrix")
        assert resp.status_code == 200
        data = resp.json()
        assert "features" in data
        assert "matrix" in data
        assert len(data["features"]) > 0
        assert len(data["matrix"]) == len(data["features"])
