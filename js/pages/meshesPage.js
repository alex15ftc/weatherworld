// Preview of the stylized storm meshes (js/meshes/stylized.js), before any are uploaded.
//   One / Variants   a mesh, or nine of its seeds, with its shape settings on sliders
//   Tornado          the funnel Roblox builds live, from the replay's tornado (roblox/src/
//                    worlddata/StormReplay, scripts/export-storm-replay.mjs), frame by frame
//   Storm scene      the replay's storm put together from the meshes, as the game will
// Sizes in the tornado and scene views are studs, at the place's scale (World/Config.luau).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ParticleSystem } from './particleSim.js';
import { tornadoEmitters, wallCloudEmitters } from '../meshes/tornadoParticles.js';
import * as Stylized from '../meshes/stylized.js';
const { MESHES, funnelMesh, FUNNEL, triangleCount } = Stylized;
// The static meshes are made once per seed and settings, and their buffers kept; only the
// funnel changes from frame to frame.
const kept = new WeakSet();
const memo = make => { const made = new Map(); return (...args) => { const key = JSON.stringify(args); if (!made.has(key)) { const mesh = make(...args); kept.add(mesh); made.set(key, mesh); } return made.get(key); }; };
const puffMesh = memo(Stylized.puffMesh), anvilMesh = memo(Stylized.anvilMesh), shelfMesh = memo(Stylized.shelfMesh), wallCloudMesh = memo(Stylized.wallCloudMesh);
const curtainMesh = memo(Stylized.curtainMesh), debrisMesh = memo(Stylized.debrisMesh), scudMesh = memo(Stylized.scudMesh);
for (const spec of Object.values(MESHES)) spec.make = memo(spec.make);

// As World/Config.luau: up at 1 stud a metre, across a tornado 1 stud a metre, the map 1000 studs a mile.
const SKY = 1, TOR = 1, KM = 1000 / 1.609344;
const RANGES = {
  detail: [0, 3, 1], lobes: [0, 10, 1], lobeSize: [0, 1, 0.01], flatBase: [0, 0.6, 0.01], lumps: [0, 0.5, 0.01],
  sides: [5, 24, 1], spread: [0, 1, 0.01], edge: [0, 0.5, 0.01], sag: [0, 0.8, 0.01], slices: [2, 12, 1], slope: [0, 1, 0.01],
  steps: [0, 4, 1], rag: [0, 0.4, 0.01], taper: [0.3, 1.2, 0.01], pouches: [1, 15, 1], flare: [0, 0.6, 0.01], flutes: [0, 0.4, 0.01],
  rings: [4, 30, 1], jag: [0, 0.4, 0.01], size: [100, 3000, 10], speed: [0, 4, 0.05]
};
const COLOUR = { tower: '#e2e2e6', towerLow: '#b2b5bd', base: '#3e414a', anvil: '#d6d8de', wall: '#34373e', shelf: '#4e5662', rain: '#5c6674', funnel: '#808084', funnelWrapped: '#46484e', debris: '#463e36', ground: '#76864a' };

