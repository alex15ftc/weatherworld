// Two-layer quasi-geostrophic model: the large-scale flow that weather systems are made of.
// This is the standard doubly periodic form with a prescribed mean wind in each layer (strong
// aloft, weak below). The mean winds stand for the planet's north-south temperature contrast;
// that state is unstable, so waves, troughs and cyclones grow on it, move and decay on their
// own, indefinitely, and look statistically the same everywhere in the domain.
//
// The state is the potential vorticity of the disturbances in an upper (about 250 mb) and a
// lower (about 750 mb) layer:
//   q1 = lap(psi1) + F (psi2 - psi1)        q2 = lap(psi2) + F (psi1 - psi2)
//   dq_i/dt + U_i dq_i/dx + J(psi_i, q_i) + Qy_i dpsi_i/dx = thermal relaxation + drag (lower layer) + damping
//   Qy_1 = beta + F (U1 - U2)               Qy_2 = beta - F (U1 - U2)
// Winds follow from the streamfunctions and the temperature of the air between the layers
// from their difference, so mass, temperature and wind are consistent by construction
// (see docs/ATMOSPHERE-REDESIGN.md).
import { mulberry32 } from '../scenarios/math.js';

const DAY = 86400;

export const QG_DEFAULTS = Object.freeze({
  nx: 128, ny: 64, gridKm: 80,
  f0: 1e-4, beta: 1.6e-11,
  // Internal Rossby radius: sets the size of the systems. Smaller systems carry stronger
  // winds for the same pressure change and come more often (about every 2 days at 350 km,
  // every 3 at 550 km, where the lows were deep but their winds slack).
  deformationRadiusKm: 350,
  // Mean west wind of each layer. Their difference (the shear) decides how strong the systems
  // get: a little more of it and they overshoot, a lot more and they never settle. Adding the
  // same amount to both changes nothing about the systems except how fast they travel, so that
  // is how the strength of the flow aloft is set. The model has no mountains: the wind this
  // leaves near the ground is dealt with where the terrain is (the regional layer).
  upperWindMs: 26.5, lowerWindMs: 17,
  // Radiation pulls the temperature disturbances back toward the mean state; drag slows the
  // lower layer. Together they set how strong the systems get.
  // Surface friction grows with the wind (drag force ~ speed squared): dragDays is the spin-down
  // time in light wind and it shortens as the low-level wind passes dragReferenceMs. This is
  // what stops strong systems from strengthening without limit.
  thermalRelaxationDays: 5, dragDays: 2, dragReferenceMs: 8, dampingHours: 6,
  // Size of the seeded disturbances the run starts from (potential vorticity, 1/s).
  initialNoise: 2e-5,
  timeStepSeconds: 300
});

export class QuasiGeostrophicModel {
  constructor(options = {}) {
    const p = this.params = { ...QG_DEFAULTS, ...options };
    this.nx = p.nx; this.ny = p.ny; this.d = p.gridKm * 1000;
    this.F = 1 / (p.deformationRadiusKm * 1000) ** 2;
    this.lengthX = this.nx * this.d; this.lengthY = this.ny * this.d;
    const n = this.nx * this.ny;
    this.q1 = new Float64Array(n); this.q2 = new Float64Array(n);
    this.psi1 = new Float64Array(n); this.psi2 = new Float64Array(n);
    this.work = Array.from({ length: 8 }, () => new Float64Array(n));
    this.buildTransforms();
    this.reset(options.seed ?? 1);
  }

  // Distance north of the southern edge (m) of row j.
  y(j) { return (j + 0.5) * this.d; }

  reset(seed = 1) {
    const random = mulberry32(Number(seed) >>> 0);
    for (let k = 0; k < this.q1.length; k++) { const noise = this.params.initialNoise * (random() - 0.5); this.q1[k] = noise; this.q2[k] = -noise; }
    this.time = 0; this.history = [];
    this.invert();
  }

  buildTransforms() {
    const { nx } = this;
    this.kCount = Math.floor(nx / 2) + 1;
    this.cos = []; this.sin = [];
    for (let k = 0; k < this.kCount; k++) {
      const c = new Float64Array(nx), s = new Float64Array(nx);
      for (let i = 0; i < nx; i++) { c[i] = Math.cos(2 * Math.PI * k * i / nx); s[i] = Math.sin(2 * Math.PI * k * i / nx); }
      this.cos.push(c); this.sin.push(s);
    }
    this.k2 = Float64Array.from({ length: this.kCount }, (_, k) => (2 - 2 * Math.cos(2 * Math.PI * k / nx)) / (this.d * this.d));
  }

