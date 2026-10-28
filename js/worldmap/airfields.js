// Airports, National Weather Service offices, weather radars and an air force base, sited on the
// land after the towns and main roads are laid (settlements.js) and before the section-line
// roads (sectionRoads.js), which stop at the airfield fences.
//
// What they are modelled on:
//   - Every place of at least minPopulation people has a commercial airport, as far from its
//     centre as real ones of its size are: a large hub about 15 mi out (Kansas City MCI is 15 mi
//     NW of downtown), a medium hub about 7 mi (Wichita ICT, 7 mi W), a regional airport 3 to 5 mi
//     (Salina SLN 4 mi SW, Dodge City DDC 3 mi E). Runways run near 17/35, into the Plains' south
//     and north winds (MCI and ICT 1/19, SLN 17/35), with a crosswind runway for the rest of the
//     wind rose (FAA: 95% wind coverage). The hub has parallel runways and a midfield terminal
//     reached between them (as MCI); the medium hub parallels and a terminal beside them; the
//     regional airport one main runway crossed by a shorter one.
//   - Each terminal has its apron and gates on the airside, and on the landside a one-way loop
//     with the drop-off and pick-up curbs along the terminal front (departures and arrivals
//     curbs, stacked in life, at the hub), parking (a garage at the larger airports) inside the
//     loop and long-term lots beyond it, and an entrance road out through the airport fence to the
//     public road.
//   - The NWS forecast office for each such place stands on the airport road just outside the
//     entrance, with its parking lot, and its WSR-88D radar in a fenced compound beside it, as at
//     Dodge City (WFO and radar at the airport, 104 Airport Rd) and Wichita (2142 S Tyler Rd, by
//     the airport). The radar network is these radars and the air base's.
//   - Where those offices leave gaps (ground far from any office, or an office with far more
//     ground than a Plains CWA's 20,000 to 30,000 mi2), more offices go to small towns, as the
//     1990s modernization put WFOs at Goodland, Dodge City and North Platte for radar coverage:
//     each beside a drive off a mile line on the edge of town, with its own WSR-88D, or using
//     the air base's radar when it is near (as offices use the DoD's radars).
//   - One air force base, alone in the High Plains like Cannon AFB (8 mi from Clovis off US-60):
//     a 12,000 ft runway with a parallel taxiway 1,000 ft off it (UFC 3-260-01, Class B), the
//     flightline ramp, hangars, tower and base operations along it, the cantonment (offices,
//     dormitories, shops) and base housing behind, a weapons storage area of igloos on the far
//     side of the runway, a DoD-run WSR-88D (as Vance AFB's KVNX), and the main gate on an access
//     road from the nearest highway.
//   - Public access roads leave the gate straight, then follow the mile lines in an L to the
//     nearest US or state highway, or to a mile line inside a town (all paved arterials there),
//     never crossing an interstate, a river or a lake; any mile of section line they follow is
//     paved (pavedAccessMiles).
//
// Geometry is laid out in feet in each airfield's own frame (a along the main runway's heading,
// b to its right) and stored in map miles. Everything is deterministic from the seed.
// Scale (scale.js): an airfield is built at character scale and keeps its size in studs, so a
// layout foot is AT_1000(1/5280) map miles (the studs a foot had at 1000 studs a mile; Roblox
// draws runway lengths at the map's scale and widths from widthFt). The clearances round roads,
// rivers and ramps keep their studs too; distances to towns and highways are the map's.
import { makeRandom, hashText, clamp } from './noise.js';
import { interchangeRamps } from './interchanges.js';
import { AT_1000, STUDS } from './scale.js';

const FT = AT_1000(1 / 5280);   // a layout foot in map miles
const HALF_MI_EXPRESSWAY = AT_1000(0.04);   // an airport expressway's half-width and a little (streets.js HALF_MI.expressway)

export const AIRFIELD_DEFAULTS = Object.freeze({
  minPopulation: 40000,
  distanceMi: { metro: [12, 17], city: [5, 9], smallCity: [3, 5.5] },
  headingDeg: [150, 210],   // main runway heading (degrees true), drawn per airport
  flatM: 18,                // most relief inside an airfield fence (m)
  accessMi: 8,              // longest public access road from an airport gate
  // International airports (these kinds of place) are reached by a freeway spur from their own
  // interstate exit, up to freewayMi long, meeting the interstate square for its last stemMi.
  international: ['metro', 'city'], freewayMi: 12, stemMi: AT_1000(0.8),
  stubFt: 1320,             // the airport road runs straight out of the gate this far
  // Offices in towns where the airports leave gaps (see planAirfields): until all ground is within
  // reachMi of an office and no office has more than areaMi2 nearest it (sampled every sampleMi), at most `most` of them, in towns of minPopulation
  // or more, using a radar without an office within sharedRadarMi, reached by a road of up to accessMi.
  gapOffices: { reachMi: 175, areaMi2: 30000, sampleMi: 10, most: 6, minPopulation: 500, sharedRadarMi: 30, accessMi: 4 },
  airBase: { region: 'highPlains', townClearMi: 9, nearestTownMi: [10, 20], interstateClearMi: 6, accessMi: 10, stubFt: 1800 },
  // Radar sites taken out by hand, per seed (codes come from town names, so they differ by seed):
  // the radar and the forecast office beside it go, after the gap offices are placed (so none is
  // put back in its place); the airport stays and the neighbouring offices take its counties.
  // Seed 1, 2026-10-28 (the user's choice): KPLM (50 mi from KLOR), KDGL (67 from KSPB), KWAP (90
  // from KSMF), KGRG (41 from the air base's KHLL).
  removedRadars: { 1: ['KPLM', 'KDGL', 'KWAP', 'KGRG'] }
});

const BASE_NAMES = ['Tolliver', 'Calloway', 'Prewitt', 'Brackett', 'Dunmore', 'Garrity', 'Hollister', 'Wendell', 'Ashby', 'Corwin'];

