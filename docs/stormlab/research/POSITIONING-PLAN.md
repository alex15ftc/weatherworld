# Supercell and tornado positioning: research vs our sim, and the fix plan (2026-10-30)

This compares the real structure against what the lab simulation does now and ranks the fixes.

Inputs, all in this folder:
- `SUPERCELL-STRUCTURE-RESEARCH.md`: layout, sizes, physics. Sourced, and every number is tagged
  S (source), T (textbook) or E (estimate).
- `TORNADO-STRUCTURE-RESEARCH.md`: wind and pressure profiles, condensation, EF table, position.
- `SIM-POSITIONING-AUDIT.md`: where the code puts each feature (file:line), measured on the
  Supercell scenario.

The game draws the **lab** geometry (`roblox/src/stormlab/shared/Sim`). The JS engine only nudges
each storm's position, motion, W and rotation. The engine's own geometry drives its radar and products.

## 1. Frame

Origin is the low-level mesocyclone (LLM), which is the wall cloud and tornado point. x is along the
storm motion, y is to the **right** of motion, in km. The research table used y = left; it is
flipped here. Rotate into the map with heading h (radians, clockwise from north):
E = x·sin h + y·cos h, N = x·cos h − y·sin h.

## 2. Side-by-side plan view (classic right-mover)

| Feature | Research (x, y right), size, height | Sim now (x, y right) | Verdict |
|---|---|---|---|
| LLM / wall cloud | (0, 0); wall cloud 1.5-4 km across, 0.1-0.8 km below base | (0, 0); 2.7-3.5 km across; **640-910 m below base, held at the 0.6·base cap** | position ✔, height capped ✘ |
| Updraft at cloud base / rain-free base | RFB centre (+2, +1); 5-15 km across | (+0.6…+2, +1.2…+2.3); RFB radius ~6 km | ✔ |
| Mid meso / updraft core 3-8 km | (+2…+3, −0.5…−1): ahead, slightly **left** | (+1.1…+2.9, +1.0…+2.4): ahead, **right** | ✘ ~2-3 km too far right (research distance is E) |
| BWER | (+2, −0.5), 2-7 km wide, 3-10 km up | over the 5 km updraft, right | follows the updraft ✘ |
| RFD core | (−2, +2), radius 1.5-3 km, starts 1-4 km up | (−1.35, +0.27) | a little close, not right enough ~ |
| Clear slot | horseshoe r 1-3 km, rear round to right | ring r ≈ 1.4 km starting behind | ✔ (a bit small) |
| Hook | (0, −2) via (−2, 0) to (−1, +2) | prescribed spiral, tip ~1.6 km right-rear | shape ✔, **painted** ✘ |
| Largest hail | (+1.5, −2.5): beside the updraft, north/north-west of the meso, r 1-3 km | **6-9 km** from the storm centre | ✘ too far out |
| FFD / heaviest rain | (+7, −4), 8-15 × 6-10 km | FFD centre (+7, −0.5); **rain core 28° right, 12.9 km** | ✘ rain on the wrong side and too far |
| Tail cloud | wall cloud → (+5, −2) | toward the FFD, ≤ 4 km (fixed cap) | ✔ (cap is a constant) |
| Inflow band / beaver tail | (+3, +1) → (+20, +4), 5-30 km | right-front, from 4-5 km out, 7-9 km long | ✔ (short end) |
| FFD gust front | (0, +0.5) → (+20, +1) | one cold-pool contour | ✘ not separate |
| RFD gust front | (0, +0.5) → (+1, +3) → (−3, +10) | one cold-pool contour | ✘ not separate |
| Triple point / next meso | (+1…+4, +2…+4) | none; after a cycle the LLM returns to the **same** bearing | ✘ |
| Flanking line | (−2, +4) → (−12, +16), tops 12 → 4 km | **missing** | ✘ |
| Anvil | downshear 100-300 km; backsheared 5-20 km upwind | 4-10° left, ≤ 160 km; no backshear | ~ |
| Overshooting top | 1-3 km above the EL, lasts ~8.5 min | +2.25-2.5 km, steady | ✔ (could pulse) |
| Tornado at genesis | inside the RFD: ~3 km behind, ~2 km right of the RFD gust-front nose; late life turns left 30-55° into the cold air | spawns at the LLM, then follows it, pushed by RFD outflow | ~ |

## 3. Physics and maths for each fix

### 3.1 Precipitation, hail core and hook from fall-out (no painted angles)

A particle released at height H drifts with the storm-relative wind while it falls:
`drift ≈ ∫ V_sr(z)/v_t(z) dz ≈ V_sr·H/v_t`.

Fall speed: `v_t = sqrt(4 g ρ_h D / (3 C_D ρ_a))`. Empirically 9·D^0.8 m/s for hail (D in cm),
which gives 22 / 31 / 44 m/s for 2.5 / 5 / 10 cm stones. Rain falls at ~8 m/s, small hail at ~15 m/s.
`ρ_a` falls with height, so v_t grows aloft by `(ρ0/ρ)^0.5` (about 1.4× at 6 km).

