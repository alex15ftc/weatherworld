// Forecast discussion for an issued outlook: what the ensemble produced, how much its members
// agreed, and the environment at the core of the highest risk.
import { RISK_ORDER, RISK_LABELS } from './spcOutlookRules.js';

export function buildOutlookDiscussion(world, config, day = 'day1') {
  const product = world?.outlookCycle?.products?.[day] ?? null;
  const pattern = config?.narrativeLabel ?? config?.setupLabel ?? 'Plains weather system';
  const stage = synopticStage(config?.synopticPattern);
  if (!product || product.status !== 'issued') {
    const pending = Boolean(world?.outlookCycle?.pending?.length) || !product;
    const message = product?.status === 'beyond-system'
      ? `The ${formatHour(product.validStartHour)}–${formatHour(product.validEndHour)} period lies beyond the current weather system; the next system's outlooks are issued when it begins.`
      : pending ? 'The outlook ensemble is running; the product is issued when its members finish.' : 'No outlook has been issued for this period.';
    return { pattern, stage, confidence: null, ensemble: { agreement: '—', memberCount: 0 }, supportingFactors: [], limitingFactors: [], discussion: message, status: product?.status ?? 'pending' };
  }
  const grid = product.grid ?? [];
  const max = key => Math.max(0, ...grid.map(g => Number(g?.[key]) || 0));
  // A period in the next weather system: the current analysis says nothing about it.
  const nextSystem = product.system === 'next';
  const core = nextSystem ? {} : coreEnvironment(world, grid);
  const members = product.memberCount ?? 0;
  const tornadic = product.ensemble?.membersWithTornadoes ?? 0;
  const tornadoShare = members ? tornadic / members : 0;
  const agreementScore = Math.max(tornadoShare, 1 - tornadoShare);
  const agreement = agreementScore >= 0.8 ? 'High' : agreementScore >= 0.6 ? 'Moderate' : 'Low';
  const { supporting, limiting } = nextSystem ? { supporting: [], limiting: [] } : environmentFactors(core);
  const day3 = day === 'day3';
  const hazards = day3
    ? [`up to ${max('severeProbability')}%`]
    : [`tornado ${max('tornadoProbability')}%`, `hail ${max('hailProbability')}%`, `wind ${max('windProbability')}%`];
  const slightArea = grid.filter(g => RISK_ORDER.indexOf(g.risk) >= RISK_ORDER.indexOf('SLGT')).length;
  const discussion = [
    nextSystem
      ? `This period belongs to the next weather system. ${members} perturbed runs from that system's starting state cover ${formatHour(product.validStartHour)}–${formatHour(product.validEndHour)}; the spread narrows as it approaches.`
      : `${pattern}; ${stage.toLowerCase()}. ${members} perturbed runs of the simulation from the ${formatHour(product.issuedHourUtc)} analysis cover ${formatHour(product.validStartHour)}–${formatHour(product.validEndHour)}.`,
    `Members produce ${range(product.ensemble?.stormsPerMember)} new storms and ${range(product.ensemble?.tornadoesPerMember)} tornadoes; ${tornadic} of ${members} produce at least one tornado.`,
    `${RISK_LABELS[product.overallRisk] ?? product.overallRisk} is the highest category${slightArea ? `, with Slight or greater over ${Math.round(100 * slightArea / Math.max(1, grid.length))}% of the domain` : ''}. ${day3 ? 'Total severe' : 'Peak'} probabilities: ${hazards.join(', ')}.`
  ].join(' ');
  return {
    pattern: nextSystem ? 'Next weather system' : pattern, stage: nextSystem ? 'Not yet begun' : stage, confidence: Math.round(100 * agreementScore), status: 'issued',
    ensemble: { agreement, memberCount: members, membersWithTornadoes: tornadic, stormsPerMember: product.ensemble?.stormsPerMember, tornadoesPerMember: product.ensemble?.tornadoesPerMember },
    environment: core, supportingFactors: supporting, limitingFactors: limiting, discussion
  };
}

function synopticStage(pattern) {
  const deepening = Number(pattern?.dynamics?.deepeningHpaPerHour) || 0;
  if (deepening > 0.15) return 'Surface cyclone deepening';
  if (deepening < -0.15) return 'Surface cyclone filling';
  return 'Mature surface cyclone';
}

// Current environment averaged over the cells carrying the highest category.
function coreEnvironment(world, grid) {
  if (!world?.getCell || !grid.length) return null;
  const top = Math.max(...grid.map(g => RISK_ORDER.indexOf(g.risk)));
  if (top < RISK_ORDER.indexOf('MRGN')) return null;
  const cells = [];
  grid.forEach((g, i) => { if (RISK_ORDER.indexOf(g.risk) === top) cells.push(world.getCell(i % world.width, Math.floor(i / world.width))); });
  const mean = get => cells.reduce((sum, c) => sum + (Number(get(c)) || 0), 0) / cells.length;
  return {
    cape: mean(c => c.derived?.cape), cin: Math.abs(mean(c => c.derived?.cin)), srh: mean(c => c.derived?.srh),
    shear: mean(c => c.derived?.bulkShear), lcl: mean(c => c.derived?.lclAgl ?? c.derived?.lcl), dewpoint: mean(c => c.surface?.dewpoint),
    lapseRate: mean(c => c.derived?.lapseRate700500)
  };
}

function environmentFactors(e) {
  const supporting = [], limiting = [];
  if (!e) return { supporting, limiting };
  if (e.dewpoint >= 65) supporting.push(`Rich low-level moisture (${round(e.dewpoint)}°F dewpoints)`);
  else if (e.dewpoint < 58) limiting.push(`Limited low-level moisture (${round(e.dewpoint)}°F dewpoints)`);
  if (e.cape >= 2500) supporting.push(`Strong instability (${round(e.cape)} J/kg CAPE)`);
  else if (e.cape < 1000) limiting.push(`Modest instability (${round(e.cape)} J/kg CAPE)`);
  if (e.lapseRate >= 7.5) supporting.push(`Steep mid-level lapse rates (${e.lapseRate.toFixed(1)} °C/km)`);
  if (e.cin >= 100) limiting.push(`Capping inversion (${round(e.cin)} J/kg CIN at analysis time)`);
  if (e.shear >= 45) supporting.push(`Strong deep-layer shear (${round(e.shear)} kt)`);
  else if (e.shear < 30) limiting.push(`Weak deep-layer shear (${round(e.shear)} kt)`);
  if (e.srh >= 200) supporting.push(`Strong low-level shear (${round(e.srh)} m²/s² 0–1 km SRH)`);
  else if (e.srh < 100) limiting.push(`Weak low-level shear (${round(e.srh)} m²/s² 0–1 km SRH)`);
  if (e.lcl > 0 && e.lcl <= 1100) supporting.push(`Low cloud bases (${round(e.lcl)} m LCL)`);
  else if (e.lcl >= 1600) limiting.push(`High cloud bases (${round(e.lcl)} m LCL)`);
  return { supporting, limiting };
}

const round = v => Math.round(Number(v) || 0);
const range = r => (r ? (r.min === r.max ? `${r.median}` : `${r.min}–${r.max} (median ${r.median})`) : '—');
function formatHour(hour) {
  const h = Number(hour) || 0, day = Math.floor(h / 24) + 1, utc = ((h % 24) + 24) % 24;
  return `Day ${day} ${String(Math.floor(utc)).padStart(2, '0')}${String(Math.round((utc % 1) * 60)).padStart(2, '0')}Z`;
}
