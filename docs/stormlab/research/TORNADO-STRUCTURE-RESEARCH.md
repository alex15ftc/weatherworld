# Tornado structure: positions, sizes, heights, winds and motion

Research brief, 2026-10-30. It covers what the storm lab and engine need to place and draw a tornado: wind field, pressure and condensation funnel, size and shape, position under the parent storm, debris, time scales, and a summary table by EF rating.

It builds on `docs/tornado-physics/README.md` (wind maths in `WindField.luau`) and `docs/tornado-physics/DEBRIS-CLOUD.md`, and does not repeat their tables. Section 9 lists where this brief agrees or disagrees with them.

**Confidence tags** (the same idea as DEBRIS-CLOUD.md):
- **[E] established:** peer-reviewed, or several independent sources agree.
- **[L] lab or LES:** shown in vortex chambers or large-eddy simulations, not yet well measured in real tornadoes.
- **[D] derived here:** our own calculation from established formulas or data, such as the SPC database statistics in section 3.1 and the funnel maths in section 2.
- **[G] guess:** a rough range for tuning by eye.

**Units:** ρ = 1.15 kg m⁻³ (warm, humid Plains air near the ground) unless stated. 1 hPa = 100 Pa. V_c is the axisymmetric peak swirl speed and r_c the radius of maximum wind (RMW). V_t is the translation speed and V_g the ground-relative wind.

---

## 1. Wind field

### 1.1 Tangential profile v(r)

| Model | v(r) | Notes |
|---|---|---|
| Rankine combined vortex | v = V_c·r/r_c for r ≤ r_c; v = V_c·r_c/r for r > r_c | Solid-body core and a potential-flow tail. Kinked at r_c, and the tail is too broad. [E] |
| Modified Rankine (MRCV) | as above, but v = V_c·(r/r_c)^(−α) outside, α ≈ 0.5–0.8 (0.6 typical) | The standard fit to Doppler data (Brown & Wood; Wood & Brown; Refan et al. 2017). [E] |
| Burgers–Rott | v = (Γ/2πr)·[1 − exp(−r²/r₀²)]; r_c ≈ 1.121·r₀; V_c ≈ 0.638·Γ/(2πr₀) | An exact viscous one-celled solution: u = −a·r, w = 2a·z, and r₀ = √(2ν/a), where ν is an eddy viscosity in a real tornado. The updraft grows without limit with height. [E] |
| Sullivan | two-celled solution with a central downdraft | The radial structure needs numerical evaluation. [E] |
| Vatistas (n) | v = V_c·2^(1/n)·R / (1 + R^(2n))^(1/n), with R = r/r_c | n = 2 gives a close match to Burgers–Rott. Its tail is always 1/R. [E] |
| Wood & White 2011 | v/V_c = R^λ / [(1 − λ/κ) + (λ/κ)·R^(κ/η)]^η | Used in our `WindField`, with λ = 1, κ = 1.6, η = 0.5 (section 9). [E] |

**Deriving Burgers–Rott:** dv/dr = 0 gives 1 + 2x = e^x with x = r²/r₀², so x = 1.2564 and r_c = 1.1209·r₀. Then v(r_c) = (Γ/2πr_c)·(1 − e^(−1.2564)) = 0.7153·Γ/(2πr_c).

**Core radius versus radius of maximum wind:**
- For Rankine and MRCV they are the same thing.
- For Burgers–Rott, r_c (the RMW) is 1.12·r₀.
- DOW papers quote the "core diameter" ΔX as the distance between the peak inbound and peak outbound Doppler velocities, so ΔX ≈ 2·r_c, blurred by the beam.
- Alexander & Wurman define it as twice the radius of maximum axisymmetric vorticity.

**Measured core sizes and speeds (DOW):**

| Quantity | Value | Source |
|---|---|---|
| Core diameter ΔX, median | ~300 m (r_c ≈ 150 m), from 2239 scans below 500 m AGL | Alexander & Wurman. [E] |
| Core diameter ΔX, range | 20 m to more than 2000 m | Wurman & Kosiba 2013. [E] |
| Velocity difference ΔV across the core, median | 80–90 m s⁻¹ (52 tornadoes, below 500 m); up to more than 220 m s⁻¹ | Alexander & Wurman. [E] |
| Peak ground-relative wind, median | 55–60 m s⁻¹, peak ~130 m s⁻¹ | Alexander & Wurman. [E] |
| Size versus intensity | "Effectively uncorrelated" in DOW data; strongest tornadoes cluster at the smaller of two preferred scales; RMW inversely related to speed in one 2013 study | Alexander & Wurman; Alexander (2010). [E] |
| Mulhall 1999 (F4), RMW | 500–1000 m; peak axisymmetric v ≈ 84 m s⁻¹; two-celled; computed S ≈ 2–6 | Lee & Wurman 2005. [E] |
| Mulhall 1999, damage width | Cross-track width of damaging winds (V_g > 30 m s⁻¹) more than 4.5 km; ΔX ≈ 1600 m, ΔV > 200 m s⁻¹ | Wurman & Kosiba 2013. [E] |
| El Reno 2013 | Largest recorded: EF0-wind width ≥ 4.2 km (2.6 mi); RaXPol saw more than 135 m s⁻¹ within ~150 m AGL in small sub-vortices moving at more than 75 m s⁻¹ | NWS OUN; Thiem/Bluestein. Damage was EF3 (rated EF5 on radar, then returned to EF3). [E] |

The size–intensity result matters: **do not derive r_c from the EF rating alone.** Width and intensity are only loosely linked. Damage width rises with EF (section 3.1), but much of that is because a stronger vortex pushes the 29 m s⁻¹ contour further out.

### 1.2 Vertical structure and the corner flow

**Layers.** A tornado has three layers [E/L]:
- the **surface inflow layer**, where friction breaks cyclostrophic balance;
- the **corner**, where the inflow turns upward;
- the **core aloft**, nearly in cyclostrophic balance.

**Why near-ground winds exceed those aloft.** Friction slows the swirl near the ground. That breaks cyclostrophic balance, and the uncompensated pressure gradient drives strong inflow. Inflow air keeps much of its angular momentum and gets closer to the axis than air aloft can, so it spins faster (v = M/r).

