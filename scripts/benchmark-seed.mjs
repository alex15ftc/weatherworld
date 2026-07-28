import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';

const seed = Number(process.argv[2] ?? 63869760);
const hours = Number(process.argv[3] ?? 6);
const runs = Math.max(1, Number(process.argv[4] ?? 3));
const results = [];
for (let i = 0; i < runs; i++) {
  const report = runSeedVerification(seed, { hours });
  results.push(report.performance);
  console.log(`Run ${i + 1}: ${(report.performance.totalMs / 1000).toFixed(2)}s (${report.performance.simulatedHoursPerSecond.toFixed(2)} simulated hr/s)`);
}
const values = results.map(r => r.totalMs).sort((a,b)=>a-b);
const mean = values.reduce((a,b)=>a+b,0)/values.length;
console.log(JSON.stringify({ seed, hours, runs, meanMs: mean, medianMs: values[Math.floor(values.length/2)], fastestMs: values[0], slowestMs: values.at(-1) }, null, 2));
