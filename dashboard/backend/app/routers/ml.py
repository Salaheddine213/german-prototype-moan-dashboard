"""ML model performance: metrics, predictions, feature importance, correlation."""
from __future__ import annotations

import csv
import logging

from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.concurrency import run_in_threadpool

from ..downsampling import lttb_by_index
from ._helpers import iso_utc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ml", tags=["ml"])


@router.get("/metrics")
async def get_metrics(request: Request):
    engine = request.app.state.engine
    metrics = engine.get_cached("metrics.json")
    config = engine.get_cached("ensemble_config.json")
    features = engine.get_cached("feature_list")

    if not metrics:
        raise HTTPException(404, "No metrics.json found in production model")

    training = metrics.get("training", {})
    validation = metrics.get("validation", {})
    curve = metrics.get("curve_alignment", {})

    # Price bands are stored inside training/validation under 'by_price_range'
    price_bands = []
    for band in validation.get("by_price_range", []):
        price_bands.append({
            "name": band.get("range", band.get("name", "")),
            "count": band.get("samples", 0),
            "pct": round(band.get("pct", 0), 1),
            "mae": round(band.get("mae", 0), 2),
            "correlation": round(band.get("correlation", 0), 3),
        })

    feature_importance = await run_in_threadpool(_get_feature_importance, engine)

    return {
        "training": {
            "mae": round(training.get("mae", 0), 2),
            "rmse": round(training.get("rmse", 0), 2),
            "r2": round(training.get("r2", 0), 4),
            "correlation": round(training.get("correlation", 0), 4),
            "samples": training.get("samples", 0),
        },
        "validation": {
            "mae": round(validation.get("mae", 0), 2),
            "rmse": round(validation.get("rmse", 0), 2),
            "r2": round(validation.get("r2", 0), 4),
            "correlation": round(validation.get("correlation", 0), 4),
            "samples": validation.get("samples", 0),
        },
        "price_bands": price_bands,
        "bess": {
            "capture_rate": round(curve.get("mean_bess_capture_rate", 0), 4),
            "spearman": round(curve.get("mean_spearman_r", 0), 4),
            "spread_mae": round(metrics.get("spread_mae", 0), 2),
        },
        "weights": {
            "lightgbm": config.get("weight_lightgbm", 0.5) if config else 0.5,
            "catboost": config.get("weight_catboost", 0.5) if config else 0.5,
        },
        "feature_importance": feature_importance,
        "features": features or [],
    }


def _get_feature_importance(engine) -> list[dict]:
    prod = engine.latest_production_model
    if not prod:
        return []

    lgb_path = prod / "lgb_model.txt"
    if not lgb_path.exists():
        return []

    features = engine.get_cached("feature_list") or []
    if not features:
        return []

    try:
        import lightgbm as lgb
    except ImportError:
        logger.warning("lightgbm not installed — feature importance disabled")
        return []

    try:
        model = lgb.Booster(model_file=str(lgb_path))
        importance = model.feature_importance(importance_type="gain")
        pairs = sorted(zip(features, importance), key=lambda x: x[1], reverse=True)
        return [{"name": n, "importance": round(float(v), 1)} for n, v in pairs[:30]]
    except Exception:
        logger.exception("feature importance failed for %s", lgb_path)
        return []


def _get_predictions_sync(prod, set_name: str, max_points: int):
    csv_path = prod / f"predictions_{set_name}.csv"
    if not csv_path.exists():
        raise HTTPException(404, f"predictions_{set_name}.csv not found")

    data = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append({
                "datetime": iso_utc(row["datetime"]),
                "actual": float(row["Price_actual"]),
                "predicted": float(row["Price_pred_ensemble"]),
            })

    data = lttb_by_index(data, "actual", max_points)

    return {
        "datetime": [d["datetime"] for d in data],
        "actual": [d["actual"] for d in data],
        "predicted": [d["predicted"] for d in data],
        "residuals": [round(d["actual"] - d["predicted"], 2) for d in data],
    }


@router.get("/predictions")
async def get_predictions(
    request: Request,
    set: str = Query("validation", pattern="^(validation|training)$"),
    max_points: int = Query(5000, ge=10, le=50000),
):
    engine = request.app.state.engine
    prod = engine.latest_production_model
    if not prod:
        raise HTTPException(404, "No production model found")

    return await run_in_threadpool(_get_predictions_sync, prod, set, max_points)