  // Solves (lap - lambda) psi = rhs, periodic in both directions: Fourier in x, a cyclic
  // tridiagonal system in y for each harmonic.
  solve(rhs, lambda, out) {
    const { nx, ny, d, kCount } = this, off = 1 / (d * d);
    const re = new Float64Array(ny), im = new Float64Array(ny), cp = new Float64Array(ny), z = new Float64Array(ny);
    out.fill(0);
    for (let k = 0; k < kCount; k++) {
      const c = this.cos[k], s = this.sin[k];
      for (let j = 0; j < ny; j++) {
        let a = 0, b = 0;
        const row = j * nx;
        for (let i = 0; i < nx; i++) { const v = rhs[row + i]; a += v * c[i]; b -= v * s[i]; }
        re[j] = a / nx; im[j] = b / nx;
      }
      // The domain mean of the streamfunction is arbitrary; a vanishing lambda pins it.
      const diagonal = -2 * off - this.k2[k] - Math.max(lambda, k === 0 ? 1e-13 : 0);
      // Cyclic tridiagonal by Sherman-Morrison: A = B + u v^T with u = (gamma, 0, .., off),
      // v = (1, 0, .., off / gamma).
      const gamma = -diagonal;
      const thomas = values => {
        const first = diagonal - gamma, last = diagonal - off * off / gamma;
        cp[0] = off / first; values[0] /= first;
        for (let j = 1; j < ny; j++) {
          const m = (j === ny - 1 ? last : diagonal) - off * cp[j - 1];
          cp[j] = off / m; values[j] = (values[j] - off * values[j - 1]) / m;
        }
        for (let j = ny - 2; j >= 0; j--) values[j] -= cp[j] * values[j + 1];
      };
      z.fill(0); z[0] = gamma; z[ny - 1] = off;
      thomas(z); thomas(re); thomas(im);
      const denominator = 1 + z[0] + off * z[ny - 1] / gamma;
      const fr = (re[0] + off * re[ny - 1] / gamma) / denominator, fi = (im[0] + off * im[ny - 1] / gamma) / denominator;
      const weight = k === 0 || (nx % 2 === 0 && k === nx / 2) ? 1 : 2;
      for (let j = 0; j < ny; j++) {
        const row = j * nx, a = (re[j] - fr * z[j]) * weight, b = (im[j] - fi * z[j]) * weight;
        for (let i = 0; i < nx; i++) out[row + i] += a * c[i] - b * s[i];
      }
    }
    return out;
  }

  // Streamfunctions from the potential vorticity: the layer mean obeys a Poisson equation,
  // the layer difference a Helmholtz equation.
  invert() {
    const [sum, difference, barotropic, baroclinic] = this.work, n = sum.length;
    for (let i = 0; i < n; i++) { sum[i] = (this.q1[i] + this.q2[i]) / 2; difference[i] = (this.q1[i] - this.q2[i]) / 2; }
    this.solve(sum, 0, barotropic);
    this.solve(difference, 2 * this.F, baroclinic);
    for (let i = 0; i < n; i++) { this.psi1[i] = barotropic[i] + baroclinic[i]; this.psi2[i] = barotropic[i] - baroclinic[i]; }
  }

  index(i, j) { const { nx, ny } = this; return ((j % ny + ny) % ny) * nx + ((i % nx + nx) % nx); }

  // Arakawa (1966) energy- and enstrophy-conserving Jacobian J(psi, q).
  jacobian(psi, q, out) {
    const { nx, ny, d } = this, scale = 1 / (12 * d * d);
    for (let j = 0; j < ny; j++) {
      const jn = ((j + 1) % ny) * nx, js = ((j - 1 + ny) % ny) * nx, jc = j * nx;
      for (let i = 0; i < nx; i++) {
        const e = (i + 1) % nx, w = (i - 1 + nx) % nx;
        const pe = psi[jc + e], pw = psi[jc + w], pn = psi[jn + i], ps = psi[js + i], pne = psi[jn + e], pnw = psi[jn + w], pse = psi[js + e], psw = psi[js + w];
        const qe = q[jc + e], qw = q[jc + w], qn = q[jn + i], qs = q[js + i], qne = q[jn + e], qnw = q[jn + w], qse = q[js + e], qsw = q[js + w];
        out[jc + i] = scale * (
          (pe - pw) * (qn - qs) - (pn - ps) * (qe - qw)
          + pe * (qne - qse) - pw * (qnw - qsw) - pn * (qne - qnw) + ps * (qse - qsw)
          + qn * (pne - pnw) - qs * (pse - psw) - qe * (pne - pse) + qw * (pnw - psw));
      }
    }
    return out;
  }

  laplacian(field, out) {
    const { nx, ny, d } = this, inv = 1 / (d * d);
    for (let j = 0; j < ny; j++) {
      const jn = ((j + 1) % ny) * nx, js = ((j - 1 + ny) % ny) * nx, jc = j * nx;
      for (let i = 0; i < nx; i++) out[jc + i] = (field[jc + (i + 1) % nx] + field[jc + (i - 1 + nx) % nx] + field[jn + i] + field[js + i] - 4 * field[jc + i]) * inv;
    }
    return out;
  }

