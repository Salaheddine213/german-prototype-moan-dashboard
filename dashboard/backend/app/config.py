from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Optional path to a real DuckDB file (e.g. one produced by an ENTSO-E /
    # EPEX ingestion pipeline). When absent, the app runs in demo mode with
    # clearly-labelled synthetic German market data generated in memory.
    duckdb_path: Path | None = None
    model_results_dir: Path = Path("demo_artifacts")
    # Glob pattern for historical engineered features file (used by /ml/correlation-matrix).
    # Optional — the endpoint falls back to demo feature data when absent.
    historical_features_path: Path = Path("demo_artifacts/demo/Historical_data_features_engineered_*.parquet")
    # CSV with two columns (datetime_UTC, USD_per_EUR), resolved via glob.
    # Optional — endpoints fall back to empty arrays if the file is absent.
    eur_usd_path: Path = Path("demo_artifacts/EUR_USD_daily_*.csv")
    # CSV with at least (datetime_UTC, price_USD_ton). Same fallback semantics.
    coal_api2_path: Path = Path("demo_artifacts/commodity_coal_API2_daily_*.csv")
    # Demo mode controls: all metrics/feature lists are generated synthetically.
    demo_start: str = "2022-01-01"
    demo_end: str = "2026-08-31"
    api_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = SettingsConfigDict(env_prefix="MARKET_", env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def is_demo_mode(settings: Settings | None = None) -> bool:
    """True when no on-disk DuckDB is configured (synthetic demo data in use)."""
    settings = settings or get_settings()
    if settings.duckdb_path is None:
        return True
    return not Path(settings.duckdb_path).exists()