# BirdCurve Dashboard — Extract, Modernize, Publish Plan

**Goal**: extract `dashboard/` from `birdcurve_nl` `github/feature/dashboard` branch into a standalone repo at `/Users/mayk/birdcurve-dashboard`, modernize from SQLite-attached-via-DuckDB → native DuckDB + wide-format schema, make it snappy (async + threadpool, HTTP cache headers), and publish as MIT-licensed `github.com/MaykThewessen/birdcurve-dashboard`.

**Source**: `github/feature/dashboard` branch of `/Users/mayk/birdcurve_nl`, 59 files / ~9.6k LOC, no secrets.
**Target DB** (developer-side, not committed): `/Users/mayk/birdcurve_nl/data/birdcurve.duckdb` (DuckDB native, 352 MB, **wide format**).

---

## Phase 0 — Discovery (DONE)

Embedded reference. Use this as ground truth in every later phase. Do not re-derive.

### Routers and their data calls
| Router | Endpoint(s) | Data source | Schema-touch? |
|---|---|---|---|
| `health.py` | `/health` | `query()` of `ts_15min/ts_hourly/ts_daily` (counts) + `latest_production_model`, `available_scenarios` | YES — uses `sqlite_db.<table>` |
| `commodities.py` | `/commodities`, `/commodities/kpi` | `query_commodity()` (long+pivot) and raw `query()` for KPI | YES — long → wide rewrite |
| `electricity.py` | `/electricity/historical`, `/duration-curve`, `/heatmap` | `query_electricity()` + raw `query()` over `ts_hourly`/`ts_15min` | YES — long → wide rewrite, `strftime`/`EXTRACT` to DuckDB syntax |
| `ancillary.py` | `/capacity`, `/revenue`, `/regulation-states` | `query_forecast_file()` (feather/csv from forecast dirs) | NO — file-based, orthogonal to DB |
| `forecast.py` | `/da`, `/id3-imbalance`, `/annual-stats` | CSV/feather/openpyxl reads from forecast dirs | NO — file-based |
| `ml.py` | `/metrics`, `/predictions`, `/correlation-matrix`, `/price-distributions` | model files + (one path) `ts_hourly` SQL for historical distributions | PARTIAL — only price-distributions historical SQL |
| `scenarios.py` | `/list`, `/{scenario}` | CSV reads from project root | NO — file-based |

### Verified live DuckDB schema (wide format) at `/Users/mayk/birdcurve_nl/data/birdcurve.duckdb`
- `ts_15min` — 24 cols, 292,122 rows, 2017-12-31 → 2026-05-01
  - Cols include: `Load_NL__Actual_Load_MW`, `NED_PV__PV`, `NED_Wind_Onshore__Wind_Onshore`, `NED_Wind_Offshore__Wind_Offshore`, `CrossBorder_NL__Total_Net`, `Imbalance_NL__Price_imb_long/short`, `Imbalance_NL__Price_aFRR_energy_up/down`, `Imbalance_NL__reg_state`, `aFRR_capacity__Up/Down`, `aFRR_capacity__FCR_price/volume`, `FCR_activated_energy__FCR_price`, `CrossBorder_Belgium__netflow_BE_MW`, `CrossBorder_BritNed__BritNed_MW`, `CrossBorder_NL__BE/DE/DK/GB/NO`
- `ts_4hourly` — 9 cols, 9,482 rows: `(a)FRR_capacity_price/volume__Up/Down`
- `ts_hourly` — 4 cols, 86,170 rows: `DA_price__DA_price`, `Temperature_KNMI__T`, `Temperature_OpenMeteo__T`
- `ts_daily` — 3 cols, 3,022 rows: `CO2_EUA__price`, `Gas_TTF__price`
- `ned_forecasts` (forecast staging), `provenance`, `ingestion_log`

Naming convention: `{source}__{column}` with **double underscore**.

### Branch's expected schema (long format — does NOT exist in live DB)
`(timestamp_utc, source, column_name, value)` — must be eliminated everywhere.

