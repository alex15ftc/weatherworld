// The wording of the storm reports and damage surveys as the game shows them
// (server/GameProducts.js): a report's line and a survey's summary, as the storm reports page
// and the damage survey page word them. Times are the world's clock: UTC, and CDT five hours behind.
import { DAMAGE_INDICATORS } from './damageIndicators.js';

export const localTime = hour => { const h = (((hour - 5) % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.min(59, Math.round((h - hh) * 60)); return `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'} CDT`; };
export const utcTime = hour => { const h = ((hour % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.min(59, Math.round((h - hh) * 60)); return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}Z`; };
const minutes = m => (m == null ? '—' : m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`);

// Significant reports, as the Storm Prediction Center marks them: hail of 2 inches or more, wind of 75 mph or more.
export const significantReport = r => (r.type === 'hail' && r.size >= 200) || (r.type === 'wind' && r.speed >= 75);

// A report's heading and its text (where, what was said, which office took it).
export function reportTitle(r) {
  const what = r.type === 'tornado' ? 'Tornado' : r.type === 'hail' ? `Hail ${(r.size / 100).toFixed(2)} in` : `Wind ${r.speed ? `${r.speed} mph${r.measured ? ' measured' : ''}` : 'damage'}`;
  return `${utcTime(r.hourUtc)} ${what}`;
}
export function reportText(r) {
  return [
    `${localTime(r.hourUtc)} (${utcTime(r.hourUtc)})`,
    `${r.location}${r.county ? `, ${r.county} County` : ''}`,
    '',
    `${r.comment}${r.office ? ` (${r.office})` : ''}`
  ].join('\n');
}

// A survey's heading and its summary, as a damage survey reads.
export const surveyTitle = t => `${t.rating} tornado · ${t.lengthMi.toFixed(1)} mi · ${t.maxWidthYards} yd`;
export function surveySummary(t) {
  const peak = t.peakPoint, di = peak ? DAMAGE_INDICATORS[peak.di] : null;
  const lines = [
    `${t.stormId} tornado ${t.id.split('-T')[1] ?? ''}${t.ongoing ? '   (still on the ground: survey preliminary)' : ''}`, '',
    `Rating:               ${t.rating}`,
    `Estimated peak wind:  ${t.peakWindMph ? `${t.peakWindMph} mph` : 'unknown'}`,
    `Path length:          ${t.lengthMi.toFixed(1)} miles`,
    `Path width:           ${t.maxWidthYards} yards`,
    `Duration:             ${minutes(t.durationMinutes)}`,
    `Start:                ${localTime(t.startHourUtc)} (${utcTime(t.startHourUtc)})`,
    `                      ${t.startPlace ?? `${t.start[0].toFixed(1)}, ${t.start[1].toFixed(1)} mi`}`,
    `End:                  ${t.endHourUtc != null ? `${localTime(t.endHourUtc)} (${utcTime(t.endHourUtc)})` : '—'}`,
    `                      ${t.endPlace ?? `${t.end[0].toFixed(1)}, ${t.end[1].toFixed(1)} mi`}`,
    `Counties:             ${t.counties.join(', ') || '—'}`,
    `Offices:              ${t.offices.join(', ') || '—'}`,
    '', 'Summary:'
  ];
  const towns = t.towns.length ? ` It passed through or near ${t.towns.join(', ')}.` : '';
  if (peak) lines.push(`The tornado touched down ${t.startPlace ?? ''} at ${localTime(t.startHourUtc)} and ended ${t.endPlace ?? ''}${t.endHourUtc != null ? ` at ${localTime(t.endHourUtc)}` : ''}, a path of ${t.lengthMi.toFixed(1)} miles.${towns} The most intense damage was to a ${di.name.toLowerCase()} (DI ${di.number}): ${peak.description.charAt(0).toLowerCase()}${peak.description.slice(1)} (degree of damage ${peak.dod}), rated ${t.rating} with an estimated wind of ${peak.estimatedMph} mph. ${t.points.length === 1 ? 'One damage point was' : `${t.points.length} damage points were`} surveyed.`);
  else lines.push(`The tornado touched down ${t.startPlace ?? ''} at ${localTime(t.startHourUtc)} and moved ${t.lengthMi.toFixed(1)} miles over open country. It struck nothing the Enhanced Fujita scale has a damage indicator for, so it is rated EF-Unknown (EFU).`);
  if (t.indicators.length) {
    lines.push('', 'Damage indicators:');
    for (const i of t.indicators) lines.push(`  ${i.di.padEnd(5)} ${String(i.count).padStart(4)}  worst EF${i.maxEf}  ${i.name}`);
  }
  return lines.join('\n');
}
