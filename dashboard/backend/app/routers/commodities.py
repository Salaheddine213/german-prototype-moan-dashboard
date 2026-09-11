"""Commodity prices: Gas TTF, CO2 EUA, Coal API2, EUR/USD, marginal costs.

German electricity generation is heavily gas- and coal-fired at the margin, so
fuel + carbon prices dominate wholesale DA prices. This router surfaces the
commodity legs and the resulting CCGT / hard-coal marginal costs (EUR/MWh_e).
"""
from __future__ import annotations

import bisect

from fastapi import APIRouter, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

from ..downsampling import lttb_by_index
from ._helpers import add_cache_headers, end_exclusive, today_iso

router = APIRouter(prefix="/commodities", tags=["commodities"])

# Wide-format ts_daily columns. Coal_API2 and EUR_USD are not in the live
# DuckDB ts_daily table — they come from sidecar CSVs registered by the
# engine at startup (see blocks below); the page degrades gracefully to
# empty arrays when a sidecar is absent.
COMMODITY_COLUMNS = {
    "gas_ttf": "Gas_TTF__price",
    "co2_eua": "CO2_EUA__price",
}

# Gas (CCGT) marginal cost.
#
# Mind the HHV vs LHV gap: TTF (and most EU gas markets) is priced per
# MWh_HHV (gross calorific value), but plant efficiencies are reported on
# the LHV basis (net calorific value, EU convention). For H-gas the ratio
# HHV/LHV ≈ 1.108 — skipping this conversion under-states CCGT marginal
# cost by ~10 %.
#
# IPCC default natural gas combustion factor (56.1 kg CO2/GJ_NCV) is
# already LHV-basis, so 0.202 tCO2/MWh_LHV stays as the canonical number.
#
# Final formula: (gas_HHV * HHV/LHV + co2 * emissions_LHV) / efficiency_LHV
#
# At η=0.58, TTF=50, CO2=70 → (50*1.108 + 70*0.202)/0.58 ≈ 119 EUR/MWh_e.
_GAS_EFFICIENCY_LHV = 0.58  # modern CCGT (Irsching 4, Emsland, Dörpen class)
_HHV_OVER_LHV_NATURAL_GAS = 1.108  # H-gas mix (EU standard; pure CH4 is ~1.109)
_GAS_EMISSIONS_T_PER_MWH_LHV = 0.202  # IPCC 2006 NCV factor for natural gas

# Coal marginal cost: (Coal_USD_ton / 6.978 + CO2 * 0.335) / 0.46
# 6.978 ≈ MWh per ton at 25.12 GJ/ton LHV (3.6 GJ/MWh → 6.978 MWh/ton).
# 0.335 tCO2/MWh_th is the standard thermal-coal emissions factor.
# 0.46 is a typical hard-coal plant efficiency.
# Note: coal price is in USD; the simplification treats USD≈EUR for this
# headline metric. Use the EUR/USD series client-side for currency-exact work.
_COAL_MWH_PER_TON = 6.978
_COAL_EMISSIONS_T_PER_MWH = 0.335
_COAL_EFFICIENCY = 0.46


def _date_str(ts) -> str:
    """Convert pandas.Timestamp/datetime/str into 'YYYY-MM-DD'."""
    return str(ts)[:10]


def _ffill_lookup(dates: list[str], values: list[float], date_key: str) -> float | None:
    """Most recent value at or before date_key, or None if none exists.

    `dates` must be sorted ascending ISO date strings.
    """
    idx = bisect.bisect_right(dates, date_key)
    return values[idx - 1] if idx > 0 else None


def _co2_settles(engine, end: str) -> tuple[list[str], list[float]]:
    """All CO2 settle (date, value) pairs up to and including `end`, ascending.

    Queried without a start bound so forward-filling works even when the
    last CO2 settle predates the requested window: CO2 ingestion can lag
    gas by weeks, and requiring same-date CO2 would zero out the marginal
    series (and KPIs) for the whole window.
    """
    co2_col = COMMODITY_COLUMNS["co2_eua"]
    dates: list[str] = []
    values: list[float] = []
    for r in engine.query(
        f'SELECT timestamp_utc, "{co2_col}" AS value FROM ts_daily '
        f'WHERE "{co2_col}" IS NOT NULL AND NOT isnan("{co2_col}") '
        'AND timestamp_utc < ? ORDER BY timestamp_utc',
        [end_exclusive(end)],
    ):
        dates.append(_date_str(r["timestamp_utc"]))
        values.append(r["value"])
    return dates, values


