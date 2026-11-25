// How a world hour is written with a date. The hosted engine locks the world's clock to real UTC time
// (WeatherAuthorityRuntime.startClocks): 8 world days to each real day, Day 1 from 00 UTC, Day 2 from
// 03 UTC ... Day 8 from 21 UTC. So every world hour has a fixed name, "11/11/26 Day 3", and how long the
// world has been running stays private. Without the locked clock (tests, offline tools) the world's own
// "Day N" stays.
const SIM_HOURS_PER_REAL_HOUR = 8, DAY_MS = 86400000;
let offsetOf = () => null;

// offset(): the world hour at 1970-01-01 00 UTC on the locked clock (whole world days), or null.
export function setCalendar({ offset }) { offsetOf = offset; }
export const calendarOn = () => offsetOf() != null;

const pad = n => String(n).padStart(2, '0');

// The real time (ms) the world hour falls on; null without the locked clock.
export function realMsOf(hour) {
  const offset = offsetOf();
  return offset == null ? null : (hour - offset) / SIM_HOURS_PER_REAL_HOUR * 3600000;
}

// { date: "11/11/26", day: 3 } (the world day's place in the real day, 1-8); null without the clock.
export function worldDate(hour) {
  const ms = realMsOf(hour + 1e-6);
  if (ms === null) return null;
  const d = new Date(ms);
  return { date: `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCFullYear() % 100)}`, day: Math.floor((ms - Math.floor(ms / DAY_MS) * DAY_MS) / (DAY_MS / 8)) + 1, dayOfMonth: d.getUTCDate() };
}

// "11/11/26 Day 3"; "Day 6" (the world's own count) without the clock.
export function dateText(hour) {
  const w = worldDate(hour);
  return w ? `${w.date} Day ${w.day}` : `Day ${Math.floor((hour + 1e-6) / 24) + 1}`;
}

// The day of the month, for DDHHMMZ stamps; the world day number without the clock.
export function dayOfMonth(hour) {
  return worldDate(hour)?.dayOfMonth ?? Math.floor((hour + 1e-6) / 24) + 1;
}

const hhmm = hour => { const z = (((hour % 24) + 24) % 24) + 1e-6, h = Math.floor(z), m = Math.floor((z - h) * 60); return `${pad(h)}${pad(m)}`; };

// "2330 UTC 11/11/26 Day 3" ("2330 UTC Day 6" without the clock).
export const utcStamp = hour => `${hhmm(hour)} UTC ${dateText(hour)}`;

// For the pages in the browser (js/pageCalendar.js): what they need to name world hours the same way.
export const calendarFor = () => ({ offset: offsetOf(), simHoursPerRealHour: SIM_HOURS_PER_REAL_HOUR });
