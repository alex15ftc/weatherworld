# Wall cloud and storm base: look spec (2026-11-07)

**Inputs.** Everything comes from `buildStormAppearance` (js/storms/StormAppearance.js):
- `updraft{baseM, radiusKm, rotation, striation, speedMs}`
- `base{radiusKm (=1.3 updraft), rainFree}`
- `wallCloud{x,y, radiusKm, loweringM, rotation, strength, tail, tailBearingDeg}`
- `rain{x,y, wrap, intensity}`
- `rearFlank{clearSlot, wrap}`
- `inflowBands{strength, fromDeg, count, lengthKm}`
- `spectrum`, `tornado{baseM, funnelRadiusM[], tilt*, rainWrap}`, `funnelAloft`

Shorthand: `R = wallCloud.radiusKm`, `L = loweringM`, `Z = updraft.baseM` (LCL), `S = wallCloud.strength`.

Determinism: every element is placed by `f(stormId seed, element index, shared clock t)`. Elements appear and leave through smoothstep fades of `frac(t/T_i + hash_i)`, never by switching.

## 1. Wall cloud

**Shape.** The wall cloud is a flat-bottomed, round-shouldered block hanging from the base. It is not a ball or a saucer.
- **Floor:** at `Z - L`. Floor radius is `0.8 R`.
- **Shoulder:** the sides slope out to `1.0 R` at the base.
- **Fillet:** the sides then flare out into the base over a further `0.3 R` (a concave blend). There is never a gap or a seam.
- **Visible aspect:** width to depth runs about 3:1 to 6:1. Strong, mature walls (`04_wall_cloud_b`, `11_parent_d`) are about 3:1. Weak ones (`04_wall_cloud_a`) are about 6:1.
- **Scaling:** depth is `L` as given. If `2R / L` comes out above 8, round off the floor edge more, so a broad thin lowering reads as a gentle bulge rather than a pancake.
- **Size against the base:** `R` is about 0.3–0.5 of `base.radiusKm` in the photos (`04_a`, `01_classic_labeled_c`). Draw `R` exactly as the engine gives it.

**Build.**
- **Body:** one smooth mesh. Use a lathe profile from the numbers above, with vertex values darkening toward the floor. This is the only way the flat floor survives views from below (`04_c`).
- **Rim:** about 24–36 soft billboard cards ring the rim at `0.75–1.0 R`, in 2 height tiers. Card size is `0.35–0.5 R`. Opacity is 0.55–0.75 at the centre, falling to 0 at the card edge.
- **Overlap:** cards must overlap their neighbours by at least 40%, so the silhouette is a soft continuous edge.

**Edge.**
- The upper edge is smooth.
- The lower 30% of the side is ragged. Add `6 + 18 S` small "tag" cards (`0.08–0.15 R`, opacity 0.4–0.6) hanging 0–`0.25 L` below the floor rim.
- Tags are densest on the tail/forward side and on the RFD side (`04_wall_cloud_a`, `04_c`).

**Placement.**
- The wall cloud sits at its engine (x,y).
- The rain core lies along `tailBearingDeg`.
- The clear slot wraps the opposite side, centred about 120–160° from the tail bearing, on the rear-flank side (`06_clear_slot_tornado_b`, `11_parent_d`).
- The wall cloud tilts toward the tail: floor offset `0.1 R` toward the rain.

**Tail cloud.** Tail strength `w = tail`.
- A horizontal band at height `Z - 0.6 L` runs from the wall rim toward the rain, length `(1 + 2w) R` (`04_wall_cloud_tail_cloud_d`).
- It tapers from `0.5 L` thick at the wall to wisps at the far end.
- Build it from a chain of `4 + 8w` cards whose size falls from `0.4 R` to `0.1 R`, opacity 0.6 falling to 0.2.
- It ends ragged where it enters the rain.

