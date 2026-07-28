import fs from 'node:fs';
import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';
const seed = Number(process.argv[2]);
if (!Number.isFinite(seed)) { console.error('Usage: node scripts/verify-seed.mjs <seed> [hours=24] [output.json]'); process.exit(1); }
const hours = Number(process.argv[3] ?? 24);
if (!Number.isFinite(hours) || hours < 0) { console.error('hours must be a finite non-negative number'); process.exit(1); }
const report = runSeedVerification(seed, { hours });
const output = process.argv[4];
if (output) { fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(`Wrote ${output}`); }
else {
  const day1 = report.forecast.byDay.day1;
  console.log(JSON.stringify({
    seed: report.seed,
    verifierVersion: report.verifierVersion,
    simulation: report.simulation,
    event: report.event,
    day1: {
      products: day1.count,
      meanScore: day1.meanScore,
      forecastRisk: day1.latest?.forecastOverallRisk ?? null,
      observedRisk: day1.latest?.observedOverallRisk ?? null,
      scoreComponents: day1.latest?.scoreComponents ?? null,
      tornadoTrackPlacement: day1.latest?.spatialPlacement?.tornadoTracks ?? null
    },
    calibration: report.forecast.calibration,
    performance: report.performance,
    recommendations: report.recommendations
  }, null, 2));
}
