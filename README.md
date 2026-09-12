# German Electricity Market Analytics

Interactive dashboard for the **German electricity market**: day-ahead prices, load/demand, renewable generation (PV, wind on/offshore), cross-border flows, commodity fuel & carbon costs, ancillary services (aFRR / FCR), price forecasts out to 2050, ML model diagnostics, and scenario assumptions.

Built as a portfolio project and Python/DevOps engineering showcase: **FastAPI + DuckDB** backend, **React 19 + TypeScript + Vite** frontend, automated tests, and GitHub Actions CI/CD.

- **Repository:** https://github.com/Salaheddine213/german-prototype-moan-dashboard
- **Documentation (MkDocs):** https://salaheddine213.github.io/german-prototype-moan-dashboard/
- **CI status:** backend pytest (32) + frontend build run on every push (`Actions` tab)

> **No proprietary data or model artifacts are required.** The app runs out-of-the-box in **demo mode** with clearly-labelled synthetic German market data (`source = DEMO_SYNTHETIC` everywhere). A bring-your-own-data **live mode** plugs your own DuckDB + model-artifact files in behind the same API contract.

## Try it (2 commands)

```bash
git clone https://github.com/Salaheddine213/german-prototype-moan-dashboard.git
cd german-prototype-moan-dashboard/dashboard
make install   # creates backend/.venv + installs Python deps + npm install
make dev       # backend on :8000, frontend on :5173
# open http://localhost:5173
```

Requires **Python 3.11+** and **Node.js 20+**. First start generates the synthetic dataset (~5–10 s, cached under `backend/demo_artifacts/`, git-ignored). Windows users: `make install-backend` now detects the `.venv\Scripts` layout automatically.

## Highlights

- **Two data modes, one API** — demo mode synthesises German market tables and demo forecast/ML artifacts at startup; live mode attaches a read-only DuckDB plus `Production_Ensemble_*` / `Forecast_*` model directories. `/api/health` reports `data_mode`.
- **Native DuckDB query engine** — wide-format columnar reads, no ORM, no Python pivot loops.
- **Async FastAPI** routers with threadpool offload for blocking file I/O and `Cache-Control` for immutable historical ranges.
- **Server-side LTTB downsampling** caps every chart payload to a few thousand points without losing extremes.
- **React 19 + TanStack Query + Vite** frontend; ECharts for analytics, TradingView lightweight-charts for time series (the on-canvas attribution logo is disabled, so this notice serves as attribution: charting powered by [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/)).
- **Automated tests + CI** — backend `pytest` suite that runs fully against the synthetic demo data, frontend `tsc`/`vite build` as the API-contract check, both wired into GitHub Actions.

## Screenshots (real captures from the running app)

| Commodities | Electricity | Forecast |
| --- | --- | --- |
| ![Commodities](docs/screenshots/page-commodities.png) | ![Electricity](docs/screenshots/page-electricity.png) | ![Forecast](docs/screenshots/page-forecast.png) |

| ML diagnostics | Ancillary | Scenarios |
| --- | --- | --- |
| ![ML](docs/screenshots/page-ml.png) | ![Ancillary](docs/screenshots/page-ancillary.png) | ![Scenarios](docs/screenshots/page-scenarios.png) |

🎬 **Video tour:** [hero-tour.webm](docs/screenshots/hero-tour.webm)

## German market context

- Wholesale prices are for the **day-ahead auction (EPEX DE/AT/LU zone)** in EUR/MWh.
- Load/renewables/cross-border series reflect the German control area, whose TSOs are **50Hertz, Amprion, TenneT DE and TransnetBW**.
- Fuel-mix at the margin is **gas (CCGT) and hard coal + EU ETS carbon**, which is why commodity curves drive marginal costs.
- Ancillary products are **FCR (symmetric, one clearing price)** and **aFRR capacity + energy (Up/Down)**, as procured for the German market.
- Demo scenario `v1_GridExpansionCentral` models the German grid-expansion path: heavy solar/wind ramp, BESS growth, gas/CO₂ pathways to 2050.

## Pages

