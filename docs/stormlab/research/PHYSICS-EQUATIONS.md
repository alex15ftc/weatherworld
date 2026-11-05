# Physics equations for storm construction and visuals (2026-11-03)

A catalogue gathered for the "make the whole storm physics-based" work: formulas, typical supercell values, and what each would drive in the game.

M&R means Markowski & Richardson 2010.

Three forms are unconfirmed:
- the two-stream 3/4 constant;
- the full White / Marticorena-Bergametti flux;
- the umbrella-cloud coefficient.

## Most valuable first

1. **One condensate field.** Adiabatic water content × entrainment dilution → β → τ → opacity and brightness.
2. **Funnel and wall cloud from Δp against the LCL.** Include the lower LCL of rain-cooled, moistened inflow.
3. **Rain, hail and dust as visibility media**, after Koschmieder and Atlas.
4. **Overshoot and anvil from EL, W and N.**
5. **Two-stream brightness.** Use 1/(1 + 0.75(1-g)τ_above) for brightness, and 1 - e^-τ only for opacity.

## A. Cloud construction

### A1. LCL
- z_LCL ≈ 125 m × (T - Td).
- Bolton 1980: T_LCL = 1/(1/(Td-56) + ln(T/Td)/800) + 56.
- Romps 2017 (JAS 74:3891) is exact, via the Lambert W function.

### A2. Pressure-lowered condensation
- Air condenses where p_sfc - Δp ≤ p_LCL, with Δp ≈ ρ g Δz. That is about 1 hPa per 8-10 m.
- Rankine core: Δp(0) = ρV². At 60 m/s that is about 43 hPa.
- Wall cloud: the meso's 1-4 hPa plus the lower LCL of rain-cooled inflow gives 100-300 m of lowering.

### A3. Adiabatic water content
- Γ_ad ≈ 2 g/kg/km near the cloud base (range 1-2.5).
- q_l,ad = q_s(LCL) - q_s(z). Typical values are 4-8 g/kg at mid levels.

### A4. Entrainment
- f (actual/adiabatic) is 0.2-0.6 for cumulus.
- ε ≈ 0.2/R per km (R in km), and f ≈ e^(-εz).
- Wide supercell updrafts (R > 3-5 km) are nearly undilute (Peters et al. 2019 JAS 76:3169; 2020). The control is updraft width, not rotation.
- Visible effect: wide undilute updrafts give crisp, hard towers; narrow diluted ones give ragged towers.

### A5. EL and overshoot
- Cloud top sits at the EL, 12-15 km.
- Overshoot Δz ≈ w_EL/N, with N_strat ≈ 0.02 /s, gives 1-3 km.

### A6. Anvil spreading
- An intrusion at the EL (Woods & Kienle 1994): r ∝ (λNQ)^(1/3) t^(2/3), with λ ~ 0.2-0.8 (unconfirmed).
- Q = πR²w ≈ 10⁹ m³/s. The front speed is about Nh/2 = 10-20 m/s for h = 1-3 km.
- After spreading it is advected by the EL wind, which sets the downshear length. The upshear edge is set by the intrusion speed against the upper wind.

### A7. Mammatus
- Caused by sublimation and radiative cooling under the anvil (Schultz et al. 2006).
- Lobes are 0.5-2 km across and last 10-15 min, where anvil ice lies over air with RH < 100%.

### A8. Evaporation time
- τ ≈ r²/(2 G S), with G ≈ 1e-10 m²/s (Rogers & Yau 7.18).
- Droplet edges evaporate in under a minute; ice anvils last hours.

### A9. Condensate advection
- Semi-Lagrangian advection on the 1 km voxels, with decay at the evaporation rate in subsaturated air.

## B. Precipitation

### B1. Drop sizes and radar relations
- Marshall-Palmer: N₀ = 8e6 m⁻⁴, Λ = 4.1 R^-0.21 mm⁻¹.
- Z = 200 R^1.6 for stratiform rain; Z = 300 R^1.4 for convective rain (WSR-88D).
- M (g/m³) ≈ 3.44e-3 Z^(4/7).
- 50 dBZ corresponds to about 49 mm/h and 2.4 g/m³.

### B2. Rain fall speed
- v = 9.65 - 10.3 e^(-0.6 D) with D in mm (Atlas, Srivastava & Sekhon 1973).
- Multiply by (ρ0/ρ)^0.4 aloft.
- Mass-weighted speed is 5-7 m/s.

### B3. Hail fall speed
- v ≈ 9 √D with D in cm, or v = √(8 g D ρ_h/(3 C_D ρ)) with C_D 0.6.
- A 5 cm stone falls at about 30 m/s.
- Hail stays aloft where w > v, which puts the hail shaft at the vault edge.

### B4. Hail growth
- dM/dt = E (πD²/4) LWC (v - w), about 1 cm per 5 min.
- The size limit is where v(D) = w.

### B5. Rain evaporation
- Kessler: dq_r/dt = -C(1-RH)(ρq_r)^0.525/ρ.
- Cooling dT = -(Lv/cp) dq; 1 g/kg is about 2.5 K. This is what feeds the cold pool physically.

