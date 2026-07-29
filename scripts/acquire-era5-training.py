"""Acquire and decode compact ERA5 severe-weather training records.

Requires a configured CDS personal access token and accepted dataset terms.
Extraction requires xarray, cfgrib, ecCodes, and numpy. Each GRIB field is
opened explicitly by short name so heterogeneous ERA5 GRIB messages cannot be
silently merged or omitted by xarray/cfgrib.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

TIMES = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]
AREA = [52, -115, 22, -80]
PRESSURE_LEVELS = ["1000", "925", "850", "700", "500", "300", "250"]
PRESSURE_VARIABLES = [
    "geopotential", "relative_humidity", "specific_humidity", "temperature",
    "u_component_of_wind", "v_component_of_wind"
]
SINGLE_VARIABLES = [
    "10m_u_component_of_wind", "10m_v_component_of_wind", "2m_dewpoint_temperature",
    "2m_temperature", "mean_sea_level_pressure", "surface_pressure",
    "convective_available_potential_energy", "convective_inhibition",
    "total_column_water_vapour"
]

# CDS variable name -> GRIB short name.
PRESSURE_FIELDS = {
    "geopotential": "z",
    "relative_humidity": "r",
    "specific_humidity": "q",
    "temperature": "t",
    "u_component_of_wind": "u",
    "v_component_of_wind": "v",
}
SURFACE_FIELDS = {
    "10m_u_component_of_wind": "u10",
    "10m_v_component_of_wind": "v10",
    "2m_dewpoint_temperature": "d2m",
    "2m_temperature": "t2m",
    "mean_sea_level_pressure": "msl",
    "surface_pressure": "sp",
    "convective_available_potential_energy": "cape",
    "convective_inhibition": "cin",
    "total_column_water_vapour": "tcwv",
}


class Era5DecodeError(RuntimeError):
    """Raised when downloaded ERA5 files cannot produce a complete record."""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dates", required=True, help="Comma-separated YYYY-MM-DD dates")
    parser.add_argument("--cache-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--keep-raw", action="store_true")
    args = parser.parse_args()

    dates = sorted(set(item.strip() for item in args.dates.split(",") if item.strip()))
    cache_root, output_root = Path(args.cache_root), Path(args.output_root)
    cache_root.mkdir(parents=True, exist_ok=True)
    output_root.mkdir(parents=True, exist_ok=True)
    ensure_cds_configured()

    import cdsapi  # type: ignore

    client = cdsapi.Client()
    for date in dates:
        pressure = cache_root / f"{date}-pressure-levels.grib"
        surface = cache_root / f"{date}-single-levels.grib"
        year, month, day = date.split("-")

        if not pressure.exists():
            client.retrieve("reanalysis-era5-pressure-levels", {
                "product_type": ["reanalysis"],
                "variable": PRESSURE_VARIABLES,
                "pressure_level": PRESSURE_LEVELS,
                "year": [year], "month": [month], "day": [day],
                "time": TIMES, "area": AREA, "data_format": "grib"
            }, str(pressure))

        if not surface.exists():
            client.retrieve("reanalysis-era5-single-levels", {
                "product_type": ["reanalysis"],
                "variable": SINGLE_VARIABLES,
                "year": [year], "month": [month], "day": [day],
                "time": TIMES, "area": AREA, "data_format": "grib"
            }, str(surface))

        record = extract_record(date, pressure, surface)
        output_path = output_root / f"{date}.json"
        output_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

        if not args.keep_raw:
            pressure.unlink(missing_ok=True)
            surface.unlink(missing_ok=True)
        print(f"ERA5 complete: {date}")


def ensure_cds_configured() -> None:
    if os.environ.get("CDSAPI_KEY"):
        return
    config = Path.home() / ".cdsapirc"
    if not config.exists():
        raise RuntimeError("CDS credentials not found. Configure ~/.cdsapirc or CDSAPI_KEY.")


def extract_record(date: str, pressure: Path, surface: Path) -> dict[str, Any]:
    try:
        import numpy as np  # type: ignore
        import xarray as xr  # type: ignore
        import cfgrib  # type: ignore
    except ImportError as exc:
        raise RuntimeError("ERA5 extraction requires xarray, cfgrib, eccodes, and numpy") from exc

    print(f"Decoding ERA5 pressure-level fields for {date}...")
    levels, pressure_missing = decode_pressure_fields(xr, np, pressure)
    print(f"Decoding ERA5 single-level fields for {date}...")
    surface_values, surface_missing = decode_surface_fields(cfgrib, np, surface)

    missing = pressure_missing + surface_missing
    if missing:
        raise Era5DecodeError(
            "ERA5 extraction was incomplete. Missing fields: " + ", ".join(sorted(missing))
        )

    return {
        "schemaVersion": "2.36.1.2",
        "eventDate": date,
        "source": "ERA5",
        "validTimes": TIMES,
        "domain": {"area": AREA},
        "surface": surface_values,
        "levels": levels,
        "derived": derive_diagnostics(surface_values, levels),
        "provenance": {
            "dataset": "reanalysis-era5",
            "acquiredAt": datetime.now(timezone.utc).isoformat(),
            "pressureFileSha256": sha256(pressure),
            "surfaceFileSha256": sha256(surface),
            "extractorVersion": "2.36.1.2",
            "decoder": "cfgrib-surface-dataset-index"
        }
    }


def decode_pressure_fields(xr: Any, np: Any, path: Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    levels: dict[str, dict[str, Any]] = {level: {} for level in PRESSURE_LEVELS}
    missing: list[str] = []

    for source_name, short_name in PRESSURE_FIELDS.items():
        ds = None
        try:
            ds = open_grib_field(
                xr,
                path,
                {"typeOfLevel": "isobaricInhPa", "shortName": short_name},
            )
            variable_name = select_data_variable(ds, short_name)
            arr = ds[variable_name]
            level_coord = find_level_coordinate(arr)
            available_levels = {int(value) for value in np.asarray(arr[level_coord].values).reshape(-1)}

            for level in PRESSURE_LEVELS:
                level_number = int(level)
                if level_number not in available_levels:
                    missing.append(f"{short_name}{level}")
                    continue
                selected = arr.sel({level_coord: level_number})
                levels[level][short_name] = summarize_array(np, selected.values)
                print(f"  OK {short_name}{level}")
        except Exception as exc:  # cfgrib can raise several backend-specific exception types
            for level in PRESSURE_LEVELS:
                missing.append(f"{short_name}{level}")
            print(f"  FAILED {source_name} ({short_name}): {exc}")
        finally:
            if ds is not None:
                ds.close()

    return levels, deduplicate(missing)


def decode_surface_fields(cfgrib: Any, np: Any, path: Path) -> tuple[dict[str, Any], list[str]]:
    """Decode all single-level fields from cfgrib's compatible dataset groups.

    cfgrib normalizes GRIB names such as 10u/10v/2t/2d into the xarray
    variable names u10/v10/t2m/d2m. Opening the file once with
    cfgrib.open_datasets() avoids brittle per-message shortName filters.
    """
    values: dict[str, Any] = {}
    missing: list[str] = []
    datasets: list[Any] = []

    try:
        datasets = cfgrib.open_datasets(
            str(path),
            backend_kwargs={
                "indexpath": "",
                "errors": "raise",
            },
        )

        variable_index: dict[str, Any] = {}

        for dataset_number, dataset in enumerate(datasets):
            names = list(dataset.data_vars)
            print(f"  Dataset {dataset_number}: {names}")

            for variable_name in names:
                if variable_name in variable_index:
                    raise Era5DecodeError(
                        f"Duplicate surface variable {variable_name!r} was found "
                        f"in multiple cfgrib datasets"
                    )
                variable_index[variable_name] = dataset[variable_name]

        for source_name, short_name in SURFACE_FIELDS.items():
            data_array = variable_index.get(short_name)

            if data_array is None:
                missing.append(short_name)
                print(
                    f"  FAILED {source_name} ({short_name}): "
                    "variable was not present in any cfgrib dataset"
                )
                continue

            try:
                values[short_name] = summarize_array(np, data_array.values)
                print(f"  OK {short_name}")
            except Exception as exc:
                missing.append(short_name)
                print(f"  FAILED {source_name} ({short_name}): {exc}")

    except Exception as exc:
        expected = list(SURFACE_FIELDS.values())
        print(f"  FAILED to decode single-level GRIB: {exc}")
        missing.extend(expected)

    finally:
        for dataset in datasets:
            try:
                dataset.close()
            except Exception:
                pass

    return values, deduplicate(missing)


def open_grib_field(xr: Any, path: Path, filter_by_keys: dict[str, Any]) -> Any:
    """Open exactly one compatible GRIB field without persistent cfgrib indexes."""
    return xr.open_dataset(
        path,
        engine="cfgrib",
        backend_kwargs={
            "filter_by_keys": filter_by_keys,
            "indexpath": "",
            "errors": "raise",
        },
    )


def select_data_variable(dataset: Any, preferred: str) -> str:
    names = list(dataset.data_vars)
    if preferred in names:
        return preferred
    if len(names) == 1:
        return names[0]
    raise Era5DecodeError(
        f"Expected one GRIB data variable for {preferred}, found: {', '.join(names) or 'none'}"
    )


def find_level_coordinate(arr: Any) -> str:
    for candidate in ("isobaricInhPa", "pressureLevel", "level"):
        if candidate in arr.coords:
            return candidate
    raise Era5DecodeError("Pressure field has no recognized pressure-level coordinate")


def summarize_array(np: Any, raw_values: Any) -> dict[str, float]:
    values = np.asarray(raw_values, dtype=float)
    finite = values[np.isfinite(values)]
    if not finite.size:
        raise Era5DecodeError("Field contains no finite values")
    return {
        "min": round(float(np.min(finite)), 4),
        "mean": round(float(np.mean(finite)), 4),
        "max": round(float(np.max(finite)), 4),
        "p10": round(float(np.percentile(finite, 10)), 4),
        "p90": round(float(np.percentile(finite, 90)), 4),
    }


def derive_diagnostics(surface: dict[str, Any], levels: dict[str, dict[str, Any]]) -> dict[str, Any]:
    required_surface = ("cape", "cin", "d2m", "msl", "u10", "v10")
    required_level_fields = (("850", "u"), ("850", "v"), ("500", "t"), ("250", "u"), ("250", "v"))
    completed = sum(key in surface for key in required_surface)
    completed += sum(field in levels.get(level, {}) for level, field in required_level_fields)
    total = len(required_surface) + len(required_level_fields)

    return {
        "capeMaxJkg": surface.get("cape", {}).get("max"),
        "cinMinJkg": surface.get("cin", {}).get("min"),
        "dewpointMeanK": surface.get("d2m", {}).get("mean"),
        "pressureMeanPa": surface.get("msl", {}).get("mean"),
        "diagnosticCompleteness": round(completed / total, 3),
    }


def deduplicate(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


if __name__ == "__main__":
    main()
