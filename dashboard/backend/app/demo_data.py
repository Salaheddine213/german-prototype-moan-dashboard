"""Synthetic demo data generator for the German electricity-market dashboard.

Creates an in-memory DuckDB database with realistic German market data when no
proprietary DuckDB file is available. Data patterns are based on publicly known
characteristics of the German power market (DE/AT/LU zone on EPEX Spot):

- DA prices: ~30-200 EUR/MWh with seasonal patterns, negative-price hours in
  high-renewable periods, peak hours in winter evenings.
- Load: 40-80 GW with daily/weekly/seasonal patterns matching German demand.
- Renewables: Wind (onshore ~60 GW, offshore ~8 GW), Solar PV (~80 GW installed),
  with realistic capacity factors and profiles.
- Commodities: Gas TTF (20-80 EUR/MWh), CO2 EUA (40-90 EUR/ton).
- Ancillary: aFRR and FCR capacity prices.

All data is clearly synthetic and labelled as such. No proprietary data is used.
"""
from __future__ import annotations

import csv
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from openpyxl import Workbook


def _seed_rng() -> random.Random:
    return random.Random(42)  # reproducible


def _hourly_timestamps(start: str, end: str) -> pd.DatetimeIndex:
    return pd.date_range(start=start, end=end, freq="1h", tz="UTC")


def _quarterly_timestamps(start: str, end: str) -> pd.DatetimeIndex:
    return pd.date_range(start=start, end=end, freq="15min", tz="UTC")


def _daily_timestamps(start: str, end: str) -> pd.DatetimeIndex:
    return pd.date_range(start=start, end=end, freq="1D", tz="UTC")


def generate_da_prices(idx: pd.DatetimeIndex, rng: random.Random) -> np.ndarray:
    """Generate German DA EPEX Spot-like prices (EUR/MWh)."""
    prices = np.zeros(len(idx))
    for i, ts in enumerate(idx):
        hour = ts.hour
        month = ts.month
        dow = ts.dayofweek  # 0=Mon, 6=Sun

        # Base: seasonal pattern (higher in winter)
        seasonal = 65 + 25 * math.cos(2 * math.pi * (month - 1) / 12)

        # Daily pattern: peak in morning/evening, dip at midday (solar effect)
        daily = (
            -15 * math.cos(2 * math.pi * (hour - 8) / 24)  # morning peak ~8
            + 10 * math.cos(2 * math.pi * (hour - 18) / 24)  # evening peak ~18
            - 20 * math.cos(2 * math.pi * (hour - 13) / 24)  # midday solar dip
        )

        # Weekend discount
        weekend = -15 if dow >= 5 else 0

        # Solar penetration effect: midday price suppression grows with year
        year_offset = (ts.year - 2022)
        solar_dip = -8 * year_offset * max(0, math.cos(2 * math.pi * (hour - 12) / 24))

        # Wind effect: random walk correlated with wind availability
        wind_factor = -20 * year_offset * (0.5 + 0.5 * math.sin(2 * math.pi * (i % 168) / 168))

        base = seasonal + daily + weekend + solar_dip + wind_factor

        # Add noise
        noise = rng.gauss(0, 12)

        # Negative price probability: increases in spring/summer midday with high renewables
        neg_prob = 0
        if 9 <= hour <= 15 and month in (3, 4, 5, 6, 7):
            neg_prob = 0.02 + 0.01 * year_offset
        if dow >= 5 and hour in range(9, 16):
            neg_prob += 0.01

        if rng.random() < neg_prob:
            prices[i] = rng.uniform(-200, -5)
        else:
            prices[i] = max(-100, base + noise)

    return prices


def generate_load(idx: pd.DatetimeIndex, rng: random.Random) -> np.ndarray:
    """Generate German total system load (MW)."""
    loads = np.zeros(len(idx))
    for i, ts in enumerate(idx):
        hour = ts.hour
        month = ts.month
        dow = ts.dayofweek

        # Base: ~55 GW mean
        base = 55000

        # Seasonal: higher in winter
        seasonal = 8000 * math.cos(2 * math.pi * (month - 1) / 12)

        # Daily: morning ramp, evening peak, night trough
        daily = (
            10000 * math.exp(-0.5 * ((hour - 9) / 3) ** 2)  # morning peak
            + 8000 * math.exp(-0.5 * ((hour - 19) / 3) ** 2)  # evening peak
            - 12000 * math.exp(-0.5 * ((hour - 4) / 2) ** 2)  # night trough
        )

        # Weekend reduction
        weekend = -5000 if dow >= 5 else 0

        noise = rng.gauss(0, 1500)
        loads[i] = max(25000, base + seasonal + daily + weekend + noise)

    return loads


