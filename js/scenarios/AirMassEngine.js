// Air-mass diagnostics from the current fields. The elevated mixed layer (EML) is diagnosed
// where 700 mb air is warm and the 700-500 mb lapse rate is steep; its temperatures are part
// of the evolving atmosphere (advected and resupplied by the synoptic coupling), never
// re-imposed here.
import { clamp } from './math.js';

const EML_BASE_HPA = 790, EML_TOP_HPA = 540;

export function initializeAirMassEngine(world) {
  world.airMassEngine = { initializedHourUtc: world.validHourUtc, eml: { strength: 0 } };
  projectAirMassAndEml(world);
  projectAuthoritativeAirMassFractions(world);
}

export function advanceAirMassEngine(world) {
  if (!world.airMassEngine) initializeAirMassEngine(world);
  projectAirMassAndEml(world);
  projectAuthoritativeAirMassFractions(world);
}

export function projectAirMassAndEml(world) {
  let strongest = 0;
  world.forEachCell(cell => {
    const t700 = Number(cell.levels[700].temperature), t500 = Number(cell.levels[500].temperature);
    const lapse = (t700 - t500) / 2.7; // 700-500 mb layer is ~2.7 km deep
    const warmMoistOverlap = clamp((cell.surface.dewpoint - 48) / 22, 0, 1);
    const influence = clamp((lapse - 6.8) / 2, 0, 1) * clamp((t700 + 2) / 12, 0, 1);
    strongest = Math.max(strongest, influence);
    cell.features.emlInfluence = influence;
    cell.features.emlBaseHpa = EML_BASE_HPA;
    cell.features.emlDepthHpa = EML_BASE_HPA - EML_TOP_HPA;
    cell.features.airMassOrigin = airMassOrigin(cell.features.airMass);
    cell.features.midlevelLapseRateCkm = lapse;
    cell.features.capStrength = clamp(influence * (0.62 + warmMoistOverlap * 0.38), 0, 1);
  });
  world.airMassEngine.eml = { strength: strongest };
}

function airMassOrigin(type) {
  return ({ mT: 'Gulf source', cT: 'Southwest desert source', cP: 'Northern continental source', mP: 'Cool maritime source', upslope: 'Modified High Plains' })[type] ?? 'Modified continental';
}

export function projectAuthoritativeAirMassFractions(world) {
  world.forEachCell(cell => {
    const sector = cell.airMass?.sector ?? 'ambient';
    const dew = Number(cell.surface?.dewpoint) || 45;
    const temp = Number(cell.surface?.temperature) || 60;
    const moisture = clamp((dew - 38) / 32, 0, 1);
    const warmth = clamp((temp - 42) / 48, 0, 1);
    const fractions = {
      maritimeTropical: moisture * warmth,
      dryMixed: clamp((1 - moisture) * warmth, 0, 1),
      continentalPolar: clamp((1 - warmth) * (1 - moisture * 0.35), 0, 1),
      coolStable: clamp((1 - warmth) * moisture, 0, 1),
      outflowModified: clamp(Number(cell.features?.stormProcessedAir ?? cell.memory?.processedAir) || 0, 0, 1)
    };
    if (sector === 'warm-moist-sector' || sector === 'warm-sector') fractions.maritimeTropical += 0.85;
    if (sector === 'dry-sector') fractions.dryMixed += 1.15;
    if (sector === 'post-cold-front') fractions.continentalPolar += 1.25;
    if (sector === 'cool-sector') fractions.coolStable += 1.05;
    const total = Object.values(fractions).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    for (const key of Object.keys(fractions)) fractions[key] = clamp(fractions[key] / total, 0, 1);
    const dominant = Object.entries(fractions).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'modifiedContinental';
    cell.airMassFractions = fractions;
    cell.airMassAuthority = {
      version: '2.69.0', dominant,
      confidence: clamp(Math.max(...Object.values(fractions)), 0.2, 1),
      warmMoistFraction: fractions.maritimeTropical,
      dryFraction: fractions.dryMixed,
      coldFraction: fractions.continentalPolar + fractions.coolStable,
      boundaryDerived: true
    };
  });
  return world;
}
