# Research: rotation and motion as an observer sees it (2026-10-30)

Adds to `RESEARCH-WALLCLOUD-HV.md` (wall-cloud cause, LCL and pressure lowering, scud, horizontal vortices, debris cloud) and `docs/tornado-physics/README.md` (wind profiles, swirl regimes, sub-vortex model, funnel-from-pressure rule). Values already listed there are not repeated; this file is about **motion**: speeds, rates, periods, and how they look on screen.

[S] = from a source (link). [E] = textbook knowledge or an engineering estimate, meant as a tunable default. Several key papers (Atkins et al. 2012, Bluestein et al. 2018 El Reno, Wakimoto et al. 2025 Selden) could only be read as abstracts, so some of their numbers are paraphrased from the abstract.

---

## 0. Formulas used throughout

| Quantity | Formula | Notes |
|---|---|---|
| Angular rate | Ω = V / r | rad/s |
| Rotation period | T = 2πr / V | seconds per revolution |
| Solid-body core (r < r_c) | V = V_c·r/r_c, so **Ω = V_c/r_c, the same at every r inside the core** | Rankine, Burgers–Rott or Vatistas: all roughly solid-body inside the core |
| Outside the core | V = V_c·(r_c/r)^α, α = 0.5–1, so Ω ∝ r^(−1−α) | Inner parts turn much faster than outer ones: **differential rotation** |
| Inflow spin-up (angular momentum kept) | V(r) = V₀·r₀/r | A fragment drawn in from 2 km to 1 km doubles its swirl and quadruples its Ω |
| Helix pitch (rising and turning) | tan β = w / V_t | β = climb angle of a streak or fragment path above the horizontal |
| Inflow angle near the ground | tan γ = u_r / V_t | γ = how far the wind points inward from the tangent |
| Apparent angular speed for an observer | ω_app = u_⊥ / D (rad/s) = 57.3·u_⊥/D (°/s) | u_⊥ = speed across the line of sight, D = distance |
| Share of screen per second | ω_app / FOV | Use it to check that a motion actually reads |
| Funnel edge, outside the core (Rankine) | r_f = r_c·V_c / √(2 g h) | h = height below cloud base. Gives the flare into the base (r_f grows as h → 0). |
| Funnel edge, inside the core (Rankine) | r_f = r_c·√(2·(1 − g h / V_c²)) | A funnel reaches the ground only if V_c² > g·h_base. For our own profile use `Vortex.funnelRadius` (deficit 2.06 ρV_c²). |

Pressure-to-height conversion: Δz ≈ Δp/(ρg). The funnel condition above treats air lowered by Δp as lifted by Δz to its LCL [E, the classic cyclostrophic + hydrostatic estimate].

---

## 1. Wall cloud motion

### 1.1 Numbers

