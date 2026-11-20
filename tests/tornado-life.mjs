// A tornado's life in the lab's six stages (js/storms/TornadoStages.js, wired in TornadoEngine.js): the lab's checks
// (tornado-windfield docs/engine-request-lifecycle.md, engine-request-stages.md) on the shown wind, core and contortion.
import assert from 'node:assert/strict';
import { matureCoreM, rotationLossFall, trackLoops, RFD_SURGE } from '../js/storms/TornadoEngine.js';
import { tornadoStage, tornadoStageShares, gestationStage, dissipatedStage, stormTornadoStage, TORNADO_STAGES as S } from '../js/storms/TornadoStages.js';
import { tornadoTilt, tornadoDecay, LEAN_LIMIT } from '../js/storms/TornadoFunnel.js';

// A 65-minute EF1 (vortex 106 mph), seen at the bundle's 5-minute ticks.
const ticks = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65].map(m => tornadoStage(m, 65, 106, 106));
const touch = tornadoStage(0, 65, 106, 106);
assert.equal(touch.windMph, 65, 'touches down at the EF0 wind'); assert.equal(touch.name, 'organizing');
assert.ok(ticks[0].coreShare > 1.3 && ticks[1].windMph > ticks[0].windMph && ticks[1].coreShare < ticks[0].coreShare, 'spins up as the core contracts');
// stages in order, mature at least 2 ticks, a rope tick (core <= 0.45, contortion >= 0.4), last tick under 75 mph and contorted
const order = ['organizing', 'mature', 'shrinking', 'rope'], names = ticks.map(t => t.name);
for (let k = 1; k < names.length; k++) assert.ok(order.indexOf(names[k]) >= order.indexOf(names[k - 1]), names.join(' '));
assert.ok(names.filter(n => n === 'mature').length >= 2, names.join(' '));
assert.ok(ticks.some(t => t.name === 'rope' && t.coreShare <= 0.45 && t.contortion >= 0.4), 'a rope tick');
const last = tornadoStage(64.9, 65, 106, 106);
assert.ok(last.windMph < 75 && last.contortion >= 0.8, `last moment: ${last.windMph}, ${last.contortion}`);
const end = tornadoStage(65, 65, 106);
assert.ok(end.windMph === 65 && Math.abs(end.coreShare - S.ropeCore) < 1e-9 && end.contortion === 1, 'ends at 65 mph, a contorted rope');
assert.ok(ticks.some(t => t.name === 'mature' && t.windMph === 106 && t.coreShare === 1), 'holds the vortex at maturity');
// shares: organizing 15% (>= organizingMinutes, <= briefShare), rope 15% (>= 5 min, <= 25%), mature : shrinking 0.45 : 0.25 of the rest
const b40 = tornadoStageShares(40);
assert.ok(Math.abs(b40.organizing - Math.min(Math.max(0.15 * 40, S.organizingMinutes), S.briefShare * 40) / 40) < 1e-9 && Math.abs(b40.rope - 0.15) < 1e-9 && Math.abs(b40.mature / b40.shrinking - 0.45 / 0.25) < 1e-9);
assert.ok(Math.abs(tornadoStageShares(25).rope - 0.2) < 1e-9, 'a brief life still ropes for 5 min');
assert.ok([20, 25].some(m => tornadoStage(m, 25, 100).name === 'rope'), 'a 25-min life gets a rope tick');
// circulation kept as it spins up: the core at touchdown is the mature wind over 65 mph (EF3, 160 mph: 2.46), at most 2.5
assert.ok(Math.abs(tornadoStage(0, 65, 160, 160).coreShare - S.touchdownCore) < 1e-9);
assert.ok(tornadoStage(0, 65, 250, 250).coreShare <= S.touchdownCore + 1e-9);
// a brief vortex peaks sooner; the wind never rises past the vortex's or falls under 65 mph
assert.equal(tornadoStage(4, 10, 106).windMph, 106);
for (let m = 0; m <= 90; m += 1) { const st = tornadoStage(m, 90, 140, 140); assert.ok(st.windMph >= 65 && st.windMph <= 140 && st.coreShare >= S.ropeCore - 1e-9 && st.contortion >= 0 && st.contortion <= 1); }
// the mature core: the EF0 wind at half the damage width (300 yd at 106 mph: 84 m)
assert.equal(Math.round(matureCoreM(300, 106)), 84);
// ahead of the loss of the rotation holding it, it goes into its decay (shrinking, then the rope), and recovers with it
assert.equal(tornadoStage(30, 65, 106, 106, 0.2).name, 'shrinking'); assert.equal(tornadoStage(30, 65, 106, 106, 0.9).name, 'rope');
assert.equal(tornadoStage(30, 65, 106, 106, 0).name, 'mature', 'no loss ahead: mature');
// a rope does not fatten back: with the fall it reached in its rope as a floor, a longer life or a recovered rotation
// leaves it in its rope; shrinking still recovers to mature
const roping = tornadoStage(22, 25, 120, 120); assert.equal(roping.name, 'rope');
assert.equal(tornadoStage(22, 45, 120, 120, 0, roping.fall).name, 'rope', 'a life extended in its rope: still a rope');
assert.equal(tornadoStage(22, 45, 120, 120, 0, 0).name, 'mature', 'without the floor it would revive');
// the owner's rulings (2026-11-19): the stages shape the swirl - in a 56 mph storm a 180 mph vortex touches down and ends
// with swirl + half the motion at the EF0 wind (65 + 28 mph shown), not at 65 mph; a vortex that never passes that keeps its wind
const fast = { motionMph: 56 };
assert.equal(tornadoStage(0, 60, 180, 180, 0, 0, fast).windMph, 65 + S.motionShare * 56, 'touches down with its swirl at EF0');
assert.equal(tornadoStage(60, 60, 180, 180, 0, 0, fast).windMph, 65 + S.motionShare * 56, 'ends with its swirl at EF0');
assert.equal(tornadoStage(60, 60, 85, 85, 0, 0, fast).windMph, 85, 'a weak vortex in a fast storm keeps its own wind');
assert.equal(tornadoStage(60, 60, 106, 106).windMph, 65, 'a still storm: as before');
// a vortex falling from its peak past matureSlack is shrinking, not mature: half-way between the slack and shrinkWind, half-way through
// (a still storm: its swirl is its wind; slack = matureSlack x 106 mph; half-way between it and shrinkWind x the excess)
const slack = S.matureSlack * 106, halfWay = 106 - slack - (41 * (1 - S.shrinkWind) - slack) / 2;
assert.equal(tornadoStage(30, 65, 106 - slack / 2, 106, 0, 0, { peakMph: 106 }).name, 'mature', 'a small dip off its peak: still mature');
const weakened = tornadoStage(30, 65, halfWay, 106, 0, 0, { peakMph: 106 });
assert.equal(weakened.name, 'shrinking'); assert.ok(Math.abs(weakened.progress - 0.5) < 1e-9 && Math.abs(weakened.windMph - halfWay) < 1e-9, `${weakened.progress} ${weakened.windMph}`);
assert.equal(tornadoStage(30, 65, 106, 106, 0, 0, { peakMph: 106 }).name, 'mature', 'at its peak: mature');
assert.equal(tornadoStage(30, 65, 70, 106, 0, 0, { peakMph: 106 }).name, 'shrinking', 'a deep fall from its peak shrinks it, the rope comes with its time');
const held = tornadoStage(30, 65, 106, 106, 0, weakened.fall, { peakMph: 106 });
assert.ok(held.name === 'shrinking' && held.fall >= weakened.fall - 1e-9 && held.coreShare <= weakened.coreShare + 1e-9, 'the ratchet: a shrinking vortex stays in its decay (TornadoEngine holds its wind and core to their running minimum)');
// before and after: gestation over genesisPotential 0.4, dissipated for 10 min after the end
assert.equal(gestationStage(0.3), null); assert.equal(gestationStage(0.7).name, 'gestation');
assert.equal(dissipatedStage(null), null); assert.equal(dissipatedStage(3).name, 'dissipated'); assert.equal(dissipatedStage(10), null);
assert.equal(stormTornadoStage({ tornado: { onGround: true, lifeStage: 'rope', stageProgress: 0.5 } }).name, 'rope');
assert.equal(stormTornadoStage({ tornado: { onGround: false, minutesSinceEnd: 2, genesisPotential: 0.9 } }).name, 'dissipated');
assert.equal(stormTornadoStage({ tornado: { onGround: false, minutesSinceEnd: null, genesisPotential: 0.9 } }).name, 'gestation');
// tornadoDecay reads the contortion
assert.equal(tornadoDecay({ contortion: 0.6, lifeStage: 'rope' }), 0.6);
// the lean bends to LEAN_LIMIT: a tornado held 7 km from its wall cloud under a 660 m base leans about LEAN_LIMIT.matureDeg, not 85
const far = tornadoTilt({ tornado: { positionKm: { x: 0, y: 0 }, contortion: 0 }, geometry: { wallCloud: { xKm: -6.5, yKm: 2.7 } } }, { depthM: 500, baseM: 660 });
const top = far.at(660), deg = Math.atan(Math.hypot(top.east, top.north) / 660) * 180 / Math.PI;
assert.ok(deg > LEAN_LIMIT.matureDeg - 5 && deg <= LEAN_LIMIT.matureDeg + 1e-9, `lean ${deg}`);
const near = tornadoTilt({ tornado: { positionKm: { x: 0, y: 0 }, contortion: 0 }, geometry: { wallCloud: { xKm: -0.2, yKm: 0 } } }, { depthM: 500, baseM: 660 });
assert.ok(near.leanShare > 0.99, 'a small lean is kept as it is');
const t = { lifeMinutes: 65 };
assert.equal(rotationLossFall({ lowRotation: 0.3, lowRotationTrend: 0.1 }, t), 0, 'rotation rising: no loss ahead');
assert.equal(rotationLossFall({ lowRotation: 0.3, lowRotationTrend: -0.1 }, t), 0, 'loss 2.5 h away: none yet');
assert.ok(rotationLossFall({ lowRotation: 0.059, lowRotationTrend: -0.12 }, t) > 0.9, 'loss 2 min away: nearly a rope');
assert.equal(rotationLossFall({ lowRotation: 0.05, lowRotationTrend: -0.1 }, t), 1, 'already below what holds it');
// A loop is the track crossing itself.
const straight = [0, 1, 2, 3, 4].map(i => ({ x: i, y: 0 }));
const looped = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2.5, y: 0.5 }, { x: 2, y: 1 }, { x: 1.5, y: 0.5 }, { x: 2, y: -0.5 }, { x: 4, y: -0.5 }];
assert.equal(trackLoops(straight), 0); assert.equal(trackLoops(looped), 1);
// Surges: occlusions past irreversible do not fail; pushes before occludedFrom are mid-life turns of 30-55 deg.
assert.ok(RFD_SURGE.occludedFrom < RFD_SURGE.irreversible && RFD_SURGE.reloadTo < RFD_SURGE.occludedFrom);
assert.deepEqual(RFD_SURGE.turnDeg, [30, 55]);
console.log('tornado-life: ok', ticks.map(t => `${t.name[0]}${Math.round(t.windMph)}/${t.coreShare.toFixed(2)}/${t.contortion.toFixed(2)}`).join(' '));