### B6. Loading
- B = g(θv'/θv - q_c - q_r - q_i).
- 1 g/kg of loading is about -0.3 K of θv; 5-10 g/kg can drive a downdraft on its own.

## C. Optics

### C1. Extinction
- β = 3 LWC/(2 ρ_w r_e), with r_e about 10 µm for cloud and 20-30 µm for ice.
- 1 g/m³ gives β ≈ 150 /km, so the cloud body is opaque and only its edges show gradation.
- τ = 1.5 LWP/(ρ_w r_e). A cumulonimbus has τ of 100-300 or more.

### C2. Opacity and scattering
- Opacity = 1 - e^-τ. Single-scattering albedo ≈ 0.9999.
- Henyey-Greenstein phase function: p(θ) = (1-g²)/(4π(1+g²-2g cosθ)^1.5), with g = 0.85 for drops and 0.75 for ice. It gives the silver lining.

### C3. Brightness of thick cloud
- Two-stream: T ≈ 1/(1 + 0.75(1-g)τ) (constant unconfirmed; a variant is 2/(2+τ/μ)), R = 1 - T.
- With g = 0.85 and τ = 200, T ≈ 4%: dark grey bases and white tops.
- Transmission falls as 1/τ, not exponentially.

### C4. Rain, hail and dust visibility
- Koschmieder: V = 3.912/β.
- Rain (Atlas 1953): V ≈ 11.6 R^-0.63 km, so β ≈ 0.25 R^0.63 /km.
  - 100 mm/h gives V ≈ 0.7 km.
  - 10 mm/h gives V ≈ 3 km.
- Hail: β = (π/2)∫N D² dD. A few large stones make translucent white shafts.
- Dust: β = 3C/(2 ρ_p r). Haboobs reach 10-100 m visibility.

### C5. Airlight
- L = L_obj e^-βd + L_sky (1 - e^-βd).
- One β per ray segment: air at 20-40 km visibility, plus precipitation.

### C6. Rayleigh
- τ_R ≈ 0.0088 λ^-4.05 (λ in µm), which is 0.1 at 550 nm.
- Air mass 1/cos z, about 38 at sunset, reddens the sunlight on storms.

### C7. Green storms
- Reddened sunlight through a deep water path (Bohren & Fraser 1993; Gallagher et al. 1996).
- Model as a tint e^(-k_abs(λ)·path), applied when τ is large and the sun is low.

## D. Dynamics and structure

### D1. Buoyancy and updraft speed
- w_max = √(2 CAPE): 77 m/s at 3000 J/kg.
- Observed speeds are 0.5-0.7 of that; wide supercells reach 0.6-0.8 (Peters et al.).

### D2. Pressure perturbations (M&R ch. 8)
- Linear: p'_L ∝ 2ρ (∂v_h/∂z · ∇_h w), which favours the right flank.
- Spin: p'_NL ≈ -ρ(ζ/2)² r². With ζ = 0.01/s at r = 2 km, about -1 hPa. This is the suction under the low-level meso.

### D3. Bunkers storm motion
- V_RM = V_mean(0-6 km) + 7.5 m/s × (shear × k)/|shear|.
- Shear runs from the 0-0.5 km mean wind to the 5.5-6 km mean wind.

### D4. RKW balance
- c = √(2∫B dz). c/ΔU (0-3 km) ≈ 1 gives an upright line; c/ΔU > 1 gives an upshear tilt and surging (Rotunno, Klemp & Weisman 1988).

### D5. Density current
- c = Fr √(g'h). Fr is √2 in theory and 0.7-1 in observations.
- The head is about twice the current's depth. The shelf cloud base sits at the LCL above the head.

### D6. Vortex profiles
- Rankine; Burgers-Rott v = Γ/(2πr)(1 - e^(-r²/r₀²)); Sullivan (two-cell).
- Swirl ratio S:
  - S < 0.2: one-cell rope or stovepipe;
  - S ~ 1: two-cell wedge;
  - S > 1-2: multi-vortex (Church et al. 1979).

### D7. Surface friction
- Log law: u = (u*/κ) ln(z/z₀), κ = 0.4.
- z₀: crops 0.05-0.1 m, grass 0.01-0.03 m, towns 0.5-1 m, forest 1 m.

### D8. Dust lifting
- Threshold u*t ≈ 0.2-0.4 m/s (Marticorena & Bergametti 1995).
- Horizontal flux (form unconfirmed): Q = 2.6 (ρ/g) u*³ (1 + u*t/u*)(1 - u*t²/u*²).
- Vertical flux: F = αQ, with α 1e-5 to 1e-3 /m. Take u* from the vortex wind via the log law (D7).

### D9. Debris lofting
- Debris is lofted when w exceeds its terminal speed √(2mg/(ρ C_D A)).
- Shingles: 15-25 m/s; branches: 20-30 m/s.

## Sources
- Romps 2017: https://romps.berkeley.edu/papers/pubs-2016-lcl.html
- Peters et al. 2019: https://pure.psu.edu/en/publications/the-role-of-vertical-wind-shear-in-modulating-maximum-supercell-u/
- Peters et al. 2020: https://pure.psu.edu/en/publications/are-supercells-resistant-to-entrainment-because-of-their-rotation/
- Bunkers 2000: https://www.weather.gov/media/unr/soo/scm/BKZTW00.pdf
- SPC storm-motion vectors: https://spc.noaa.gov/exper/soundings/help/vectors.html
- Rain extinction review (Atlas 1953): https://core.ac.uk/download/230537853.pdf
- Umbrella clouds: https://people.maths.bris.ac.uk/~maajh/PDFPapers/BullVolcAshClouds.pdf
- Two-stream notes: https://atmos.uw.edu/~sgw/UW-Atmospheric-Radiation-notes/ATMS-533SW-homework&answers.pdf
- Textbooks: Markowski & Richardson 2010; Rogers & Yau 1989; Pruppacher & Klett 1997; Bohren & Clothiaux 2006.
