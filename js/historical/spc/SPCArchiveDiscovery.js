import { buildSpcArchiveYearUrl, normalizeDateInput } from './SPCOutlookArchive.js';

export const SPC_TARGET_CYCLES = Object.freeze({
  day1: Object.freeze(['0100', '0600', '1200', '1300', '1630', '2000']),
  day2: Object.freeze(['0600', '0700', '1730']),
  day3: Object.freeze(['0730'])
});

export function buildTargetedArchiveCandidates({ startDate, endDate = startDate, forecastDays, baseUrl } = {}) {
  const start = normalizeDateInput(startDate, 'startDate');
  const end = normalizeDateInput(endDate, 'endDate');
  const days = forecastDays?.length ? forecastDays : Object.keys(SPC_TARGET_CYCLES);
  const entries = [];
  for (const isoDate of dateRange(start, end)) {
    const issueDate = isoDate.replaceAll('-', '');
    const year = Number(issueDate.slice(0, 4));
    for (const forecastDay of days) {
      const cycles = SPC_TARGET_CYCLES[forecastDay];
      if (!cycles) throw new TypeError(`Unsupported forecast day: ${forecastDay}`);
      for (const cycle of cycles) {
        const dayNumber = forecastDay.slice(-1);
        const fileName = `day${dayNumber}otlk_${issueDate}_${cycle}.html`;
        entries.push(Object.freeze({
          identity: `${forecastDay}:${issueDate}:${cycle}`,
          forecastDay,
          issueDate,
          cycle,
          year,
          fileName,
          url: new URL(fileName, buildSpcArchiveYearUrl(year, baseUrl)).href
        }));
      }
    }
  }
  return Object.freeze(entries);
}

export async function discoverTargetedArchiveEntries(candidates, {
  request,
  concurrency = 4,
  maxProducts = Infinity,
  onProbe = () => {}
} = {}) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const queue = [...candidates];
  const found = [];
  const failures = [];
  let cursor = 0;
  let active = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const index = cursor++;
      if (index >= queue.length) return;
      const entry = queue[index];
      active += 1;
      try {
        const response = await request(entry.url);
        const html = await response.text();
        if (found.length < maxProducts) found.push({ ...entry, html });
        if (found.length >= maxProducts) stopped = true;
        onProbe({ entry, status: 'found', found: found.length, total: queue.length });
      } catch (error) {
        if (error?.status === 404) {
          onProbe({ entry, status: 'missing', found: found.length, total: queue.length });
        } else {
          failures.push(Object.freeze({ identity: entry.identity, url: entry.url, error: error?.message ?? String(error) }));
          onProbe({ entry, status: 'failed', found: found.length, total: queue.length, error });
        }
      } finally {
        active -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, Number(concurrency) || 1), queue.length) }, worker));
  return Object.freeze({
    entries: Object.freeze(found.map(({ html, ...entry }) => Object.freeze(entry))),
    pages: new Map(found.map(({ identity, html }) => [identity, html])),
    failures: Object.freeze(failures),
    probed: Math.min(cursor, queue.length),
    active
  });
}

function dateRange(start, end) {
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (last < first) throw new RangeError('endDate must not precede startDate');
  const values = [];
  for (let value = first; value <= last; value = new Date(value.getTime() + 86400000)) values.push(value.toISOString().slice(0, 10));
  return values;
}