// ---------------------------------------------------------------------------
// Layouts, in feet in the airfield's frame. rect(a0, b0, a1, b1) is a polygon.
const rect = (a0, b0, a1, b1) => [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
const centroidOf = poly => [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];

// A runway from one end to the other; widths in feet.
const runway = (a0, b0, a1, b1, widthFt) => ({ ends: [[a0, b0], [a1, b1]], widthFt, lengthFt: Math.round(Math.hypot(a1 - a0, b1 - b0) / 100) * 100 });

// A crosswind runway starting just across the runway at (aX, bRunway), heading off at angle
// (degrees from the main heading) to the side away from the terminal (negative b).
function crosswind(aX, bRunway, lengthFt, angleDeg, widthFt) {
  const t = angleDeg * Math.PI / 180, a0 = aX - 250 * Math.cos(t) / Math.max(0.3, Math.sin(t)), b0 = bRunway + 250;
  return runway(a0, b0, a0 + lengthFt * Math.cos(t), b0 - lengthFt * Math.sin(t), widthFt);
}

// A parallel taxiway at b from a0 to a1, with connectors to the runway at bRunway.
function parallelTaxiway(a0, a1, b, bRunway, connectors = 5) {
  const lines = [[[a0, b], [a1, b]]];
  for (let k = 0; k < connectors; k++) { const a = a0 + (a1 - a0) * k / (connectors - 1); lines.push([[a, bRunway], [a, b]]); }
  return lines;
}

function regionalLayout(random) {
  const L1 = Math.round((6500 + 2000 * random()) / 100) * 100, s = random() < 0.5 ? -1 : 1, aT = -s * 0.15 * L1;
  const L2 = Math.round((4500 + 1500 * random()) / 100) * 100, cross = crosswind(s * (0.3 + 0.08 * random()) * L1, 0, L2, 65 + 50 * random(), L2 >= 5500 ? 100 : 75);
  const [c0, c1] = cross.ends, ct = [c1[0] - c0[0], c1[1] - c0[1]], cl = Math.hypot(...ct), cn = [-ct[1] / cl * 350, ct[0] / cl * 350];
  return {
    runways: [runway(-L1 / 2, 0, L1 / 2, 0, L1 >= 7500 ? 150 : 100), cross],
    taxiways: [...parallelTaxiway(-L1 / 2, L1 / 2, 400, 0, 5), [[c0[0] + cn[0], c0[1] + cn[1]], [c1[0] + cn[0], c1[1] + cn[1]], c1]],
    aprons: [rect(aT - 600, 475, aT + 600, 950), rect(aT + 750 * Math.sign(-aT || 1), 475, aT + 1750 * Math.sign(-aT || 1), 700)],
    buildings: [
      { kind: 'terminal', poly: rect(aT - 200, 950, aT + 200, 1100) },
      { kind: 'tower', poly: rect(aT + 440, 990, aT + 480, 1030) },
      ...[0, 1, 2].map(k => ({ kind: 'hangar', poly: rect(aT + Math.sign(-aT || 1) * (800 + 330 * k), 720, aT + Math.sign(-aT || 1) * (1080 + 330 * k), 920) }))
    ],
    parking: [{ kind: 'lot', poly: rect(aT - 290, 1230, aT + 290, 1560) }],
    roads: [{ kind: 'loop', points: [[aT, 1600], [aT + 350, 1600], [aT + 350, 1160], [aT - 350, 1160], [aT - 350, 1600], [aT, 1600]] }],
    curbs: [{ label: 'drop-off / pick-up', points: [[aT + 230, 1160], [aT - 230, 1160]] }],
    gate: { a: aT, b: 1600, da: 0, db: 1 }, landsideEdge: 1900
  };
}

function hubLayout(random) {
  const L1 = Math.round((9500 + 1500 * random()) / 100) * 100, L2 = Math.round((7000 + 1500 * random()) / 100) * 100, s = random() < 0.5 ? -1 : 1;
  const a2 = s * 0.1 * L1, aT = -s * 0.12 * L1;
  const L3 = Math.round((6000 + 1000 * random()) / 100) * 100, cross = crosswind(a2 + s * 0.35 * L2, -3200, L3, 65 + 50 * random(), 150);
  return {
    runways: [runway(-L1 / 2, 0, L1 / 2, 0, 150), runway(a2 - L2 / 2, -3200, a2 + L2 / 2, -3200, 150), cross],
    taxiways: [...parallelTaxiway(-L1 / 2, L1 / 2, 600, 0, 5), ...parallelTaxiway(a2 - L2 / 2, a2 + L2 / 2, -2600, -3200, 5), [[a2 - 0.3 * L2, -2600], [a2 - 0.3 * L2, 600]], [[a2 + 0.3 * L2, -2600], [a2 + 0.3 * L2, 600]]],
    aprons: [rect(aT - 1300, 700, aT + 1300, 1330), rect(aT - s * 1700, 700, aT - s * 3200, 1300)],
    buildings: [
      { kind: 'terminal', poly: rect(aT - 500, 1400, aT + 500, 1700) },
      { kind: 'concourse', poly: rect(aT - 1200, 1330, aT + 1200, 1400) },
      { kind: 'tower', poly: rect(aT + 1500, 1340, aT + 1560, 1400) },
      ...[0, 1, 2].map(k => ({ kind: 'hangar', poly: rect(aT - s * (1750 + 480 * k), 1300, aT - s * (2150 + 480 * k), 1560) }))
    ],
    parking: [
      { kind: 'garage', poly: rect(aT - 450, 1880, aT + 450, 2250) },
      { kind: 'lot', poly: rect(aT - 650, 2350, aT + 650, 2850) },
      { kind: 'economy', poly: rect(aT + 850, 1900, aT + 1800, 2850) }
    ],
    roads: [{ kind: 'loop', points: [[aT, 2900], [aT + 700, 2900], [aT + 700, 1780], [aT - 700, 1780], [aT - 700, 2900], [aT, 2900]] }],
    curbs: [{ label: 'departures', points: [[aT + 480, 1780], [aT + 40, 1780]] }, { label: 'arrivals', points: [[aT - 40, 1780], [aT - 480, 1780]] }],
    gate: { a: aT, b: 2900, da: 0, db: 1 }, landsideEdge: 3200
  };
}

// Large hub: parallel runways 5,000 ft apart with the terminal between them, reached by a road
// that comes in between the runway ends.
function largeHubLayout(random) {
  const L1 = Math.round((10000 + 1500 * random()) / 100) * 100, L2 = Math.round((9500 + 1500 * random()) / 100) * 100;
  const L3 = Math.round((8500 + 1500 * random()) / 100) * 100, cross = crosswind(-0.35 * L2, -2500, L3, 65 + 50 * random(), 150);
  const end = Math.max(L1, L2) / 2;
  return {
    runways: [runway(-L1 / 2, 2500, L1 / 2, 2500, 150), runway(-L2 / 2, -2500, L2 / 2, -2500, 150), cross],
    taxiways: [...parallelTaxiway(-L1 / 2, L1 / 2, 1900, 2500, 5), ...parallelTaxiway(-L2 / 2, L2 / 2, -1900, -2500, 5), [[-L1 / 2, 1900], [-L1 / 2, -1900]]],
    aprons: [rect(-1900, -1800, 1900, -700), rect(-4200, 1000, -2200, 1800)],
    buildings: [
      { kind: 'terminal', poly: rect(-1300, -700, 1300, -300) },
      { kind: 'concourse', poly: rect(-900, -1500, -650, -700) },
      { kind: 'concourse', poly: rect(650, -1500, 900, -700) },
      { kind: 'tower', poly: rect(-2100, -500, -2020, -420) },
      ...[0, 1, 2].map(k => ({ kind: 'hangar', poly: rect(-4100 + 650 * k, 650, -3600 + 650 * k, 1000) }))
    ],
    parking: [
      { kind: 'garage', poly: rect(-1000, -50, 1000, 300) },
      { kind: 'lot', poly: rect(-1400, 600, 1400, 1300) },
      { kind: 'economy', poly: rect(2500, 650, 4500, 1450) }
    ],
    roads: [
      { kind: 'loop', points: [[1500, 400], [1500, -200], [-1500, -200], [-1500, 400], [1500, 400]] },
      { kind: 'entrance', points: [[1500, 400], [end + 1000, 400]] }
    ],
    curbs: [{ label: 'departures (upper level)', points: [[1150, -200], [-1150, -200]] }, { label: 'arrivals (lower level)', points: [[1150, -120], [-1150, -120]] }],
    gate: { a: end + 1000, b: 400, da: 1, db: 0 }, landsideEdge: null
  };
}

function airBaseLayout(random) {
  const L = 12000, gateA = -1500;
  const cantonment = [], streets = [];
  // Offices, shops and dormitories on 1,000 x 800 ft blocks; family housing on smaller blocks.
  for (let a = -4500; a < 1500; a += 1000) for (let b = 3400; b < 7400; b += 800) {
    const count = 1 + Math.floor(random() * 3);
    for (let k = 0; k < count; k++) {
      const w = 160 + 220 * random(), d = 90 + 160 * random(), a0 = a + 120 + (k * 300) % 700, b0 = b + 120 + random() * (680 - d - 120);
      cantonment.push({ kind: random() < 0.3 ? 'dormitory' : 'office', poly: rect(a0, b0, Math.min(a + 900, a0 + w), b0 + d) });
    }
  }
  for (let a = -4500; a <= 1500; a += 1000) streets.push([[a, 3100], [a, 7400]]);
  for (let b = 3400; b <= 7400; b += 800) streets.push([[-4500, b], [1500, b]]);
  for (let a = 1800; a <= 4800; a += 500) streets.push([[a, 3600], [a, 7200]]);
  for (let b = 3600; b <= 7200; b += 400) streets.push([[1800, b], [4800, b]]);
  streets.push([[1500, 5400], [1800, 5400]]);
  const igloos = [];
  for (let a = 2900; a <= 5600; a += 450) for (let b = -6200; b <= -4000; b += 550) igloos.push({ kind: 'igloo', poly: rect(a, b, a + 90, b + 70) });
  return {
    runways: [runway(-L / 2, 0, L / 2, 0, 300)],
    taxiways: [...parallelTaxiway(-L / 2, L / 2, 1000, 0, 7), [[-L / 2, 1000], [-L / 2 - 400, 1000]], [[L / 2, 1000], [L / 2 + 400, 1000]]],
    aprons: [rect(-4500, 1150, 3500, 2500), rect(-L / 2 + 150, 1100, -L / 2 + 900, 1600), rect(L / 2 - 900, 1100, L / 2 - 150, 1600)],
    buildings: [
      ...Array.from({ length: 11 }, (_, k) => ({ kind: 'hangar', poly: rect(-4300 + 700 * k, 2600, -3850 + 700 * k, 2950) })),
      { kind: 'tower', poly: rect(-5150, 2550, -5060, 2640) },
      { kind: 'base operations', poly: rect(-4950, 2600, -4600, 2850) },
      { kind: 'fuel farm', poly: rect(4200, 2600, 4800, 3000) },
      ...cantonment, ...igloos
    ],
    areas: [
      { kind: 'cantonment', poly: rect(-4500, 3300, 1500, 7400) },
      { kind: 'housing', poly: rect(1800, 3600, 4800, 7200) },
      { kind: 'munitions', poly: rect(2600, -6500, 6000, -3700) }
    ],
    parking: [{ kind: 'lot', poly: rect(-3600, 3150, -2200, 3350) }, { kind: 'lot', poly: rect(-800, 3150, 600, 3350) }],
    roads: [
      { kind: 'perimeter', points: [[-7000, 3100], [7000, 3100]] },
      { kind: 'service', points: [[6500, 3100], [7300, 3100], [7300, -5000], [6000, -5000]] },
      { kind: 'service', points: [[-6500, 4500], [-4500, 4500]] },
      { kind: 'entrance', points: [[gateA, 3100], [gateA, 8000]] },
      ...streets.map(points => ({ kind: 'street', points }))
    ],
    curbs: [],
    radarAt: [-6500, 4500],
    gate: { a: gateA, b: 8000, da: 0, db: 1 }, fence: [-7800, -7000, 7800, 8000]
  };
}

// The fence round a layout (feet): the runways with 1,000 ft beyond their ends and 800 ft
// beyond their sides, and the landside out to its edge.
function fenceOf(layout) {
  if (layout.fence) return layout.fence;
  let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
  const take = ([a, b], m) => { a0 = Math.min(a0, a - m); a1 = Math.max(a1, a + m); b0 = Math.min(b0, b - m); b1 = Math.max(b1, b + m); };
  for (const r of layout.runways) for (const e of r.ends) take(e, 1000);
  for (const group of [layout.aprons, layout.buildings.map(x => x.poly), layout.parking.map(x => x.poly)]) for (const poly of group) for (const q of poly) take(q, 300);
  for (const r of layout.roads) for (const q of r.points) take(q, 150);
  if (layout.landsideEdge !== null) b1 = Math.max(b1, layout.landsideEdge);
  if (layout.gate.da) { if (layout.gate.da > 0) a1 = layout.gate.a; else a0 = layout.gate.a; }
  return [a0, b0, a1, b1];
}

// ---------------------------------------------------------------------------

// The map frame of an airfield: reference point (miles) and main runway heading (degrees true).
function frame(x, y, headingDeg) {
  const h = headingDeg * Math.PI / 180, ux = Math.sin(h), uy = -Math.cos(h), vx = Math.cos(h), vy = Math.sin(h);
  const r = v => Math.round(v * 1e4) / 1e4;
  return {
    x, y, headingDeg, ux, uy, vx, vy,
    at: ([a, b]) => [r(x + (a * ux + b * vx) * FT), r(y + (a * uy + b * vy) * FT)],
    local: (px, py) => [((px - x) * ux + (py - y) * uy) / FT, ((px - x) * vx + (py - y) * vy) / FT]
  };
}

// Runway designators from a runway's ends: the heading (tens of degrees, 1 to 36) flown from
// each end, with L, C or R for parallels.
function runwayNames(runways, f) {
  const number = (from, to) => {
    const h = (Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180 / Math.PI + 360) % 360;
    return ((Math.round(h / 10) + 35) % 36) + 1;
  };
  const names = runways.map(r => { const [p, q] = [f.at(r.ends[0]), f.at(r.ends[1])]; return [number(p, q), number(q, p)]; });
  runways.forEach((r, i) => {
    const twins = runways.map((o, j) => j).filter(j => names[j][0] === names[i][0]);
    let suffix = ['', ''];
    if (twins.length > 1) {
      // Flying from the first end along the runway, the one further left (lower b) is L.
      const left = twins.slice().sort((j, k) => runways[j].ends[0][1] - runways[k].ends[0][1]);
      const place = left.indexOf(i), n = left.length;
      const letters = n === 2 ? ['L', 'R'] : ['L', 'C', 'R'];
      suffix = [letters[place], letters[n - 1 - place]];
    }
    const pad = v => String(v).padStart(2, '0');
    const ends = [`${pad(names[i][0])}${suffix[0]}`, `${pad(names[i][1])}${suffix[1]}`];
    r.name = (names[i][0] <= names[i][1] ? ends : ends.reverse()).join('/');   // the lower number first, as charts list them
  });
}

// A three-letter code for a place's airport, as FAA identifiers are made from names.
function codeFor(name, used) {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, '').split(' ').filter(Boolean), consonants = w => w.slice(1).replace(/[AEIOUY]/g, '');
  const options = [];
  if (words.length > 1) options.push(words[0][0] + words[0][1] + words[1][0], words[0][0] + (consonants(words[0])[0] ?? 'X') + words[1][0], words[0][0] + words[1][0] + (consonants(words[1])[0] ?? 'X'));
  const w = words.join('');
  options.push(w[0] + consonants(w).slice(0, 2), w.slice(0, 3));
  for (const a of w.slice(1)) for (const b of w.slice(2)) options.push(w[0] + a + b);
  const code = options.find(c => c.length === 3 && !used.has(c)) ?? `X${used.size.toString().padStart(2, '0')}`;
  used.add(code);
  return code;
}

