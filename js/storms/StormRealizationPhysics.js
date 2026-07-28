import { clamp } from '../scenarios/math.js?v=2.20.1';

const G = 9.80665;
const KNOT_TO_MS = 0.514444;

function ramp(value, low, high) {
  return clamp((Number(value) - low) / Math.max(1e-6, high - low), 0, 1);
}

/**
 * Reduced-order physical diagnosis used by the procedural simulator.
 * Values are normalized for storm evolution, but retain physically meaningful
 * dimensional diagnostics for verification and tuning.
 */
export function diagnoseStormRealizationPhysics(environment, storm = null) {
  const cape = Math.max(0, Number(environment.cape) || 0);
  const cin = Math.max(0, Number(environment.cin) || 0);
  const shearKt = Math.max(0, Number(environment.bulkShear) || 0);
  const srh = Math.max(0, Number(environment.srh) || 0);
  const lcl = Math.max(250, Number(environment.lcl) || 1800);
  const forcing = clamp(Number(environment.forcing) || 0, 0, 1);
  const convergence = clamp(Math.max(Number(environment.outflowConvergence) || 0, Number(environment.boundaryInfluence) || 0, forcing * 0.72), 0, 1);
  const moistureConvergence = clamp((Number(environment.moisturePooling) || 0) * 0.55 + convergence * 0.45, 0, 1);
  const capErosion = clamp(Number(environment.capErosion) || (forcing * 0.55 + moistureConvergence * 0.25), 0, 1);

  // Parcel-theory upper bound, reduced by entrainment, precipitation loading,
  // inhibition, and inflow contamination. This is not presented as a literal
  // resolved cloud-model vertical velocity.
  const theoreticalUpdraftMs = Math.sqrt(2 * cape);
  const entrainmentEfficiency = clamp(0.42 + 0.25 * ramp(shearKt, 15, 50) + 0.18 * ramp(cape, 500, 3000) - 0.16 * ramp(lcl, 1200, 2600), 0.25, 0.90);
  const precipitationEfficiency = clamp(0.92 - 0.22 * ramp(cape, 2500, 5000) - 0.18 * ramp(environment.stormCoverage ?? 0, 0.55, 1), 0.48, 0.95);
  const inhibitionEfficiency = clamp(1 - cin / Math.max(80, 170 + 115 * forcing + 90 * capErosion), 0, 1);
  const inflowEfficiency = clamp(1 - (Number(environment.processedAir) || 0) * 0.62, 0.25, 1);
  const realizedUpdraftMs = theoreticalUpdraftMs * entrainmentEfficiency * precipitationEfficiency * inhibitionEfficiency * inflowEfficiency;
  const realizedUpdraft = clamp(realizedUpdraftMs / 65, 0, 1.2);

  // Work available to lift parcels through inhibition. Units are expressed as
  // an equivalent J/kg budget for transparent diagnostics.
  const liftingWorkJkg = 185 * forcing + 120 * convergence + 95 * moistureConvergence + 85 * capErosion;
  const initiationMarginJkg = liftingWorkJkg - cin;
  const initiationProbability = clamp(1 / (1 + Math.exp(-(initiationMarginJkg - 5) / 38)), 0, 1);

  const shearMs = shearKt * KNOT_TO_MS;
  const coldPoolDeficitK = Math.max(0.2, Number(storm?.coldPoolTemperatureDeficitF || 0) / 1.8);
  const coldPoolDepthM = clamp(500 + (storm?.coldPoolStrength ?? 0.15) * 1900, 400, 2600);
  const referenceThetaV = 300;
  const reducedGravity = G * coldPoolDeficitK / referenceThetaV;
  const coldPoolSpeedMs = Math.sqrt(2 * reducedGravity * coldPoolDepthM);
  const lowLevelShearMs = Math.max(2, shearMs * 0.58);
  const shearColdPoolRatio = clamp(coldPoolSpeedMs / lowLevelShearMs, 0, 3);
  const balanceSupport = Math.exp(-Math.pow((shearColdPoolRatio - 1) / 0.65, 2));

  const streamwiseVorticity = ramp(srh, 50, 350);
  const tilting = realizedUpdraft * ramp(shearKt, 20, 60) * 0.55;
  const stretching = realizedUpdraft * streamwiseVorticity * (0.45 + 0.55 * ramp(lcl, 2000, 700));
  const baroclinic = clamp((Number(environment.boundaryInfluence) || 0) * 0.55 + (storm?.coldPoolStrength ?? 0) * 0.25, 0, 1);
  const verticalVorticityTendency = clamp(tilting + stretching + baroclinic * 0.35, 0, 1.5);
  const midlevelUH = realizedUpdraftMs * verticalVorticityTendency * 18;
  const lowlevelUH = realizedUpdraftMs * stretching * 8;

  const organizationProbability = clamp(
    initiationProbability * (0.30 * ramp(shearKt, 22, 52) + 0.25 * ramp(realizedUpdraftMs, 12, 48) + 0.20 * balanceSupport + 0.15 * ramp(srh, 60, 260) + 0.10 * inflowEfficiency),
    0, 1
  );
  const supercellProbability = clamp(organizationProbability * (0.48 * ramp(shearKt, 30, 58) + 0.30 * ramp(srh, 80, 320) + 0.22 * ramp(realizedUpdraftMs, 18, 50)) * (1 - 0.35 * ramp(shearColdPoolRatio, 1.2, 2.4)), 0, 1);
  const linearProbability = clamp(organizationProbability * (0.42 * forcing + 0.30 * (Number(environment.linearFraction) || 0) + 0.28 * balanceSupport), 0, 1);

  return {
    theoreticalUpdraftMs, realizedUpdraftMs, realizedUpdraft,
    entrainmentEfficiency, precipitationEfficiency, inhibitionEfficiency, inflowEfficiency,
    liftingWorkJkg, initiationMarginJkg, initiationProbability,
    moistureConvergence, massConvergence: convergence,
    coldPoolSpeedMs, shearColdPoolRatio, balanceSupport,
    tilting, stretching, baroclinic, verticalVorticityTendency,
    midlevelUH, lowlevelUH, organizationProbability, supercellProbability, linearProbability
  };
}

