# Boundaries, squall-line tornadoes and landspouts: literature numbers (2026-10-25)

This was gathered for the engine's boundary and non-supercell tornado work. Sources marked
*second-hand* were read through citations in other papers, not in full. Anything marked as an
estimate is not from a paper.

## Tornadoes near boundaries

**How many form near a boundary.**
- In VORTEX-95, nearly 70% of 47 F1+ tornadoes formed between 10 km on the warm side and 30 km
  on the cool side of a boundary that existed before the storm (Markowski, Rasmussen & Straka 1998,
  *WAF* 13:852, via Garner 2012, *EJSSM* 7(5)). This is one field season, not a national figure.
- Two-thirds of significant tornadoes formed within 20 km of a boundary (citing the same work).

**How much SRH increases, from one well-measured case.** TORUS, 28 May 2019, EF2 tornado (Axon et
al. 2024, *MWR* 152):

| | Warm air mass | Cool side |
|---|---|---|
| 0-1 km SRH (m²/s²) | 80 | 296-302 |
| 0-3 km SRH (m²/s²) | 148 | 373-461 |
| 0-1 km shear (m/s) | 6.7 | 15-19.5 |
| LCL | | about 160 m lower |

**Boundaries matter most where the large-scale shear is weak.** Garner 2012 compared 52 boundary
and 33 warm-sector F2+ tornadoes:

| | Boundary | Warm sector |
|---|---|---|
| 0-1 km SRH from 40 km model soundings (m²/s²) | 197 | 283 |
| 850 mb wind (m/s) | 13 | 21 |
| Storm speed (m/s) | 12 | 20 |
| Tornado path, median / mean (km) | 15 / 18 | 20 / 42 |

CAPE was similar in both groups. The coarse model soundings do not resolve the boundary.

**Mechanisms:**
- winds back on the cool side, giving convergence and pooled moisture (Maddox, Hoxit & Chappell 1980);
- horizontal vorticity made by the temperature contrast on the cool side is tilted and stretched
  by the updraft (Markowski et al. 1998; Rasmussen et al. 2000).

*Estimate:* (g/θ)·Δθ/Δx for 3 K over 10 km is about 1e-5 s⁻²; over 15-30 min that is about +100-200
m²/s² of SRH.

**Side and motion:**
- Tornadoes favour the cool side, out to about 30 km.
- Storms moving along a boundary rotate earlier and stronger than storms crossing it (Atkins,
  Weisman & Wicker 1999, *MWR* 127:2910, *second-hand*).
- Deep in the cold air, storms become elevated and weaker.
- The SRH enhancement can last hours after the contrast fades (NWS preprint, weak source).

## Squall-line (QLCS) tornadoes

**Share of US tornadoes:**
- 18% (Trapp et al. 2005, *WAF* 20:23); 25% of tornado days nationally.
- 13.8% pure, 25.3% with embedded supercells (Smith et al. 2012, *WAF* 27:1114).
- About 21% (Ashley et al. 2019, via Thompson 2023).

**Ratings** (Smith et al. 2012): EF0 46%, EF1 44%, EF2 9.5%, EF3 0.7%, EF4+ 0%. More at night and in
the cool season.

**Ingredients** (Schaumann & Przybylinski 2012):
- the cold pool and the 0-3 km line-normal shear roughly balanced;
- that shear at 15 m/s or more (a soft limit: 46% of mesovortices formed below it, Ungar & Coniglio);
- a rear-inflow surge or bow.

**Lifetimes:** tornadic mesovortices about 76 min, non-tornadic about 32 min (Atkins et al. 2004,
*second-hand*). Warning lead time about 5 min.

## Landspouts and other non-supercell tornadoes

**Share:**
- 11% of US tornadoes, 87% of them EF0 (Smith et al. 2012).
- A third or more near the Colorado Front Range and in south Florida, mostly in summer.

**Mechanism:** small vortices on a convergence boundary (shearing instability) are stretched by
young updrafts within about 30 min of first echo (Wakimoto & Wilson 1989, *MWR* 117:1113).

**Environment** (Caruso & Davies 2005; NWS):
- 0-2 km lapse rate about 9 C/km;
- 0-3 km MLCAPE about 100 J/kg or more;
- 0-1 km SRH under 50 m²/s²;
- 0-6 km shear 25 kt or less (35 kt at most);
- a wind change of 10-20 kt along the line;
- a contrast of about 3 K.

The SPC Non-Supercell Tornado parameter combines these. Durations are a few minutes (not verified).

## Tornado-day frequency in May (SPC database 1995-2023, 12Z-12Z days)

| Area | Days with ≥1 tornado | Days with ≥3 | Days with ≥10 | Mean tornadoes per day |
|---|---|---|---|---|
| CONUS | 81% | 60% | 29% | 8.8 |
| Plains box about 500 x 500 mi (34-41N, 94-103W) | 34% | 22% | 11% | 3.1 |

The 83% tornado-day target matches the whole country in May, about 2.5 times a fixed 500-mile
region. The engine's region moves each day to where the weather is (RegionSteering), which is what
makes a CONUS-like rate plausible for it.
