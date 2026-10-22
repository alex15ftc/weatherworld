// Colours of the issued products, shared by the web developer views and the Roblox place
// (scripts/export-palettes.mjs writes them into roblox/src/shared/Weather/Palettes.luau).

// Colours as the real outlooks use them (the 75% and 90% wind levels, added in 2026, are our own choice).
export const CATEGORY_COLOURS = { TSTM: '#c1e9c1', MRGN: '#66a366', SLGT: '#ffe066', ENH: '#ffa366', MDT: '#e06666', HIGH: '#ee99ee' };
export const CATEGORY_SHORT = { TSTM: 'TSTM', MRGN: 'MRGL', SLGT: 'SLGT', ENH: 'ENH', MDT: 'MDT', HIGH: 'HIGH' };
export const CHANCE_COLOURS = {
  tornado: { 2: '#008b00', 5: '#8b4726', 10: '#ffc800', 15: '#ff0000', 30: '#ff00ff', 45: '#912cee', 60: '#104e8b' },
  hail: { 5: '#8b4726', 15: '#ffc800', 30: '#ff0000', 45: '#ff00ff', 60: '#912cee' },
  wind: { 5: '#8b4726', 15: '#ffc800', 30: '#ff0000', 45: '#ff00ff', 60: '#912cee', 75: '#104e8b', 90: '#00868b' },
  severe: { 5: '#8b4726', 15: '#ffc800', 30: '#ff0000', 45: '#ff00ff', 60: '#912cee' }
};

// Watches: red for a tornado watch, blue for a severe thunderstorm watch.
export const WATCH_COLOURS = { tornado: '#ef4444', severe: '#3b82f6' };
// Mesoscale discussions: about a watch, the watch's colour; otherwise grey, amber and orange as a
// watch goes from unlikely to likely.
export const DISCUSSION_COLOURS = { watchTornado: '#ef4444', watchSevere: '#3b82f6', likely: '#f97316', possible: '#f59e0b', unlikely: '#94a3b8' };
export const discussionColourKey = md => (md.watchNumber ? (md.watchType === 'tornado' ? 'watchTornado' : 'watchSevere') : md.watchPercent >= 80 ? 'likely' : md.watchPercent >= 40 ? 'possible' : 'unlikely');
// Warnings (NWS): red for a tornado warning, yellow for a severe thunderstorm warning; magenta for
// a particularly dangerous tornado, violet for a tornado emergency, oranges for the damage tiers
// of a severe thunderstorm.
export const WARNING_COLOURS = { tornadoEmergency: '#b44dff', tornadoPds: '#ff3df2', tornado: '#ff2d2d', severeDestructive: '#ff5a1f', severeConsiderable: '#ff9f1a', severe: '#f5c518' };
export const warningColourKey = w => (w.type === 'tornado' ? (w.emergency ? 'tornadoEmergency' : w.pds ? 'tornadoPds' : 'tornado') : w.tags?.damage === 'DESTRUCTIVE' ? 'severeDestructive' : w.tags?.damage === 'CONSIDERABLE' ? 'severeConsiderable' : 'severe');
// Storm reports (SPC): red tornado, green hail, blue wind. Damage surveys (DAT): each EF rating
// its colour, grey for EF-Unknown.
export const REPORT_COLOURS = { tornado: '#ef4444', hail: '#22c55e', wind: '#3b82f6' };
export const EF_COLOURS = ['#60a5fa', '#4ade80', '#facc15', '#fb923c', '#ef4444', '#e879f9'];
export const EFU_COLOUR = '#9ca3af';
// The most urgent first.
export const warningRank = w => (w.type === 'tornado' ? (w.emergency ? 6 : w.pds ? 5 : w.tags?.tornado === 'OBSERVED' ? 4 : 3) : w.tags?.damage === 'DESTRUCTIVE' ? 2 : w.tags?.damage === 'CONSIDERABLE' ? 1 : 0);
