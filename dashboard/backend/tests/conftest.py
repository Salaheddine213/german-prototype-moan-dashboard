import os
from pathlib import Path

import pytest  # noqa: E402
from app.config import get_settings  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_settings():
    """Ensure fresh settings from env on every test (prevents stale caches)."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings():
    """Settings configured for demo mode — no proprietary paths required."""
    # Ensure no stale live-mode env leaks in.
    os.environ.pop("MARKET_DUCKDB_PATH", None)
    os.environ.pop("MARKET_MODEL_RESULTS_DIR", None)
    os.environ.pop("MARKET_HISTORICAL_FEATURES_PATH", None)
    os.environ.pop("BIRDCURVE_DUCKDB_PATH", None)
    os.environ.pop("BIRDCURVE_MODEL_RESULTS_DIR", None)
    os.environ.pop("BIRDCURVE_HISTORICAL_FEATURES_PATH", None)
    get_settings.cache_clear()
    return get_settings()
