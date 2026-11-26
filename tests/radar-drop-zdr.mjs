// Rain's differential reflectivity drop by drop (PrecipitationField.js dropVerticalShare): a lone drop's
// ZDR grows with its size as it flattens (Brandes et al. 2002 axis ratios, Rayleigh r^(-7/3)), within the
// published single-drop values at S band, so sorted big drops read a ZDR arc of 3-5 dB.
import assert from 'node:assert/strict';
import { dropVerticalShare } from '../js/storms/PrecipitationField.js';

const zdrDb = mm => -10 * Math.log10(dropVerticalShare(mm));
const want = { 1: [0.05, 0.3], 2: [0.5, 1.0], 3: [1.2, 2.0], 4: [2.0, 2.8], 5: [2.8, 3.8], 6: [3.6, 4.8] };
for (const [mm, [lo, hi]] of Object.entries(want)) {
  const v = zdrDb(Number(mm));
  assert.ok(v >= lo && v <= hi, `a ${mm} mm drop's ZDR ${v.toFixed(2)} dB, expected ${lo}-${hi}`);
}
let last = -Infinity;
for (let mm = 0.25; mm <= 8; mm += 0.25) { const v = zdrDb(mm); assert.ok(v >= last - 1e-9, `ZDR grows with size (${mm} mm)`); last = v; }
assert.ok(Math.abs(zdrDb(0)) < 1e-12, 'a vanishing drop is round');
console.log(`drop ZDR: ${[1, 2, 4, 6, 7].map(mm => `${mm} mm ${zdrDb(mm).toFixed(2)} dB`).join(', ')}`);