### Frontend (already modern)
- React 19.2 + Vite 8 + TypeScript 5.9 + Tailwind v4
- **`@tanstack/react-query` v5.90.21 already wired** in `App.tsx` with 5-min `staleTime`, `refetchOnWindowFocus`, retry=1
- Charts: `lightweight-charts` v5 (TradingView), `echarts` v6
- API client: `fetchJson<T>()` in `dashboard/frontend/src/api/client.ts`, snake_case query params, fetch + JSON
- 27 client methods → 6 pages (Commodities, Electricity, ML, Scenarios, Forecast, Ancillary)

### Critical anti-patterns the plan must remove
1. **Long-format SQL with manual Python pivot** — `data_loader.py` `query_commodity` / `query_electricity` (lines 73–104). Reduces to a single wide `SELECT` with no Python loop.
2. **`sqlite_db.` table prefix** in all router SQL — drop entirely.
3. **`async def` routes calling sync I/O** — `forecast.py`, `ml.py`, `scenarios.py` (CSV/openpyxl/feather/lgb.Booster). Wrap in `fastapi.concurrency.run_in_threadpool` or `asyncio.to_thread`.
4. **`test_data_loader.py::test_query_commodity_by_date_range`** asserts long-format keys (`price_EUR_MWh_HHV`, `Gas_Mar`) — must be rewritten for wide schema.
5. **Glob assumes exactly one match** in 4 places (`forecast.py:33,74`, `scenarios.py:31`, `ml.py:129`) — at minimum, sort and pick latest deterministically.
6. **Dynamic response keys** — `commodities.py` builds `f"{key}_latest/_change/_date"`. **Frontend depends on these names** — preserve the naming, even though it's ugly.

### Allowed APIs (verified)
- DuckDB native: `duckdb.connect(path, read_only=True)`, parameterized SQL with `?`, `fetchdf()`, `fetchall()`, `register(name, df)`, `to_dict(orient="records")`
- DuckDB time functions: `EXTRACT(hour FROM timestamp_utc)`, `date_trunc('hour', timestamp_utc)`, `strftime(timestamp, '%Y-%m-%d %H:%M:%S')` (note: DuckDB arg order is `(timestamp, format)` — opposite of SQLite)
- FastAPI: `from fastapi.concurrency import run_in_threadpool`, `Response.headers["Cache-Control"]`, dependency injection via `Depends(get_engine)`
- Pydantic-settings: `BaseSettings` reads env vars by attribute name automatically

### Anti-APIs (do NOT use)
- `sqlite3.connect()` — never. Native DuckDB only.
- Long-format `WHERE source=? AND column_name=?` — schema doesn't have those columns.
- `INSTALL sqlite; LOAD sqlite; ATTACH '...' AS sqlite_db (TYPE sqlite, READ_ONLY)` — drop the entire SQLite extension dance.

---

## Phase 1 — Repo bootstrap (no code changes yet)

**Goal**: get a clean copy of the dashboard at `/Users/mayk/birdcurve-dashboard`, with git initialized, MIT license, `.gitignore`, and a stub README. No modernization yet.

### Tasks
1. From `/Users/mayk/birdcurve_nl`, materialize the `dashboard/` directory at branch `github/feature/dashboard` into `/Users/mayk/birdcurve-dashboard`:
   ```bash
   mkdir -p /Users/mayk/birdcurve-dashboard
   git --git-dir=/Users/mayk/birdcurve_nl/.git \
       archive github/feature/dashboard dashboard/ \
     | tar -x --strip-components=1 -C /Users/mayk/birdcurve-dashboard
   ```
   Verify: `find /Users/mayk/birdcurve-dashboard -type f | wc -l` → should be 59.
2. Write `/Users/mayk/birdcurve-dashboard/LICENSE` — verbatim MIT license, copyright "2026 Mayk Thewessen".
3. Write `/Users/mayk/birdcurve-dashboard/.gitignore` covering at minimum:
   ```
   # Python
   __pycache__/
   *.py[cod]
   .pytest_cache/
   .ruff_cache/
   *.egg-info/
   .venv/
   venv/
   .pixi/
   # Node / Vite
   node_modules/
   dist/
   .vite/
   # Editor / OS
   .DS_Store
   .idea/
   .vscode/
   # Local data (NEVER commit)
   data/
   *.duckdb
   *.db
   *.sqlite
   *.feather
   *.parquet
   model_results/
   .env
   .env.local
   ```