def generate_wind_onshore(idx: pd.DatetimeIndex, rng: random.Random) -> np.ndarray:
    """German onshore wind generation (MW), installed capacity grows over time."""
    gen = np.zeros(len(idx))
    for i, ts in enumerate(idx):
        hour = ts.hour
        month = ts.month

        # Installed capacity grows: ~55 GW in 2022 → ~65 GW in 2026
        installed = 55000 + (ts.year - 2022) * 2500

        # Seasonal wind pattern: higher in winter
        wind_seasonal = 0.35 + 0.15 * math.cos(2 * math.pi * (month - 1) / 12)

        # Slow-moving weather pattern (autocorrelated)
        weather = 0.3 + 0.4 * (
            0.5 * math.sin(2 * math.pi * i / (168 * 3) + rng.uniform(-0.5, 0.5))
            + 0.3 * math.sin(2 * math.pi * i / (168 * 7) + 1.2)
            + 0.2 * rng.random()
        )

        cf = max(0.02, min(0.95, wind_seasonal * weather))
        gen[i] = installed * cf

    return gen


def generate_wind_offshore(idx: pd.DatetimeIndex, rng: random.Random) -> np.ndarray:
    """German offshore wind generation (MW)."""
    gen = np.zeros(len(idx))
    for i, ts in enumerate(idx):
        month = ts.month

        installed = 8000 + (ts.year - 2022) * 500

        wind_seasonal = 0.4 + 0.15 * math.cos(2 * math.pi * (month - 1) / 12)
        weather = 0.35 + 0.35 * (
            0.5 * math.sin(2 * math.pi * i / (168 * 4) + 0.8)
            + 0.3 * math.sin(2 * math.pi * i / (168 * 10) + 2.1)
            + 0.2 * rng.random()
        )

        cf = max(0.05, min(0.90, wind_seasonal * weather))
        gen[i] = installed * cf

    return gen


def generate_solar(idx: pd.DatetimeIndex, rng: random.Random) -> np.ndarray:
    """German solar PV generation (MW), grows significantly over time."""
    gen = np.zeros(len(idx))
    for i, ts in enumerate(idx):
        hour = ts.hour
        month = ts.month

        # Installed: ~70 GW in 2022 → ~95 GW in 2026 (EEG expansion)
        installed = 70000 + (ts.year - 2022) * 6000

        # Daylight hours (rough sunrise/sunset by month)
        sunrise_hour = max(5, 8 - 3 * math.cos(2 * math.pi * (month - 6) / 12))
        sunset_hour = min(21, 16 + 3 * math.cos(2 * math.pi * (month - 6) / 12))

        if hour < sunrise_hour or hour > sunset_hour:
            gen[i] = 0
            continue

        # Bell curve peaking at solar noon
        solar_hour = (sunrise_hour + sunset_hour) / 2
        width = (sunset_hour - sunrise_hour) / 4
        cf = math.exp(-0.5 * ((hour - solar_hour) / width) ** 2)

        # Seasonal: stronger in summer
        seasonal = 0.6 + 0.4 * math.sin(2 * math.pi * (month - 3) / 12)
        cf *= seasonal

        # Cloud noise
        cloud = 0.7 + 0.3 * rng.random()
        cf *= cloud

        cf = max(0, min(0.95, cf))
        gen[i] = installed * cf

    return gen


def generate_gas_prices(idx: pd.DatetimeIndex, rng: random.Random) -> np.ndarray:
    """Gas TTF prices (EUR/MWh)."""
    prices = np.zeros(len(idx))
    prev = 35.0
    for i, ts in enumerate(idx):
        month = ts.month
        seasonal = 10 * math.cos(2 * math.pi * (month - 1) / 12)
        mean_revert = 0.02 * (50 - prev)
        noise = rng.gauss(0, 1.5)
        prev = max(8, min(120, prev + mean_revert + seasonal * 0.1 + noise))
        prices[i] = prev
    return prices


def generate_co2_prices(idx: pd.DatetimeIndex, rng: random.Random) -> np.ndarray:
    """CO2 EUA prices (EUR/ton)."""
    prices = np.zeros(len(idx))
    prev = 65.0
    for i, ts in enumerate(idx):
        seasonal = 3 * math.cos(2 * math.pi * (month := ts.month) / 12)
        trend = 0.005 * (ts.year - 2022) * 365
        mean_revert = 0.01 * (70 - prev)
        noise = rng.gauss(0, 1.2)
        prev = max(30, min(120, prev + mean_revert + trend * 0.001 + seasonal * 0.05 + noise))
        prices[i] = prev
    return prices


