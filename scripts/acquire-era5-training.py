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
import tempfile
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
    parser.add_argument("--spatial-root", required=True, help="External cache for compressed spatial tensors")
    parser.add_argument("--manifest-root", required=True, help="Repository path for compact spatial manifests")
    parser.add_argument("--grid-rows", type=int, default=100)
    parser.add_argument("--grid-cols", type=int, default=100)
    parser.add_argument("--keep-raw", action="store_true")
    args = parser.parse_args()

    dates = sorted(set(item.strip() for item in args.dates.split(",") if item.strip()))
    cache_root, output_root = Path(args.cache_root), Path(args.output_root)
    spatial_root, manifest_root = Path(args.spatial_root), Path(args.manifest_root)
    cache_root.mkdir(parents=True, exist_ok=True)
    output_root.mkdir(parents=True, exist_ok=True)
    spatial_root.mkdir(parents=True, exist_ok=True)
    manifest_root.mkdir(parents=True, exist_ok=True)
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

        record = extract_record(
            date, pressure, surface, spatial_root, manifest_root,
            grid_rows=args.grid_rows, grid_cols=args.grid_cols,
        )
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


def extract_record(
    date: str, pressure: Path, surface: Path, spatial_root: Path, manifest_root: Path,
    *, grid_rows: int = 100, grid_cols: int = 100,
) -> dict[str, Any]:
    try:
        import numpy as np  # type: ignore
        import xarray as xr  # type: ignore
        import cfgrib  # type: ignore
    except ImportError as exc:
        raise RuntimeError("ERA5 extraction requires xarray, cfgrib, eccodes, and numpy") from exc

    spatial_manifest = extract_spatial_case(
        date, pressure, surface, spatial_root, manifest_root, np=np, xr=xr, cfgrib=cfgrib,
        grid_rows=grid_rows, grid_cols=grid_cols,
    )

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
        "schemaVersion": "2.37.0",
        "eventDate": date,
        "source": "ERA5",
        "validTimes": TIMES,
        "domain": {"area": AREA},
        "surface": surface_values,
        "levels": levels,
        "derived": derive_diagnostics(surface_values, levels),
        "spatialRecord": spatial_manifest,
        "provenance": {
            "dataset": "reanalysis-era5",
            "acquiredAt": datetime.now(timezone.utc).isoformat(),
            "pressureFileSha256": sha256(pressure),
            "surfaceFileSha256": sha256(surface),
            "extractorVersion": "2.37.0",
            "decoder": "cfgrib-spatial-tensor-and-summary"
        }
    }