4. Write a stub `README.md` with placeholder sections; final content arrives in Phase 6.
5. `git init -b main && git add -A && git commit -m "Initial import from birdcurve_nl feature/dashboard"` — but **do not** create the remote yet. Push happens in Phase 6 only after smoke test passes.

### Verification
- `ls /Users/mayk/birdcurve-dashboard/dashboard/backend/app/main.py` exists.
- `git -C /Users/mayk/birdcurve-dashboard log --oneline` shows exactly one commit.
- `grep -r "secret\|api_key\|token" /Users/mayk/birdcurve-dashboard --exclude-dir=node_modules` returns nothing surprising.
- `du -sh /Users/mayk/birdcurve-dashboard` < 5 MB (no node_modules, no data).

### Anti-patterns
- DO NOT `cp -R` from a working tree — use `git archive` so we get exactly what's on the branch, no stray local edits.
- DO NOT push to GitHub yet.
- DO NOT initialize with `npm install` here — that lands in Phase 6.

---

## Phase 2 — Data layer: rewrite `data_loader.py` for native DuckDB + wide schema

**Goal**: replace the SQLite-attach pattern with a native DuckDB read-only connection, and replace `query_commodity` / `query_electricity` with wide-format helpers that are simpler and faster.

### File to edit
`/Users/mayk/birdcurve-dashboard/dashboard/backend/app/data_loader.py`

### Pattern to copy
```python
import duckdb
from pathlib import Path

class DataEngine:
    def __init__(self, settings):
        self._settings = settings
        # Connect to a transient DB; ATTACH the on-disk DuckDB read-only.
        # Why ATTACH not direct connect: lets us register temp tables for
        # forecast .feather files alongside on-disk data without touching it.
        self._conn = duckdb.connect()
        self._conn.execute(
            f"ATTACH '{settings.duckdb_path}' AS db (READ_ONLY)"
        )
        self._conn.execute("USE db")
        # Optional: pin tz to UTC per project convention
        self._conn.execute("SET TimeZone='UTC'")

        self._model_dir = settings.model_results_dir
        self._latest_production = self._find_latest_dir("Production_Ensemble_")
        self._forecast_dirs = self._discover_forecasts()
        self._small_files_cache = {}
        self._load_small_files()
```

### New wide-format query helpers
Replace `query_commodity` and `query_electricity` with one general method:
```python
def query_wide(
    self,
    table: str,
    columns: list[str],
    start: str | None = None,
    end: str | None = None,
    timestamp_col: str = "timestamp_utc",
) -> list[dict]:
    """Select named wide-schema columns + timestamp, optionally filtered by range."""
    quoted = ", ".join(f'"{c}"' for c in columns)
    where, params = [], []
    if start is not None:
        where.append(f'"{timestamp_col}" >= ?')
        params.append(start)
    if end is not None:
        where.append(f'"{timestamp_col}" <= ?')
        params.append(end)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f'SELECT "{timestamp_col}", {quoted} FROM {table} {where_sql} ORDER BY "{timestamp_col}"'
    return self._conn.execute(sql, params).fetchdf().to_dict(orient="records")
```

Keep `query()` and `query_forecast_file()` largely as-is (forecast file loading still needs the pandas+register dance for `.feather`).

### `config.py` updates
**File**: `/Users/mayk/birdcurve-dashboard/dashboard/backend/app/config.py`

Replace the SQLite-finding logic with env-var-driven DuckDB path:
```python
class Settings(BaseSettings):
    # Required at runtime; user supplies via BIRDCURVE_DUCKDB_PATH env var
    # or a .env file. Default points to the development location used during
    # extraction so `make dev` works on the original maintainer's box.
    duckdb_path: Path = Path("/Users/mayk/birdcurve_nl/data/birdcurve.duckdb")
    model_results_dir: Path = Path("/Users/mayk/birdcurve_nl/model_results")
    api_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:5173"]
    default_max_points_hourly: int = 5000
    default_max_points_15min: int = 10000

    model_config = SettingsConfigDict(env_prefix="BIRDCURVE_", env_file=".env", extra="ignore")
```
Add `from pydantic_settings import SettingsConfigDict` to imports. Remove `_find_project_root()` entirely — env vars and explicit defaults beat path-walking heuristics.