const $ = id => document.getElementById(id);
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fb4c8');
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1e6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight('#d4dfec', '#6b6450', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
sun.position.set(0.6, 1, 0.35);
scene.add(sun);
const content = new THREE.Group();
scene.add(content);
// The particle tornado (tornadoParticles.js), with the textures from scripts/cloud-textures.mjs.
const particles = new ParticleSystem(scene, name => `./data/cloud-textures/${name}-sheet4x4.png`);
const REPLAY_VIEWS = new Set(['tornado', 'scene', 'particles']);
// A tornado baked from a Blender file (data/tornado-bake/<name>, scripts in the 2026-10-15 notes):
// 8 views, every 45 deg round it, each an 8x8 flipbook of its life. Shown as an upright card that
// turns to face the camera, using the view nearest the camera's direction. The file frames a
// square 129.2 units across with the ground 1.5 units above the bottom edge.
const BAKED = { name: 'tz_0037_cone_R', views: 8, grid: 8, fps: 6, groundShare: 1.5 / 129.2, size: 700, speed: 1 };
const baked = { card: null, sheets: [], time: 0 };
function bakedCard() {
  if (baked.card) return baked.card;
  const loader = new THREE.TextureLoader();
  for (let a = 0; a < BAKED.views; a++) {
    const t = loader.load(`./data/tornado-bake/${BAKED.name}/sheet_angle_${String(Math.round(360 * a / BAKED.views)).padStart(3, '0')}_${BAKED.grid}x${BAKED.grid}.png`);
    t.colorSpace = THREE.SRGBColorSpace; baked.sheets.push(t);
  }
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: baked.sheets[0] }, frame: { value: 0 }, grid: { value: BAKED.grid } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float frame; uniform float grid; varying vec2 vUv; void main() { float col = mod(frame, grid), row = floor(frame / grid); vec4 t = texture2D(map, (vec2(col, grid - 1.0 - row) + vUv) / grid); gl_FragColor = t; if (t.a < 0.004) discard; }',
    transparent: true, depthWrite: false
  });
  baked.card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  scene.add(baked.card);
  return baked.card;
}
function updateBaked(dt) {
  const card = bakedCard();
  card.visible = state.mesh === 'baked';
  if (!card.visible) return;
  baked.time += dt * BAKED.speed;
  const frames = BAKED.grid * BAKED.grid;
  card.material.uniforms.frame.value = Math.floor(baked.time * BAKED.fps) % frames;
  card.scale.set(BAKED.size, BAKED.size, 1);
  card.position.set(0, BAKED.size * (0.5 - BAKED.groundShare), 0);
  // Turn to face the camera about the vertical, and show the view taken from that side. Blender's
  // y runs north (three's -z); the file's camera looks from -y, the first view.
  const yaw = Math.atan2(camera.position.x, camera.position.z);
  card.rotation.set(0, yaw, 0);
  const blenderYaw = Math.atan2(-camera.position.z, camera.position.x), first = -Math.PI / 2;
  const view = ((Math.round((blenderYaw - first) / (2 * Math.PI / BAKED.views)) % BAKED.views) + BAKED.views) % BAKED.views;
  card.material.uniforms.map.value = baked.sheets[view];
  baked.view = view;
}
function showBaked() {
  clear();
  const group = new THREE.Group(); content.add(group);
  add(Stylized.puffMesh(1, { flatBase: 0.5, lumps: 0.05 }), COLOUR.ground, { scale: [8000, 2, 8000], at: [0, -1, 0], parent: group });
  add(Stylized.debrisMesh(99), '#a05a40', { scale: [30, 20, 30], at: [250, 10, 200], parent: group }); // a 30-stud house, for scale
  bakedCard();
  info(`Baked: ${BAKED.name}
view ${baked.view ?? 0} of ${BAKED.views} (nearest your direction), frame ${Math.floor(baked.time * BAKED.fps) % (BAKED.grid * BAKED.grid)} of 64
card ${BAKED.size} studs; Shape sliders: size, speed
Red box: a 30-stud house.`);
  if (!state.framedBaked) { camera.position.set(0, 60, 1500); controls.target.set(0, 300, 0); state.framedBaked = true; }
}

const state = { mode: 'single', mesh: 'baked', seed: 1, settings: {}, frame: 1, playing: false, replay: null, spin: 0 };

