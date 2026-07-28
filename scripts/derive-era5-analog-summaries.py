"""Convert downloaded ERA5 GRIB event days into normalized analog descriptors."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import xarray as xr
import cfgrib
xr.set_options(use_new_combine_kwarg_defaults=True)

G = 9.80665
def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return float(max(low, min(high, value)))
def scale(value: float, low: float, high: float) -> float:
    return clamp((value-low)/(high-low))
def percentile(data, q: float) -> float:
    return float(np.nanpercentile(np.asarray(data), q))

def derive(pressure_path: Path, surface_path: Path) -> dict:
    p=xr.open_dataset(pressure_path,engine="cfgrib",backend_kwargs={"indexpath":""})
    surface_groups=cfgrib.open_datasets(str(surface_path),backend_kwargs={"indexpath":""})
    s=max(surface_groups,key=lambda ds:sum(name in ds for name in ("t2m","d2m","msl","cape","u10","v10")))
    cin_group=next((ds for ds in surface_groups if "cin" in ds),None)
    z500=p.z.sel(isobaricInhPa=500)/G
    z300=p.z.sel(isobaricInhPa=300)/G
    u850=p.u.sel(isobaricInhPa=850);v850=p.v.sel(isobaricInhPa=850)
    u500=p.u.sel(isobaricInhPa=500);v500=p.v.sel(isobaricInhPa=500)
    u_surface=s.u10 if "u10" in s else p.u.sel(isobaricInhPa=1000 if 1000 in p.isobaricInhPa else 925)
    v_surface=s.v10 if "v10" in s else p.v.sel(isobaricInhPa=1000 if 1000 in p.isobaricInhPa else 925)
    llj=np.hypot(u850,v850)
    deep_shear=np.hypot(u500-u850,v500-v850)
    shear01=np.hypot(u850-u_surface,v850-v_surface)
    shear06=np.hypot(u500-u_surface,v500-v_surface)
    srh_proxy=np.abs((u850-u_surface)*(v500-v_surface)-(v850-v_surface)*(u500-u_surface))
    height_range=percentile(z500,95)-percentile(z500,5)
    trough_amplitude=scale(height_range,350,1050)
    trough_tilt=diagnose_tilt(z500.isel(time=2))
    llj_strength=scale(percentile(llj,95),12,32)
    moisture=scale(percentile(s.d2m.isel(time=slice(1,None))-273.15,95),8,22)
    lcl=125*np.maximum(0,s.t2m-s.d2m)
    moisture_transport=np.hypot(u850,v850)*np.maximum(0,s.d2m-273.15)
    cape=percentile(s.cape,95)
    t700=p.t.sel(isobaricInhPa=700);t500=p.t.sel(isobaricInhPa=500)
    lapse_proxy=percentile(t700-t500,90)
    cap_strength=clamp(.62*scale(lapse_proxy,12,24)+.38*(1-scale(cape,250,2800)))
    cin_value=percentile(np.abs(cin_group.cin),90) if cin_group is not None else cap_strength*175
    falls=np.maximum(0,-np.diff(z500.values,axis=0))
    forcing_timing=scale(percentile(falls,95),5,65)
    pressure_falls=np.maximum(0,-np.diff(s.msl.values/100,axis=0))
    shear_support=scale(percentile(deep_shear,90),8,25)
    discrete_bias=clamp(.58*shear_support+.42*(1-forcing_timing))
    return {
      "family":family(trough_amplitude,forcing_timing,discrete_bias,llj_strength),
      "troughAmplitude":round(trough_amplitude,4),"troughTilt":round(trough_tilt,4),
      "lowLevelJetStrength":round(llj_strength,4),"moistureQuality":round(moisture,4),
      "capStrength":round(cap_strength,4),"forcingTiming":round(forcing_timing,4),
      "discreteBias":round(discrete_bias,4),
      "environment":{"shear01Ms":round(percentile(shear01,90),2),"shear06Ms":round(percentile(shear06,90),2),"srhProxyM2s2":round(percentile(srh_proxy,90),1),"lclM":round(percentile(lcl,50),1),"cinJkg":round(cin_value,1),"moistureTransportProxy":round(percentile(moisture_transport,90),1),"pressureFall6hMb":round(percentile(pressure_falls,95),2)},
      "diagnostics":{"heightRange500m":round(height_range,1),"llj95Ms":round(percentile(llj,95),1),"cape95Jkg":round(cape,1),"deepShear90Ms":round(percentile(deep_shear,90),1)}
    }

def diagnose_tilt(height) -> float:
    values=np.asarray(height);threshold=np.nanpercentile(values,30)
    weights=np.maximum(0,threshold-values)
    yy,xx=np.indices(values.shape);total=weights.sum()
    if total<=0:return 0.0
    x=(xx-(xx*weights).sum()/total);y=(yy-(yy*weights).sum()/total)
    covariance=np.array([[(weights*x*x).sum(),(weights*x*y).sum()],[(weights*x*y).sum(),(weights*y*y).sum()]])/total
    _,vectors=np.linalg.eigh(covariance);axis=vectors[:,-1]
    angle=np.arctan2(axis[1],axis[0])
    return clamp(-np.sin(2*angle),-1,1)
def family(trough,forcing,discrete,llj):
    if forcing>.72 and discrete<.45:return "progressive_cold_front"
    if trough>.68 and llj>.62:return "shortwave_ejection"
    if discrete>.72:return "dryline_cyclone"
    return "lee_cyclogenesis"

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--input",default="data/raw/era5-event-days");parser.add_argument("--output",default="data/analogs/era5-derived.json");args=parser.parse_args()
    root=Path(args.input);results={}
    for pressure in sorted(root.glob("*-pressure-levels.grib")):
        date=pressure.name[:10];surface=root/f"{date}-single-levels.grib"
        if surface.exists():results[date]=derive(pressure,surface)
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(results,indent=2)+"\n")
    print(f"Derived {len(results)} ERA5 analog summaries.")
if __name__=="__main__":main()