### Verification
- `python -c "from app.data_loader import DataEngine; from app.config import get_settings; e = DataEngine(get_settings()); print(e.query_wide('ts_daily', ['Gas_TTF__price', 'CO2_EUA__price'], '2025-01-01', '2025-01-10')[:2])"` returns rows with keys `{timestamp_utc, Gas_TTF__price, CO2_EUA__price}`.
- `grep -RIn "sqlite_db\|sqlite3\|TYPE sqlite\|INSTALL sqlite" dashboard/backend/app/` returns **nothing**.
- `grep -RIn "column_name\|source = ?" dashboard/backend/app/data_loader.py` returns **nothing** (long-format gone).

### Anti-patterns
- DO NOT reintroduce a long→wide pivot loop in Python. The whole point is that wide rows ARE the API response shape.
- DO NOT hardcode column names inside `query_wide` — keep it generic; routers pass columns.
- DO NOT remove the temp-table register path used by `query_forecast_file` for `.feather` files; it still works against native DuckDB.

---

## Phase 3 — Router SQL migration

**Goal**: rewrite SQL in the three schema-touching routers (`health.py`, `commodities.py`, `electricity.py`) plus the one query in `ml.py`. Preserve all response shapes (frontend depends on them).

### 3a. `health.py`
**File**: `dashboard/backend/app/routers/health.py`

- Replace each count query: `SELECT COUNT(*) FROM sqlite_db.ts_X` → `SELECT COUNT(*) FROM ts_X` (drop the `sqlite_db.` prefix).
- Rename response field `sqlite_tables` → `db_tables` in both `models.py` (`HealthResponse`) and the router. Preserve the dict shape `{table_name: row_count}`.

### 3b. `commodities.py`
**File**: `dashboard/backend/app/routers/commodities.py`

For `/commodities`:
- Build a column list per requested commodity from a constant map at module top:
  ```python
  COMMODITY_COLUMNS = {
      "gas_ttf": "Gas_TTF__price",
      "co2_eua": "CO2_EUA__price",
      # coal_api2 / eur_usd intentionally omitted: not in current DuckDB ts_daily
      # (they exist on disk as CSVs but were not migrated). Add when present.
  }
  ```
  Cross-check with Phase 0 fact dump: only `Gas_TTF__price` and `CO2_EUA__price` are in `ts_daily`. The branch's `Coal_API2` and `EUR_USD` series are **not in the live DuckDB**. Either: (a) drop those keys from the response and update the frontend shape, OR (b) return empty arrays for them. **Pick (b)** to preserve frontend contract — the page degrades gracefully.
- Single call: `engine.query_wide("ts_daily", list(COMMODITY_COLUMNS.values()), start, end)`
- Reshape to per-series arrays: for each commodity key, build `[{date: row["timestamp_utc"][:10], value: row[col]} for row in rows if row[col] is not None]`. (Wide → per-series unpacking, but in a single pass — no nested loops.)
- For `include_marginal=true`: keep computing `gas_marginal = gas_ttf / 0.40 + co2 * 0.400` and `coal_marginal` similarly **only if both inputs are present**, otherwise empty array.

For `/commodities/kpi`:
- Replace per-commodity `SELECT timestamp_utc, value FROM sqlite_db.ts_daily WHERE source=? AND column_name=? ORDER BY timestamp_utc DESC LIMIT 2` with a single wide query:
  ```sql
  SELECT timestamp_utc, "Gas_TTF__price", "CO2_EUA__price"
  FROM ts_daily
  ORDER BY timestamp_utc DESC
  LIMIT 2
  ```
  Then compute `*_latest`, `*_change`, `*_date` from the two rows in Python.
- **Preserve dynamic key naming** — frontend reads `kpiData[`${key}_latest`]` etc.

### 3c. `electricity.py`
**File**: `dashboard/backend/app/routers/electricity.py`

For `/historical`:
- Replace the supply aggregation SQL with a wide query against `ts_15min`, then 15-min → hourly rollup in DuckDB (no Python loop):
  ```sql
  SELECT
      date_trunc('hour', timestamp_utc) AS hour,
      AVG("Load_NL__Actual_Load_MW")        AS load,
      AVG("NED_PV__PV")                     AS pv,
      AVG("NED_Wind_Onshore__Wind_Onshore") AS wind_onshore,
      AVG("NED_Wind_Offshore__Wind_Offshore") AS wind_offshore,
      AVG("CrossBorder_NL__Total_Net")      AS import
  FROM ts_15min
  WHERE timestamp_utc >= ? AND timestamp_utc <= ?
  GROUP BY 1
  ORDER BY 1
  ```
  This returns the response shape directly — no pivot needed.