**Rotation.**
- Edge speed is `v = 8 + 14 * wallCloud.rotation` m/s. Angular rate is `v / r`, multiplied by the game clock factor, so the inner tags lap faster than the rim (differential rotation is the cue).
- At 8x and `R` = 1.5 km, rim cards take about 1.5–2.5 min per lap and tags near the floor about 1 min.
- The mesh body itself turns at most `0.3 ω`. Rotation is read from the cards and the tags.
- Air rises into the wall: tags drift up at `0.5–2 m/s × clock` and fade as they reach the floor.

## 2. Rain-free base and striated updraft

**Rain-free base.**
- A smooth, near-flat deck at `Z`, radius `base.radiusKm`, drawn as a mesh (`twisted_sheet`, Severity: one slate deck with almost no texture).
- It is visible over `rainFree` of its circle. The part toward the rain fades into the rain core's curtain.
- Its underside is darkest under the updraft centre and lifts 0.05 in value toward the rim.

**Striations.** `n = round(1 + 4 * updraft.striation)` stacked plates above the base (`12_mesocyclone_striations_b`, `12_c`, `02_lp_c`).
- **Spacing:** plates are spaced `0.12 × (visible tower height above base, about 3 km)` apart. Each plate's radius is 0.85–0.92 of the plate below.
- **Tilt:** the stack is offset downshear, `0.1 R` per plate.
- **Lips and grooves:** each plate has a lighter lip (+0.10–0.15 in value) and a shadowed groove (−0.08) beneath it. These bands are the whole effect; keep them smooth with no lumps.
- **Fade:** the bands fade as `striation` falls. HP storms hide them, because rain wrap lowers striation.
- **Rotation:** bands turn at `0.3 ω`.

## 3. Tone (linear-ish display values, 0–1)

| Element | Value | Colour (sun high) | Notes |
|---|---|---|---|
| Base underside | 0.22–0.32 | slate blue `#3A4654` | Severity `twisted_sheet` |
| Wall cloud floor | base −0.06 to −0.10 | `#2B333E` | always darker than the base (`04_b`, `11_parent_d`) |
| Wall rim cards and tags | base −0.03 | | |
| Under-base backdrop (horizon light below the base) | 0.65–0.85 | `#C9CFC8` | what the wall cloud silhouettes against |
| Clear slot | 0.80–0.95 | `#E9E6D2`; warm `#F2C98E` at low sun | sharp, frayed lip (`06_a`, `06_c`) |
| Rain core behind | 0.40–0.55 | `#6E7C87`; HP blend to teal `#4E6A6A` by `max(0, spectrum)` | `03_hp_a` |
| Sunlit tower and anvil | 0.85–0.95 | cream | lit side only |

**Sun angle.**
- Sun elevation `e`. Under-base and slot light is multiplied by `0.6 + 0.4 smoothstep(5°, 35°, e)`.
- Below 15° the slot and backdrop warm toward the low-sun colour. The base gains a little warm bounce on its sun-facing rim, at most +0.05.

**Rain wrap.**
- With `k = rain.wrap`, the clear slot's area shrinks by `(1 - k)` and its value drops by `0.25 k`.
- The backdrop dims toward the rain-core value by `k`.
- The wall, the tornado and the backdrop are veiled with the rain-core colour at opacity `0.6 k` (`11_rain_wrapped_tornado_b`, `11_c`).
- At `k` 0.8 or more the storm reads as a dark grey lowering inside grey curtains. That is correct for HP.

**Distance.**
- Billboards ignore fog, so we apply aerial perspective ourselves: `colour = mix(colour, horizonSky, 1 - exp(-d / 30 km))`.
- **Contrast budget:** at 20 km, wall against backdrop must still differ by at least 0.20, and wall against base by at least 0.05.
- If not, deepen the wall and the backdrop together. Never lighten the base toward the sky.
- The contrast comes from the order of values: dark under the storm, bright beneath it, darkest at the wall.

## 4. Tornado meets wall cloud

