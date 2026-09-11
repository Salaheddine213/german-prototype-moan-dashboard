# Architecture

## Backend — FastAPI + DuckDB

The backend is a single FastAPI app (`dashboard/backend/app/main.py`) wired to a DuckDB engine via `DataEngine`. Each page on the frontend maps to one router under `app/routers/`:

| Page | Router | Responsibility |
|---|---|---|
| Commodities | `routers/commodities.py` | TTF gas, EUA CO₂, Coal API2, EUR/USD KPI cards & series, marginal costs |
| Electricity | `routers/electricity.py` | German DA prices, load/PV/wind overlays, duration curves, heatmap |
| Forecast | `routers/forecast.py` | Scenario DA + ID3/imbalance forecasts vs realised, annual stats |
| ML | `routers/ml.py` | Ensemble diagnostics, feature importance, correlation, distributions |
| Ancillary | `routers/ancillary.py` | aFRR/FCR capacity & energy, revenue, regulation states |
| Scenarios | `routers/scenarios.py` | Long-run capacity & price assumptions |

See the [API reference](reference/index.md) for full per-module documentation.

### Two data modes

- **Demo mode (default)** — `MARKET_DUCKDB_PATH` unset. `DataEngine` builds an in-memory DuckDB from `app/demo_data.py` (clearly-labelled `DEMO_SYNTHETIC` tables) and writes a synthetic artifact set to `demo_artifacts/demo/`. Nothing to download.
- **Live mode** — `MARKET_DUCKDB_PATH` points at a read-only DuckDB; `DataEngine` attaches it as the `db` catalog alongside an in-memory `sidecars` catalog for the optional EUR/USD and Coal API2 CSVs. `/api/health` reports `data_mode`.

Every request runs on its own DuckDB cursor (the shared connection is not safe for concurrent queries) inside FastAPI's threadpool, keeping the event loop free during large scans.

### Server-side downsampling

Every chart payload runs through LTTB (`app/downsampling.py`) so the browser never receives more than a few thousand points — extremes (negative-price spikes, ramp events) survive the downsample.

### Time handling

All timestamps are stored UTC and emitted tz-aware (`+00:00` suffix). The data layer uses `pd.to_datetime(..., utc=True)` everywhere, and the DuckDB connection sets `TimeZone='UTC'` on connect. `end_exclusive()` promotes inclusive `YYYY-MM-DD` API dates to the next-day bound so final-day rows are never dropped.

## Frontend — React 19 + Vite

- **State / data** — TanStack Query, one query per endpoint with `Cache-Control`-aware staleness
- **Charts** — ECharts for analytics, TradingView lightweight-charts for time series
- **Code-splitting** — per-page lazy routes; chart libraries in dedicated vendor chunks

## Data plane

Wide-format tables, `{source}__{column}` columns, German schema:

- `ts_15min` — German load, PV, wind on/offshore, cross-border net exchange, imbalance/aFRR energy prices
- `ts_hourly` — German DA prices, load, temperature
- `ts_4hourly` — aFRR/FCR capacity prices and volumes per auction block (FCR symmetric)
- `ts_daily` — Gas TTF, CO₂ EUA daily settles
- `provenance` — per-(table, source) ingestion bookkeeping for `/api/data-status`

File-based artifacts under `MARKET_MODEL_RESULTS_DIR`:

- `Production_Ensemble_<ts>/` — metrics.json, ensemble_config.json, feature_list.txt, `predictions_{training,validation}.csv`
- `Forecast_<ts>_<scenario>/` — per-scenario forecast CSV/feather/xlsx/CSV files, discovered at startup and re-read per request

In demo mode the same layout is generated from `demo_data.write_demo_artifacts()` so the file-backed routers behave identically.