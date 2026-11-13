// A sounding shown over a page: the skew-T, the hodograph and the tables beside them, as the mesoanalysis page
// lays them out. The model pages open it for a point of a run (models.html, and the long range model's page);
// the mesoanalysis page uses the tables (soundingTables) in its own side panel.
import { drawSounding, drawHodograph } from '../sounding.js';

// The tables beside a sounding, laid out as on a SHARPpy-style sounding: parcels, winds by layer, moisture and
// lapse rates, the composite indices and the possible hazard type.
const HAZARD_COLOURS = { 'PDS TOR': '#ff4dff', TOR: '#ff4d4d', 'MRGL TOR': '#ff8a8a', SVR: '#facc15', 'MRGL SVR': '#38bdf8', NONE: '#94a3b8' };
export function soundingTables(sounding) {
  const p = sounding.params, d = sounding.display ?? {}, motion = sounding.engineMotion ?? { right: p.stormMotion.right, left: p.stormMotion.left, ordinary: p.meanWind };
  const n = (v, digits = 0) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—');
  const from = v => `${String(Math.round((Math.atan2(-v.u, -v.v) * 180 / Math.PI + 360) % 360) % 360).padStart(3, '0')}/${Math.round(Math.hypot(v.u, v.v))}`;
  const parcel = (name, row) => `<tr><td>${name}</td><td>${n(row.cape)}</td><td>${n(row.cin)}</td><td>${n(row.lclAglM)}</td><td>${n(row.liftedIndex)}</td><td>${n(row.lfcAglM)}</td><td>${n(row.elAglM)}</td></tr>`;
  const list = rows => `<dl>${rows.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join('')}</dl>`;
  const hazard = d.hazardType ?? 'NONE';
  return `
    <section class="wide"><table><tr><th>PCL</th><th>CAPE</th><th>CINH</th><th>LCL m</th><th>LI</th><th>LFC m</th><th>EL m</th></tr>
      ${parcel('SFC', p.parcels.surface)}${parcel('ML', p.parcels.mixedLayer)}${parcel('MU', p.parcels.mostUnstable)}</table></section>
    <section><table><tr><th>Layer</th><th>SRH</th><th>Shear kt</th></tr>
      <tr><td>SFC-1 km</td><td>${n(p.srh01)}</td><td>${n(p.shear01)}</td></tr><tr><td>SFC-3 km</td><td>${n(p.srh03)}</td><td>${n(p.shear03)}</td></tr>
      <tr><td>SFC-6 km</td><td></td><td>${n(p.shear06)}</td></tr><tr><td>SFC-8 km</td><td></td><td>${n(d.shear08)}</td></tr></table>
      ${list([['Storm motion, right', `${from(motion.right)} kt`], ['Storm motion, left', `${from(motion.left)} kt`], ['Mean wind', `${from(motion.ordinary)} kt`], ['4-6 km storm-rel. wind', `${n(d.srw46)} kt`], ['Critical angle', `${n(p.criticalAngle)}°`]])}</section>
    <section>${list([['PW', `${n(p.precipWater, 2)} in`], ['3CAPE', `${n(d.cape03)} J/kg`], ['DCAPE', `${n(p.dcape)} J/kg`], ['Lapse 0-3 km', `${n(p.lapseRate03km, 1)} C/km`], ['Lapse 3-6 km', `${n(d.lapse36, 1)} C/km`], ['Lapse 850-500', `${n(p.lapseRate850500, 1)} C/km`], ['Lapse 700-500', `${n(p.lapseRate700500, 1)} C/km`], ['Freezing level', `${n(d.freezingAglM)} m`], ['Wet-bulb zero', `${n(d.wetBulbZeroAglM)} m`], ['Mean RH low / mid', `${n(d.lowRh)} / ${n(d.midRh)} %`]])}</section>
    <section class="wide">${list([['Supercell composite', n(p.scp, 1)], ['Sig. tornado', n(p.stp, 1)], ['Sig. hail', n(d.ship, 1)], ['Wind damage', n(d.windDamage, 1)]])}
      <div class="snd-hazard"><small>Psbl haz. type</small><b style="color:${HAZARD_COLOURS[hazard] ?? HAZARD_COLOURS.NONE}">${hazard}</b></div></section>`;
}

