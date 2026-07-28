# Internal API Contracts

## Authority boundary
The weather authority owns the seeded world, simulation clock, atmospheric state, storms and checkpoints. Product pages are thin clients.

## Forecast boundary
Forecast modules receive issuance-time atmospheric features and uncertainty descriptors. They return immutable product data and may not mutate the world state.

## Historical boundary
Historical repositories expose normalized records with explicit provenance. Forecast selectors return atmosphere-only summaries. Scenario selectors may additionally expose requested scenario metadata.

## Stability expectations
- Public module exports require regression coverage.
- Serialized checkpoints require version fields and migration handling.
- Product endpoints must preserve seed and cycle identity across navigation.
- Derived fields should identify their source time and valid time.