- For `da_prices`, use `engine.query_wide("ts_hourly", ["DA_price__DA_price"], start, end)` then map `[{timestamp: ..., value: row["DA_price__DA_price"]}]`.
- LTTB downsampling: keep using `dashboard/backend/app/downsampling.py` unchanged — it already operates on `[{x, y}]` lists.

For `/duration-curve`:
```sql
SELECT "DA_price__DA_price" AS value
FROM ts_hourly
WHERE timestamp_utc >= ? AND timestamp_utc < ?
  AND "DA_price__DA_price" IS NOT NULL
ORDER BY value DESC
```

For `/heatmap`:
```sql
SELECT
    EXTRACT(month FROM timestamp_utc) AS month,
    EXTRACT(hour  FROM timestamp_utc) AS hour,
    AVG("DA_price__DA_price") AS avg_price
FROM ts_hourly
WHERE timestamp_utc >= ? AND timestamp_utc < ?
  AND "DA_price__DA_price" IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2
```
DuckDB's `EXTRACT(... FROM timestamp_utc)` works directly on the TIMESTAMP column — no `::TIMESTAMP` cast needed.

### 3d. `ml.py` — only the historical price-distributions branch
**File**: `dashboard/backend/app/routers/ml.py`

Replace the historical SQL block in `/price-distributions` with:
```sql
SELECT
    EXTRACT(year FROM timestamp_utc) AS year,
    "DA_price__DA_price" AS value
FROM ts_hourly
WHERE "DA_price__DA_price" IS NOT NULL
ORDER BY timestamp_utc
```
Everything else in `ml.py` stays.

### Verification
- `grep -RIn "sqlite_db\." dashboard/backend/app/routers/` returns **nothing**.
- `grep -RIn "WHERE source\b\|column_name\b" dashboard/backend/app/routers/` returns **nothing** (long-format eradicated).
- Smoke each endpoint manually with `curl localhost:8000/api/health` etc. once the backend boots in Phase 6.

### Anti-patterns
- DO NOT change response field names that the frontend reads (e.g. `gas_ttf`, `da_prices`, `supply`, `sorted_prices`, `*_latest/_change/_date`). The one allowed rename is `sqlite_tables → db_tables` (also update frontend if it consumes it — verify via `grep -RIn sqlite_tables dashboard/frontend/src/`).
- DO NOT introduce SQLite-specific syntax (`julianday`, single-arg `strftime`, `||` for non-string concat).
- DO NOT add a Python loop where a single SQL `GROUP BY` does the work.

---

## Phase 4 — Async + snappy

**Goal**: stop the event loop blocking on file I/O, add HTTP cache headers for immutable historical data.

### 4a. Wrap blocking I/O
For each location flagged in Phase 0 fact dump (F.3):
- `forecast.py::get_da_forecast` — wrap `open()` + CSV parse in `await run_in_threadpool(...)`
- `forecast.py::get_annual_stats` — wrap `openpyxl.load_workbook(...)` similarly
- `scenarios.py::get_scenario` — wrap CSV read
- `ml.py::_get_feature_importance` — wrap `lgb.Booster(model_file=...)`
- `ml.py::get_correlation_matrix` — wrap `pd.read_feather(...)` + correlation compute
- `ml.py::get_price_distributions` (forecast branch) — wrap KDE compute + feather load
- `ancillary.py` — wrap any `pd.read_feather` / file glob path that hits disk

Pattern:
```python
from fastapi.concurrency import run_in_threadpool

async def get_annual_stats(scenario: str, engine: DataEngine = Depends(get_engine)):
    payload = await run_in_threadpool(_load_annual_stats_sync, engine, scenario)
    return payload

def _load_annual_stats_sync(engine, scenario):
    # original sync code moves here verbatim
    ...
```

