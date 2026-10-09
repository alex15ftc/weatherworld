import argparse, json, math, re, zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
import eccodes
import numpy as np

LEVELS = (1000, 925, 850, 700, 500, 250)
KNOTS = 1.94384
TRAINING_CENTERS = (
    (35.22, 262.56), (37.76, 260.03), (39.07, 264.38), (32.83, 262.70),
    (34.73, 267.76), (32.32, 269.92), (36.12, 273.32), (32.45, 266.16),
    (33.17, 273.23), (37.24, 266.60)
)
CORRIDORS_PER_DAY = 8
DOMAIN_WIDTH = 16
DOMAIN_HEIGHT = 10

def numeric(token):
    match = re.match(r"[-+]?\d+", token)
    return int(match.group()) if match else -9999

def load_igra(root, target_dates):
    wanted = set()
    for date in target_dates:
        day = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        wanted.update((day.replace(hour=12), day + timedelta(days=1), day + timedelta(days=1,hours=12)))
    observations = []
    for archive in sorted((root / "igra").glob("*.zip")):
        with zipfile.ZipFile(archive) as zipped:
            with zipped.open(zipped.namelist()[0]) as stream:
                current = None
                for raw in stream:
                    line = raw.decode("ascii", "ignore").rstrip()
                    if line.startswith("#"):
                        if current is not None and len(current["levels"]) >= 5:
                            observations.append(current)
                        parts = line.split()
                        hour = int(parts[4])
                        if hour not in (0, 12):
                            current = None
                            continue
                        valid = datetime(int(parts[1]), int(parts[2]), int(parts[3]), hour, tzinfo=timezone.utc)
                        current = {
                            "stationId": parts[0][1:], "valid": valid,
                            "latitude": int(parts[-2]) / 10000, "longitude": (int(parts[-1]) / 10000) % 360,
                            "levels": []
                        } if valid in wanted else None
                    elif current is not None:
                        parts = line.split()
                        if len(parts) < 9: continue
                        pressure = numeric(parts[2]) / 100
                        temperature = numeric(parts[4]) / 10
                        depression = numeric(parts[6]) / 10
                        direction, speed = numeric(parts[7]), numeric(parts[8]) / 10 * KNOTS
                        if pressure > 0 and temperature > -150 and depression >= 0 and direction >= 0 and speed >= 0:
                            current["levels"].append({
                                "pressureHpa": pressure, "temperatureC": temperature,
                                "dewpointC": temperature - depression,
                                "windDirection": direction, "windSpeedKt": speed
                            })
                        if len(current["levels"]) >= 5 and pressure <= 100:
                            observations.append(current); current = None
                if current is not None and len(current["levels"]) >= 5:
                    observations.append(current)
    return observations

def message_arrays(file):
    selected = {}
    with open(file, "rb") as stream:
        while True:
            handle = eccodes.codes_grib_new_from_file(stream)
            if handle is None: break
            parameter = eccodes.codes_get(handle, "indicatorOfParameter")
            kind = eccodes.codes_get(handle, "typeOfLevel")
            level = eccodes.codes_get(handle, "level")
            key = None
            if kind == "isobaricInhPa" and level in LEVELS and parameter in (7, 11, 33, 34, 51):
                key = (parameter, level)
            elif kind == "heightAboveGround" and ((level == 2 and parameter in (11, 17)) or (level == 10 and parameter in (33, 34))):
                key = (parameter, f"{level}m")
            elif kind == "surface" and parameter in (156, 157):
                key = (parameter, "surface")
            elif kind == "meanSea" and parameter == 2:
                key = (parameter, "msl")
            if key is not None:
                selected[key] = np.asarray(eccodes.codes_get_values(handle), dtype=float)
                if "lat" not in selected:
                    selected["lat"] = np.asarray(eccodes.codes_get_array(handle, "latitudes"))
                    selected["lon"] = np.asarray(eccodes.codes_get_array(handle, "longitudes"))
            eccodes.codes_release(handle)
    return selected

def dewpoint_from_specific_humidity(q, pressure_hpa):
    e = q * pressure_hpa / (0.622 + 0.378 * q)
    log = math.log(max(0.01, e) / 6.112)
    return 243.5 * log / (17.67 - log)

def wind(u, v):
    speed = math.hypot(u, v)
    direction = (math.degrees(math.atan2(-u, -v)) + 360) % 360
    return direction, speed

