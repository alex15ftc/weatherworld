// The tornado as particle emitters (the way Severity builds its funnel: many soft, overlapping,
// see-through smoke puffs), worked out from the engine's description of the tornado
// (js/storms/StormAppearance.js). One description serves both the browser preview
// (js/pages/particleSim.js) and, later, the Roblox client, which turns each emitter into a
// ParticleEmitter on a part:
//   - the part sits at `position` (studs, from the tornado's ground point; y up) and turns about
//     the vertical at `spin` radians a second; with LockedToPart the puffs turn with it, which is
//     how the funnel is seen to rotate;
//   - puffs appear on a ring (`shape: 'ring'`, radius) or in a disc or a column, `rate` a second,
//     live `lifetime` seconds, and change size and transparency over their life as Roblox's
//     NumberSequences do ([[time 0-1, value]]);
//   - `texture` names a 4x4 flipbook sheet (data/cloud-textures/<texture>-sheet4x4.png); each
//     puff shows one frame picked at random.
// The funnel's shape is the engine's: a ring of puffs at each height, as wide as the condensation
// funnel there (funnelRadiusM), leaning and twisting as it does, and only where it is condensed.
// Nothing here picks a look by the tornado's type name.

export const PARTICLES = Object.freeze({
  maxSize: 300,          // studs; the largest particle drawn (Roblox's own limit is not documented: to verify in Studio)
  maxRate: 400,          // a second per emitter (Roblox; 100 on mobile)
  maxLifetime: 20,
  rings: 16,             // funnel rings from the condensed tip to just under the cloud base
  top: 0.9,              // the highest ring, as a share of the height: above it the funnel flares into the wall cloud
  overlap: 4,            // puffs along a ring per (circumference / puff size)
  life: [3, 4.5],        // a funnel puff's life, s
  spinScale: 0.35,       // the wind's turning (rad/s) shown at this share, so it reads rather than blurs
  maxSpin: 2.5
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// scale: { tornadoStudsPerMetre, skyStudsPerMetre, kmStuds } (World/Config.luau).
export function tornadoEmitters(storm, scale = { tornado: 1, sky: 1, km: 1000 / 1.609344 }) {
  const t = storm.tornado, P = PARTICLES, out = [];
  if (!t) return out;
  const touch = clamp(t.touch ?? 1, 0, 1), height = t.baseM * scale.sky;
  const radii = t.funnelRadiusM.map(r => r * scale.tornado), n = radii.length;
  const radiusAt = f => {
    const x = clamp(f, 0, 1) * (n - 1), i = Math.min(Math.floor(x), n - 2), a = radii[i], b = radii[i + 1];
    return a <= 0 || b <= 0 ? (x - i < 0.5 ? a : b) : lerp(a, b, x - i);
  };
  const lean = [t.tiltEastM / 1000 * scale.km, -t.tiltNorthM / 1000 * scale.km];
  const axis = (f, clock = 0) => {
    const w = (t.contortion ?? 0) * 0.12 * height * Math.sin(f * Math.PI * 2.5 + 1.7) * Math.sin(f * Math.PI);
    const len = Math.hypot(...lean), side = len > 1e-6 ? [-lean[1] / len, lean[0] / len] : [1, 0];
    return [lean[0] * f + side[0] * w, f * height, lean[1] * f + side[1] * w];
  };
  // The wind turning at the core, shown slower so it reads as rotation.
  const windMs = (t.windMph ?? 80) * 0.44704;
  const spinAt = r => clamp(P.spinScale * windMs / Math.max(8, r / scale.tornado), 0.15, P.maxSpin);
  const wrap = clamp(t.rainWrap ?? 0, 0, 1);
  // Grey, lit by Roblox's light; darker in rain and with dust drawn up the lower funnel.
  const funnelColour = [lerp(196, 120, wrap), lerp(198, 124, wrap), lerp(204, 132, wrap)];
  const dustColour = lerp(0, 1, t.debris?.dust ?? 0) > 0.5 ? [140, 112, 82] : [96, 84, 72];

  // Where there is cloud: from the condensed tip (or as far down as it has come) to the base.
  let bottom = 1;
  for (let k = 0; k <= 100; k++) if (radiusAt(k / 100) > 0) { bottom = k / 100; break; }
  bottom = Math.max(bottom, 1 - touch);
  const thick = clamp(0.55 + ((t.windMph ?? 80) - 65) / 300, 0.55, 0.9); // stronger: denser funnel
  for (let k = 0; k < P.rings && bottom < P.top - 0.02; k++) {
    // Rings closer together toward the tip, where the shape changes fastest.
    const f = bottom + (P.top - bottom) * (k / (P.rings - 1)) ** 1.3;
    const r = Math.max(2, radiusAt(f)), size = clamp(r * 1.6, 10, P.maxSize);
    const around = (2 * Math.PI * r) / size * P.overlap, life = P.life;
    const rate = clamp(Math.ceil(around / ((life[0] + life[1]) / 2)) + 2, 3, P.maxRate);
    const tip = f < bottom + 0.08;
    out.push({
      name: `funnel${k}`, texture: 'smoke', position: axis(f), shape: 'ring', radius: Math.max(0, r - size * 0.3), // a puff shows about 0.6 of its size
      spin: spinAt(r), rate, lifetime: life,
      size: [[0, size * 0.75], [0.5, size], [1, size * 1.15]],
      transparency: [[0, 1], [0.2, 1 - thick * (tip ? 0.6 : 1)], [0.75, 1 - thick * (tip ? 0.6 : 1)], [1, 1]],
      speed: [0, 2], acceleration: [0, 2 + 8 * (1 - f) * (1 - f), 0], color: f < 0.1 && t.debris?.strength > 0.3 ? funnelColour.map((c, i) => lerp(lerp(dustColour[i], c, 0.4), c, f / 0.1)) : funnelColour,
      lightInfluence: 1, zOffset: 0
    });
  }
  // Below the condensed tip: the vortex itself, a faint whirl of dust.
  if (bottom > 0.03 && touch > 0.3) {
    const r = Math.max(4, t.coreRadiusM * scale.tornado);
    out.push({ name: 'vortex', texture: 'dust', position: [0, 0, 0], shape: 'column', radius: r, height: bottom * height, spin: spinAt(r) * 1.4,
      rate: clamp(Math.ceil(bottom * height / 15), 4, 60), lifetime: [1.5, 2.5], size: [[0, clamp(r * 0.8, 6, P.maxSize)], [1, clamp(r * 1.4, 10, P.maxSize)]],
      transparency: [[0, 1], [0.3, 0.86], [1, 1]], speed: [0, 1], acceleration: [0, 18, 0], color: dustColour, lightInfluence: 1 });
  }
  // The dust cloud at the base: a wide, low, dark skirt, thrown outward and up.
  const debris = t.debris ?? { strength: 0, radiusM: 0, heightM: 0 };
  if (touch > 0.4 && debris.strength > 0.02) {
    const r = Math.max(10, debris.radiusM * scale.tornado), h = Math.max(15, debris.heightM * scale.tornado), size = clamp(r * 0.5, 20, P.maxSize);
    out.push({ name: 'dustCloud', texture: 'dust', position: [0, 0, 0], shape: 'disc', radius: r * 0.7, spin: spinAt(r) * 0.8,
      rate: clamp(Math.ceil(20 + 120 * debris.strength * (r / 200)), 10, P.maxRate), lifetime: [2.5, 4.5],
      size: [[0, size * 0.5], [0.4, size], [1, size * 1.5]], transparency: [[0, 1], [0.15, 0.45 + 0.3 * (1 - debris.strength)], [0.7, 0.7], [1, 1]],
      speed: [r * 0.04, r * 0.1], direction: 'out', acceleration: [0, h / 30, 0], color: dustColour, lightInfluence: 1 });
  }
  // Smaller vortices turning round the core: each a thin column of puffs, carried round.
  if ((t.vortices ?? 1) > 1) {
    const count = Math.round(t.vortices), orbit = Math.max(6, t.coreRadiusM * scale.tornado * 0.85), sub = Math.max(3, (t.subvortexRadiusM ?? 5) * scale.tornado);
    for (let v = 0; v < count; v++) out.push({
      name: `sub${v}`, texture: 'smoke', position: [0, 0, 0], shape: 'column', radius: sub * 0.5, height: height * 0.5,
      orbit: { radius: orbit, phase: (2 * Math.PI * v) / count, rate: spinAt(orbit) * 1.6 },
      spin: spinAt(sub) * 2, rate: 30, lifetime: [1.2, 2], size: [[0, clamp(sub * 1.8, 6, P.maxSize)], [1, clamp(sub * 2.6, 8, P.maxSize)]],
      transparency: [[0, 1], [0.2, 0.45], [0.8, 0.55], [1, 1]], speed: [0, 1], acceleration: [0, 10, 0], color: funnelColour, lightInfluence: 1
    });
  }
  return out;
}

// The wall cloud above the tornado (or the storm's, while none is down): a slowly turning ring
// of dark puffs hanging from the base.
export function wallCloudEmitters(storm, scale = { sky: 1, km: 1000 / 1.609344 }) {
  const w = storm.wallCloud, P = PARTICLES;
  if (!w || w.strength < 0.03) return [];
  const r = w.radiusKm * scale.km, lower = Math.max(30, w.loweringM * scale.sky), size = clamp(r * 0.6, 30, P.maxSize);
  return [{ name: 'wallCloud', texture: 'smoke', position: [0, -lower / 2, 0], shape: 'disc', radius: r * 0.85, spin: 0.05 + 0.3 * (w.rotation ?? 0),
    rate: clamp(Math.ceil((r / size) ** 2 * 3), 10, P.maxRate), lifetime: [5, 8], size: [[0, size], [1, size * 1.3]],
    transparency: [[0, 1], [0.2, 0.3], [0.8, 0.3], [1, 1]], speed: [0, 1], acceleration: [0, lower / 40, 0], color: [96, 100, 108], lightInfluence: 1 }];
}
