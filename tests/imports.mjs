const modules = [
  '../js/atmosphere.js', '../js/evolution.js', '../js/renderer.js', '../js/sounding.js',
  '../js/diagnostics/boundaryDiagnosis.js', '../js/diagnostics/forcingDiagnosis.js',
  '../js/diagnostics/riskDiagnosis.js', '../js/analysis/mapAnalysis.js',
  '../js/scenarios/scenarioGenerator.js', '../js/scenarios/synopticPattern.js',
  '../js/scenarios/regionalClimatology.js', '../js/world/WorldFramework.js', '../js/scenarios/SetupForecastEngine.js', '../js/scenarios/AirMassEngine.js', '../js/scenarios/SynopticCoherence.js',
  '../js/storms/Storm.js', '../js/storms/StormEngine.js', '../js/storms/InitiationEngine.js',
  '../js/storms/environmentSampling.js', '../js/mesoscale/Boundary.js', '../js/mesoscale/MesoscaleEngine.js'
];
for (const modulePath of modules) await import(modulePath);
console.log(`Imported ${modules.length} modules successfully.`);
