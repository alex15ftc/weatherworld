# Research: wall cloud, scud, horizontal vortices (2026-10-25)

Collected for the storm lab's billboard storms. [S] = from a source (abstract, NWS page or full text); [E] = textbook or engineering estimate (a tunable default).

## Wall cloud

- **Main cause [S]:** most air entering the wall-cloud base comes from the forward-flank (FFD) outflow, which is rain-cooled and moister. Its lower lifting condensation level (LCL) lowers the base (Atkins, Glidden & Nicholson 2013, 2014: VORTEX2).
- **Pressure deficit [S]:** near the circulation centre a strongly rotating wall cloud lowers further from adiabatic cooling under a deficit of more than 10 hPa.
- **Rising scud [S]:** scud rising into the base is a third proposed mechanism.
- **Size and place [S]:** a localized, abrupt lowering 0.5–8 km across (commonly 1–4 km) under the rain-free base, on the inflow side.
- **Tail cloud [S]:** points from the wall cloud toward the FFD rain.

### Equations

- **LCL:** z_LCL ≈ 125 m × (T − Td) (Lawrence 2005; exact form: Romps 2017). Each 1 K less dewpoint depression lowers the base about 125 m.
- **Pressure-deficit lowering:** Δz ≈ Δp / (ρ g) ≈ 8.5 m per hPa.
- **Rankine deficit:** Δp_centre = ρ V². Inside the core, p = p∞ − ρV²(1 − r²/2R²); outside, p = p∞ − ρV²R²/(2r²).
- **Bernoulli term for scud:** Δp = ½ρ(v₂² − v₁²). Inflow accelerating from 5 to 25 m/s gives about 3.6 hPa, roughly 30 m of lowering. Scud therefore forms only in air already within about 0.3 K of saturation (outflow edges, under the wall cloud).

### Typical values

| Quantity | Value |
|---|---|
| Lowering below the main base | 100–1000 m (often 200–500) [E] |
| Rotation | 10–25 m/s at r ≈ 0.5–1.5 km [E] |
| Ascent | 5–15 m/s in the wall cloud, scud 2–10 m/s [E] |
| Inflow and tail-cloud flow | 10–25 m/s [E] |
| Scud | 20–300 m fragments, 100–600 m below the base [E] |
| Tail cloud | 1–5 km long, a few hundred m thick [E] |
| Edges | laminar and sharp on the updraft side (10–50 m transition), ragged on the RFD/outflow side; banding 50–300 m, wrapping cyclonically [E] |

## Horizontal vortices (HVs) near strong tornadoes

- **Formation [S] (Oliveira et al. 2019, *Atmosphere* 10, 716):** HVs form at the surface (friction) around the tornado base and in the rear-flank downdraft (RFD) outflow to its S–SE.
- **Motion [S]:** they revolve counter-clockwise in the outer flow, line up just outside the core (ring-like), most in an arc from S to E, and rise abruptly at the tornado's edge.
- **Visibility [S] (Houser et al. 2016):** once caught by the accelerating flow they stretch and condense under their own cyclostrophic pressure drop. Tubes can be only a few m wide.
- **Lifetime [S]:** larger ones persist; small ones distort quickly and are swept up.
- **Where seen [S]:** violent tornadoes (Tuscaloosa 2011, Moore 2013, El Reno 2011), mostly while strengthening or mature.
- **Condensation test [E]:** a tube condenses where ρ v_HV² ≥ ρ g (z_LCL − z). In near-saturated outflow (about 1 K depression, ~125 m) that takes v ≈ 35 m/s.

| Feature | Size | Speed | Height | Life | Where |
|---|---|---|---|---|---|
| Near-surface HV (visible tube) | condensation a few m to ~30 m; 50–500 m long | orbits at the outer flow, 20–60 m/s; vorticity ≥ 0.15 s⁻¹ | 0–200 m, rising at the edge | tens of s (small) to 1–3 min (large) | S→E arc, 1–3 core radii |
| RFD-outflow HV | 50–300 m | vorticity ~0.1 s⁻¹ | near the ground, rising slowly | minutes | S–SE |
| Kelvin–Helmholtz rotors (gust front) | λ ≈ 7 δ; Ri < 0.25 | | low levels | minutes | RFD gust front |