With V_sr ≈ 10-15 m/s and a release at 6-9 km on the updraft's downshear edge:
- 5 cm hail lands ~3-5 km out. That is the hail core, beside the updraft.
- 2 cm hail lands ~8 km out.
- Rain lands ~15-20 km out. That is the forward-flank core.

The size sorting and the ZDR arc (the low-level band of big, sparse drops along the forward flank's
southern edge, beside the updraft) then come out on their own.

Suspension: a stone of size D stays aloft where w > v_t(D). The largest hail a storm grows is the D
with v_t(D) ≈ w_max. The 55 m/s lab W is above the observed maximum of 49-53 m/s; the research rule is
w ≈ 0.6·sqrt(2·CAPE).

**What the sim has:** 3-D advection is already in (`Precip.luau:105-118`), and the fall speeds are
reasonable (hail 14√D ≈ 9·D^0.8 near 5 cm). The painting is in the **release positions**:
- the main core is released at downshear + 0.3 rad ± N(0.4), r = 1.1-1.8 ru;
- the hook is released along a prescribed spiral.

**Fix:**
1. Release where the updraft actually rejects hydrometeors: its edge, weighted by w·(condensate) and
   the upward flux through each height, at 6-10 km for hail and 3-8 km for rain.
2. Let advection place everything.
3. The hook should come from rain carried round the low-level meso by its own winds; the meso
   already rotates in `windAt`.
4. Check the rain-core side first. It lands 28° right, but the research says left. The likely
   cause is the release angle or the low-level storm-relative inflow sweeping it. Measure with
   `tools/stormlab/diag_layout` after each change.

LP / classic / HP should then emerge from the anvil-level storm-relative wind (> 28 m/s LP, 18-28
classic, < 18 HP). Stronger upper winds carry the rain farther from the updraft.

### 3.2 Two gust fronts, the occlusion and the triple point

- **FFD outflow:** cold, wide, slow. Rain-cooled; deficit θv 2-5 K.
- **RFD outflow:** a narrower surge.

Deficits behind the RFD gust front:

| Storms | θv deficit | θe deficit |
|---|---|---|
| Significantly tornadic | ≤ 2 K | ≤ 4 K |
| Weakly tornadic | 4-7 K | 10-12 K |
| Nontornadic | — | ≥ 8-10 K |

Tornadic RFDs are warmer and start ~1 km lower. Each gust front moves at the density-current speed
`c ≈ k·sqrt(g·(Δθv/θv)·h)`, with k ≈ 0.7-1 and cold-pool depth h.
- FFD: h ≈ 0.5-1 km, Δθv 3 K → c ≈ 7-10 m/s.
- RFD: h ≈ 1 km, with the downdraft's own momentum → faster.

The occlusion is where the RFD front catches the FFD front. The triple point is where the two meet
the warm inflow. A new LLM forms at the triple point (+1…+4, +2…+4) as the old one occludes,
~45-60 min apart, each new tornado to the right of the last.

**Fix:**
- Carry the cold pool as two tracers, FFD air and RFD air, each with its own gust-front contour.
- Place the LLM where low-level vorticity peaks along the FFD boundary. That is baroclinic
  generation, `dω/dt ≈ (g/θ)·∂θ/∂n`: about 0.02 s⁻¹ in 10 min for 1 K/km.
- Cycle by spawning the next LLM at the triple point. This replaces the fixed `lowAngle` and the
  reset to the same bearing.

### 3.3 Wall cloud height from rain-cooled air, not the cap

The wall cloud hangs lower because the updraft ingests rain-cooled forward-flank air, which has a
lower LCL. Cloud base height: `z_LCL ≈ 125 m × (T − T_d)`.

