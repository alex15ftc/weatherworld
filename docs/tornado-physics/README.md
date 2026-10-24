# Tornado physics: research and what the game uses

This document gathers three research passes (2026-10-22) and records how each finding was turned into code:

1. Tornado wind-field science.
2. How other tornado games and simulators do it.
3. What wind does to objects, people and buildings.

**Code:**
- `roblox/src/shared/Tornado/WindField.luau`: the wind maths, as plain numbers.
- `Vortex.luau`: builds the field's parameters from a tornado's state.
- `WindPhysics.luau`: pickup, flight and damage.
- `roblox/src/lab/client/WindLab.luau`: the lab view. J shows the wind arrows; G scatters test objects.

**Offline checks:** `luau tools/windfield/test.luau`, which runs without Studio.

---

## 1. The wind field

### 1.1 How speed varies with distance from the centre

| Model | Formula (R = r / r_c) | Notes |
|---|---|---|
| Rankine | v = V_c·R inside, V_c/R outside | Kinked at r_c, and the tail is too broad. This was the old model here. |
| Modified Rankine | Outside: V_c·R^(−α), with α 0.5–0.8 | The standard fit to Doppler-on-Wheels radar data (Wurman, Kosiba; Refan et al. 2017). |
| Burgers–Rott | Γ/2πr·(1 − e^(−r²/r₀²)) | One-celled and viscous. Updraft grows without limit with height. |
| Sullivan | Two-celled: a downdraft on the axis | Needs a lookup table, and updraft also grows without limit. |
| Vatistas, family n | 2^(1/n)·R/(1 + R^(2n))^(1/n) | Smooth and cheap, but the tail is always 1/R. |
| **Wood & White 2011** | R^λ / ((1 − λ/κ) + (λ/κ)·R^(κ/η))^η | **Used here**, with λ = 1, κ = 1 + α, α = 0.6, η = 0.5. It peaks at exactly 1 at R = 1 and has a modified-Rankine tail. |
| Baker & Sterling 2017 | Analytic inflow and updraft that conserve air | Its updraft grows as ln z. We use the same idea with a bounded height function. |
| Fujita DAPPL 1978 | Engineering model with an inflow layer and a height factor (z/H)^(1/6) | — |

### 1.2 Vertical structure

Measurements: Kosiba & Wurman 2013; Wurman et al. 2013 (TIV); Lewellen et al. 2000 (corner flow).

- The wind is zero at the ground and builds up over a few metres.
- The strongest winds are 10–50 m up: a near-ground "jet" about 10–30% stronger than the swirl above it, found only near the core.
- Inflow is concentrated in the lowest 10–100 m. Close to the ground it is comparable to the swirl; higher up it is about 0.1 of it.
- In a two-celled vortex, air sinks along the axis (−5 to −20 m/s) and rises in a ring at about 0.6–0.8 of the core radius.
- The core widens slowly with height.

**In our model:**
- Height factor (1 − e^(−z/3 m))·(1 + ε·(z/z_j)·e^(1 − z/z_j)·e^(−(r/2r_c)²)), with z_j = 30 m and ε = 0.15–0.25. ε is larger at low swirl.
- The core radius r_c grows by 30% from the ground to the cloud base.
- Inflow and updraft come from a single streamfunction ψ = Ψ₀·F(r/r_m)·G(z), with:
  - F = r̄²/(1 + r̄²) − d·r̄²·e^(−r̄²/s²)
  - G = 1 − (1 + z/h)·e^(−z/h)
  - h = 0.15·r_c
  - Ψ₀ = 2e·h·r_m·U_m
- Because of the streamfunction, air is conserved exactly (test: divergence about 1e−7).
- One-celled: inflow peaks at −U_m at (r_c, h), and the updraft on the axis aloft is about 0.8·V_c.
- Two-celled (d = 1.2): the axis has a downdraft of about −12 m/s at EF4, and the updraft ring peaks at 0.69·r_c.

