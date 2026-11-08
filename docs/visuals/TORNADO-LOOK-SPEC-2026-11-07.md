# Painted tornado: look spec (2026-11-07)

Inputs per tornado: `windMph`, `widthYards`, `coreRadiusM` R, pressure drop, `baseM`, `condensedM` (tip height), `funnelRadiusM[i]` and lean at ~9 heights, `swirl`, `vortices`, `twoCell`, `decay`, `contortion`, `debris{radiusM,heightM,strength,dust}`, `rainWrap`. Shape names are **not** read. Everything below is a function of these numbers plus seed and wall clock. Notation: z = height share of the base (0 at the ground, 1 at the base). r(z) is the funnel radius. Values run 0..1 (sRGB luminance).

Clips: **Severity itself** = `clip_iOvAj0as2Z` (brown debris wedge, houses), `clip_3JXLF0nN0n` (rain-wrapped wedge, stop sign) and `clip_mobile_severity.mov` (Severity Dev v0.1.3: inside the wedge, flying panels). All three have the "Unknown Road" HUD. **Severity-like Roblox builds** = the `clip_2026-02-*` and `clip_2026-03-30_*` clips: 10-37-29 (white cone with a dark debris ball), 11-01-22 (slate cone), 10-44-44 (dark wedge), 15-38/15-42 (white and grey S-ropes), 15-46 (dark trunk). My frames from iOvAj, mobile, 10-37-29 and 15-42-21 are in `tmp/refframes/`.

## 1. Silhouette

- **Outline = condensation profile.** The visible half-width at height z is r(z). Draw it with a soft edge ramp of width `e(z) = r(z)·(0.04 + 0.22·rough)`, where `rough = clamp(0.35·twoCell + 0.4·rainWrap + 0.25·dust + 0.3·decay, 0, 1)`.
  - Smooth, laminar cones and ropes: about 4% ramp (Severity ref1 diag; `01_cone_a`, `04_rope_b`, `03_stovepipe_a`).
  - Wedges and dusty funnels: 15–25%, grainy (`02_wedge_a/b`, `08_debris_c`, `ref3`).
- **Raggedness by height.** The ragged amplitude grows toward both ends. It is `rough·r·(0.05 + 0.15·(1−z)^2 + 0.2·smooth(z>0.8))`: tufts at the foot (dust) and the collar. The middle third stays cleanest (`01_cone_a`, `03_stovepipe_a`).
- **Join to the base: never a rim.** Over the top 15–25% of the funnel, r widens by about 1.5–3x (more when r is small relative to the base radius). Alpha drops to the base's own value while the funnel's tone blends into the wall cloud's tone. A horn widens about 8x from the ground to the base (`01_cone_a/b`, `07_funnel_b`, `09_backlit_c`). A wedge barely flares, because it is already about as wide as the lowering (`02_wedge_a/b`). Put a collar of 4–8 dark, shredded puffs at 1.2–2x r just under the base, turning with the funnel (`09_backlit_c`, `10_striations_a`).
- **Top/bottom ratio** comes straight from the engine radii. Expected outcomes:
  - cone: r(0)/r(1) ≈ 0.1–0.2
  - stovepipe: 0.6–0.9 (`03_stovepipe_a/b`)
  - wedge: 0.6–1, width ≥ height (`02_wedge_a`, 10-44-44)
  - rope: ≈ 1, uniform thin (`04_rope_b/d`)
  - drillbit: a thin tube with a wider top third (`05_drillbit_a/b`)
- **Lean** is the engine's dx,dy joined by a smooth spline (Catmull-Rom, at least 24 samples). Never draw straight segments between the 9 levels.

## 2. Tone and colour

- **Light term.** `L = under + sun·(1−cover)·facing`, from the existing scene-light ray (under ≈ 0.35–0.55, sun ≈ 0.75). The funnel under the base is in the storm's shadow. It is only white where the clear slot lights it (`01_cone_a`, `03_stovepipe_a`, 10-37-29).
- **Value against the sky behind** (what reads):
  - Front-lit: funnel 0.65–0.85 against a base of 0.25–0.4.
  - Overcast / side-lit: funnel 0.35–0.5, about 0.1 darker than the sky behind (`01_cone_c`, a21, 15-42).
  - Backlit (camera within ~60° of the sun): funnel 0.08–0.2 against a horizon of 0.7–0.95 (`09_backlit_a/b/c`, `04_rope_a`, `05_drillbit_c`).
