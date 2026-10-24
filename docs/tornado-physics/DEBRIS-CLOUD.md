# The debris / dust cloud at the contact: types and causes

Research brief (2026-10-23) behind `roblox/src/shared/Tornado/DebrisCloud.luau`.

Confidence:
- **[E] established:** peer-reviewed, or several sources agree
- **[L] LES or lab:** shown in simulation or a vortex chamber
- **[G] guess:** our own calibration; tune by eye

## Physics

### Corner flow and swirl ratio S
A thin inflow layer, tens of metres deep, feeds the core and turns upward at the "corner". Loose material is picked up there.

How it turns up depends on the swirl ratio S (rotation versus through-flow). In lab chambers [E/L]:
- below about 0.1, no vortex at the surface
- a vortex breakdown (where the narrow jet suddenly widens) sits just above the ground at about 0.45
- the vortex turns two-celled at about 0.5
- multiple suction vortices appear above about 1

These thresholds can be off by about ×2 between setups.

In Lewellen's LES (which uses a corner swirl ratio Sc, about 3S):
- low swirl: a central jet
- medium swirl: an annular (ring) updraft
- high swirl: secondary vortices

### Centrifuging
Debris clouds are hollow and wider than the core. Close-range radar shows a weak-echo hole ringed by debris (Dowell et al. 2005) [E].

