import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weatherworld-2391-'));
const manifests = path.join(root, 'manifests');
const cache = path.join(root, 'cache');
const tensorDir = path.join(cache, 'era5', 'spatial', '2024-05-06');
fs.mkdirSync(manifests, { recursive: true });
fs.mkdirSync(tensorDir, { recursive: true });
const output = path.join(root, 'features.json');
const npz = path.join(tensorDir, 'atmosphere.npz');
const python = process.env.PYTHON ?? 'python';

const generator = String.raw`
import numpy as np, sys
p=sys.argv[1]
t,r,c=4,20,20
y,x=np.mgrid[0:r,0:c]
cape=np.zeros((t,r,c),dtype='float32')
for i in range(t): cape[i]=300 + i*100 + 2500*np.exp(-((y-(5+i*2))**2/18 + (x-(4+i*3))**2/50))
d2m=np.stack([275 + .35*x + .1*y + i for i in range(t)]).astype('float32')
msl=np.stack([101500 - 22*x + 6*y - i*20 for i in range(t)]).astype('float32')
tcwv=np.stack([15 + .7*x + .1*y for _ in range(t)]).astype('float32')
arrays={'surface__cape':cape,'surface__d2m':d2m,'surface__msl':msl,'surface__tcwv':tcwv}
for level,u,v in [(850,10,8),(500,25,15),(250,45,20)]:
 arrays[f'level_{level}__u']=np.full((t,r,c),u,dtype='float32') + x*.2
 arrays[f'level_{level}__v']=np.full((t,r,c),v,dtype='float32') + y*.1
np.savez_compressed(p,**arrays)
`;
let result = spawnSync(python, ['-c', generator, npz], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
fs.writeFileSync(path.join(manifests, '2024-05-06.json'), JSON.stringify({
  eventDate: '2024-05-06', storage: { externalCacheRelativePath: 'era5/spatial/2024-05-06/atmosphere.npz' }
}, null, 2));
result = spawnSync(python, ['scripts/extract-era5-spatial-features.py', '--manifest-root', manifests, '--cache-root', cache, '--output', output], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const payload = JSON.parse(fs.readFileSync(output, 'utf8'));
const record = payload.records['2024-05-06'];
assert.equal(record.available, true);
assert.equal(record.featureCount, 28);
assert.ok(record.features.capeCoverage1000Direct > 0);
assert.ok(record.features.capeCentroidX >= 0 && record.features.capeCentroidX <= 1);
assert.ok(record.features.capeCentroidY >= 0 && record.features.capeCentroidY <= 1);
assert.ok(record.features.capeCorridorOrientationDeg >= 0 && record.features.capeCorridorOrientationDeg < 180);
assert.ok(record.features.jetCoreP90Ms > 40);
assert.ok(record.features.pressureGradientP90PaCell > 0);
assert.ok(record.features.forcingInstabilityOverlapDirect >= 0 && record.features.forcingInstabilityOverlapDirect <= 1);
console.log('2.39.1 spatial feature diagnostics regression: PASS');
