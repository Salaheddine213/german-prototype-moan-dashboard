"""Historical electricity (DE): DA prices, load, renewables, duration curve, heatmap."""
from __future__ import annotations

import math

from fastapi import APIRouter, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

from ..downsampling import lttb_by_index, lttb_downsample
from ._helpers import add_cache_headers, auto_resolution, end_exclusive, iso_utc, today_iso

router = APIRouter(prefix="/electricity", tags=["electricity"])


def _year_end_iso(year: int) -> str:
    """Last day of the queried year, as ISO date — used for cache freshness."""
    return f"{year}-12-31"

# Conventional thresholds for duration-curve hour counts (EUR/MWh).
_NEGATIVE_PRICE_THRESHOLD = 0.0
_PEAK_PRICE_THRESHOLD = 200.0

# MW -> GW for supply series.
_MW_TO_GW = 1000.0

_RESOLUTION_BUCKETS = {
    "15min": "time_bucket(INTERVAL '15 minutes', timestamp_utc)",
    "hourly": "date_trunc('hour', timestamp_utc)",
    "daily": "date_trunc('day', timestamp_utc)",
}

# ts_hourly has been polluted with 15-min-aligned rows in some upstream
# exports; filter to :00 minutes to keep counts and hourly aggregates honest.
_TS_HOURLY_HOURLY = 'EXTRACT(MINUTE FROM timestamp_utc) = 0'


def _is_missing(value) -> bool:
    if value is None:
        return True
    try:
        return math.isnan(value)
    except TypeError:
        return False


def _to_gw(value):
    return None if _is_missing(value) else round(value / _MW_TO_GW, 3)


def _get_historical_sync(engine, start: str, end: str, max_points: int, resolution: str) -> dict:
    bucket = _RESOLUTION_BUCKETS[resolution]

    da_sql = f"""
        SELECT {bucket} AS bucket,
               AVG("DE_DA__DA_Price") AS value
        FROM ts_hourly
        WHERE timestamp_utc >= ? AND timestamp_utc < ?
          AND "DE_DA__DA_Price" IS NOT NULL
          AND {_TS_HOURLY_HOURLY}
        GROUP BY 1
        ORDER BY 1
    """
    da_rows = engine.query(da_sql, [start, end_exclusive(end)])
    da_series = [
        {"timestamp": iso_utc(r["bucket"]), "value": r["value"]}
        for r in da_rows
        if not _is_missing(r["value"])
    ]

    supply_sql = f"""
        SELECT
            {bucket}                                      AS bucket,
            AVG("DE_Load__Total_Load_MW")                AS load,
            AVG("DE_Solar__Generation_MW")               AS pv,
            AVG("DE_Wind_Onshore__Generation_MW")        AS wind_onshore,
            AVG("DE_Wind_Offshore__Generation_MW")       AS wind_offshore,
            AVG("DE_CrossBorder__Net_Exchange_MW")       AS exchange
        FROM ts_15min
        WHERE timestamp_utc >= ? AND timestamp_utc < ?
        GROUP BY 1
        ORDER BY 1
    """
    supply_rows = engine.query(supply_sql, [start, end_exclusive(end)])

    supply_series = [
        {
            "timestamp":     iso_utc(r["bucket"]),
            "load":          _to_gw(r["load"]),
            "pv":            _to_gw(r["pv"]),
            "wind_onshore":  _to_gw(r["wind_onshore"]),
            "wind_offshore": _to_gw(r["wind_offshore"]),
            "exchange":      _to_gw(r["exchange"]),
        }
        for r in supply_rows
    ]

    da_series = lttb_by_index(da_series, "value", max_points)

    return {
        "da_prices": da_series,
        "supply": supply_series,
    }


@router.get("/historical")
async def get_historical(
    request: Request,
    response: Response,
    start: str = Query(...),
    end: str = Query(...),
    max_points: int = Query(5000, ge=10, le=50000),
    resolution: str = Query("auto", pattern="^(auto|15min|hourly|daily)$"),
):
    engine = request.app.state.engine
    if resolution == "auto":
        resolution = auto_resolution(start, end)
    payload = await run_in_threadpool(
        _get_historical_sync, engine, start, end, max_points, resolution
    )
    add_cache_headers(response, end, today_iso())
    return payload