// ---------------------------------------------------------------------------

export function planAirfields(map, options = {}) {
  const p = { ...AIRFIELD_DEFAULTS, ...options, airBase: { ...AIRFIELD_DEFAULTS.airBase, ...(options.airBase ?? {}) } };
  const { size: n, cellMiles, elevation, cover, coverKeys, rivers, settlements, roads } = map, miles = n * cellMiles;
  const water = coverKeys.indexOf('water'), random = makeRandom(hashText(`${map.params.seed}|airfields`));
  const cellAt = (x, y) => clamp(Math.floor(y / cellMiles), 0, n - 1) * n + clamp(Math.floor(x / cellMiles), 0, n - 1);

  // Segments of the roads and rivers, indexed by 1-mile cells.
  const index = new Map();
  const addSeg = seg => {
    for (let X = Math.floor(Math.min(seg.ax, seg.bx) - seg.half); X <= Math.floor(Math.max(seg.ax, seg.bx) + seg.half); X++) {
      for (let Y = Math.floor(Math.min(seg.ay, seg.by) - seg.half); Y <= Math.floor(Math.max(seg.ay, seg.by) + seg.half); Y++) {
        const key = X * 4096 + Y;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(seg);
      }
    }
  };
  const roadSegs = [];
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const [ax, ay] = road.points[i - 1], [bx, by] = road.points[i];
    const seg = { type: road.kind === 'interstate' ? 'interstate' : 'road', road, ax, ay, bx, by, half: AT_1000(road.kind === 'interstate' ? 0.06 : 0.03) };
    addSeg(seg); roadSegs.push(seg);
  }
  const riverSegs = [];
  for (const river of rivers) for (let k = 2; k < river.points.length; k += 2) {
    addSeg(riverSegs[riverSegs.length] = { type: 'river', ax: river.points[k - 2], ay: river.points[k - 1], bx: river.points[k], by: river.points[k + 1], half: STUDS(Math.min(220, Math.max(12, river.widthsM[k / 2] * 0.18))) / 2 + AT_1000(0.03) });
  }
  const segsNear = (x0, y0, x1, y1) => {
    const found = new Set();
    for (let X = Math.floor(Math.min(x0, x1)) - 1; X <= Math.floor(Math.max(x0, x1)) + 1; X++) for (let Y = Math.floor(Math.min(y0, y1)) - 1; Y <= Math.floor(Math.max(y0, y1)) + 1; Y++) for (const s of index.get(X * 4096 + Y) ?? []) found.add(s);
    return found;
  };

  const placed = [];   // { frame, fence (feet), extras: [{x, y, r}] } of airfields laid so far
  // Whether a fence (feet, in frame f) is clear of roads, rivers, lakes, rough ground, towns and
  // the other airfields; returns its relief (m) or -1.
  const fenceClear = (f, fence, ownCity) => {
    const [a0, b0, a1, b1] = fence, corners = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(f.at);
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
    if (Math.min(...xs) < 5 || Math.min(...ys) < 5 || Math.max(...xs) > miles - 5 || Math.max(...ys) > miles - 5) return -1;
    const pad = 300;
    for (const s of segsNear(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))) {
      const m = s.half / FT + pad, [pa, pb] = f.local(s.ax, s.ay), [qa, qb] = f.local(s.bx, s.by);
      if (segmentHitsRect(pa, pb, qa, qb, a0 - m, b0 - m, a1 + m, b1 + m)) return -1;
    }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, radius = Math.hypot(a1 - a0, b1 - b0) / 2 * FT;
    for (const s of settlements) {
      const d = Math.hypot(s.x - cx, s.y - cy) - radius, keep = s === ownCity ? s.coreMi + 0.3 : s.kind === 'town' ? s.extentMi + 0.3 : s.extentMi;
      if (d < keep) return -1;
    }
    for (const o of placed) if (Math.hypot(o.cx - cx, o.cy - cy) < o.radius + radius + 0.5) return -1;
    let lo = Infinity, hi = -Infinity;
    for (let a = a0; a <= a1; a += 1320) for (let b = b0; b <= b1; b += 1320) {
      const [x, y] = f.at([a, b]), k = cellAt(x, y);
      if (cover[k] === water) return -1;
      lo = Math.min(lo, elevation[k]); hi = Math.max(hi, elevation[k]);
    }
    return hi - lo <= p.flatM ? hi - lo : -1;
  };

  // A polygon (map miles) clear of roads, rivers, water and the mile lines (where section roads
  // may run).
  const spotClear = poly => {
    const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const line = AT_1000(0.03), m = AT_1000(0.02);
    if (Math.floor(x1 + line) !== Math.floor(x0 - line) || Math.floor(y1 + line) !== Math.floor(y0 - line)) return false;
    for (const s of segsNear(x0, y0, x1, y1)) if (segmentHitsRect(s.ax, s.ay, s.bx, s.by, x0 - s.half - m, y0 - s.half - m, x1 + s.half + m, y1 + s.half + m)) return false;
    return cover[cellAt((x0 + x1) / 2, (y0 + y1) / 2)] !== water;
  };

  // The public road from a gate's stub end S to the network: an L along the map axes (or
  // straight to a highway), the shortest that crosses no interstate, river, lake or fence and
  // meets no road before its end. Targets: points on US and state highways and expressways,
  // and corners of the mile grid inside towns.
  const accessRoad = (S, reach, avoid, own, towns = true) => {
    const targets = [];
    for (const s of roadSegs) {
      if (s.type !== 'road') continue;
      const [tx, ty] = nearestOnSegment(S[0], S[1], s);
      const d = Math.hypot(tx - S[0], ty - S[1]);
      if (d <= reach) targets.push({ x: tx, y: ty, road: s.road });
    }
    if (towns) for (const st of settlements) {
      if (Math.hypot(st.x - S[0], st.y - S[1]) > reach + st.extentMi) continue;
      const r = Math.floor(st.extentMi);
      for (let J = Math.ceil(st.y - r); J <= st.y + r; J++) for (let I = Math.ceil(st.x - r); I <= st.x + r; I++) {
        if (Math.hypot(I - st.x, J - st.y) <= st.extentMi - 0.3 && Math.hypot(I - S[0], J - S[1]) <= reach) targets.push({ x: I, y: J, town: st });
      }
    }
    const paths = [];
    for (const t of targets) {
      const T = [t.x, t.y];
      paths.push({ t, points: [S, [T[0], S[1]], T] }, { t, points: [S, [S[0], T[1]], T] });
      if (t.road) paths.push({ t, points: [S, T], diagonal: true });
    }
    const length = q => q.points.reduce((sum, v, i) => sum + (i ? Math.hypot(v[0] - q.points[i - 1][0], v[1] - q.points[i - 1][1]) : 0), 0) * (q.diagonal ? 1.5 : 1);
    paths.forEach(q => { q.points = q.points.filter((v, i, all) => i === 0 || Math.hypot(v[0] - all[i - 1][0], v[1] - all[i - 1][1]) > 1e-6); q.length = length(q); });
    paths.sort((a, b) => a.length - b.length);
    for (const q of paths) if (pathClear(q.points, avoid, own)) return q;
    return null;
  };
  // endRoad: the interstate a freeway spur ends on (it may meet that one at its end).
  const pathClear = (points, avoid, own = null, endRoad = null) => {
    const end = points.at(-1);
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i], last = i === points.length - 1;
      for (const s of segsNear(ax, ay, bx, by)) {
        const hit = segmentIntersection(ax, ay, bx, by, s.ax, s.ay, s.bx, s.by);
        if (hit && !(last && hit.t > 0.995 && (endRoad ? s.road === endRoad : s.type === 'road'))) return false;
      }
      const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / 0.05));
      for (let k = 0; k <= steps; k++) {
        const x = ax + (bx - ax) * k / steps, y = ay + (by - ay) * k / steps, toEnd = Math.hypot(x - end[0], y - end[1]);
        if (cover[cellAt(x, y)] === water) return false;
        for (const s of segsNear(x, y, x, y)) {
          if (endRoad && s.road === endRoad && toEnd < 0.6) continue;
          const d = distToSeg(x, y, s);
          if (s.type === 'interstate' ? d < AT_1000(0.2) : s.type === 'river' ? d < s.half : d < AT_1000(0.04) && (endRoad || toEnd > AT_1000(0.12))) return false;
        }
        for (const o of own ? [...placed, own] : placed) { const [a, b] = o.frame.local(x, y), [a0, b0, a1, b1] = o.fence; if (a > a0 && a < a1 && b > b0 && b < b1) return false; }
        for (const poly of avoid) if (pointInPoly(x, y, poly)) return false;
      }
    }
    return true;
  };

  // A freeway spur from S to its own exit on the nearest interstate it can reach (as Kansas City's
  // airport is reached from I-29): a T interchange (crossings.js plans it from the road's end),
  // sited where the interstate runs straight, as far from the interstate's other exits as exit
  // spacing asks (1 mi in town, 3 in the country; the highways crossing it may all become exits),
  // clear of its river bridges and other interstates, with its ramps clear of rivers and roads.
  // The spur meets the interstate square: its last stemMi run straight out from it.
  const townCover = new Set([coverKeys.indexOf('urban'), coverKeys.indexOf('suburban')]);
  const freewaySpur = (S, reach, avoid, own) => {
    const options = [];
    for (const road of roads) {
      if (road.kind !== 'interstate') continue;
      const pts = road.points, along = [0];
      for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      // Where other highways meet it (they may get exits), other interstates join it, and rivers cross it.
      const highwaysAt = [], junctionsAt = [], riversAt = [];
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = along[i] - along[i - 1];
        const meet = (s, list) => {
          if (Math.max(s.ax, s.bx) < Math.min(ax, bx) - 0.1 || Math.min(s.ax, s.bx) > Math.max(ax, bx) + 0.1 || Math.max(s.ay, s.by) < Math.min(ay, by) - 0.1 || Math.min(s.ay, s.by) > Math.max(ay, by) + 0.1) return;
          const hit = segmentIntersection(ax, ay, bx, by, s.ax, s.ay, s.bx, s.by);
          if (hit) { list.push(along[i - 1] + len * hit.t); return; }
          for (const [qx, qy] of [[s.ax, s.ay], [s.bx, s.by]]) {
            const seg = { ax, ay, bx, by }, [px, py] = nearestOnSegment(qx, qy, seg);
            if (Math.hypot(px - qx, py - qy) < AT_1000(0.06)) list.push(along[i - 1] + Math.hypot(px - ax, py - ay));
          }
        };
        for (const s of roadSegs) if (s.road !== road) meet(s, s.type === 'interstate' ? junctionsAt : highwaysAt);
        for (const s of riverSegs) meet(s, riversAt);
      }
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = along[i] - along[i - 1];
        const rampReach = AT_1000(0.6);
        if (len < 2 * rampReach) continue;
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        // Straight for the ramps' reach either way: on this segment, rampReach from its ends.
        for (let t = rampReach; t <= len - rampReach; t += 0.1) {
          const T = [ax + ux * t, ay + uy * t], s = along[i - 1] + t, d = Math.hypot(T[0] - S[0], T[1] - S[1]);
          if (d > reach) continue;
          const spacing = (townCover.has(cover[cellAt(T[0], T[1])]) ? 1 : 3) + 0.3;
          if (highwaysAt.some(h => Math.abs(h - s) < spacing) || junctionsAt.some(h => Math.abs(h - s) < 2) || riversAt.some(h => Math.abs(h - s) < rampReach)) continue;
          if (roadSegs.some(o => o.type === 'interstate' && o.road !== road && distToSeg(T[0], T[1], o) < AT_1000(1.1))) continue;
          // Square to the interstate, on the side the airport is.
          let nx = -uy, ny = ux;
          if ((S[0] - T[0]) * nx + (S[1] - T[1]) * ny < 0) { nx = -nx; ny = -ny; }
          const P = [T[0] + nx * p.stemMi, T[1] + ny * p.stemMi];
          for (const points of [[S, P, T], [S, [P[0], S[1]], P, T], [S, [S[0], P[1]], P, T]]) {
            const clean = points.filter((v, k, all) => k === 0 || Math.hypot(v[0] - all[k - 1][0], v[1] - all[k - 1][1]) > 1e-6);
            let length = 0;
            for (let k = 1; k < clean.length; k++) length += Math.hypot(clean[k][0] - clean[k - 1][0], clean[k][1] - clean[k - 1][1]);
            options.push({ road, points: clean, length, crossing: { type: 'interchange', x: T[0], y: T[1], ux, uy, vx: -nx, vy: -ny, vEnd: -1, uEnd: 0, kind: 'expressway' } });
          }
        }
      }
    }
    options.sort((a, b) => a.length - b.length);
    const rampsClear = c => interchangeRamps(c).every(ramp => ramp.every(([x, y]) => {
      if (cover[cellAt(x, y)] === water) return false;
      for (const s of segsNear(x, y, x, y)) if (s.type === 'river' ? distToSeg(x, y, s) < s.half + AT_1000(0.02) : s.type === 'road' && distToSeg(x, y, s) < AT_1000(0.04)) return false;
      return true;
    }));
    for (const q of options) if (rampsClear(q.crossing) && pathClear(q.points, avoid, own, q.road)) return q;
    return null;
  };

  // The office and radar beside a gate's stub: the first spot clear on either side. off: feet
  // further across, beside a stub that is an expressway (wider than the airport road).
  const officeAndRadar = (f, gateA, gateB, da, db, off = 0) => {
    for (const along of [600, 900, 400, 1150]) for (const side of [1, -1]) {
      // Across the stub: the side axis is the stub turned a right angle.
      const sa = -db * side, sb = da * side, P = (al, ac) => [gateA + da * al + sa * ac, gateB + db * al + sb * ac];
      const box = (al0, ac0, al1, ac1) => [P(al0, ac0), P(al1, ac0), P(al1, ac1), P(al0, ac1)].map(f.at);
      const building = box(along - 60, 160 + off, along + 60, 300 + off), parking = box(along - 90, 60 + off, along + 90, 150 + off), compound = box(along - 110, 400 + off, along + 110, 620 + off);
      if (![building, parking, compound].every(spotClear)) continue;
      const drive = [P(along, 20 + off), P(along, 60 + off)].map(f.at), service = [P(along, 300 + off), P(along, 400 + off)].map(f.at);
      return { building, parking, compound, drive, service, radar: f.at(P(along, 510 + off)) };
    }
    return null;
  };

  const used = new Set();
  const airfields = [];
  const cities = settlements.filter(s => s.population >= p.minPopulation).sort((a, b) => b.population - a.population);
  for (const city of cities) {
    const layoutFor = city.kind === 'metro' ? largeHubLayout : city.kind === 'city' ? hubLayout : regionalLayout;
    const [dMin, dMax] = p.distanceMi[city.kind] ?? p.distanceMi.smallCity;
    const heading0 = p.headingDeg[0] + (p.headingDeg[1] - p.headingDeg[0]) * random(), layoutSeed = hashText(`${map.params.seed}|airport|${city.name}`);
    const candidates = [];
    for (const dh of [0, 10, -10, 20, -20]) {
      const headingDeg = ((heading0 + dh) % 360 + 360) % 360, layout = layoutFor(makeRandom(layoutSeed)), fence = fenceOf(layout);
      for (let d = dMin; d <= dMax + 1e-9; d += 0.5) for (let k = 0; k < 48; k++) {
        const angle = k / 48 * 2 * Math.PI, x = city.x + d * Math.cos(angle), y = city.y + d * Math.sin(angle);
        const f = frame(x, y, headingDeg), relief = fenceClear(f, fence, city);
        if (relief < 0) continue;
        candidates.push({ f, layout, fence, d, relief, score: Math.abs(d - (dMin + dMax) / 2) / (dMax - dMin) + 0.03 * relief + 0.15 * Math.abs(dh) / 10 + 0.3 * random() });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const c of candidates.slice(0, 60)) {
      const field = finish(c, city);
      if (field) { airfields.push(field); break; }
    }
  }

  // Lays out one airfield at a candidate site, with its office, radar and access road; null if
  // these do not fit.
  function finish({ f, layout, fence }, city, base = null) {
    const g = layout.gate, gateA = g.da ? fence[g.da > 0 ? 2 : 0] : g.a, gateB = g.db ? fence[g.db > 0 ? 3 : 1] : g.b;
    const stub = base ? p.airBase.stubFt : p.stubFt;
    const freeway = !base && p.international.includes(city.kind);
    // Beside an expressway stub the office stands clear of its width (the airport road's half-width is 0.03 mi at 1000 studs a mile).
    const office = base ? null : officeAndRadar(f, gateA, gateB, g.da, g.db, freeway ? (HALF_MI_EXPRESSWAY - AT_1000(0.03)) / FT : 0);
    if (!base && !office) return null;
    const visitor = base ? f.at([gateA + 250, gateB + 300]) : null;
    const S = f.at([gateA + g.da * stub, gateB + g.db * stub]);
    const avoid = office ? [office.building, office.parking, office.compound] : [];
    // The stub itself must be clear too.
    const own = { frame: f, fence };
    if (!pathClear([f.at([gateA + g.da * 10, gateB + g.db * 10]), S], avoid, own)) return null;
    const access = freeway ? freewaySpur(S, p.freewayMi, avoid, own) : accessRoad(S, base ? p.airBase.accessMi : p.accessMi, avoid, own, !base);
    if (!access) return null;
    const code = codeFor(base ? base.name : city.name, used);
    runwayNames(layout.runways, f);
    const poly = q => q.map(f.at), [a0, b0, a1, b1] = fence;
    const field = {
      kind: base ? 'airBase' : 'airport', code,
      name: base ? `${base.name} Air Force Base` : `${city.name} ${freeway ? 'International' : 'Regional'} Airport`,
      class: base ? 'air force base' : city.kind === 'metro' ? 'large hub' : city.kind === 'city' ? 'medium hub' : 'regional',
      city: base ? base.nearest.name : city.name, distanceMi: Math.round(Math.hypot(f.x - (base ? base.nearest.x : city.x), f.y - (base ? base.nearest.y : city.y)) * 10) / 10,
      x: Math.round(f.x * 1e4) / 1e4, y: Math.round(f.y * 1e4) / 1e4, headingDeg: Math.round(f.headingDeg * 10) / 10, elevationM: Math.round(elevation[cellAt(f.x, f.y)]),
      fence: poly(rect(a0, b0, a1, b1)), gate: f.at([gateA, gateB]),
      runways: layout.runways.map(r => ({ name: r.name, ends: r.ends.map(f.at), lengthFt: r.lengthFt, widthFt: r.widthFt })),
      taxiways: layout.taxiways.map(poly), aprons: layout.aprons.map(poly),
      buildings: layout.buildings.map(b => ({ kind: b.kind, poly: poly(b.poly) })),
      areas: (layout.areas ?? []).map(a => ({ kind: a.kind, poly: poly(a.poly) })),
      parking: layout.parking.map(q => ({ kind: q.kind, poly: poly(q.poly) })),
      roads: [...layout.roads.map(r => ({ kind: r.kind, points: poly(r.points) })), { kind: 'entrance', points: [f.at([gateA - g.da * 300, gateB - g.db * 300]), f.at([gateA, gateB])] }],
      curbs: layout.curbs.map(c => ({ label: c.label, points: poly(c.points) })),
      access: freeway
        ? { name: 'Airport Expressway', freeway: true, points: [f.at([gateA, gateB]), ...access.points], joins: access.road.name }
        : { name: base ? `${base.name} AFB Access Road` : 'Airport Road', points: [f.at([gateA, gateB]), ...access.points], joins: access.t.road?.name ?? `${access.t.town.name} streets` }
    };
    if (base) {
      const vw = AT_1000(0.012), vd = AT_1000(0.008);
      field.buildings.push({ kind: 'visitor center', poly: [[visitor[0] - vw, visitor[1] - vd], [visitor[0] + vw, visitor[1] - vd], [visitor[0] + vw, visitor[1] + vd], [visitor[0] - vw, visitor[1] + vd]] });
      const radar = f.at(layout.radarAt);
      field.radar = { id: `K${code}`, name: `${base.name} AFB`, x: radar[0], y: radar[1], operator: 'DoD', compound: poly(rect(layout.radarAt[0] - 110, layout.radarAt[1] - 110, layout.radarAt[0] + 110, layout.radarAt[1] + 110)) };
    } else {
      field.radar = { id: `K${code}`, name: city.name, x: office.radar[0], y: office.radar[1], operator: 'NWS', compound: office.compound, service: office.service };
      field.nws = { id: code, name: `NWS ${city.name}`, office: 'Weather Forecast Office', building: office.building, parking: office.parking, drive: office.drive };
    }
    const [cx0, cy0] = f.at([(a0 + a1) / 2, (b0 + b1) / 2]);
    placed.push({ frame: f, fence, cx: cx0, cy: cy0, radius: Math.hypot(a1 - a0, b1 - b0) / 2 * FT });
    // The spur joins the map's roads (an expressway: crossings.js gives it its exit, the section
    // roads meet it at signals or stop short of it), named for the airport and the interstate.
    if (freeway) {
      const road = { kind: 'expressway', name: `${code} Airport Expressway – ${access.road.name}`, airport: code, points: field.access.points };
      roads.push(road);
      for (let i = 1; i < road.points.length; i++) {
        const seg = { type: 'road', road, ax: road.points[i - 1][0], ay: road.points[i - 1][1], bx: road.points[i][0], by: road.points[i][1], half: HALF_MI_EXPRESSWAY };
        addSeg(seg); roadSegs.push(seg);
      }
    }
    return field;
  }

  // The air base: flat High Plains ground far from any town and interstate, near a highway.
  const ab = p.airBase, baseLayout = airBaseLayout(makeRandom(hashText(`${map.params.seed}|airbase`))), baseFence = fenceOf(baseLayout);
  const regionIndex = map.regionKeys.indexOf(ab.region), interstates = roadSegs.filter(s => s.type === 'interstate');
  const highways = roadSegs.filter(s => s.type === 'road');
  // Isolation is relaxed step by step only if no site is found.
  const baseName = BASE_NAMES[Math.floor(random() * BASE_NAMES.length)];
  const baseCandidates = [];
  for (const relax of [1, 0.75, 0.5]) {
    for (let y = 10; y < miles - 10; y += 2) for (let x = 10; x < miles - 10; x += 2) {
      if (map.region[cellAt(x, y)] !== regionIndex) continue;
      let nearest = null, nearestD = Infinity, clear = Infinity;
      for (const s of settlements) {
        const d = Math.hypot(s.x - x, s.y - y);
        clear = Math.min(clear, d - s.extentMi);
        if (d < nearestD && s.population >= 1000) { nearestD = d; nearest = s; }
      }
      if (clear < ab.townClearMi * relax || !nearest || nearestD < ab.nearestTownMi[0] * relax) continue;
      if (interstates.some(s => distToSeg(x, y, s) < ab.interstateClearMi * relax)) continue;
      let road = Infinity;
      for (const s of highways) if (Math.abs(s.ax - x) < ab.accessMi + 5 || Math.abs(s.bx - x) < ab.accessMi + 5) road = Math.min(road, distToSeg(x, y, s));
      if (road > ab.accessMi - 1 || road < 2.5) continue;
      // Like real isolated bases: the nearest town of some size 10 to 20 miles off; and well
      // inside the region (the share of points 15 mi round that are in it).
      let outside = 0;
      for (let k = 0; k < 12; k++) if (map.region[cellAt(x + 15 * Math.cos(k * Math.PI / 6), y + 15 * Math.sin(k * Math.PI / 6))] !== regionIndex) outside++;
      baseCandidates.push({ x, y, nearest, score: Math.max(0, ab.nearestTownMi[0] - nearestD, nearestD - ab.nearestTownMi[1]) / 3 + road / 3 + outside / 3 + random() });
    }
    if (baseCandidates.length) break;
  }
  baseCandidates.sort((a, b) => a.score - b.score);
  for (const c of baseCandidates.slice(0, 80)) {
    let field = null;
    for (const dh of [0, 15, -15]) {
      const f = frame(c.x, c.y, (p.headingDeg[0] + p.headingDeg[1]) / 2 + dh + (random() - 0.5) * 10);
      if (fenceClear(f, baseFence, null) < 0) continue;
      field = finish({ f, layout: airBaseLayout(makeRandom(hashText(`${map.params.seed}|airbase`))), fence: baseFence }, null, { name: baseName, nearest: c.nearest });
      if (field) break;
    }
    if (field) { airfields.push(field); break; }
  }

  // Forecast offices where the airports leave gaps: while some ground lies more than
  // gapOffices.reachMi from every office, or some office has more than areaMi2 of ground nearer it
  // than any other (real Plains CWAs are 20,000 to 30,000 mi2), an office goes to the town (of at least minPopulation)
  // that most closes the gaps (the least sum of squared distances from the ground to its nearest
  // office), as the modernized network put WFOs in small towns for radar coverage (Goodland,
  // Dodge City, North Platte). An office within sharedRadarMi of a radar with no office of its
  // own (the air base's) uses that radar, as offices use DoD radars; otherwise it gets its own.
  const go = p.gapOffices, ground = [];
  for (let y = go.sampleMi / 2; y < miles; y += go.sampleMi) for (let x = go.sampleMi / 2; x < miles; x += go.sampleMi) if (cover[cellAt(x, y)] !== water) ground.push([x, y]);
  const officeAt = airfields.filter(a => a.nws).map(a => [a.radar.x, a.radar.y]);
  const nearestOffice = ground.map(([x, y]) => Math.min(Infinity, ...officeAt.map(([u, v]) => Math.hypot(u - x, v - y))));
  const largestArea = () => {
    const count = new Map();
    ground.forEach(([x, y]) => { let best = 0; officeAt.forEach(([u, v], k) => { if (Math.hypot(u - x, v - y) < Math.hypot(officeAt[best][0] - x, officeAt[best][1] - y)) best = k; }); count.set(best, (count.get(best) ?? 0) + 1); });
    return Math.max(...count.values()) * go.sampleMi ** 2;
  };
  const taken = new Set(airfields.filter(a => a.nws).map(a => a.city));
  let towns = settlements.filter(s => s.population >= go.minPopulation && !taken.has(s.name));
  for (let k = 0; k < go.most && officeAt.length && (Math.max(...nearestOffice) > go.reachMi || largestArea() > go.areaMi2); k++) {
    const ranked = towns.map(t => ({ t, cost: ground.reduce((sum, [x, y], i) => sum + Math.min(nearestOffice[i], Math.hypot(t.x - x, t.y - y)) ** 2, 0) })).sort((a, b) => a.cost - b.cost);
    let field = null;
    for (const { t } of ranked.slice(0, 8)) if ((field = townOffice(t))) break;
    if (!field) break;
    airfields.push(field); towns = towns.filter(t => t.name !== field.city);
    const [ox, oy] = centroidOf(field.nws.building);
    officeAt.push([ox, oy]);
    ground.forEach(([x, y], i) => { nearestOffice[i] = Math.min(nearestOffice[i], Math.hypot(ox - x, oy - y)); });
  }

  // An office (and radar, unless it shares one) on the edge of a town: beside a private drive off
  // one of the mile lines leading out of town, reached along that line (paved, fitSectionRoads).
  function townOffice(town) {
    const shared = airfields.find(a => a.radar && !a.nws && Math.hypot(a.radar.x - town.x, a.radar.y - town.y) <= go.sharedRadarMi)?.radar ?? null;
    const I = Math.round(town.x), J = Math.round(town.y);
    for (let out = town.extentMi + 0.3; out <= town.extentMi + 2; out += 0.25) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) for (const side of [1, -1]) {
        // S: on the mile line through town, `out` miles from the centre; the drive leaves it square.
        const S = dx ? [town.x + dx * out, J] : [I, town.y + dy * out], f = frame(S[0], S[1], 0);
        const [da, db] = dx ? [side, 0] : [0, side];
        const office = officeAndRadar(f, 0, 0, da, db);
        if (!office) continue;
        const parts = shared ? [office.building, office.parking] : [office.building, office.parking, office.compound];
        const [la, lb] = f.local(...office.drive[0]), along = Math.abs(da ? la : lb) + 100, end = f.at([da * along, db * along]);
        if (!pathClear([S, end], parts, null)) continue;
        const access = accessRoad(S, go.accessMi, parts, null, true);
        if (!access) continue;
        const pts = [...parts.flat(), f.at([da * 200, db * 200]), end], xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), pad = 100 * FT;
        const fence = [[Math.min(...xs) - pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.max(...ys) + pad], [Math.min(...xs) - pad, Math.max(...ys) + pad]];
        const code = codeFor(town.name, used), [cx, cy] = centroidOf(office.building);
        const radar = shared ?? { id: `K${code}`, name: town.name, x: office.radar[0], y: office.radar[1], operator: 'NWS', compound: office.compound, service: office.service };
        placed.push({ frame: f, fence: [0, 0, 0, 0], cx, cy, radius: AT_1000(0.3) });
        return {
          kind: 'nwsOffice', code, name: `NWS ${town.name}`, class: 'forecast office', city: town.name,
          distanceMi: Math.round(Math.hypot(cx - town.x, cy - town.y) * 10) / 10, x: Math.round(cx * 1e4) / 1e4, y: Math.round(cy * 1e4) / 1e4, headingDeg: 0, elevationM: Math.round(elevation[cellAt(cx, cy)]),
          fence, gate: S, runways: [], taxiways: [], aprons: [], buildings: [], areas: [], parking: [], curbs: [],
          roads: [{ kind: 'entrance', points: [S, end] }],
          access: { name: `${town.name} Weather Office Road`, points: access.points, joins: access.t.road?.name ?? `${access.t.town.name} streets` },
          radar, sharedRadar: Boolean(shared),
          nws: { id: code, name: `NWS ${town.name}`, office: 'Weather Forecast Office', building: office.building, parking: office.parking, drive: office.drive }
        };
      }
    }
    return null;
  }

  // Radar sites removed by hand (removedRadars): the radar and its office go; an office in a town
  // goes whole, an airport keeps its field. An office that shared a removed radar goes too.
  const removed = new Set(p.removedRadars?.[map.params.seed] ?? []);
  const found = new Set();
  for (let i = airfields.length - 1; i >= 0; i--) {
    const a = airfields[i];
    if (!a.radar || !removed.has(a.radar.id)) continue;
    found.add(a.radar.id);
    if (a.kind === 'nwsOffice') airfields.splice(i, 1);
    else { delete a.radar; delete a.sharedRadar; delete a.nws; }
  }
  // (a code that matches nothing is a typo, or from a map made before the towns changed)
  for (const id of removed) if (!found.has(id)) console.warn(`[worldmap] removedRadars: no radar ${id} on seed ${map.params.seed}`);

  // Each radar once (an office may use the air base's).
  const radars = airfields.filter(a => a.radar && !a.sharedRadar).map(a => ({ ...a.radar, airfield: a.code, kind: a.kind }));
  return { airfields, radars };
}

