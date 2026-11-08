// Grades what the game draws against physics, stage by stage of a tornado's life
// (tools/stormlab/lifecycle-serve.mjs records the life; the client publishes TornadoAudit on the
// lab root - stormlab/client/Render/TornadoCards - and the capture run saves one per stage).
//
//   node tools/stormlab/look-audit.mjs <life.json> <audit dir> [out.md]
//   audit dir: one <stage>_<i>.json per captured moment (the TornadoAudit attribute's JSON)
//
// The checks are independent of the renderer's own rules: the condensation funnel is worked out
// here from a Rankine vortex's cyclostrophic pressure deficit against the hydrostatic pressure fall
// to the cloud base (a parcel condenses where the vortex lowers its pressure by as much as rising to
// the base would), so a renderer that drifts from the physics shows up.
import fs from 'node:fs';
import path from 'node:path';

const [lifePath, auditDir, outPath] = process.argv.slice(2);
if (!lifePath || !auditDir) { console.log('usage: look-audit.mjs <life.json> <audit dir> [out.md]'); process.exit(1); }
const life = JSON.parse(fs.readFileSync(lifePath, 'utf8'));
const G = 9.81;

// Rankine: deficit (in m of hydrostatic lift, i.e. dp / (rho g)) at radius r
const deficitM = (vc, R, r) => (r <= R ? vc * vc * (1 - (r * r) / (2 * R * R)) : (vc * vc * R * R) / (2 * r * r)) / G;
// the condensation radius at height z under base H: where deficit = H - z (0 if it never gets there)
function condR(vc, R, H, z) {
  const need = H - z;
  if (need <= 0) return Infinity;
  if (deficitM(vc, R, 0) < need) return 0;
  if (deficitM(vc, R, R) >= need) return (R * vc) / Math.sqrt(2 * G * need); // outside the core
  return R * Math.sqrt(2 * (1 - (need * G) / (vc * vc))); // inside the core
}

const rows = [];
const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.json')).sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));
for (const f of files) {
  const a = JSON.parse(fs.readFileSync(path.join(auditDir, f), 'utf8'));
  const i = parseInt(f.split('_')[1]);
  const fr = life[i] ?? {};
  const checks = [];
  const add = (name, ok, detail, weight = 1) => checks.push({ name, ok, detail, weight });
  const H = a.H, vc = a.vc, R = a.coreR, Zc = a.coreZb > 0 ? Math.min(a.coreZb, H) : H; // (the core's own air condenses at Zc)
  const engOn = !!fr.tor?.onGround;
  // 1 does it reach the ground when the physics says it does (Vc^2 >= g H at the axis)
  const ground = a.prof?.find(p => p.f === 0);
  const physReach = deficitM(vc, ground?.core || R, 0) >= Zc;
  const drawnReach = !!ground && ground.rc > 1 && (ground.cond ?? 1) > 0.2;
  add('funnel reaches ground', drawnReach === physReach, `drawn ${drawnReach} · physics ${physReach} (Vc ${vc} m/s, needs ${Math.sqrt(G * Zc).toFixed(0)} for the core's condensation level ${Zc} m)`, 2);
  add('ground contact matches engine', !engOn || physReach || drawnReach, `engine on ground ${engOn}`, 1);
  // 2 the funnel's radius at each height against the condensation radius (within a factor 1.6)
  for (const p of a.prof ?? []) {
    if (p.f === 1 || p.z >= H) continue;
    if (p.z >= Zc) continue; // (above the core's level: condensed out to the cap)
    const want = condR(vc, p.core || R, Zc, p.z);
    if (!isFinite(want)) continue;
    const ratio = want > 0 ? p.rc / want : (p.rc > 1 ? Infinity : 1);
    add(`width at ${Math.round(p.f * 100)}% of the funnel`, ratio > 1 / 1.6 && ratio < 1.6, `drawn ${p.rc} m · condensation ${want.toFixed(0)} m (x${isFinite(ratio) ? ratio.toFixed(2) : 'inf'})`);
  }
  // 3 the join: the funnel ends at the lowering's floor, the floor sits under the base
  if (a.wallFloor != null) {
    add('funnel top at wall-cloud floor', Math.abs(a.Hj - a.wallFloor) <= 0.05 * H, `top ${a.Hj} m · floor ${a.wallFloor} m`);
    add('wall cloud under the base', a.wallFloor <= H + 1, `floor ${a.wallFloor} m · base ${H} m`);
    add('funnel narrower than its lowering', (a.prof?.at(-1)?.rc ?? 0) <= (a.wallR ?? Infinity), `top ${a.prof?.at(-1)?.rc} m · wall cloud ${a.wallR} m`);
  } else add('a wall cloud over an on-ground tornado', !engOn, 'no lowering published');
  // 4 rain greying follows the rain seen through (0.85 x opacity of the rain, at most 0.8)
  if (a.rainK != null && a.sight != null) add('rain greying from rain in sight', a.rainK <= 0.8 + 1e-6 && (a.sight < 0.98 || a.rainK < 0.1), `grey ${a.rainK?.toFixed(2)} · sight ${a.sight?.toFixed(2)}`);
  // 5 the drawn swirl against the engine's rating (Vc = the rated wind less the motion: within 35%)
  if (fr.tor?.mph) {
    const rated = fr.tor.mph * 0.44704;
    add('drawn core wind vs engine rating', vc > 0.65 * rated * 0.7 && vc < 1.35 * rated, `drawn Vc ${vc} m/s · rated ${rated.toFixed(0)} m/s`);
  }
  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0) / Math.max(1, checks.reduce((s, c) => s + c.weight, 0));
  rows.push({ file: f, i, stage: fr.stage ?? f.split('_')[0], hour: fr.hour, tor: fr.tor, score, checks });
}

let md = `# Look audit against physics\n\n${lifePath}\n\n| moment | stage | engine | score |\n|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.i} | ${r.stage} | ${r.tor ? `${r.tor.mph} mph ${r.tor.yards} yd ${r.tor.onGround ? 'on ground' : 'off'}` : '-'} | ${(r.score * 100).toFixed(0)}% |\n`;
for (const r of rows) {
  md += `\n## ${r.i} ${r.stage}\n\n`;
  for (const c of r.checks) md += `- ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}\n`;
}
if (outPath) fs.writeFileSync(outPath, md);
console.log(md);