- **Rain wrap** applies `contrast × (1 − 0.85·rainWrap·k)`, where k is the share of the view path inside rain. A wrapped wedge is a grey band only 0.03–0.08 off its surroundings (`01_cone_d`, `02_wedge_c/d`, 3JXLF).
- **Gradient across the width** (front- or side-lit):
  - The lit side is 0.1–0.2 brighter than the shadow side (`03_stovepipe_a`).
  - A soft darker band 0.08–0.12 deep lies just inside each edge, about 11% of the width (ref1 diag).
  - The centre is brightest. No bright rim line front-lit.
- **Backlit gradient.** Thin funnels (r < 60 m) get a 1–3% forward-scatter brightening at the edge. Wide ones stay flat and dark.
- **Colour.**
  - Condensation is neutral. Lit it is about (200,205,210); in shade, blue-grey (95,105,118).
  - Lower funnel: mix in grey-brown debris, `w(z) = dust·(1 − z/(debris.heightM/baseM))_+^0.7`, with dust colour (118,104,88) and debris colour (62,58,54).
  - Keep saturation ≤ 0.25. Brown is a tint, never orange (`03_stovepipe_a` lower third, `08_debris_b/c`, iOvAj, 10-32-59).
- **Storm light tint** (sepia, green, slate) multiplies everything, the funnel included. Never paint it separately (`ref3`, 10-58-06).

## 3. Surface texture and motion

- **Surface.** Smooth funnels carry almost no surface noise: streak contrast 0.02–0.05 and patches 0.06 or less.
  - Faint helical striations, 4–8 bands round the funnel, pitched `atan(w/v)` at 10–25° from horizontal. Take w ≈ 0.15·v.
  - Texture strength rises with rough: wedges show vertical fibrous streaks of 0.08–0.15 (iov_14, `02_wedge_b`, ref1 diag).
- **Turning speed.** At radius r the tangential speed is `v(r) = Vmax·min(r/R, R/r)`, with Vmax from `windMph` minus forward speed. Features cross the face at angular rate `ω = v/r`. That is a period of about 6 s for r = 50 m at 50 m/s and about 25 s for a 500 m wedge. Narrow parts turn visibly faster.
- **Rising speed.** Texture climbs at w ≈ 0.1–0.2·v, so motion reads as a slow upward-turning helix, not pure spin.
- **Breathing and kinks** (NOTES motion research):
  - Radius breathes ±5–10% on a 10–40 s period.
  - Kinks are 2–5% of the height for mature funnels and 5–15% for ropes, with wavelength ratios 1 : 0.62 : 0.41. They climb in 15–30 s.
  - All motion is deterministic in `seed + wallClock` (rotation is real-time, not the 8x game clock).
- **Distance.** Cards change slowly: Severity's frame-to-frame change is about 0.2/255. Wisps morph by cross-fade; they never scroll.
  - Beyond about 3 km, drop surface texture: only the outline sway and the collar turning read.
  - Within 500 m, add 20–48 strand wisps on a shell at 0.85–1.1 r, turning at 0.6ω.

## 4. Debris and dust

- **Shape: a ground-hugging skirt or bell, not a ball.**
  - Radius is `debris.radiusM` (about 1.5–6x r(0)).
  - Height is `debris.heightM`. The profile is widest at 0.15–0.3 of the height, with a frayed top.
  - Low strength gives a flat skirt (`01_cone_a`: about 5x the funnel width, height ≈ the funnel width). High strength gives a tall bell (`08_debris_a/b`, 10-37-29, 11-04-14). On the biggest wedges it can swallow the lower half (iOvAj, mobile).
