# How a tornadic supercell looks on radar over its life

These are reference notes for the storm lab's simulated radar (base reflectivity Z, storm-relative velocity SRV, correlation coefficient CC). Reference images are in `docs/storm-reference/radar/` (see the SOURCES.md there).

The values are typical ranges from the literature listed at the end. They come from published summaries and the NWS/WDTD/COMET training material, written from memory, so treat them as *typical bands, not exact constants*.

Orientation convention used throughout: a typical Plains supercell moving toward the **NE to E**, with south-westerly mid-level flow. On radar the hook is then on the **SW/S (right-rear) flank** and the forward flank and anvil extend to the **NE**. The inflow comes from the **SE**.

## Stage table

| # | Stage | Time from first echo | Radar appearance (0.5° Z unless noted) | Size | Typical values |
|---|---|---|---|---|---|
| 1 | Initiation / early cell | 0–20 min (first echo appears 10–20 min after the towering Cu) | First echo forms **aloft** at 4–8 km AGL, then the core descends and reaches the ground in ~10–20 min. Round to slightly oval cell | 5–10 km | 20–35 dBZ at first echo; 45–55 dBZ core aloft by ~15–20 min |
| 2 | Organization / split | 20–60 min | Cell elongates and splits into a right mover (cyclonic) and a left mover. The right mover turns 20–30° right of the mean wind. A mid-level meso (3–7 km) appears in SRV; a WER and then a BWER form; the Z gradient on the inflow (SE) side tightens; the inflow notch and the forward-flank precip extension develop | 10–25 km | Mid-level Vrot ≥15–20 m/s (30–40 kt); BWER 2–8 km tall and 2–5 km wide, capped by ≥45–50 dBZ |
| 3 | Mature (pre-tornadic) | 45–90 min | **Hook echo** on the right-rear flank; BWER over the inflow notch; hail core with TBSS and V-notch; long forward-flank precipitation and anvil echo downstream | 20–40 km wide, 30–60 km long (>20 dBZ); hook 5–10 km long, 2–4 km wide | Core 60–70+ dBZ; TBSS when the core is ≥60–65 dBZ; low-level meso Vrot 20–30 m/s |
| 4 | Tornadic | about 60–120 min (often 10–30 min after the hook appears) | Hook tightens into a ball. **Debris ball** at the hook tip. Gate-to-gate couplet (TVS). Clear slot / weak-echo region from the RFD. A DRC precedes it by 5–20 min | Debris ball 0.5–3 km; couplet core <1–2 km | ΔV ≥45 kt (23 m/s) gate-to-gate is a TVS; violent tornadoes reach ΔV 80–150+ kt (40–80 m/s) at short range. Debris: Z 50–70 dBZ, **CC 0.3–0.8**, ZDR ≈ 0 dB |
| 5 | Occlusion | 10–30 min after tornadogenesis | Hook wraps into a curl, spiral or ring. The couplet drifts **rearward and left** (W to NW) into the precipitation. The RFD gust front bulges E/SE. A new inflow notch and meso form 5–15 km **E–SE** | Ring or spiral 3–8 km | Old couplet weakens; new mid-level rotation appears downstream |
| 6 | Cyclic | Cycle period ~40–90 min (rarely 15–30 min) | Repeats stages 3→5. Between cycles: a broad, weaker hook with no debris, a broad couplet, and a renewed inflow notch | — | Tornado families with 15–60 min gaps |
| 7 | Decay | 2–6 h total life (long-lived storms 4–8 h+) | Becomes outflow-dominant. The hook vanishes; the gust front races ahead of the updraft; the inflow notch fills; the echo goes amorphous, or turns HP, bow or comma-shaped and merges into a line | Grows to 50+ km as an MCS | Core falls below ~50–55 dBZ; meso broad and weak (Vrot <15 m/s) |

## 1. Initiation and early cell (0–20 min)

New cells show up first as **echo aloft**, around 4–8 km AGL near the −10 to −20 °C level. They appear about 10–20 min after cumulus towers start. The first echo is 20–35 dBZ.

The core grows to 45–55 dBZ and descends to the surface 10–20 min later. A low tilt therefore lags the cell's appearance in a volume scan, or in a composite reflectivity product.

The shape is a round blob 5–10 km across, with no notch or appendage. In strong deep-layer shear, rotation can already show up in the updraft at mid levels within 15–30 min.

