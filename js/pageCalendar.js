// The browser's side of js/forecast/calendar.js: pages name a world hour "11/11/26 Day 3" (the real
// date and the world day's place in it, 8 to a real day), never by the world's own day count. The
// clock's offset comes from /api/calendar; until it has loaded (or without the locked clock) the date
// is left out.
let calendar = null;
const DAY_MS = 864e5, pad = n => String(n).padStart(2, '0');

export async function loadCalendar() {
  try { calendar = await (await fetch('/api/calendar', { cache: 'no-store' })).json(); } catch { calendar = null; }
  return calendar;
}

export function dateText(hour) {
  if (calendar?.offset == null) return '';
  const ms = (hour + 1e-6 - calendar.offset) / calendar.simHoursPerRealHour * 3600000, d = new Date(ms);
  const day = Math.floor((ms - Math.floor(ms / DAY_MS) * DAY_MS) / (DAY_MS / 8)) + 1;
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCFullYear() % 100)} Day ${day}`;
}
