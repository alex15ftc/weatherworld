# Supercell structure: positions, sizes, heights, motion

Research reference for the WeatherWorld storm engine and the Roblox storm lab, written 2026-10-30.
The aim is to place every supercell feature correctly, with the physics behind its position and size,
so the engine can derive the features from fields rather than painting them.

**How the evidence is marked**

- **[S]** = a number taken from a source fetched while writing this document (URL given).
- **[T]** = standard textbook or literature value that I know well but did not re-fetch here
  (mostly Markowski & Richardson 2010, *Mesoscale Meteorology in Midlatitudes*, "MR10"). These values are
  widely quoted, but treat them as a second tier.
- **[E]** = my own estimate or derivation from the physics below. Use these as tuning starting points, not facts.

Main sources fetched (full text where possible):

| Short name | Source |
|---|---|
| Bunkers00 | Bunkers et al. 2000, *Wea. Forecasting* 15, 61–79 — https://www.weather.gov/media/unr/soo/scm/BKZTW00.pdf |
| MSR02 | Markowski, Straka & Rasmussen 2002, "Direct surface thermodynamic observations within the RFDs of nontornadic and tornadic supercells", *MWR* 130, 1692–1721 — https://training.weather.gov/wdtd/courses/rac/severe/parameters/markowski2002.pdf |
| M02 | Markowski 2002, "Hook echoes and rear-flank downdrafts: a review", *MWR* 130, 852–876 (abstract: https://pure.psu.edu/en/publications/hook-echoes-and-rear-flank-downdrafts-a-review/; full text was paywalled) |
| RAC | NWS WDTD convective storms glossary (FY17), quoting AMS/NWS glossaries — https://training.weather.gov/wdtd/courses/rac/documentation/rac19-conv-storms-glossary.pdf |
| LMK | NWS Louisville "Supercell Thunderstorm Structure and Evolution" — https://www.weather.gov/media/lmk/soo/Supercell_Structure.pdf |
| NWS-SG | NWS spotter guide, supercell page — https://www.weather.gov/spotterguide/supercell2 |
| KR07 | Kumjian & Ryzhkov 2007 conference paper (precursor of KR08 *JAMC* 47, 1940–1961) — https://ams.confex.com/ams/pdfpapers/122882.pdf |
| Dawson14 | Dawson et al. 2014, "Low-level ZDR signatures in supercell forward flanks", *JAS* 71 — https://twister.caps.ou.edu/papers/DawsonEtal_JAS2014.pdf |
| ADD99 | Adlerman, Droegemeier & Davies-Jones 1999, cyclic mesocyclogenesis (abstract) — https://experts.illinois.edu/en/publications/a-numerical-simulation-of-cyclic-mesocyclogenesis/ |
| NSSL-hail | NSSL Severe Weather 101: hail — https://www.nssl.noaa.gov/education/svrwx101/hail/ |
| GPM-hail | NASA GPM hail FAQ — https://gpm.nasa.gov/resources/faq/how-big-can-hail-get |
| Halbert26 | OU METR4403 tornadogenesis lecture 2026 — https://twister.caps.ou.edu/METR4403/lectures_2026/Tornado2026.pdf |

---

## 1. Coordinate frame and storm motion

### 1.1 Bunkers "internal dynamics" (ID) right-mover formula [S: Bunkers00]

```
V_RM = V_mean + D * (V_shear x k) / |V_shear|
V_LM = V_mean - D * (V_shear x k) / |V_shear|
```

- `V_mean` = **non-pressure-weighted 0–6 km AGL mean wind**.
- `V_shear` = mean wind of the **5.5–6 km** layer minus mean wind of the **0–0.5 km** layer.
- `D` = **7.5 m/s**. The deviation is perpendicular to the shear vector. The right-mover goes to the right of the
  shear and the left-mover to the left. Bunkers00 conclusions:
  "locate the right-moving supercell 7.5 m s⁻¹ from the mean wind along the orthogonal line to the right of the vertical wind shear".
- Observed deviation from the 0–6 km mean wind: **3.0–18.5 m/s, interquartile range 6.6–10.3 m/s** (Bunkers00, Fig. 3).
  Deviation barely depends on shear magnitude (r = 0.16).
- Mean absolute error ≈ **4 m/s** for both right- and left-movers (260 RM and 30 LM cases).
- Deviations larger than 10 m/s are linked to outflow and boundaries. HP supercells deviate more (Rasmussen & Straka 1998 via Bunkers00).
  With time, supercells tend to deviate further **away from the low-level storm-relative inflow** (Bunkers00 §3).
- Boundaries shift storm motion by about **5 m/s** (Atkins & Weisman 1998, via Bunkers00). Storms may turn to move along a boundary.
- The method is Galilean invariant: it does not depend on how the hodograph sits relative to the ground.
  SPC notes it closely matches the older "30° right, 75% speed" (30R75) rule in typical south-westerly flow:
  https://spc.noaa.gov/exper/soundings/help/vectors.html [S].

In a cyclonic, veering hodograph the right-mover is dominant and storms do not split. With a straight hodograph the storm splits into
mirror-image right- and left-movers. The right-mover moves to the right of the mean wind and slower than it [S: LMK].

### 1.2 Storm-relative winds

```
v_sr(z) = v(z) - c                     (c = storm motion)
SRH(0-h) = -∫_0^h  k · ( v_sr × ∂v/∂z ) dz      (m²/s²)
streamwise vorticity ω_s = ω_h · v_sr / |v_sr|
```

- Every feature position in this document is set by **storm-relative** flow. Use it for the inflow sector, where the anvil goes,
  how precipitation is spread, hail size sorting and the ZDR arc.
- Low-level (0–1 or 0–3 km) storm-relative inflow for a classic right-mover typically comes from the **east to south-east** in the
  storm frame (for motion toward the ENE) [T].
  Typical speeds are **10–20 m/s**, and up to 25 m/s with a strong low-level jet [E/T].
- In a curved hodograph the updraft tilts streamwise vorticity, so cyclonic vorticity sits **on** the initial updraft.
  This gives "immediate rotation" and no split.
  With crosswise vorticity the updraft gets cyclonic and anticyclonic centres on its right and left flanks and then splits
  ([S: OU/SPC lecture, Weinman & Nixon](https://twister.caps.ou.edu/METR4403/lectures_2025/Supercell%20Dynamics%20and%20Pressure%20Perturbations_METR4403_5403.pdf)).

### 1.3 Frame used in this document

Origin = **centre of the low-level mesocyclone** (z ≈ 0.5–1 km). **+x = direction of storm motion ("forward")**.
**+y = left of motion**. For a storm moving toward the ENE, +y points roughly NNW, so "left-forward" ≈ north-east and "right-rear" ≈ south-west.
The canonical reference case is a classic right-mover moving toward 070° at about 12 m/s in a south-westerly deep-shear environment.
Its 0–6 km shear vector points toward roughly 045–060°, which is nearly along +x and a little toward +y.

**Mapping rule for the engine [E]:** "downshear" ≈ +x (slightly +y). "Right flank" = −y. "Rear flank" = −x.
"Forward flank" = +x/+y.

---

## 2. Main updraft and mesocyclone

### 2.1 Updraft speed

- Parcel theory: `w_max = sqrt(2·CAPE)`. CAPE 2000 → 63 m/s; 3000 → 77 m/s; 4000 → 89 m/s [T].
- Observed peaks are much lower. The greatest reported values are **49 m/s (Texas, Bluestein et al. 1988) and 53 m/s (Oklahoma,
  Markowski et al. 2018)**, and a research flight in Montana found about 50 m/s near 7 km.
  Radiosonde-derived peaks are **36–50 m/s**. Dual-Doppler retrievals give values **15–20 m/s lower** than radiosondes at the same point
  (Marinescu et al. 2020, https://tropical.colostate.edu/pub/Marinescu_Bell_MWR.html) [S, via search summary].
- So `w_obs ≈ (0.5–0.7)·sqrt(2·CAPE)` [E]. The reductions come from three effects:
  - **Water loading.** Buoyancy B = g(θv'/θv − q_c − q_r − q_i). Each 1 g/kg of condensate costs 0.0098 m/s², about the same as
    0.3 K of θv. So 5–10 g/kg costs **1.5–3 K** [T].
  - **Entrainment** dilutes the core. Wide supercell updrafts (R ≳ 3 km) keep an undilute core better than narrow ones.
    This is the reason supercells reach the highest observed w of any convective mode [T].
  - **The downward buoyancy pressure gradient** (`−∂p_b'/∂z`) partly cancels B.
- Dynamic effect: rotation makes low pressure in the middle levels (`p_d' ∝ −ζ²`), and the upward VPPGF raises peak w by
  **50–100%** compared with buoyancy alone (Peters & Nowotarski, via search,
  https://par.nsf.gov/servlets/purl/10188826) [S]. Rotating low pressure: `p' ≈ −ρ (V_rot)² ` at the meso core [T].
- Height of maximum w is usually **6–10 km AGL**, in the upper half of the CAPE profile.
  Updrafts are "strongest in mid-levels" ([S: LMK]).
- Low-level w just above cloud base is about 5–15 m/s. The tornado/low-level meso region has w ≈ 10–20 m/s at 1 km [T/E].

**Formula for the engine [E]:**
```
w_core(z) ≈ k · sqrt(2 · CAPE_below(z)),  with k ≈ 0.6
```
where `CAPE_below(z)` is the positive area from the LFC up to z. Peak w is at roughly 0.6–0.7 of the EL height.

### 2.2 Updraft size

- Main updraft diameter at mid-levels: **5–10 km**. The intense core (w > 20 m/s) is **2–5 km** across [T].
  The BWER (= updraft core) is "a few kilometers (1–4 nm, i.e. 2–7 km) in horizontal diameter" and "on rare occasions … up to 5–6 nm
  (9–11 km) wide and extending to storm summit" [S: RAC].
- Mass flux check [E]: w = 30 m/s over a 2.5 km radius core (A ≈ 20 km²) at ρ = 0.7 kg/m³ gives
  M ≈ 4×10⁸ kg/s. If inflow is 1.5 km deep at 15 m/s storm-relative and ρ = 1.1, the inflow must be drawn through a front
  `L = M/(ρ·u·h)` ≈ **17 km wide**. This is why inflow bands and scud converge from a broad (15–25 km) sector on the right-forward
  side [E].

### 2.3 Mesocyclone

- Definition: "a storm-scale region of rotation, typically around **2–6 miles (3–10 km)** in diameter", usually on the **right
  rear flank** of a supercell, or on the eastern (front) flank of an HP storm (NWS glossary,
  https://forecast.weather.gov/glossary.php?word=mesocyclone) [S].
- Detection criteria used by NSSL/NWS: diameter **2–10 km**, vertical depth **≈3 km**, two or more volume scans, and minimum
  rotational velocity **≈15 m/s** (BoM/COMET training via search) [S].
- Vertical vorticity in the mid-level mesocyclone is **~10⁻² s⁻¹**
  (Markowski & Richardson, 24th SLS, https://ams.confex.com/ams/pdfpapers/141560.pdf) [S].
  Check with a Rankine vortex: `V_rot = ζ·R/2`, so ζ = 0.01 s⁻¹ with R = 3 km gives V_rot = 15 m/s, which matches the
  15 m/s criterion [E].
- Typical V_rot: mid-level **15–30 m/s**. Strong low-level mesos are **20–35 m/s**, with radius 1–2 km.
  NWS offices use **V_rot ≥ 40 kt (~20 m/s)** at the lowest slice as a tornado-warning trigger (NWS Morristown study, via search) [S].
  Northeast guidance is ≥ 25 kt with diameter ≤ 5 mi [S].
  Shear from radar: `shear (s⁻¹) = V_r(kt) / (D(nm)·1800)` (LaPenta et al. 2000) [S].
- **Mid-level mesocyclone**: 3–7 km AGL. It forms first, from tilting of environmental streamwise vorticity [T, S: LMK].
- **Low-level mesocyclone**: 0–2 km, often < 1 km. It forms later, from baroclinically generated vorticity along the FFD
  plus tilting and stretching by the downdraft. It sits **in the notch of the hook** [S: LMK].
  The low-level meso lies **along the RFD gust front**, and the **mid-level meso leads it by several kilometres**
  (Goshen County 2009, VORTEX2, ESSL 2011 abstract https://www.essl.org/ECSS/2011/programme/abstracts/125.pdf) [S].
  The mid-level meso is therefore downshear/forward (+x) of the low-level meso by **2–5 km** [E from S].
- Mesocyclones can last for hours [S: LMK]. Supercell lifecycle is **1–4 h, which is common** [S: LMK].
  Some last more than 7 h, and at most about 30% produce tornadoes [S: Wikipedia Supercell, citing NWS Louisville].

### 2.4 Updraft tilt

- The updraft leans **downshear**. A rough slope is `dx/dz ≈ (U_sr at height) / w`. With 15 m/s storm-relative wind and
  w = 30 m/s, the slope is 0.5, so the updraft core moves about **3–5 km downshear between 1 and 10 km** [E].
  Strong supercells are close to vertical in the BWER (the "untilted updraft" of a strong BWER), and weak ones tilt more [S: Wikipedia Supercell].
- Practical layout [E]:
  - Low-level updraft centre: about **+1 km x, +0.5 km y** from the low-level meso.
  - Mid-level core: **+2 to +3 km x**.
  - Overshooting top: **+3 to +5 km x, +1 to +3 km y** (sheared forward/left with the upper wind).

### 2.5 BWER / vault

- Found **3–10 km AGL**, **2–7 km wide**. It is "capped by large concentrations of supercooled liquid water and rapidly growing
  (typically >2-inch diameter) hail" and lies "embedded in the sloping echo overhang and aloft above the apex of the low-level
  inflow notch" [S: RAC]. BWER location = core of the mesocyclone / rotating updraft [S: LMK].
- Below it, the low-level **WER** is a weak-echo area on the inflow side under the sloping overhang [S: RAC].
- Reflectivity inside the BWER is **< 20–30 dBZ**, with walls of **50–65 dBZ** [T].
- ZDR column: **> 2 dB up to about 7 km**, well above the 0 °C level, on the **downwind periphery of the BWER**.
  KDP column: **> 2°/km up to about 6.5 km**, slightly **west (upshear)** of the ZDR column [S: KR07].
- Mid-level ZDR / ρhv rings: **2.5–5.5 km**. A half-ring is "always on the eastern or right flank of the updraft" [S: KR07].

### 2.6 Overshooting top

- A domelike protrusion where the updraft passes its EL. It is usually transient, but tall, persistent tops go with
  severe storms [S: RAC/AMS].
- Lifetime: individual tops last a mean of **~8.5 min** (geostationary study, Auth thesis, CSU,
  https://mountainscholar.org/items/2404ff8a-2270-429e-99d2-fae777e3c945/full).
  A single top lasts less than 30 min with diameter up to ~15 km (ESSL abstract,
  https://www.essl.org/ECSS/2011/programme/abstracts/16.pdf) [S].
  Tops that persist **more than 10 min** mark a strong updraft (NSSL/JetStream via Wikipedia) [S].
- Height above the anvil [E/T]: about `Δz ≈ w_EL / N_strat`. With w_EL = 30–50 m/s and N ≈ 0.02 s⁻¹, Δz is **1.5–2.5 km**.
  Observed values are typically **1–3 km**, rarely more than 4 km.
- Above-anvil cirrus plumes went with **73% of significant severe reports** and appeared **31 min before warnings** on average
  (Bedka et al. 2018 via Wikipedia) [S].

---

## 3. Cloud base, wall cloud and inflow clouds

### 3.1 Cloud base (LCL)

- Espy rule: `z_LCL ≈ 125 m × (T − Td)` (K). For example, a 6 K spread gives ≈ 0.75 km
  (UBC ATSC113, https://eoas.ubc.ca/courses/atsc113/flying/met_concepts/01-met_concepts/01d-ceilings/zlcl.html) [S].
  The coefficient comes from the difference between the dry adiabatic and dew-point lapse rates, about 8 K/km [S].
- Tornadic supercells favour **LCL < 1–1.5 km**. LP storms have higher bases (higher LCL), which tends to stop tornadoes [S: LMK].
- **Rain-free base** (RFB): a dark, horizontal base with no visible precipitation under it, marking the updraft (NWS spotter glossary) [S].
  It sits on the **south/south-east (right-forward) side** of the precipitation, in the inflow region [S: Wikipedia Supercell, NWS-SG].
  RFB extent is typically **5–15 km** across [E], about the size of the low/mid-level updraft plus the inflow skirt.

### 3.2 Wall cloud

- "A localized, persistent, often abrupt lowering from a cumulonimbus cloud base into a low-hanging accessory cloud, normally a
  **kilometer or more in diameter**." Wall clouds with strong rotation and vertical motion "often precede tornado formation by
  **a few minutes to an hour**" [S: RAC/AMS]. A typical lead is **10–20 min** [S: Wikipedia Wall cloud].
  Diameter ranges from **a fraction of a mile to over 5 mi (≤ 8 km)** [S: Wikipedia]. A significant wall cloud persists **≥ 10 min** [S: NWS spotter material].
- Position: on the **northern side of the RFD**, in "the action area" where the strongest updraft is.
  It forms where warm moist inflow meets cool moist FFD outflow [S: NWS-SG].
  It is on the **south / south-west end** of the storm near the main updraft [S: Wikipedia], and sits under the RFB on the side
  nearest the precipitation (FFD/RFD boundary).
- Why it is lower: the updraft takes in rain-cooled, moistened FFD air with a smaller dew-point depression, so that air's LCL is lower [S: NWS-SG; physics E].
  Example: inflow (T − Td) = 8 K gives LCL 1.0 km. FFD-modified air with (T − Td) = 4 K gives LCL 0.5 km, so the wall cloud
  hangs **~0.5 km** below the RFB. Typical drop: **100–800 m** [E].
- Size for the game [E]:
  - Diameter 1.5–4 km (rotating, under the low-level meso; the low-level meso radius is 1–2 km).
  - Base 0.3–1.0 km AGL.
  - It rotates with the low-level meso at ~5–20 m/s at its edge, and has rising scud on its leading (inflow) side.

### 3.3 Tail cloud, inflow band, beaver tail

- **Tail cloud**: "a cloud band, often laminar and tube-shaped … that extends from the **forward-flank downdraft precipitation
  cascade region** … toward the wall cloud. Cloud motion in the tail cloud is away from the precipitation and toward the wall
  cloud, with rapid upward motion often observed near the junction" [S: RAC]. "Tail of wall cloud that points toward FFD" [S: LMK].
  In the storm frame it runs from the wall cloud toward **+x/+y** (forward-left, i.e. north/north-east), at or below wall-cloud base.
  Length **2–8 km** [E].
- **Beaver tail**: "a particular type of inflow band with a relatively broad, flat appearance … attached to a supercell's general
  updraft and oriented roughly **parallel to the pseudo-warm front (forward-flank downdraft gust front)**. … cloud elements move
  toward the updraft." Its base is at **about the updraft base level, not the wall cloud** [S: RAC].
- **Inflow bands / stinger**: low cloud bands on the inflow side, pointing into the updraft from the right-forward (south-east)
  quadrant. Length **5–30 km**. Elements move toward the updraft at the storm-relative inflow speed (10–20 m/s) [E].
- **Scud**: ragged fractus cloud in the moist outflow/inflow mix. It rises fast into the wall cloud on the inflow side [T].

---

## 4. Forward-flank downdraft (FFD)

- Position: **north, north-east or east of the updraft, depending on storm motion**. Mid-level winds tilt the updraft and push the
  downdraft downwind. It is the rain-cooled **main precipitation area** [S: NWS-SG].
  The FFD cold pool's outflow boundary lies **north-east of the hook echo and tornado location** [S: LMK].
- Driven by precipitation loading, melting and evaporation [S: LMK, Halbert26].
- **FFD gust front** (pseudo-warm front): "on the leading and southern side of the FFD. Storm-relative inflow advances into the
  boundary from the south or east as it becomes quasi-stationary" [S: LMK]. In the storm frame it runs from the low-level meso
  **forward (+x)** along y ≈ −1 to +1 km for **10–30 km** [E].
- **Vorticity generation**: inflow air "rides over top of outflow from north" and makes horizontal vorticity along the boundary.
  That vorticity is pulled west into the hook area and tilted into the updraft, strengthening the low-level meso [S: LMK].
  Baroclinic generation: `Dω_h/Dt ≈ (g/θ₀) · k × ∇_h θ'`. For a gradient of 1 K/km this is
  ≈ 3.3×10⁻⁵ s⁻², so a parcel spending 10 min in the zone gains about **0.02 s⁻¹** [E]. Observed surface baroclinity in
  hook/RFD regions is weak, with max |∇θ| ≈ **1 K/km** in prolific tornadic storms [S: MSR02].
  Low-level horizontal vorticity is mainly baroclinic. The downdraft turns it into vertical vorticity, which is then stretched
  under the low-level meso (Davies-Jones & Brooks 1993; Markowski & Richardson 2014) [S: Halbert26].
- Temperature deficit: FFD outflow is typically **2–6 K** cooler than inflow at the surface [T]. Cooler outflow is more stable, and
  with "strong negative buoyancy … [the circulation] is unable to be lifted by the mesocyclone". Intermediate cold pools are best
  for tornadoes [S: Halbert26 summarising MR14].
- Size of the FFD precipitation area [E/T]: **10–30 km along motion × 8–15 km across**. The core is centred **5–12 km** forward-left
  of the low-level meso.

---

## 5. Rear-flank downdraft (RFD)

- "A region of **dry air subsiding on the back side of, and wrapping around, a mesocyclone**. It often is visible as a **clear slot
  wrapping around the wall cloud**. Scattered large precipitation particles … at the interface … may show up on radar as a hook" [S: RAC].
- The classical RFD core is centred **south-west of the mesocyclone** (Lemon & Doswell 1979, via an AMS paper) [S].
  It sits mainly behind the tornado [S: NWS-SG].
- Forcing:
  - Dynamic: the rotating updraft blocks the mid/upper-level flow, high pressure builds on the upwind side, and air sinks.
    The RFD is "forced down from the mid-levels … resulting in compressional heating".
  - Thermodynamic: evaporation and negative buoyancy, with dry air entrained from behind the storm [S: LMK; AMS paper via search].
  - Downward VPPGF from the low-level meso's dynamic low [T].
- **Origin height**: tornadic supercells had RFDs with **low** origin heights and nontornadic ones much higher (MSR02 / Markowski 2003
  via Naylor & Askelson, https://ams.confex.com/ams/pdfpapers/104563.pdf) [S].
  In nontornadic RFDs, the surface θe matched sounding θe about **1 km higher** than in tornadic RFDs [S: MSR02].
  Typical origin heights are **1–4 km** [T/E]. In cases with large θe deficits, "midlevel θe values" are found at the surface [S: MSR02].
- **Surface thermodynamics** [S: MSR02] (deficits relative to the inflow):
  - Nontornadic: θe deficits **≥ 8–10 K**. CIN is large within 4 km of the circulation (200–300 J/kg in 4 of 12 cases, ≥ 500 J/kg in 5 of 12).
  - Weakly tornadic (F0–F1, ≤ 5 min): θv deficits **4–7 K**, θe deficits **10–12 K**.
  - Significantly tornadic: θv deficits **≲ 2 K**, θe **≲ 4 K** within 2 km of the tornado.
    Exception: the Allison TX F4 had θ deficits up to 7 K with total CAPE ≥ 4000.
  - Tornadic RFDs are on average **3–4 K warmer in θv** (3–5 K in θe) than nontornadic ones.
  - The largest tornadic/nontornadic differences were found **east of the circulation centres** [S: MSR02].
- RFD surface pressure excess: **up to a few mb** (M02 via Wikipedia RFD) [S].
- Winds: the RFD "may contain sustained winds over 100 mph and hail larger than baseballs" [S: NWS-SG].
  Significant straight-line damage occurs along the RFD gust front **just south of the tornado** [S: LMK].
  Typical RFD surge speed is **15–35 m/s** [T/E].
- **RFD gust front** (pseudo-cold front): "arcs back into updraft/hook area where it can enhance low-level convergence" [S: LMK].
  It curls cyclonically from the meso **south then south-west**, toward right-rear (−y, then −x) in the storm frame.
- **Clear slot**: a horseshoe-shaped clearing. "The northern side of the horseshoe is the most likely tornado location". Anticyclonic
  tornadoes can form on the south side [S: NWS-SG]. It wraps "at least two-thirds of the way around the tornado" late in the cycle
  [S: Wikipedia RFD]. Radius from the meso centre: **1–3 km** [E].
- **Secondary RFD / internal surge** (RFDIS): a secondary RFD embedded in the first. It affects tornado development, intensity and
  demise [S: RAC]. In Goshen County 2009 the secondary RFD gust front formed **behind** the primary one, next to the developing
  tornado, and was strongest just before peak intensity [S: VORTEX2 abstracts via search].
- **Wet RFD (HP)**: filled with precipitation and very large hail, and hides the tornado [S: NWS-SG].
- **Occlusion downdraft** [T]: a downdraft at the centre of an occluding low-level meso, driven downward by the VPPGF as rotation
  near the ground becomes stronger than rotation aloft. It is about 1 km across.

---

## 6. Hail core

- Hail falls out on the **outer edge of the updraft on the downdraft side** [S: theweatherprediction.com].
  The BWER is capped by rapidly growing hail of > 2 in [S: RAC].
- The low-level **hail signature** (high Z with low ZDR, ≲ 2 dB at S band) is "in the core of the storm **just north-east of the
  hook echo**" [S: Dawson14 text]. It is "most commonly just north or north-west of the mesocyclone" [S: Dawson14 abstract summary].
  It is more consistent in **nontornadic** supercells [S: KR10 via search].
- **Size sorting**: the strong storm-relative winds that carry hail out of the updraft top sort it. Large stones fall fastest and land
  closest to the updraft. Small hail and rain are carried further downstream [T].
  Hail is sorted mostly **above the melting level (~3 km)**. The hail-size gradient lines up with the **deep-layer (~1–9 km)**
  storm-relative mean wind, and the rain-size gradient with the **0–3 km** (sub-melting-layer) storm-relative wind [S: Dawson14].
  The largest hail therefore lands closest to the updraft on the **left-forward (north/north-east) edge of the WER**, with sizes
  getting smaller downshear [E from S].
- **ZDR arc**: "a region of high ZDR … along the **sharp low-level reflectivity gradient facing the storm-relative inflow**" [S: RAC].
  It lies on the **right (usually southern) edge of the forward flank**, is shallow (**below 2 km**), and has peak ZDR of
  **~3–5 dB** (4.5 dB in a 15 m/s ¼-circle hodograph model) [S: KR07]. Its strength rises with **0–3 km SRH** [S: KR07/KR09].
- **TBSS (hail spike)**: a **10–30 km** long, < 25 dBZ spike radially behind a core of **> 63 dBZ** [S: RAC].
- **KDP foot**: enhanced low-level KDP from melting hail (Johnson et al. 2016, https://twister.caps.ou.edu/papers/JohnsonEtal_MWR2016.pdf) [S].
  It sits on the forward flank beyond the hail core [T].

### 6.1 Hail terminal velocity

Physics (sphere, drag balance; Knight & Knight 2001 via Foster/StormTrack) [S]:
```
v_t = sqrt( 4 g ρ_h D / (3 C_D ρ_a) )
    ρ_h ≈ 900 kg/m³ (ice, less for spongy/rimed hail), C_D ≈ 0.45–0.6, ρ_a = air density
```
Empirical (NASA GPM FAQ) [S]: `v_t ≈ 9 · D^0.8 m/s` (D in cm).
NSSL fall speeds [S: NSSL-hail]: < 1 in → 9–25 mph; 1–1.75 in → 25–40 mph; 2–4 in → 44–72 mph; > 4 in → > 100 mph.

Computed table (C_D = 0.6, ρ_h = 900) [E from S formulas]:

| D | v_t at ρ_a = 1.0 (≈2 km) | at ρ_a = 0.7 (≈5–6 km) | 9·D^0.8 |
|---|---|---|---|
| 1 cm | 14 m/s | 17 | 9 |
| 2.5 cm (1 in, severe) | 22 | 27 | 19 |
| 4.4 cm (golf ball) | 29 | 35 | 29 |
| 5 cm (2 in, significant) | 31 | 37 | 33 |
| 7 cm (baseball) | 37 | 44 | 43 |
| 10 cm (softball) | 44 | 53 | 57 |
| 15 cm | 54 | 65 | 79 |

- The updraft needed to **suspend** the stone at the growth level is ≈ v_t at that level's air density (Foster & Bates premise:
  https://origin-east-www-spc.woc.noaa.gov/publications/foster/hailsize.pdf) [S].
  Growing 5 cm hail needs ≈ **35–40 m/s** at 5–7 km. Growing 10 cm hail needs ≈ **50+ m/s**.
- **Fall-out distance** [E]: horizontal drift ≈ `U_sr · H / v_t`. For a stone leaving at H = 8 km in 20 m/s storm-relative wind,
  5 cm hail (v_t ≈ 33) drifts ~5 km, 2 cm hail (v_t ≈ 20) ~8 km, and 5 mm graupel/rain (v_t ≈ 8) ~20 km.
  Hail drifts downshear and toward the left. This gives the engine its size sorting directly.
- **Hail swath**: a College of DuPage course page says "average hail swath is 20.2 km" for supercells, against 10 km for
  multicells, without saying whether this is length or width or naming the source study. It gives a mean maximum stone of 5.3 cm
  (https://weather.cod.edu/sirvatka/sc.html) [S, weak].
  Swath lengths run **10–686 km**, and only **77 of 315** storms produced large hail for ≥ 100 km
  (ECSS2025, https://meetingorganizer.copernicus.org/ECSS2025/ECSS2025-262.html) [S].
  Example swaths: 395 km × up to 35 km (HP supercell, 10 April 2001, https://weather.gov/lsx/04_10_2001); 120 km × 7–11 km
  (SD 1996) [S].
  For the game, the instantaneous large-hail footprint is **2–6 km wide** and the swath is the width × the track length [E].

---

## 7. Precipitation layout and radar

- **Reflectivity by region** [T/E]:

  | Region | Reflectivity |
  |---|---|
  | BWER/WER | < 20–30 dBZ |
  | Hook echo | 35–50 dBZ (light to moderate rain, scattered large drops and hail) |
  | FFD rain core | 50–60 dBZ |
  | Hail core | 60–70+ dBZ (TBSS when > 63, [S: RAC]) |
  | Anvil | 0–25 dBZ |
  | Inflow notch | < 20 dBZ |

  Mini/low-topped supercells reach a max of **50–55 dBZ**. Their tops are **24–32 kft**, CAPE is **300–1500 J/kg**, and their mesos
  are smaller and shallower [S: LMK].
- **Hook echo**: precipitation wrapped around the back side of the updraft by the mid-level meso. The low-level meso sits in the
  notch [S: LMK]. "A tornado, if present, is within the figure '6' or at the **tip of the hook echo** itself" [S: RAC].
  A debris ball at the hook tip means a tornado is on the ground [S: LMK].
  Hook size [T/E]: the hook arc radius is 1–4 km and it extends 3–10 km from the main echo toward the right-rear (south/south-west).
  Tornadic and nontornadic hooks show no systematic shape difference [S: MSR02 Fig. 1].
- **Inflow notch**: a notch of weak echo on the inflow side. It marks a very strong updraft with strong low-level inflow [S: RAC].
  It points into the WER from the right-forward (south-east) side [E].
- **V-notch**: a weak-echo slot on the downwind edge, caused by blocked flow aloft around the updraft core [S: LMK].
- **Flanking line**: an organised lifting zone of cumulus and towering cumulus attached to the mature updraft tower.
  It has "a stair-step appearance, with the tallest clouds adjacent to the mature updraft tower" [S: RAC]. It is normally on the
  **south-west side** [S: NWS spotter glossary] and lies along the RFD gust front [T].
  Length **10–30 km** [E]. Tops step down from 10–12 km next to the main tower to 3–6 km at the far end [E].
- **LP / classic / HP spectrum**:
  - Anvil-level storm-relative wind: **LP > ~28 m/s, classic ~18–28 (or 18–30), HP < ~18 m/s** (Rasmussen & Straka 1998, via
    NWS Hastings https://www.weather.gov/media/crh/publications/ARP/arp26-03.pdf and NWS NSHARP 9–11 km layer
    https://training.weather.gov/wdtd/buildTraining/nsharp-interactive/content/SR-vectors.html) [S].
    Physics: strong upper storm-relative wind blows hydrometeors far downstream before they fall (LP). Weak wind lets them fall back
    around the updraft (HP).
  - **LP**: small, light precipitation core well separated from (downwind of) the updraft, barber-pole look, high bases, large hail
    in clear air, rarely tornadic, smaller on radar [S: NWS-SG, LMK, Wikipedia].
  - **Classic**: hook echo on the right-rear, FFD core forward-left, and a visible wall cloud under the RFB.
  - **HP**: rain wraps round the meso and gives a kidney-bean shape with a notch on the **leading edge**. The tornado and hazards are
    on the **leading (south-east) edge**. The wet RFD rain-wraps the tornado. HP storms are common east of the Plains and along
    boundaries [S: LMK, Wikipedia].

---

## 8. Vertical structure

- **Tropopause / EL / anvil height**: anvils form at the EL, typically **10–15 km** in spring Plains storms [T]. Tops reach
  **17–21 km** in extreme storms. The record is about **21 km (68,000 ft), Coahuila, 24 May 2016** [S: Wikipedia Supercell].
  Anvil temperatures are about −30 to −60 °C [T].
- **Anvil spread**: the anvil is carried downstream by the upper-level storm-relative wind ("can spread over great distances",
  [S: theweatherprediction.com]). Length ≈ `U_sr(anvil) × age`, so 25 m/s for 1–2 h gives **90–180 km**, and anvils of
  **100–300 km** are common for mature supercells [E/T]. Anvil width is about **30–80 km** [E].
  The centre of the anvil is far downstream (+x/+y), not over the updraft.
- **Backsheared anvil**: the part of the anvil spreading **upwind** (−x), against the upper flow, by 5–20 km from the overshooting
  top. It marks a very strong updraft whose divergence beats the upper wind [T].
- **Mammatus**: on the underside of the anvil, made of pockets of cooled air as particles fall and evaporate [S: LMK]. Mostly under
  the downshear anvil and near the updraft edge of the anvil [T].
- **Barber-pole / striations**: rotating updraft cloud with corkscrew banding, typical of LP storms [S: NWS-SG]. In classic
  storms they show as "laminar" banding on the updraft tower and RFB edge [T].
- **Precipitation-free updraft column**: the WER/BWER from the base to 7–10 km. On the radar ZDR shows the updraft as a column
  (≤ 7 km), but visually it is solid cloud [S: KR07].
- **Mid-level dry air**: RFD air entrained from 2–5 km, with low θe in nontornadic storms [S: MSR02]. Storm-relative mid-level
  winds of 10–20 m/s at 4–6 km help supercells [T]. Mid-level storm-relative wind correlated with RFD deficits:
  r = 0.57 (3 km), r = 0.68 (4 km) [S: MSR02].

---

## 9. Motion and evolution timescales

- **Occlusion cycle**: in simulations the occlusion has a period of **≈60 min** (two occlusions plus a third starting in 4 h)
  [S: ADD99]. At coarse 2 km grid spacing the cycling disappears, and at 0.5 km three cycles appear (Adlerman & Droegemeier 2002) [S].
  Observed tornado families have tornadoes at **quasi-regular ~45 min** intervals, each "in a new mesocyclone just after an old
  tornado has decayed in an old, occluded neighboring mesocyclone". In the common **parallel mode**, each new tornado forms **on the
  right side of its predecessor** [S: RAC/AMS "family of tornadoes"]. The literature range is **20–90 min** per cycle [T].
- **Occlusion sequence** (Lemon & Doswell 1979) [S via search; T]:
  1. The RFD descends and its gust front wraps cyclonically around the low-level meso.
  2. The occlusion point (triple point) moves toward the meso centre, and the tornado forms near the point of occlusion.
  3. The meso and tornado move **left of the storm motion**, back into the cold air (toward +y/−x).
  4. The new low-level meso forms **to the right/ahead (south-east)** of the old one, at the new triple point where the RFD and FFD
     gust fronts meet, typically **3–10 km** away [E].
  Tornadogenesis may come **10–15 min after** the low-level meso occludes [S: MSR02].
- **Tornado location**: at the tip of the hook / inside the "6" [S: RAC], on the north side of the clear-slot horseshoe [S: NWS-SG],
  under the wall cloud, near where the RFD and FFD outflows meet. It is within **~1–2 km of the low-level meso centre**,
  usually on its south/south-west side during genesis, and moves toward the meso's north-west/rear side as it occludes [E/T].
  Lemon & Doswell put the tornado vortex in the vertical-velocity gradient between the updraft/mid-level meso and the RFD
  [S: Halbert26].
- Supercell lifetime is **1–4 h, which is common**; some last more than 7 h [S: LMK, Wikipedia].
- Storm-relative timescales for the engine [E]:
  - A hydrometeor takes ~10–20 min to fall from the anvil overhang.
  - An RFD surge takes ~5–10 min from origin to the ground (2 km at 5 m/s).
  - It takes ~5–15 min for a wall cloud to form after a strong updraft pulse.
  - Overshooting tops pulse with a period of ~5–15 min.

---

## 10. Plan-view coordinate table

Classic right-mover, motion toward **070° at ~12 m/s**. Origin = **low-level mesocyclone centre** (z ≈ 0.5–1 km).
**x = km along motion (+ forward, roughly ENE)**, **y = km to the left of motion (+ roughly NNW, − roughly SSE)**.
To get a ground frame for a motion heading h (degrees clockwise from north; h = 70° here):
`E = x·sin h − y·cos h` and `N = x·cos h + y·sin h`.

Evidence column: **S** = position stated by a source (direction, and sometimes distance). **E** = my numbers built on a sourced direction.

| Feature | (x, y) km centre | Size | Height | Evidence |
|---|---|---|---|---|
| Low-level mesocyclone | (0, 0) | R 1–2 km, V_rot 15–35 m/s | 0–2 km | S (in hook notch, along RFD GF) |
| Mid-level meso / main updraft core | (+2, +0.5) to (+3, +1) | R 2–5 km | 3–8 km | S direction (leads LL meso by several km), E distance |
| Low-level updraft (WER inflow) | (+1, −0.5) | R 2–4 km | base–3 km | E |
| BWER / vault | (+2, +0.5) | dia 2–7 km (rarely 11) | 3–10 km | S size/height, E position (above inflow-notch apex) |
| Overshooting top | (+4, +2) | dia 3–15 km | EL + 1–3 km | S lifetime/dia, E position/height |
| Rain-free base | (+2, −1) | 5–15 km across | LCL 0.5–2 km | S side (south/inflow), E size |
| Wall cloud | (0, −0.3) | dia 1.5–4 km (≤ 8) | 0.1–0.8 km below RFB | S position/size, E offset |
| Tornado (genesis) | (−0.3, −0.5) | 0.05–1.5 km | surface–cloud | S (hook tip, N side of clear slot), E distance |
| Tornado (occluding) | (−1, +0.5) | — | — | T/E (drifts left/rear) |
| Tail cloud | from (+0.5, 0) to (+5, +2) | 2–8 km long, 0.5–1.5 km wide | wall-cloud base | S direction (toward FFD), E length |
| Beaver tail / inflow band | from (+3, −1) to (+20, −4) | 5–30 km long | updraft-base level | S orientation (parallel FFD GF), E length |
| Inflow stinger / scud bands | sector x 0…+20, y −3…−20 | converge toward (+1, −0.5) | 0.3–1.5 km | E |
| RFD core | (−2, −2) | R 1.5–3 km | origin 1–4 km | S direction (SW of meso), E distance |
| Clear slot | arc r = 1–3 km, bearings from rear (−x) through right (−y) | width 0.5–2 km | full cloud depth | S shape (horseshoe), E radius |
| RFD gust front | arc from (0, −0.5) → (+1, −3) → (−3, −10) | 10–20 km long | 0.5–1.5 km deep | S (arcs into hook, south of tornado), E shape |
| FFD gust front | (0, −0.5) → (+20, −1) | 10–30 km | 0.5–1 km deep | S (leading/southern side of FFD), E length |
| Triple point / new-meso birthplace | (+1, −2) to (+4, −4) | — | — | T/E |
| Hail core (largest stones) | (+1.5, +2.5) | R 1–3 km | falls from 6–10 km | S (just NE of hook / N–NW of meso), E distance |
| Hail fall-out sorting axis | from (+1.5, +2.5) toward (+8, +6) | 2–6 km wide | — | S (aligned with 1–9 km SR wind), E |
| Heaviest rain / FFD core | (+7, +4) | 8–15 km × 6–10 km | — | S direction (N–NE–E), E distance |
| ZDR arc | strip (+2, +0.5) → (+12, +2) | 1–3 km wide | < 2 km | S (south edge of FFD, faces inflow) |
| Hook echo | from (0, +2) curling via (−2, 0) to (−1, −2) | 3–10 km long, 1–3 km wide | < 3 km | S (wraps rear of updraft), E size |
| Flanking line | (−2, −4) → (−12, −16) | 10–30 km long | tops 12 km → 4 km | S (SW, stair-step, tallest adjacent), E length |
| Anvil centre | (+60, +15) | 100–300 km × 30–80 km | 10–15 km | E (downstream on upper SR wind) |
| Backsheared anvil edge | (−10, 0) | 5–20 km upstream | EL | T/E |
| Mammatus field | (+10…+60, 0…+20) | — | anvil base 7–10 km | T/E |

**HP variant [E from S]**: shift the rain/hail cores toward the meso and wrap rain round the RFD, so that the hook becomes a
40–55 dBZ "bean" at (−3…+2, −3…+3). The inflow notch and tornado move to the leading (+x, −y) edge.
**LP variant [E from S]**: move the precipitation 10–20 km downstream (+x), drop the hook and most of the RFD, use a smaller FFD,
put large hail at (+3…+8, +2…+5) in light precipitation, and raise the base by 1–2 km.

### Engine mapping notes [E]
1. Derive the storm motion with Bunkers from engine winds, then rotate all offsets into the storm-motion frame.
2. Scale distances with updraft radius R_u. Using R_u ≈ 3 km as the reference: hail core at ≈ 1 R_u forward-left, FFD core at
   ≈ 2.5 R_u, RFD core at ≈ 1 R_u right-rear.
3. Place precipitation by **advection**, not offsets. Drop particles at the updraft edge at 6–10 km and drift them with
   `v_sr / v_t(D)`. The hail core, size sorting, ZDR arc and FFD rain then appear in the right places by themselves, and LP vs HP
   follows from the anvil-level storm-relative wind.
4. Set the wall-cloud drop from the LCL difference between inflow and FFD-modified air, not a constant.
5. Run the occlusion cycle on a 45–60 min clock driven by RFD strength. The new meso spawns at the triple point, 3–10 km right/ahead.