def _gas_marginal_eur_mwh(gas: float, co2: float) -> float:
    """CCGT marginal cost: HHV→LHV-converted gas plus CO2, over LHV efficiency."""
    return (gas * _HHV_OVER_LHV_NATURAL_GAS + co2 * _GAS_EMISSIONS_T_PER_MWH_LHV) / _GAS_EFFICIENCY_LHV


def _coal_eur_mwh_th(coal_usd_ton: float, usd_per_eur: float) -> float:
    """Coal in thermal-energy terms: USD/ton → EUR/MWh_th at 6.978 MWh/ton LHV."""
    return coal_usd_ton / _COAL_MWH_PER_TON / usd_per_eur


def _coal_marginal_eur_mwh(coal_usd_ton: float, co2: float, usd_per_eur: float) -> float:
    """Hard-coal marginal cost, coal converted USD/ton → EUR/MWh_th first."""
    return (_coal_eur_mwh_th(coal_usd_ton, usd_per_eur)
            + co2 * _COAL_EMISSIONS_T_PER_MWH) / _COAL_EFFICIENCY


def _fx_settles(engine, end: str) -> tuple[list[str], list[float]]:
    """All EUR/USD (date, rate) pairs up to and including `end`, ascending.

    Unbounded at the start so forward-filling covers dates before the
    requested window's first rate. Empty when the sidecar is absent.
    """
    dates: list[str] = []
    rates: list[float] = []
    if engine.has_eur_usd:
        for r in engine.query(
            'SELECT date, USD_per_EUR FROM eur_usd '
            'WHERE date <= ? AND USD_per_EUR IS NOT NULL '
            'ORDER BY date',
            [end],
        ):
            dates.append(_date_str(r["date"]))
            rates.append(r["USD_per_EUR"])
    return dates, rates