// The section-line roads where the airfields are: none inside a fence, and paved along any mile
// line an access road follows. Changes sections.roads in place.
export function fitSectionRoads(sections, airfields) {
  const { size, roads } = sections;
  // Paved first (a mile the access road runs part of is paved whole), then cut at the fences.
  for (const miles of airfields.flatMap(a => pavedAccessMiles(a.access.points, size))) {
    const [K, shift] = miles;
    roads[K] = (roads[K] & ~(3 << shift)) | (3 << shift);
  }
  const inside = (x, y) => airfields.some(a => pointInPoly(x, y, a.fence));
  for (let J = 0; J < size; J++) for (let I = 0; I < size; I++) {
    const K = J * size + I;
    for (const [shift, dx, dy] of [[0, 1, 0], [2, 0, 1]]) {
      if (!((roads[K] >> shift) & 3)) continue;
      for (let t = 0; t <= 1; t += 0.125) if (inside(I + dx * t, J + dy * t)) { roads[K] &= ~(3 << shift); break; }
    }
  }
}

// The miles of section line an access road runs along: [corner index, bit shift] pairs.
export function pavedAccessMiles(points, size) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    if (Math.abs(ax - bx) < 1e-6 && Math.abs(ax - Math.round(ax)) < 1e-6) {
      for (let J = Math.floor(Math.min(ay, by) + 1e-6); J < Math.max(ay, by) - 1e-6; J++) if (J >= 0 && J < size - 1) out.push([J * size + Math.round(ax), 2]);
    } else if (Math.abs(ay - by) < 1e-6 && Math.abs(ay - Math.round(ay)) < 1e-6) {
      for (let I = Math.floor(Math.min(ax, bx) + 1e-6); I < Math.max(ax, bx) - 1e-6; I++) if (I >= 0 && I < size - 1) out.push([Math.round(ay) * size + I, 0]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function nearestOnSegment(x, y, s) {
  const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((x - s.ax) * dx + (y - s.ay) * dy) / l2, 0, 1) : 0;
  return [s.ax + dx * t, s.ay + dy * t];
}
export function distToSeg(x, y, s) { const [px, py] = nearestOnSegment(x, y, s); return Math.hypot(px - x, py - y); }

export function segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

// Whether the segment from (ax, ay) to (bx, by) touches the box (Liang-Barsky).
export function segmentHitsRect(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [pp, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (pp === 0) { if (q < 0) return false; continue; }
    const r = q / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