def _get_correlation_matrix_sync(engine):
    cached = engine.get_cached("correlation_matrix")
    if cached:
        return cached

    import pandas as pd

    pattern = engine._settings.historical_features_path
    matches = sorted(pattern.parent.glob(pattern.name))
    if not matches:
        raise HTTPException(404, "Historical features file not found")

    features_file = matches[-1]
    suffix = features_file.suffix.lower()
    if suffix == ".feather":
        df = pd.read_feather(features_file)
    elif suffix == ".parquet":
        df = pd.read_parquet(features_file)
    else:
        raise HTTPException(500, f"Unsupported historical features file extension: {suffix}")

    feature_names = engine.get_cached("feature_list") or []

    available = [f for f in feature_names[:20] if f in df.columns]
    if not available:
        return {"features": [], "matrix": []}

    corr = df[available].corr().round(3)
    result = {
        "features": available,
        "matrix": corr.values.tolist(),
    }
    engine._small_files_cache["correlation_matrix"] = result
    return result


@router.get("/correlation-matrix")
async def get_correlation_matrix(request: Request):
    """Feature correlation matrix from training data. Cached after first request."""
    engine = request.app.state.engine
    return await run_in_threadpool(_get_correlation_matrix_sync, engine)


def _kde_distributions_from_df(df, source_label: str) -> list[dict]:
    """Compute per-year KDE + quantile distributions from a df with 'year' and 'value' columns."""
    import numpy as np
    from scipy.stats import gaussian_kde

    distributions = []
    for year, group in df.groupby("year"):
        vals = group["value"].dropna()
        if len(vals) < 10:
            continue
        try:
            kde = gaussian_kde(vals, bw_method=0.3)
            x_range = np.linspace(vals.min() - 20, vals.max() + 20, 100)
            kde_y = kde(x_range).tolist()
        except Exception:
            logger.exception("KDE failed for %s distributions year=%s n=%d", source_label, year, len(vals))
            x_range = []
            kde_y = []
        distributions.append({
            "year": int(year),
            "min": round(float(vals.min()), 1),
            "q1": round(float(vals.quantile(0.25)), 1),
            "median": round(float(vals.median()), 1),
            "q3": round(float(vals.quantile(0.75)), 1),
            "max": round(float(vals.max()), 1),
            "mean": round(float(vals.mean()), 1),
            "std": round(float(vals.std()), 1),
            "kde_x": [round(float(x), 1) for x in x_range] if len(x_range) > 0 else [],
            "kde_y": [round(float(y), 4) for y in kde_y],
        })
    return distributions


def _get_price_distributions_forecast_sync(engine, scenario: str):
    """Load forecast feather + compute KDE — heavy sync work."""
    import pandas as pd

    data = engine.query_forecast_file(
        scenario, "predictions_DA_hourly_*", datetime_col="datetime_UTC"
    )
    df = pd.DataFrame(data)
    if df.empty:
        return {"years": [], "distributions": []}
    df["year"] = pd.to_datetime(df["datetime_UTC"], utc=True).dt.year
    df["value"] = df["Price_pred_ensemble"]

    distributions = _kde_distributions_from_df(df, "forecast")
    return {
        "years": [d["year"] for d in distributions],
        "distributions": distributions,
    }


def _get_price_distributions_historical_sync(engine):
    """Full ts_hourly scan + KDE — heavy sync work. German DA prices."""
    import pandas as pd

    # ts_hourly is hourly in the German schema; keep the :00 filter harmless
    # (also safe on wide files that once carried 15-min rows).
    sql = """
        SELECT
            EXTRACT(year FROM timestamp_utc) AS year,
            "DE_DA__DA_Price"                AS value
        FROM ts_hourly
        WHERE "DE_DA__DA_Price" IS NOT NULL
          AND EXTRACT(MINUTE FROM timestamp_utc) = 0
        ORDER BY timestamp_utc
    """
    rows = engine.query(sql)
    df = pd.DataFrame(rows)
    if df.empty:
        return {"years": [], "distributions": []}
    df["year"] = df["year"].astype(int)

    distributions = _kde_distributions_from_df(df, "historical")
    return {
        "years": [d["year"] for d in distributions],
        "distributions": distributions,
    }


@router.get("/price-distributions")
async def get_price_distributions(
    request: Request,
    source: str = Query("historical", pattern="^(historical|forecast)$"),
    scenario: str = Query(""),
):
    """Price distribution statistics by year for violin plots."""
    engine = request.app.state.engine

    if source == "forecast":
        if not scenario:
            raise HTTPException(400, "scenario required for forecast distributions")
        return await run_in_threadpool(
            _get_price_distributions_forecast_sync, engine, scenario
        )

    return await run_in_threadpool(_get_price_distributions_historical_sync, engine)
