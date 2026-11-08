# Tornado and wall-cloud motion facts for grading game visuals

Confidence tags: **[V]** = checked this session in the primary text or an abstract;
**[S]** = from a secondary summary that cites the primary paper; **[D]** = derived here from theory, with the
derivation shown; **[M]** = measured here from the clips in this folder; **[?]** = from memory or uncertain, and needs
a check before we tune to it.

Game note: the world runs on an 8x clock. In-game motion that should *look* real to a player must use real-time
speeds (m/s, rad/s) at render time, not 8x speeds, unless we decide otherwise. Each "Measure in game" line assumes a
recorded timelapse with known capture interval Δt, camera distance D (studs → m at 0.28 m/stud) and field of view.

---

## 1. Rotation speeds of visible tracers (debris, cloud tags)

- **Dallas, 2 Apr 1957 (Hoecker 1960, photogrammetry of debris/cloud tags in film):** peak tangential speed about
  **75 m/s at r ≈ 40 m, z ≈ 70 m** [S: as cited in Lee & Wurman 2005, *J. Atmos. Sci.*]. Upward speeds were reported
  "up to 150 mph (about 67 m/s)" [S, blog summary; treat as unverified]. Hoecker notes these are **minimum** speeds
  (tracers lag the air). Source: Weather Bureau Research Paper 41 (1960), NOAA library PDF;
  MWR 88:167-180, doi:10.1175/1520-0493(1960)088<0167:WSAAFP>2.0.CO;2.
- **Union City, 24 May 1973 (Golden & Purcell 1978, MWR 106:3-11):** photogrammetric peak winds **60-80 m/s
  (134-179 mph)**. An earlier analysis of debris inside the funnel gave 63-83 m/s [S: Wikipedia summary of the paper].
- **LaGrange WY, 5 Jun 2009 (Wakimoto, Atkins & Wurman 2011; DOW radar + photogrammetry):** velocity difference
  across the tornado about **105 m/s** (so about ±50 m/s) at low levels, with the strongest rotation in the lowest few
  hundred metres [V].
