# Mesoanalysis page and sounding audit (2026-10-26)

**Files:**
- `js/sounding.js`: sounding maths, the skew-T and the hodograph.
- `js/pages/surfaceAnalysisPage.js`: the page.
- `server/mesoanalysisParameters.js`: the page's fields.
- `/api/live/sounding` (`server/WeatherAuthorityRuntime.js`): the sounding a click on the map opens.

**How it was checked:** an independent textbook implementation, which interpolates each profile to 1 hPa and builds heights
hypsometrically with virtual temperature. It was run on 8 warm-sector cells at 22Z (seeds 8181 and 5150). Nothing is changed
yet.

## Accuracy problems, by impact

1. **Heights use the surface temperature for the whole column** (`sounding.js` `pressureToHeight`).
   - At 500 mb the engine gives 5,337 m against a true 5,046 m; at 200 mb, 13,251 m against 11,403 m.
   - CAPE comes out 15-20% high.
   - The equilibrium level, and so the storm tops, come out 1.7-2.8 km too high.
   - "6 km" shear is really about 5.75 km.
2. **The mixed-layer parcel is an unweighted mean of levels** (`sounding.js` ~344).
   - The surface and 925 mb rows, only a few mb apart, count twice, so the parcel is 0.6 g/kg too moist.
   - Together with item 1, MLCAPE is 25-40% high. This is probably half or more of the known 2,260-against-1,370 gap.
   - The standard is the pressure-weighted mean θ and mixing ratio of the lowest 100 mb.
3. **Moisture aloft is fixed, not taken from a field:**
   - 700 mb dewpoint is the temperature less (12 + 14·EML);
   - 500 mb is the temperature less 18-26 C, and 250 mb less 28 C;
   - 850 mb is held at least 1 C below the temperature.

   So no sounding is ever moist aloft, and DCAPE, PWAT, the wet-bulb zero and mid-level humidity rest on these constants.
4. **About six real data points per sounding** (surface, 850, 780, 700, 500, 250 mb), interpolated to 25 mb.
   - Nothing lies between the surface and 850 mb, so the sounding shows no boundary-layer top, no low-level-jet nose and no
     shallow moisture.
   - The 0-1 km lapse rate is clamped at 2 C/km or more, so 38% of cells at 10Z hide a real inversion.
   - `boundaryLayerDepthM` exists but is unused.
5. **STP is a hybrid and labelled "fixed-layer".** It uses MLCAPE, MLLCL and a CIN term with 0-1 km SRH and 0-6 km shear;
   the variable `effectiveShearMs` holds the 0-6 km shear. Fixed-layer STP uses SBCAPE and SBLCL with no CIN term.
6. **SCP is not SPC's.** It uses 0-3 km SRH/100 and shear in kt/40, where SPC uses effective SRH/50 and an effective-shear term
   of 0 below 10 m/s and 1 above 20 m/s. Results differ by ±30%.
7. **The "effective layer" is the ground up to min(EL, 6 km).** The CAPE ≥ 100 and CIN ≥ -250 test is not applied. Nothing
   reads it.
8. **The LFC is the first buoyant layer above the LCL,** so a small buoyant pocket under the cap hides the cap's CIN (one case
   shows -5 against -39).
9. **SRH is taken as an absolute value,** so anticyclonic SRH reads as positive and feeds STP.
10. **Stull's wet-bulb formula assumes sea-level pressure.** It is used for DCAPE, the wet-bulb zero and the trace.
11. **Smaller:**
    - the convective temperature is a guess;
    - the skew-T shades CAPE and CIN from T, not Tv;
    - the hodograph's wedge uses the engine's storm motion while its SRH uses Bunkers;
    - wind direction and speed are interpolated separately.

## Fine

- The virtual temperature correction in CAPE.
- The Bolton LCL and the pseudo-adiabat table.
- The MU search over the lowest 300 mb.
- Bunkers motion within 0.5 kt.
- 0-1 and 0-3 km SRH within 1-3 m²/s²; 0-6 km shear within 1-3 kt.
- Lapse rates.
- SHIP and WNDG match SPC.
- PWAT integration.

## Improvements, by value to a chaser or forecaster

1. Fix heights and the mixed-layer parcel (items 1 and 2), then retune and recalibrate. CAPE feeds the storm engine and the
   outlooks.
2. Compute a real effective inflow layer, then effective SRH, effective shear, effective STP and SCP. Keep fixed-layer STP
   under its own name. Show the layer on the skew-T and hodograph.
3. Make SRH signed, and label every composite fixed or effective.
4. Add structure:
   - a boundary-layer-top level;
   - a night inversion level;
   - moisture aloft from a field;
   - no lapse-rate clamps.
5. Use SHARPpy's CIN/LFC rule.
6. Show fields already computed: SBCIN, MUCIN, DCAPE, 0-1 km and 850-500 lapse rates, 3CAPE, PWAT, freezing and wet-bulb-zero
   heights, SHIP, WNDG, critical angle.
7. Add new fields:
   - surface θe and mixing ratio;
   - LFC height and the LCL-LFC gap;
   - 3-hour pressure change;
   - storm-relative winds;
   - SPC-style combinations (CIN hatched over CAPE).
8. On the skew-T, add:
   - an SB parcel and a Tv parcel;
   - a pressure-aware wet bulb;
   - one storm motion for the wedge and the SRH;
   - storm-relative wind against height;
   - soundings for past frames.