def _get_duration_curve_sync(engine, year: int) -> dict:
    sql = f"""
        SELECT "DE_DA__DA_Price" AS value
        FROM ts_hourly
        WHERE timestamp_utc >= ? AND timestamp_utc < ?
          AND "DE_DA__DA_Price" IS NOT NULL
          AND {_TS_HOURLY_HOURLY}
        ORDER BY value DESC
    """
    start = f"{year}-01-01"
    end = f"{year + 1}-01-01"
    rows = engine.query(sql, [start, end])
    prices = [r["value"] for r in rows]

    negative_hours = sum(1 for p in prices if p < _NEGATIVE_PRICE_THRESHOLD)
    peak_hours = sum(1 for p in prices if p > _PEAK_PRICE_THRESHOLD)

    return {
        "sorted_prices": prices,
        "negative_hours": negative_hours,
        "peak_hours": peak_hours,
        "total_hours": len(prices),
    }


@router.get("/duration-curve")
async def get_duration_curve(
    request: Request,
    response: Response,
    year: int = Query(...),
):
    engine = request.app.state.engine
    payload = await run_in_threadpool(_get_duration_curve_sync, engine, year)
    add_cache_headers(response, _year_end_iso(year), today_iso())
    return payload


def _get_duration_curves_sync(engine, max_points_per_year: int, min_hours: int) -> dict:
    sql = f"""
        SELECT EXTRACT(YEAR FROM timestamp_utc)::INT AS year,
               "DE_DA__DA_Price" AS value
        FROM ts_hourly
        WHERE "DE_DA__DA_Price" IS NOT NULL
          AND {_TS_HOURLY_HOURLY}
    """
    rows = engine.query(sql)

    by_year: dict[int, list[float]] = {}
    for r in rows:
        by_year.setdefault(r["year"], []).append(r["value"])

    by_year = {y: p for y, p in by_year.items() if len(p) >= min_hours}

    curves: dict[str, list[list[float]]] = {}
    stats: dict[str, dict] = {}
    for year, prices in by_year.items():
        prices.sort(reverse=True)
        n = len(prices)
        denom = max(n - 1, 1)

        if n <= max_points_per_year:
            curves[str(year)] = [
                [round(i / denom * 100, 3), round(prices[i], 2)] for i in range(n)
            ]
        else:
            data = [{"x": i, "y": v} for i, v in enumerate(prices)]
            sampled = lttb_downsample(data, x_key="x", y_key="y", max_points=max_points_per_year)
            curves[str(year)] = [
                [round(d["x"] / denom * 100, 3), round(d["y"], 2)] for d in sampled
            ]

        stats[str(year)] = {
            "total_hours": n,
            "negative_hours": sum(1 for p in prices if p < _NEGATIVE_PRICE_THRESHOLD),
            "peak_hours": sum(1 for p in prices if p > _PEAK_PRICE_THRESHOLD),
        }

    years_sorted = sorted(by_year.keys())
    return {"years": years_sorted, "curves": curves, "stats": stats}


@router.get("/duration-curves")
async def get_duration_curves(
    request: Request,
    response: Response,
    max_points_per_year: int = Query(500, ge=50, le=5000),
    min_hours: int = Query(720, ge=1, description="Drop years with fewer hours than this (default: ~1 month)"),
):
    """All historical years as separate price-duration curves."""
    engine = request.app.state.engine
    payload = await run_in_threadpool(
        _get_duration_curves_sync, engine, max_points_per_year, min_hours
    )
    years = payload["years"]
    cache_anchor = _year_end_iso(years[-1]) if years else today_iso()
    add_cache_headers(response, cache_anchor, today_iso())
    return payload


def _get_heatmap_sync(engine, year: int) -> dict:
    sql = f"""
        SELECT
            EXTRACT(month FROM timestamp_utc) AS month,
            EXTRACT(hour  FROM timestamp_utc) AS hour,
            AVG("DE_DA__DA_Price")            AS avg_price
        FROM ts_hourly
        WHERE timestamp_utc >= ? AND timestamp_utc < ?
          AND "DE_DA__DA_Price" IS NOT NULL
          AND {_TS_HOURLY_HOURLY}
        GROUP BY 1, 2
        ORDER BY 1, 2
    """
    start = f"{year}-01-01"
    end = f"{year + 1}-01-01"
    rows = engine.query(sql, [start, end])

    matrix: list[list[float | None]] = [[None] * 12 for _ in range(24)]
    for r in rows:
        h = int(r["hour"])
        m = int(r["month"]) - 1
        if 0 <= h < 24 and 0 <= m < 12:
            matrix[h][m] = round(r["avg_price"], 1)

    return {
        "hours": list(range(24)),
        "months": list(range(1, 13)),
        "values": matrix,
    }


@router.get("/heatmap")
async def get_heatmap(
    request: Request,
    response: Response,
    year: int = Query(...),
):
    engine = request.app.state.engine
    payload = await run_in_threadpool(_get_heatmap_sync, engine, year)
    add_cache_headers(response, _year_end_iso(year), today_iso())
    return payload