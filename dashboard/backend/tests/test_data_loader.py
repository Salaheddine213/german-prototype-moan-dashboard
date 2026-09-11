import pytest
from app.data_loader import DataEngine


class TestDataEngine:
    def test_engine_connects_to_duckdb(self, settings):
        engine = DataEngine(settings)
        result = engine.query("SELECT COUNT(*) AS n FROM ts_daily")
        assert result[0]["n"] > 1000
        engine.close()

    def test_query_wide_returns_columns(self, settings):
        engine = DataEngine(settings)
        rows = engine.query_wide(
            "ts_daily",
            ["Gas_TTF__price", "CO2_EUA__price"],
            "2024-01-01",
            "2024-01-31",
        )
        assert len(rows) > 10
        sample = rows[0]
        assert "timestamp_utc" in sample
        assert "Gas_TTF__price" in sample
        assert "CO2_EUA__price" in sample
        engine.close()

    def test_discover_latest_production_model(self, settings):
        engine = DataEngine(settings)
        model_dir = engine.latest_production_model
        assert model_dir is not None
        assert "Production_Ensemble_" in model_dir.name
        assert (model_dir / "metrics.json").exists()
        engine.close()

    def test_discover_forecast_scenarios(self, settings):
        engine = DataEngine(settings)
        scenarios = engine.available_scenarios
        assert len(scenarios) >= 1
        assert any("Central" in s for s in scenarios)
        engine.close()