DuckDB query calls in routers are fast enough to leave on the event loop (DB returns in ms, no need to threadpool every query). Only wrap calls that touch the filesystem outside DuckDB.

### 4b. HTTP cache headers
Add `Cache-Control` headers for endpoints whose data is immutable for old dates. Helper:
```python
# dashboard/backend/app/routers/_helpers.py
def add_cache_headers(response: Response, end_date: str | None, today_iso: str):
    """Long cache for fully-historical queries; short cache for recent."""
    if end_date and end_date < today_iso:
        response.headers["Cache-Control"] = "public, max-age=86400, immutable"
    else:
        response.headers["Cache-Control"] = "public, max-age=300"
```
Apply to: `/commodities`, `/commodities/kpi` (max-age=300), `/electricity/historical`, `/electricity/duration-curve`, `/electricity/heatmap`, `/forecast/*`, `/ancillary/capacity`. Skip `/health`.

### Verification
- `grep -RIn "run_in_threadpool\|asyncio.to_thread" dashboard/backend/app/routers/ | wc -l` ≥ 6.
- `curl -I localhost:8000/api/electricity/historical?start=2024-01-01&end=2024-01-31` shows `Cache-Control: public, max-age=86400, immutable`.
- Quick concurrency check: `for i in {1..10}; do curl -s localhost:8000/api/forecast/annual-stats?scenario=v17_Central -o /dev/null & done; wait` finishes in roughly the time of one request, not 10×.

### Anti-patterns
- DO NOT wrap DuckDB query calls themselves in `run_in_threadpool` blanket-fashion — adds latency for nothing.
- DO NOT cache endpoints that always reflect "now" (`/health`, anything reading the latest forecast directory listing).
- DO NOT add ETag/Last-Modified — overkill for this scope; `Cache-Control` is sufficient.

---

## Phase 5 — Tests

**Goal**: keep the existing pytest suite as the safety net. Update only what the schema migration broke.

### Tasks
1. **Fix `test_data_loader.py::test_query_commodity_by_date_range`** — replace the long-format assertion with a wide-format one targeting `query_wide`:
   ```python
   def test_query_wide_returns_columns(settings):
       engine = DataEngine(settings)
       rows = engine.query_wide("ts_daily", ["Gas_TTF__price", "CO2_EUA__price"], "2024-01-01", "2024-01-31")
       assert len(rows) > 10
       sample = rows[0]
       assert "timestamp_utc" in sample
       assert "Gas_TTF__price" in sample
       assert "CO2_EUA__price" in sample
   ```
2. **Update `test_engine_connects_to_sqlite` → `test_engine_connects_to_duckdb`** — same shape, different table count assertion.
3. **`test_health_shows_data_loaded`** — if `sqlite_tables` field renamed to `db_tables`, update assertion key.
4. **`test_commodities_returns_data`** — current assertion `len > 100` may fail if `coal_api2` / `eur_usd` keys return empty arrays. Either tighten to specific present keys (`gas_ttf`, `co2_eua`) or assert nullable presence.
5. **`conftest.py`** — fixture currently relies on `get_settings()` which reads from env vars / defaults. Verify the dev default (`BIRDCURVE_DUCKDB_PATH=/Users/mayk/birdcurve_nl/data/birdcurve.duckdb`) lets tests find the DB. If not, set it explicitly in `conftest.py` via `monkeypatch` or `os.environ`.

### Run
```bash
cd /Users/mayk/birdcurve-dashboard/dashboard
make install-backend
BIRDCURVE_DUCKDB_PATH=/Users/mayk/birdcurve_nl/data/birdcurve.duckdb make test-backend
```

### Verification
- All tests pass except those that require a forecast directory whose data we don't ship — those should be marked `pytest.skipif(not engine.available_scenarios, reason="...")`.
- No test imports `sqlite3`.
- `pytest -k "not (annual or forecast or scenario or ml)" -v` (the DB-only subset) passes cleanly first.

### Anti-patterns
- DO NOT delete tests because they fail. Either fix or `skipif` with a clear reason. Each removal/skip needs a one-line reason comment.
- DO NOT introduce mocks for the DuckDB layer; integration against the real (read-only) DB is the right approach for this project.

---

## Phase 6 — Smoke test, README, publish

**Goal**: prove `make dev` boots, the frontend renders, then push to a brand-new public GitHub repo.

