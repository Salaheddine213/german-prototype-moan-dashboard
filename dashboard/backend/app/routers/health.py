"""Health check endpoint."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from ..models import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

# All tables the dashboard reads from — including ts_4hourly (ancillary
# capacity) and provenance (data-status), so health can't look green while
# either of those is empty or missing.
_HEALTH_TABLES = ["ts_15min", "ts_hourly", "ts_4hourly", "ts_daily", "provenance"]


def _health_sync(engine) -> HealthResponse:
    table_counts = {}
    for table in _HEALTH_TABLES:
        try:
            rows = engine.query(f"SELECT COUNT(*) as n FROM {table}")
            table_counts[table] = rows[0]["n"] if rows else 0
        except Exception:
            logger.warning("health check: table %s not readable", table, exc_info=True)
            table_counts[table] = 0

    prod = engine.latest_production_model
    scenarios = engine.available_scenarios
    first_scenario = scenarios[0] if scenarios else None
    forecast = engine.forecast_dir(first_scenario) if first_scenario else None

    data_mode = "demo" if engine.demo_mode else "live"

    return HealthResponse(
        status="ok",
        data_mode=data_mode,
        data_loaded=prod is not None or data_mode == "demo",
        last_model=prod.name if prod else None,
        last_forecast=forecast.name if forecast else None,
        scenarios=scenarios,
        db_tables=table_counts,
    )


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request) -> HealthResponse:
    engine = getattr(request.app.state, "engine", None)
    if engine is None:
        raise HTTPException(503, "Engine not yet initialized")
    return await run_in_threadpool(_health_sync, engine)