**How much faster:**
- **LES:** Lewellen et al. 2000 found that near-surface swirl reaches about **2.5× the swirl aloft** when the local corner-flow swirl ratio S_c lies in a narrow critical range near ~1–1.5. Below that range there is little intensification, and it sits off the surface. Above it, intensification moves into secondary vortices. [L]
- **Steady limit:** Lewellen & Lewellen 2006 showed that conservation of mass, angular momentum and vertical momentum limit the steady ratio to **about 2**. [L]
- **Observations:** Kosiba & Wurman 2023 (73 DOW tornadoes, 1999–2009) found the strongest instantaneous winds at the lowest levels sampled. At 15 m they were about **30% stronger** than at more than 100 m AGL. [E]
- **Simulations agree:** Nolan's 2025 comment reports that his LES gives the strongest azimuthal- and time-averaged winds at 30–70 m AGL, but the strongest instantaneous winds below 20 m. [E/L]

**Inflow layer depth:**
- Radial inflow is concentrated in the lowest **~10–100 m** and is generally said to be under 200 m. [E/L]
- DOW divergence below 50 m is biased divergent. Alexander & Wurman read this as a sign of very shallow inflow, O(10 m), below the lowest radar beam, and/or a two-celled core. [E]
- Kosiba & Wurman (Russell, KS, 2012), sampling from 3.5 to 36 m AGL, found a shallow inflow layer, wind speed nearly independent of height, and the core switching between one and two cells. [E]
- On a 1-m pod the winds were only 50–60% of the DOW winds, so the speed falls off sharply in the lowest few metres. [E]

**Radial inflow speed:**
- In the corner it is comparable to the swirl: LES gives u ≈ 0.5–1·V_c within a few tens of metres of the ground. [L]
- Above the inflow layer it is about 0.1–0.2·V_c. [L]
- DOW: the horizontal divergence across the core is usually an order of magnitude smaller than the vorticity, from −0.05 to +0.14 s⁻¹. Vorticity is 0.2–1.2 s⁻¹, rarely up to ~10 s⁻¹. [E]

**Vertical motion:**
- **One-celled (low swirl):** a central updraft jet that, in LES, reaches the same order as V_c a few hundred metres up. [L]
- **Two-celled:** a central downdraft of roughly −5 to −20 m s⁻¹, and an annular updraft at ~0.6–0.8·r_c of roughly +10 to +30 m s⁻¹. These are model and lab ranges; DOW retrievals show the same pattern (Mulhall: central downdraft and annular updraft at the RMW). [E pattern / L numbers]

**Core radius with height:** the core widens slowly upward, typically 20–50% from near the ground to ~1 km. For example, Wurman 2002 gave a core diameter of ~500 m at 250 m AGL and ~700 m at 1000 m AGL. [E]

**Low-level speed with height:** the time- and tornado-averaged intensity is nearly constant through the lowest few hundred metres (Alexander 2010). Variability near the ground (below 200 m) is far greater than in the mesocyclone flow above 1 km. [E]

### 1.3 Swirl ratio: definitions and stages

Several definitions are in use, and their numbers are not interchangeable.

**1. Chamber swirl ratio** (Ward-type chamber; Davies-Jones 1973; Church et al. 1979):

S = r₀·Γ / (2Q) = tan θ / (2a), with a = h/r₀.

- r₀ is the updraft (exhaust) radius, h the inflow depth, Γ = 2π·r₀·v₀ the circulation of the inflow, Q the total volume flow through the updraft, and θ the inflow vane angle.
- With mass continuity (2π·r₀·h·u₀ = π·r₀²·W̄), this reduces to **S = v₀ / W̄**: the swirl at the updraft edge over the mean updraft speed. That is the most intuitive form for a game.
- Some papers write S = Γ·r₀ / (2Q·h), with Q per unit axial length (Nolan & Farrell 1999). It is the same quantity.

**2. Corner swirl ratio** (Lewellen et al. 2000):

S_c = r_c·Γ∞² / Υ.

- Γ∞ is the circulation outside the core, r_c = Γ∞ / V_c a core length scale, and Υ the flux of angular-momentum-depleted fluid through the corner.
- It measures how much low-momentum fluid the corner has to swallow. Peak near-surface intensification occurs at S_c ≈ 1–2 (≈1.2 is quoted).
- S_c is roughly 3× the chamber S (DEBRIS-CLOUD.md). The exact formula and the 1.2 value come from secondary sources; check the paper before tuning. [L]

**3. Field and radar estimates** (Refan et al. 2017; Lee & Wurman 2005): S is computed from the circulation at r_c and an updraft estimated from mass continuity. These give larger numbers; Mulhall came out at S ≈ 2–6.

**Stage sequence with rising S** (Church et al. 1979; Rotunno 1979; Refan & Hangan WindEEE; Refan et al. 2017). The thresholds move by about ×2 with chamber aspect ratio and definition. [E/L]

