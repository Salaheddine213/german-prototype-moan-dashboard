"""Pydantic response schemas for the dashboard API."""
from __future__ import annotations
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    data_mode: str
    data_loaded: bool
    last_model: str | None
    last_forecast: str | None
    scenarios: list[str]
    db_tables: dict[str, int]