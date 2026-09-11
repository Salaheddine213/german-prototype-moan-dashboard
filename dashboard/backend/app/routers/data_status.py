"""Data freshness / provenance — surfaces what was last ingested for each source."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool

from ._helpers import iso_utc

router = APIRouter(prefix="/data-status", tags=["data-status"])


def _data_status_sync(engine) -> dict:
    rows = engine.query(
        """
        SELECT table_name, source,
               MAX(timestamp_utc) AS latest_data_utc,
               MAX(ingested_at)   AS last_ingest_utc,
               COUNT(*)           AS rows_total
        FROM provenance
        GROUP BY table_name, source
        ORDER BY MAX(timestamp_utc) DESC
        """
    )

    now = datetime.now(timezone.utc)
    sources = []
    for r in rows:
        latest = r["latest_data_utc"]
        ingested = r["last_ingest_utc"]
        if latest is None:
            continue

        lag_hours = (now - latest).total_seconds() / 3600

        if lag_hours <= 24:
            status = "fresh"
        elif lag_hours <= 24 * 7:
            status = "warn"
        else:
            status = "stale"

        sources.append({
            "table": r["table_name"],
            "source": r["source"],
            "latest_data_utc": iso_utc(latest),
            "last_ingest_utc": iso_utc(ingested) if ingested else None,
            "lag_hours": round(lag_hours, 1),
            "rows_total": r["rows_total"],
            "status": status,
        })

    counts = {"fresh": 0, "warn": 0, "stale": 0}
    for s in sources:
        counts[s["status"]] += 1

    return {
        "as_of_utc": now.isoformat(),
        "sources": sources,
        "summary": counts,
    }


@router.get("")
async def get_data_status(request: Request, response: Response):
    """Per-source ingestion + data freshness from the provenance table.

    In demo mode the provenance table is generated alongside the synthetic
    market data and all sources are labelled DEMO_SYNTHETIC. In live mode
    the upstream ingestion pipeline populates it.
    """
    engine = request.app.state.engine
    payload = await run_in_threadpool(_data_status_sync, engine)
    response.headers["Cache-Control"] = "public, max-age=300"
    return payload