**Swirl-ratio regimes [S] (Davies-Jones 1973, S = r₀Γ / 2Qh), in order of rising S:**
1. one-cell vortex
2. bubble (vortex breakdown aloft)
3. drowned vortex jump
4. two-cell (S ≈ 0.5)
5. multiple vortices (S > 1)

**Near-surface swirl [S] (Lewellen):** can reach about 2.5× the swirl aloft near a corner-flow swirl ratio of 1.2.

## Sources

- Atkins et al. 2013, 2014 (AMS Radar and SLS conferences).
- NWS spotter glossary and handouts.
- Lawrence 2005 (*BAMS*); Romps 2017 (*JAS* 74).
- Oliveira, Xue, Roberts, Wicker & Yussouf 2019 (*Atmosphere* 10, 716).
- Houser, Bluestein & Snyder 2016 (*MWR* 144).
- Wurman & Kosiba 2013 (*WAF* 28); Orf et al. 2017 (*BAMS* 98).
- Weiss, Skinner & Reinhart 2013; Wurman et al. 2014; Bluestein et al. 2018.
- Lewellen & Lewellen 2000, 2006; Michalke 1964.

## Tornado debris and dust cloud

**Physics**
- **Inflow jet [S] (Lewellen):** surface friction drives a shallow, fast inflow jet (10–50 m deep) that turns upward near the core radius; this corner flow does the lofting.
- **Supply limits it [E]:** under a tornado the soil's threshold is exceeded by far (u* ≈ 4.5 m/s against u*_t ≈ 0.25 m/s), so the amount of dirt depends on the ground (soil, moisture, structures).
- **Centrifuging [S] (Dowell et al. 2001, 2005):** heavy particles are flung outward, leaving a hollow core inside a ring.
- **Loading [S] (Bodine et al. 2016):** debris loading above 0.1 kg/kg cuts near-surface wind 30–60% and saturates the cloud.
- **Height [S] (Bodine 2013; Van Den Broeke & Jauernic 2014):** the radar debris signature grows taller with EF rating.

**Equations**

| Quantity | Formula | Values |
|---|---|---|
| Threshold friction velocity (Shao & Lu 2000) | u*_t = 0.111 √((ρp/ρa) g d + γ/(ρa d)) | ~0.25 m/s at d = 75 µm; several-fold higher on moist soil |
| Friction velocity | u* = 0.4 U / ln(z/z0) | ~4.5 m/s for U = 60 m/s at 10 m, z0 = 0.05 m; dust flux ∝ u*³ |
| Fall speed w_t | Stokes law, then drag-law fits | dust (10–50 µm) 0.01–0.2 m/s; fine sand 0.6; medium sand 2; coarse sand 8; gravel ~15; debris 5–40 |
| Outward slip | u_slip ≈ w_t v²/(g r) | at v = 60 m/s, r = 100 m: dust 0.03 m/s, sand 7 m/s, gravel > 50 m/s |

A particle stays up while the updraft w exceeds w_t.

**Dimensions [E]:** skirt radius ~1.5–3 R_core; visible height ~10–100 m (weak), 100–500 m (strong), 0.5–1 km+ (violent); the streaks climb at 20–45°.

**Look:**
- a dense dark skirt hugging the ground, flaring out and up
- cyclonically climbing streaks, with thin dust above blending into the funnel
- chunks orbiting outside and flung off along tangents
- a clearer core
- colour by soil: red clay, tan silt, dark wet farmland; nothing over wet grass

**Sources:**
- Kok et al. 2012 (*Rep. Prog. Phys.*, including Shao & Lu 2000)
- Dowell, Wurman & Wicker 2001; Dowell et al. 2005 (*MWR* 133)
- Bodine et al. 2013 (*WAF*), 2016 (*JAS*)
- Gong, Lewellen & Lewellen 2006; Lewellen, Gong & Lewellen 2008 (*JAS* 65)
- Van Den Broeke & Jauernic 2014 (*JAMC* 53)