### Gong / Lewellen controls [L]
- **Sc** (corner swirl ratio): sets the vortex structure.
- **Aa = V²/(rc g)** (centrifuging strength): higher Aa gives a wider (R/rc up) but lower (H/rc down) cloud.
- **Av = V/wt** (ease of lofting; wt is the particle's terminal fall speed): higher Av gives more mass and a taller, wider cloud.
- **Interior cone angle:** grows with Sc and Aa and shrinks with Av.
- **Mass** peaks at medium swirl.

Terminal fall speeds: 1 mm sand about 7 m/s, 20 µm dust about 0.03 m/s, leaves and shingles a few to about 15 m/s.

### Debris loading [L]
- It weakens the lowest winds by 30–60%.
- It raises the effective swirl.
- Fine dust and strong winds smother suction vortices into one ring.
- The cloud takes about 2 minutes to mature and peaks after the intensity peak.
- At a forward speed of 15 m/s, pickup is strongly lopsided, with a separate dust patch in the inflow.

### Lofting
The dust threshold is a wind of about 6 m/s at 2 m (3.5–11), rising with soil moisture [E]. Almost any tornado exceeds it over dry bare soil. **Whether loose material is available (moisture, ground cover) matters more than wind strength.**

### Radar debris signature [E]
About 16% of tornadoes show one, mostly EF3+. Its size and height grow with EF rating and width. Lofted debris inside the tornado is larger than outside it (size sorting).

### Suction vortices [E]
At Mulhall 1999 they were about 250 m apart, with half their shear inside 50 m. At El Reno 2013 they moved at 0–79 m/s on looping paths.

## Appearances (R, H relative to rc, the radius of maximum wind)

1. **Dust whirl under a lifted funnel.** R 1–2 rc, tens of metres up to about 100 m. Thin, soil-coloured, flickering. Surface winds are above the lofting threshold, but the pressure drop is too small to bring condensation down.
2. **Skirt / collar.** A low wide ring, R 1.5–3 rc, H 0.3–1 rc, bell-shaped, ejecting outward with fallout at the edge. Caused by a two-celled vortex plus centrifuging (a low annulus) [L].
3. **Debris ball / dense cloud.** Opaque dark, R 2–4 rc, a bowl with a hollow centre. EF3+, with buildings or trees. Builds over about 2 minutes.
4. **Dust-sheathed (High Plains, dry fields).** Fine dust (wt ≈ 0) rides the updraft annulus up the outside of the funnel: a tall column or cone, tan or red. It can smother suction vortices.
5. **Multiple-vortex spray.** 2–6 bright jets at about rc, rising higher than the ring, on looping paths. High swirl with a modest dust supply; heavy loading merges them into a ring.
6. **Landspout.** A narrow, tall dust column (one-cell, low swirl), often before condensation appears.
7. **Waterspout spray ring.** A white spray ring a few funnel widths across, tens of metres high. Large drops fall back fast.
8. **Clean contact.** Wet ground, grass or crops: little or nothing.
9. **Rope stage.** Small, intermittent puffs; small rc.
10. **Wedge.** The debris merges into a funnel that reaches the ground; grey above, brown below.
11. **Rain-wrapped.** Low contrast, behind precipitation curtains.

## The model used (DebrisCloud.luau)

**Inputs (sliders):**
- intensity: EF rating → peak speed V
- core radius rc: from width
- swirl ratio S
- forward speed U and direction
- ground:
  - `loose`: material available, 0–1
  - `moisture`: 0–1
  - `fines`: share of fine dust versus coarse debris
  - `color`
  - `water`: spray instead of dust

**Derived [trends L/E; coefficients G]:**
- **Threshold:** Vt = 10 m/s × (1 + 1.5 m).
- **Supply:** F = loose × (1 − 0.7 m) × clamp((V² − Vt²) / 50², 0, 1).
- **Matured level:** F smoothed with time constant τ (research says about 120 s; the lab uses a shorter τ).
- **Aa** = V² / (rc g).
- **Skirt radius:** R = rc × clamp(1.2 + 0.4 log10 Aa + 0.5 min(S, 2), 1, 4).
- **Skirt height:** Hc = rc × clamp(1.5 − 0.35 log10 Aa, 0.3, 1.5).
- **Dust column height:** Hd = min(cloud base, Kd × rc × (V/50)^0.6) × fines × (1 − 0.6 m).
- **Cone half-angle:** θ = 15° + 12.5° × min(S, 2) + 5° × log10 Aa.
- **Hollow centre:** 0.65 rc × smoothstep(0.25, 0.5, S); a column below that.
- **Pickup:** where the field's ground wind exceeds Vt, weighted by (speed/V)³. This gives the right-of-track asymmetry, and the suction vortices' own pickup, automatically.
- **Loading:** L = loose × fines × (V/60)² × (1 − m).
- **Spikes:** at the wind field's own sub-vortices (`WindField.subVortex`). Their strength is the field's sub-vortex share × (1 − L), rising to about 1.5 Hc.
- **Swirl:** at 0.75 × the field's tangential speed.
- **Coarse debris:** ejected outward at about 0.3 V, decaying over a couple of seconds, then ballistic back down.
- **Fine dust:** rises at about 0.2 V (faster as a central jet at low S) up a cone of angle θ, and fades at Hd.

Main sources: Lewellen, Gong & Lewellen (AMS SLS 2004, 2006), Church et al. 1979, Dowell et al. 2005, Wurman 2002, Wurman & Kosiba 2013, Van Den Broeke & Jauernic 2014, Bodine et al. 2013, Knox et al. 2013, the NWS spotter guides, and the WMO Cloud Atlas.

## Fix: debris starting at the contact (2026-10-23)

The debris appeared in mid-air instead of at the ground contact. Causes:
1. Sprites faded in over 15% of their life, so dust had risen tens of studs before it showed.
2. Each sprite's image sat 30–35% of its height above its particle.
3. Coarse debris was picked up anywhere out to 0.9 R.
4. Fine dust was equally opaque all the way up, and grew and spread with height, so the cloud's mass read as a plume hanging at mid-height.

Fixes:
- Sprites fade in over 0.35 s (`fadeInTime`).
- At the ground a sprite is centred 0.05 × its height up, so its lower half is sunk below the ground and the cloud starts at the contact with a flat bottom. This blends to normal once it has risen its own height (`lift`, `groundLift`).
- Coarse debris is picked up within 1.6 rc (`pickupReach`), where the wind is strongest, then thrown out.
- Dust opacity falls as (1 − z/H)^0.9 and sprites start at 0.6 × size, so it is densest and most compact at the ground.
- `dustHeight` is 5 (was 10).
- More sprites and pickups, because pickups are rejection-sampled on the wind and many tries fail.

Frame: `docs/tornado-reference/lab_debris_contact_2026-10-23.png`.
