// The world's cells in a compact form, for the copies the forecast runs start from
// (server/ForecastPool.js shareState, js/forecast/DayOneOutlook.js stateFromBytes).
//
// v8.serialize writes every key of every object again: the 2,500 cells (about 30 small objects
// each, 189 numbers) came to 11.7 MB of a 13.7 MB snapshot, mostly property names. Here each
// distinct set of keys (a shape: about 20 of them) is written once, the numbers go into one
// Float64Array and everything else (strings, booleans, null, typed arrays) into one list, in the
// order a walk meets them. Decoding builds the same objects with the same keys in the same order
// and the same numbers to the last bit, so a run from it goes exactly as one from the plain copy
// (measured 2026-11-10: 13.7 -> 8.1 MB, read back in ~65 ms against ~165).
// Shared references inside the cells are not kept (there are none: each cell's objects are its own).

const NUMBER = -1, OTHER = -2, ARRAY = -3;

export function encodeCells(cells) {
  const shapes = new Map(), keysOf = [], tags = [], numbers = [], other = [];
  const walk = v => {
    if (typeof v === 'number') { tags.push(NUMBER); numbers.push(v); return; }
    if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v) || v instanceof Map || v instanceof Set || v instanceof Date) { tags.push(OTHER); other.push(v); return; }
    if (Array.isArray(v)) { tags.push(ARRAY, v.length); for (let i = 0; i < v.length; i++) walk(v[i]); return; }
    const keys = Object.keys(v), signature = keys.join('\u0000');
    let shape = shapes.get(signature);
    if (shape === undefined) { shape = keysOf.length; shapes.set(signature, shape); keysOf.push(keys); }
    tags.push(shape);
    for (const key of keys) walk(v[key]);
  };
  walk(cells);
  return { compactCells: 1, shapes: keysOf, tags: Int32Array.from(tags), numbers: Float64Array.from(numbers), other };
}

export const isCompactCells = value => value?.compactCells === 1;

export function decodeCells({ shapes, tags, numbers, other }) {
  let t = 0, n = 0, o = 0;
  const read = () => {
    const tag = tags[t++];
    if (tag === NUMBER) return numbers[n++];
    if (tag === OTHER) return other[o++];
    if (tag === ARRAY) { const length = tags[t++], out = new Array(length); for (let i = 0; i < length; i++) out[i] = read(); return out; }
    const out = {};
    for (const key of shapes[tag]) out[key] = read();
    return out;
  };
  return read();
}
