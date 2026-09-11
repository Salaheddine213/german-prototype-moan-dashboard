# Deployment

## Local development

All tooling is driven by `dashboard/Makefile` (it prefers the venv at
`dashboard/backend/.venv` and falls back to a pixi global env):

```bash
cd dashboard
make install          # backend venv + pip deps + frontend npm install
make dev              # backend (:8000, granian) + frontend (:5173, vite) concurrently
```

Backend env (see `dashboard/backend/.env.example` for the full list, all `MARKET_*`):

- `MARKET_DUCKDB_PATH` — read-only DuckDB file; **unset = demo mode** (synthetic German data)
- `MARKET_MODEL_RESULTS_DIR` — model/forecast run directories (demo artifacts in `demo_artifacts/demo`)
- `MARKET_HISTORICAL_FEATURES_PATH` — engineered-features glob (correlation matrix)
- `MARKET_EUR_USD_PATH`, `MARKET_COAL_API2_PATH` — optional sidecar CSV globs
- `MARKET_CORS_ORIGINS` — JSON list of allowed frontend origins

## Tests

```bash
cd dashboard
make test-backend                    # backend tests, run in demo mode — no live data needed

cd frontend
npm run lint
npm run build                        # tsc -b + vite build = the API contract check
```

CI (`.github/workflows/ci.yml`) runs the frontend lint + build and the
full backend test suite on every push and pull request. Because the tests
run against the synthetic demo dataset, contributors and CI never need to
supply proprietary data files.

## Docs site (this site)

Built with **MkDocs Material** + **mkdocstrings**. Two deploy targets are configured:

### GitHub Pages (primary)

`.github/workflows/docs.yml` builds on every push to `main` and deploys via `actions/deploy-pages@v4`. Update `mkdocs.yml`'s `site_url`/`repo_url` to your own GitHub Pages URL.

### ReadTheDocs (mirror)

`.readthedocs.yaml` at repo root tells RTD how to build the same site. Connect the repo on readthedocs.org once and it will publish to its own `birdcurve-germany.readthedocs.io` subdomain.

### Local build

```bash
pip install -r docs/requirements.txt
# Backend dev server already uses :8000 — bind docs to :8001 to avoid clashing.
mkdocs serve -a 127.0.0.1:8001    # live-reload dev server
mkdocs build --strict             # production build to ./site, fails on warnings
```