def extract_spatial_case(
    date: str, pressure_path: Path, surface_path: Path, spatial_root: Path, manifest_root: Path,
    *, np: Any, xr: Any, cfgrib: Any, grid_rows: int, grid_cols: int,
) -> dict[str, Any]:
    """Preserve the atmosphere as a deterministic time/channel/grid tensor.

    Large NPZ tensors remain in the external training cache. A compact, portable
    manifest is written into the repository and referenced by the summary record.
    """
    if grid_rows < 2 or grid_cols < 2:
        raise ValueError("Spatial grid dimensions must both be at least 2")

    print(f"Building {grid_rows}x{grid_cols} spatial ERA5 tensor for {date}...")
    surface_sets = cfgrib.open_datasets(str(surface_path), backend_kwargs={"indexpath": "", "errors": "raise"})
    pressure_sets: list[Any] = []
    try:
        surface_index = index_dataset_variables(surface_sets)
        pressure_index: dict[str, Any] = {}
        for short_name in PRESSURE_FIELDS.values():
            ds = open_grib_field(xr, pressure_path, {"typeOfLevel": "isobaricInhPa", "shortName": short_name})
            pressure_sets.append(ds)
            pressure_index[short_name] = ds[select_data_variable(ds, short_name)]

        coordinate_source = next(iter(surface_index.values()))
        lat_name, lon_name = find_horizontal_coordinates(coordinate_source)
        source_lat = np.asarray(coordinate_source[lat_name].values, dtype=float)
        source_lon = np.asarray(coordinate_source[lon_name].values, dtype=float)
        # Keep interpolation coordinates in float64. Casting the extrema to float32
        # can move the edge coordinates just outside the native ERA5 domain and
        # cause xarray/scipy to emit NaNs along the outer grid row or column.
        target_lat = np.linspace(float(np.max(source_lat)), float(np.min(source_lat)), grid_rows, dtype=np.float64)
        target_lon = np.linspace(float(np.min(source_lon)), float(np.max(source_lon)), grid_cols, dtype=np.float64)

        arrays: dict[str, Any] = {"latitude": target_lat, "longitude": target_lon}
        channel_units: dict[str, str | None] = {}
        valid_times: list[str] | None = None

        for name in SURFACE_FIELDS.values():
            arr = surface_index.get(name)
            if arr is None:
                raise Era5DecodeError(f"Spatial extraction missing surface variable {name}")
            sampled, times = sample_data_array(arr, target_lat, target_lon, np=np)
            arrays[f"surface__{name}"] = sampled.astype(np.float32)
            channel_units[f"surface__{name}"] = arr.attrs.get("units")
            valid_times = valid_times or times

        for level in PRESSURE_LEVELS:
            for name, arr in pressure_index.items():
                level_coord = find_level_coordinate(arr)
                selected = arr.sel({level_coord: int(level)})
                sampled, times = sample_data_array(selected, target_lat, target_lon, np=np)
                arrays[f"level_{level}__{name}"] = sampled.astype(np.float32)
                channel_units[f"level_{level}__{name}"] = arr.attrs.get("units")
                valid_times = valid_times or times

        add_derived_spatial_channels(arrays, channel_units, np=np)
        time_count = int(next(value for key, value in arrays.items() if key not in {"latitude", "longitude"}).shape[0])
        if valid_times is None or len(valid_times) != time_count:
            valid_times = [f"{date}T{clock}:00Z" for clock in TIMES[:time_count]]

        case_dir = spatial_root / date
        case_dir.mkdir(parents=True, exist_ok=True)
        tensor_path = case_dir / "atmosphere.npz"
        atomic_savez(np, tensor_path, arrays)
        checksum = sha256(tensor_path)
        manifest = {
            "schemaVersion": "2.37.0",
            "eventDate": date,
            "kind": "weatherworld-spatial-era5-case",
            "storage": {
                "format": "npz",
                "externalCacheRelativePath": f"era5/spatial/{date}/atmosphere.npz",
                "sha256": checksum,
                "bytes": tensor_path.stat().st_size,
            },
            "grid": {
                "projection": "latitude-longitude",
                "rows": grid_rows, "cols": grid_cols,
                "north": float(target_lat[0]), "south": float(target_lat[-1]),
                "west": float(target_lon[0]), "east": float(target_lon[-1]),
                "nominalCellKm": 10,
                "sourceResolutionNote": "ERA5 is interpolated to the simulator grid; this does not create new 10 km-scale information.",
            },
            "time": {"count": time_count, "validTimes": valid_times},
            "channels": [
                {"name": key, "shape": list(value.shape), "dtype": str(value.dtype), "units": channel_units.get(key)}
                for key, value in arrays.items() if key not in {"latitude", "longitude"}
            ],
            "coordinates": {"latitude": "latitude", "longitude": "longitude"},
            "provenance": {
                "pressureFileSha256": sha256(pressure_path),
                "surfaceFileSha256": sha256(surface_path),
                "extractorVersion": "2.37.0",
            },
        }
        manifest_path = manifest_root / f"{date}.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"  Spatial tensor complete: {tensor_path}")
        return {
            "manifest": f"atmospheric/era5/spatial/{date}.json",
            "cacheRelativePath": manifest["storage"]["externalCacheRelativePath"],
            "sha256": checksum,
            "grid": manifest["grid"],
            "timeCount": time_count,
            "channelCount": len(manifest["channels"]),
        }
    finally:
        for ds in [*surface_sets, *pressure_sets]:
            try:
                ds.close()
            except Exception:
                pass