| Page | Route | What it shows |
| --- | --- | --- |
| Commodities | `/commodities` | Gas TTF, CO₂ EUA, Coal API2, EUR/USD + CCGT / hard-coal marginal-cost overlay and KPI cards |
| Electricity | `/electricity` | DA price history with load / PV / wind overlays, per-year price-duration curves, hour×month price heatmap |
| Forecast | `/forecast` | DA forecast vs realised prices per scenario, ID3/imbalance forecast, annual avg/spread bars and BESS revenue classes (2h/4h/8h DA, ID3 2h, aFRR Energy) |
| ML | `/ml` | Ensemble metrics (MAE/R²/RMSE/Spearman, BESS capture rate), actual-vs-predicted scatter, residual histogram, feature importance, per-price-band MAE, correlation matrix |
| Ancillary | `/ancillary` | aFRR/FCR capacity prices & volumes, imbalance + aFRR energy prices, annual revenue stack, regulation-state donut |
| Scenarios | `/scenarios` | Installed-capacity path (PV/wind/BESS GW), gas & CO₂ price assumptions, year-by-year assumption table exportable to CSV |

## Architecture

```
dashboard/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app ("German Electricity Market Analytics API")
│   │   ├── config.py          # pydantic-settings, MARKET_* env prefix, demo-mode flag
│   │   ├── data_loader.py     # DataEngine: demo (in-memory DuckDB) or live (read-only attach)
│   │   ├── demo_data.py       # synthetic German market data + demo ML/scenario artifacts
│   │   ├── downsampling.py    # LTTB
│   │   ├── models.py          # Pydantic response models
│   │   └── routers/           # health, data-status, electricity, commodities, forecast,
│   │                          # ml, ancillary, scenarios (+ _helpers)
│   ├── tests/                 # 32 pytest cases, runnable without any live data
│   ├── requirements.txt
│   └── .env.example
├── frontend/                  # React 19 + Vite + TS + TanStack Query
│   └── src/pages/, components/, api/, lib/, store/, types/
├── Makefile                   # dev/install/test helpers
└── .github/workflows/ci.yml   # frontend lint+build, backend pytest (demo mode)
```

The **data plane** uses wide-format tables (`{source}__{column}`) and a directory of model artifacts. Column naming follows the German schema, e.g. `DE_DA__DA_Price`, `DE_Load__Total_Load_MW`, `DE_Solar__Generation_MW`, `DE_Wind_Onshore__Generation_MW`, `DE_CrossBorder__Net_Exchange_MW`, `DE_Imbalance__Price_imb_long`, `Gas_TTF__price`, `CO2_EUA__price`.

## Prerequisites

- Python 3.11+
- Node.js 20+ and npm

The `Makefile` prefers a local venv at `dashboard/backend/.venv` and falls back to a pixi `main` env.

### Run the halves separately

```bash
make backend     # FastAPI on :8000 (separate terminal)
make frontend    # Vite on :5173    (separate terminal)
```

The frontend proxies `/api` to the backend. On first start the backend generates the synthetic dataset (~5–10 s); it is cached under `dashboard/backend/demo_artifacts/` (git-ignored) and only regenerated when deleted.

### Without the Makefile

```bash
# backend
python -m venv dashboard/backend/.venv
dashboard/backend/.venv/Scripts/python -m pip install -r dashboard/backend/requirements.txt
cd dashboard/backend && .venv/Scripts/python -m granian --interface asgi --host 0.0.0.0 --port 8000 app.main:app

# frontend
cd dashboard/frontend && npm install && npm run dev
```

## Configuration

Settings are read from environment variables or a `.env` file in `dashboard/backend/`. All variables use the `MARKET_` prefix.

| Var | Default | Purpose |
| --- | --- | --- |
| `MARKET_DUCKDB_PATH` | *(unset = demo mode)* | Path to a read-only DuckDB file; leaving this unset runs the synthetic demo dataset. |
| `MARKET_MODEL_RESULTS_DIR` | `demo_artifacts` | Directory for `Production_Ensemble_*` and `Forecast_*`; in demo mode the synthetic artifact set is written here (sub-dir `demo`). |
| `MARKET_HISTORICAL_FEATURES_PATH` | `demo_artifacts/demo/Historical_data_features_engineered_*.parquet` | Glob for the engineered-features file used by `/api/ml/correlation-matrix` (demo artifacts are generated in the `demo/` sub-dir). |
| `MARKET_EUR_USD_PATH` | *(empty)* | Optional glob for the EUR/USD daily CSV sidecar; series degrades to empty when absent. |
| `MARKET_COAL_API2_PATH` | *(empty)* | Optional glob for the Coal API2 daily CSV sidecar; same fallback. |
| `MARKET_CORS_ORIGINS` | `["http://localhost:5173"]` | JSON array of allowed frontend origins. |

