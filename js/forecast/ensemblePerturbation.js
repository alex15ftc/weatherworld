// What a forecast does not know about the atmosphere. Every forecast run (a member of an
// outlook) starts from the atmosphere as it is, but has its weather systems travel a little
// faster or slower than the model will really move them: a timing error of its own, the
// commonest way a real forecast goes wrong. The error in where a system is grows with every
// hour, so the runs agree closely about the next few hours, less about tomorrow and less
// again about the day after; an outlook made from them is vaguer the further ahead it looks.
// (Tried first and set aside: small differences in the starting state of the large-scale
// model. They grow by only about a third a day there, so Day 3 was hardly vaguer than Day 1.)
import { mulberry32 } from '../scenarios/math.js';

export const TIMING = Object.freeze({
  // How much the runs differ in the speed of their systems (m/s, standard deviation). The
  // systems travel at about 22 m/s. 1.2 m/s puts a run's systems about 50 km out halfway
  // through Day 1, 155 km through Day 2 and 260 km through Day 3.
  spreadMs: 1.2
});

export const UPSTREAM = Object.freeze({
  // How different a run's weather far upstream is: the size of its difference there as a
  // share of the model's own potential vorticity (rms).
  share: 0.5,
  // Nothing differs within knownKm west of the middle of the map; the difference is full
  // from fullKm west of it (about two days' travel for a system) and fades out again well
  // before coming round the belt to the map's eastern side.
  knownKm: 700, fullKm: 4200, fadeFromKm: 6200, fadeToKm: 8200,
  // The waves the difference is made of: this many around the belt (from, to) and across it.
  wavesAround: [5, 14], wavesAcross: 5
});

function generator(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return mulberry32(hash >>> 0);
}

// Gives a run its own weather upstream of the map: changes the large-scale model in place
// (potential vorticity of both layers, by waves the size of weather systems, only where the
// envelope above allows) and brings its winds up to date. mapCentreM: where the middle of the
// map is along the belt (m).
export function perturbUpstream(model, seed, mapCentreM, share = UPSTREAM.share) {
  if (!(share > 0)) return model;
  const { nx, ny } = model, n = nx * ny, random = generator(seed), length = nx * model.d;
  const rms = field => Math.sqrt(field.reduce((sum, v) => sum + v * v, 0) / n);
  const ramp = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  const envelope = Float64Array.from({ length: nx }, (_, i) => {
    const west = ((((mapCentreM - (i + 0.5) * model.d) % length) + length) % length) / 1000;   // km upstream of the map
    return ramp(west, UPSTREAM.knownKm, UPSTREAM.fullKm) * (1 - ramp(west, UPSTREAM.fadeFromKm, UPSTREAM.fadeToKm));
  });
  for (const q of [model.q1, model.q2]) {
    const wave = new Float64Array(n);
    for (let kx = UPSTREAM.wavesAround[0]; kx <= UPSTREAM.wavesAround[1]; kx++) for (let ky = 0; ky <= UPSTREAM.wavesAcross; ky++) {
      const amplitude = random() - 0.5, phaseX = 2 * Math.PI * random(), phaseY = 2 * Math.PI * random();
      for (let j = 0; j < ny; j++) { const across = Math.cos(2 * Math.PI * ky * j / ny + phaseY); for (let i = 0; i < nx; i++) wave[j * nx + i] += amplitude * across * Math.cos(2 * Math.PI * kx * i / nx + phaseX); }
    }
    const scale = share * rms(q) / (rms(wave) || 1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) q[j * nx + i] += scale * envelope[i] * wave[j * nx + i];
  }
  model.invert();
  return model;
}

// A run's timing error (m/s; positive: its systems run ahead), drawn from its seed.
export function timingErrorMs(seed, spreadMs = TIMING.spreadMs) {
  const random = generator(`timing|${seed}`), a = Math.max(1e-12, random()), b = random();
  return spreadMs * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}
