"""Shared helpers for the dashboard routers."""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response


def get_engine_and_dir(request: Request, scenario: str):
    engine = request.app.state.engine
    fdir = engine.forecast_dir(scenario)
    if fdir is None:
        raise HTTPException(404, f"Scenario '{scenario}' not found. Available: {engine.available_scenarios}")
    return engine, fdir


def add_cache_headers(response: Response, end_date: str | None, today_iso: str) -> None:
    """Long cache for fully-historical queries; short cache for recent."""
    if end_date and end_date < today_iso:
        response.headers["Cache-Control"] = "public, max-age=86400, immutable"
    else:
        response.headers["Cache-Control"] = "public, max-age=300"


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def auto_resolution(start: str, end: str) -> str:
    """Pick a sane bucket size from the requested range."""
    try:
        days = (date.fromisoformat(end[:10]) - date.fromisoformat(start[:10])).days
    except ValueError:
        return "hourly"
    if days <= 7:
        return "15min"
    if days <= 90:
        return "hourly"
    return "daily"


def end_exclusive(end: str) -> str:
    """Promote an inclusive 'YYYY-MM-DD' end date to the next-day bound.

    API `end` params mean "include this whole calendar day". Comparing
    `col <= '2026-03-25'` against a timestamp column resolves the bare date
    to midnight and silently drops every intra-day row of the final day, so
    query with `col < end_exclusive(end)` instead. Non-date strings pass
    through unchanged.
    """
    try:
        return (date.fromisoformat(end[:10]) + timedelta(days=1)).isoformat()
    except ValueError:
        return end


def nan_to_none(v):
    """Convert NaN/NA pandas values to None for JSON serialization."""
    if v is None:
        return None
    try:
        if math.isnan(float(v)):
            return None
    except (TypeError, ValueError):
        pass
    return v


def iso_utc(value) -> str:
    """Emit a strict ISO-8601 UTC datetime string: 'T' separator + offset.

    Space-separated datetimes are rejected by JavaScriptCore's `new Date()`
    (Safari), and naive strings get parsed as local time, which collapses
    two distinct UTC instants at DST transitions. Accepts datetime-likes
    (uses .isoformat()) and strings; idempotent for already-conformant
    input. Date-only strings pass through without a bogus offset.
    """
    s = value.isoformat() if hasattr(value, "isoformat") else str(value).replace(" ", "T", 1)
    if not s or "T" not in s:
        return s
    if s.endswith("Z") or (len(s) >= 6 and s[-6] in "+-" and s[-3] == ":"):
        return s
    return s + "+00:00"
