"""Request compact ERA5 samples for candidate analog dates.

Requires:
  pip install "cdsapi>=0.7.7"
  a configured ~/.cdsapirc personal access token
  acceptance of both ERA5 dataset terms in the CDS website
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import cdsapi

TIMES = ["00:00", "06:00", "12:00", "18:00"]
AREA = [50, -110, 25, -85]  # north, west, south, east

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dates_json", help='JSON array of "YYYY-MM-DD" dates')
    parser.add_argument("--output", default="data/raw/era5-event-days")
    args = parser.parse_args()
    payload = json.loads(Path(args.dates_json).read_text())
    dates = sorted(set(payload["dates"] if isinstance(payload, dict) else payload))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    for date in dates:
        year, month, day = date.split("-")
        pressure_target = output / f"{date}-pressure-levels.grib"
        surface_target = output / f"{date}-single-levels.grib"
        if not pressure_target.exists():
            client.retrieve("reanalysis-era5-pressure-levels", {
                "product_type": ["reanalysis"],
                "variable": ["geopotential", "relative_humidity", "temperature", "u_component_of_wind", "v_component_of_wind"],
                "pressure_level": ["1000", "925", "850", "700", "500", "300", "250"],
                "year": [year], "month": [month], "day": [day], "time": TIMES,
                "area": AREA, "data_format": "grib",
            }, str(pressure_target))
        if not surface_target.exists():
            client.retrieve("reanalysis-era5-single-levels", {
                "product_type": ["reanalysis"],
                "variable": ["10m_u_component_of_wind", "10m_v_component_of_wind", "2m_dewpoint_temperature", "2m_temperature", "mean_sea_level_pressure", "surface_pressure", "convective_available_potential_energy", "convective_inhibition"],
                "year": [year], "month": [month], "day": [day], "time": TIMES,
                "area": AREA, "data_format": "grib",
            }, str(surface_target))
        print(f"ERA5 ready: {date}")

if __name__ == "__main__":
    main()
