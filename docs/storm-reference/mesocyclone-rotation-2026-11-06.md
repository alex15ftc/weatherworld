# Mesocyclone rotation against environment (2026-11-06)

This is the observational reference for js/storms/SpinBudget.js (docs/research/ENGINE-PHYSICS-PLAN.md, Phase 2 step 1). The numbers are as published unless marked as inferred.

## Low-level rotational velocity (radar, 0.5 degree scan, about 0.3-3 km up)

Smith, Thompson, Dean and Marsh 2015, "Diagnosing the Conditional Probability of Tornado Damage Rating Using Environmental and Radar Attributes", WAF 30:914-932 (https://origin-east-www-spc.woc.noaa.gov/publications/smith/vrot-env.pdf):
- Vrot = (|Vin| + |Vout|) / 2, the peak per event, from 3392 supercell tornado events in 2009-13.
- A supercell needs Vrot of at least 10 m/s by their definition.

| Supercell tornado | Median peak Vrot (kt) | m/s | Median STP |
|---|---|---|---|
| EF0 | 34 | 17.5 | 1.9 |
| EF1 | 40 | 20.6 | 2.6 |
| EF2 | 50 | 25.7 | 3.4 |
| EF3 | 63 | 32.4 | 4.6 |
| EF4+ | 73 | 37.6 | 8.4 |

- QLCS tornadoes are weaker: medians of 30, 34 and 38 kt for EF0-2.
- At least 90% of events below 30 kt were EF0-1. Violent tornadoes favour 90 kt or more.
- The values are peaks, so they run higher than typical, and they are biased low with range.

Thompson et al. 2017, "Tornado Damage Rating Probabilities Derived from WSR-88D Data", WAF 32:1509-1528 (https://repository.library.noaa.gov/view/noaa/54858):
- 1530 tornadic and 4673 nontornadic events, 2014-15.
- Most cases are at or below 39 kt (20 m/s). Almost all above 60 kt are right-moving supercells.
- 18% of severe-report supercells were tornadic.
- **Nontornadic supercells: no published median.** By definition they are at least 10 m/s, and they are mostly below 20 m/s, so about 10-15 m/s (inferred).

## Sizes and the vorticity scale

- **AMS Glossary:** a mesocyclone is about 2-10 km across, with vorticity "on the order of 10^-2 s^-1 or greater".
- **Operational nomograms:** they assume about 6.5 km across (Andra 1997, via COMET).
- **Solid-body check:** Vrot is about zeta R / 2, so 0.01 /s over a 3.25 km radius gives about 16 m/s, which fits.

## Updraughts and the w-zeta correlation

- **Observed peak w:**
  - 36-53 m/s (Marinescu et al. 2020, MWR; Musil et al. 1986; Bluestein et al. 1988; Markowski et al. 2018);
  - about 65 m/s in the strongest dual-Doppler case (Peters and Nowotarski 2019; unverified).
- **Simulated supercells** (Weisman and Klemp 1984; Weisman and Rotunno 2000, JAS 57:1452): the linear w-zeta correlation in the updraught is 0.6-0.8 for half-circle hodographs, 0.4-0.6 for quarter-circle and 0.2-0.4 for straight ones. Pressure forcing supplies 40-60% of the peak updraught.
- **Davies-Jones (1984):** the correlation follows the environment's relative helicity, the streamwise share of the horizontal vorticity. SpinBudget uses that share as its tilting efficiency.
- **Not found:** a published Vrot/w ratio. Radar Vrot of 15-30 m/s against w of 40-60 m/s implies about 0.3-0.6 (inferred).