| Quantity | Typical | Range | Tag |
|---|---|---|---|
| Width | 1–4 km | from a fraction of a mile to over 5 mi (8 km) | [S] [Wikipedia: Wall cloud](https://en.wikipedia.org/wiki/Wall_cloud) |
| Lead time before a tornado | 10–20 min | 1 min to more than 1 h | [S] same |
| Rotating wall clouds before strong tornadoes | minutes to nearly an hour ahead | not all wall clouds rotate | [S] [NWS spotter glossary](https://www.weather.gov/spotterguide/glossary_w) |
| Persistence that matters to spotters | ≥ 10 min, especially if obviously rotating | — | [S] [NWS field guide](https://www.weather.gov/media/unr/SpottersGuide2011_fielduse.pdf) |
| Tangential speed at the wall-cloud edge | 10–25 m/s | 5–40 m/s | [E] (low-level mesocyclone; the radar "concern" threshold is Vrot ≥ 25 kt ≈ 13 m/s [S] [WDTB](https://www.wdtb.noaa.gov/courses/rac/documentation/rac24-warn-method.pdf)) |
| Radius of that rotation | 0.5–1.5 km | 0.3–3 km | [E] |
| Rising motion in the wall cloud | 5–15 m/s | up to ~20 m/s just before a tornado | [E] |
| Scud rising into the base | 2–10 m/s | 1–15 m/s | [E] |
| Depth below the main base | 200–500 m | 100–1000 m | [E] (existing doc) |
| Before a tornado | the wall cloud looks much the same but **contracts considerably** | — | [S] [Atkins et al., VORTEX2](https://ams.confex.com/ams/36Radar/webprogram/Paper228339.html); tornadic QLCS mesovortices also contract before tornadogenesis [S] [PERiLS](https://par.nsf.gov/biblio/10638789) |
| Pressure deficit in a strongly rotating wall cloud | > 10 hPa (≈ 85 m extra lowering) | — | [S] [Atkins et al.](https://ams.confex.com/ams/36Radar/webprogram/Paper228339.html) |
| Radar tornadogenesis vs the first continuous ground funnel (LaGrange 2009) | radar vortex came first, by about 14 min | — | [S] (abstract) [Atkins et al. 2012 MWR](https://farm.atmos.illinois.edu/contents/pubs_pdf/2012-Atkins_etal-The_LaGrange_tornado_during_VORTEX2-Part2-Photogrammetric_analysis_with_dual-Doppler_radar_data.pdf) |

### 1.2 Rotation period an observer sees

T = 2πR/V:

| State | R | V | T (one turn) | Ω |
|---|---|---|---|---|
| Broad, weakly rotating | 1.5 km | 10 m/s | 940 s (≈ 16 min) | 0.4°/s |
| Typical rotating wall cloud | 1.0 km | 15 m/s | 420 s (≈ 7 min) | 0.9°/s |
| Strong | 0.75 km | 20 m/s | 235 s (≈ 4 min) | 1.5°/s |
| Contracted, pre-tornadic ("rapid rotation") | 0.4 km | 25 m/s | 100 s | 3.6°/s |
| Tight inner lowering / rotating collar | 0.2 km | 30 m/s | 42 s | 8.6°/s |

[E] from the formula with the values above.

**What this means [E]:** a typical wall cloud takes several minutes per turn. From 3–5 km away, a scud fragment at 15 m/s moves only 0.2–0.3°/s across the sky, so rotation is hard to see in real time; chasers rely on time-lapse. "Obvious, rapid rotation" in spotter language means periods of about 1–2 minutes, which only the contracted, pre-tornadic state reaches.

### 1.3 How the rotation shows

[E] (spotter training and M&R 2010 ch. 9, with the sources above):

- **Scud orbit and rise:** fragments under and beside the wall cloud move cyclonically and rise into the base along a helix (β = atan(w/V) ≈ 10–30°). They condense on the inflow side, rise, and merge into the base. On the RFD side they evaporate or are ripped downward and outward.
- **Differential rotation:** inner fragments lap outer ones. Outside the solid-body core Ω falls off like 1/r², so rotation reads as **shear between layers**, not as a rigid disc.
- **Striations and laminar bands:** smooth horizontal grooves on the wall cloud and the updraft base above it, curving cyclonically. They are streamlines made visible and **do not move along themselves fast**: the band shape is a pattern, and the air slides along it.
- **Tiers:** a stepped lowering (main base, then the wall cloud, then an inner lowering or collar). Each tier is smaller and turns faster (Ω rises as r falls).
- **Before tornadogenesis** [S: NWS glossary and [FWD checklist](https://www.weather.gov/media/fwd/skywarn/SpotterChecklist2026.pdf); Wikipedia]: increasing spin, rapid upward motion near the wall cloud, lowering and "tightening", a clear slot forming, and a rain burst behind the wall cloud.
- **The clear slot** [E]: the RFD drives a band of clearing and dissolving cloud that wraps cyclonically around the south and west side of the wall cloud. The edge advances at roughly the RFD outflow speed (10–25 m/s at the ground). Cloud on its leading edge is ragged and shredding and moves **down and out**, opposite to the rising inflow scud.

### 1.4 Position and motion of the whole wall cloud [E]

- **Position:** under the rain-free base, near the updraft and RFD interface. In the Northern Hemisphere that is usually the S or SW end of the storm (rear flank), at the tip of the hook echo. It sits on the rain-curtain side of the base [S, Wikipedia], with the FFD core to its north and northeast.
- **Motion:** before occlusion the wall cloud moves with the storm (supercell motion, typically 10–20 m/s, often right of the mean wind).
- **During occlusion** the low-level circulation falls behind the updraft: it moves rearward and to the left relative to the storm, and its track hooks left. A new wall cloud then often forms a few km to the E or SE at the new gust-front triple point. Cycles last 20–60 min.
- **The old wall cloud** often vanishes before its tornado does [S, Wikipedia].

---

## 2. Tail cloud and inflow bands

| Quantity | Value | Tag |
|---|---|---|
| Tail cloud | a horizontal, tail-shaped low cloud **attached to the wall cloud**, pointing toward the precipitation region, with a base level with the wall cloud | [S] [NWS FWD spotter dictionary](https://www.weather.gov/media/fwd/skywarn/StormSpottersDictionary.pdf), [Wikipedia](https://en.wikipedia.org/wiki/Wall_cloud) |
| Motion along it | **mostly horizontal, toward the wall cloud**; rising motion often visible at the junction | [S] same |
| Beaver tail | an inflow band attached to the **main updraft base** (not the wall cloud), with its base at the updraft-base level; **does not rotate** | [S] same |
| Flow speed along the tail cloud | 10–20 m/s storm-relative (the FFD outflow and inflow) | [E] |
| Acceleration near the junction | swirl grows as 1/r (angular momentum); speeds of 15–25 m/s at the junction | [E] |
| Ascent | ≈ 0 along most of the tail, rising to 3–10 m/s within ~0.5 km of the wall cloud | [E] |
| Length | tail cloud 1–5 km (existing doc); beaver tail 5–20 km | [E] |
| Shape | the tail cloud curves cyclonically into the wall cloud on its N or NE side; the beaver tail is straight to gently curved along the FFD gust front, running E to W into the updraft | [E] |

**Fragment path [E]:** a fragment on the tail cloud drifts toward the wall cloud at 10–15 m/s. Within about 1 km it turns to orbit cyclonically, speeds up as r falls, rises (its pitch steepening from ≈ 0° to 20–40°), stretches into a streak, and merges into the wall-cloud base. **Total trip: roughly 1.5–4 min.**

---

## 3. The tornado as seen

### 3.1 Speeds and profiles

Wind profiles and swirl regimes are in `docs/tornado-physics/README.md` §1. New observed numbers:

| Quantity | Value | Tag |
|---|---|---|
| Median radar core diameter (DOW) | ≈ 300 m, some ≈ 100 m | [S] [DOW climatology abstract](https://ams.confex.com/ams/pdfpapers/141821.pdf) |
| Mulhall 1999 (violent, multiple vortices) | V_max ≈ 84 m/s, radius of maximum wind (RMW) 500–1000 m, swirl ratio 2–6 | [S] [Lee & Wurman (UCAR dataset)](https://data.ucar.edu/dataset/083411f9-b3f5-40be-9230-895ce0cf74c6) |
| Dallas 1957, from tracking debris and cloud tags | tangential ≈ 76 m/s, **upward ≈ 67 m/s** | [S] (secondhand; Hoecker 1960, MWR 88) [WB Research Paper 41](https://library.oarcloud.noaa.gov/noaa_documents.lib/NOAA_historic_documents/WB/Research_papers/WB_Research_Paper_41.pdf) |
| Tsukuba 2012, image velocimetry on video | near-ground tangential ≈ 56 m/s against an estimated maximum of ≈ 72 m/s, so **visible features move at ≈ 0.75–0.8 of V_max** | [S] [ESSL 2013](https://www.essl.org/ECSS/2013/programme/presentations/227.pdf) |
| Near-surface inward turning | 40–50° (in situ probe) | [S] [Kosiba, ECSS 2013](https://www.essl.org/ECSS/2013/programme/presentations/3.pdf) |
| Near-surface flow | inward- and upward-spiralling, with an axial downdraft aloft | [S] [Wurman, Kosiba & Robinson 2013](https://bibliotheque.meteo.fr/pub/DOC00024182-situ-doppler-radar-and-video-observations-the-inte.html) |

### 3.2 Funnel vs core, and how fast visible features move

- **At or above cloud base** the RMW lies at the funnel edge. **Near the ground** the funnel tapers but the RMW does not, so the RMW lies well outside the funnel [S] ([Bluestein et al. 2003](https://tropical.colostate.edu:443/Publications/papers/Bluestein_etal_MWR2003.pdf); [conference paper](https://ams.confex.com/ams/pdfpapers/63563.pdf)).
- **Funnel narrowing vs the vortex** [S, Bluestein et al. 2003]: in the "shrinking stage" the funnel narrowed a lot while the vortex stayed wide and intense. **The funnel width is not the vortex strength.**
- **Rule [E]:** a funnel inside the core sits in solid-body flow, so its surface turns at **Ω_core = V_c/r_c**, and its surface speed is V_c·r_f/r_c < V_c. A funnel half the core radius shows half the peak wind at its edge but the full angular rate.
- **Pattern vs fluid [E]:**
  - **Fluid tags:** cloud tags and striations on the funnel are condensed air, so they move with the fluid (tangential plus upward, a helix with β ≈ 30–60° in a one-cell funnel, since w is comparable to V_t).
  - **Patterns:** the funnel's outline (kinks, bulges, the sinuous shape of a rope) is a pattern that drifts slowly, a few m/s plus the tornado's translation.
  - **Debris:** heavy debris moves slower than the wind and is flung outward (`RESEARCH-WALLCLOUD-HV.md` §debris).
- **Sub-vortices:**

  | Quantity | Value | Tag |
  |---|---|---|
  | Count and life | 2–5 at once, each usually lasting < 1 min | [S] [SPC FAQ](https://www.spc.noaa.gov/faq/tornado/) |
  | El Reno 2013 | ≥ 24 resolvable over a 132 s multiple-vortex phase; most form **inside** the RMW; those living > 15 s drift **toward the centre**; some moved at **> 75 m/s** | [S] [Bluestein et al. abstract](https://ams.confex.com/ams/28SLS/webprogram/Paper301025.html) |
  | Lab and theory | they move against the azimuthal flow at about half its speed, so in the vortex frame they **orbit at ≈ 0.5 of the local flow speed** | [S] [Bluestein et al. 2018, MWR](https://repository.library.noaa.gov/view/noaa/32227) |
  | Real cases | El Reno: they went "slowly against" the flow, or roughly with it when the RFD made the flow asymmetric; Mulhall: radar measured the upstream flow at 0.5–0.9 of peak | [S] same; [Wurman](https://ams.confex.com/ams/pdfpapers/21580.pdf) |
  | Game default | orbit at **Ω_sv ≈ (0.5–0.8)·V_c/r_c** plus the translation (our code: 0.7) | [E] |

### 3.3 Inflow, corner flow and the debris skirt (motion only)

| Quantity | Value | Tag |
|---|---|---|
| Inflow layer | 10–100 m deep | [E] (README §1.2) |
| Inflow angle | 40–50° within ~10 m of the ground, falling to < 10–15° above ~100 m | [S] / [E] |
| Debris streaks | spiral **in and up** at 20–45°, then turn sharply up near r_c | [E] |
| Skirt rotation | at ≈ Ω_core, with outer parts lagging (Ω ∝ r^(−1−α)) | [E] |

### 3.4 Funnel to cloud-base connection [E]

- **Flare:** the funnel widens upward and blends into the base. The flare comes from the cyclostrophic deficit dropping off outside the core (§0: r_f ∝ 1/√h near the base).
- **Collar:** many tornadoes sit under a lowered, rotating cloud base 1–3 tornado diameters wide (sometimes a smooth "collar" ring). It turns at the outer-core rate: a slower angular rate than the funnel, but visibly rotating, with periods of 20–60 s for a strong tornado.
- **Wall cloud during the tornado:** it shrinks and is often absorbed. A new one may form nearby [S, SPC FAQ: "a wall cloud can shrink after producing a tornado while another forms nearby"].

### 3.5 Translation, tracks and rope-out

| Quantity | Value | Tag |
|---|---|---|
| Typical translation | 10–20 m/s (≈ 20–45 mph) | [E] |
| Range | 0 to ~30 m/s; Tri-State 1925 moved at 27–33 m/s (60–73 mph) | [S] [SPC FAQ](https://www.spc.noaa.gov/faq/tornado/) |
| LaGrange 2009 | ≈ 9 m/s ESE | [S] [AMS abstract](https://ams.confex.com/ams/pdfpapers/176072.pdf) |
| Relation to the mesocyclone | **mature:** moves with the storm, near the mesocyclone centre; **occluding:** turns left of storm motion and slows as the low-level circulation drifts rearward; **failed occlusion:** the tornado can loop; tracks follow a cycloidal loop toward the rear of the storm after the RFD gust front occludes the mesocyclone | [S] [AMS 29SLS](https://ams.confex.com/ams/29SLS/webprogram/Paper348376.html), [AccuWeather on looping](https://www.accuweather.com/en/severe-weather/a-tornado-hit-the-same-house-twice-and-its-not-unprecedented/1918581) |
| Orbit of the tornado about the mesocyclone centre | radius 0.5–2 km, period 3–10 min, giving the small wobbles and left hooks in damage tracks | [E] |
| Rope stage | the RFD outflow bulge bends the circulation; the upper part is tilted downstream by mid-level winds and stretched into a narrow, snake-like vortex; the RFD wraps fully around it, cuts off inflow, and kills the circulation | [S] [NWS tornado life cycle](https://www.weather.gov/spotterguide/tor_life), [UCI lecture](https://www.ess.uci.edu/~yu/class/ess124/Lecture.19.tornado.pdf) |
| Rope kinematics | the bottom is pushed out by the RFD at 5–15 m/s relative to the top; tilt reaches 30–70° from vertical with horizontal segments; length 1–4 km; width 10–50 m; it stays visibly spinning (contraction keeps or raises Ω); lasts 1–5 min; it dies by fading from the bottom up or by breaking into segments | [E] |

---

## 4. Observer timescales (cheat sheet)

Apparent angular speed ω = 57.3·u/D (°/s). At a 70° FOV, 1°/s ≈ 1.4% of the screen width per second.

| Feature | u | At 1 km | At 3 km | At 8 km | Reads in real time? |
|---|---|---|---|---|---|
| Wall-cloud scud orbit | 15 m/s | 0.86°/s | 0.29°/s | 0.11°/s | barely beyond ~2 km [E] |
| Pre-tornadic rapid rotation | 25 m/s | 1.4°/s | 0.48°/s | 0.18°/s | yes within ~3 km [E] |
| Scud rising | 5 m/s | 0.29°/s | 0.10°/s | 0.04°/s | only up close, or against the base [E] |
| Tornado funnel surface (r_f 60 m, Ω 1 rad/s) | 60 m/s | 3.4°/s | 1.1°/s | 0.43°/s | yes, mainly as **texture shear** across a narrow funnel [E] |
| Tornado translation | 15 m/s | 0.86°/s | 0.29°/s | 0.11°/s | only within ~2 km [E] |

**Revolutions:**

| Funnel | r_c | V_c | T |
|---|---|---|---|
| Rope | 30 m | 40 m/s | 4.7 s |
| Typical | 100 m | 60 m/s | 10 s |
| Wedge | 400 m | 80 m/s | 31 s |
| Collar | 300 m | 30 m/s | 63 s |

---

## 5. What makes rotation read on camera

Practice from VFX and chaser video; all [E].

1. **Shear beats spin.** A rigid rotating texture looks like a turntable. Rotation reads when layers move at different angular rates: inner and lower parts fast, outer and upper parts slow, with near scud passing in front of a slower wall.
2. **Discrete trackable features.** The eye tracks fragments, tags and edges, not uniform noise. A few high-contrast scud pieces and striation lines do more than any amount of soft noise.
3. **Helix, not circle.** Turning combined with rising (or sinking on the RFD side) separates real flow from a spinning prop.
4. **Parallax.** Foreground fragments crossing in front of the wall cloud give depth and the sense of direction (fragments in front move one way, those behind the other way).
5. **Lifecycle on the features.** Fragments that are born, stretch, merge and evaporate read as flow. Fixed cards orbiting forever read as a carousel.
6. **Time.** At true speed a distant wall cloud barely moves (§4). Real footage people remember is often time-lapse, 5–30×. A modest exaggeration with distance (more at range, little up close) keeps rotation readable without breaking near-field realism.
7. **Aliasing.** With n repeating features around a funnel, keep Ω·dt < π/n per frame or it will strobe backwards (the wagon-wheel effect). Tornado Ω of 0.2–2 rad/s at 60 fps is safe up to n ≈ 90, but **frame-rate dips** in Roblox can trigger it, so drive motion from time, not from frame count.

---

## 6. What to render

Rules for the billboard renderer. Inputs are engine fields: V_meso(r), r_meso, the wall-cloud base, the cloud base, inflow speed U_in, V_c, r_c, translation, swirl S, and the life stage.

### Wall cloud

1. **Orbit:** wall-cloud cards and scud orbit the mesocyclone centre at Ω(r) = V_meso(r)/r (solid-body inside r_meso, ∝ r^(−1.6) outside). Typical periods are 4–7 min, falling to 1–2 min when contracted. Never use one rigid spin for the whole cloud.
2. **Scud:** fragments under the wall cloud orbit at ≈ V_meso(r) and rise at 2–10 m/s along a helix (β = atan(w/V) ≈ 10–30°). They spawn on the inflow (E/NE/S) side 100–600 m below the base, stretch along the flow, and fade into the base within 30–120 s.
3. **Pre-tornado cue:** as the engine's low-level rotation strengthens, shrink the wall-cloud radius (toward 0.3–0.5 of its earlier size), raise the scud ascent to 10–20 m/s, lower the base by Δz = Δp/(ρg), and scale Ω up so the period falls to ~1–2 min.
4. **RFD side:** fragments sink and move outward at 5–15 m/s, shred and evaporate. The clear-slot edge wraps cyclonically around the S and W side at the RFD gust-front speed.
5. **Striations:** laminar bands on the base and the wall cloud are streamline-shaped and drift slowly. Their UV scroll is ≈ 0.2–0.4 of the local fluid speed. Curve them cyclonically into the wall cloud.
6. **Tiers:** each lower, smaller tier (main base, wall cloud, collar) turns faster: Ω ∝ 1/r inside the circulation.
7. **Occlusion:** move the wall cloud and tornado rearward and left of storm motion. A new wall cloud forms 2–5 km E or SE, and the old one fades before its tornado does.

### Tail cloud and inflow

8. **Tail cloud:** fragments travel toward the wall cloud at 10–20 m/s, nearly level. Within ~1 km they spin up (V ∝ 1/r), curve cyclonically, steepen to 20–40° and rise at 3–10 m/s at the junction. A trip takes about 1.5–4 min.
9. **Beaver tail:** level, non-rotating, slowly evolving bands along the FFD gust front feeding the main updraft base. Use U_in for the drift and no orbit.

### Tornado

10. **Funnel surface:** turns at Ω_core = V_c/r_c however thin the funnel is (inside the core it is solid-body). Its surface texture moves on a helix at V_c·r_f/r_c tangentially, plus an upward scroll of 0.5–1× that (one-cell), so streaks climb at 30–60°.
11. **Two-cell or high swirl:** cut the upward scroll near the axis; the funnel looks smoother and wider, and the motion moves to sub-vortices and the skirt.
12. **Outline:** kinks and ripples move as a **pattern**: slow drift (a few m/s) and translation, not the fluid speed.
13. **Funnel shape:** taper and flare follow the pressure rule (§0 / `Vortex.funnelRadius`). Near the ground the funnel is narrower than r_c, and the debris skirt (radius ~1.5–3 r_c) marks the true wind.
14. **Collar:** a lowered, rotating base 1–3 tornado diameters wide, turning at 20–60 s per revolution. The funnel flares into it.
15. **Sub-vortices** (S > ~1): 2–5 at once, each living 10–60 s. They form just inside r_c and orbit at (0.5–0.8)·V_c/r_c plus the translation; long-lived ones spiral inward. Each is a thin, fast-spinning tube that stays visible for most of its life.
16. **Debris and dust:** spiral in and up at 20–45° within 10–100 m of the ground (inflow 40–50° from the tangent near the surface). They turn up sharply near r_c and orbit at ≈ Ω_core, with outer parts lagging. Heavy chunks are flung out along tangents.
17. **Translation:** move with the parent mesocyclone at storm speed (10–20 m/s), plus a small orbit about the mesocyclone centre (radius 0.5–2 km, period 3–10 min). During occlusion the track turns left; failed occlusion can loop.
18. **Rope-out:** the bottom is pushed out by the RFD at 5–15 m/s relative to the top, tilting the vortex 30–70° into a 1–4 km sinuous tube 10–50 m wide. It keeps spinning (Ω rises as it thins), lasts 1–5 min, and fades from the bottom up or breaks into segments.

### Camera and timing

19. **Drive all motion from simulation time** (never frame count), so frame-rate dips cannot cause strobing.
20. **Distance-scaled speed-up:** optionally speed up apparent rotation for distant storms (×1 within 2 km, rising to ×3–5 at 10 km+) so wall-cloud rotation reads at range. This is a presentation choice, not physics; keep it off in any mode that measures speeds.

---

## Sources

- NWS spotter glossary (wall cloud): https://www.weather.gov/spotterguide/glossary_w
- NWS FWD spotter checklist: https://www.weather.gov/media/fwd/skywarn/SpotterChecklist2026.pdf
- NWS FWD storm spotter's dictionary: https://www.weather.gov/media/fwd/skywarn/StormSpottersDictionary.pdf
- NWS spotter field guide 2011: https://www.weather.gov/media/unr/SpottersGuide2011_fielduse.pdf
- NWS tornado life cycle: https://www.weather.gov/spotterguide/tor_life
- SPC tornado FAQ: https://www.spc.noaa.gov/faq/tornado/
- Wikipedia, Wall cloud: https://en.wikipedia.org/wiki/Wall_cloud
- Atkins et al., wall-cloud formation in VORTEX2: https://ams.confex.com/ams/36Radar/webprogram/Paper228339.html
- Atkins et al. 2012 MWR, LaGrange Part II: https://farm.atmos.illinois.edu/contents/pubs_pdf/2012-Atkins_etal-The_LaGrange_tornado_during_VORTEX2-Part2-Photogrammetric_analysis_with_dual-Doppler_radar_data.pdf
- LaGrange abstract: https://ams.confex.com/ams/pdfpapers/176072.pdf
- PERiLS mesovortex contraction: https://par.nsf.gov/biblio/10638789
- WDTB warning-method notes (Vrot): https://www.wdtb.noaa.gov/courses/rac/documentation/rac24-warn-method.pdf
- DOW tornado climatology: https://ams.confex.com/ams/pdfpapers/141821.pdf
- Lee & Wurman, Mulhall structure: https://data.ucar.edu/dataset/083411f9-b3f5-40be-9230-895ce0cf74c6
- Wurman, Mulhall sub-vortices: https://ams.confex.com/ams/pdfpapers/21580.pdf
- Bluestein et al. 2018, El Reno multiple-vortex structure: https://repository.library.noaa.gov/view/noaa/32227
- El Reno sub-vortex abstract: https://ams.confex.com/ams/28SLS/webprogram/Paper301025.html
- Bluestein et al. 2003 MWR (funnel vs vortex): https://tropical.colostate.edu:443/Publications/papers/Bluestein_etal_MWR2003.pdf
- RMW vs funnel conference paper: https://ams.confex.com/ams/pdfpapers/63563.pdf
- Hoecker 1960, WB Research Paper 41: https://library.oarcloud.noaa.gov/noaa_documents.lib/NOAA_historic_documents/WB/Research_papers/WB_Research_Paper_41.pdf
- Tsukuba image velocimetry (ECSS 2013): https://www.essl.org/ECSS/2013/programme/presentations/227.pdf
- Kosiba, ECSS 2013 in-situ/DOW: https://www.essl.org/ECSS/2013/programme/presentations/3.pdf
- Wurman, Kosiba & Robinson 2013: https://bibliotheque.meteo.fr/pub/DOC00024182-situ-doppler-radar-and-video-observations-the-inte.html
- Wakimoto et al. 2025 MWR, Selden debris kinematics: https://par.nsf.gov/biblio/10609467
- Cycloidal tracks after occlusion: https://ams.confex.com/ams/29SLS/webprogram/Paper348376.html
- Looping tornado / failed occlusion: https://www.accuweather.com/en/severe-weather/a-tornado-hit-the-same-house-twice-and-its-not-unprecedented/1918581
- UCI tornado lecture (rope stage): https://www.ess.uci.edu/~yu/class/ess124/Lecture.19.tornado.pdf
- Background (not fetched, [E] items): Markowski & Richardson 2010, *Mesoscale Meteorology in Midlatitudes*, ch. 8–9.
