# Weather World 2.41.2.1 — Tiered SPC Risk Population

The bulk training-population workflow now defaults to the `severe` tier, selecting SPC Day 1 SLGT-or-higher dates. It also supports `complete` (MRGL+) and `outbreak` (ENH+) tiers, while `--minimum-risk` remains available as an explicit override.

Commands:

- `npm run training:populate-slgt-plus`
- `npm run training:populate-mrgl-plus`
- `npm run training:populate-outbreak`
- `npm run training:populate -- --tier severe`

Catalog and state filenames are risk-specific so multiple tiers can coexist without overwriting one another.
