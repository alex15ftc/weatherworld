# WeatherWorld 2.66.2 — Hierarchical Risk Nesting Repair

This release adds a strict post-topology hierarchy validator to the issued categorical outlook.

- No adjacent cells may differ by more than one categorical tier.
- Missing parent tiers are reconstructed around higher-risk children.
- 8-neighbor adjacency is used, including diagonal transitions.
- Parent buffers are preferred; child cells are reduced only when a parent repair cannot converge.
- Diagnostics report invalid transitions, parent cells added, child cells reduced, repair passes, and unresolved transitions.
- Raw hazard-derived risks remain available beside the final issued risk.
