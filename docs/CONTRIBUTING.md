# Contributing

## Branching
Create one branch per milestone, for example `milestone/2.34.1`. Merge to `main` only after milestone tests pass.

## Source of truth
`docs/ROADMAP.md` defines milestone order. Architecture documents define invariants. A code change that alters an invariant must update the corresponding document in the same commit.

## Commit scope
Prefer small commits organized as schema, implementation, tests and documentation. Do not commit raw weather archives, credentials, caches or generated files that can be rebuilt.

## Required checks
Before merging:
1. Run the current milestone suite.
2. Run affected prior regression suites.
3. Confirm deterministic behavior for fixed seeds.
4. Confirm no forecast-outcome leakage.
5. Record known limitations in the milestone document.

## Data changes
New datasets require a manifest containing source, retrieval date, variables, coverage, processing version and licensing notes.
