// The outer model after its spin-up, kept on disk. A fresh world first runs the outer model
// for weeks from noise (AtmosphereWorld's spinUpDays), which takes most of a minute, and the
// same seed always comes out the same; so the result is saved the first time
// (data/cache/spinup/) and read back after that. The key holds the seed, the length of the
// spin-up, the model's settings and the text of the model's own code: change any of them and
// the spin-up is run afresh. A model read back steps on exactly as the one that was saved.
//   WEATHER_SPINUP_CACHE=off runs every spin-up in full; WEATHER_SPINUP_CACHE=<dir> moves the files.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { QuasiGeostrophicModel, QG_DEFAULTS } from './QuasiGeostrophicModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCES = ['js/atmosphere/QuasiGeostrophicModel.js', 'js/scenarios/math.js'];
// What a model carries from one step to the next (the rest is worked out afresh each step).
const FIELDS = ['q1', 'q2', 'psi1', 'psi2', 'moisture', 'rain', 'ascentCooling', 'surfaceTheta', 'surfaceMoisture'];
let codeHash = null;

function cacheDir() {
  const setting = process.env.WEATHER_SPINUP_CACHE;
  if (setting === 'off') return null;
  return setting ? path.resolve(setting) : path.join(ROOT, 'data/cache/spinup');
}

function keyFor(options, seconds) {
  codeHash ??= crypto.createHash('sha1').update(SOURCES.map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\0')).digest('hex');
  return crypto.createHash('sha1').update(JSON.stringify({ code: codeHash, params: { ...QG_DEFAULTS, ...options }, seconds })).digest('hex').slice(0, 20);
}

// A model with these settings run `seconds` from its start, from the cache when it is there.
export function spunUpModel(options, seconds) {
  const dir = cacheDir();
  const run = () => { const model = new QuasiGeostrophicModel(options); model.advance(seconds); return model; };
  if (!dir || !(seconds > 0)) return run();
  let file;
  try { file = path.join(dir, `qg-${options.seed ?? 1}-${keyFor(options, seconds)}.bin`); } catch { return run(); }
  try {
    const saved = v8.deserialize(fs.readFileSync(file)), model = new QuasiGeostrophicModel(options);
    // (What v8.deserialize gives are views of the whole file's bytes; the history is copied out
    // of them so that a world saved later does not carry the file along.)
    for (const key of FIELDS) model[key].set(saved[key]);
    model.time = saved.time; model.history = saved.history.map(set => set.map(values => values && values.slice()));
    return model;
  } catch { /* not saved yet, or unreadable: run it */ }
  const model = run();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, v8.serialize({ ...Object.fromEntries(FIELDS.map(key => [key, model[key]])), time: model.time, history: model.history }));
    fs.renameSync(temporary, file);
  } catch { /* a cache that cannot be written is only slower */ }
  return model;
}