### 1.3 Swirl ratio S

Sources: Church et al. 1979; Refan et al. 2014 (WindEEE).

| S | Structure |
|---|---|
| < 0.2 | Narrow, one-celled vortex |
| 0.2–0.45 | Breakdown bubble aloft |
| 0.45–0.8 | Breakdown reaches the ground; two-celled and wider |
| > 0.8–1 | 2 to 6 sub-vortices |

**Where S comes from:** the engine already computes S (`StormAppearance.js`, `swirl`), and it is the value used whenever the state carries one. Otherwise S is taken from the EF rating (0.2, 0.3, 0.5, 0.7, 0.9, 1.1).

**Two-celled share:** d ramps from 0 to 1.2 as S goes from 0.3 to 0.8.

**Sub-vortices:**
- They appear from S = 1, with a fractional count so the last one fades in rather than popping.
- Each is a Vatistas n = 2 profile with radius 0.1·r_c and a peak of 0.4·V_c.
- They orbit at r_c at an angular speed of 0.7·V_c/r_c.
- Each lives 10–40 s and fades over 150 m of height.
- They add short peaks above the rating: at EF5, 89 m/s becomes 112 m/s, about what El Reno's radar showed.

### 1.4 Translation, the rating, and the strong side

- Ground-relative wind = the vortex's own wind + the tornado's motion near the core, blending to the environment's wind beyond about 5·r_c. The motion is added once only.
- In the Northern Hemisphere the right side of the track is strongest (V_c + V_t).
- **The EF rating is the peak 3-second gust at 10 m, ground-relative.** `WindField.calibrate` solves for V_c so the strong-side peak at 10 m equals the EF centre speed, counting inflow, jet and translation. The test confirms this to within 3% for EF0–EF5. The weak side comes out about 25 m/s lower when moving at 13 m/s.

### 1.5 Pressure and the condensation funnel

- Cyclostrophic balance: Δp(r) = ρ·∫ v²/r dr. For our profile the central deficit is 2.06·ρ·V_c², about 60–90 hPa at EF3 (measured tornadoes: 10–100 hPa).
- The funnel's edge is where the deficit equals the pressure fall from the ground to the cloud base. `Vortex.funnelRadius` gives this, and the engine draws funnels by the same rule. It is a check only; the drawn funnel still comes from the engine's profile.
- Pressure does little to buildings compared with dynamic pressure, so its effect enters only through internal pressure.

### 1.6 Turbulence and pulsing

- Gusts are about 0.15–0.3 of the local wind, with eddies of 0.2–1·r_c.
- Ours: divergence-free curl noise at 0.2 of the local wind (test: rms 0.20), with eddies of 0.5·r_c carried round with the flow. Two copies are crossfaded so the pattern never winds up.
- The whole vortex also pulses ±12% over about 40 s, as seen at Goshen.

### 1.7 Core radius and the visible funnel

The radius of maximum wind sits at or just outside the condensation funnel. That replaces the old "0.5 × funnel radius". The engine's `coreRadiusM` is used when the state carries it. The damage path is 2–5× the core diameter.

### 1.8 Cost

About 2.5 µs per sample in plain Luau at EF5 with sub-vortices and turbulence. Parameters are built once per state change (`Vortex.cachedParams`).

---

## 2. What other simulators do