def narr_profile(fields, index):
    t2 = fields[(11, "2m")][index] - 273.15
    td2 = fields[(17, "2m")][index] - 273.15
    u10, v10 = fields[(33, "10m")][index], fields[(34, "10m")][index]
    direction, speed = wind(u10, v10)
    rows = [{"pressureHpa": 1000, "temperatureC": t2, "dewpointC": min(t2, td2),
             "windDirection": direction, "windSpeedKt": speed * KNOTS}]
    for pressure in LEVELS[1:]:
        temperature = fields[(11, pressure)][index] - 273.15
        dewpoint = dewpoint_from_specific_humidity(fields[(51, pressure)][index], pressure)
        direction, speed = wind(fields[(33, pressure)][index], fields[(34, pressure)][index])
        rows.append({"pressureHpa": pressure, "temperatureC": temperature,
                     "dewpointC": min(temperature, dewpoint),
                     "windDirection": direction, "windSpeedKt": speed * KNOTS})
    return rows

def standardize_igra(observation):
    rows = sorted(observation["levels"], key=lambda row: -row["pressureHpa"])
    result = []
    for pressure in LEVELS:
        nearest = min(rows, key=lambda row: abs(row["pressureHpa"] - pressure))
        tolerance = 120 if pressure == 1000 else 35
        if abs(nearest["pressureHpa"] - pressure) <= tolerance:
            result.append({**nearest, "pressureHpa": pressure})
    return result if len(result) >= 5 else None

def nearest_igra(observations, valid, latitude, longitude):
    candidates = [item for item in observations if item["valid"] == valid]
    candidates.sort(key=lambda item: (item["latitude"] - latitude) ** 2 + (item["longitude"] - longitude) ** 2)
    for candidate in candidates:
        levels = standardize_igra(candidate)
        if levels:
            return levels, candidate["stationId"]
    return None, None

def percentile(values, amount): return float(np.nanpercentile(values, amount))
def clamp(value, low, high): return max(low, min(high, value))

def domain_indices(fields):
    lat, lon = fields["lat"], fields["lon"]
    indices = []
    for y in range(DOMAIN_HEIGHT):
        # Display/world row zero is the northern edge. NARR's sampled latitude
        # must therefore decrease from north to south as y increases.
        target_lat = 42 - 14 * y / (DOMAIN_HEIGHT-1)
        for x in range(DOMAIN_WIDTH):
            target_lon = 255 + 30 * x / (DOMAIN_WIDTH-1)
            indices.append(int(np.argmin((lat-target_lat)**2 + (lon-target_lon)**2)))
    return indices

def build_atmosphere_frame(frame, hour_utc, indices):
    def values(key, transform=lambda value:value):
        return [round(float(transform(frame[key][index])), 3) for index in indices]
    t2 = values((11,"2m"), lambda value:value-273.15)
    td2 = values((17,"2m"), lambda value:value-273.15)
    mslp = values((2,"msl"), lambda value:value/100 if value > 2000 else value)
    u10, v10 = values((33,"10m")), values((34,"10m"))
    grids = {
        "mslpHpa":mslp, "temperature2mC":t2, "dewpoint2mC":td2,
        "u10Ms":u10, "v10Ms":v10,
        "height500m":values((7,500)), "temperature500C":values((11,500),lambda value:value-273.15),
        "temperature850C":values((11,850),lambda value:value-273.15),
        "temperature700C":values((11,700),lambda value:value-273.15),
        "temperature250C":values((11,250),lambda value:value-273.15),
        "u850Ms":values((33,850)), "v850Ms":values((34,850)),
        "u700Ms":values((33,700)), "v700Ms":values((34,700)),
        "u500Ms":values((33,500)), "v500Ms":values((34,500)),
        "u250Ms":values((33,250)), "v250Ms":values((34,250)),
        "capeJkg":values((157,"surface"),lambda value:max(0,value)),
        "cinJkg":values((156,"surface"),lambda value:abs(min(0,value)))
    }
    low_flat = int(np.argmin(mslp))
    low = {"x":low_flat % DOMAIN_WIDTH/(DOMAIN_WIDTH-1),
           "y":low_flat // DOMAIN_WIDTH/(DOMAIN_HEIGHT-1),
           "pressureHpa":mslp[low_flat]}
    def row_boundary(source):
        positions, strengths=[], []
        for y in range(DOMAIN_HEIGHT):
            row=source[y*DOMAIN_WIDTH:(y+1)*DOMAIN_WIDTH]
            gradients=[row[x+1]-row[x] for x in range(DOMAIN_WIDTH-1)]
            maximum=int(np.argmax(gradients))
            positions.append((maximum+.5)/(DOMAIN_WIDTH-1))
            strengths.append(max(0,gradients[maximum]))
        return positions, strengths
    cold_x, cold_strength = row_boundary(t2)
    dryline_x, dryline_strength = row_boundary(td2)
    warm_y, warm_strength=[], []
    for x in range(DOMAIN_WIDTH):
        column=[t2[y*DOMAIN_WIDTH+x] for y in range(DOMAIN_HEIGHT)]
        gradients=[column[y]-column[y+1] for y in range(DOMAIN_HEIGHT-1)]
        maximum=int(np.argmax(gradients))
        warm_y.append((maximum+.5)/(DOMAIN_HEIGHT-1))
        warm_strength.append(max(0,gradients[maximum]))
    return {"hourUtc":hour_utc,"width":DOMAIN_WIDTH,"height":DOMAIN_HEIGHT,
            "domain":{"latMin":28,"latMax":42,"lonMin":255,"lonMax":285,
                      "gridOrientation":"north-to-south"},
            "fields":grids,
            "features":{"surfaceLow":low,"coldFrontXByY":cold_x,
                        "drylineXByY":dryline_x,"warmFrontYByX":warm_y,
                        "coldFrontStrengthByY":cold_strength,
                        "drylineStrengthByY":dryline_strength,
                        "warmFrontStrengthByX":warm_strength}}