const geometries = new WeakMap();
function geometryOf(mesh) {
  if (geometries.has(mesh)) return geometries.get(mesh);
  const g = new THREE.BufferGeometry();
  if (kept.has(mesh)) geometries.set(mesh, g);
  else g.userData.temporary = true;
  g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  g.computeVertexNormals(); // corners are not shared, so every face is flat
  return g;
}
const materials = new Map();
function material(colour, opacity = 1) {
  const key = `${colour}|${opacity}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshLambertMaterial({ color: colour, flatShading: true, transparent: opacity < 1, opacity, side: THREE.FrontSide }));
  return materials.get(key);
}
function add(mesh, colour, { scale = [1, 1, 1], at = [0, 0, 0], yawDeg = 0, opacity = 1, parent = content } = {}) {
  const m = new THREE.Mesh(geometryOf(mesh), material(colour, opacity));
  m.scale.set(...scale); m.position.set(...at); m.rotation.y = -THREE.MathUtils.degToRad(yawDeg);
  parent.add(m);
  return m;
}
function clear() {
  for (const child of [...content.children]) { content.remove(child); child.traverse?.(o => { if (o.geometry?.userData.temporary) o.geometry.dispose(); }); }
}
function frame(object, distance = 2.2) {
  const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()).length() || 1, centre = box.getCenter(new THREE.Vector3());
  controls.target.copy(centre);
  camera.position.copy(centre).add(new THREE.Vector3(0.9, 0.45, 1).normalize().multiplyScalar(size * distance / 2));
  camera.near = size / 500; camera.far = size * 50; camera.updateProjectionMatrix();
}

// --- The replay ------------------------------------------------------------------------------

async function loadReplay() {
  if (state.replay) return state.replay;
  const dir = './roblox/src/worlddata/StormReplay/';
  const meta = await (await fetch(dir + 'Meta.luau')).text();
  const count = Number(meta.match(/frames = (\d+)/)?.[1] ?? 0), stormId = meta.match(/stormId = "([^"]+)"/)?.[1], touchdown = Number(meta.match(/touchdownFrame = (\d+)/)?.[1] ?? 1);
  if (!count) throw new Error('No replay: run node scripts/export-storm-replay.mjs');
  const frames = await Promise.all(Array.from({ length: count }, async (_, i) => {
    const text = await (await fetch(`${dir}F${String(i + 1).padStart(3, '0')}.luau`)).text();
    return JSON.parse(text.slice(text.indexOf('[==[') + 4, text.indexOf(']==]')));
  }));
  state.replay = { frames, stormId, touchdown };
  $('frame').max = count; state.frame = Math.min(count, touchdown + 3); $('frame').value = state.frame;
  return state.replay;
}
// The focus storm at a fractional frame: numbers blended between frames; a tornado in only one
// of them is touching down or lifting (touch).
function stormAt(f) {
  const { frames, stormId } = state.replay, i = Math.min(Math.floor(f), frames.length - 1), u = Math.min(1, f - i);
  const a = frames[i - 1]?.storms.find(s => s.id === stormId), b = (frames[i] ?? frames[i - 1]).storms.find(s => s.id === stormId);
  const blend = (x, y) => x == null ? y : y == null ? x : typeof x === 'number' && typeof y === 'number' ? x + (y - x) * u
    : Array.isArray(x) && Array.isArray(y) ? x.map((v, k) => blend(v, y[k])) : typeof x === 'object' && typeof y === 'object' ? Object.fromEntries(Object.keys({ ...x, ...y }).map(k => [k, blend(x[k], y[k])])) : (u < 0.5 ? x : y);
  if (!a && !b) return null;
  const s = blend(a, b);
  if (s.tornado) s.tornado.touch = a?.tornado && b?.tornado ? 1 : b?.tornado ? u : 1 - u;
  return s;
}

// --- Views -----------------------------------------------------------------------------------

function showSingle() {
  clear();
  const spec = MESHES[state.mesh], mesh = spec.make(state.seed, state.settings);
  const m = add(mesh, spec.colour, { scale: [10, 10, 10] });
  frame(m, 2.4);
  info(`${state.mesh}: ${triangleCount(mesh)} triangles\n${spec.note}\nUnit cube: in Roblox, MeshPart.Size = its size in studs.`);
}
function showGrid() {
  clear();
  const spec = MESHES[state.mesh];
  for (let k = 0; k < 9; k++) add(spec.make(state.seed + k, state.settings), spec.colour, { scale: [10, 10, 10], at: [(k % 3 - 1) * 14, 0, (Math.floor(k / 3) - 1) * 14] });
  frame(content, 1.6);
  info(`${state.mesh}: seeds ${state.seed}-${state.seed + 8}\n${spec.note}`);
}

const tornadoGroup = new THREE.Group();
function funnelParts(s, parent, origin) {
  const t = s.tornado, touch = Math.max(0, Math.min(1, t.touch ?? 1));
  const height = t.baseM * SKY, lean = [t.tiltEastM / 1000 * KM, -t.tiltNorthM / 1000 * KM];
  const colour = new THREE.Color(COLOUR.funnel).lerp(new THREE.Color(COLOUR.funnelWrapped), Math.min(1, t.rainWrap ?? 0)).getStyle();
  const funnel = funnelMesh({ radiiStuds: t.funnelRadiusM.map(r => r * TOR), heightStuds: height, leanX: lean[0], leanZ: lean[1], lowest: 1 - touch, wobble: t.contortion, spin: state.spin, seed: 7, ...state.settings });
  add(funnel, colour, { at: origin, parent });
  if (t.vortices > 1) {
    const orbit = Math.max(6, t.coreRadiusM * TOR * 0.85), sub = Math.max(3, t.subvortexRadiusM * TOR);
    for (let k = 0; k < Math.round(t.vortices); k++) {
      const a = state.spin * 0.6 + Math.PI * 2 * k / Math.round(t.vortices);
      const radii = Array.from({ length: 9 }, (_, i) => i < 5 ? sub * (1 + i * 0.5) : 0);
      add(funnelMesh({ radiiStuds: radii.map(r => r || 0.0001), heightStuds: height * 0.9, leanX: lean[0] * 0.5, leanZ: lean[1] * 0.5, lowest: 1 - touch, spin: state.spin * 2, seed: k + 3, sides: 7, rings: 8 }), colour,
        { at: [origin[0] + Math.cos(a) * orbit, origin[1], origin[2] + Math.sin(a) * orbit], parent });
    }
  }
  const dr = Math.max(8, t.debris.radiusM * TOR), dh = Math.max(10, t.debris.heightM * TOR);
  if (touch > 0.5 && t.debris.strength > 0.05) for (let k = 0; k < 18; k++) {
    const a = state.spin * (0.7 + (k % 5) * 0.08) + k * 2.1, r = dr * (0.4 + 0.6 * ((k * 0.618) % 1)), h = ((state.spin * 0.05 + k * 0.137) % 1) * dh;
    add(debrisMesh(k + 1), COLOUR.debris, { scale: [6, 3, 7].map(v => v * (1 + (k % 3))), at: [origin[0] + Math.cos(a) * r, origin[1] + h, origin[2] + Math.sin(a) * r], yawDeg: k * 40, parent });
  }
  return { height, colour };
}
function showTornado() {
  clear();
  const s = stormAt(state.frame);
  const group = new THREE.Group(); content.add(group);
  add(puffMesh(1, { flatBase: 0.5, lumps: 0.05 }), COLOUR.ground, { scale: [6000, 2, 6000], at: [0, -1, 0], parent: group });
  add(debrisMesh(99), '#a05a40', { scale: [30, 20, 30], at: [400, 10, 300], parent: group }); // a 30-stud house, for scale
  if (!s?.tornado) {
    info(`Frame ${state.frame.toFixed(2)}: no tornado down.${s?.funnelAloft ? `\nFunnel aloft: ${Math.round(100 * s.funnelAloft.lengthShare)}% of the way down.` : ''}\nTouchdown at frame ${state.replay.touchdown}.`);
  } else {
    const t = s.tornado, { height } = funnelParts(s, group, [0, 0, 0]);
    // The wall cloud the funnel hangs from.
    const wr = s.wallCloud.radiusKm * KM, lower = Math.max(30, s.wallCloud.loweringM * SKY);
    add(wallCloudMesh(3), COLOUR.wall, { scale: [2 * wr, lower, 2 * wr], at: [t.tiltEastM / 1000 * KM, height + lower / 2, -t.tiltNorthM / 1000 * KM], yawDeg: state.spin * 3, parent: group });
    info(`Frame ${state.frame.toFixed(2)} (touchdown ${state.replay.touchdown})\n${t.type}\n${Math.round(t.windMph)} mph, ${Math.round(t.widthYards)} yd wide, ${t.ef ?? ''}\ncloud base ${Math.round(height)} studs up (${Math.round(t.baseM)} m)\ncondensed to ${Math.round(100 * t.condensedShare)}% of the way down\n${Math.round(t.vortices)} vortex(es), touch ${(t.touch ?? 1).toFixed(2)}\nfunnel: ${triangleCount(funnelMesh({ radiiStuds: t.funnelRadiusM, heightStuds: height, ...state.settings }))} triangles\nRed box: a 30-stud house.`);
  }
  if (!state.framed) { frame(group, 0.5); state.framed = true; }
}
function showScene() {
  clear();
  const s = stormAt(state.frame);
  if (!s) { info('The storm is not in this frame.'); return; }
  const group = new THREE.Group(); content.add(group);
  const local = (xKm, yKm, y) => [(xKm - s.xKm) * KM, y, (yKm - s.yKm) * KM];
  const head = deg => [Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180)];
  const up = s.updraft, baseY = up.baseM * SKY, topY = up.topM * SKY, R = up.radiusKm * KM;
  add(puffMesh(1, { flatBase: 0.5, lumps: 0.05 }), COLOUR.ground, { scale: [150000, 10, 150000], at: [0, -5, 0], parent: group });
  const [ux, , uz] = local(up.xKm, up.yKm, 0), [dx, dz] = head(s.anvil.bearingDeg);
  // Tower: puffs stacked from the base to the top, leaning downwind.
  for (let i = 0; i < 6; i++) {
    const f = i / 5, r = R * (0.95 - 0.35 * f * f), h = (topY - baseY) / 6 * 1.9;
    const colour = new THREE.Color(COLOUR.towerLow).lerp(new THREE.Color(COLOUR.tower), f).getStyle();
    for (let j = 0; j < 3; j++) {
      const a = (j / 3 + i * 0.37) * Math.PI * 2, lean = f * f * 0.25 * (topY - baseY);
      add(puffMesh(i * 3 + j + 1), colour, { scale: [r * 1.4, h, r * 1.4], at: [ux + Math.cos(a) * r * 0.38 + dx * lean, baseY + f * (topY - baseY), uz + Math.sin(a) * r * 0.38 + dz * lean], yawDeg: a * 57, parent: group });
    }
  }
  add(puffMesh(40, { flatBase: 0.5, lobes: 2 }), COLOUR.base, { scale: [2 * s.base.radiusKm * KM, 150, 2 * s.base.radiusKm * KM], at: [ux, baseY, uz], parent: group });
  const L = s.anvil.lengthKm * KM, W = s.anvil.widthKm * KM, anvilY = s.anvil.topM * SKY;
  add(anvilMesh(2), COLOUR.anvil, { scale: [W, 1400 * SKY, L], at: [ux + dx * L * 0.45, anvilY, uz + dz * L * 0.45], yawDeg: s.anvil.bearingDeg, parent: group });
  const wall = s.wallCloud, [wx, , wz] = local(wall.xKm, wall.yKm, 0), lower = Math.max(30, wall.loweringM * SKY);
  if (wall.strength > 0.03) add(wallCloudMesh(3), COLOUR.wall, { scale: [2 * wall.radiusKm * KM, lower, 2 * wall.radiusKm * KM], at: [wx, baseY - lower / 2, wz], yawDeg: state.spin * 3, parent: group });
  const rain = s.rain, [rx, , rz] = local(rain.xKm, rain.yKm, 0);
  if (rain.intensity > 0.03) add(curtainMesh(5), COLOUR.rain, { scale: [rain.acrossKm * KM, baseY, rain.alongKm * KM], at: [rx, baseY / 2, rz], yawDeg: rain.bearingDeg, opacity: 0.35 + 0.4 * rain.intensity, parent: group });
  if (s.shelf.strength > 0.05) {
    const [fx, fz] = head(s.shelf.facingDeg), lead = (s.gustFront.radiusKm * 0.6 + s.gustFront.leadKm) * KM;
    for (let i = 0; i < 9; i++) {
      const deg = s.shelf.facingDeg + ((i + 0.5) / 9 - 0.5) * 2 * Math.max(20, s.shelf.halfArcDeg), [cx, cz] = head(deg);
      add(shelfMesh(i + 1), COLOUR.shelf, { scale: [(R + lead) * 0.35, 200 * SKY, 1.4 * KM], at: [ux + cx * (R + lead), s.shelf.heightM * SKY, uz + cz * (R + lead)], yawDeg: deg, parent: group });
    }
  }
  for (let i = 0; i < 6 && wall.strength > 0.03; i++) {
    const a = state.spin * 0.2 + i * Math.PI / 3, wr = wall.radiusKm * KM;
    add(scudMesh(i + 1), '#60646c', { scale: [wr * 0.45, lower * 0.5, wr * 0.3], at: [wx + Math.cos(a) * wr, baseY - lower * 0.8, wz + Math.sin(a) * wr], yawDeg: -a * 57, parent: group });
  }
  if (s.tornado) { const [tx, , tz] = local(s.tornado.xKm, s.tornado.yKm, 0); funnelParts(s, group, [tx, 0, tz]); }
  info(`Frame ${state.frame.toFixed(2)}: ${s.mode}${s.supercellType ? ` (${s.supercellType})` : ''}\nupdraught ${Math.round(R * 2)} studs across, base ${Math.round(baseY)} studs, top ${Math.round(topY)} studs\nanvil ${Math.round(L)} x ${Math.round(W)} studs\n${s.tornado ? s.tornado.type : 'no tornado'}`);
  if (!state.framedScene) { frame(group, 0.18); state.framedScene = true; }
}

function showParticles() {
  clear();
  particles.group.visible = true;
  const s = stormAt(state.frame);
  const group = new THREE.Group(); content.add(group);
  add(Stylized.puffMesh(1, { flatBase: 0.5, lumps: 0.05 }), COLOUR.ground, { scale: [8000, 2, 8000], at: [0, -1, 0], parent: group });
  add(Stylized.debrisMesh(99), '#a05a40', { scale: [30, 20, 30], at: [400, 10, 300], parent: group }); // a 30-stud house, for scale
  if (!s) { particles.setEmitters([], [0, 0, 0]); info('The storm is not in this frame.'); return; }
  const t = s.tornado, baseY = (t ? t.baseM : s.updraft.baseM - s.wallCloud.loweringM) * SKY;
  const top = t ? [t.tiltEastM / 1000 * KM, -t.tiltNorthM / 1000 * KM] : [0, 0];
  // The cloud deck the funnel hangs from.
  const deck = new THREE.Mesh(new THREE.CircleGeometry(6000, 48), material('#575c66', 0.97));
  deck.geometry.userData.temporary = true;
  deck.rotation.x = Math.PI / 2; deck.position.set(top[0], baseY + Math.max(30, s.wallCloud.loweringM * SKY), top[1]); group.add(deck);
  const emitters = [...(t ? tornadoEmitters(s) : []), ...wallCloudEmitters(s).map(e => ({ ...e, position: [top[0] + e.position[0], baseY + Math.max(30, s.wallCloud.loweringM * SKY) + e.position[1], top[1] + e.position[2]] }))];
  particles.setEmitters(emitters, [0, 0, 0]);
  info(`Frame ${state.frame.toFixed(2)} (touchdown ${state.replay.touchdown})
${t ? `${t.type}
${Math.round(t.windMph)} mph, ${Math.round(t.widthYards)} yd, touch ${(t.touch ?? 1).toFixed(2)}` : 'no tornado down'}
${emitters.length} emitters, ${particles.particles.length} puffs alive
Rates: ${emitters.map(e => Math.round(e.rate)).join(' ')} /s
Red box: a 30-stud house.`);
  if (!state.framedParticles) { frame(group, 0.08); camera.position.set(1400, 260, 1400); controls.target.set(0, 220, 0); state.framedParticles = true; }
}

// --- Controls --------------------------------------------------------------------------------

function info(text) { $('info').textContent = text; }
function settingsFor(name) { return name === 'tornado' ? FUNNEL : name === 'baked' ? { size: BAKED.size, speed: BAKED.speed } : name === 'scene' || name === 'particles' ? {} : MESHES[name].settings; }
function buildSettings() {
  const defaults = settingsFor(state.mesh);
  state.settings = { ...defaults };
  $('settings').innerHTML = '';
  $('settingsCard').hidden = !Object.keys(defaults).length;
  for (const [key, value] of Object.entries(defaults)) {
    const [min, max, step] = RANGES[key] ?? [0, 1, 0.01];
    const label = document.createElement('label');
    label.innerHTML = `${key} <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" /><output>${value}</output>`;
    label.querySelector('input').addEventListener('input', e => { state.settings[key] = Number(e.target.value); if (state.mesh === 'baked') BAKED[key] = Number(e.target.value); label.querySelector('output').textContent = e.target.value; redraw(); });
    $('settings').append(label);
  }
}
async function redraw() {
  const replayView = REPLAY_VIEWS.has(state.mesh);
  if (state.mesh !== 'particles') { particles.group.visible = false; particles.clear(); }
  $('tornadoCard').hidden = !replayView;
  try {
    if (replayView) { await loadReplay(); $('frameOut').textContent = state.frame.toFixed(1); return state.mesh === 'tornado' ? showTornado() : state.mesh === 'particles' ? showParticles() : showScene(); }
    if (state.mesh === 'baked') return showBaked();
    return state.mode === 'grid' ? showGrid() : showSingle();
  } catch (error) { info(String(error.message ?? error)); }
}