def index_dataset_variables(datasets: list[Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for ds in datasets:
        for name in ds.data_vars:
            if name in out:
                raise Era5DecodeError(f"Duplicate cfgrib variable {name}")
            out[name] = ds[name]
    return out


def find_horizontal_coordinates(arr: Any) -> tuple[str, str]:
    lat = next((name for name in ("latitude", "lat") if name in arr.coords), None)
    lon = next((name for name in ("longitude", "lon") if name in arr.coords), None)
    if not lat or not lon:
        raise Era5DecodeError("Field has no recognized latitude/longitude coordinates")
    return lat, lon


def sample_data_array(arr: Any, target_lat: Any, target_lon: Any, *, np: Any) -> tuple[Any, list[str]]:
    """Interpolate one ERA5 field and normalize it to ``time/y/x``.

    cfgrib may expose ERA5 single-level fields with two temporal dimensions,
    commonly ``time`` and ``step``. In that case the interpolated field has a
    shape such as ``(time, step, latitude, longitude)``. Resolve those leading
    dimensions through ``valid_time``, then sort and de-duplicate the resulting
    timeline rather than rejecting the four-dimensional array.
    """
    lat_name, lon_name = find_horizontal_coordinates(arr)

    # ECMWF CIN is only evaluated where a level of free convection exists, so
    # decoded CIN fields can legitimately contain missing values elsewhere.
    # Store those undefined/no-LFC points as zero inhibition before spatial
    # interpolation; CAPE remains a separate channel and prevents zero-CIN,
    # zero-CAPE points from being interpreted as an initiation signal.
    interpolation_source = arr
    if str(arr.name).lower() == "cin":
        interpolation_source = arr.fillna(0.0)

    sampled = interpolation_source.interp(
        {lat_name: target_lat, lon_name: target_lon},
        method="linear",
        kwargs={"fill_value": "extrapolate"},
    )

    # A nearest-neighbour pass repairs isolated interpolation holes without
    # replacing valid linearly interpolated values. This is primarily an edge
    # safeguard for coordinates that differ by tiny floating-point amounts.
    if bool(sampled.isnull().any()):
        nearest = interpolation_source.interp(
            {lat_name: target_lat, lon_name: target_lon},
            method="nearest",
            kwargs={"fill_value": "extrapolate"},
        )
        sampled = sampled.where(sampled.notnull(), nearest)

    # Keep horizontal dimensions last so all preceding axes can be normalized
    # into one temporal axis consistently.
    leading_dims = [dim for dim in sampled.dims if dim not in {lat_name, lon_name}]
    sampled = sampled.transpose(*leading_dims, lat_name, lon_name)
    values = np.asarray(sampled.values, dtype=np.float32)
    horizontal = (len(target_lat), len(target_lon))
    if values.shape[-2:] != horizontal:
        raise Era5DecodeError(
            f"Unexpected spatial shape for {arr.name!r}: dims={sampled.dims}, "
            f"shape={values.shape}; expected ending {horizontal}"
        )

    if values.ndim == 2:
        values = values[np.newaxis, ...]
        raw_times = None
    else:
        temporal_shape = values.shape[:-2]
        values = values.reshape((-1, *horizontal))
        raw_times = resolve_valid_times(sampled, temporal_shape, np=np)

    times: list[str] = []
    if raw_times is not None:
        if len(raw_times) != values.shape[0]:
            raise Era5DecodeError(
                f"Temporal coordinate mismatch for {arr.name!r}: "
                f"{len(raw_times)} timestamps for shape {values.shape}"
            )
        values, times = normalize_valid_time_axis(values, raw_times, np=np)

    if not np.all(np.isfinite(values)):
        missing_count = int(np.size(values) - np.count_nonzero(np.isfinite(values)))
        missing_fraction = missing_count / int(np.size(values))
        raise Era5DecodeError(
            f"Interpolated spatial field {arr.name!r} contains {missing_count} "
            f"non-finite values ({missing_fraction:.3%}) after linear and nearest repair"
        )
    return values, times


def resolve_valid_times(sampled: Any, temporal_shape: tuple[int, ...], *, np: Any) -> Any | None:
    """Return one valid timestamp for each flattened temporal element."""
    if not temporal_shape:
        return None

    if "valid_time" in sampled.coords:
        valid = np.asarray(sampled["valid_time"].values)
        try:
            return np.broadcast_to(valid, temporal_shape).reshape(-1)
        except ValueError as exc:
            raise Era5DecodeError(
                f"valid_time shape {valid.shape} cannot describe temporal shape {temporal_shape}"
            ) from exc

    if "time" not in sampled.coords:
        return None

    time = np.asarray(sampled["time"].values)
    if "step" in sampled.coords:
        step = np.asarray(sampled["step"].values)
        try:
            time_grid = np.broadcast_to(time.reshape(time.shape + (1,) * step.ndim), temporal_shape)
            step_grid = np.broadcast_to(step.reshape((1,) * time.ndim + step.shape), temporal_shape)
            return (time_grid + step_grid).reshape(-1)
        except (TypeError, ValueError):
            pass

    try:
        return np.broadcast_to(time, temporal_shape).reshape(-1)
    except ValueError:
        if time.size == int(np.prod(temporal_shape)):
            return time.reshape(-1)
        return None


def normalize_valid_time_axis(values: Any, raw_times: Any, *, np: Any) -> tuple[Any, list[str]]:
    """Sort and de-duplicate temporal slices, retaining requested UTC hours."""
    timestamps = np.asarray(raw_times).astype("datetime64[s]").reshape(-1)
    if np.any(np.isnat(timestamps)):
        raise Era5DecodeError("ERA5 field contains invalid valid_time coordinates")

    order = np.argsort(timestamps, kind="stable")
    timestamps = timestamps[order]
    values = values[order]
    unique_times, unique_indices = np.unique(timestamps, return_index=True)
    values = values[unique_indices]

    requested_hours = set(TIMES)
    selected_indices = []
    for index, value in enumerate(unique_times):
        text = np.datetime_as_string(value, unit="m")
        if text[-5:] in requested_hours:
            selected_indices.append(index)

    # Normal ERA5 acquisition requests eight standard three-hourly valid times.
    # Preserve all unique times for partial/synthetic inputs so errors remain
    # diagnosable, but constrain complete records to the intended eight slices.
    if len(selected_indices) >= len(TIMES):
        selected_indices = selected_indices[:len(TIMES)]
        unique_times = unique_times[selected_indices]
        values = values[selected_indices]

    formatted = [np.datetime_as_string(value, unit="s") + "Z" for value in unique_times]
    return values, formatted


def add_derived_spatial_channels(arrays: dict[str, Any], units: dict[str, str | None], *, np: Any) -> None:
    u10, v10 = arrays["surface__u10"], arrays["surface__v10"]
    arrays["derived__wind10_speed"] = np.hypot(u10, v10).astype(np.float32)
    units["derived__wind10_speed"] = "m s**-1"
    arrays["derived__dewpoint_depression"] = (arrays["surface__t2m"] - arrays["surface__d2m"]).astype(np.float32)
    units["derived__dewpoint_depression"] = "K"
    arrays["derived__bulk_shear_1000_500"] = np.hypot(
        arrays["level_500__u"] - arrays["level_1000__u"],
        arrays["level_500__v"] - arrays["level_1000__v"],
    ).astype(np.float32)
    units["derived__bulk_shear_1000_500"] = "m s**-1"
    g = 9.80665
    dz = (arrays["level_500__z"] - arrays["level_850__z"]) / g
    dt = arrays["level_850__t"] - arrays["level_500__t"]
    safe_dz = np.where(np.abs(dz) < 1.0, np.nan, dz)
    lapse = (dt / safe_dz * 1000.0).astype(np.float32)
    if not np.all(np.isfinite(lapse)):
        raise Era5DecodeError("Derived 850-500 hPa lapse-rate field is non-finite")
    arrays["derived__lapse_rate_850_500"] = lapse
    units["derived__lapse_rate_850_500"] = "K km**-1"


def atomic_savez(np: Any, destination: Path, arrays: dict[str, Any]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".npz", delete=False) as handle:
        temp_path = Path(handle.name)
    try:
        np.savez_compressed(temp_path, **arrays)
        temp_path.replace(destination)
    finally:
        temp_path.unlink(missing_ok=True)

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