- **Density.** Opacity is `0.25 + 0.55·strength` at the core, falling to 0 at the radius, and built from 60–120 overlapping low-alpha cards (0.1–0.35 each).
- **Tone.**
  - Darker than the funnel when front-lit (0.2–0.35): 10-37-29, `01_cone_a`, `01_cone_b`.
  - Brighter and sunlit if the debris stands in the slot light (`08_debris_a`).
  - Grey with low dust, grey-brown with high dust. Saturation follows the same cap as the funnel.
- **Ground contact.**
  - The funnel tip vanishes into the skirt. There is never a hard funnel foot on the grass: sink the funnel below the ground or under the skirt.
  - A thin dust sheet trails 1–2 radii downwind (`08_debris_c`).
  - Cards swirl at about 0.5ω, spread outward and rise slowly (5–10 m/s).

## 5. Multi-vortex, two-cell, rope-out, uncondensed

- **Two-cell.** As `twoCell` rises, the core thins: centre alpha × (1 − 0.4·twoCell). Brightness lifts into a lobed shell, with the outline becoming 3–6 bulges (`08_debris_c`, `06_multivortex_a`).
- **Sub-vortices.** There are `vortices` thin tubes of radius `subvortexRadiusM`.
  - They orbit at 0.6–0.9 of the parent radius at about the peak wind, sorted in front of the funnel.
  - They are 0.15–0.25 darker and bluer than the body (iOvAj, 3JXLF: blue-black blobs inside brown).
  - Each lives a few seconds by seed. Each is a smooth curved tube, not a bead chain (`06_multivortex_b`).
- **Rope-out (decay).**
  - Width follows the engine's r. The edge goes crisp (rough falls), the tone goes uniform, and contortion bends the spline into S and hooked shapes. The lower end can go near-horizontal (`04_rope_b/d`, 15-38).
  - Past `decay` > 0.6, break the tube into segments with 10–30% gaps (`04_rope_c`).
  - Debris shrinks to a 20–40 m bush (`04_rope_a`, 15-38).
- **Uncondensed** (`condensedM` > 0):
  - The funnel tapers to a soft point at `condensedM`; the tip alpha fades over its last 10–20% of length.
  - The debris whirl still forms on the ground under the axis, faint (0.15–0.3).
  - Show a clear gap of sky between them (`07_funnel_a/d`, `05_drillbit_c`).

## 6. Distance

- **5 km.** The full outline, the collar, the debris skirt and the lit/shadow split read. Texture is gone except the slow collar turn and the outline sway (`01_cone_c`, `11_parent_c`).
- **10 km.** Outline plus contact only. Contrast × 0.5–0.6 from haze. Thin ropes (< 30 m) fade to 0.3 alpha; drop them or merge them into one line (`11_parent_c`, `06_multivortex_c`).
- **20 km.** A dark or pale sliver under the base, or only the lowering plus a debris smudge. Contrast × 0.2–0.3 (`11_parent_a`). Keep a minimum pixel width (about 2 px) so it doesn't flicker.
- **Card counts** fall with distance: about 500 cards near, under 80 at 10 km.

## 7. Lab failure modes to avoid

- **Dark ball at the foot.** The debris was a round blob, not a low skirt (`lab_whitecone_darkball_before`).
- **Cauliflower puffs.** Visible round lobes, clouds floating apart from the body (`lab_puffs_wedge`, `lab_contrast_wedge_subvortex`).
- **Straight tube.** A pale, glassy tube with no horn taper, brighter than everything under the base, with a flat cut rim at the top (`lab_real_cone_2026-10-23`, `review_side90`, `lab_debris_contact`).
- **Bead-chain ropes.** Dotted bead chains instead of smooth tubes; a rope rising off at an angle with no base above it (`lab_look_ropeout`).
- **Fat trapezoid.** A uniform grey trapezoid fading into blue sky, with no storm overhead (`lab_cone_2026-10-22`, `lab_life_3_mature`).
- **Mushy trunk.** The trunk was translucent and shapeless, with no edge definition (`lab_refined_trunk`).
- **Debris too small and too brown.** Small, saturated orange-brown tufts at the contact, narrower than the funnel (`lab_debris_contact`, `lab_dust_wall`).
- **Hard lines and glare.** Hard straight lines and tile edges in the base, and a sun glare streak on the funnel (`impostor_front`, `glare_before`).
