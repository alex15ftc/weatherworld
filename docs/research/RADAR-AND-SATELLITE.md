# Proper radar and satellite for the game: research and plan

Written 2026-11-07. Research only; no code changed. Sources are cited inline.
- **Sources checked the same day:** each cited number was checked against the paper or page and
  corrected where it was wrong.
- **[unverified]:** the few values that could not be confirmed online.

## 1. Where the game stands today

### Radar (engine, `js/radar/`)
The engine already runs a real per-site volume-scan simulator:
- **Sites:** 11 radars from the world map (seed 1); fallback 7. Each has 230 km range,
  0.5 km gates, 720 radials (0.5°), 14 tilts 0.5–19.5° (VCP-12-like), 0.95° beam and a
  4/3-earth beam path. See `js/radar/RadarFormat.js:4-25`.
- **Products scanned:** REF, VEL, SRV, SW, CC, ZDR.
- **Mosaics:** composite, base, echo tops, VIL, MESH. They are built in code but not served.
- **Echo source:** `js/radar/PrecipitationField.js`, a per-storm falling-particle model.
  - Drops, snow, graupel and hail are released by the updraft and carried by the storm-relative
    wind, the mesocyclone, the front-to-rear current and sub-cloud evaporation.
  - Hook, notch, BWER and anvil emerge from that transport, not from drawn lobes.
  - It has an inner 0.4 km grid round the main updraft and a debris cloud on a 0.25 km grid.
- **Already modelled:** bright band, ZDR column (rain lofted above freezing), three-body scatter
  spike, range folding (purple), ground clutter with anomalous propagation, clear-air
  insects/birds with a dusk bloom, SNR noise, and a TDS. In the TDS, debris gets random ZDR and
  CC 0.25–0.6.
- **Velocity:** 16 km grid wind plus analytic storm winds:
  - Rankine mesocyclone, Vmax = 6 + 30·strength;
  - tornado vortex at 0.85 × EF wind;
  - outflow down the rain-heaviness gradient;
  - anvil divergence, rear-inflow jet and front-to-rear flow.

### What reaches Roblox
- Only the **0.5° REF/VEL/SRV** per site goes out, as raw polar 720×460 bytes, zstd+base64
  (`server/GameProducts.js:54`, `:190-200`). The client draws them with
  `client/Products/Layers/Radar.luau` → `Raster.polar` into one ≤1024² EditableImage.
- There are no tilts, no CC/ZDR/SW, no loop, and no readout.
- A new scan comes every storm tick (37.5 s real), and the client keeps it alive every 30 s.

### Second radar: the storm lab
- `stormlab/shared/Sim/Radar.luau` has aliasing, fall-speed correction, CC, TDS and a
  sweep display with tilts and zoom (`stormlab/client/UI/Radar.luau`, 512² canvas,
  1.6 ms/frame budget).
- It is **not mapped into the main game UI.**

### Precipitation and convection
- **Every echo belongs to a convective storm object.** There is no stratiform, frontal, orographic
  or winter precipitation, no sleet or freezing rain, and no precipitation field on the 16 km grid.
- Storm drivers are scalars: updraught m/s, a 0–1 precipitation budget, hail size from a power law,
  meso strength, cold pool.
- `storm.radar.maxReflectivityDbz` is a formula (28 + 42·intensity + 9·hailProb). It is not the
  simulated echo.

### The mismatch that matters most
The in-world storm (engine frames, `js/storms/StormStructure.js:203`) sets its rain from that
**formula**. The radar uses the **particle field**. So the rain shaft a player drives through and
the radar echo they look at come from two different models. Two more disagreements:
- The lab radar is a third model again.
- The cloud model's qr/qh/qsn, where it still runs, feeds no radar.

### Satellite
None. The available inputs are:
- 3-layer cloud shares on the 16 km grid (`RegionalAtmosphere.js:1204-1219`);
- per-storm EL, overshoot (`StormAppearance` overshootM = 1800·ramp(w, 25, 60)), anvil
  length/width;
- the frames' cloud base/top runs and anvil snow;
- the soundings, for temperature at height.

No chase game found (Roblox or PC) offers satellite, so the niche is open.

## 2. What "proper" means: what enthusiasts check first

Ranked by what a RadarScope or GR2Analyst user notices. Sources: radar research notes (§5);
Twisted and Helicity changelogs.

1. **Beam geometry is honest.**
   - The same storm looks different from two radars.
   - Couplets dilute with range: beam width ≈ range × 0.0166, so 1.65 km at 100 km.
   - Low-level rotation goes unseen far out (0.5° beam ≈ 1.7 km AGL at 100 km).
   - Cone of silence.
   - **The engine has this.**
