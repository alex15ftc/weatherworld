# Docs

Durable technical context, not session transcripts. Current posture is in `../ai_state/`, not here.

| Lane | Purpose |
|------|---------|
| `spec/` | Intended product: ideation record, feature index, north star, system design, area specs. Start with `spec/README.md`. Not filled yet. |
| `ARCHITECTURE.md`, `ROBLOX-*.md`, `HOSTING.md` | How the engine, the Roblox place and the hosting work today (architecture lane) |
| `STATUS.md`, `stormlab/STATUS.md`, `cloudlab/STATUS.md` | Working logs: measurements and what was applied, dated. Long by design; the short current picture is `../ai_state/CURRENT.md`. |
| `runbooks/` | Operational procedures (setup, QA, release, deploy, rollback) |
| `history/` | Superseded plans and dated context |
| `research/`, `visuals-research/`, `tornado-physics/`, `storm-reference/`, `tornado-reference/`, `radar-compare/`, `front-maps-2026-10-12/` | Research notes and references |
| `stormlab/`, `cloudlab/`, `storm-visuals/`, `visuals/` | Per-area design, plans and logs |
| `METEOROLOGIST-REVIEW-*.md`, `TARGETS-*.md`, `FIX-PLAN-*.md`, `MESOANALYSIS-AUDIT-*.md` | Dated reviews and plans (evidence, not current authority) |
| `REVIEWER-BRIEF.md` | What the `meteorologist-reviewer` agent reads first |

Existing files keep their paths (scripts, tools and other docs link to them). New superseded material goes in
`history/`; new procedures in `runbooks/`.
