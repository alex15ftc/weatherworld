# 2.42.1 distribution cleanup

Removed from the distributable ZIP because these are generated, cached, or repository-local artifacts:

- `.git/` history and objects;
- `node_modules/` (restore with `npm install`);
- `verification-runs/`;
- `data/historical/cases/`;
- `data/historical/rasterized/`;
- `data/historical/spc-cases/`;
- `data/analogs/merged-storm-events.csv`;
- Python bytecode, rejected patches, and partial downloads.

Compact normalized historical records, training features, the SQLite archive, source code, and tests remain included. Large regenerated datasets should live in the external training cache rather than inside the source distribution.