def _get_commodities_sync(
    engine, start: str, end: str, include_marginal: bool, max_points: int,
) -> dict[str, list[dict]]:
    rows = engine.query_wide(
        "ts_daily", list(COMMODITY_COLUMNS.values()), start, end_exclusive(end)
    )

    result: dict[str, list[dict]] = {}
    for key, col in COMMODITY_COLUMNS.items():
        series = [
            {"date": _date_str(row["timestamp_utc"]), "value": row[col]}
            for row in rows
            if row[col] is not None
        ]
        result[key] = lttb_by_index(series, "value", max_points)

    # EUR/USD comes from a sidecar CSV registered by the engine at startup.
    # Its `date` column is a DATE, so `<=` with a bare date is inclusive.
    if engine.has_eur_usd:
        eur_usd_rows = engine.query(
            'SELECT date, USD_per_EUR FROM eur_usd '
            'WHERE date >= ? AND date <= ? '
            'ORDER BY date',
            [start, end],
        )
        eur_usd_series = [
            {"date": _date_str(r["date"]), "value": r["USD_per_EUR"]}
            for r in eur_usd_rows
            if r["USD_per_EUR"] is not None
        ]
        result["eur_usd"] = lttb_by_index(eur_usd_series, "value", max_points)
    else:
        result["eur_usd"] = []

    # Coal API2 (Rotterdam coal futures) — same sidecar pattern as EUR/USD.
    # Served in both quote terms (USD/ton) and thermal-energy terms
    # (EUR/MWh_th via the forward-filled daily FX rate), so coal is directly
    # comparable with Gas TTF on the chart.
    if engine.has_coal_api2:
        coal_rows = engine.query(
            'SELECT date, price_USD_ton FROM coal_api2 '
            'WHERE date >= ? AND date <= ? '
            'ORDER BY date',
            [start, end],
        )
        coal_series = [
            {"date": _date_str(r["date"]), "value": r["price_USD_ton"]}
            for r in coal_rows
            if r["price_USD_ton"] is not None
        ]
        fx_dates, fx_rates = _fx_settles(engine, end)
        coal_thermal = [
            {"date": p["date"],
             "value": _coal_eur_mwh_th(p["value"], _ffill_lookup(fx_dates, fx_rates, p["date"]) or 1.0)}
            for p in coal_series
        ]
        result["coal_api2"] = lttb_by_index(coal_series, "value", max_points)
        result["coal_eur_mwh"] = lttb_by_index(coal_thermal, "value", max_points)
    else:
        result["coal_api2"] = []
        result["coal_eur_mwh"] = []

    if include_marginal:
        gas_col = COMMODITY_COLUMNS["gas_ttf"]
        # CO2 is forward-filled from its most recent settle (last-settle
        # convention, same as the EUR/USD fill below): requiring a same-date
        # CO2 value made both marginal series vanish whenever CO2 ingestion
        # lagged the gas feed.
        co2_dates, co2_values = _co2_settles(engine, end)

        gas_marginal = []
        for row in rows:
            gas = row[gas_col]
            if gas is None:
                continue
            date_key = _date_str(row["timestamp_utc"])
            co2 = _ffill_lookup(co2_dates, co2_values, date_key)
            if co2 is None:
                continue
            gas_marginal.append({
                "date": date_key,
                "value": _gas_marginal_eur_mwh(gas, co2),
            })
        result["gas_marginal"] = lttb_by_index(gas_marginal, "value", max_points)

        # Coal marginal — joins ts_daily gas/CO2 dates against the coal sidecar.
        # Coal is in USD/ton; convert to EUR using the daily EUR/USD rate so
        # the result is currency-correct (without it, a 1.18 EUR/USD makes
        # coal_marginal ~15% too high). Forward-fill missing FX days from
        # the most recent known rate.
        if engine.has_coal_api2:
            coal_lookup = {
                _date_str(r["date"]): r["price_USD_ton"]
                for r in engine.query(
                    'SELECT date, price_USD_ton FROM coal_api2 '
                    'WHERE date >= ? AND date <= ? '
                    'AND price_USD_ton IS NOT NULL',
                    [start, end],
                )
            }
            fx_dates, fx_rates = _fx_settles(engine, end)

            coal_marginal = []
            for row in rows:
                date_key = _date_str(row["timestamp_utc"])
                coal = coal_lookup.get(date_key)
                co2 = _ffill_lookup(co2_dates, co2_values, date_key)
                if coal is None or co2 is None:
                    continue
                # Forward-fill EUR/USD: most recent rate at or before date.
                # Fallback 1.0 (i.e. USD-as-EUR) when no FX data is loaded
                # — preserves the legacy behaviour for repos without the CSV.
                usd_per_eur = _ffill_lookup(fx_dates, fx_rates, date_key) or 1.0
                coal_marginal.append({
                    "date": date_key,
                    "value": _coal_marginal_eur_mwh(coal, co2, usd_per_eur),
                })
            result["coal_marginal"] = lttb_by_index(coal_marginal, "value", max_points)
        else:
            result["coal_marginal"] = []

    return result


@router.get("")
async def get_commodities(
    request: Request,
    response: Response,
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    include_marginal: bool = Query(False),
    max_points: int = Query(5000, ge=10, le=50000),
):
    engine = request.app.state.engine
    result = await run_in_threadpool(
        _get_commodities_sync, engine, start, end, include_marginal, max_points
    )
    add_cache_headers(response, end, today_iso())
    return result