- Visible tracers move slower than radar winds: debris is centrifuged outward and lags the air, and cloud tags
  outside the core feel only the 1/r outer flow. Expect **visible motion of about 50-90 % of the radar Vmax**, more
  at the outer edge of the funnel [?, general photogrammetry caveat; Hoecker's "minimum speeds" remark is V].

**Measure in game:** track 5-10 tags or debris particles on the funnel edge across frames 0.25-0.5 s apart (real
time). Apparent angular speed ω = Δθ/Δt. Expect ω ≈ V_t / r, e.g. **V_t = 50 m/s at r = 100 m gives ω = 0.5 rad/s,
one turn in about 12.6 s**. At r = 40 m and 75 m/s, one turn takes about 3.4 s. A tag crossing the visible width of
a funnel should cross it in about (π r)/V_t seconds. A funnel that looks like it "spins in place" at less than
0.05 rad/s for r ≈ 100 m is far too slow.

## 2. Wall-cloud rotation and lowering

- **Goshen County (LaGrange) supercell (Atkins et al. 2014, MWR 142, doi:10.1175/MWR-D-14-00125.1; 36th Radar Conf.
  ext. abstract 4A.2) [V]:**
  - Primary cloud base **1100 m** ARL. The wall cloud reached **up to about 800 m below base**, sloping from 300 to
    900 m ARL. Later the wall-cloud base was about 560 m ARL.
  - An extra local lowering of **150-160 m** sat where the dual-Doppler **pressure perturbation was −8 to −10 hPa**.
    The authors compute that −10 hPa gives about 140 m of lowering for saturated air (about **14 m per hPa**). The
    lowest lowering is where the developing tornado formed, not at the wall-cloud centre.
  - Air entering the wall-cloud base came mainly from the **forward flank**: 3-4 K cooler and 1-1.5 g/kg drier,
    saturating at about 530 m, versus the observed 560 m base.
  - Non-tornadic La Junta wall cloud: 700-750 m below a 1300 m base, **not rotating**, and displaced about 3 km from
    the mesocyclone. Updraft was weak near the base and about 20 m/s at 2 km.
- **AMS Glossary:** wall clouds with significant rotation and vertical motion often precede tornadoes by **a few
  minutes to an hour** [V].
- **Rotation period [D, not measured in the literature we found]:** low-level mesocyclone radius about 1-2 km with
  tangential speeds of 15-30 m/s gives a period 2πr/V of about **4-14 min**. Visibly rotating wall clouds near a
  developing tornado (r about 0.5-1 km) turn faster, about **2-5 min per turn**. Treat these as targets for a sanity
  band, not as data.
- **Rising scud/cloud-tag speed: no published photogrammetric value found** (gap). Bounds: the low-level updraft
  under or near the wall cloud is about **5-15 m/s** at 0.5-1 km (dual-Doppler: more than 10 m/s at 1 km in a VORTEX2
  supercell updraft [S]; weak at the base for the non-rotating La Junta case [V]). Visible scud at the edge of the
  inflow therefore rises at about **2-10 m/s** [D/?].

**Measure in game:** (a) Wall-cloud rotation: pick 3+ tags on the wall-cloud edge and track their azimuth around the
wall-cloud centre over 30-60 s of real time. The period should be about 2-14 min, faster when a tornado is near.
(b) Lowering: measure wall-cloud bottom height against cloud base. Expect 300-800 m below a 1-1.5 km base. Any extra
local dip should match about 10-14 m per hPa of the engine's pressure deficit there. (c) Scud rise: track the vertical
pixel motion of tags under the base. Rise speed = Δy_px · (D · 2·tan(FOV/2) / H_px) / Δt, which should be 2-10 m/s.

## 3. Funnel descent and time from first funnel to touchdown

- **LaGrange 2009 [V]:** radar tornadogenesis and damage at **2152 UTC**, with no condensation funnel to the ground.
  At 2156 the funnel tip was **about 200 m AGL** under a wall cloud that reached about 400 m below base. The funnel
  "reached the surface" during **2205-2206** as azimuthal shear jumped. So there were **about 14 min of tornado with
  no full funnel**, and the last 200 m took about 10 min (intermittent, not steady descent).
- **Union City 1973 [S]:** in the first about 10 min the funnel touched down **twice, each under 15 s**, before it
  "firmly planted". Width was about 175 m at first touchdown.
- **Dynamic pipe effect:** the classic top-down descent theory. The AMS Glossary (2013 note) says it is now considered
  largely theoretical. Rapid-scan radar shows many tornadoes form near-simultaneously over depth or bottom-up [V].
  So **visible funnel descent is a condensation effect** (the deficit grows, so the condensation level drops). It is
  not a material "drill" coming down.
- **Apparent descent speeds in video [?, rough from clips]:** a funnel lowering from cloud base to the ground over
  **about 30 s to a few minutes**, so about **2-20 m/s** for a 0.5-1 km drop. It is often faster in the last stage,
  and the debris whirl at the ground often appears **before** the funnel reaches it (Moore and Prospect Valley clips
  show a ground whirl under a partial funnel).

**Measure in game:** log the funnel tip height every 0.5 s (from the engine condensation iso-surface or by finding
the funnel tip in screen space). Check (1) that a debris whirl can appear before contact, (2) that descent is
uneven, with retreats allowed, and (3) that the total time from first visible funnel to contact is about 0.5-15 min
of real time.

## 4. Condensation funnel radius vs vortex core radius (pressure-deficit relation)

- **Condensation condition [D]:** air expanding dry-adiabatically in the vortex saturates where its pressure reaches
  the ambient LCL pressure. A point h metres below the local cloud base needs a deficit
  **Δp_cond(h) ≈ ρ g h ≈ 10-12 hPa per 100 m** (ρ = 1.0-1.2 kg/m³). Atkins et al. found about 14 m/hPa at about
  1.5 km MSL [V], which is the same relation.
- **Rankine vortex in cyclostrophic balance [D]:** core radius R, peak speed V. Outside the core,
  Δp(r) = ρV²R²/(2r²). Inside, Δp(r) = ρV²(1 − r²/(2R²)). The central deficit is ρV².
  - The funnel edge at depth h below the base lies where Δp(r) = ρ g h. If that edge is outside the core, then
    **r_f = R·V/√(2 g h)**. So the funnel is wider than the core near the cloud base and narrows downward (the cone
    shape).
  - The funnel reaches the ground only if **ρV² ≥ ρ g z_base**, that is **V ≥ √(g z_base)**: about 55 m/s for a 300 m
    local base and about 99 m/s for a 1000 m base. This is why the **local lowering (wall cloud) matters** and why
    strong tornadoes under high bases often show only a partial funnel plus a debris cloud.
  - For V = 60 m/s and R = 100 m: r_f ≈ 190 m at h = 50 m, 95 m at h = 200 m, and the funnel tip is at h ≈ V²/g ≈
    370 m. Inside the core the edge is r_f = R·√(2(1 − g h/V²)). So with a 300 m base the funnel reaches the ground
    with a radius of about 0.6 R (60 m).
- **Observations [V]:** at LaGrange the **weak-echo hole (about 600 m) was wider than the visible funnel**. Maximum
  funnel width was about 600 m just below cloud base. **Funnel diameter was not well correlated with vortex
  strength** (Atkins et al. 2012, MWR 140:2939-2958, abstract). Mulhall 1999: RMW 500-1000 m, deficit about 80 hPa at
  50 m (Lee & Wurman 2005) [S]. In-situ probe deficits run from a few hPa to about 100 hPa (Manchester SD 2003, Lee
  et al. 2004) [?].

**Measure in game:** at several heights, measure the visible funnel half-width r_f (screen pixels to metres via the
known distance) against the engine's RMW and V at that height. Check that r_f(h)·√h ≈ R·V/√(2g) (a constant), so the
funnel follows the pressure field and has no painted cone. Check that the funnel reaches the ground only when V² ≳ g
× local base height.

## 5. Debris cloud vs condensation funnel

- Debris and hydrometeors are **centrifuged out of the core within a few tens of seconds** (Dowell et al. 2005,
  cited in Wakimoto et al. 2011) [V]. This makes the weak-echo hole and an annulus of debris at the core edge.
- At LaGrange a debris "inner ring" and higher low-level reflectivity appeared **before** debris was visible in
  photos [V].
- Only about **16 %** of tornadoes have a radar debris signature, more often at higher EF ratings. EF0-1 rarely
  loft enough (Van Den Broeke & Jauernic 2014, JAMC 53:2217) [V abstract]. Debris has been tracked to **5.5-6.5 km**
  in violent tornadoes [S, from debris-fallout summaries]. TDS height rises with updraft strength [S].
- Visually (Moore and Prospect Valley clips) [M, qualitative]: the ground debris whirl is **wider than the funnel
  (about 1.5-3x)** and **low (tens to about 150 m)** for weak or young tornadoes. In strong tornadoes the debris
  sheath can hide the funnel bottom.

**Measure in game:** ratio of debris-cloud width to funnel width at the ground (target about 1.5-3) and debris top
height (target about 20-150 m for EF0-1, several hundred metres to a kilometre or more of visible sheath for
strong tornadoes). Debris should drift outward at about a few m/s and fall out on 10-60 s timescales.

## 6. Rope-out / decay

- **Waterspouts (Golden 1974; NWS Key West) [V]:** 5 stages. Lifetime **2-20 min** (typically 5-10). The decay stage
  is **often abrupt** and **very tilted**. It is triggered when cool rain-cooled outflow undercuts the inflow.
- **Supercell tornadoes [V]:** dissipation is tied to the **occlusion downdraft and RFD surges** that tilt and
  stretch the vortex away from its parent updraft. One case shows circulation weakening over about **3 min**
  (Thiem et al. SLS 2012). Rapid-scan X-band shows a two-phase dissipation (internal RFD surge) in a 2016 Oklahoma
  tornado.
- **Union City [S]:** width shrank from **290 m to 60 m** in the late stage, with a funnel that tilted northeast and
  then southeast. Total life was 26 min.
- **Prospect Valley clip [M]:** the narrowing, bent and tilted rope stage takes about 1/3 of the visible life. The
  funnel stretches into a near-horizontal trunk downshear before breaking up. Disappearance is from the bottom up.
- **Typical rope-out duration [?, chaser consensus, not a paper]:** **1-5 min** from rope stage to dissipation. Tilt
  grows to **30-70° from vertical**, width falls to **10-30 % of mature width**, and the funnel often stays brightest
  and most coherent near cloud base while the lower part becomes broken and translucent.

**Measure in game:** over the last few real minutes of a tornado's life, log funnel width at mid-height, the tilt
angle (line from ground contact to cloud-base attachment) and the fraction of the column that is visible. Expect
monotonic narrowing, rising tilt, then loss from the bottom up. The tilt should follow the ground-contact point
being carried by the outflow away from the updraft (from the fields, not a scripted bend).

## 7. Brightness and contrast (lighting)

- **[M] Front-lit (sun or diffuse light behind the camera, dark rain behind the tornado), Prospect Valley:**
  funnel grey level **137** vs rain shaft **96** vs cloud base **126** (sRGB 0-255, mean of small boxes).
  **The funnel is brighter than its background, Weber contrast about +0.4.**
- **[M] Backlit / flat (bright rain curtain or sky behind), Southern Indiana:** tornado **148** vs rain curtain
  **186** and sky **167**. **The tornado is darker than its background, Weber contrast about −0.1 to −0.2.**
- **[M] Backlit wall cloud, tail cloud:** the cloud is near-black against a very bright horizon slot.
- Rain-wrapped/HP (El Reno): very low contrast, so the vortex is seen mainly as **brighter** sub-vortex columns where
  light comes through thinner rain.
- The funnel's grey level comes from the condensate (white, forward-scattering when backlit) plus dust and debris
  (dark, brown, red), plus airlight from distance. Haze cuts contrast with distance roughly as **exp(−D/L)**, with
  L of a few km in rain. [D]
- Literature values were not found (gap). The measured numbers above are single-frame spot values from compressed
  video and are good only as a sign and rough size.

**Measure in game:** use the same boxes. Average screen luminance of the funnel against the immediately adjacent
background, in a front-lit view (sun behind the camera) and a backlit view. Pass if the sign flips correctly
(front-lit funnel brighter than rain behind it, backlit funnel darker than the sky) and |Weber contrast| is about
0.1-0.5 at 2-5 km, falling with distance and rain.

---

## Sources

- Hoecker, W. H., 1960: Wind speed and air flow patterns in the Dallas tornado of April 2, 1957. MWR 88, 167-180.
  Also WB Research Paper 41: https://library.oarcloud.noaa.gov/noaa_documents.lib/NOAA_historic_documents/WB/Research_papers/WB_Research_Paper_41.pdf
- Golden, J. H., and D. Purcell, 1978: Life cycle of the Union City, Oklahoma tornado and comparison with
  waterspouts. MWR 106, 3-11. Summary: https://en.wikipedia.org/wiki/1973_Union_City_tornado
- Golden, J. H., 1974: Life cycle of Florida Keys' waterspouts. NOAA: https://repository.library.noaa.gov/view/noaa/17641 ;
  NWS Key West waterspouts: https://www.weather.gov/key/Waterspouts
- Wakimoto, R. M., N. T. Atkins, J. Wurman, 2011: The LaGrange tornado during VORTEX2. Part I (MWR 139); conference
  version: https://ams.confex.com/ams/pdfpapers/175265.pdf
- Atkins, N. T., et al., 2012: The LaGrange tornado during VORTEX2. Part II. MWR 140, 2939-2958.
- Atkins, N. T., et al., 2014: Observations of wall cloud formation in supercell thunderstorms during VORTEX2. MWR 142;
  extended abstract: https://ams.confex.com/ams/36Radar/webprogram/Manuscript/Paper228339/36th-radar-conf-ext-abs-4ap2-atkins.pdf
- Lee, W.-C., and J. Wurman, 2005: Diagnosed three-dimensional axisymmetric structure of the Mulhall tornado on
  3 May 1999. J. Atmos. Sci. 62.
- Van Den Broeke, M. S., and S. T. Jauernic, 2014: Spatial and temporal characteristics of polarimetric tornadic
  debris signatures. JAMC 53, 2217-2231. https://digitalcommons.unl.edu/geosciencefacpub/422
- AMS Glossary: Wall cloud; Dynamic pipe effect. https://glossary.ametsoc.org/wiki/dynamic-pipe-effect/
- Thiem et al., 2012 (SLS handout, occlusion and dissipation): https://ams.confex.com/ams/93Annual/webprogram/Handout/Paper224800/Thiem_SLS_2012.pdf
- Lee, J. J., et al., 2004 (Manchester SD in-situ pressure drop about 100 hPa) [?, not rechecked this session].