- **Position.** The funnel top sits at the wall floor, offset toward the RFD/clear-slot edge, at `0.3–0.6 R` from centre. The engine's tornado position and tilt already give this.
- **Flare.**
  - The top 15–20% of the funnel widens smoothly into the floor (concave, like a trumpet bell). Its top radius is `min(funnelRadiusM top, 0.6 R)`.
  - At the junction the funnel's colour and value equal the wall floor's. They blend to the funnel's own value over that 20%.
  - There is no seam line or lip. Real examples: `11_parent_d`, `11_parent_c`. Severity: `clip_2026-02-28_11-04-14`, where the white funnel blends seamlessly into the base.
- **Collar.**
  - A ring of `8 + 8 S` soft cards at radius 1.5–2.5× the funnel top, hanging `0–0.15 L` below the floor.
  - Opacity 0.35–0.5. They orbit at the funnel's angular rate × 0.5.
  - This hides the joint and adds rotation.
- **Funnel aloft.** It hangs from the same flare point, with `lengthShare` and `radiusM` from the engine. It is drawn by the same tornado rules (one build).

## 5. Inflow band, beaver tail, scud (cheap life)

**Inflow band.** Only when `inflowBands.strength` is above 0.
- `count` smooth laminar bands at `Z - 0.2 L`. Each comes from `fromDeg` and curves into the wall cloud's flank, spiralling inward by about 30° over its length.
- Length is `lengthKm`, scaled to the sky band, and width 0.4–1 km.
- Build each from 10–16 overlapping cards, aspect 2–3:1 horizontal on screen, opacity 0.35–0.55.
- Value is base +0.10, so they read as lit (`05_inflow_band_beaver_tail_a`, `SC_r22_inflow_band`).

**Beaver tail.** The same build: one flat band along the forward flank at `0.8 Z`, from the rain core toward the updraft, opacity 0.3–0.45.

**Scud.**
- `10 + 30 S` small ragged cards, 80–250 m across, opacity 0.35–0.6, between `0.4 Z` and `Z - L`.
- They are seeded in the inflow and tail region and drawn toward the wall cloud along the inflow while rising.
- Each lives 60–120 s of shared time, fading in and out.
- Value: base −0.02 (dark) where the backdrop behind is bright, as in the Severity clip; base +0.15 where it is dark. Choose by the backdrop value along the view ray, continuously.
- **Cull:** cull scud whose screen size falls below about 12 px, or it turns into dashes.

## 6. Failure modes seen in our lab shots

These are the shots in `docs/stormlab/shots/`, by file name:

1. **`SC_r27_age57_base`, `SC_r27_tor120_after`: one even mid-grey haze.** There is no value order, and the tornado is a pale ghost. Fix: follow the tone table. The base and wall must be clearly darker than the light beneath them.
2. **`SC_r26_age51_120`, `SC_r25_age79_far_scud_dashes`: the wall or base is a dark ellipse floating under a white cauliflower tower, with sky in between.** Fix: the fillet into the base, a continuous rain-free base deck, and smooth towers.
3. **`SC_r25_age64_tornado`: the lowering is spiky blades and fins, with a needle funnel stuck on.** Cards appeared edge-on or stretched in world space. Fix: round soft cards, the trumpet flare and the collar.
4. **`cloudfield_cone_sheet*`: the base is a hard-edged flat sheet with the funnel as a black spike.** Fix: soft shoulder and fillet, value continuity at the joint, a ragged lower edge.
5. **Bright blue sky directly under every storm.** There is no rain-core or horizon-light backdrop, so the storm loses its depth. Fix: draw the rain-core curtain and the under-base backdrop.
6. **Far-range scud as dashes.** Fix: cull by screen size, and give mid-range scud a minimum size.
7. **Cauliflower lumps under the base.** Undersides are soft and low-contrast. Keep lumps for sunlit towers only (NOTES.md "two materials").