The force-model details below come from reading source code:
- **Weather2** (Minecraft, Corosus).
- **TornadoScript** (GTA V).
- **gDisasters-Revived** (Garry's Mod).
- **A Unity demo.**

For the Roblox games (Twisted, Helicity, Severity), only changelogs are public, so their force models are not known.

| Game | Force model | Pickup | Shelter | Budgets |
|---|---|---|---|---|
| Weather2 | A per-tick velocity push along a "grab angle" that blends inflow and spin. Tighter near the ground, wider for stronger tornadoes. Lift is cut above 10 m/s, so things orbit and fall out. | Block hardness compared with a diamond axe; entity weight, with armour adding weight. | Rain-height check plus 4 sideways raycasts. | 5 blocks per tick, 200 flying. |
| TornadoScript | Inward, upward and 1/d tangential forces, applied at a random off-centre point so things tumble. Speed capped at 40. | Distance 57 m; a random ±3 m target per object stops clumping. | Raycast from the player to the funnel. | 300 entities. |
| gDisasters | Tangential, suction and up forces, with falloff 1 − (d/R)^e. | Mass gates per EF level (250 kg at EF0 up to 30 t at EF5); welds break at random. | Outdoors check plus a trace toward the funnel. | — |
| Roblox community scripts | BodyPosition orbits around a single point. Criticised for clumping and looking "floaty". | Random unanchoring. | — | Debris despawns after 25 s. |
| Twisted 1.16–1.20 | "Realistic tornado wind field"; layered winds. | Cars drag, roll, then loft, with per-vehicle thresholds; NWS damage indicators. | "Not lofted under objects." | Damage regenerates after 1.5 in-game days. |
| Helicity | — | Per-vehicle min/max winds (e.g. TIV 135/165 mph). | — | — |

**Common patterns:**
- Three force components: inward, tangential and up.
- Mass or threshold gating, plus a terminal-speed cap.
- Randomness to stop clumping.
- A shelter raycast.
- Hard budgets on flying objects.

**What the better games do:**
- Staged vehicle response: drag, then roll, then loft.
- Buildings judged by EF damage indicators.
- Broken-model swaps rather than live physics.

**What players dislike:** lerping objects to an orbit point, which looks floaty and makes everything clump.

**Our choices:**
- A real wind field, with drag computed from each object's relative wind; nothing is moved toward an orbit point.
- Per-object scattered thresholds instead of anti-clumping hacks.
- Terminal speed comes from drag itself.
- The funnel's bent axis carries the wind, like Weather2's layered funnel.

**Roblox notes:**
- The server can't set velocity on a client-owned character. The client applies its own wind force from the replicated field, and the server checks the result.
- Unanchor parts in batches across frames.
- Keep flying debris to about 150–300 parts per tornado.
- Scan for parts with `GetPartBoundsInRadius` at about 5 Hz.

---

## 3. Objects, people and buildings (WindPhysics)

### 3.1 Forces and flight

- **Drag:** ½·ρ·C_d·A·|v_rel|·v_rel. **Lift:** ½·ρ·C_L·A·|v_rel|², acting across the flow.
- ρ = 1.15 kg/m³, a warm and humid Plains day.
- **Tachikawa number:** K = ρU²A / (2mg). Whether an object lifts off depends on K and its lift coefficient (C_L·K ≳ 1).
- **Flight step:** drag uses the exact quadratic-drag relaxation, v_rel ← v_rel / (1 + k_D·|v_rel|·dt), which is stable at any tick rate (test: a shingle stepped at 10 Hz). Then lift, then gravity, then a cap of |wind| + 15 m/s.
- **Tumbling:** plates autorotate (ω ≈ 0.8·v/L), rods spin end over end (0.3·v/L), compact objects turn slowly.
- **Calibration:**
  - FEMA P-361 / ICC 500 design missile: a 2×4 at 100 mph (45 m/s) in a 250 mph tornado. Our 2×4 crossing 40 m of a 90 m/s annulus reaches 49 m/s.
  - NRC RG 1.76 design car: 41 m/s. Ours reaches 26 m/s after 4 s in 80 m/s wind.

### 3.2 Pickup

- Each object gets its own threshold: the class value × log-normal scatter (σ = 0.15).
- **Release rate:** 1.5·(U²/U_th² − 1) per second.
- **Effective speed:** updraft counts extra, U_eff² = |w_h|² + 3·w_z·|w_z|.
- **Which wind counts:** attached parts use a 3-second mean, loose objects the instantaneous wind.

| Class | Mass (kg) | Area (m²) | Slide (m/s) | Release attached / loose (m/s) | Roll (m/s) |
|---|---|---|---|---|---|
| Player | 75 | 0.75 | 25 (knocked down) | 40 | — |
| Car | 1400 | 4.0 | 45 | 80 | 60 |
| Pickup | 2300 | 5.0 | 50 | 85 | 65 |
| Mobile home | 18000 | 80 | 39 | 57 (destroyed) | 44 |
| Shingle | 1.3 | 0.34 | — | 35 / 12 | — |
| Plywood | 18 | 2.97 | — | 45 / 18 | — |
| 2×4 | 4.5 | 0.22 | 20 | 30 | — |
| Branch | 5 | 1.5 | — | 33 / 15 | — |
| Small tree | 150 | 8 | 41 (uprooted) | 65 | — |
| Fence panel | 25 | 4.46 | — | 30 / 18 | — |
| Trash can | 15 | 0.75 | 12 | 28 | — |

**Sources for the thresholds:**
- Vehicles: Haan et al. 2017 (slide at EF1, loft at EF4); Fujita (a 1090 kg car slides at 39 m/s).
- Mobile homes: EF scale DI 3.
- Trees: DI 27/28; Virot et al. 2016 (trunks break near 42 m/s).
- People: Penwarden 1973.

### 3.3 People on foot

| State | Wind (m/s) | Effect |
|---|---|---|
| Strained | 11 | Walk speed × 0.85 |
| Stagger | 18 | Walk speed × 0.5 |
| Knocked down | 25 | — |
| Dragged | 30 | — |
| Lofted | 40 | Flies (still subject to the pickup chance) |

**Shelter factors** (multiply incoming debris damage):

| Location | Factor | Notes |
|---|---|---|
| Open | 1 | |
| Vehicle | 0.6 | |
| Mobile home | 0.7 | |
| House, exterior room | 0.4 | |
| Interior room | 0.15 | Until the house reaches DOD 8 |
| Basement | 0.02 | |
| ICC 500 shelter | 0 | |

### 3.4 Impacts

- Energy = ½·m·v².
- Injury starts at 20 J, and the DoD's 79 J mark is serious injury. About 600 J (a shingle at 30 m/s) is lethal.
- Anything over 300 kg moving faster than 5 m/s kills an unsheltered person.

**Perforation energies:**

| Part | Energy (J) |
|---|---|
| Window | 20 |
| Wood-frame wall | 800 |
| Impact-rated glass | 900 |
| Brick veneer | 3000 |
| Shelter | 7000 |

### 3.5 Buildings and trees

- **Tables:** EF degree-of-damage tables are in `WindPhysics.DAMAGE`:
  - house: DI 2, 10 DODs
  - mobile home: DI 3, 9 DODs
  - tree: DI 27, 5 DODs
- **Failure speed:** each part draws its own speed once, from a normal distribution around the expected speed with σ = (upper − lower)/4.
- **Modifiers:** hip roof × 1.05, straps × 1.2, breached envelope × 0.87 for roof parts.
- **Why a breach matters:** internal pressure goes from +0.18 to +0.55, and √(1.18/1.55) = 0.87.
- **Failure order:** cover and windows, then the garage door (a breach), then roof sheathing, then the roof structure, then the walls, then the house slides off its anchoring.
- **Roof parts:** compare against `roofSpeed`, which adds the updraft.

---

## 4. Not done yet (next steps)

- **Players:** apply `WindPhysics` to real characters. The client applies the force to its own character from the replicated field, and the server checks it.
- **Engine link:** send the engine's `coreRadiusM` and `swirl` in the tornado state. `Vortex` already reads `state.coreRadius` and `state.swirl` when present.
- **Buildings:** pre-split them into parts tagged with DI/DOD, swap in broken models, and spawn capped debris from failed parts.
- **Shelter checks:** a roof raycast plus a raycast toward the funnel, cached for 1 s.
- **Vehicles:** wire the staged response (slide, roll, loft) into the game's vehicles (`TestVehicle.luau`).