def _get_commodity_kpis_sync(engine) -> dict:
    kpis: dict = {}
    # (date, value) of the latest two settles per series, newest first —
    # kept for the derived marginal-cost KPIs below.
    settles: dict[str, list[tuple[str, float]]] = {}

    for key, col in COMMODITY_COLUMNS.items():
        # NOT isnan: a float NaN passes `IS NOT NULL` in DuckDB but becomes
        # None after JSON sanitising, and `latest - prev` on None would 500.
        sql = f'''
            SELECT timestamp_utc, "{col}" AS value
            FROM ts_daily
            WHERE "{col}" IS NOT NULL AND NOT isnan("{col}")
            ORDER BY timestamp_utc DESC
            LIMIT 2
        '''
        rows = engine.query(sql)
        if not rows:
            continue
        settles[key] = [(_date_str(r["timestamp_utc"]), r["value"]) for r in rows]
        latest = rows[0]["value"]
        prev = rows[1]["value"] if len(rows) >= 2 else None
        kpis[f"{key}_latest"] = latest
        kpis[f"{key}_change"] = round(latest - prev, 2) if prev is not None else 0
        kpis[f"{key}_date"] = settles[key][0][0]

    # EUR/USD KPI from sidecar table when available.
    if engine.has_eur_usd:
        rows = engine.query(
            'SELECT date, USD_per_EUR FROM eur_usd '
            'WHERE USD_per_EUR IS NOT NULL AND NOT isnan(USD_per_EUR) '
            'ORDER BY date DESC LIMIT 2'
        )
        if rows:
            settles["eur_usd"] = [(_date_str(r["date"]), r["USD_per_EUR"]) for r in rows]
            latest = rows[0]["USD_per_EUR"]
            prev = rows[1]["USD_per_EUR"] if len(rows) >= 2 else None
            kpis["eur_usd_latest"] = latest
            kpis["eur_usd_change"] = round(latest - prev, 4) if prev is not None else 0
            kpis["eur_usd_date"] = settles["eur_usd"][0][0]

    # Coal API2 KPI from sidecar table when available.
    if engine.has_coal_api2:
        rows = engine.query(
            'SELECT date, price_USD_ton FROM coal_api2 '
            'WHERE price_USD_ton IS NOT NULL AND NOT isnan(price_USD_ton) '
            'ORDER BY date DESC LIMIT 2'
        )
        if rows:
            settles["coal_api2"] = [(_date_str(r["date"]), r["price_USD_ton"]) for r in rows]
            latest = rows[0]["price_USD_ton"]
            prev = rows[1]["price_USD_ton"] if len(rows) >= 2 else None
            kpis["coal_api2_latest"] = latest
            kpis["coal_api2_change"] = round(latest - prev, 2) if prev is not None else 0
            kpis["coal_api2_date"] = settles["coal_api2"][0][0]

    # Derived KPIs, mirroring the series endpoint: anchored on the fuel's
    # settle dates with CO2 (and FX) forward-filled from their most recent
    # settles. The CO2 card's own staleness badge tells the user how old
    # the filled CO2 leg is.
    co2_dates, co2_values = _co2_settles(engine, today_iso())
    fx_dates, fx_rates = _fx_settles(engine, today_iso())

    # Coal in thermal terms (EUR/MWh_th) — same settles as the USD/ton card.
    coal_th_points = [
        (date, _coal_eur_mwh_th(coal, _ffill_lookup(fx_dates, fx_rates, date) or 1.0))
        for date, coal in settles.get("coal_api2", [])
    ]
    if coal_th_points:
        kpis["coal_eur_mwh_latest"] = round(coal_th_points[0][1], 2)
        kpis["coal_eur_mwh_change"] = (
            round(coal_th_points[0][1] - coal_th_points[1][1], 2) if len(coal_th_points) > 1 else 0
        )
        kpis["coal_eur_mwh_date"] = coal_th_points[0][0]

    gas_points = [
        (date, _gas_marginal_eur_mwh(gas, co2))
        for date, gas in settles.get("gas_ttf", [])
        if (co2 := _ffill_lookup(co2_dates, co2_values, date)) is not None
    ]
    if gas_points:
        kpis["gas_marginal_latest"] = round(gas_points[0][1], 2)
        kpis["gas_marginal_change"] = (
            round(gas_points[0][1] - gas_points[1][1], 2) if len(gas_points) > 1 else 0
        )
        kpis["gas_marginal_date"] = gas_points[0][0]

    coal_points = [
        (date, _coal_marginal_eur_mwh(coal, co2, _ffill_lookup(fx_dates, fx_rates, date) or 1.0))
        for date, coal in settles.get("coal_api2", [])
        if (co2 := _ffill_lookup(co2_dates, co2_values, date)) is not None
    ]
    if coal_points:
        kpis["coal_marginal_latest"] = round(coal_points[0][1], 2)
        kpis["coal_marginal_change"] = (
            round(coal_points[0][1] - coal_points[1][1], 2) if len(coal_points) > 1 else 0
        )
        kpis["coal_marginal_date"] = coal_points[0][0]

    return kpis


@router.get("/kpi")
async def get_commodity_kpis(request: Request, response: Response):
    """Latest non-null value and change vs prior non-null per commodity.

    Per-column query so a stale tail in one series (e.g. days of NULL
    while the source feed lags) doesn't suppress the others.
    """
    engine = request.app.state.engine
    kpis = await run_in_threadpool(_get_commodity_kpis_sync, engine)
    # KPI is always "latest" → short cache.
    response.headers["Cache-Control"] = "public, max-age=300"
    return kpis
