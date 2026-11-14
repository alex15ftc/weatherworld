// The outlooks' own verification on the live world (server/OutlookScoreboard.js, /api/outlook/scores), for the
// performance page: for each issue, how often the day's highest category was right, too high and too low, the skill of
// each hazard's contours, each category's CSI, and the reliability of the contour levels. (2026-11-14)
const panel = document.querySelector('#outlookScores');
const pct = v => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(100 * v)}%`);
const skill = v => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${Math.round(100 * v)}`);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const table = (head, rows) => `<table class="perf-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const hourName = h => { const d = Math.floor(h / 24), z = ((h % 24) + 24) % 24; return `day ${d} ${String(Math.floor(z)).padStart(2, '0')}${z % 1 ? '30' : '00'}Z`; };

function render(report) {
  if (!report || report.error) { panel.innerHTML = `<h2>Outlook verification</h2><p>${esc(report?.error ?? 'Unavailable')}</p>`; return; }
  const { summary = [], latest = [], pending = [] } = report;
  const intro = `<h2>Outlook verification</h2><p>Every outlook the server issues is scored against what happened once its day ends (this world only).</p>`
    + `<div class="metric-grid"><b>Days scored</b><span>${report.days}</span><b>Outlooks scored</b><span>${report.outlooks}</span><b>Waiting for their day</b><span>${pending.length}</span><b>Capturing since</b><span>${report.capturingFromHourUtc == null ? '—' : hourName(report.capturingFromHourUtc)}</span></div>`;
  if (!summary.length) { panel.innerHTML = `${intro}<p>No outlook has been scored yet: the first scores come at the end of the first whole day the server has watched.</p>`; return; }
  const hazards = [...new Set(summary.flatMap(s => Object.keys(s.hazards)))];
  const categories = ['MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
  const issues = table(['Issue', 'Outlooks', 'Right', 'Within one', 'Too high', 'Too low', 'Places right'],
    summary.map(s => [esc(s.issue), s.outlooks, pct(s.right), pct(s.withinOne), pct(s.tooHigh), pct(s.tooLow), pct(s.placesRight)]));
  const mix = table(['Issue', ...categories.map(c => `${c} fcst / verified`)],
    summary.map(s => [esc(s.issue), ...categories.map(c => `${pct(s.forecastMix[c])} / ${pct(s.verifiedMix[c])}`)]));
  const skills = table(['Issue', ...hazards.map(h => `${h} skill (issued / calibrated)`)],
    summary.map(s => [esc(s.issue), ...hazards.map(h => (s.hazards[h] ? `${skill(s.hazards[h].brierSkillIssued)} / ${skill(s.hazards[h].brierSkillCalibrated)}` : '—'))]));
  const csi = table(['Issue', ...categories.map(c => `CSI ${c}+`)], summary.map(s => [esc(s.issue), ...categories.map(c => (s.csi[c] == null ? '—' : s.csi[c].toFixed(2)))]));
  // Reliability pooled over every issue: the share of places inside each contour level that had the hazard near.
  const reliability = hazards.map(h => {
    const levels = new Map();
    for (const s of summary) for (const r of s.hazards[h]?.reliability ?? []) { const slot = levels.get(r.level) ?? { cells: 0, hits: 0 }; slot.cells += r.cells; slot.hits += (r.verified ?? 0) * r.cells; levels.set(r.level, slot); }
    return [h, ...[...levels.entries()].filter(([level]) => level > 0).map(([level, slot]) => `${level}% → ${slot.cells ? pct(slot.hits / slot.cells) : '—'}`)];
  });
  const recent = table(['Outlook', 'Valid to', 'Forecast', 'Verified', 'Places right'],
    latest.slice(0, 20).map(s => [`${esc(s.day)} ${hourName(s.issuedHourUtc)}`, hourName(s.validToHourUtc), esc(s.forecast), esc(s.verified), pct(s.placesRight)]));
  panel.innerHTML = `${intro}<h3>Highest category of the day</h3>${issues}<h3>Category mix</h3>${mix}<h3>Brier skill against the sample's base rate (points)</h3>${skills}`
    + `<h3>Category areas</h3>${csi}<h3>Reliability (contour level → share that verified)</h3>${table(['Hazard', 'Levels'], reliability.map(([h, ...levels]) => [esc(h), levels.join(' · ')]))}<h3>Latest</h3>${recent}`;
}

panel.innerHTML = '<h2>Outlook verification</h2><p>Loading…</p>';
fetch('/api/outlook/scores', { cache: 'no-store' })
  .then(response => (response.ok ? response.json() : response.json().catch(() => ({ error: `HTTP ${response.status}` }))))
  .then(render)
  .catch(error => render({ error: error.message }));