| S (chamber) | Structure |
|---|---|
| < ~0.1 | Laminar, one-celled; no intense vortex at the surface; strong central updraft jet |
| ~0.1–0.45 | A vortex-breakdown bubble appears aloft and moves down as S rises; above it the core widens and turns turbulent |
| ~0.45 | The breakdown reaches the surface ("touchdown", "drowned vortex jump"). Peak near-surface intensification is near here (Fiedler & Rotunno 1986; Lewellen's critical S_c) |
| ~0.5–1 | Two-celled: a central downdraft reaches the ground, an annular updraft forms, and the core widens. Refan et al. 2017 put two-celled field vortices at 0.8 < S < 1.4 |
| ~1–2+ | Multiple vortices: 2, then 3, up to ~6 sub-vortices as S rises; the core keeps widening |

Of nine radar volumes from five field tornadoes, Refan et al. 2017 found 2 one-celled, 1 with a breakdown bubble and 4 two-celled.

**Surface roughness acts like lower swirl** (WindEEE). It raises S_c by feeding more depleted fluid into the corner, which pushes the flow toward the one-cell jet. Smooth, wet or flat ground gives a stronger, lower, more multi-vortex corner. [L]

**Thermodynamic speed limit:** V_max ≈ √(2·CAPE), from a hydrostatic, moist-adiabatic core (AMS Glossary). Real and simulated tornadoes exceed it:
- Fiedler & Rotunno 1986: a steady end-wall vortex reaches ~1.7× the limit.
- Fiedler 1998 / 1994: transient cases reach up to ~5× in axisymmetric models.
- Nolan LES: 21% higher for a large, high-swirl vortex and 59% for a small, low-swirl one.

So CAPE does **not** cap tornado winds. [E/L]

### 1.4 Translation and asymmetry

- **Ground-relative wind:** the vortex-relative wind plus the translation vector. In the Northern Hemisphere, with cyclonic rotation, the strongest winds are on the **right of the track** (V_c + V_t) and the weakest on the left (V_c − V_t). [E]
- **Inflow tilts the peak:** surface inflow rotates the near-ground peak toward the front-right. [L]
- **Typical DOW numbers:** median V_t = 13.5 m s⁻¹, with 25th–75th percentiles of 9 and 18 m s⁻¹ and extremes from ~0 to more than 25 m s⁻¹ (Alexander & Wurman; Wurman & Kosiba 2013, footnote 6). [E]
- **Worked example:** a ΔV = 40 m s⁻¹ vortex moving at 13.5 m s⁻¹ has right-side peak winds of ΔV/2 + V_t = 33.5 m s⁻¹. That is above the EF0 threshold, so translation alone can decide whether a marginal vortex does damage. [E]
- **Fast tornadoes:** the Mayfield 2021 EF4 averaged ~25 m s⁻¹ (56 mph), and Guin 1974 (F5) ~33 m s⁻¹ (75 mph). The often-quoted "30 mph average, stationary to 70 mph" is an outreach figure; the DOW median of ~30 mph agrees with it. [E]
- **Translation and intensification:** in Lewellen's LES, translation makes the inflow lopsided and changes S_c, so it can either help or hurt near-ground intensification. [L]

---

## 2. Pressure deficit and the condensation funnel

### 2.1 Cyclostrophic balance

Away from the friction layer the core is in cyclostrophic balance:

dp/dr = ρ·v²/r,  so  Δp(r) = p∞ − p(r) = ρ·∫ᵣ^∞ v(r′)²/r′ dr′.

**Rankine** (exact):
- r ≥ r_c: Δp(r) = ½·ρ·V_c²·(r_c/r)²
- r ≤ r_c: Δp(r) = ρ·V_c²·(1 − r²/(2r_c²))
- Central deficit: **Δp₀ = ρ·V_c²**, half of it across the core and half outside. [E]

**MRCV with exponent α:**
- Outside: Δp(r) = (ρ·V_c²/2α)·(r_c/r)^(2α)
- Inside: Δp(r) = ρ·V_c²·[1/(2α) + (1 − r²/r_c²)/2]
- Central deficit: Δp₀ = ρ·V_c²·(½ + 1/(2α)) = **1.33·ρ·V_c² for α = 0.6**. [D]

**Our Wood & White profile** (λ = 1, κ = 1.6, η = 0.5): integrating numerically gives Δp₀ = **2.06·ρ·V_c²**, the same value README §1.5 gives. It is larger because this profile is broader than MRCV (v/V_c = 0.75 at R = 0.5 and 0.81 at R = 2, against 0.50 and 0.66 for MRCV). [D]

**Burgers–Rott:** Δp₀ ≈ 1.2·ρ·V_c² (numerical). [D]

**Sizes, Rankine** (ρ = 1.15):

| V_c (m s⁻¹) | Δp₀ (hPa) |
|---|---|
| 30 | 10 |
| 50 | 29 |
| 70 | 56 |
| 90 | 93 |

**Measurements:**
- Manchester, SD, 24 June 2003 (F4): Tim Samaras' probe recorded about **100 hPa**. That is consistent with V_c ≈ 80–95 m s⁻¹. [E]
- Other in-situ probe deficits run from a few hPa to tens of hPa, often 20–60 hPa (Karstens et al. 2010, WAF; not re-checked here). [E range]
- The deficit near the ground can exceed the cyclostrophic value for the swirl aloft, because of corner-flow dynamics (§1.2). [L]

### 2.2 Where the funnel edge sits

Air entering the vortex expands nearly adiabatically as its pressure falls, so it cools as T ∝ p^(R/c_p). It condenses where the pressure has fallen to the pressure of its lifting condensation level. The **funnel boundary is therefore the isobar p(r, z) = p_LCL** (SPC "no funnel" FAQ; Wikipedia/Stull "funnel cloud"). [E]

The deficit needed at height z, using the local base height z_b:

Δp_need(z) = p_env(z) − p_LCL ≈ p_env(z)·[1 − (T_LCL/T(z))^(c_p/R_d)] ≈ ρ·g·(z_b − z),

with c_p/R_d = 3.5, z_LCL ≈ 125 m × (T − T_d) and T_LCL ≈ T − 9.8 K km⁻¹ × z_LCL. The rule of thumb is about **11 hPa per 100 m of cloud-base height** [D]:

| z_b (m) | Δp_need at the ground (hPa, T = 300 K) |
|---|---|
| 250 | 28 |
| 500 | 56 |
| 750 | 83 |
| 1000 | 110 |
| 1500 | 161 |
| 2000 | 211 |

### 2.3 Funnel radius and length

Write the deficit as Δp(r, z) = ρ·V_c(z)²·f(r/r_c(z)), and define D(z) = g·(z_b − z) / V_c². Then [D]:
- the funnel radius is **r_f(z) = r_c·f⁻¹(D(z))**;
- the funnel tip is where D = f(0), so the funnel hangs a length **L = f(0)·V_c²/g below the base**.

Inverses:
- Rankine (f(0) = 1): r_f = r_c·√(2(1 − D)) for ½ ≤ D < 1; r_f = r_c/√(2D) for D < ½.
- MRCV: r_f = r_c·√(1 − 2(D − 1/(2α))) for 1/(2α) ≤ D < f(0); r_f = r_c·(2αD)^(−1/(2α)) for D < 1/(2α).

**Funnel length below the base** (Rankine to MRCV 0.6):

| V_c (m s⁻¹) | L (m) |
|---|---|
| 20 | 41–54 |
| 30 | 95–126 |
| 40 | 176–234 |
| 55 | 292–389 |
| 70 | 464–619 |
| 80 | 677–903 |

**What falls out of this:**
1. **The funnel flares at cloud base.** As z → z_b, D → 0, so r_f grows without limit. In reality it merges into the lowering or wall cloud, giving the familiar flared top. [D]
2. **A cone shape appears naturally.** Inside the core, r_f ∝ √(1 − D(z)) shrinks toward the tip. A tall, thin taper means D(z) rises steeply: a high base or a weak vortex. [D]
3. **Stovepipe and wedge.** If D(0) ≲ 1/(2α) (a low base and a strong vortex), the funnel at the ground is at or wider than r_c and its sides are near-vertical: a stovepipe, or a wedge when r_c is large. [D]
4. **Why many tornadoes are not condensed to the ground** (SPC FAQ: too little pressure drop and/or dry sub-cloud air):
   - With the environmental LCL, an EF2–EF3 vortex (V_c 40–55 m s⁻¹) only condenses 0.2–0.4 km below the base. A 1–1.5 km Plains LCL then gives a partial funnel over a **dust whirl**.
   - Reaching the ground with a 1000 m base needs V_c ≈ 87 m s⁻¹ (MRCV) or 100 m s⁻¹ (Rankine). [D]
5. **Why condensed funnels still reach the ground in reality.** Observations disagree with naive point 4: many EF1–EF3 tornadoes are condensed to the ground. The reasons [E qualitative / D numbers]:
   - **The local base is much lower than the environmental LCL.** The wall cloud forms from rain-cooled, nearly saturated forward-flank and RFD air, often several hundred metres lower. The mesocyclone's own deficit (a few hPa) lowers it further.
   - **Real near-ground winds exceed the damage rating.** DOW median V_g is 55–60 m s⁻¹, and damage ratings are biased low.
   - **The corner-flow deficit near the ground is larger than cyclostrophic balance of the swirl aloft.**
   - **The lowest part of the "funnel" is often a debris or dust sheath.**

   **For the game:** compute the funnel from the **local (wall-cloud) base**, not the environmental LCL. Accept partial funnels plus a dust whirl when the base is high or the vortex weak.

**Measured funnel widths:**
- Intense tornadoes have condensation funnels from ~100 m to ~2 km across (Lee & Wurman 2005 intro). [E]
- The RMW usually lies **at or outside** the visible funnel; in one case the funnel was ~70–75 m wide at cloud base, against a larger radar core. [E]

**Low-LCL climatology:** Rasmussen & Blanchard 1998 and Thompson et al. 2003 found **LCL height the best single discriminator** between supercells with significant tornadoes and those without. Significant-tornado supercell mixed-layer LCLs are mostly 750–1250 m, about half those of non-tornadic supercells (Edwards & Thompson 2000). Low LCLs also mean less cold RFD air. [E]

---

## 3. Size and shape

### 3.1 Damage width and path length (SPC database, our own statistics) [D from E data]

Computed here from the SPC `1950-2024_actual_tornadoes.csv`, using whole tracks only (`sg = 1`), for the EF era 2007–2024 (n = 21,239). Width is the surveyed **maximum** path width; reports switched from mean to maximum width around 1994–95.

| EF | Share | Length p10 / median / mean / p90 (km) | Max width p10 / median / mean / p90 (m) |
|---|---|---|---|
| 0 | 52.0% | 0.1 / 1.1 / 2.5 / 6.7 | 18 / 46 / 63 / 137 |
| 1 | 36.1% | 0.8 / 4.6 / 7.0 / 15.9 | 46 / 114 / 189 / 411 |
| 2 | 9.1% | 2.2 / 10.7 / 14.9 / 32.0 | 91 / 274 / 383 / 805 |
| 3 | 2.3% | 6.4 / 21.3 / 29.4 / 63.0 | 183 / 549 / 722 / 1463 |
| 4 | 0.4% | 14.2 / 38.2 / 56.1 / 114 | 366 / 823 / 1073 / 1770 |
| 5 | 9 cases | 22 / 59 / 72 / 102 | 823 / 1609 / 1636 / 2012 |

- **Older F-scale data:** 1995–2006 widths are about 30–40% smaller at every rating (for example, F3 median 366 m). Part of that is survey practice.
- **Elsner et al. 2014:** intensity rises ~17% per km of width and ~25% per 100 km of length. Width explains 37% of the variance in EF rating and length 30%.
- **The spread within one rating is huge.** Use these as distributions, not fixed values.

**Damage width from the wind field.** Damage edge = where V_g falls to 29 m s⁻¹ (EF0). With MRCV and translation:

W ≈ r_c·[((V_c + V_t)/29)^(1/α) + ((V_c − V_t)/29)^(1/α)].

Inverting the median widths, with V_t = 13.5 and V_c + V_t = the middle of the EF band, gives r_c [D]:

| EF | r_c, α = 0.6 (m) | r_c, α = 0.5–0.8 (m) |
|---|---|---|
| 0 | 30 | 30–32 |
| 1 | 44 | 39–50 |
| 2 | 71 | 60–86 |
| 3 | 96 | 76–126 |
| 4 | 98 | 73–142 |
| 5 | 140 | 100–220 |

So damage width is about **1.5× r_c (EF0) rising to ~11× r_c (EF5)**. Width grows with rating mostly through the reach of the 29 m s⁻¹ contour, not through r_c, which matches the DOW finding that size and intensity are nearly uncorrelated.

These r_c values sit below the DOW median (~150 m). Two reasons: survey widths of weak tornadoes are under-sampled (few damage indicators), and DOWs sample the larger Plains tornadoes.

**Recommendation:** draw r_c from a log-normal with a median of ~100–150 m and σ_ln ≈ 0.7, only weakly tied to EF. [G]

### 3.2 Height and cloud base

- **Cloud base:** environmental LCL is ~500–2000 m (low in the Southeast and humid Plains, high on the High Plains). The wall-cloud base is often several hundred metres lower, and wall clouds are from under 1.6 km to more than 8 km across (Wikipedia "Wall cloud"). [E]
- **Vortex depth:** the tornado vortex runs from the ground into the mesocyclone, 1 to several km. DOW and mobile radar find tornado-scale circulations several km deep. Genesis often contracts at the same time through ~1 km of depth, neither top-down nor bottom-up (Alexander & Wurman; French et al.). [E]
- **Visible funnel:** from the base down by L ≈ f(0)·V_c²/g (§2.3), using the local base. [D]

### 3.3 Shape classes and what produces them

| Shape | Look | Physical recipe | Confidence |
|---|---|---|---|
| **Rope** | Thin (tens of m), long, tilted or contorted | Small r_c and V_c, often late in life; vortex stretched and tilted by outflow (RFD or cold pool) pushing the base away from the parent circulation | [E] |
| **Cone** | Wide at base, tapering, tip at or near the ground | Moderate V_c with base height z_b ≈ L, so D(z) rises over the column; tapering r_f ∝ √(1 − D) | [E look / D maths] |
| **Stovepipe** | Near-uniform cylinder, sharp edges | D(0) ≈ 1/(2α): strong vortex, low local base; r_f ≈ r_c over most of the depth; often a mid-swirl one- to two-celled state | [D] |
| **Wedge** | Wider than tall, often more than 0.8 km, ragged | Large r_c (several hundred m to more than 1 km), very low base, two-celled or high swirl; often rain-wrapped in humid low-LCL settings | [E look / D] |
| **Multiple-vortex** | 2–6+ sub-vortices orbiting a common centre, under a translucent or absent main funnel | High swirl (S ≳ 1); sub-vortices of tens of metres; strongest damage in narrow swaths | [E] |
| **Dust whirl / "invisible"** | Ground debris whirl under a funnel stub or none | Base too high or air too dry for D(0) < f(0); common at High Plains LCLs | [E] |

**Multiple-vortex details:**
- Sub-vortex diameters are typically tens of metres; one Harper, KS, central vortex was ~21 m across. [E]
- At Mulhall, sub-vortices were ~250 m apart. [E]
- El Reno had at least two dozen resolvable sub-vortices, moving at more than 75 m s⁻¹. [E]
- They add short peaks above the rating: about 115 m s⁻¹ at Mulhall, and 135 m s⁻¹ at El Reno from RaXPol. [E]

### 3.4 Tilt and lean

- **Highly variable.** Tilt varies greatly with height and time. Most mobile-radar tornadoes are noticeably tilted; tilt has been compared with the hodograph (Greenwood thesis) and is persistent near the LFC (Griffin et al. 2019). French et al. 2014 found no link between tilt and intensity. [E]
- **Radar artefacts.** Part of the apparent tilt in radar data comes from scanning a moving vortex (Bluestein et al. 2003, Happy, TX). [E]
- **Mechanism:** the near-ground circulation is carried by low-level (RFD or outflow) flow, while the top is tied to the mesocyclone moving with the storm. When the RFD surges, the base is pushed forward or out ahead, and the vortex leans back toward the parent updraft with height.
  - Mature tornadoes: typically lean 10–30° from vertical. [G]
  - Rope stage: leans up to 45–70°, stretched over a horizontal length of 1–3 km or more. [G]
- **In MWR-05XP data, TVSs decay first at 2–3 km,** then quickly upward and slowly downward. [E]

---

## 4. Position relative to the parent storm

**Standard picture** (Lemon & Doswell 1979; Markowski 2002 review):
- The tornado forms under the wall cloud, at the tip of the hook echo, near the **occlusion point** where the RFD gust front wraps cyclonically around the low-level mesocyclone.
- That is near the RFD–FFD junction (the triple point lies further out along the boundaries), at the right-rear flank of the updraft. [E]

**Broyles et al. (SPC; 208 supercells producing EF3–EF5):**
- An RFD surge starts ~13 min before the tornado; an occlusion follows ~10 to ~5 min before. [E]
- **96.6% of tornadoes formed well inside the RFD** (more than 0.25 nmi behind the boundary). Only 3.4% formed within 0.25 nmi of it. [E]
- **Most frequent start point:** ~3.1 km (1.65 nmi) west and ~2.0 km (1.07 nmi) south of the RFD boundary's apex (the gust-front nose), with an axis of high incidence running southwest across the RFD's northeast quadrant. [E]
- The occlusion usually moved **southwest relative to the RFD**. [E]

**Distance from the mesocyclone centre:**
- The tornado sits inside the low-level mesocyclone, which is ~1.6–10 km across (Wikipedia). It is usually within ~0.5–2 km of the low-level mesocyclone centre. [E/G]
- During occlusion, the tornado and meso centre come together while the RFD wraps around them. [E]
- Relative to the main updraft core or precipitation-free base, the tornado is on the rear (west to southwest) side, under the clear slot's leading edge. [E]

**Rain-wrapping:**
- The forward-flank core lies ~3–10 km north and northeast. [G]
- The hook's precipitation curtain wraps around the tornado from the west and south as the occlusion matures. Tornadoes in HP supercells, or late in life, are often hidden by rain. [E]

**Motion relative to the storm:**
- **Early to mature:** the tornado moves roughly with the mesocyclone, often slightly right of the storm motion. [E]
- **Occlusion and decay:** the tornado moves left and back relative to the storm, into the cool RFD air, while a new mesocyclone or updraft forms to the east or southeast on the advancing gust front (cyclic tornadogenesis, Dowell & Bluestein 2002). [E]
- **Sharp left turns** of 30–55° happen with major internal rear-flank surges, often but not always as the tornado dies (Weather and Forecasting study of three supercells, NSF PAR 10425533). [E]
- **Left-moving mesocyclones:** in 102 cases of left-deviant low-level meso motion, ~25% left the warning polygon. [E]
- Hooked damage paths at the end of a track (for example Greensburg 2007) are the ground signature of this. [E]

**Satellite tornadoes:** separate, smaller vortices in the same mesocyclone that orbit the main tornado. In one DOW case a satellite with ΔV = 45 m s⁻¹ sat 0.9 km east of the main tornado. [E]

**Anticyclonic vortices:**
- They are found along the RFD gust front and in the hook, often on the south or southeast side, as the anticyclonic member of a vortex pair, or ~1–3 km from the main tornado.
- Examples: Jewell, KS, 2008; Stratford, TX; the satellite of El Reno 2013. [E]

---

## 5. Debris cloud and dust

DEBRIS-CLOUD.md covers the appearance types and the Lewellen/Gong controls (S_c, A_a = V²/(r_c·g), A_v = V/w_t). New numbers:

**Before condensation:** a ground-level dust whirl appears when the wind at 2 m exceeds ~6 m s⁻¹ over bare dry soil (3.5–11 m s⁻¹ depending on moisture), which is almost always. It is commonly 50–300 m across and tens of metres to ~100–300 m tall, under a lifted funnel. [E/G]

**Debris cloud size:**
- **Radius:** ~1.5–4·r_c. DOW and LES both show a centrifuged, hollow cloud (a weak-echo hole ringed by debris; Dowell et al. 2005). [E/L]
- **Visible height:** ~0.3–1.5·r_c for the collar; the fine-dust sheath can climb most of the way to cloud base. [L]
- **Growth:** it builds over ~2 min and peaks after the intensity peak. [L]

**Lofted debris from the radar debris signature (TDS):**
- About 16% of tornadoes have a TDS, rising strongly with EF, path length and closeness to the radar. TDS area grows with EF and duration; it is deepest for strong, long-lived, wide tornadoes (Van Den Broeke & Jauernic 2014). [E]
- **Operational rule:** debris lofted to **≥ 10 kft (3 km)** makes a strong or significant tornado increasingly likely (NWS, more than 180 cases). [E]
- **27 April 2011:** debris was often lofted to **5.5–6.5 km**, especially by EF4–EF5 tornadoes (Knox et al. 2013). [E]
- **Extreme:** about 12 km (Magsig & Snow 1998). [E]
- **Typical TDS heights** [E trend / G numbers]:
  - EF0–EF1: under 1–2 km, often no TDS;
  - EF2: 1–3 km;
  - EF3: 2–5 km;
  - EF4–EF5: 4–7 km.

**Debris fallout:**
- Large areas of fallout occur as tornadoes weaken and the updraft can no longer hold debris (Bodine et al. 2013). [E]
- Most heavy debris lands within a few km. Grazulis: only 86 of 12,651 tornadoes had debris reported more than 8 km away. [E]
- Light debris travels tens to 100+ km, landing **to the left of the track** (north) under the mid-level winds:
  - paper from Barneveld landed in a trail up to 37 km wide at 180 km;
  - a >1 lb windbreaker travelled 107 km on 27 April 2011;
  - the record is a photo carried 353 km (Hackleburg–Phil Campbell 2011). [E]

**Game use:** a debris-plume particle layer rising to the TDS height for the rating, drifting downwind with the mid-level wind, raining out fragments. [G]

---

## 6. Time scales and motion

**Lifetimes:**
- Fujita & Forbes (3 April 1974 outbreak, 122 tornadoes): 1–125 min; median 18 min, mean 21 min; 90% under 40 min; the tail above 30 min falls off exponentially. That sample is biased long (an outbreak of strong tornadoes). [E]
- "Tornado families" lived ~5× longer than individual tornadoes. [E]
- Britannica's rough figures: weak ~2–3 min, strong ~8 min, violent ~25 min, rarely more than 3 h. [E-ish]

**Lifetime from path length and speed** (SPC median length ÷ DOW median speed of 13.5 m s⁻¹) [D]:

| EF | Median lifetime |
|---|---|
| 0 | ~1.5 min |
| 1 | ~6 min |
| 2 | ~13 min |
| 3 | ~26 min |
| 4 | ~47 min |
| 5 | ~70 min |

Using p90 lengths gives ~8, 20, 40, 78, 140 and 125 min. Goshen County 2009 (EF2) lived 38 min (Kosiba et al. 2013).

**Path length and translation:** see §3.1 and §1.4. The U.S. mean path is ~8 km (5 mi); the record is the Tri-State tornado at 352 km. [E]

**Rotation:** ~98–99% are cyclonic. Anticyclonic tornadoes are ~1–2%, mostly weak satellites or along the gust front (strongest: West Bend, WI, 1981, F4). [E]

**Life-cycle stages** (Golden & Purcell-style; NWS spotter guides) [E sequence / G durations]:

| Stage | Width and condensation | Tilt | Duration (share of a long-lived tornado) |
|---|---|---|---|
| 1. Funnel / dust whirl | Funnel descends from the wall cloud; dust whirl underneath; condensation partial | Small | 1–5 min (~10%) |
| 2. Organising | Funnel reaches down; intensifying; r_c contracting or steady | Small | 2–10 min (~15%) |
| 3. Mature | Peak V_c and peak width; lowest funnel, often to the ground; largest debris cloud | Near vertical, 10–30° | a few min to more than 1 h (~40–50%) |
| 4. Shrinking | Funnel narrows as the RFD and occlusion cut off inflow; V_c can still be high | Increasing, moving left and rearward | 2–10 min (~15%) |
| 5. Decay / rope | Thin, long, contorted rope; condensation breaks into segments; still damaging | Large, 45–70°, horizontal stretch 1–3 km+ | 1–5 min (~10%) |

Through the life cycle [D from §2]:
- The width at the ground follows r_c, and the condensation length follows V_c²/g.
- **Rope-out:** V_c falls and r_c shrinks. Spinning faster as r_c shrinks (angular momentum) keeps the thin rope condensed for a while, while tilting stretches it, and then it breaks up.

---

## 7. Summary table by EF rating

Tags: **[E]** well supported (EF definitions, SPC statistics, DOW medians); **[D]** derived here; **[G]** estimated. The funnel width assumes the local base sits near the funnel's reach: roughly 400 m for EF2–EF3 and 400–800 m for EF4–EF5.

| | EF0 | EF1 | EF2 | EF3 | EF4 | EF5 |
|---|---|---|---|---|---|---|
| EF 3-s gust at 10 m, ground-relative [E] | 29–38 m s⁻¹ (65–85 mph) | 38–49 (86–110) | 50–60 (111–135) | 61–74 (136–165) | 74–89 (166–200) | > 89 (> 200) |
| Share of tornadoes, 2007–24 [E] | 52% | 36% | 9.1% | 2.3% | 0.4% | 0.04% |
| Axisymmetric V_c (gust − V_t) [D] | ~20 | ~30 | ~42 | ~54 | ~68 | ~80+ |
| Core radius r_c (RMW) [D, G spread] | 20–50 m | 30–80 m | 50–150 m | 75–250 m | 75–400 m | 100–600+ m |
| Central Δp, Rankine to MRCV [D] | 5–6 hPa | 11–14 | 20–26 | 33–44 | 52–70 | 76–100+ (100 measured) |
| Funnel reach below base, L [D] | 40–55 m | 95–125 m | 175–235 m | 290–390 m | 460–620 m | 680–900 m |
| Condensed funnel width at the ground [D/G] | Usually not condensed (dust whirl 20–100 m) | Usually partial; if condensed 20–80 m | Often partial; 50–200 m | 100–400 m | 150–800 m | 200 m–1.5 km (wedge) |
| Max damage width, median (p10–p90) [E] | 46 m (18–137) | 114 m (46–411) | 274 m (91–805) | 549 m (183–1463) | 823 m (366–1770) | 1.6 km (0.8–2.0) |
| Path length, median (p90) [E] | 1.1 km (6.7) | 4.6 km (16) | 10.7 km (32) | 21 km (63) | 38 km (114) | 59 km (102) |
| Debris cloud radius (~1.5–4·r_c) [G] | 30–100 m | 50–200 m | 100–400 m | 150–600 m | 200–1000 m | 300–1500 m |
| Lofted debris (TDS) top [E trend, G numbers] | none | none, or under 1.5 km | 1–3 km | 2–5 km | 4–7 km | 5–7+ km (12 km extreme) |
| Lifetime, median (p90) [D] | ~1.5 min (8) | ~6 (20) | ~13 (40) | ~26 (78) | ~47 (140) | ~70 (125) |
| Translation speed [E] | median 13.5 m s⁻¹ (IQR 9–18, max ~25+) for every rating; no strong EF dependence shown | | | | | |

**Read the table with these caveats:**
- r_c varies roughly ×3 at any rating, and size is nearly uncorrelated with intensity in radar data.
- Damage-based ratings are biased low compared with radar winds.
- Funnel width depends far more on the local base height than on EF.

---

## 8. Takeaways for the engine and lab

1. **Funnel from the local base.**
   - Use r_f(z) = r_c·f⁻¹(g·(z_b − z)/V_c²) with z_b = the wall-cloud base, not the environmental LCL.
   - The cone taper, the stovepipe sides and the flared top then fall out of the maths. The funnel length L = f(0)·V_c²/g is a single, simple check.
2. **Partial funnels plus a dust whirl** should be the normal look for a weak tornado or a high LCL (for EF0–EF1 at bases ≥ 800 m), not a failure case.
3. **Draw r_c independently of EF** (log-normal, median ~100–150 m), so wide-weak and narrow-violent tornadoes both occur.
   - Damage width then follows from the 29 m s⁻¹ contour, about 1.5–11× r_c.
   - The SPC width and length distributions above are the targets for a regression check.
4. **Placement:**
   - Spawn the tornado inside the RFD, ~2–4 km behind the RFD gust-front nose, near the low-level meso centre, at the hook tip and under the wall cloud.
   - Keep the precipitation curtain wrapping from the west and south.
   - As it matures, move it left and rearward relative to the storm.
   - New mesocyclones form ~3–8 km east or southeast on the gust front (cyclic). [E/G]
5. **Tilt:** the base is carried by the low-level outflow, the top by the meso. Tilt = their displacement over the vortex depth, growing into the rope stage.
6. **Translation:** add V_t once; strongest on the right. The DOW median of 13.5 m s⁻¹ is the target.

## 9. Agreement and disagreement with `docs/tornado-physics`

**Agree:**
- MRCV tail α 0.5–0.8.
- A near-ground maximum 10–30% stronger, at 10–50 m; Kosiba & Wurman 2023 measured ~30% at 15 m against more than 100 m aloft. Lewellen allows up to 2–2.5× in the critical corner regime.
- Inflow in the lowest 10–100 m.
- Two-celled downdraft and an annular updraft at ~0.6–0.8·r_c.
- The core widening with height; README's +30% is consistent with Wurman 2002's 500 → 700 m.
- The swirl-ratio stage table.
- The RMW at or outside the visible funnel.
- Right-side strengthening by V_t.
- The EF rating as the ground-relative 3-s gust at 10 m.

**Differences and notes:**
- **Swirl thresholds:** README puts two-cell at 0.45–0.8. Refan et al. 2017 put field two-celled vortices at 0.8–1.4, and radar-derived S for Mulhall is 2–6. These are definition differences; keep README's chamber S, but don't compare it with radar-derived S.
- **Central deficit:** README's 2.06·ρ·V_c² is correct for its Wood & White profile (λ = 1, κ = 1.6, η = 0.5), which I re-integrated. That profile is broader than MRCV (v/V_c = 0.81 at R = 2 against 0.66). So it gives:
  - 55% more central deficit than MRCV (1.33),
  - about twice Rankine (1.0),
  - a funnel reaching ~2·V_c²/g below the base,
  - larger damage width per r_c.

  README's "60–90 hPa at EF3" follows from that factor. With MRCV it would be ~44 hPa; measured EF3-ish deficits are tens of hPa, so the README value is on the high side but plausible. If funnels draw too long or damage too wide, compare against η or against MRCV before blaming other inputs.
- **README §1.7, "damage path 2–5× core diameter":** our SPC inversion gives 0.75–5.7× the diameter (1.5–11× r_c), rising with EF. That is the same picture, with a wider range.
- **README's EF-based default S:** S = 0.2–1.1 by EF is a fair default, but DOW data says intensity and S or size are only loosely linked. Prefer the engine's `swirl`.

---

## Sources

**EF scale and climatology:**
- EF scale (SPC): https://www.spc.noaa.gov/efscale/ef-scale.html (mirror https://origin-west-www-spc.woc.noaa.gov/efscale/ef-scale.html)
- SPC tornado database: https://www.spc.noaa.gov/wcm/data/1950-2024_actual_tornadoes.csv (statistics computed here)
- Elsner, Jagger & Elsner 2014, *Tornado intensity estimated from damage path dimensions*, PLoS ONE: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0107571
- Brooks 2004, *On the relationship of tornado path length and width to intensity*, WAF 19, 310–319 (Weibull fits; full text not retrieved): https://journals.ametsoc.org/view/journals/wefo/19/2/1520-0434_2004_019_0310_otrotp_2_0_co_2.xml
- Fujita & Forbes 1974, *Superoutbreak tornadoes of April 3, 1974* (lifetimes): https://ntrs.nasa.gov/citations/19750051310
- Tornado overview (sizes, the ~1% anticyclonic share, Manchester): https://en.wikipedia.org/wiki/Tornado

**Mobile radar observations:**
- Alexander & Wurman, *Updated mobile radar climatology of supercell tornado structures and dynamics* (DOW medians: V_t, core diameter, ΔV, V_g): https://ams.confex.com/ams/pdfpapers/141821.pdf
- Alexander 2010, DOW climatology dissertation (abstract): https://next.shareok.org/items/cbe04c21-9c20-4976-8b8d-e4cf6b2b8ce4/full
- Wurman & Kosiba 2013, *Finescale radar observations of tornado and mesocyclone structures*, WAF 28: https://www.atmos.albany.edu/facstaff/ralazear/img/wurman_and_kosiba_2013.pdf
- Kosiba & Wurman 2023, *The strongest winds in tornadoes are very near the ground*, Commun. Earth Environ.: https://doi.org/10.1038/s43247-023-00716-6
  - Eos summary: https://eos.org/articles/tornadoes-fastest-winds-howl-close-to-the-ground
  - Nolan comment (EJSSM): https://ejssm.com/ojs/index.php/site/article/view/97
- Kosiba & Wurman, Russell, KS low-level winds (36th Radar Conf.): https://ams.confex.com/ams/36Radar/webprogram/Paper229317.html
- Kosiba, Wurman & Robinson, ECSS 2013 slides (pod winds 50–60% of DOW): https://www.essl.org/ECSS/2013/programme/presentations/3.pdf
- Lee & Wurman 2005, Mulhall 3-D axisymmetric structure (RMW 500–1000 m, 84 m s⁻¹, two-celled, S 2–6): https://farm.atmos.illinois.edu/contents/pubs_pdf/2005-Lee_and_Wurman-Diagnosed_3D_axisymmetric_structure_of_the_Mulhall_tornado_on_3May1999.pdf
- Wurman 2002, *The multiple-vortex structure of a tornado*: https://farm.atmos.illinois.edu/contents/pubs_pdf/2002-Wurman-The_multiple-vortex_structure_of_a_tornado.pdf
- Wurman et al. 2007, low-level winds in tornadoes: https://farm.atmos.illinois.edu/contents/pubs_pdf/2007-Wurman_etal-Low-level_winds_in_tornadoes_and_potential_catastrophic_tornado_impacts_in_urban_areas.pdf
- El Reno 2013, RaXPol (Thiem thesis): https://shareok.org/handle/11244/45410
- Mobile radar overview: https://en.wikipedia.org/wiki/Mobile_radar_observation_of_tornadoes

**Vortex models and swirl ratio:**
- Brown & Wood, MRCV (n = −0.6 outside the core): https://ams.confex.com/ams/pdfpapers/81573.pdf
- Wood, Davies-Jones & Brown, Burgers–Rott TVS: https://ams.confex.com/ams/pdfpapers/64042.pdf
- Church, Snow, Baker & Agee 1979, JAS 36, 1755–1776, doi:10.1175/1520-0469(1979)036<1755:COTLVA>2.0.CO;2
- Lewellen & Lewellen 2000, *Modeling the region of strongest winds* (2.5× near-surface): https://ams.confex.com/ams/annual2000/webprogram/Paper362.html
- Lewellen & Lewellen 2006, *On the limits to near-surface intensification* (factor ~2): https://ams.confex.com/ams/23SLS/webprogram/Paper115321.html
- Refan 2014 thesis (WindEEE, S 0.12–1.29, EF0 to low EF3): https://ir.lib.uwo.ca/etd/1923
- Refan et al. 2017, radar-derived wind fields of 5 tornadoes (S ≈ 0.45 touchdown, 0.8–1.4 two-celled): https://farm.atmos.illinois.edu/contents/pubs_pdf/2017-Refan_etal-Doppler_radar-derived_wind_field_of_5_tornado_events_with_application_to_engineering_simulations.pdf
- Swirl definitions (Nolan & Farrell 1999 via lecture notes): https://www.inscc.utah.edu/~krueger/5230/supercell.pdf
- Fiedler & Rotunno 1986, *A theory for the maximum windspeeds in tornado-like vortices*: https://impacts.ucar.edu/en/publications/a-theory-for-the-maximum-windspeeds-in-tornado-like-vortices/
- AMS Glossary, thermodynamic speed limit: https://glossary.ametsoc.org/wiki/thermodynamic-speed-limit/

**Pressure and condensation:**
- Manchester 2003 probe (100 hPa): https://en.wikipedia.org/wiki/Tim_Samaras
- SPC FAQ, *tornado without a funnel*: https://www.spc.noaa.gov/faq/tornado/nofunnel.htm
- Funnel cloud (edge ≈ cloud-base pressure): https://en.wikipedia.org/wiki/Funnel_cloud
- Thompson et al. 2003, RUC soundings near supercells (LCL discrimination): https://www.spc.noaa.gov/publications/thompson/rucparms.pdf
- Edwards & Thompson 2000: https://www.spc.noaa.gov/publications/edwards/part2.htm

**Position, tilt and life cycle:**
- Broyles et al., *Tornadogenesis in high-end tornadic supercells, Part 1* (208 EF3–5 supercells; position relative to the RFD): https://www.spc.noaa.gov/publications/broyles/tgen1.pdf
- Markowski 2002, *Hook echoes and rear-flank downdrafts: a review*: https://training.weather.gov/wdtd/courses/rac/severe/parameters/markowski2002.pdf
- Lemon & Doswell 1979, MWR 107, 1184, doi:10.1175/1520-0493(1979)107<1184:STEAMS>2.0.CO;2
- Leftward heading changes with RFD surges (WAF; NSF PAR record): https://par.nsf.gov/servlets/purl/10425533
- Griffin et al. 2019, rapid-scan tilt analysis: https://arrc.ou.edu/~mahre/Griffin_et_al_2019
- Bluestein et al. 2003, Happy, TX, W-band (tilt artefacts, 250 m eye): https://tropical.colostate.edu/Publications/papers/Bluestein_etal_MWR2003.pdf
- Greenwood thesis, tilt in rapid-scan mobile radar: https://shareok.org/handle/11244/330737
- Wall cloud: https://en.wikipedia.org/wiki/Wall_cloud
- Life cycle stages (UCI lecture): https://www.ess.uci.edu/~yu/class/ess124/Lecture.19.tornado_files/slide0015.htm
- NWS spotter glossary (rope stage): https://www.weather.gov/spotterguide/glossary_r

**Debris:**
- Van Den Broeke & Jauernic 2014, TDS characteristics (16%, extent versus EF): https://digitalcommons.unl.edu/geosciencefacpub/422
- NWS TDS height versus intensity (≥ 10 kft): https://ams.confex.com/ams/95Annual/webprogram/Paper268874.html
- Debris fallout (Knox et al. 2013; Magsig & Snow 1998; Grazulis; records): https://en.wikipedia.org/wiki/Debris_fallout
- Gong / Lewellen debris corner-flow papers: see `docs/tornado-physics/DEBRIS-CLOUD.md`

**Not retrieved here; numbers taken from memory or secondary sources, so check before relying on them:** the Church 1979 exact thresholds, the Lewellen S_c formula and its critical 1.2, the Karstens 2010 probe range, and Kosiba & Wurman 2013 (WAF 28, 1552) on inflow depth.
