// The shared header's behaviour on every page (site/header.html): marks the current section, opens the
// menu on a phone, and shows the world's clock. Also the small helpers the document pages share.
import { loadCalendar, dateText } from '/js/pageCalendar.js';

export const $ = selector => document.querySelector(selector);
export const escapeHtml = text => String(text ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
export async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw Object.assign(new Error(`${response.status}`), { status: response.status });
  return Object.assign(await response.json(), { __version: response.headers.get('x-product-version') });
}
// A world hour as "0130 UTC 11/12/26 Day 8", and its local (CDT) clock time.
const hm = hour => { const z = (((hour % 24) + 24) % 24) + 1e-6; return [Math.floor(z), Math.floor((z % 1) * 60)]; };
export const utcText = hour => { const [h, m] = hm(hour); return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')} UTC ${dateText(hour)}`.trim(); };
export const localText = hour => { const [h, m] = hm(hour - 5); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} CDT`; };
export const RISK_NAMES = { TSTM: 'Thunderstorms', MRGN: 'Marginal', SLGT: 'Slight', ENH: 'Enhanced', MDT: 'Moderate', HIGH: 'High' };
export const riskTag = key => (RISK_NAMES[key] ? `<span class="tag tag--${key}">${key === 'TSTM' ? 'Thunderstorms' : `${RISK_NAMES[key]} risk`}</span>` : '');
export { loadCalendar, dateText };

for (const link of document.querySelectorAll('.site-nav a[data-match]')) {
  if (new RegExp(link.dataset.match).test(location.pathname)) link.setAttribute('aria-current', 'page');
}
// (a section's own pages, in its menu: the one this address is)
const here = location.pathname.replace(/[/]$/, '') || '/';
for (const link of document.querySelectorAll('.site-sub a')) if (new URL(link.href).pathname === here) link.setAttribute('aria-current', 'page');
const menu = $('.site-menu'), nav = $('.site-nav');
menu?.addEventListener('click', () => { const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });

// Admin sign-in: the one place for it. The key is kept for this tab (wwAdminKey); the pages that show more to
// an admin (chasers, the world controls, the large-scale charts, past days) send it with their requests and the
// server decides the role each time. Signing in or out loads the page again, so everything on it is asked for
// with the new role.
const ADMIN_KEY = 'wwAdminKey';
export const adminKey = { get() { try { return sessionStorage.getItem(ADMIN_KEY); } catch { return null; } }, set(v) { try { v ? sessionStorage.setItem(ADMIN_KEY, v) : sessionStorage.removeItem(ADMIN_KEY); } catch { /* no storage here */ } } };
const roleNow = async () => { try { const key = adminKey.get(); return (await (await fetch('/api/chasers/role', { cache: 'no-store', headers: key ? { 'x-admin-key': key } : {} })).json()).role; } catch { return 'public'; } };
const adminButton = $('#siteAdmin');
if (adminButton) {
  roleNow().then(role => {
    // (a local engine with no key set treats this machine as admin: there is nothing to sign in to)
    adminButton.textContent = adminKey.get() ? (role === 'admin' ? 'Admin: sign out' : 'Admin key not accepted: sign out') : role === 'admin' ? 'Admin (this machine)' : 'Admin sign-in';
    adminButton.classList.toggle('on', role === 'admin');
    adminButton.hidden = false;
  });
  adminButton.addEventListener('click', async () => {
    if (adminKey.get()) { adminKey.set(null); location.reload(); return; }
    const key = prompt('Admin key');
    if (!key) return;
    adminKey.set(key.trim());
    if (await roleNow() === 'admin') location.reload();
    else { adminKey.set(null); alert('That key was not accepted.'); }
  });
}

// The world's clock: read once a minute, and run forward between reads at the world's speed.
const clock = $('#siteClock');
let clockAt = null;
async function readClock() {
  try {
    const [calendar, health] = await Promise.all([loadCalendar(), getJson('/api/health')]);
    clockAt = { hour: health.validHourUtc, read: Date.now(), speed: health.autoAdvance ? (calendar?.simHoursPerRealHour ?? 8) : 0 };
    const engine = $('#siteEngine');
    if (engine) engine.textContent = `WeatherWorld engine ${health.version} · world ${health.seed} · ${health.stormCount} storms, ${health.activeTornadoes} tornado${health.activeTornadoes === 1 ? '' : 'es'} on the ground`;
  } catch { clockAt = null; }
  tick();
}
function tick() {
  if (!clock) return;
  if (!clockAt) { clock.textContent = ''; return; }
  const hour = clockAt.hour + (Date.now() - clockAt.read) / 3600000 * clockAt.speed, [h, m] = hm(hour);
  clock.innerHTML = `<b>${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC</b>${[dateText(hour), localText(hour)].filter(Boolean).map(part => ` · ${escapeHtml(part)}`).join('')}`;
}
readClock();
setInterval(readClock, 60000);
setInterval(tick, 2000);