def generate_afrr_capacity(idx_4h: pd.DatetimeIndex, rng: random.Random) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """aFRR Up/Down and FCR capacity prices (EUR/MW/h)."""
    n = len(idx_4h)
    afrr_up = np.zeros(n)
    afrr_down = np.zeros(n)
    fcr = np.zeros(n)

    prev_up = 25.0
    prev_down = 20.0
    prev_fcr = 45.0
    for i, ts in enumerate(idx_4h):
        month = ts.month
        hour = ts.hour

        # Winter = higher prices
        seasonal = 5 * math.cos(2 * math.pi * (month - 1) / 12)

        # Time-of-day effect
        toad = 8 * math.exp(-0.5 * ((hour - 8) / 4) ** 2)

        prev_up = max(5, min(120, prev_up + rng.gauss(0, 2) + seasonal * 0.1))
        prev_down = max(5, min(100, prev_down + rng.gauss(0, 1.8) + seasonal * 0.08))
        prev_fcr = max(10, min(150, prev_fcr + rng.gauss(0, 3) + seasonal * 0.12))

        afrr_up[i] = prev_up + toad + rng.gauss(0, 1)
        afrr_down[i] = prev_down + toad * 0.7 + rng.gauss(0, 1)
        fcr[i] = prev_fcr + toad * 0.5 + rng.gauss(0, 2)

    return afrr_up, afrr_down, fcr


def generate_afrr_energy(idx_15min: pd.DatetimeIndex, rng: random.Random) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """aFRR energy up/down and imbalance long/short prices (EUR/MWh)."""
    n = len(idx_15min)
    afrr_up = np.zeros(n)
    afrr_down = np.zeros(n)
    imb_long = np.zeros(n)
    imb_short = np.zeros(n)

    for i, ts in enumerate(idx_15min):
        hour = ts.hour

        base = 80
        peak_add = 30 * math.exp(-0.5 * ((hour - 19) / 3) ** 2)

        afrr_up[i] = max(0, base + peak_add + rng.gauss(0, 25))
        afrr_down[i] = max(0, base + peak_add * 0.8 + rng.gauss(0, 20))
        imb_long[i] = max(0, base + peak_add + rng.gauss(0, 40))
        imb_short[i] = max(0, base + peak_add + 15 + rng.gauss(0, 50))

    return afrr_up, afrr_down, imb_long, imb_short


