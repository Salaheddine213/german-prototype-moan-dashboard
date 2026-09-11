# German Electricity Market Analytics

Interactive dashboard for the **German electricity market**: day-ahead prices, load/demand, renewable generation, cross-border flows, commodity-driven marginal costs, ancillary services, forecasts out to 2050, ML model diagnostics and scenario assumptions.

<details data-file-tree>
<summary>Documentation</summary>

- :material-book-open-page-variant: **[Overview](overview.md)** — tour of the six pages and what each one shows
- :material-sitemap: **[Architecture](architecture.md)** — FastAPI + DuckDB backend, React 19 + Vite frontend
- :material-rocket-launch: **[Deployment](deployment.md)** — build, run, ship locally or in CI
- :material-api: **[API reference](reference/index.md)** — auto-generated docs for every backend module

</details>

## Quick start

```bash
git clone https://github.com/<you>/birdcurve-germany
cd birdcurve-germany/dashboard
make install   # backend venv + npm install
make dev       # backend :8000, frontend :5173
```

Backend serves on `:8000`, frontend on `:5173`. The default **demo mode** needs no data — a clearly-labelled synthetic German market dataset is generated at startup.