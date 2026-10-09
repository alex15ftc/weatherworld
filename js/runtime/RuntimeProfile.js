const PROFILES = Object.freeze({
  gameplay: Object.freeze({
    name: 'gameplay', atmosphereStepHours: 0.5,
    fullThermodynamicsCadenceHours: 2, mesoscaleCadenceHours: 1, coupledCadenceHours: 1,
    mediumAnalysisHours: 2, slowAnalysisHours: 6,
    initialOutlookDays: ['day1'], startupOutlookMode: 'compact', issueDeferredOutlooks: true,
    verification: false, detailedHistories: false, captureCompactTimelineFrames: true, forecastMembers: { day1: 6, day2: 6, day3: 8 }, stormSubstepsPerHour: 6
  }),
  calibration: Object.freeze({
    name: 'calibration', atmosphereStepHours: 0.5,
    fullThermodynamicsCadenceHours: 0.5, mesoscaleCadenceHours: 0.5, coupledCadenceHours: 0.5,
    mediumAnalysisHours: 1, slowAnalysisHours: 3,
    initialOutlookDays: ['day1','day2','day3'], startupOutlookMode: 'full', issueDeferredOutlooks: false,
    verification: true, detailedHistories: true, captureCompactTimelineFrames: false, forecastMembers: { day1: 8, day2: 12, day3: 16 }, stormSubstepsPerHour: 12
  }),
  benchmark: Object.freeze({
    name: 'benchmark', atmosphereStepHours: 1,
    fullThermodynamicsCadenceHours: 1, mesoscaleCadenceHours: 1, coupledCadenceHours: 1,
    mediumAnalysisHours: 2, slowAnalysisHours: 6,
    initialOutlookDays: ['day1'], startupOutlookMode: 'compact', issueDeferredOutlooks: true,
    verification: false, detailedHistories: false, captureCompactTimelineFrames: true, forecastMembers: { day1: 3, day2: 4, day3: 6 }, stormSubstepsPerHour: 4
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