## 2. Organization and splitting (20–60 min)

In a straight hodograph, tilting of the environment's horizontal vorticity gives two vortices on the updraft flanks: a cyclonic one on the right and an anticyclonic one on the left. Pressure forcing that grows downward makes the cell **split** about 30–60 min after initiation (C5; Klemp & Wilhelmson 1978; Weisman & Klemp 1982).

- **Deviant motion.** The right mover moves ~20–30° to the right of the 0–6 km mean wind and somewhat slower. The Bunkers et al. (2000) estimate: ~7.5 m/s off the mean wind, perpendicular to the shear vector. Clockwise-curved hodographs favour the right mover strongly, and the left mover often dies.
- **Mid-level mesocyclone.** At 3–7 km, 3–8 km across, with Vrot ≥15–20 m/s, persisting for at least two volume scans (WDTD meso criteria). It forms in the first ~30–60 min of the storm's life.
- **WER and BWER.** Strong updraft speed stops precipitation from forming inside the updraft. The low-level echo pushes out toward the inflow, and the high-Z core sits *above* a weak-echo vault. That gives an overhang (WER), which becomes bounded (BWER) once rotation organises the updraft: 2–8 km deep, 2–5 km wide (C4, C6; Browning 1964; Chisholm & Renick 1972; Lemon 1977).
- **Reflectivity gradient.** It is tightest on the **inflow side (S–SE, right-front)**, where Z rises from <20 to >50 dBZ in ~2–5 km. The rear and left sides are more diffuse.
- **Inflow notch.** An indentation in the low-level echo on the right-rear/south side, under the BWER, where rain-free inflow enters.
- **Forward-flank extension.** Precipitation is carried downstream (to the NE) by the storm-relative mid- and upper-level winds. Within ~30–60 min the FFD echo stretches 20–40 km NE of the updraft.

## 3. Mature supercell (≈45–90 min)

- **Hook echo.** Precipitation is drawn cyclonically around the rear of the low-level meso by the RFD (Markowski 2002). It forms on the **right-rear (S–SW) flank**. It extends rearward and to the right of the main core, then **curls cyclonically (counter-clockwise)** around the updraft. Its free tip points **E–SE**, into the inflow notch.
  - Typical size: 5–10 km long, 2–4 km wide, 30–50 dBZ, with the strongest Z near the tip. The hook may be weak or invisible at long range, because the beam overshoots it.
  - Appearance of the hook typically comes **~10–30 min before tornadogenesis**, though many hooked storms never produce a tornado.
- **BWER.** It sits directly above the inflow notch and the hook-tip region.
- **Hail core.** Usually 60–70+ dBZ next to the updraft, on its forward or left side, sometimes ~5–10 km across. Cores ≥ ~60–65 dBZ in hail produce a **three-body scatter spike (TBSS)**: a spike of weak (5–25 dBZ) echo extending 10–30 km *radially away from the radar* behind the core (image 16; Lemon 1998). The TBSS is an artifact of the radar–hail–ground–hail–radar path, so it is tied to the radar's position, not to storm motion.
- **V-notch.** A notch in the downstream edge of the forward-flank echo that opens away from the updraft. It is caused by strong storm-relative flow diverging around the updraft, which acts as an obstacle (Lemon 1998). It is clearest at mid levels.
- **Forward-flank tail and anvil echo.** Low-level FFD precipitation reaches 30–60 km downstream. Higher tilts show anvil precipitation and debris 50–100+ km downstream (image 08). The low-level echo of the whole storm is ~20–40 km wide by 30–60 km long.

## 4. Tornadic stage

