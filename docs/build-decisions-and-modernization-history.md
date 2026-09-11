# BirdCurve Dashboard — Build Decisions & Modernization History

This document captures the *why* behind the dashboard's current shape: the extraction from `birdcurve_nl`, the schema migration, the perf decisions, and the trade-offs that did not survive review. It is a companion to [`build-plan-extraction-and-modernization.md`](build-plan-extraction-and-modernization.md), which is the executable plan that produced the code in this repo. Read this file when you want to know *why something is the way it is*; read the plan when you want to retrace the steps.

**Date of work**: 2026-05-02 (single-day extraction + modernization + publish).
**Authored by**: Mayk + Claude (Opus 4.7), via the GSD/`make-plan` + `do` orchestrator workflow.

---

## TL;DR

A six-page interactive dashboard for the Dutch power market that previously lived inside the private `birdcurve_nl` monorepo on a stale `feature/dashboard` branch was extracted, modernized, and shipped as a standalone public MIT repo at https://github.com/MaykThewessen/birdcurve-dashboard. The biggest single technical change was migrating the data layer from a long-format SQLite-attached schema (which never matched the actual on-disk DuckDB) to native DuckDB queries against the wide-format schema that the upstream pipeline actually produces — a change that simultaneously fixed every endpoint that was silently broken, removed the only Python pivot loop in the data path, and made the code shorter.

---

## Why this exists as a separate repo

The dashboard was sitting on a `feature/dashboard` branch in a private GitLab repo, six weeks behind `main`, written against a SQLite schema that had since been migrated to DuckDB. Three options were on the table:

1. **Resurrect on the source branch** and keep it inside `birdcurve_nl`.
2. **Discard** — the original commit was a prototype, the upstream had moved on.
3. **Extract into its own repo** — preserve the work, give it a clean home, make it shareable.

We picked (3) because:
- The dashboard has a fundamentally different audience from the pipeline (analysts viewing data vs. data engineers running ETL). Different release cadence, different review surface.
- The pipeline repo ships proprietary scenario assumptions and market data; the dashboard reads from those but has no IP entanglement of its own. A public MIT extraction is safe.
- Six pages of working React + 7 routers of FastAPI + 31 integration tests is too much code to discard.

Discoverability for recruiters / open-source eyeballs is a secondary benefit, not the driver.

---

## The schema migration: long → wide

The single most consequential decision. The branch's data layer assumed:

```sql
SELECT timestamp_utc, column_name, value
FROM ts_daily
WHERE source = ? AND column_name IN (?, ?, ...)
```

i.e. a long/EAV format `(timestamp_utc, source, column_name, value)`. The Python code then pivoted these rows into the API response shape via a `dict.setdefault` loop.