See [dashboard/backend/.env.example](dashboard/backend/.env.example) for a commented template.

## Live mode (bring-your-own data)

The schema contract is identical in both modes. Point the backend at your own DuckDB and model results:

```bash
export MARKET_DUCKDB_PATH=/path/to/market.duckdb
export MARKET_MODEL_RESULTS_DIR=/path/to/model_results
cd dashboard && make dev
```

`MARKET_HISTORICAL_FEATURES_PATH` should point at your engineered-features parquet/feather; the optional sidecar CSVs match the commodities page the same way. Check `/api/health` — `data_mode: "live"` confirms you are no longer on demo data.

## Schema requirement

Wide-format time-series tables, one column per metric, named `{source}__{column}` with a double-underscore separator. All timestamps in UTC.

```text
ts_15min   — 15-minute (load, PV, wind on/off, cross-border net exchange, imbalance,
             aFRR energy prices):
               DE_Load__Total_Load_MW
               DE_Solar__Generation_MW
               DE_Wind_Onshore__Generation_MW
               DE_Wind_Offshore__Generation_MW
               DE_CrossBorder__Net_Exchange_MW
               DE_Imbalance__Price_aFRR_energy_up
               DE_Imbalance__Price_aFRR_energy_down
               DE_Imbalance__Price_imb_long
               DE_Imbalance__Price_imb_short

ts_hourly  — 1-hour (day-ahead price, load, temperature):
               DE_DA__DA_Price
               DE_Load__Total_Load_MW
               Temperature_DE__T

ts_4hourly — 4-hour (FCR/aFRR capacity prices and volumes):
               aFRR_capacity_price__Up / __Down
               aFRR_capacity_volume__Up / __Down
               FCR_capacity_price__symmetric_4h
               FCR_capacity_volume__symmetric_MW

ts_daily   — daily (commodities):
               Gas_TTF__price
               CO2_EUA__price

provenance — table → source / ingestion metadata, feeds /api/data-status
```

Model artifacts directory layout (`MARKET_MODEL_RESULTS_DIR`):

```text
Production_Ensemble_<YYYYMMDD_HHMMSS>/   # metrics.json, ensemble_config.json,
                                         # feature_list.txt, predictions_{training,validation}.csv
Forecast_<YYYYMMDD_HHMMSS>_<scenario>/   # predictions_DA_hourly_*.csv, annual-stats xlsx,
                                         # BirdSystem_Futures_*.csv, ID3/imbalance feather
```

## Tests

```bash
cd dashboard/backend
.venv/Scripts/python -m pytest tests/ -v      # Windows
# or
make test-backend                              # uses .venv if present
```

32 backend tests cover the data loader, all router endpoints, LTTB downsampling, health/data-status and ML/forecast/ancillary response shapes. They run in **demo mode by default** — no DuckDB or model files need to exist. In CI they run the same way (`.github/workflows/ci.yml`).

The frontend has no unit-test suite yet; `npm run build` (`tsc -b && vite build`) is the type-safety / API-contract gate, and `npx eslint src --max-warnings 0` runs in CI.

## CI/CD

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on push to `main` and pull requests:

- **Frontend**: `npm ci`, `eslint --max-warnings 0`, `vite build`.
- **Backend**: `pip install -r requirements.txt`, `python -m pytest tests/ -v` (demo mode, no data needed).

## Limitations & honest notes

- **Demo data is synthetic.** Every series is generated by `demo_data.py` for plausible German price/load/generation behaviour and is labelled `DEMO_SYNTHETIC` in the provenance table. **It is not actual market data** and must not be used for trading or reporting. Replace it with real data in live mode.
- Historical demo coverage is **2022-01-01 → 2026-08-31**; forecast/scenario artifacts cover **2023–2050**.
- ML "metrics" and forecasts are demo values. Real model artifacts can be dropped into live mode to show genuine LightGBM/CatBoost ensemble diagnostics.
- EUR/USD and Coal API2 sidecars are optional and absent in demo mode (chart series degrade to empty arrays).
- No user authentication or persistence is included; the app is a read-only analytics tool.

## Future improvements

- Generator-based ingestion for real ENTSO-E / SMARD / EPEX data (regulated German free-data portals).
- BESS revenue curves constrained by live price data rather than scenario-only values.
- Frontend unit tests + Playwright smoke tests in CI.
- Dockerfile + docker-compose for one-command startup.

## License

MIT — see [LICENSE](LICENSE).