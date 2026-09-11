"""Scenario tech assumptions and capacity data."""
from __future__ import annotations

import csv

from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.concurrency import run_in_threadpool

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


def _int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _float(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@router.get("/list")
async def list_scenarios(request: Request):
    engine = request.app.state.engine
    return {"scenarios": engine.available_scenarios}


def _get_scenario_sync(fdir, scenario: str):
    csv_files = list(fdir.glob("BirdSystem_Futures_*.csv"))
    if not csv_files:
        raise HTTPException(404, f"No BirdSystem_Futures CSV in {fdir.name}")

    rows = []
    with open(csv_files[0]) as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    # Filter rows missing a valid Year (blank rows at end of CSV are common).
    rows = [r for r in rows if r.get("Year", "").strip()]

    return {
        "years": [_int(r["Year"]) for r in rows],
        "scenario": rows[0].get("Scenario", scenario) if rows else scenario,
        "solar_pv_gw": [_float(r.get("Solar PV")) for r in rows],
        "wind_on_gw": [_float(r.get("Wind On")) for r in rows],
        "wind_off_gw": [_float(r.get("Wind Off")) for r in rows],
        "bess_gw": [_float(r.get("BESS GW")) for r in rows],
        "bess_gwh": [_float(r.get("BESS GWh")) for r in rows],
        "gas_price": [_float(r.get("Gas TTF")) for r in rows],
        "co2_price": [_float(r.get("EUA CO2")) for r in rows],
        "demand_twh": [_float(r.get("TWh/y")) for r in rows],
        "power_base": [_float(r.get("Power Base")) for r in rows],
        "must_run": [_float(r.get("Must-Run")) for r in rows],
        "nuclear": [_float(r.get("Nuclear")) for r in rows],
    }


@router.get("")
async def get_scenario(
    request: Request,
    scenario: str = Query(..., description="Scenario key, e.g. 'v17_Central'"),
):
    engine = request.app.state.engine
    fdir = engine.forecast_dir(scenario)
    if fdir is None:
        available = engine.available_scenarios
        raise HTTPException(404, f"Scenario '{scenario}' not available. Available: {available}")

    return await run_in_threadpool(_get_scenario_sync, fdir, scenario)
