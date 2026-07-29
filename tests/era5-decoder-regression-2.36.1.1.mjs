import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/acquire-era5-training.py', import.meta.url), 'utf8');

assert.equal(source.includes('xr.open_datasets'), false, 'xarray.open_datasets does not exist and must not be used');
assert.match(source, /xr\.open_dataset\(/, 'decoder must use xarray.open_dataset');
assert.match(source, /filter_by_keys/, 'decoder must explicitly filter heterogeneous GRIB messages');
assert.match(source, /"typeOfLevel": "isobaricInhPa"/, 'pressure-level fields must use the isobaric level type');
assert.match(source, /"shortName": short_name/, 'each requested variable must be selected by GRIB short name');
assert.match(source, /"indexpath": ""/, 'temporary extraction must not leave cfgrib index files in the corpus');
assert.match(source, /ERA5 extraction was incomplete\. Missing fields:/, 'missing fields must produce an actionable failure');
assert.match(source, /pressure\.unlink\(missing_ok=True\)/, 'raw pressure data is deleted only after successful extraction');
assert.match(source, /surface\.unlink\(missing_ok=True\)/, 'raw surface data is deleted only after successful extraction');

console.log('2.36.1.1 ERA5 decoder regression tests passed.');
