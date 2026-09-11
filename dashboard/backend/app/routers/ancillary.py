"""Ancillary services: aFRR/FCR capacity prices, volumes, revenue."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

from ..downsampling import lttb_by_index
from ._helpers import (
    add_cache_headers,
    end_exclusive,
    get_engine_and_dir,
    iso_utc,
    nan_to_none as _safe,
    today_iso,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ancillary", tags=["ancillary"])



def _get_capacity_sync(engine, scenario: str | None, start: str, end: str, max_points: int):
    """Historical capacity prices/volumes from DuckDB ts_4hourly first;
    forecast CSV only fills in dates beyond the last historical point.

    Why both: ts_4hourly carries actual cleared market data going back to
    when each market started (FCR earlier, aFRR later). The forecast
    file mixes actuals and predictions on the same axis, so historical
    queries shouldn't depend on which scenario the user has selected.
    """
    # 1. Historical leg from DuckDB. FCR lives in dedicated symmetric_*
    # columns (the product clears one price for both directions); the legacy
    # FCR_capacity_*__Up/__Down columns held mislabeled aFRR data and are
    # ignored. Older DB files may predate the symmetric columns, so probe
    # for them and degrade to NULL FCR rather than a binder error.
    have_fcr = {
        r["column_name"]
        for r in engine.query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'ts_4hourly' AND column_name LIKE 'FCR_capacity_%__symmetric%'"
        )
    }
    fcr_price_sql = (
        '"FCR_capacity_price__symmetric_4h"'
        if "FCR_capacity_price__symmetric_4h" in have_fcr
        else "NULL"
    )
    fcr_vol_sql = (
        '"FCR_capacity_volume__symmetric_MW"'
        if "FCR_capacity_volume__symmetric_MW" in have_fcr
        else "NULL"
    )
    hist_rows = engine.query(
        f'''
        SELECT timestamp_utc                  AS dt,
               "aFRR_capacity_price__Up"      AS afrr_cap_up,
               "aFRR_capacity_price__Down"    AS afrr_cap_down,
               {fcr_price_sql}                AS fcr_price,
               "aFRR_capacity_volume__Up"     AS afrr_vol_up,
               "aFRR_capacity_volume__Down"   AS afrr_vol_down,
               {fcr_vol_sql}                  AS fcr_vol
        FROM ts_4hourly
        WHERE timestamp_utc >= ? AND timestamp_utc < ?
        ORDER BY timestamp_utc
        ''',
        [start, end_exclusive(end)],
    )

    capacity_keys = (
        "afrr_cap_up", "afrr_cap_down", "fcr_price",
        "afrr_vol_up", "afrr_vol_down", "fcr_vol",
    )

    result: list[dict] = []
    seen_dts: set[str] = set()
    latest_hist_dt: str | None = None

    for r in hist_rows:
        if all(_safe(r[k]) is None for k in capacity_keys):
            continue
        dt_str = iso_utc(r["dt"])
        seen_dts.add(dt_str)
        latest_hist_dt = dt_str
        result.append({
            "datetime": dt_str,
            "block": None,  # ts_4hourly doesn't carry the auction-block label
            "afrr_cap_up": _safe(r["afrr_cap_up"]),
            "afrr_cap_down": _safe(r["afrr_cap_down"]),
            # FCR is symmetric in Germany: one clearing price and one procured
            # volume covering both directions.
            "fcr_cap_price": _safe(r["fcr_price"]),
            "afrr_vol_up": _safe(r["afrr_vol_up"]),
            "afrr_vol_down": _safe(r["afrr_vol_down"]),
            "fcr_vol": _safe(r["fcr_vol"]),
            "data_source": "historical",
        })

    # 2. Forecast tail beyond the last historical timestamp (if a scenario is
    #    selected and the requested range extends past the historical data).
    #
    # The forecast file has historically been on a different scale than
    # ts_4hourly (we observed ~16x for aFRR cap, ~10x for FCR cap — looks
    # like EUR/MW for a longer block vs EUR/MW/h). Rather than hardcode a
    # scale, we fetch the full requested range from the forecast file and
    # compute per-metric scale factors from the overlap with the DuckDB
    # historical period: scale = median(forecast_value / duckdb_value)
    # over matched (date, metric) pairs. We then divide the forecast-tail
    # values by that scale before stitching them in. Self-correcting: if
    # upstream fixes the unit mismatch, the median ratio collapses to ~1
    # and this becomes a no-op.
    forecast_pivot = (latest_hist_dt or start)[:10]
    if scenario and forecast_pivot < end:
        try:
            forecast_data = engine.query_forecast_file(
                scenario,
                "predictions_aFRR_FCR_capacity_4h_2023_2050",
                start, end_exclusive(end),  # full range, so we can compute the scale
                datetime_col="datetime",
            )
        except Exception:
            forecast_data = []

        # Build a date → first-non-null lookup from DuckDB historical.
        hist_lookup: dict[str, dict] = {}
        for r in result:  # `result` so far holds only DuckDB historical rows
            hist_lookup.setdefault(r["datetime"][:10], r)

        # Collect ratios per metric from overlap.
        from statistics import median
        metric_keys = ("afrr_cap_up", "afrr_cap_down", "fcr_cap_price")
        ratios: dict[str, list[float]] = {k: [] for k in metric_keys}

        forecast_metric_map = {
            "afrr_cap_up":   "aFRR_cap_up",
            "afrr_cap_down": "aFRR_cap_down",
            "fcr_cap_price": "FCR_cap_price",
        }

        for d in forecast_data:
            dt_str = iso_utc(d.get("datetime", ""))
            day = dt_str[:10]
            hist = hist_lookup.get(day)
            if not hist:
                continue
            for our_key, csv_key in forecast_metric_map.items():
                fv = _safe(d.get(csv_key))
                hv = hist.get(our_key)
                if fv is None or hv is None or hv == 0:
                    continue
                ratios[our_key].append(fv / hv)

        scales = {}
        for k, vs in ratios.items():
            if len(vs) >= 4:
                scales[k] = median(vs)
            else:
                scales[k] = 1.0
                logger.warning(
                    "ancillary capacity scale ratio unreliable for %s: only %d overlap points, defaulting to 1.0",
                    k, len(vs),
                )

        # Apply the inverse scale to forecast values past the pivot.
        for d in forecast_data:
            dt_str = iso_utc(d.get("datetime", ""))
            if not dt_str or dt_str in seen_dts or dt_str[:10] <= forecast_pivot:
                continue
            seen_dts.add(dt_str)

            def _scaled(our_key: str, csv_key: str):
                v = _safe(d.get(csv_key))
                if v is None:
                    return None
                s = scales.get(our_key, 1.0)
                return v / s if s else v

            result.append({
                "datetime": dt_str,
                "block": _safe(d.get("block")),
                "afrr_cap_up":   _scaled("afrr_cap_up",   "aFRR_cap_up"),
                "afrr_cap_down": _scaled("afrr_cap_down", "aFRR_cap_down"),
                "fcr_cap_price": _scaled("fcr_cap_price", "FCR_cap_price"),
                # Volumes have always been ~1:1, no scaling.
                "afrr_vol_up":   _safe(d.get("aFRR_vol_up")),
                "afrr_vol_down": _safe(d.get("aFRR_vol_down")),
                "fcr_vol":       _safe(d.get("FCR_vol")),
                "data_source":   "forecast",
            })

    result.sort(key=lambda r: r["datetime"])
    result = lttb_by_index(result, "afrr_cap_up", max_points)

    return {
        "datetime":      [r["datetime"]      for r in result],
        "afrr_cap_up":   [r["afrr_cap_up"]   for r in result],
        "afrr_cap_down": [r["afrr_cap_down"] for r in result],
        "fcr_cap_price": [r["fcr_cap_price"] for r in result],
        "afrr_vol_up":   [r["afrr_vol_up"]   for r in result],
        "afrr_vol_down": [r["afrr_vol_down"] for r in result],
        "fcr_vol":       [r["fcr_vol"]       for r in result],
        "data_source":   [r["data_source"]   for r in result],
    }


@router.get("/capacity")
async def get_capacity(
    request: Request,
    response: Response,
    start: str = Query(...),
    end: str = Query(...),
    scenario: str | None = Query(None, description="Optional — only used to fill in dates beyond the historical record"),
    max_points: int = Query(5000, ge=10, le=50000),
):
    # Engine is always available; only resolve fdir when a scenario is named.
    engine = request.app.state.engine
    if scenario:
        # Validate the scenario name (raises 404 for unknown ones) but ignore
        # the path return — the sync helper goes through query_forecast_file.
        get_engine_and_dir(request, scenario)
    payload = await run_in_threadpool(
        _get_capacity_sync, engine, scenario, start, end, max_points
    )
    add_cache_headers(response, end, today_iso())
    return payload


def _get_imbalance_prices_sync(engine, start: str, end: str, max_points: int):
    """15-minute aFRR energy and imbalance prices from ts_15min.

    Source-of-truth historical-only — no scenario, no forecast tail.
    These signals are what the German TSOs (50Hertz, Amprion, TenneT DE,
    TransnetBW) publish after each settlement period.
    """
    rows = engine.query(
        '''
        SELECT timestamp_utc                              AS dt,
               "DE_Imbalance__Price_aFRR_energy_up"       AS afrr_energy_up,
               "DE_Imbalance__Price_aFRR_energy_down"     AS afrr_energy_down,
               "DE_Imbalance__Price_imb_long"             AS imb_long,
               "DE_Imbalance__Price_imb_short"            AS imb_short
        FROM ts_15min
        WHERE timestamp_utc >= ? AND timestamp_utc < ?
        ORDER BY timestamp_utc
        ''',
        [start, end_exclusive(end)],
    )

    keys = ("afrr_energy_up", "afrr_energy_down", "imb_long", "imb_short")
    series = []
    for r in rows:
        if all(_safe(r[k]) is None for k in keys):
            continue
        series.append({
            "timestamp": iso_utc(r["dt"]),
            "afrr_energy_up":   _safe(r["afrr_energy_up"]),
            "afrr_energy_down": _safe(r["afrr_energy_down"]),
            "imb_long":         _safe(r["imb_long"]),
            "imb_short":        _safe(r["imb_short"]),
        })

    # Server-side LTTB downsample on the most-likely-non-null field.
    if len(series) > max_points:
        for d in series:
            d["_y"] = d["imb_short"] if d["imb_short"] is not None else (d["imb_long"] or 0.0)
        series = lttb_by_index(series, "_y", max_points)
        for d in series:
            d.pop("_y", None)

    return {
        "timestamp":        [r["timestamp"]        for r in series],
        "afrr_energy_up":   [r["afrr_energy_up"]   for r in series],
        "afrr_energy_down": [r["afrr_energy_down"] for r in series],
        "imb_long":         [r["imb_long"]         for r in series],
        "imb_short":        [r["imb_short"]        for r in series],
    }


@router.get("/imbalance-prices")
async def get_imbalance_prices(
    request: Request,
    response: Response,
    start: str = Query(...),
    end: str = Query(...),
    max_points: int = Query(8000, ge=10, le=50000),
):
    """aFRR energy + imbalance long/short prices at 15-min granularity from ts_15min."""
    engine = request.app.state.engine
    payload = await run_in_threadpool(
        _get_imbalance_prices_sync, engine, start, end, max_points
    )
    add_cache_headers(response, end, today_iso())
    return payload


@router.get("/revenue")
async def get_revenue(
    request: Request,
    scenario: str = Query(...),
):
    # Reuse the annual-stats sync loader directly — avoids the async-handler
    # signature coupling and keeps the file read on the threadpool.
    from .forecast import _get_annual_stats_sync
    _engine, fdir = get_engine_and_dir(request, scenario)
    stats = await run_in_threadpool(_get_annual_stats_sync, fdir)

    return {
        "years": stats.get("years", []),
        "afrr_cap_revenue": stats.get("afrr_cap_rev", []),
        "fcr_cap_revenue": stats.get("fcr_cap_rev", []),
        "afrr_energy_revenue": stats.get("bess_afrr", []),
    }


def _get_regulation_states_sync(engine, scenario: str, year: int):
    start = f"{year}-01-01"
    # Already an exclusive bound: the year+1 midnight row belongs to year+1.
    end = f"{year + 1}-01-01"

    data = engine.query_forecast_file(
        scenario,
        "predictions_DA_ID3_Imb_aFRR_FCR_quarterly_2023_2050",
        start, end,
        datetime_col="Datetime_UTC",
    )

    if not data:
        return {"states": [], "year": year, "total_intervals": 0}

    state_counts: dict[int, int] = {}
    total = 0
    for d in data:
        raw = d.get("Regulation_State")
        if raw is None:
            continue
        try:
            state = int(raw)
        except (TypeError, ValueError):
            continue
        state_counts[state] = state_counts.get(state, 0) + 1
        total += 1

    state_labels = {-1: "Down regulation", 0: "No regulation", 1: "Up regulation", 2: "Mixed"}
    states = []
    for state_val in sorted(state_counts.keys()):
        states.append({
            "state": state_val,
            "label": state_labels.get(state_val, f"State {state_val}"),
            "count": state_counts[state_val],
            "percentage": round(100 * state_counts[state_val] / total, 1),
        })

    return {"states": states, "year": year, "total_intervals": total}


@router.get("/regulation-states")
async def get_regulation_states(
    request: Request,
    year: int = Query(...),
    scenario: str = Query(...),
):
    engine, _fdir = get_engine_and_dir(request, scenario)
    return await run_in_threadpool(_get_regulation_states_sync, engine, scenario, year)
