#!/usr/bin/env node
import path from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const BASE = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
const args = parseArgs(process.argv.slice(2));
await mkdir(args.cacheRoot, { recursive: true });
await mkdir(args.outputRoot, { recursive: true });
const years = [...new Set(args.dates.map(date => Number(date.slice(0, 4))))].sort();
const listing = await fetchText(BASE);
const available = [...listing.matchAll(/href="(StormEvents_details-ftp_v1\.0_d(\d{4})_c\d+\.csv\.gz)"/g)]
  .map(match => ({ name: match[1], year: Number(match[2]) }));

for (const year of years) {
  const candidates = available.filter(item => item.year === year).sort((a, b) => b.name.localeCompare(a.name));
  if (!candidates.length) throw new Error(`No NOAA Storm Events details file listed for ${year}`);
  const selected = candidates[0];
  const cacheFile = path.join(args.cacheRoot, selected.name);
  if (!(await exists(cacheFile))) {
    const response = await fetch(`${BASE}${selected.name}`);
    if (!response.ok) throw new Error(`NOAA download failed (${response.status}) for ${selected.name}`);
    await writeFile(cacheFile, new Uint8Array(await response.arrayBuffer()));
  }
  const compressed = await readFile(cacheFile);
  const csv = gunzipSync(compressed).toString('utf8');
  const rows = parseCsv(csv);
  for (const date of args.dates.filter(value => Number(value.slice(0, 4)) === year)) {
    const reports = deduplicate(rows.filter(row => normalizeNoaaDate(row.BEGIN_DATE_TIME) === date).map(normalizeReport));
    const record = {
      schemaVersion: '2.36.1',
      eventDate: date,
      source: 'NOAA NCEI Storm Events',
      reportCount: reports.length,
      counts: summarize(reports),
      reports,
      provenance: {
        bulkFile: selected.name,
        bulkFileSha256: createHash('sha256').update(compressed).digest('hex'),
        extractedAt: new Date().toISOString()
      }
    };
    await writeFile(path.join(args.outputRoot, `${date}.json`), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`NOAA complete: ${date} (${reports.length} reports)`);
  }
}

function normalizeReport(row) {
  const eventType = row.EVENT_TYPE ?? '';
  const type = /tornado/i.test(eventType) ? 'tornado' : /hail/i.test(eventType) ? 'hail' : /wind|thunderstorm/i.test(eventType) ? 'wind' : 'other';
  return {
    eventId: row.EVENT_ID || null,
    episodeId: row.EPISODE_ID || null,
    type,
    eventType,
    beginDateTime: row.BEGIN_DATE_TIME || null,
    endDateTime: row.END_DATE_TIME || null,
    state: row.STATE || null,
    county: row.CZ_NAME || null,
    latitude: numberOrNull(row.BEGIN_LAT),
    longitude: numberOrNull(row.BEGIN_LON),
    endLatitude: numberOrNull(row.END_LAT),
    endLongitude: numberOrNull(row.END_LON),
    magnitude: numberOrNull(row.MAGNITUDE),
    magnitudeType: row.MAGNITUDE_TYPE || null,
    tornadoRating: row.TOR_F_SCALE || null,
    injuriesDirect: numberOrNull(row.INJURIES_DIRECT) ?? 0,
    deathsDirect: numberOrNull(row.DEATHS_DIRECT) ?? 0
  };
}
function summarize(reports) {
  const counts = { tornado: 0, significantTornado: 0, violentTornado: 0, hail: 0, significantHail: 0, wind: 0, destructiveWind: 0, other: 0 };
  for (const report of reports) {
    counts[report.type] = (counts[report.type] ?? 0) + 1;
    const rating = Number(String(report.tornadoRating ?? '').replace(/[^0-9]/g, ''));
    if (report.type === 'tornado' && rating >= 2) counts.significantTornado += 1;
    if (report.type === 'tornado' && rating >= 4) counts.violentTornado += 1;
    if (report.type === 'hail' && (report.magnitude ?? 0) >= 2) counts.significantHail += 1;
    if (report.type === 'wind' && (report.magnitude ?? 0) >= 65) counts.destructiveWind += 1;
  }
  return counts;
}
function deduplicate(reports) {
  const seen = new Set();
  return reports.filter(report => {
    const key = report.eventId || [report.type, report.beginDateTime, report.state, report.county, report.latitude, report.longitude].join('|');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function normalizeNoaaDate(value = '') {
  const match = String(value).match(/^(\d{2})-(\w{3})-(\d{2,4})/i);
  if (!match) return null;
  const months = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  let year = Number(match[3]); if (year < 100) year += year >= 50 ? 1900 : 2000;
  const month = months[match[2].toUpperCase()];
  return month ? `${year}-${String(month).padStart(2, '0')}-${match[1]}` : null;
}
function parseCsv(text) {
  const lines = splitCsvRows(text);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map(value => value.replace(/^\uFEFF/, ''));
  return lines.slice(1).filter(Boolean).map(line => {
    const values = parseCsvLine(line); const row = {};
    headers.forEach((header, index) => { row[header] = values[index] ?? ''; });
    return row;
  });
}
function splitCsvRows(text) {
  const rows = []; let current = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') { current += char; if (text[i + 1] === '"') { current += text[++i]; } else quoted = !quoted; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (current) rows.push(current); current = ''; if (char === '\r' && text[i + 1] === '\n') i += 1; }
    else current += char;
  }
  if (current) rows.push(current); return rows;
}
function parseCsvLine(line) {
  const values = []; let current = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { values.push(current); current = ''; }
    else current += char;
  }
  values.push(current); return values;
}
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
async function fetchText(url) { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`); return response.text(); }
async function exists(file) { try { await access(file); return true; } catch { return false; } }
function parseArgs(values) {
  const out = { dates: [], cacheRoot: '', outputRoot: '' };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--dates') out.dates.push(...values[++i].split(',').map(v => v.trim()).filter(Boolean));
    else if (values[i] === '--cache-root') out.cacheRoot = values[++i];
    else if (values[i] === '--output-root') out.outputRoot = values[++i];
  }
  if (!out.dates.length || !out.cacheRoot || !out.outputRoot) throw new Error('Usage: --dates YYYY-MM-DD,... --cache-root DIR --output-root DIR');
  return out;
}