2. **Scan timing.**
   - Per-tilt timestamps, a 4–4.5 min volume (VCP 212), and SAILS/MESO-SAILS so the 0.5° tilt
     refreshes every ~1.5–2.5 min.
   - VCP 12 ≈ 4.1 min (ROC). MESO-SAILS×3: the 0.5° revisit is 73–89 s.
   - Players expect a loop.
   - **Game: one image per storm tick, no loop.**
3. **Velocity realism.**
   - Aliasing: an outbound speed above Vn shows as V − 2Vn, about 27–34 m/s on low tilts. It must
     be mostly dealiased, with occasional fold errors near tight couplets.
   - Purple RF, the zero isodop, SRV.
   - **Game: no Nyquist at all; values clamp at ±63.5 m/s.**
4. **The tornado on radar.**
   - Vrot read from the beam-sampled vortex must match the tornado's real strength for its range.
   - Smith et al. 2015, from the paper's text (supercell 0.5° peak Vrot, sampled ≤10 kft ARL, so
     within ~101 mi):
     - <30 kt: ≥90 % EF0–1.
     - 60–69.9 kt: 55–60 % EF2+.
     - 80–89.9 kt: 65–70 % EF3+, 20 % EF4+.
     - Mean Vrot by rating: EF0 35, EF1 41, EF2 51, EF3 65, EF4+ 76 kt (Table 1).
     - The 30–60 kt bins are only in Fig. 12 **[unverified]**.
   - TVS and meso markers.
5. **Dual-pol from a forward operator, with noise. Not painted.**
   - CC, ZDR, **KDP derived from a noisy ΦDP** (that gives KDP its "smudged" real look), and HCA.
   - **Game: CC/ZDR exist, no KDP/HCA, not shipped.**
6. **A TDS that behaves like the real one.**
   - It needs a couplet plus low CC, ZDR ≈ 0 and high Z.
     - Ryzhkov 2005 thresholds: ρhv < 0.8, ZDR < 0.5 dB, Z > 45 dBZ, with a hook and a vortex.
     - NWS training uses CC < 0.85–0.90.
   - It is rare for weak tornadoes. Van Den Broeke & Jauernic 2014 give EF0 8 %, EF1 24 %,
     EF2 57 %, EF3 83 %, EF4–5 100 %.
   - It rises higher for stronger tornadoes. Entremont & Lamb (AMS 2015, >180 cases): debris at
     ≥10 kft makes a strong/significant tornado (EF2+) increasingly likely.
   - Bodine et al. 2013: higher EF goes with taller and larger TDS volume, higher Z, and lower CC
     and ZDR.
   - Fallout lingers 1–3 scans.
   - **Game: every grounded tornado gets debris scaled by wind; ZDR/CC are uniform noise.**
7. **Supercell dual-pol fingerprints in the right places.**
   - ZDR arc (3–6 dB) on the inflow edge of the forward flank.
   - KDP foot deeper in the core.
   - ZDR column above 0 °C over the updraft.
   - Hail core with low ZDR and CC 0.85–0.95.
   - Melting hail raising ZDR and KDP near the ground.
   - TBSS behind ≥60–65 dBZ cores.
8. **Artifacts.**
   - Clutter and AP at night, bio bloom, blockage spokes, a bright band in stratiform rain.
   - Clutter-filter notching on the zero isodop.
   - **The engine has most of these, except stratiform rain to show a bright band in.**
9. **App-standard display.**
   - NWS/GR palettes (support `.pal` import), raw-gates vs smoothed toggle.
   - Cursor readout: value, range, **beam height**.
   - Tilt keys.
   - Level III-style overlays: storm IDs, hail icons, TVS triangle, meso circle.
   - Cross-section (a GR2Analyst favourite).
