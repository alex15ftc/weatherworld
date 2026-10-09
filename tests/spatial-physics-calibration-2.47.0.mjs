import assert from 'node:assert/strict';
import fs from 'node:fs';
import { critiqueVerification } from '../js/verification/CalibrationCritic.js';
import { findInitiationCandidates } from '../js/storms/InitiationEngine.js';

const outlookSource = fs.readFileSync(new URL('../js/forecast/OutlookCycleEngine.js', import.meta.url), 'utf8');
assert.match(outlookSource, /pruneUnsupportedHazardFootprints/);
assert.match(outlookSource, /initiation-occupancy-corridor-gate/);

const cells = Array.from({length:9}, (_,i) => ({
  x:i%3,y:Math.floor(i/3),
  forecast:{ initiationProbability:0.03, capFailureProbability:0.45, forcingConfidence:0.5, releaseProbability:0.4, convectivePotential:0.6, capErosion:0.7, surfaceBasedTiming:0.8, stormCoverage:0.5 },
  dynamics:{ initiationPotential:0.03, convectiveReadiness:0.55, triggerStrength:i===4?0.75:0.2 },
  mesoscaleFields:{ initiationFocus:i===4?0.8:0.1, convergenceCorridor:i===4?0.75:0.1 },
  features:{ synopticAscent:i===4?0.65:0.15, explicitBoundaryInfluence:i===4?0.7:0.1, warmSector:true },
  derived:{ cin:20, sounding:{mucape:1800}, cape:1800 }
}));
const world={width:3,height:3,cellSizeKm:10,setupForecast:{profile:{coverage:0.5},key:'dryline_cyclone'},evolution:{elapsedHours:12,config:{seed:1,scenarioEvolution:{narrative:'mixed_mode',peakHour:20,developmentHours:10}}},getCell:(x,y)=>cells[y*3+x]};
const candidates=findInitiationCandidates(world,[],20);
assert.ok(cells[4].forecast.effectiveInitiationSignal > 0.1, 'shared boundary/forcing signal should raise published CI guidance');
assert.ok(candidates.every(c => Math.abs(c.probability-c.effectiveInitiationSignal)<1e-9));

const report={
 atmosphericEnvironmentSamples:[{hourUtc:18,domainSummary:{percentile90:{cape:2000,bulkShear:45,srh:180,stp:1.5,forcing:.5},maximum:{initiationProbability:.3}},warmSectorSummary:{mean:{cin:40,surfaceDewpointF:64},fractionOfDomain:.3}}],
 event:{initiations:2,totalTornadoes:0},
 products:[{issuedHourUtc:12,spatialVerification:{summary:{spatialScore:.2,overlapScore:.1,displacementScore:.3,meanCentroidErrorMiles:120},categoricalContours:{atLeastMRGN:{areaRatio:8}},initiation:{contour:{centroidErrorMiles:90}}}}],
 forecast:{byDay:{day1:{latest:{forecastOverallRisk:'SLGT'}}},latestIssuedByDay:{day1:null}}
};
const critic=critiqueVerification(report,{environment:{peakCape:[1500,2600]}});
assert.ok(critic.environmentScore < 1 && critic.environmentScore >= .9);
assert.ok(critic.flags.some(f=>f.code==='RISK_FOOTPRINT_TOO_BROAD'));
assert.ok(critic.flags.some(f=>f.code==='INITIATION_CORRIDOR_DISPLACED'));
console.log('2.47.0 spatial physics calibration regression: PASS');