const STYLE = `
  .snd-over { position: fixed; inset: 0; z-index: 60; background: rgba(6, 10, 15, .62); display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 24px 16px; }
  .snd-box { background: #0d1218; color: #e9eae7; border: 1px solid #363c42; padding: 14px; width: min(1080px, 100%); --muted: #9ba1a6; font-family: "Public Sans", system-ui, sans-serif; }
  .snd-box header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .snd-box header strong { font-size: 17px; } .snd-box header small { color: #9ba1a6; }
  .snd-box header button { appearance: none; background: #17202a; color: #e9eae7; border: 1px solid #4a535c; border-radius: 2px; padding: 6px 14px; font: 600 14px "Public Sans", system-ui, sans-serif; cursor: pointer; }
  .snd-box header button:hover { border-color: #e9eae7; }
  .snd-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
  .snd-grid canvas { display: block; width: 100%; height: auto; border: 1px solid #363c42; background: #05080d; }
  .snd-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  @media (max-width: 820px) { .snd-grid { grid-template-columns: minmax(0, 1fr); } }
  .snd-box .snd-tables { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font: 12px/1.45 "IBM Plex Mono", ui-monospace, monospace; }
  .snd-box .snd-tables section { border: 1px solid #363c42; padding: 7px 9px; background: #05080d; }
  .snd-box .snd-tables section.wide { grid-column: 1 / -1; }
  .snd-box .snd-tables table { width: 100%; border-collapse: collapse; }
  .snd-box .snd-tables th { color: #9ba1a6; font-weight: 600; text-align: right; } .snd-box .snd-tables td { text-align: right; }
  .snd-box .snd-tables th:first-child, .snd-box .snd-tables td:first-child { text-align: left; color: #9ba1a6; }
  .snd-box .snd-tables dl { display: grid; grid-template-columns: 1fr auto; gap: 0 10px; margin: 0; }
  .snd-box .snd-tables dt { color: #9ba1a6; } .snd-box .snd-tables dd { margin: 0; text-align: right; }
  .snd-box .snd-hazard { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; margin-top: 8px; padding: 6px; border: 1px solid #363c42; }
  .snd-box .snd-hazard small { color: #9ba1a6; } .snd-box .snd-hazard b { font-size: 16px; }`;

let over = null;
export function closeSounding() { over?.remove(); over = null; }

// Opens the panel with a title, shows `load()`'s sounding in it when that arrives (a note says what failed if it
// does not). note(sounding): the line under the title.
export async function openSounding({ title, load, note = () => '' }) {
  closeSounding();
  if (!document.getElementById('sndStyle')) { const style = document.createElement('style'); style.id = 'sndStyle'; style.textContent = STYLE; document.head.append(style); }
  const mine = over = document.createElement('div');
  over.className = 'snd-over';
  over.innerHTML = `<div class="snd-box" role="dialog" aria-label="Sounding"><header><div><strong></strong><br /><small>Loading…</small></div><button type="button">Close</button></header>
    <div class="snd-grid"><canvas width="640" height="620"></canvas><div class="snd-side"><canvas width="640" height="540"></canvas><div class="snd-tables"></div></div></div></div>`;
  over.querySelector('strong').textContent = title;
  over.querySelector('button').addEventListener('click', closeSounding);
  over.addEventListener('click', event => { if (event.target === mine) closeSounding(); });
  const onKey = event => { if (event.key === 'Escape') { closeSounding(); removeEventListener('keydown', onKey); } };
  addEventListener('keydown', onKey);
  document.body.append(over);
  try {
    const sounding = await load();
    if (over !== mine) return;
    const [skewT, hodograph] = mine.querySelectorAll('canvas');
    drawSounding(skewT, sounding); drawHodograph(hodograph, sounding);
    mine.querySelector('small').textContent = note(sounding);
    mine.querySelector('.snd-tables').innerHTML = soundingTables(sounding);
  } catch { if (over === mine) mine.querySelector('small').textContent = 'No sounding is kept for this point and time.'; }
}