def build_demo_db(start: str = "2022-01-01", end: str = "2026-08-31",
                  conn: duckdb.DuckDBPyConnection | None = None) -> duckdb.DuckDBPyConnection:
    """Build a DuckDB with realistic German electricity market demo data.

    When `conn` is given, the tables are created in its `main` catalog (the
    demo DB is connection-scoped, so data cannot be shared via ATTACH).
    Otherwise a fresh in-memory connection is created and returned.

    Returns the connection with tables matching the schema the backend expects.
    """
    own_conn = conn is None
    target = conn or duckdb.connect(":memory:")
    target.execute("SET TimeZone='UTC'")

    rng = _seed_rng()
    np_rng = np.random.RandomState(42)

    # --- Hourly timestamps ---
    hourly_idx = _hourly_timestamps(start, end)
    daily_idx = _daily_timestamps(start, end)
    q15_idx = _quarterly_timestamps(start, end)
    h4_idx = hourly_idx[::4]  # every 4th hour

    # --- Generate series ---
    da_prices = generate_da_prices(hourly_idx, rng)
    load = generate_load(hourly_idx, rng)
    wind_on = generate_wind_onshore(hourly_idx, rng)
    wind_off = generate_wind_offshore(hourly_idx, rng)
    solar = generate_solar(hourly_idx, rng)

    # Cross-border net export (negative = net import to DE)
    cross_border = np.zeros(len(hourly_idx))
    for i, ts in enumerate(hourly_idx):
        # Germany is typically a net exporter, but less so midday (solar)
        base_export = 2000 + (ts.year - 2022) * 300
        solar_effect = solar[i] * 0.03
        cross_border[i] = base_export + solar_effect + rng.gauss(0, 1500)

    # 15-min data: replicate 4x per hour with slight variation
    load_15 = np.repeat(load, 4)[:len(q15_idx)]
    load_15 += np_rng.normal(0, 500, len(load_15))
    wind_on_15 = np.repeat(wind_on, 4)[:len(q15_idx)]
    wind_on_15 += np_rng.normal(0, 200, len(wind_on_15))
    wind_off_15 = np.repeat(wind_off, 4)[:len(q15_idx)]
    wind_off_15 += np_rng.normal(0, 100, len(wind_off_15))
    solar_15 = np.repeat(solar, 4)[:len(q15_idx)]
    solar_15 = np.maximum(0, solar_15 + np_rng.normal(0, 100, len(solar_15)))

    afrr_energy_up_15, afrr_energy_down_15, imb_long_15, imb_short_15 = generate_afrr_energy(q15_idx, rng)
    cross_border_15 = np.repeat(cross_border, 4)[:len(q15_idx)]

    # 4-hourly: ancillary capacity
    afrr_up_4h, afrr_down_4h, fcr_4h = generate_afrr_capacity(h4_idx, rng)

    # Daily: commodities
    gas_daily = generate_gas_prices(pd.DatetimeIndex(daily_idx), rng)
    co2_daily = generate_co2_prices(pd.DatetimeIndex(daily_idx), rng)

    # --- Build DataFrames ---
    ts_hourly_df = pd.DataFrame({
        "timestamp_utc": hourly_idx,
        "DE_DA__DA_Price": da_prices,
        "DE_Load__Total_Load_MW": load,
        "Temperature_DE__T": np_rng.normal(283, 15, len(hourly_idx)),
    })

    ts_15min_df = pd.DataFrame({
        "timestamp_utc": q15_idx,
        "DE_Load__Total_Load_MW": load_15,
        "DE_Wind_Onshore__Generation_MW": wind_on_15,
        "DE_Wind_Offshore__Generation_MW": wind_off_15,
        "DE_Solar__Generation_MW": solar_15,
        "DE_CrossBorder__Net_Exchange_MW": cross_border_15,
        "DE_Imbalance__Price_aFRR_energy_up": afrr_energy_up_15,
        "DE_Imbalance__Price_aFRR_energy_down": afrr_energy_down_15,
        "DE_Imbalance__Price_imb_long": imb_long_15,
        "DE_Imbalance__Price_imb_short": imb_short_15,
    })

    ts_4h_df = pd.DataFrame({
        "timestamp_utc": h4_idx,
        "aFRR_capacity_price__Up": afrr_up_4h,
        "aFRR_capacity_price__Down": afrr_down_4h,
        "FCR_capacity_price__symmetric_4h": fcr_4h,
        "aFRR_capacity_volume__Up": np_rng.uniform(200, 600, len(h4_idx)),
        "aFRR_capacity_volume__Down": np_rng.uniform(150, 400, len(h4_idx)),
        "FCR_capacity_volume__symmetric_MW": np_rng.uniform(300, 800, len(h4_idx)),
    })

    ts_daily_df = pd.DataFrame({
        "timestamp_utc": pd.DatetimeIndex(daily_idx),
        "Gas_TTF__price": gas_daily,
        "CO2_EUA__price": co2_daily,
    })

    # Provenance table
    prov_df = pd.DataFrame({
        "table_name": ["ts_hourly", "ts_15min", "ts_4hourly", "ts_daily"],
        "source": ["DEMO_SYNTHETIC", "DEMO_SYNTHETIC", "DEMO_SYNTHETIC", "DEMO_SYNTHETIC"],
        "timestamp_utc": pd.to_datetime([end, end, end, end], utc=True),
        "ingested_at": pd.to_datetime([end, end, end, end], utc=True),
    })

    # --- Create the DuckDB tables on the target connection ---
    target.execute("CREATE TABLE ts_hourly AS SELECT * FROM ts_hourly_df")
    target.execute("CREATE TABLE ts_15min AS SELECT * FROM ts_15min_df")
    target.execute("CREATE TABLE ts_4hourly AS SELECT * FROM ts_4h_df")
    target.execute("CREATE TABLE ts_daily AS SELECT * FROM ts_daily_df")
    target.execute("CREATE TABLE provenance AS SELECT * FROM prov_df")

    return target