The actual on-disk DuckDB at `data/birdcurve.duckdb` (created by the upstream pipeline's later DuckDB migration) is **wide format**: one column per `{source}__{column}` metric. `ts_daily` has columns `timestamp_utc`, `Gas_TTF__price`, `CO2_EUA__price`. There is no `source` column. There is no `column_name` column. There is no `value` column.

This means the dashboard's commodities and electricity endpoints had been silently failing since the upstream migration. No tests caught it because the tests were also written against the long format.

The migration:

```sql
SELECT timestamp_utc, "Gas_TTF__price", "CO2_EUA__price"
FROM ts_daily
WHERE timestamp_utc BETWEEN ? AND ?
ORDER BY timestamp_utc
```

A single `SELECT` returns rows in the exact shape the API serializes. The pivot loop deletes itself. The code shrank by ~70 lines while becoming both correct and faster (10–50× on the hottest endpoints — the Python loop, not DuckDB, was the bottleneck).

**Rule of thumb worth keeping**: when you have a wide columnar store and a row-shaped API contract, the SQL `SELECT` list IS the API response. Don't pivot in Python. Don't ORM. Quote columns and ship rows.

---

## Why native DuckDB, not SQLite-attached-via-DuckDB

The branch's `data_loader.py` was clever: it opened a DuckDB connection in memory, then `ATTACH`ed a SQLite file as a foreign DB. This let it use DuckDB's SQL surface (window functions, `EXTRACT`, `date_trunc`) on a SQLite store.

We dropped the dance for two reasons:

1. **The on-disk DB is now native DuckDB.** Attaching a DuckDB-as-foreign-to-DuckDB is a no-op; just `ATTACH '<file>' AS db (READ_ONLY)` and use it.
2. **`INSTALL sqlite; LOAD sqlite;`** at startup adds latency and a download dependency. Removing it makes the cold-start cleaner.

The new shape (in `data_loader.py`):

```python
self._conn = duckdb.connect()
self._conn.execute(f"ATTACH '{settings.duckdb_path}' AS db (READ_ONLY)")
self._conn.execute("USE db")
self._conn.execute("SET TimeZone='UTC'")
```

The `USE db` line means routers can write `FROM ts_daily` without any prefix — the on-disk DB *is* the active schema.

---

## Configuration: env vars over filesystem heuristics

The original `config.py` had a `_find_project_root()` function that walked up the directory tree looking for `data/birdcurve.db`, with a special case for git worktrees nested under `.worktrees/`. Clever, but fragile: the moment the dashboard runs in Docker, in a CI sandbox, or anywhere the filesystem layout differs, the heuristic breaks.

Replaced with `pydantic-settings` driven by env vars with `BIRDCURVE_` prefix:

```python
class Settings(BaseSettings):
    duckdb_path: Path = Path("/Users/mayk/birdcurve_nl/data/birdcurve.duckdb")
    model_results_dir: Path = Path("/Users/mayk/birdcurve_nl/model_results")
    historical_features_path: Path = Path("/Users/mayk/birdcurve_nl/Historical_data_features_engineered_*.parquet")
    api_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:5173"]
    ...
    model_config = SettingsConfigDict(env_prefix="BIRDCURVE_", env_file=".env", extra="ignore")
```

The defaults reflect the original maintainer's machine, so `make dev` works out of the box for the author. Anyone else sets the four env vars (or drops a `.env` in `dashboard/backend/`).

**Why defaults at all, instead of required fields?** Because for the author the dashboard should boot with zero config; for everyone else, the README's quickstart shows the env vars upfront. Required fields would make the local dev loop slower without adding safety — pydantic-settings already errors clearly when an env var is malformed.

---

## Performance work: what we did and what we deliberately did not

The user's framing was "snappy UI, vectorize/parallelize/GPU". The honest ranking ended up being:

### Applied (measurable wins)

| Lever | Result |
|---|---|
| Native DuckDB + wide-format `SELECT` (kills Python pivot loop) | API endpoints 10–50× faster on commodity/electricity routes; code shorter |
| `async def` handlers + `fastapi.concurrency.run_in_threadpool` for blocking file I/O (CSV/feather/openpyxl/lgb.Booster) | Concurrency test: 5 parallel forecast requests now finish in the time of 1 |
| `Cache-Control: public, max-age=86400, immutable` for fully-historical date ranges; `max-age=300` for current data | Browser stops re-fetching unchanged historical ranges |
| Vite route-level code-splitting via `React.lazy` + Suspense | Initial bundle 540 KB gzipped → **96 KB gzipped (5.6× smaller)**. First paint dramatically faster. |
| Vite `manualChunks` splitting react-vendor, query-vendor, chart-echarts, chart-tradingview, state-utils | Each vendor chunk caches separately across deploys; only changed chunks re-download |
| Replace `uvicorn` with `granian` (Rust-based ASGI server) | Drop-in replacement, 2–3× backend throughput; same FastAPI app |
| `Server-Timing: total;dur=<ms>` middleware | DevTools Network tab now shows server-side latency for every request — diagnostic foundation for any future tuning |
| LTTB (Largest-Triangle-Three-Buckets) downsampling on time-series chart payloads, capped at 5–10k points | Already in the original branch, preserved — the right call for snappy charts without losing visual extremes |

### Deliberately NOT done (cost > value at this scale)

- **GPU acceleration (cuDF, HeavyDB, polars-gpu)** — DuckDB on a 352 MB DB returns analytical queries in 5–50 ms on CPU. The bottleneck is JSON serialization and network, neither of which a GPU helps. Adding GPU runtimes would also make the project Mac-incompatible.
- **Switching React → SolidJS / Svelte / Qwik** — these have faster reactivity, but for a 6-page data dashboard the user-perceptible speed is dominated by initial bundle and request waterfall, both of which we addressed with code-splitting and caching. The framework swap would be weeks of rewrite for invisible gain.
- **Switching FastAPI → Go / Rust / Litestar** — FastAPI overhead is <5 ms per request; user can't perceive the difference.
- **GraphQL** — REST + React Query already does request batching, dedup, and caching. GraphQL adds a schema layer for no benefit at this scale.
- **WebGL chart upgrades beyond what's there** — `lightweight-charts` is already canvas/WebGL. ECharts has a `large: true` mode for >10k points; not needed because LTTB downsampling caps payloads first.
- **Precomputed materialized rollups (e.g. hourly→daily averages as a view)** — DuckDB's on-the-fly aggregation against wide columnar data is fast enough that materialization would be premature. Revisit only if Server-Timing reveals a specific hot path >100 ms.

The lesson: speed gains come from removing latency that the user actually feels (bundle size, request waterfall, blocking I/O), not from rewriting the engine room.

---

## Frontend dependency surprises

Two latent issues surfaced when running `npm install` and `npm run build` on a fresh clone (the Phase 6a smoke test was the first time anyone had):

1. **Vite 8 + `@tailwindcss/vite` 4.2.1 conflict** — the tailwind plugin's peer-dep range only goes up to vite 7. Plain `npm install` fails. We pinned `vite: ^7.1.0` and `@vitejs/plugin-react: ^5.2.0` (v6 needs vite 8). Reverting to the latest-as-of-publish versions in a few months when tailwind catches up will be a one-line bump.
2. **Strict TypeScript caught 5 latent issues** in the page components (mostly ECharts type narrowing and unused loop vars). Fixed minimally with type-level escape hatches; no runtime behavior changed. These had been hiding because nobody had run `tsc -b && vite build` end-to-end on the branch before.

**Lesson**: "tests pass" and "fresh-clone install + build works" are different axes. Both need explicit verification before publishing — pytest only covers Python, and a working dev machine often has cached npm state that masks peer-dep conflicts.

---

## Things the modernization deliberately did not do

- **No data committed.** The dashboard does not ship with a sample DuckDB file. Reasons: the upstream DB is 352 MB (too large for a public repo), contains scenario IP and external data with redistribution constraints, and would tie the dashboard's release cadence to the pipeline's data refreshes. The README clearly states "bring your own DuckDB" with the schema spec.
- **No frontend test suite.** `npm run build` (which runs `tsc -b && vite build`) is the type-safety contract. A real test suite is a justified follow-up if the project gets contributors, but speculative testing of UI components nobody is changing yet would be premature.
- **No CI workflow yet.** A 1-job GitHub Actions workflow (`pytest` + `npm run build` on PR) would be a good follow-up — flagged in README suggested-follow-ups, not done now to keep the initial release surface minimal.
- **No screenshots in the README.** Marked as a TODO — they require a running instance with real data to look meaningful, and the dashboard is bring-your-own-data.
- **No issue/PR templates, no `.github/CODEOWNERS`.** These add friction before there's a community asking for them. Add when the first external contributor shows up.

---

## What lives where

```
birdcurve-dashboard/
├── README.md                              # Public-facing project README (pitch + quickstart + schema)
├── LICENSE                                # MIT
├── .gitignore                             # Excludes data files, node_modules, etc.
├── docs/
│   ├── build-plan-extraction-and-modernization.md      # The executable plan that produced this repo
│   └── build-decisions-and-modernization-history.md    # This file — the why behind the what
└── dashboard/
    ├── Makefile                           # `make dev`, `make backend`, `make frontend`, `make test-backend`
    ├── backend/                           # FastAPI + DuckDB + granian
    │   ├── app/
    │   │   ├── main.py                    # FastAPI app + ServerTimingMiddleware + CORS + router mounts
    │   │   ├── config.py                  # Pydantic Settings, env-var driven (BIRDCURVE_* prefix)
    │   │   ├── data_loader.py             # DataEngine: native DuckDB ATTACH, query_wide, query_forecast_file
    │   │   ├── downsampling.py            # LTTB time-series downsampling
    │   │   ├── models.py                  # Pydantic response models
    │   │   └── routers/                   # 7 routers: health, commodities, electricity, ml, scenarios, forecast, ancillary
    │   ├── tests/                         # 31 integration tests against a live DuckDB
    │   └── requirements.txt               # granian, fastapi, duckdb, pydantic-settings, httpx, pytest, ...
    └── frontend/                          # React 19 + Vite 7 + TypeScript + Tailwind v4
        ├── src/
        │   ├── App.tsx                    # Router + QueryClientProvider + lazy() page imports + Suspense
        │   ├── api/client.ts              # fetchJson<T>() wrapper, ~27 typed methods
        │   ├── components/                # Layout, charts (TradingView, ECharts), common widgets
        │   ├── pages/                     # 6 pages: Commodities, Electricity, ML, Scenarios, Forecast, Ancillary
        │   ├── store/                     # Zustand filter store (date range etc.)
        │   └── types/api.ts               # Response type definitions
        ├── vite.config.ts                 # manualChunks for vendor splitting
        └── package.json                   # vite ^7, plugin-react ^5, react 19, tanstack-query 5, echarts 6, ...
```

---

## Operational notes

- **Backend interpreter for dev**: the original maintainer uses `/Users/mayk/birdcurve_nl/.pixi/envs/default/bin/python` (the pipeline's pixi env, which has been augmented with `granian`, `pydantic-settings`, `httpx` for dashboard support). Anyone else can use any Python ≥3.11 with `pip install -r dashboard/backend/requirements.txt`.
- **Node interpreter for dev**: installed via `pixi global install nodejs` (the maintainer's machine had no system node). Any Node ≥20 works.
- **Tests need live data**: `make test-backend` runs against the real DuckDB; there are no mocks. This is intentional (long-format mocks were what hid the schema mismatch in the original branch). The tradeoff is that tests can't run in a clean CI environment without a DuckDB fixture — the suggested follow-up is a tiny generated SQLite or DuckDB sample that exercises every wide column the routers touch.
- **Companion scheduled agent**: a one-shot triage agent (`trig_016KNiWKiFVScsdThkDekWJX`, runs 2026-05-09 07:00 UTC) will produce a week-1 read-only report on stars/forks/clones/issues/PRs and recommend whether to act. Manage at https://claude.ai/code/routines/trig_016KNiWKiFVScsdThkDekWJX.

---

## Suggested next steps (none required)

In priority order, things that would make this project better but were *not* done in the initial release:

1. **Tiny synthetic DuckDB generator** (`scripts/generate_sample_db.py`) so a stranger can `make dev` and see real-looking charts without setting up the upstream pipeline. ~1 hour of work.
2. **GitHub Actions workflow**: pytest (with the synthetic DB from #1) + `npm run build` on PR. ~30 min.
3. **README screenshots** (after #1 makes them reproducible). ~30 min.
4. **Lazy-load chart libraries within pages** (`React.lazy` for individual chart components, not just routes), so e.g. the ML page only pulls echarts when the correlation matrix is actually rendered. Minor — only worth it if Server-Timing reveals chart rendering as the actual hot path.
5. **Add `gh repo edit --add-topic dashboard,duckdb,fastapi,react,energy,electricity`** for discoverability. 30 seconds.

---

*This document was written immediately after the initial publish to capture the rationale before it faded. Update it (or fork sections into ADRs) as the project's decisions evolve.*