### Tasks
1. **Backend smoke**:
   ```bash
   cd /Users/mayk/birdcurve-dashboard/dashboard
   BIRDCURVE_DUCKDB_PATH=/Users/mayk/birdcurve_nl/data/birdcurve.duckdb \
     make backend &
   sleep 3
   curl -fsS localhost:8000/api/health | jq .
   curl -fsS "localhost:8000/api/commodities?start=2024-01-01&end=2024-01-31" | jq '.gas_ttf | length'
   curl -fsS "localhost:8000/api/electricity/duration-curve?year=2024" | jq '.total_hours'
   kill %1
   ```
   All three must succeed. If the second one fails, suspect Phase 3b column-mapping; the third tests Phase 3c.
2. **Frontend smoke**:
   ```bash
   cd /Users/mayk/birdcurve-dashboard/dashboard
   make install-frontend
   make dev   # or: make backend & make frontend & — full duo
   ```
   Open `http://localhost:5173` in the browser. Click through Commodities, Electricity, ML pages. Verify charts render and the Network tab shows 200s. Capture any frontend errors and fix.
3. **README** (`/Users/mayk/birdcurve-dashboard/README.md`):
   Cover: what it is (one-paragraph pitch), screenshots placeholder, architecture (FastAPI + React + DuckDB), quickstart (`make install-backend`, `make install-frontend`, `BIRDCURVE_DUCKDB_PATH=… make dev`), config (env vars: `BIRDCURVE_DUCKDB_PATH`, `BIRDCURVE_MODEL_RESULTS_DIR`, `BIRDCURVE_CORS_ORIGINS`), schema requirement (link Phase 0 wide-format spec), license (MIT).
   **Hand the pitch & feature bullets back to the human** — do not ghostwrite the marketing copy. Leave a `<!-- TODO: pitch -->` block at the top.
4. **Commit modernization**:
   ```bash
   git -C /Users/mayk/birdcurve-dashboard add -A
   git -C /Users/mayk/birdcurve-dashboard commit -m "Modernize to native DuckDB + wide schema, async I/O, HTTP caching"
   ```
5. **Create public repo and push** — only after smoke tests pass:
   ```bash
   gh repo create MaykThewessen/birdcurve-dashboard \
     --public \
     --source /Users/mayk/birdcurve-dashboard \
     --description "Interactive dashboard for Dutch electricity market data and BirdCurve NL price forecasts" \
     --remote origin \
     --push
   ```

### Verification
- `gh repo view MaykThewessen/birdcurve-dashboard --json url,visibility,description` shows `"visibility":"public"`.
- `git -C /Users/mayk/birdcurve-dashboard log --oneline` shows ≥ 2 commits, all pushed.
- A fresh clone in `/tmp/test-clone/` followed by `make install-backend && make install-frontend && BIRDCURVE_DUCKDB_PATH=/Users/mayk/birdcurve_nl/data/birdcurve.duckdb make dev` boots cleanly.

### Anti-patterns
- DO NOT push before smoke tests pass. Public history is hard to scrub.
- DO NOT include any data file, even a "small sample" — explicit "bring your own DB" is cleaner. We can add a synthetic-data generator script in a follow-up if desired.
- DO NOT ghostwrite the README pitch — the human shapes positioning. Leave a marked TODO block.

---

## Final cross-phase checks

Before declaring done, run from `/Users/mayk/birdcurve-dashboard/dashboard`:
```bash
# Anti-pattern grep — all must return nothing
grep -RIn "sqlite_db\.\|sqlite3\|TYPE sqlite\|INSTALL sqlite" backend/
grep -RIn "WHERE source\b\|column_name = ?" backend/

# Async hygiene — count of threadpool wraps in routers (target: ≥ 6)
grep -RIn "run_in_threadpool\|asyncio.to_thread" backend/app/routers/ | wc -l

# Tests
BIRDCURVE_DUCKDB_PATH=/Users/mayk/birdcurve_nl/data/birdcurve.duckdb make test-backend

# Repo hygiene
git -C /Users/mayk/birdcurve-dashboard ls-files | grep -E "\.(duckdb|db|sqlite|feather|parquet)$"   # must be empty
```

If all checks pass → done.