- **Lead-up.** The RFD strengthens, often signalled by a **descending reflectivity core (DRC)** coming down the back of the hook 5–20 min before the tornado (image 17; Rasmussen et al. 2006; Kennedy et al. 2007). Behind the hook a **clear slot** forms: a weak-echo channel in the RFD, 1–3 km wide, wrapping around the S/SE side of the meso.
- **Hook tip.** The tip tightens into a knob or ball at the **occlusion point**, where the RFD and FFD gust fronts meet (Lemon & Doswell 1979).
- **Debris ball** (images 01–04, 07, 08, 10). A 0.5–3 km knot of Z 50–70 dBZ at the hook tip. Dual-pol shows it as the **tornadic debris signature (TDS)**: **CC ≈ 0.3–0.8** in a background of >0.95, ZDR ≈ 0 dB or negative, collocated with the couplet (Ryzhkov et al. 2005). It usually needs an EF2+ tornado or a strong EF1 over a debris source. Debris can be lofted to 3–10 km (image 08, Mayfield).
- **Weak-echo hole.** Mobile radars resolve a 0.2–1 km **weak-echo hole** in the centre of the debris/ring, made by centrifuging of scatterers (Wurman & Gill 2000; Dowell et al. 2005). WSR-88D rarely resolves it.
- **Couplet and TVS.** SRV shows inbound and outbound maxima adjacent, often gate to gate (~0.25–1 km apart). A **TVS** is ΔV ≥ 45 kt (~23 m/s), extending through ≥2 tilts (Brown et al. 1978).
  - Significant tornadoes typically have **Vrot ≥ 40–50 kt** (Smith et al. 2015; Thompson et al. 2017). Violent ones reach ΔV 100–150+ kt at close range (image 05).
  - The low-level meso is 1–3 km wide; the tornado itself is sub-beam.

## 5. Occlusion (~10–30 min after tornadogenesis)

The RFD gust front surges around the S and E sides of the meso and cuts it off from warm inflow (Lemon & Doswell 1979; Burgess et al. 1982). On radar:

- The **hook wraps up**. The appendage curls further cyclonically into a spiral or near-closed ring 3–8 km across, often with a weak-echo centre.
- The **couplet and debris ball drift rearward and left** relative to storm motion (toward W/NW), deeper into the precipitation. The tornado tends to curve left in its final minutes.
- The **RFD gust front bulges** out E/SE as a fine line or outflow edge.
- A **new inflow notch and meso** form ~5–15 km to the **E/SE**, at the new gust-front occlusion point, under the persistent mid-level updraft. A new hook begins to form there.

## 6. Cyclic behaviour

Burgess et al. (1982) found mesocyclone cycles averaging ~40–45 min, ranging 15–90+ min. Dowell & Bluestein (2002) documented tornado-cycle intervals of ~40 min in the 1995 McLean, TX storm.

Adlerman & Droegemeier (2002, 2005) simulated three modes:
- steady, non-cycling
- oscillating, non-occluding
- occluding cyclic mesocyclogenesis

The occluding cyclic mode had periods of ~15–60 min, depending on shear and hodograph shape.

**Between cycles**, radar shows a broader, weaker (often detached) old hook remnant N–NW of the new one, and a broad couplet with weaker ΔV and no TDS. The inflow notch reopens and the BWER re-forms. Examples: image 13 (Greensburg → Trousdale → Macksville) and image 14 (Pampa).

## 7. Decay

The storm becomes **outflow-dominant**: the cold pool and the RFD/FFD gust fronts move out ahead of the updraft and cut off the inflow. Radar signs:

- the inflow notch fills
- the Z gradient on the inflow side relaxes
- the hook disappears or becomes a loose, ragged appendage
- the BWER collapses
- core Z drops
- the echo becomes amorphous or multicellular

In moist, strongly forced settings it instead turns **HP**, then a **bow** or comma echo. It may merge into a QLCS, with the meso surviving as a bookend or comma-head vortex.

## Classic vs HP vs LP on radar (C1–C3; Moller et al. 1994; Doswell & Burgess 1993)

- **Classic** (C1; images 01, 02, 04, 07). Distinct hook on the right-rear flank, a clear inflow notch, a high-Z core NE of the updraft, a V-notch and a long FFD.
- **HP** (C2; images 03, 15).
  - Shape: a large **kidney-bean** echo, with heavy rain and hail wrapped around the meso. The hook is broad, fat, or a **rain-wrapped** band.
  - Inflow notch: often on the **front (E/SE) flank**.
  - Velocity: the couplet sits inside high Z, so the tornado is rain-wrapped.
  - Evolution: often turns into a bow or comma.
- **LP** (C3).
  - Size and intensity: small, with weak low-level Z (often <40–50 dBZ). Precipitation, mostly hail and sparse large drops, sits downshear, NE of the updraft.
  - Shape: little or no hook or notch, so it can look like an ordinary small cell or a "tail" echo.
  - Velocity: mid-level rotation is visible, but the low-level echo is minimal.
  - Large hail is likely; tornadoes are less common.