  tendencies() {
    const { nx, ny, d, F, params: p } = this, n = nx * ny;
    const t1 = new Float64Array(n), t2 = new Float64Array(n);
    const [, , , , j1, j2, lap, lap2] = this.work;
    this.jacobian(this.psi1, this.q1, j1); this.jacobian(this.psi2, this.q2, j2);
    const shear = p.upperWindMs - p.lowerWindMs, gradient1 = p.beta + F * shear, gradient2 = p.beta - F * shear;
    const drag = 1 / (p.dragDays * DAY), half = 1 / (2 * d), relax = F / (p.thermalRelaxationDays * DAY);
    const vorticity2 = this.laplacian(this.psi2, lap);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, e = j * nx + (i + 1) % nx, w = j * nx + (i - 1 + nx) % nx, cooling = relax * (this.psi1[k] - this.psi2[k]);
      t1[k] = cooling - j1[k] - p.upperWindMs * (this.q1[e] - this.q1[w]) * half - gradient1 * (this.psi1[e] - this.psi1[w]) * half;
      const u2 = -(this.psi2[((j + 1) % ny) * nx + i] - this.psi2[((j - 1 + ny) % ny) * nx + i]) * half, v2 = (this.psi2[e] - this.psi2[w]) * half;
      const friction = drag * (1 + Math.hypot(u2, v2) / p.dragReferenceMs);
      t2[k] = -cooling - j2[k] - p.lowerWindMs * (this.q2[e] - this.q2[w]) * half - gradient2 * (this.psi2[e] - this.psi2[w]) * half - friction * vorticity2[k];
    }
    // Scale-selective (biharmonic) damping of the smallest resolved features.
    const nu = d ** 4 / (64 * p.dampingHours * 3600);
    for (const [q, t] of [[this.q1, t1], [this.q2, t2]]) {
      this.laplacian(q, lap); this.laplacian(lap, lap2);
      for (let k = 0; k < n; k++) t[k] -= nu * lap2[k];
    }
    return [t1, t2];
  }

  // One time step (third-order Adams-Bashforth, lower order while starting).
  step() {
    const dt = this.params.timeStepSeconds, now = this.tendencies(), h = this.history, n = this.q1.length;
    const c = h.length >= 2 ? [23 / 12, -16 / 12, 5 / 12] : h.length === 1 ? [1.5, -0.5, 0] : [1, 0, 0];
    for (let layer = 0; layer < 2; layer++) {
      const q = layer ? this.q2 : this.q1, t0 = now[layer], t1 = h[0]?.[layer], t2 = h[1]?.[layer];
      for (let k = 0; k < n; k++) q[k] += dt * (c[0] * t0[k] + (t1 ? c[1] * t1[k] : 0) + (t2 ? c[2] * t2[k] : 0));
    }
    this.history = [now, h[0]].filter(Boolean);
    this.time += dt;
    this.invert();
  }

  advance(seconds) { for (let s = 0; s < seconds - 1e-6; s += this.params.timeStepSeconds) this.step(); }

  // Thickness (psi1 - psi2) of the mean state at a distance north (m): it thins northward,
  // which is the colder air there.
  meanThickness(northM) { return -(this.params.upperWindMs - this.params.lowerWindMs) * northM; }

  // Physical fields at a grid point (i east, j north; both wrap around).
  fieldsAt(i, j) {
    const { d, params: p } = this, k = this.index(i, j);
    const wind = (psi, mean) => ({ u: mean - (psi[this.index(i, j + 1)] - psi[this.index(i, j - 1)]) / (2 * d), v: (psi[this.index(i + 1, j)] - psi[this.index(i - 1, j)]) / (2 * d) });
    const upper = wind(this.psi1, p.upperWindMs), lower = wind(this.psi2, p.lowerWindMs);
    // Streamfunctions including the mean flow (not periodic northward), on the unwrapped row.
    const north = this.y(j), total1 = this.psi1[k] - p.upperWindMs * north, total2 = this.psi2[k] - p.lowerWindMs * north;
    const thickness = total1 - total2;
    return {
      upperWind: upper, lowerWind: lower,
      // The lower layer's weather systems alone (its streamfunction without the mean flow).
      lowerDisturbanceStreamfunction: this.psi2[k],
      midWind: { u: (upper.u + lower.u) / 2, v: (upper.v + lower.v) / 2 },
      // Surface: the lower-layer flow carried down to 1000 mb along the shear.
      surfaceWind: { u: lower.u - 0.5 * (upper.u - lower.u), v: lower.v - 0.5 * (upper.v - lower.v) },
      surfaceStreamfunction: total2 - 0.5 * thickness,
      midStreamfunction: (total1 + total2) / 2,
      // Mean temperature of the 250-750 mb layer (K, relative to the southern edge; hydrostatic).
      layerTemperatureK: p.f0 * thickness / (287 * Math.log(3))
    };
  }
}