export function diagnoseOutlookRealizationChain(cell, projectedEnvironment) {
  const fc = cell.forecast ?? {};
  const env = {
    cape: projectedEnvironment.cape,
    cin: projectedEnvironment.cin,
    srh: projectedEnvironment.srh,
    bulkShear: projectedEnvironment.shear,
    lcl: projectedEnvironment.lcl,
    forcing: cell.derived?.diagnostics?.forcing ?? 0,
    capErosion: projectedEnvironment.capErosion,
    moisturePooling: projectedEnvironment.moistureTransport,
    stormCoverage: fc.stormCoverage ?? 0,
    discreteFraction: fc.discreteFraction ?? 0.5,
    linearFraction: fc.linearFraction ?? 0.5,
    boundaryInfluence: cell.derived?.diagnostics?.boundaryInfluence ?? 0,
    processedAir: cell.derived?.diagnostics?.processedAir ?? 0
  };
  const p = diagnoseStormRealizationPhysics(env);
  const environmentSuitability = clamp(0.36 * ramp(env.cape, 500, 2800) + 0.24 * ramp(env.bulkShear, 22, 52) + 0.18 * ramp(env.srh, 60, 280) + 0.12 * ramp(env.lcl, 2200, 700) + 0.10 * p.inflowEfficiency, 0, 1);
  const initiation = clamp(Math.min(projectedEnvironment.initiationProbability ?? 0, 0.25 + 0.75 * p.initiationProbability), 0, 1);
  const organization = clamp(p.organizationProbability, 0, 1);
  const supercell = clamp(p.supercellProbability * (0.55 + 0.45 * (Number(fc.discreteFraction) || 0.5)), 0, 1);
  const linear = clamp(p.linearProbability * (0.55 + 0.45 * (Number(fc.linearFraction) || 0.5)), 0, 1);
  const coverage = clamp(Number(fc.stormCoverage) || 0, 0, 1);
  const convectiveLambda = clamp(coverage * initiation * (0.75 + environmentSuitability * 1.35), 0, 4.0);
  const organizedLambda = clamp(coverage * initiation * (0.35 + organization * 1.85), 0, 3.5);
  const hailLambda = clamp(convectiveLambda * (0.42 + 0.58 * Math.max(organization, ramp(p.realizedUpdraftMs, 16, 45))), 0, 4.0);
  const windLambda = clamp(convectiveLambda * (0.40 + 0.36 * Math.max(linear, p.balanceSupport) + 0.24 * ramp(p.coldPoolSpeedMs, 5, 18)), 0, 4.0);
  const atLeastOneConvectiveStorm = 1 - Math.exp(-convectiveLambda);
  const atLeastOneOrganizedStorm = 1 - Math.exp(-organizedLambda);
  const atLeastOneHailStorm = 1 - Math.exp(-hailLambda);
  const atLeastOneWindStorm = 1 - Math.exp(-windLambda);
  return { ...p, environmentSuitability, initiation, organization, supercell, linear, coverage,
    opportunityLambda: organizedLambda, convectiveLambda, organizedLambda, hailLambda, windLambda,
    atLeastOneConvectiveStorm, atLeastOneOrganizedStorm, atLeastOneHailStorm, atLeastOneWindStorm };
}