## Geometry cheat-sheet (storm moving toward the NE)

- **Forward flank:** NE of the updraft, oriented along the storm-relative upper-level flow, usually just left of the motion vector.
- **Hook:** on the SW–S flank (right-rear). It wraps counter-clockwise from the W side of the core, around the S side, so its tip points E/SE, toward the inflow.
- **Inflow notch and BWER:** at the S–SE edge, immediately east of the hook. The tightest Z gradient runs along the S–SE edge.
- **Debris ball and couplet:** at the hook tip. Inbound and outbound positions depend on where the radar is; for cyclonic rotation, the radar-left side of the couplet is the inbound side.
- **Whole echo:** ~20–40 km × 30–60 km at low level. FFD precipitation reaches 30–60 km downstream, and the anvil echo aloft 50–100+ km.

## Sources

- **Browning, K. A., 1964.** *J. Atmos. Sci.*, 21, 634–639. Right-moving storms; WER.
- **Chisholm, A. J., and J. H. Renick, 1972.** Alberta Hail Studies, BWER.
- **Lemon, L. R., 1977.** NOAA Tech. Memo NWS NSSFC-1. Severe storm radar identification.
- **Brown, R. A., L. R. Lemon, and D. W. Burgess, 1978.** *Mon. Wea. Rev.*, 106, 29–38. TVS.
- **Klemp, J. B., and R. B. Wilhelmson, 1978**; **Weisman, M. L., and J. B. Klemp, 1982.** Splitting.
- **Lemon, L. R., and C. A. Doswell III, 1979.** *Mon. Wea. Rev.*, 107, 1184–1197. Supercell structure, RFD and occlusion.
- **Burgess, D. W., V. T. Wood, and R. A. Brown, 1982.** 12th Conf. Severe Local Storms. Mesocyclone evolution statistics; cyclic mesos.
- **Doswell, C. A. III, and D. W. Burgess, 1993.** *AGU Geophys. Monogr.* 79. Tornadoes and tornadic storms: a review of conceptual models.
- **Moller, A. R., C. A. Doswell, M. P. Foster, and G. R. Woodall, 1994.** *Wea. Forecasting*, 9, 327–347. Supercell spectrum (classic/HP/LP).
- **Lemon, L. R., 1998.** *Wea. Forecasting*, 13, 327–340. TBSS; V-notch.
- **Bunkers, M. J., et al., 2000.** *Wea. Forecasting*, 15, 61–79. Supercell motion.
- **Wurman, J., and S. Gill, 2000.** *Mon. Wea. Rev.*, 128, 2135–2164. Dimmitt DOW; weak-echo hole.
- **Markowski, P. M., 2002.** *Mon. Wea. Rev.*, 130, 852–876. Hook echoes and rear-flank downdrafts: a review.
- **Dowell, D. C., and H. B. Bluestein, 2002a,b.** *Mon. Wea. Rev.*, 130. The 8 June 1995 McLean, TX storm; cyclic tornadogenesis.
- **Adlerman, E. J., K. K. Droegemeier, and R. Davies-Jones, 1999.** *J. Atmos. Sci.*, 56.
- **Adlerman, E. J., and K. K. Droegemeier, 2002 and 2005.** *Mon. Wea. Rev.*, 130 and 133. Cyclic mesocyclogenesis modes.
- **Ryzhkov, A. V., et al., 2005.** *J. Appl. Meteor.*, 44. Polarimetric tornado debris signature.
- **Dowell, D. C., et al., 2005.** *Mon. Wea. Rev.*, 133. Centrifuging and the weak-echo hole.
- **Rasmussen, E. N., et al., 2006**; **Kennedy, A., et al., 2007.** Descending reflectivity cores.
- **Smith, B. T., et al., 2015**; **Thompson, R. L., et al., 2017.** *Wea. Forecasting*. Vrot vs tornado intensity.
- **NWS Warning Decision Training Division (WDTD),** Radar & Applications Course: supercell, meso/TVS, TDS and TBSS modules.
- **COMET MetEd** modules on supercell structure and dual-pol.
- **NWS Norman spotter glossary** (figures C1–C4).
- **SPC / Doswell essays** on supercell types and cyclic tornadogenesis.
