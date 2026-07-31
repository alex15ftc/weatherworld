#!/usr/bin/env python3
"""Extract deterministic spatial analog features from ERA5 NPZ tensors."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

EPS = 1e-9


def finite_array(value: Any) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64)
    return np.where(np.isfinite(array), array, np.nan)


def select_peak_time(cape: np.ndarray) -> int:
    means = np.nanmean(cape, axis=(1, 2))
    return int(np.nanargmax(means)) if np.isfinite(means).any() else 0


def normalized_coordinates(rows: int, cols: int) -> tuple[np.ndarray, np.ndarray]:
    y = np.linspace(0.0, 1.0, rows, dtype=np.float64)
    x = np.linspace(0.0, 1.0, cols, dtype=np.float64)
    return np.meshgrid(x, y)


def weighted_geometry(field: np.ndarray, threshold: float | None = None) -> dict[str, float]:
    rows, cols = field.shape
    xx, yy = normalized_coordinates(rows, cols)
    values = np.where(np.isfinite(field), field, 0.0)
    if threshold is not None:
        weights = np.maximum(values - threshold, 0.0)
    else:
        minimum = float(np.nanmin(values)) if np.isfinite(values).any() else 0.0
        weights = np.maximum(values - minimum, 0.0)
    total = float(np.sum(weights))
    if total <= EPS:
        return {"centroidX": 0.5, "centroidY": 0.5, "orientationDeg": 0.0, "elongation": 0.0, "coverage": 0.0}
    cx = float(np.sum(weights * xx) / total)
    cy = float(np.sum(weights * yy) / total)
    dx, dy = xx - cx, yy - cy
    cxx = float(np.sum(weights * dx * dx) / total)
    cyy = float(np.sum(weights * dy * dy) / total)
    cxy = float(np.sum(weights * dx * dy) / total)
    covariance = np.array([[cxx, cxy], [cxy, cyy]], dtype=np.float64)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    order = np.argsort(eigenvalues)[::-1]
    major, minor = max(float(eigenvalues[order[0]]), 0.0), max(float(eigenvalues[order[1]]), 0.0)
    vector = eigenvectors[:, order[0]]
    orientation = math.degrees(math.atan2(float(vector[1]), float(vector[0]))) % 180.0
    elongation = 0.0 if major <= EPS else max(0.0, min(1.0, 1.0 - minor / major))
    coverage = float(np.mean(weights > 0.0))
    return {"centroidX": cx, "centroidY": cy, "orientationDeg": orientation, "elongation": elongation, "coverage": coverage}


def largest_component_fraction(mask: np.ndarray) -> float:
    mask = np.asarray(mask, dtype=bool)
    total = int(mask.sum())
    if total == 0:
        return 0.0
    rows, cols = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    largest = 0
    for row, col in zip(*np.where(mask & ~seen)):
        if seen[row, col]:
            continue
        stack = [(int(row), int(col))]
        seen[row, col] = True
        size = 0
        while stack:
            r, c = stack.pop()
            size += 1
            for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= rr < rows and 0 <= cc < cols and mask[rr, cc] and not seen[rr, cc]:
                    seen[rr, cc] = True
                    stack.append((rr, cc))
        largest = max(largest, size)
    return largest / total


def gradient_stats(field: np.ndarray) -> tuple[float, float]:
    gy, gx = np.gradient(field)
    magnitude = np.hypot(gx, gy)
    finite = magnitude[np.isfinite(magnitude)]
    if finite.size == 0:
        return 0.0, 0.0
    return float(np.mean(finite)), float(np.percentile(finite, 90))


def normalized_overlap(a: np.ndarray, b: np.ndarray) -> float:
    a = np.where(np.isfinite(a), a, 0.0)
    b = np.where(np.isfinite(b), b, 0.0)
    def scale(values: np.ndarray) -> np.ndarray:
        p10, p90 = np.percentile(values, [10, 90])
        return np.clip((values - p10) / max(float(p90 - p10), EPS), 0.0, 1.0)
    return float(np.mean(np.sqrt(scale(a) * scale(b))))


def require(data: Any, name: str) -> np.ndarray:
    if name not in data:
        raise KeyError(f"missing channel {name}")
    array = finite_array(data[name])
    if array.ndim != 3:
        raise ValueError(f"{name} expected 3 dimensions, received {array.shape}")
    return array


def extract(npz_path: Path) -> dict[str, Any]:
    with np.load(npz_path, allow_pickle=False) as data:
        cape = require(data, "surface__cape")
        d2m = require(data, "surface__d2m")
        msl = require(data, "surface__msl")
        tcwv = require(data, "surface__tcwv")
        u850, v850 = require(data, "level_850__u"), require(data, "level_850__v")
        u500, v500 = require(data, "level_500__u"), require(data, "level_500__v")
        u250, v250 = require(data, "level_250__u"), require(data, "level_250__v")

        peak = select_peak_time(cape)
        cape2d, d2m2d, msl2d, tcwv2d = cape[peak], d2m[peak], msl[peak], tcwv[peak]
        deep_shear = np.hypot(u500[peak] - u850[peak], v500[peak] - v850[peak])
        jet = np.hypot(u250[peak], v250[peak])
        moisture_transport = np.hypot(u850[peak], v850[peak]) * np.maximum(tcwv2d, 0.0)

        cape_geometry = weighted_geometry(cape2d, 1000.0)
        moisture_geometry = weighted_geometry(d2m2d, float(np.nanpercentile(d2m2d, 70)))
        jet_geometry = weighted_geometry(jet, float(np.nanpercentile(jet, 75)))
        forcing_field = np.sqrt(np.maximum(cape2d, 0.0) * np.maximum(deep_shear, 0.0))
        forcing_geometry = weighted_geometry(forcing_field, float(np.nanpercentile(forcing_field, 70)))

        d2m_grad_mean, d2m_grad_p90 = gradient_stats(d2m2d)
        msl_grad_mean, msl_grad_p90 = gradient_stats(msl2d)
        tcwv_grad_mean, tcwv_grad_p90 = gradient_stats(tcwv2d)
        cape_mask = cape2d >= 1000.0

        features = {
            "peakTimeIndex": peak,
            "peakTimeFraction": peak / max(cape.shape[0] - 1, 1),
            "capeCentroidX": cape_geometry["centroidX"],
            "capeCentroidY": cape_geometry["centroidY"],
            "capeCorridorOrientationDeg": cape_geometry["orientationDeg"],
            "capeCorridorElongation": cape_geometry["elongation"],
            "capeCoverage1000Direct": float(np.mean(cape_mask)),
            "capeCoverage2000Direct": float(np.mean(cape2d >= 2000.0)),
            "capeLargestRegionFraction": largest_component_fraction(cape_mask),
            "moistureCentroidX": moisture_geometry["centroidX"],
            "moistureCentroidY": moisture_geometry["centroidY"],
            "moistureAxisOrientationDeg": moisture_geometry["orientationDeg"],
            "moistureAxisElongation": moisture_geometry["elongation"],
            "jetCentroidX": jet_geometry["centroidX"],
            "jetCentroidY": jet_geometry["centroidY"],
            "jetAxisOrientationDeg": jet_geometry["orientationDeg"],
            "jetAxisElongation": jet_geometry["elongation"],
            "jetCoreP90Ms": float(np.nanpercentile(jet, 90)),
            "forcingCentroidX": forcing_geometry["centroidX"],
            "forcingCentroidY": forcing_geometry["centroidY"],
            "forcingInstabilityOverlapDirect": normalized_overlap(cape2d, deep_shear),
            "moistureTransportOverlapDirect": normalized_overlap(cape2d, moisture_transport),
            "dewpointGradientMeanKCell": d2m_grad_mean,
            "dewpointGradientP90KCell": d2m_grad_p90,
            "pressureGradientMeanPaCell": msl_grad_mean,
            "pressureGradientP90PaCell": msl_grad_p90,
            "tcwvGradientMeanKgM2Cell": tcwv_grad_mean,
            "tcwvGradientP90KgM2Cell": tcwv_grad_p90,
        }
        return {"available": True, "featureCount": len(features), "features": features}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-root", required=True)
    parser.add_argument("--cache-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--dates", default="")
    args = parser.parse_args()
    manifest_root, cache_root, output = Path(args.manifest_root), Path(args.cache_root), Path(args.output)
    requested = {item for item in args.dates.split(",") if item}
    records: dict[str, Any] = {}
    for manifest_path in sorted(manifest_root.glob("????-??-??.json")):
        date = manifest_path.stem
        if requested and date not in requested:
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            relative = manifest.get("storage", {}).get("externalCacheRelativePath")
            if not relative:
                raise ValueError("manifest has no externalCacheRelativePath")
            tensor = cache_root / relative
            if not tensor.exists():
                records[date] = {"available": False, "reason": "tensor-missing", "tensorPath": str(tensor)}
                continue
            records[date] = {**extract(tensor), "tensorPath": str(tensor), "manifestPath": str(manifest_path)}
        except Exception as exc:  # keep batch diagnostics complete
            records[date] = {"available": False, "reason": f"{type(exc).__name__}: {exc}"}
    payload = {"schemaVersion": "2.39.1", "recordCount": len(records), "records": records}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    available = sum(1 for value in records.values() if value.get("available"))
    print(f"Extracted direct spatial features for {available}/{len(records)} ERA5 cases.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