def build_corridor_record(date, corridor_index, index, mask, fields, valid_times, observations, old):
    target_lat = float(fields[1]["lat"][index])
    target_lon = float(fields[1]["lon"][index])
    sequence, station_ids = [], []
    for hour, valid, frame in zip((12, 18, 24), valid_times[:3], fields[:3]):
        levels = narr_profile(frame, index)
        source = "NOAA NCEI NARR"
        if hour in (12, 24):
            observed, station = nearest_igra(observations, valid, target_lat, target_lon)
            if observed:
                levels, source = observed, "NOAA NCEI IGRA 2"
                station_ids.append(station)
        sequence.append({"hourUtc": hour, "source": source, "levels": levels})
    u0, v0 = fields[1][(33, "10m")][index], fields[1][(34, "10m")][index]
    u5, v5 = fields[1][(33, 500)][index], fields[1][(34, 500)][index]
    u8, v8 = fields[1][(33, 850)][index], fields[1][(34, 850)][index]
    shear = math.hypot(u5-u0, v5-v0)
    llj = math.hypot(u8, v8)
    t2 = fields[1][(11, "2m")][index] - 273.15
    td2 = fields[1][(17, "2m")][index] - 273.15
    event_cape = max(0, float(fields[1][(157, "surface")][index]))
    event_cin = abs(min(0, float(fields[1][(156, "surface")][index])))
    srh = clamp(llj * shear * 0.23, 20, 500)
    overlap_score = clamp(
        (event_cape / 2500) * clamp(shear / 22, 0, 1.4)
        * clamp((td2 - 8) / 12, 0, 1.2) * clamp((180-event_cin)/150, 0, 1),
        0, 1)
    environment_class = "favorable" if overlap_score >= 0.48 else "marginal" if overlap_score >= 0.18 else "failed"
    environment = {
        "shear01Ms": round(math.hypot(u8-u0, v8-v0), 2), "shear06Ms": round(shear, 2),
        "srhProxyM2s2": round(srh, 1), "lclM": round(max(250, 125*(t2-td2)), 1),
        "cinJkg": round(event_cin, 1), "moistureTransportProxy": round(llj*max(0,td2+5), 1),
        "pressureFall6hMb": 2.5
    }
    local_cape = fields[1][(157, "surface")][mask]
    local_llj = np.hypot(fields[1][(33,850)][mask], fields[1][(34,850)][mask])
    diagnostics = {
        "heightRange500m": round(percentile(fields[1][(7,500)][mask],95)-percentile(fields[1][(7,500)][mask],5),1),
        "llj95Ms": round(percentile(local_llj,95),1),
        "cape95Jkg": round(percentile(local_cape,95),1),
        "deepShear90Ms": round(shear,1)
    }
    if old:
        base_intensity = old["intensity"]
        intensity = {**base_intensity,
            "score": round(float(base_intensity.get("score", 0)) * (0.45 + 0.55*overlap_score), 2),
            "environmentClass": environment_class, "overlapScore": round(overlap_score, 3)}
        outcomes = old.get("outcomes", {})
        family = old["pattern"]["family"]
    else:
        intensity = {"score":round(clamp(event_cape/55+shear*.7,5,80),2),
                     "band":"organized","reportCount":0,
                     "environmentClass":environment_class,"overlapScore":round(overlap_score,3)}
        outcomes, family = {}, "dryline_cyclone"
    return {
        "analogId":f"noaa-{date}-c{corridor_index+1:02d}", "eventDate":date,
        "sampleId":f"{date}-corridor-{corridor_index+1:02d}",
        "season":"spring", "intensity":intensity,
        "pattern":{"family":family, "troughAmplitude":0.5,"troughTilt":0.5,
                   "lowLevelJetStrength":clamp(llj/32,0,1),"moistureQuality":clamp((td2-10)/12,0,1),
                   "capStrength":clamp(event_cin/200,0,1),"forcingTiming":0.7,"discreteBias":0.7,
                   "environment":environment,"diagnostics":diagnostics},
        "soundingSequence":sequence, "outcomes":outcomes,
        "provenance":{"environment":"NOAA NCEI NARR","soundings":"NOAA NCEI IGRA 2 / NARR hybrid",
                      "reports":"NOAA Storm Events candidate-day screening",
                      "stations":sorted(set(station_ids)),
                      "target":{"latitude":target_lat,"longitude":target_lon},
                      "corridorIndex":corridor_index+1,"environmentClass":environment_class}
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", default="training-cache")
    parser.add_argument("--dates", default="data/noaa-training/candidate-dates.json")
    parser.add_argument("--legacy", default="data/analogs/historical-analog-catalog.json")
    parser.add_argument("--output", default="training-cache/processed/noaa-cases.json")
    parser.add_argument("--atmosphere-output", default="training-cache/processed/noaa-atmospheres.json")
    args = parser.parse_args()
    root = Path(args.cache)
    dates = json.loads(Path(args.dates).read_text())["dates"]
    legacy_payload = json.loads(Path(args.legacy).read_text())
    legacy = {row["eventDate"]: row for row in legacy_payload.get("records", legacy_payload)}
    observations = load_igra(root, dates)
    station_points = sorted({(item["latitude"], item["longitude"] % 360) for item in observations})
    records = []
    atmospheres = []
    for date in dates:
        day = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        valid_times = [day.replace(hour=12), day.replace(hour=18), day + timedelta(days=1),
                       day + timedelta(days=1,hours=6), day + timedelta(days=1,hours=12)]
        files = [root / "narr" / valid.strftime("%Y%m") / valid.strftime("%Y%m%d")
                 / f"narr-a_221_{valid:%Y%m%d}_{valid:%H}00_000.grb" for valid in valid_times]
        if not all(file.exists() for file in files): continue
        fields = [message_arrays(file) for file in files]
        indices = domain_indices(fields[0])
        atmospheres.append({
            "eventDate":date,
            "sequence":[build_atmosphere_frame(frame,hour,indices)
                        for hour,frame in zip((12,18,24,30,36),fields)]
        })
        cape = fields[1][(157, "surface")]
        td = fields[1][(17, "2m")]
        lat, lon = fields[1]["lat"], fields[1]["lon"]
        domain_mask = (lat >= 28) & (lat <= 42) & (lon >= 255) & (lon <= 285)
        near_station = np.zeros(domain_mask.shape, dtype=bool)
        for station_lat, station_lon in station_points:
            near_station |= ((lat-station_lat)**2 + (lon-station_lon)**2) <= 20
        base_index = sum(ord(char) for char in date) % len(TRAINING_CENTERS)
        centers = [TRAINING_CENTERS[(base_index + offset) % len(TRAINING_CENTERS)]
                   for offset in range(CORRIDORS_PER_DAY)]
        used_indices = []
        for corridor_index, (center_lat, center_lon) in enumerate(centers):
            local_region = ((lat-center_lat)**2 + (lon-center_lon)**2) <= 24
            mask = domain_mask & near_station & local_region
            # Select both favorable and failed corridors. Even-numbered samples
            # favor ingredient overlap; odd-numbered samples retain the most
            # unstable local parcel without requiring strong moisture.
            moisture = np.clip((td - 277) / 12, 0, 1)
            shear_field = np.hypot(
                fields[1][(33,500)]-fields[1][(33,"10m")],
                fields[1][(34,500)]-fields[1][(34,"10m")])
            if corridor_index % 2 == 0:
                score = np.nan_to_num(cape) * (0.25 + 0.75*moisture) * np.clip(shear_field/18, 0.35, 1.5)
            else:
                score = np.nan_to_num(cape) * (0.55 + 0.45*moisture)
            for used in used_indices:
                score = np.where(((lat-lat[used])**2 + (lon-lon[used])**2) < 4, -1, score)
            score = np.where(mask, score, -1)
            if np.nanmax(score) < 0: continue
            index = int(np.nanargmax(score))
            used_indices.append(index)
            records.append(build_corridor_record(
                date, corridor_index, index, mask, fields, valid_times,
                observations, legacy.get(date)))
        print(f"{date}: {len(records)}")
    output = Path(args.output); output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(records,indent=2))
    atmosphere_output=Path(args.atmosphere_output)
    atmosphere_output.parent.mkdir(parents=True,exist_ok=True)
    atmosphere_output.write_text(json.dumps(atmospheres,separators=(",",":")))
    print(json.dumps({"records":len(records),"atmospheres":len(atmospheres),
                      "output":str(output),"atmosphereOutput":str(atmosphere_output),
                      "igraObservations":len(observations)}))

if __name__ == "__main__": main()