10. **Radar and world agree.** The hook, wall cloud, hail shaft and debris cloud the player sees
    line up with the gates. (Today they don't; see §1.)

What other chase games did (for scale):
- **Twisted v1.20:** pixelated "true accurate values" radar, base velocity, two new sites (KHZL NWS
  and THIB airport), and noise and less accurate values farther from the radar.
- **Twisted v1.18:** debris balls show purple/white dBZ with extensive damage. TVS and hail
  markers are inaccurate unless a DOW is present.
  [1.20](https://devforum.roblox.com/t/twisted-beta-120-changelog/2480485),
  [1.18](https://devforum.roblox.com/t/twisted-118-change-log/1988107)
- **Helicity v1.8:** client-side radar, velocity, settings, site switch, tracks, mesonet readings,
  and a **deployable DOW** with fast short-range high-res scans and gate-to-gate shear.
  [1.8](https://devforum.roblox.com/t/helicity-update-18/2778001)
- Weatherworld's engine radar is already physically deeper than both. What's missing is
  **exposure, consistency and the velocity/dual-pol details** above.

## 3. Recommended plan

The principle ([[no-hardcoding-or-painting]]): **one hydrometeor and wind truth per storm. The
radar, satellite and in-world visuals are all forward operators on it.** The radar only samples;
it never invents.

### R1. One truth for rain (do first: it fixes the radar/world mismatch)
- Make the in-world frame's rain/hail columns come from the **same particle field** the radar
  scans, replacing the `maxReflectivityDbz` formula in `StormStructure.js:203`.
  `StormPrecipGrid.js` already reduces that field to a low-level grid for rain shafts, so the
  path exists.
- Retire the dead `StormInternalField`.
- Engine work that changes frames → run the [[regression-suite]].

### R2. Ship what the engine already scans (cheap, big visible gain)
- Add `correlationCoefficient`, `differentialReflectivity` and `spectrumWidth` to
  `radarSiteProducts`.
- Allow a `tilt` parameter (start with 0.5/0.9/1.3/1.8/2.4/3.1/4.0/6.4).
- Export the palettes; CC/ZDR/SW stops already exist in `RadarFormat.js`.
- Keep the last ~10 scans per watched site and product for a **loop**.
- Add per-scan timestamps and a cursor readout (value, range, beam height AGL).
- **Bandwidth:** a polar tilt is 331 KB raw. Compressed it's small away from storms, but it's per
  product. Fetch only the shown product and tilt (on demand, like today).
- **Next option:** crop to a 512² Cartesian window round the view (`Raster.grid` already exists).

### R3. Velocity realism (engine, `RadarSimulator.js`)
- **Nyquist folding:** per-tilt Vn from a VCP table (25–34 m/s in VCP 12/212).
- **Dealiasing:** the real 2-D VDA has been fielded since RPG Build 13 (2012).
  Fold V into ±Vn.
- **Dealiasing:** add a simple 2-D dealiasing pass on the folded field (unfold from the
  environment VAD wind as the first guess). It will leave its own occasional errors in tight
  couplets, just like the real VDA. Don't place errors by hand.
- **Raw view:** offer "raw" (aliased) as an option for enthusiasts.
- **Fall speed:** subtract it on tilted beams (the lab radar already does).
- **Vrot readout and detections:**
  - Run a mini MDA/TDA on the scanned velocity, with the WSR-88D TDA defaults
    (Mitchell et al. 1998):
    - pattern vectors: gate-to-gate ΔV ≥ 11 m/s, within 100 km;
    - features at ΔV 11/15/20/25/30/35 m/s;
    - TVS: low-level ΔV ≥ 25 m/s, max ΔV ≥ 36 m/s, depth ≥ 1.5 km, ≥3 2-D features,
      base ≤ 0.6 km or the 1.0° tilt.
    - Show TVS triangles and meso circles.
  - Diagnosing from the scan, not from the storm object, gives range dilution for free.
  - Rotation tracks = max low-level azimuthal shear over 60 min (LLSD).

**Status (2026-11-07):** built, rotation tracks included.
- Vn is one value, 34.3 m/s (S-band, 117 km Rmax), not per tilt.
- Dealias: environment-wind first guess, then 2 passes against the median of neighbours. It misses only in tight, close couplets.
- `rawVelocity` is a site product.
- `js/radar/RotationDetection.js` runs the TDA with the defaults above (one ΔV threshold, no 11/15/20... ladder) and an MDA outline (shear segments 2–10 km, ≥ 3 segments, ≥ 3 features, ≥ 3 km deep). Depth is measured to half a beamwidth beyond each end.
- The game reads `radar.rotation.<ID>` and draws meso circles and TVS/ETVS triangles, with Vrot compared against the Smith et al. 2015 EF means.
- Rotation tracks (`radar.mosaic.rotationTrack`, product `azShear`):
  - each radar's lowest scan gives LLSD azimuthal shear, with the operational kernel of 2500 m across by 750 m deep and equal weights (Mahalik et al. 2019, WAF 34, 415, verified). Our 500 m gates make the kernel 1 gate deep and at least 3 radials wide;
  - only where the beam centre is at most 2 km above the radar;
  - laid on the 1-km mosaic grid, the strongest radar winning;
  - the greatest of the last 60 sim-min of scans kept.
- The track builds up only from when it is first asked for, and the product says how many scans it holds.
- Seed 2 at 21Z: tornadic storm 0.012 /s, strong mesos 0.006–0.011 /s, background 99th percentile 0.004 /s. Colours start at 0.004.
- Cost: 11 lowest scans on the radar threads (first build ~3.7 s, then kept ready); 0.15 s of main thread a tick for the shear.

**Lab elements in the engine radar (2026-11-07):**
- **Vertical air motion:** each storm's updraught (`updraughtProfile`, rain-field `cores`) is added on tilted beams as (w - fall speed)·sin(tilt). Seed 2 at 21Z: +1.3 m/s mean at 10°, +3.1 at 19.5°, up to +10; nothing at 0.5°.
- **Velocity noise:** SD = sqrt(λσv / (8√π·M·Ts)) (Zrnić 1977; NCAR TN-331 eq. 3.25), M = 40 pulses, so 1 m/s at σv = 4 m/s.
- **One cold pool:**
  - the radar's cold pool is the in-world frame's (StormStructure): the rain footprint spread by ColdPool.js's speed over coldPoolTauS, capped at 0.7·coldPoolRadiusKm, and left behind by half the motion;
  - its depth and speed come from ColdPool.js;
  - the outflow wind is strongest at the pool's edge;
  - the gust-front fine line sits at the pool's leading edge, ahead of the rain, 1.2 km wide, with insect echo scaled by the pool's speed.
- **250 m gates when zoomed in:**
  - `scanRadarTilt(..., { gateKm })`, `RADAR_FINE_GATE_KM`;
  - game id `radar.site.<ID>.<product>.<T>.fine` (920 gates to 230 km);
  - Radar.luau asks for it once a 500 m gate spans 2 or more pixels, not on network maps;
  - it costs 1.8x a scan and packs to 315 KB against 175 KB; it matches the 500 m scan to 0.01 dBZ on average.
  - Rotation detection and tracks stay on 500 m scans.

### R4. Dual-pol as a forward operator (engine)
Per gate:
- **Sum** linear Z per species: rain, snow, graupel, hail, debris, bio.
- **Weight** ZDR and CC by each species' Z share. **Add up** KDP from liquid only.

Starting tables (S-band; Park 2009 HCA, Kumjian 2013 review, Ryzhkov 2005):

| Species | ZDR dB | CC | KDP °/km |
|---|---|---|---|
| Rain | ≈ max(0.1, 0.07·(Z−15)), or from Z-weighted drop D (the engine's 0.8D−0.5 is fine) | 0.985–0.995 | ≈ 0.01·R^1.22 (inverse of R = 44·KDP^0.822) |
| Big drops (size-sorted edge) | +1.5–3 | 0.95–0.98 | ~0 |
| Dry hail | −0.5–0.5 | 0.99 − 0.10·fh − 0.04·min(1, D/50); another −0.05 to −0.1 for D > 50 mm (resonance) | ~0 |
| Wet / melting small hail | 2–4 | — | melt-water bonus up to +3 |
| Melting layer (peak 250 m below 0 °C) | +1.5 | dips to 0.90 | — |
| Snow | 0.2 aggregates; 1.5–3 dendrites at −12 to −18 °C with low Z | 0.98–0.995 | 0.1–0.3 |
| Graupel | 0–0.5 | 0.97–0.99 | 0 |
| Debris | N(0, 1) | U(0.3, 0.75) | noise |
| Bio | 3–8 | 0.3–0.7 | — |
| Clutter | ±5 | 0.5–0.85 | — |

Then:
- **ΦDP:** build ΦDP = 2∫KDP dr + noise, then re-derive KDP over 9–25 gates. Add differential
  attenuation A_DP ≈ 0.004·KDP dB/km for the negative-ZDR streak behind big cores.
- **Noise:** σZDR 0.2–0.4 dB and σCC 0.005–0.02 at high SNR, worse at low SNR.
- **HCA:** a mini fuzzy-logic classifier on the simulated variables (Park et al. 2009 membership
  functions + melting layer). Its mistakes will be realistic.
- **ZDR arc:** comes from size sorting. The particle model already sorts by fall speed in shear,
  so the arc should appear if drop-size classes keep their identity per gate. Check before adding
  anything.

### R5. Debris that behaves (engine, `PrecipitationField.loftDebris`)
- **Debris amount** ∝ (wind above a damage threshold) × **land-cover debris availability**. Towns
  and forest are high, open crop is low; `LandSurface`/world map data exists.
  - This makes weak tornadoes over fields rarely show a TDS, matching observed rates. No dice roll.
- **Lofting height** grows with vortex strength and **time on the ground** (it is ~0.9–6 km today).
- **Fallout:** keep the debris particles after the vortex weakens so fallout drifts downstream for
  a few scans.
- **Doppler:** debris moves 10–30 % slower than the air (centrifuging), so Doppler under-reads.

### R6. Non-convective precipitation (bigger, engine)
- No bright band, winter type or stratiform shield is possible without a large-scale rain field.
- Minimal version: precipitation rate on the 16 km grid from saturated large-scale ascent.
  `cloudMid`/`cloudHigh` already come from ascent.
- Precipitation type from the soundings' warm-nose/cold-layer depths.
- The radar samples it with the same species tables.
- This is a sizeable engine change. Schedule it after R1–R5.

### R7. Mobile radar (gameplay)
- Twisted and Helicity both found that a **short-range, high-res radar** is the most loved item.
- The lab radar (`stormlab/shared/Sim/Radar.luau` + `UI/Radar.luau`) is a ready DOW:
  - X-band-like, 30–60 km;
  - 250 m × 0.5°;
  - sweep animation, tilts, CC.
- Wire it into the game, sampling the **engine** particle/debris field near the player.
- **Data:** ship a small 3-D slab: ~12 levels × 0.5 km within ±20 km of a deployed truck, only to
  that player.
- **Keep the radar logic in the engine** ([[roblox-ui-port]]): the engine scans for the truck's
  position and sends a polar product at 250 m.
- **Screen:** a SurfaceGui laptop in the vehicle can show the same EditableImage
  (`ImageContent`).

## 4. Satellite plan

Built in the engine as products like radar. Cheap to compute; no chase game has it.

**Inputs per 2 km pixel:**
- cloud ice/liquid water path and cloud-top height:
  - the 16 km cloud layers for the large-scale part;
  - per-storm columns (frames/particle field) for storms;
- temperature profile (soundings);
- upper-level humidity;
- sun position (game clock).

### S1. Clean IR (Band 13, 10.3 µm)
- **Columns:** sum top-down in radiance:
  `L = Σ B(T_k)·ε_k·Π(1−ε_j) + B(T_skin)·Π(1−ε)`, where `ε = 1 − exp(−k·ΔW)`.
  Use k ≈ 0.13 m²/g for liquid (published 0.11–0.16) and 0.06–0.10 m²/g for cirrus
  (Stephens AT622 notes, Table 16.1).
- **Planck:** B and B⁻¹ as 256-entry tables. Mix radiance, not temperature, so thin anvil edges
  read warmer.
- **Overshooting top:** a dome of height `Δz ≈ w/N` (N ≈ 0.02 s⁻¹ stratosphere), giving
  `T ≈ T_EL − ~8 K/km·Δz`. It pulses with the updraft and replaces the flat 1800·ramp overshoot.
  - **Caveat:** w/N is an upper bound. Mixing makes real overshoots shallower; Bedka 2010's
    CloudSat case was ~1.2 km above the tropopause. Scale it down and tune against the
    temperatures below.
  - **Temperatures:** the detection ceiling is 215 K (−58 °C); strong Plains tops reach about
    −81 °C (Brunner 2007 example).
- **Enhanced-V / cold-U and above-anvil plume:**
  - Only where the top is ≥2 km above the tropopause.
  - Plume downwind in the upper storm-relative wind, at the warmer stratospheric temperature.
  - Driven by w and tropopause height, never a label.
- **Colour table:** enhanced IR (grey above −20 °C → blue → green → yellow/orange → red at
  −60 to −70 → dark red → white → magenta below −90), plus a greyscale toggle.
- **Real detection rules for the game's own detector:**
  - Bedka 2010 OT test:
    - BT ≤ 215 K and ≤ the tropopause temperature;
    - ≥ 6.5 K colder than the mean anvil, sampled at 8 km radius in 16 directions;
    - the anvil pixels must be ≤ 225 K on ≥ 5 of the 16 radii;
    - skip candidates within 15 km of a colder one;
    - FAR 4–39 % depending on settings.
    [paper](https://www.ssec.wisc.edu/~jasono/papers/bedka_jamc_feb2010.pdf)
  - Enhanced-V (Brunner et al. 2007, WAF 22, 853–872): a cold/warm couplet > 20 K with
    V-arms opening > ~71° made tornado or hail most likely.
  - AACP storms (Bedka et al. 2018, WAF 33, 1159–1181):
    - 14× the reports per storm;
    - 73 % of significant severe reports came from AACP storms;
    - 75 % of supercells had one;
    - the plume appeared a mean 31 min before severe weather.
    [Bedka 2018](https://training.tools.eumetsat.int/cwg/res/pdf/Bedka_AboveAnvilCirrusPlume_Weather_and_Forecasting.pdf)

### S2. Visible (Band 2)
- **Optical depth:**
  - Liquid: `τ = 3·LWP/(2ρw·r_e) = 1.5·LWP[g/m²]/r_e[µm]` (r_e ≈ 10 µm).
  - Ice: Fu 1996 (J. Climate 9, 2058): `τ ≈ IWP·(−6.656e-3 + 3.686/D_ge)` ≈ 3.7·IWP/D_ge.
    - D_ge is Fu's generalised effective size (D_e = r_e/0.6495).
    - Coefficients **[unverified]**: not confirmed online.
- **Reflectance:** the two-stream form with mean path cosine 1/√3:
  `R = (√3/2)(1−g)τ / [1 + (√3/2)(1−g)τ]`. With g = 0.85 this is `τ/(τ+7.7)`.
  - The Lacis & Hansen 1974 attribution is common, but the scan could not be read.
  - Don't mix it up with Bohren's `(1−g)τ/(2+(1−g)τ)`, which gives τ/(τ+13.3).
  - With sun angle μ0 (Eddington, black ground):
    `R = [(1−g)τ + (2/3 − μ0)(1 − e^(−τ/μ0))] / [4/3 + (1−g)τ]`.
  Add ground: `R + (1−R)²A/(1−RA)`, A ≈ 0.15–0.2.
- **Display:** stretch as 255·√R.
- **Texture:** a Lambert term from ∇(cloud-top height).
- **Shadows:** one sweep along the sun azimuth with a running max of `z − d·tan(sun elevation)`.
  At low sun this gives OT, gravity-wave and plume shadows, the signature forecasters look for.
- **Cumulus fields:** the 16 km low-cloud share plus a seeded texture inside its range gives
  cumulus lines along boundaries and drylines, and clear holes in outflow.

**Status (2026-11-07): S1 and S2 built, first version.**
- `js/satellite/Satellite.js` (`buildSatellite`) and `SatelliteFormat.js`: both images together on a 2 km grid (403²), one byte a pixel. IR is °C from −110 in 0.6 steps; visible is √reflectance.
- **Storm clouds (redesigned 2026-11-07): one anvil field, `js/satellite/AnvilField.js`.**
  - Each storm tick each storm puts out a puff: the ice its updraught detrains (`StormStructure.stormCloudTop` → `detrainment`, the same flux the frame's anvil uses; frames still 48/48 byte-identical).
  - A puff is a ring of anvil: it spreads as an umbrella cloud, R(t) = (3λNQt²/2π)^⅓ (Woods & Kienle 1994; λ 0.2), with Q the core's volume flux and N the stability at anvil height, while the wind at that height carries it. Its ice decays as exp(−t/anvilTauS); puffs are dropped after 4 lifetimes.
  - This gives back-sheared upwind edges where spreading outruns the wind, fans downwind, one merged shield where storms crowd, and old anvils that outlive their storms.
  - Plumes: when the parcel's top passes the tropopause (searched from 1 km under the EL), a tenth of the overshoot above it (Homeyer et al. 2017) stays in the stratosphere. It spreads on the wind there, as warm as the air there, and its ice comes out of the anvil's.
  - Rings are mixed over 5 km (Gaussian), so a moving storm's rings join into one sheet. Only cloud thicker than 5 g/m² tilts the light or casts shadows.
  - The server keeps the field and updates it on every storm tick (about 7 ms; about 5,400 puffs on seed 2 at 21Z). Without one, `buildSatellite` makes one from the storms' tracks.
  - With `regional` given, a cell's high-cloud share is not drawn as cirrus where it is only the storms' coarse anvil, so anvils aren't drawn twice.
  - Anvil tops: air lifted dry-adiabatically half the overshoot above the EL. The updraught dome rises from the EL to the parcel's top and is colder still.
- **Large-scale clouds:** the cells' low/mid/high shares, with a soft seeded texture moving with each layer's mean wind (part-cloudy pixels). Water: adiabatic low cloud, 0.02 g/m³ mid (τ 2-10), 0.01 g/m³ cirrus.
- **IR:** Planck radiance mixed top down.
- **Visible:**
  - Eddington two-stream with the sun angle, layers combined by the adding method, ground albedo 0.08 (red band, green vegetation);
  - Lambert lighting on storm tops, shadows from storm tops toward the sun;
  - the sun is worked out from the engine's own sunrise and sunset.
- **Game:**
  - products `satellite.ir` and `satellite.visible`, asked for, kept and looped like the radar mosaics (~29 KB and ~23 KB);
  - ProductFeed allows them on demand;
  - new Roblox layer `Products/Layers/Satellite.luau`, drawn under the radar, with an IR/visible toggle, loop, hover readout and legend;
  - `Palettes.SATELLITE` exported.
- **Cost:** about 0.8 s an image while asked for (puff rings ~0.4 s, shadow march most of the rest), plus ~7 ms a storm tick for the field.
- **Seed 2 at 21Z:** storm tops −55 to −73 °C, warmest clear ground +30 °C.
- **Meteorologist review (2026-11-07):**
  - Good: shadows, visible brightness at both sun angles, IR range, storm layout.
  - Open, biggest first:
    1. anvils are cones (real ones are ovals or fans 100-250 km long, with a back-sheared upwind edge 10-30 km);
    2. no merged outbreak shield;
    3. no enhanced-V or above-anvil plumes;
    4. no cumulus lines along boundaries and no clearing in cold pools.
  - 1-3 addressed by the anvil field above (not yet re-reviewed). The plan was: anvil ice as one shared field on a grid. Detrainment is the source; it spreads as a gravity current (Lilly 1988) and is carried by the EL wind; it decays by settling and sublimation; stratospheric ice above the anvil comes from overshoots past the tropopause.
- **Not yet:** parallax, the detection rules, water vapour.

### S3. More products, in priority order after IR and visible
1. **Sandwich:** IR at ~60 % opacity over visible.
2. **Mesoscale sector:** follows a chosen storm at 1 game-min (7.5 s real), versus the full map at
   5 game-min (37.5 s, one storm tick). GOES runs CONUS at 5 min and two sectors at 1 min.
3. **GLM flash extent density:** from the engine's lightning strikes on a 2 km grid, 1-min.
4. **Upper water vapour (6.2 µm):**
   - either BT at the τ = 1 level of a humidity-weighted path,
   - or inverted Soden–Bretherton: `UTH = cos(θsat)·exp(31.50 − 0.115·Tb)`, so
     `Tb = (31.5 − ln(UTH%/cos θ))/0.115` (100 % → 234 K, 10 % → 254 K at nadir).
     - Fitted for GOES VAS 6.7 µm, not ABI 6.2 µm. Retune the constant for the game's band.
     [source](https://www.ssec.wisc.edu/stennis/goes_vas_product_set/science_eval/cfh_uth/index.html)
5. **Day Cloud Phase RGB:** shows glaciation during initiation.
6. **Night fog:** BT13 − BT7.
7. **Cloud-top cooling rate:** ΔBT over 15 game-min.

### Transport
- Satellite is one map-wide raster.
- A 2 km pixel over the 805 km map is ~400², about 160 KB at 8 bits and much less with zstd,
  since cloud is smooth.
- Send it like the other products via ProductFeed, polled per storm tick.
- The mesoscale sector is a small crop, ~128² at 0.5–1 km.

## 5. Roblox limits that shape this
- **EditableImage:**
  - The memory budget is per device: one 1024² RGBA ≈ 4 MB. One developer ran out at 5–6 images.
  - Creation can fail, so always check for nil and `Destroy()`.
  - Docs: "The maximum size is 1024×1024"; "Only a single EditableImage can be updated per frame
    on the display side."
  - [docs](https://create.roblox.com/docs/reference/engine/classes/EditableImage),
    [budget thread](https://devforum.roblox.com/t/failed-to-create-empty-editableimage-that-was-requested-due-to-reaching-memory-budget-limits-error/3490799)
  - So a radar loop should keep **bytes** (polar or indexed) per frame and repaint one image, not
    hold 10 images.
- **HTTP:** 500 requests/min per server and no hard body cap (the old 1 MB came from the library).
  [rate limits](https://create.roblox.com/docs/cloud/reference/rate-limits)
- **Remotes:** UnreliableRemoteEvent drops payloads over 1,000 bytes (docs). The project's own client budget is 4–20 KB/s per
  player (`docs/cloudlab/NETWORK.md`). Radar and satellite are on-demand when the map is open, so
  they don't count against the storm-frame budget while it is closed.

## 6. Suggested order
| Step | What | Size | Why first |
|---|---|---|---|
| R2 | Ship tilts, CC, ZDR, SW, loop, readout | small | Engine already makes them; immediate "proper radar" feel |
| R1 | One rain truth for frames and radar | medium | Fixes radar vs. world mismatch; needed for everything after |
| R3 | Aliasing + dealias, Vrot, TVS/meso markers, rotation tracks | medium | Velocity is what chasers read most |
| S1+S2 | IR + visible + sandwich | medium | New feature nobody else has |
| R5 | Debris tied to land cover and strength | small | TDS rates become realistic |
| R4 | KDP/ΦDP, HCA, species tables | medium | Completes dual-pol |
| R7 | Mobile radar (DOW) | medium | Gameplay hook |
| S3 | Sector, GLM, WV, phase RGB | small each | Polish |
| R6 | Large-scale/winter precipitation | large | Bright band, stratiform, winter days |

## 7. Main references
- Radar
  - WSR-88D VCPs: [NWS RAC](https://training.weather.gov/wdtd/courses/rac/documentation/rac22-introduction.pdf)
  - MESO-SAILS: [ROC](https://www.weather.gov/media/roc/NewScience/MESO-SAILS_Description_Briefing_Jan_2014.pdf)
  - Level III product codes: [Supercell-Wx list](https://supercell-wx.readthedocs.io/en/stable/features/nexrad-l3.html)
- Dual-pol
  - Kumjian 2013 review: [JOM](https://nwafiles.nwas.org/jom/articles/2013/2013-JOM19/2013-JOM19.pdf)
  - Park et al. 2009 HCA: doi:10.1175/2008WAF2222205.1
  - Kumjian & Ryzhkov 2008, supercell signatures (ZDR arc, ZDR/KDP columns, rings, TDS):
    doi:10.1175/2007JAMC1874.1
  - The "KDP foot" term is usually credited to Romine et al. 2008 (MWR) **[unverified]**.
- Debris
  - Van Den Broeke & Jauernic 2014: doi:10.1175/JAMC-D-14-0094.1
  - Bodine et al. 2013, WAF 28, 139–158: doi:10.1175/WAF-D-11-00158.1
  - Ryzhkov et al. 2005 TDS: J. Appl. Meteor. 44, 557–570, doi:10.1175/JAM2235.1
  - Rain relations: R = 44·KDP^0.822 and Z = 300R^1.4 (Ryzhkov, Giangrande & Schuur 2005,
    doi:10.1175/JAM2213.1)
  - SimRadar (Cheong et al. 2017): doi:10.1109/TGRS.2017.2655363
- Rotation
  - Smith, Thompson, Dean & Marsh 2015, Vrot + STP → EF probabilities, WAF 30, 914–932,
    doi:10.1175/WAF-D-14-00122.1: [PDF](https://origin-east-www-spc.woc.noaa.gov/publications/smith/vrot-env.pdf)
  - TDA: Mitchell et al. 1998, WAF 13, 352–366.
  - MESH: Witt et al. 1998, WAF 13, 286–303 (MESH = 2.54·SHI^0.5).
    - Murillo & Homeyer 2019 refit, corrected in their corrigendum:
      MESH75 = 15.096·SHI^0.206, MESH95 = 22.157·SHI^0.212.
- Forward operators
  - Jung, Zhang & Xue 2008: doi:10.1175/2007MWR2083.1
  - CR-SIM: doi:10.5194/gmd-13-1975-2020
- Satellite
  - ABI bands: [NESDIS quick guides](https://www.nesdis.noaa.gov/abi-quick-guide-gallery)
  - Scan modes: [STAR](https://www.star.nesdis.noaa.gov/atmospheric-composition-training/satellite_data_abi_scan_modes.php)
  - Griffin et al. 2017, WAF 32, 5–25: comparing HRRRx-simulated (CRTM) and observed GOES IR
    brightness temperatures; notes a cold bias in ice clouds.
    [PDF](https://www.ssec.wisc.edu/~jasono/papers/griffin_waf_feb2017.pdf)
  - GeoColor: Miller et al. 2020, JTECH 37, 429–448, doi:10.1175/JTECH-D-19-0134.1
  - 3.9 µm reflective tops: Lindsey et al. 2006, MWR 134, 2342–2353
  - IR emissivity k values: [Stephens AT622 notes](https://reef.atmos.colostate.edu/~odell/AT622/stephens_notes/AT622_section16.pdf)
  - Sandwich: [EUMeTrain](https://eumetrain.org/sites/default/files/2025-03/sandwich_QG.pdf)
  - Day Cloud Phase: [CIRA](https://ramsdis.cira.colostate.edu/rammb/training/visit/quick_guides/QuickGuide_DayCloudPhaseDistinction_final_v2.pdf)
  - GLM gridded products: [quick guides](https://goes.noaa.gov/documents/GLM_Quick_Guides_May_2019.pdf)
