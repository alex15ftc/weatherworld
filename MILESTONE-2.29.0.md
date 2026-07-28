# Milestone 2.29.0 — Profile CIN and Cap Evolution

This release makes the vertical thermodynamic profile the authoritative source for CAPE, signed CIN, CIN magnitude, lapse rates, and STP components.

## Included

- Profile-derived SB/ML/MU CIN with explicit signed and magnitude fields.
- Shared profile diagnostics for soundings, mesoanalysis, forecast logic, and verification.
- Persistent cap state with erosion, rebuilding, tendency, and breach state.
- Cap-break probability, expected timing, timing windows, confidence, and reason.
- Separate initiation probability and conditional tornado/hail/wind intensity.
- Cap-aware outlook environment projection.
- 0–1 km, 0–3 km, 700–500 mb, and 850–500 mb lapse rates.
- Sounding/mesoanalysis consistency through canonical thermodynamic fields.
- STP component diagnostics.
- Cap evolution and multi-step CIN regression coverage.
- Legitimate cap-bust days: initiation no longer forces a fallback storm.
