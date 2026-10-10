// outlookIssuance: 'async' — issuances are queued with a world snapshot and the host (server)
// runs the ensemble off-thread; 'sync' — the ensemble runs inside the step (audits); 'off'.
const PROFILES = Object.freeze({
  gameplay: Object.freeze({
    name: 'gameplay', atmosphereStepHours: 0.5,
    fullThermodynamicsCadenceHours: 2, mesoscaleCadenceHours: 1, coupledCadenceHours: 1,
    mediumAnalysisHours: 2, slowAnalysisHours: 6,
    outlookIssuance: 'async', outlookMembers: 12,
    verification: false, detailedHistories: false, captureCompactTimelineFrames: true, stormSubstepsPerHour: 6
  }),
  calibration: Object.freeze({
    name: 'calibration', atmosphereStepHours: 0.5,
    fullThermodynamicsCadenceHours: 0.5, mesoscaleCadenceHours: 0.5, coupledCadenceHours: 0.5,
    mediumAnalysisHours: 1, slowAnalysisHours: 3,
    outlookIssuance: 'off', outlookMembers: 12,
    verification: true, detailedHistories: true, captureCompactTimelineFrames: false, stormSubstepsPerHour: 12
  }),
  benchmark: Object.freeze({
    name: 'benchmark', atmosphereStepHours: 1,
    fullThermodynamicsCadenceHours: 1, mesoscaleCadenceHours: 1, coupledCadenceHours: 1,
    mediumAnalysisHours: 2, slowAnalysisHours: 6,
    outlookIssuance: 'off', outlookMembers: 0,
    verification: false, detailedHistories: false, captureCompactTimelineFrames: true, stormSubstepsPerHour: 4
  }),
  // Forecast ensemble members: the same physics on a lighter diagnostic cadence.
  ensemble: Object.freeze({
    name: 'ensemble', atmosphereStepHours: 0.5,
    fullThermodynamicsCadenceHours: 2, mesoscaleCadenceHours: 1, coupledCadenceHours: 1,
    mediumAnalysisHours: 3, slowAnalysisHours: 6,
    outlookIssuance: 'off', outlookMembers: 0,
    verification: false, detailedHistories: false, captureCompactTimelineFrames: false, stormSubstepsPerHour: 6
  })
});
export function resolveRuntimeProfile(profile = 'gameplay') {
  if (typeof profile === 'object' && profile) {
    const base = PROFILES[profile.name] ?? PROFILES.gameplay;
    return Object.freeze({ ...base, ...profile });
  }
  return PROFILES[profile] ?? PROFILES.gameplay;
}
export function runtimeProfileName(world) { return world?.runtime?.profile?.name ?? 'gameplay'; }