Mixing a share f of wet-bulb-cooled FFD air lowers the dewpoint depression roughly linearly in f.
The lowering is `125·(spread_env − spread_mix)` plus the dynamic part `vlow²/g` from the meso's
pressure drop (p' ≈ ρ·v²). The research range is 0.1-0.8 km.

The sim already uses this mixed-parcel formula (`Storm.luau:674-691`), but the result is held at
the **0.6·base cap**. Either the outflow share or the spread is too large, or vlow²/g is doubled.
**Fix:**
- Log the three terms in `diag_wallcloud`.
- Tune the share against the 0.1-0.8 km range.
- Lift the cap to a safety value, so the cap no longer sets the answer.

### 3.4 Updraft and mid-meso lateral position

The research puts the mid-level meso and BWER **ahead and slightly left** of the LLM. The sim puts
them ahead and **right**, partly from a fixed 0.15·Ru offset at −2.4 rad (`midMesoAt :246-251`) and
from the low meso's fixed `lowAngle`.

Physically, the updraft tilts downshear by `Δx(z) ≈ ∫ V_sr(z)/w(z) dz`. The sim does this already,
damped by (1 − 0.55 rot). The mid meso sits on the updraft's flank where tilted streamwise vorticity
peaks.

**Fix:**
- Drop the fixed offsets.
- Put the mid meso on the tilted axis.
- Let the LLM come from 3.2 (on the FFD boundary, at the updraft's rear-left base), not from a
  fixed bearing.

The research distances here are estimates, so judge by bearing first.

### 3.5 Tornado: size, funnel and position

**Core radius**

Core size is nearly **uncorrelated** with intensity. Radar gives a median core diameter of ~300 m.
Damage width grows with EF because the 29 m/s edge reaches farther:
`W ≈ r_c·[((V_c+V_t)/29)^(1/α) + ((V_c−V_t)/29)^(1/α)]`, with α ≈ 0.5-0.8.

The lab's ~60 m core is small. Draw r_c from the fields (meso size, stretching), aiming at a
log-normal spread with a median of 100-150 m, not from EF.

**Pressure and condensation**
- Cyclostrophic balance: `dp/dr = ρ v²/r`.
- Central deficit: Rankine Δp₀ = ρV_c²; modified Rankine ρV_c²(½ + 1/(2α)); our Wood-White
  profile 2.06·ρV_c².
- The funnel edge is where p′(r, z) reaches `ρ g (z_b − z)` (~11 hPa per 100 m).
- Funnel length below base `L = f(0)·V_c²/g`. For EF2-EF3 that is only 0.2-0.4 km.

Two consequences:
- The base `z_b` must be the **local wall-cloud base**, not the environmental LCL. Otherwise most
  funnels stop in mid-air. Check which base `Vortex.condensationRadius` receives.
- A partial funnel over a dust whirl is the normal look for weak tornadoes and high bases.

Also, our profile's 2.06ρV_c² is 55% above modified Rankine. If funnels look too long or too fat,
this is the first suspect.

**Position and motion**
- Genesis inside the RFD, behind and right of the RFD gust-front nose, after an RFD surge
  (~13 min before) and occlusion (~5-10 min before).
- Translation: median 13.5 m/s (IQR 9-18).
- Late in life it turns left 30-55° into the cold air, and the funnel stretches into a rope.

The sim's "follow the LLM, pushed by RFD outflow" is the right idea. With 3.2 in place it gets the
occlusion and the left turn from real fronts.

**Debris**
- Visible debris cloud: radius ~0.1-1 km, height to a few hundred metres up to ~1.5 km for strong
  tornadoes.
- Radar debris (TDS) reaches 4-7 km, but that is sparse lofted debris, not a visible cloud.
- The lab's 30·(peak − 25) m (≈1.35 km at 70 m/s) is fine for the visible cloud.

### 3.6 Missing visual structure

- **Flanking line:** towers along the RFD gust front, (−2, +4) → (−12, +16), tops falling
  12 → 4 km with distance. Drive it from convergence along the RFD front, where w ≈ lift by
  the density current, with tops where parcels run out of CAPE.
- **Backsheared anvil:** 5-20 km upwind when the updraft is strong (W > ~40 m/s), from upstream
  spreading at the EL, `≈ W·(EL thickness)/N` against the upper wind.
- **Overshooting-top pulsing:** individual tops last ~8.5 min. Height above the EL ≈ w_EL/N.

## 4. Ranked plan

| # | Fix | Why first | Touches |
|---|---|---|---|
| 1 | **Done 2026-10-30 (STATUS.md Round 14a).** Release-by-physics precipitation (3.1): drop the painted release angles and hook spiral; check the rain-core side | biggest visible error (rain on the wrong side, hail 2× too far) and the worst painted item | `Storm.emitPrecip`, `Precip.luau` |
| 2 | **Done 2026-10-30 (STATUS.md Round 14b).** Wall-cloud lowering off the cap (3.3) | one formula; the cap is setting the result | `Storm.luau:674-691` |
| 3 | **Checked 2026-10-30, no change needed (STATUS.md Round 14c).** Funnel base = local wall-cloud base; check the profile's pressure factor (3.5) | funnels' reach to the ground depends on it | `Vortex.condensationRadius`, `Tornado.luau` |
| 4 | Two gust fronts, triple point, LLM from the FFD boundary, cycling at the triple point (3.2, 3.4) | replaces fixed `lowAngle`, `rfdAt`, `midMesoAt` offsets | `Storm.luau` cold pool + meso placement |
| 5 | (also: fix the updraft profile break at the base and refit wLow, STATUS.md Round 14b) Tornado core radius from fields, median 100-150 m (3.5) | sizes look small | `Tornado.luau` |
| 6 | Flanking line, backsheared anvil, pulsing tops (3.6) | missing structure, visual only | renderer + `Storm.luau` |
| 7 | JS engine geometry ~2× real, one gust-front ring, legacy painted `StormInternalField.js` | affects radar/products, not the drawn storm | `js/` |

Measure each step with the existing diagnostics: `tools/stormlab/diag_layout`, `diag_structure`,
`diag_wallcloud` and `diag_hail`. Run the regression suite (`tmp/reg/run.sh`) before and after
any engine change.