for (const name of ['baked', 'particles', ...Object.keys(MESHES), 'tornado', 'scene']) $('mesh').append(new Option(name === 'baked' ? 'tornado (baked from Blender)' : name === 'particles' ? 'tornado (particles, Severity-style)' : name === 'tornado' ? 'tornado funnel (mesh)' : name === 'scene' ? 'storm scene' : name, name));
$('mesh').addEventListener('change', e => { state.mesh = e.target.value; state.framed = state.framedScene = state.framedParticles = state.framedBaked = false; buildSettings(); redraw(); });
$('seed').addEventListener('input', e => { state.seed = Number(e.target.value); $('seedOut').textContent = e.target.value; redraw(); });
$('single').addEventListener('click', () => { state.mode = 'single'; if (REPLAY_VIEWS.has(state.mesh)) { state.mesh = 'puff'; $('mesh').value = 'puff'; buildSettings(); } redraw(); });
$('grid').addEventListener('click', () => { state.mode = 'grid'; if (REPLAY_VIEWS.has(state.mesh)) { state.mesh = 'puff'; $('mesh').value = 'puff'; buildSettings(); } redraw(); });
$('scene').addEventListener('click', () => { state.mesh = 'scene'; $('mesh').value = 'scene'; state.framedScene = false; buildSettings(); redraw(); });
$('frame').addEventListener('input', e => { state.frame = Number(e.target.value); redraw(); });
$('play').addEventListener('click', () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Pause' : 'Play'; });

function resize() { const { clientWidth: w, clientHeight: h } = view; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
let last = performance.now(), accumulated = 0;
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const animated = REPLAY_VIEWS.has(state.mesh) || state.mesh === 'baked';
  if (state.mesh === 'particles') particles.update(dt, camera);
  if (baked.card || state.mesh === 'baked') updateBaked(dt);
  if (animated) {
    state.spin += dt * 1.5;
    // Played at the game's pace: a frame every 25 s would be slow to watch, so 5 s here.
    if (state.playing) { state.frame = Math.min(Number($('frame').max), state.frame + dt / 5); $('frame').value = state.frame; }
    accumulated += dt;
    if (accumulated > 1 / 20) { accumulated = 0; redraw(); }
  }
  controls.update();
  renderer.render(scene, camera);
});
resize();
buildSettings();
redraw();