def generate_da_forecast_prices(idx: pd.DatetimeIndex) -> np.ndarray:
    """Synthetic day-ahead price forecast (2023-2050) for scenario runs.

    Uses the same seasonal pattern as generate_da_prices plus a slow drift so
    scenario years look plausible (rising renewables → lower midday prices).
    Vectorised over the hourly index for speed.
    """
    n = len(idx)
    hours = np.array(idx.hour, dtype=float)
    months = np.array(idx.month, dtype=float)
    dows = np.array(idx.dayofweek, dtype=float)
    years = np.array(idx.year, dtype=float)

    seasonal = 60 + 22 * np.cos(2 * np.pi * (months - 1) / 12)
    daily = (
        -14 * np.cos(2 * np.pi * (hours - 8) / 24)
        + 10 * np.cos(2 * np.pi * (hours - 18) / 24)
        - 22 * np.cos(2 * np.pi * (hours - 13) / 24)
    )
    weekend = np.where(dows >= 5, -15, 0)
    year_offset = years - 2022
    solar_dip = -9 * year_offset * np.maximum(0, np.cos(2 * np.pi * (hours - 12) / 24))
    week_of_year = (np.arange(n) // 168)
    wind_damp = -55 * year_offset * (0.55 + 0.35 * np.sin(2 * np.pi * (week_of_year % 48) / 48))
    noise = np.random.RandomState(42).normal(0, 10, n)
    return seasonal + daily + weekend + solar_dip + wind_damp + noise


def _scenario_forecast_dir() -> str:
    """Name for the single demo scenario directory."""
    return "Forecast_20260101_000000_v1_GridExpansionCentral"


def _production_dir() -> str:
    return "Production_Ensemble_20260101_000000"


def write_demo_artifacts(dest: Path) -> dict:
    """Write demo forecast/scenario/ML artifacts into `dest`.

    Everything generated here is clearly synthetic and labelled DEMO. Returns
    a dict describing what was written, keyed by artifact type. Regeneration is
    idempotent: if the scenario directory already exists, nothing is rewritten.
    """
    dest = Path(dest)
    scenario_dir = dest / _scenario_forecast_dir()
    prod_dir = dest / _production_dir()

    marker = dest / ".demo_artifacts_v1"
    if marker.exists() and scenario_dir.is_dir() and prod_dir.is_dir():
        return {
            "scenario_dir": str(scenario_dir),
            "production_dir": str(prod_dir),
            "features_path": str(dest / "Historical_data_features_engineered_2026.parquet"),
        }

    scenario_dir.mkdir(parents=True, exist_ok=True)
    prod_dir.mkdir(parents=True, exist_ok=True)

    rng = _seed_rng()

    # --- predictions_DA_hourly (2023–2050) ---
    da_idx = _hourly_timestamps("2023-01-01", "2050-12-31")
    pred = generate_da_forecast_prices(da_idx)
    actual = pred + np.random.RandomState(7).normal(0, 7, len(pred))
    da_fc = pd.DataFrame({
        "datetime_UTC": da_idx.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "Price_actual": np.round(actual, 2),
        "Price_pred_ensemble": np.round(pred, 2),
    })
    da_csv = scenario_dir / f"predictions_DA_hourly_{da_idx[0].year}_{da_idx[-1].year}.csv"
    da_fc.to_csv(da_csv, index=False)

    # --- ML predictions (training/validation fractions) ---
    n = len(pred)
    n_val = int(n * 0.25)
    train_df = pd.DataFrame({
        "datetime": da_idx[: n - n_val].strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "Price_actual": np.round(actual[: n - n_val], 2),
        "Price_pred_ensemble": np.round(pred[: n - n_val] + np.random.RandomState(3).normal(0, 2, n - n_val), 2),
    })
    val_df = pd.DataFrame({
        "datetime": da_idx[n - n_val:].strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "Price_actual": np.round(actual[n - n_val:], 2),
        "Price_pred_ensemble": np.round(pred[n - n_val:] + np.random.RandomState(5).normal(0, 2, n_val), 2),
    })
    train_df.to_csv(prod_dir / "predictions_training.csv", index=False)
    val_df.to_csv(prod_dir / "predictions_validation.csv", index=False)

    # --- metrics + config + features (clearly demo) ---
    metrics = build_demo_metrics()
    metrics["model_type"] = "DEMO_SYNTHETIC (no proprietary artifacts)"
    (prod_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    cfg = build_demo_ensemble_config()
    (prod_dir / "ensemble_config.json").write_text(json.dumps(cfg, indent=2))
    (prod_dir / "feature_list.txt").write_text("\n".join(build_demo_feature_list()) + "\n")

    # --- Annual statistics (xlsx) ---
    years = list(range(2020, 2051))
    map = _annual_stats_rows(years)
    wb = Workbook()
    ws = wb.active
    ws.title = "Annual statistics"
    ws.append(["Metric"] + [str(y) for y in years])
    for metric_name, values in map["table"].items():
        ws.append([metric_name] + values)
    wb.save(scenario_dir / f"Annual_statistics_v1_GridExpansionCentral_{years[0]}_{years[-1]}.xlsx")

    # --- Scenario assumptions (BirdSystem Futures analysis) ---
    reproducer_rows = _scenario_assumption_rows(years)
    fields = ["Year", "Scenario", "Solar PV", "Wind On", "Wind Off", "BESS GW",
              "BESS GWh", "Gas TTF", "EUA CO2", "TWh/y", "Power Base", "Must-Run", "Nuclear"]
    with open(scenario_dir / "BirdSystem_Futures_v1_GridExpansionCentral.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(fields)
        for row in reproducer_rows:
            writer.writerow([row.get(fi, "") for fi in fields])

    # --- Historical engineered-features parquet (correlation matrix) ---
    feat = _historical_features_df()
    feat_path = dest / "Historical_data_features_engineered_2026.parquet"
    feat.to_parquet(feat_path, index=False)

    # --- ID3 / imbalance / regulation-state forecast (quarterly res, 2023–2050) ---
    _write_id3_forecast_csv(scenario_dir)

    marker.write_text("demo artifacts generated on " + datetime.now(timezone.utc).isoformat())

    return {
        "scenario_dir": str(scenario_dir),
        "production_dir": str(prod_dir),
        "features_path": str(feat_path),
    }


def _write_id3_forecast_csv(scenario_dir: Path) -> None:
    """Synthetic ID3/imbalance/aFRR + Regulation_State series (quarterly res).

    Vectorised so the ~1M rows for 2023–2050 are generated quickly. Column
    names match what the forecast / ancillary routers expect.
    """
    idx = _quarterly_timestamps("2023-01-01", "2050-12-31")
    n = len(idx)
    np_rng = np.random.RandomState(13)

    hour = np.arange(n) % 96 // 4
    day = np.arange(n) // 96
    month = np.asarray(idx.month)
    dow = np.asarray(idx.dayofweek)
    year = np.asarray(idx.year)

    seasonal = 62 + 22 * np.cos(2 * np.pi * (month - 1) / 12)
    daily_peak = 28 * np.exp(-0.5 * ((hour - 19) / 3) ** 2)
    weekend = np.where(dow >= 5, -14, 0)
    year_off = year - 2022
    solar_dip = -9 * year_off.astype(float) * np.exp(-0.5 * ((hour - 12) / 3) ** 2)

    base_da = seasonal + daily_peak + weekend + solar_dip + np_rng.normal(0, 8, n)
    id3 = base_da + 4.5 + np_rng.normal(0, 5, n)
    afrr_up = np.clip(base_da + 25 + np_rng.normal(0, 20, n), 0, None)
    afrr_down = np.clip(base_da + 18 + np_rng.normal(0, 18, n), 0, None)
    imb_long = np.clip(base_da + 12 + np_rng.normal(0, 35, n), 0, None)
    imb_short = np.clip(base_da + 28 + np_rng.normal(0, 45, n), 0, None)

    # Regulation state: -1 down, 0 no, 1 up, 2 mixed, driven by imbalance level.
    mix = 0.12 + 0.30 * np.sin(2 * np.pi * (hour + 6) / 24)
    r = np_rng.uniform(0, 1, n)
    reg = np.where(r < mix, 1, np.where(r < mix + 0.15, -1, np.where(r < mix + 0.28, 2, 0)))

    df = pd.DataFrame({
        "Datetime_UTC": idx,  # tz-aware UTC datetime — no slow string formatting
        "Day-ahead_price": np.round(base_da, 2),
        "ID3_price": np.round(id3, 2),
        "aFRR_Energy_up_price": np.round(afrr_up, 2),
        "aFRR_Energy_down_price": np.round(afrr_down, 2),
        "imb_long_price": np.round(imb_long, 2),
        "imb_short_price": np.round(imb_short, 2),
        "Regulation_State": reg.astype(int),
    })
    # Feather is dramatically cheaper to serialise than ~1M-row CSV text.
    # query_forecast_file() will happily pick the .feather variant.
    df.to_feather(scenario_dir / "predictions_DA_ID3_Imb_aFRR_FCR_quarterly_2023_2050.feather")


def _annual_stats_rows(years: list[int]) -> dict:
    """Per-year synthetic annual statistics for the demo scenario (k€/MW/y etc.)."""
    table: dict[str, list] = {
        "Avg DA Price (€/MWh)": [],
        "Std Dev DA Price (€/MWh)": [],
        "Avg Daily Spread (€/MWh)": [],
        "Negative Hours (<€0)": [],
        "Peak Hours (>€200)": [],
        "BESS 2h DA Revenue (k€/MW/y)": [],
        "BESS 4h DA Revenue (k€/MW/y)": [],
        "BESS 8h DA Revenue (k€/MW/y)": [],
        "BESS 2h ID3 Revenue (k€/MW/y)": [],
        "BESS 2h aFRR Energy Revenue (k€/MW/y)": [],
        "aFRR Capacity Revenue (k€/MW/y)": [],
        "FCR Capacity Revenue (k€/MW/y)": [],
        "Solar Capture Price (€/MWh)": [],
        "Solar PV Revenue (k€/MW/y)": [],
        "Wind Revenue (k€/MW/y)": [],
        "Annual Demand (TWh/y)": [],
    }
    for y in years:
        off = y - 2022
        table["Avg DA Price (€/MWh)"].append(round(95 if y < 2023 else 70 - 2.2 * off, 1))
        table["Std Dev DA Price (€/MWh)"].append(round(48 - 1.6 * off, 1))
        table["Avg Daily Spread (€/MWh)"].append(round(52 - 1.4 * off, 1))
        table["Negative Hours (<€0)"].append(int(120 + 9 * off if y >= 2023 else 60))
        table["Peak Hours (>€200)"].append(int(max(5, 14 - 0.8 * off)))
        table["BESS 2h DA Revenue (k€/MW/y)"].append(round(48 - 0.6 * off, 1))
        table["BESS 4h DA Revenue (k€/MW/y)"].append(round(64 - 0.9 * off, 1))
        table["BESS 8h DA Revenue (k€/MW/y)"].append(round(78 - 1.1 * off, 1))
        table["BESS 2h ID3 Revenue (k€/MW/y)"].append(round(39 - 0.4 * off, 1))
        table["BESS 2h aFRR Energy Revenue (k€/MW/y)"].append(round(22 - 0.2 * off, 1))
        table["aFRR Capacity Revenue (k€/MW/y)"].append(round(18 - 0.15 * off, 1))
        table["FCR Capacity Revenue (k€/MW/y)"].append(round(14 - 0.1 * off, 1))
        table["Solar Capture Price (€/MWh)"].append(round(72 - 2.6 * off, 1))
        table["Solar PV Revenue (k€/MW/y)"].append(round(41 - 1.3 * off, 1))
        table["Wind Revenue (k€/MW/y)"].append(round(57 - 1.6 * off, 1))
        table["Annual Demand (TWh/y)"].append(round(505 - 2.5 * off, 1))
    return {"table": table}


def _scenario_assumption_rows(years: list[int]) -> list[dict]:
    """German 2030/2045 network expansion scenario (grid + solar/wind ramp)."""
    rows = []
    for y in years:
        off = y - 2022
        rows.append({
            "Year": y,
            "Scenario": "v1_GridExpansionCentral",
            "Solar PV": round(67 + 6.5 * off, 1),
            "Wind On": round(58 + 2.6 * off, 1),
            "Wind Off": round(8.1 + 1.0 * off, 1),
            "BESS GW": round(6 + 2.0 * off, 1),
            "BESS GWh": round(12 + 4.5 * off, 1),
            "Gas TTF": round(max(15, 70 - 1.8 * off), 1),
            "EUA CO2": round(min(180, 75 + 2.9 * off), 1),
            "TWh/y": round(505 - 2.5 * off, 1),
            "Power Base": round(32 - 0.25 * off, 1),
            "Must-Run": round(28 - 0.6 * off, 1),
            "Nuclear": (8.1 if y < 2022 else 0.0 if y >= 2023 else 3.0),
        })
    return rows


def _historical_features_df() -> pd.DataFrame:
    """Synthetic engineered-features frame for the correlation-matrix endpoint."""
    idx = _hourly_timestamps("2024-01-01", "2025-12-31")
    n = len(idx)
    np_rng = np.random.RandomState(11)
    wind_cf = np.clip(0.35 + 0.25 * np.sin(2 * np.pi * np.arange(n) / 504), 0, 0.95)
    solar_cf = np.clip(0.3 + 0.4 * np.maximum(0, np.sin(2 * np.pi * (np.arange(n) % 24) / 24 - 0.5)), 0, 1)
    load_mw = 50000 + 8000 * np.sin(2 * np.pi * (np.arange(n) % 168) / 168) + np_rng.normal(0, 800, n)
    price = 70 + 30 * np.sin(2 * np.pi * (np.arange(n) % 24) / 24) - 30 * solar_cf + np_rng.normal(0, 12, n)
    df = pd.DataFrame({
        "DE_Wind_Onshore_CF": np.round(wind_cf, 4),
        "DE_Wind_Offshore_CF": np.round(wind_cf * 1.1, 4),
        "DE_Solar_CF": np.round(solar_cf, 4),
        "DE_Load_MW": np.round(load_mw, 0),
        "DE_Load_forecast_MW": np.round(load_mw + np_rng.normal(0, 400, n), 0),
        "DE_Import_MW": np.round(np_rng.normal(2000, 800, n), 0),
        "Gas_TTF_EUR_MWh": np.round(45 + 10 * np.sin(2 * np.pi * np.arange(n) / 6000) + np_rng.normal(0, 1.5, n), 2),
        "CO2_EUA_EUR_ton": np.round(70 + np_rng.normal(0, 2.5, n), 2),
        "DE_Hour": np.arange(n) % 24,
        "DE_DayOfWeek": (np.arange(n) // 24) % 7,
        "DE_Month": ((np.arange(n) // 24) % 365) % 12,
        "DE_IsWeekend": ((np.arange(n) // 24) % 7 >= 5).astype(int),
        "DE_Load_Lag24h": np.roll(load_mw, 24),
        "DE_Load_Lag168h": np.roll(load_mw, 168),
        "DE_DA_Price_Lag24h": np.roll(price, 24),
        "DE_DA_Price_Lag168h": np.roll(price, 168),
        "DE_Wind_Onshore_CF_Lag24h": np.roll(wind_cf, 24),
        "DE_Solar_CF_Lag24h": np.roll(solar_cf, 24),
        "DE_Temperature_C": np.round(np_rng.normal(10, 8, n), 1),
        "DE_Price_Rolling7d_Mean": np.round(pd.Series(price).rolling(168, min_periods=1).mean().to_numpy(), 2),
    })
    return df


def build_demo_metrics() -> dict:
    """Synthetic ML metrics for a German DA price forecasting model."""
    return {
        "training": {
            "mae": 8.42,
            "rmse": 14.67,
            "r2": 0.8923,
            "correlation": 0.9448,
            "samples": 32856,
        },
        "validation": {
            "mae": 9.15,
            "rmse": 16.23,
            "r2": 0.8654,
            "correlation": 0.9312,
            "samples": 8214,
            "by_price_range": [
                {"range": "Band A (<0)", "name": "Band A", "samples": 412, "pct": 5.0, "mae": 12.3, "correlation": 0.65},
                {"range": "Band B (0-80)", "name": "Band B", "samples": 3696, "pct": 45.0, "mae": 5.8, "correlation": 0.92},
                {"range": "Band C (80-150)", "name": "Band C", "samples": 2874, "pct": 35.0, "mae": 8.4, "correlation": 0.88},
                {"range": "Band D (>150)", "name": "Band D", "samples": 1232, "pct": 15.0, "mae": 15.7, "correlation": 0.79},
            ],
        },
        "curve_alignment": {
            "mean_bess_capture_rate": 0.934,
            "mean_spearman_r": 0.912,
        },
        "spread_mae": 3.21,
    }


def build_demo_ensemble_config() -> dict:
    return {
        "weight_lightgbm": 0.55,
        "weight_catboost": 0.45,
    }


def build_demo_feature_list() -> list[str]:
    return [
        "DE_Wind_Onshore_CF", "DE_Wind_Offshore_CF", "DE_Solar_CF",
        "DE_Load_MW", "DE_Load_forecast_MW", "DE_Import_MW",
        "Gas_TTF_EUR_MWh", "CO2_EUA_EUR_ton",
        "DE_Hour", "DE_DayOfWeek", "DE_Month", "DE_IsWeekend",
        "DE_Load_Lag24h", "DE_Load_Lag168h",
        "DE_DA_Price_Lag24h", "DE_DA_Price_Lag168h",
        "DE_Wind_Onshore_CF_Lag24h", "DE_Solar_CF_Lag24h",
        "DE_Temperature_C", "DE_Price_Rolling7d_Mean",
    ]
