const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const avg = (xs) => { const v=xs.map(finite).filter(x=>x!==null); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; };
const dist = (a,b) => a&&b ? Math.hypot((a.x??0)-(b.x??0),(a.y??0)-(b.y??0)) : null;

function centroid(points=[]){
  const valid=points.filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
  if(!valid.length) return null;
  return {x:avg(valid.map(p=>p.x)),y:avg(valid.map(p=>p.y))};
}
function contourCentroid(spatial){
  const c=spatial?.categoricalContours ?? {};
  for(const key of ['atLeastENH','atLeastSLGT','atLeastMRGN']) if(c[key]?.forecastCentroid) return c[key].forecastCentroid;
  return null;
}
function observedCentroid(spatial){
  const c=spatial?.categoricalContours ?? {};
  for(const key of ['atLeastENH','atLeastSLGT','atLeastMRGN']) if(c[key]?.observedCentroid) return c[key].observedCentroid;
  return null;
}
function objectHealth(event={}, diagnostics={}){
  const s=event.synopticObjects ?? {};
  const a=s.alignment ?? {};
  const lowErr=finite(diagnostics.surfaceLowFieldErrorKm ?? a.surfaceLow?.fieldErrorKm ?? event.surfaceLowFieldErrorKm);
  const diagnosedFrontError=finite(diagnostics.meanFrontFieldErrorKm ?? diagnostics.meanFrontResidualErrorKm);
  const fronts=(a.fronts??[]).map(f=>finite(f.fieldErrorKm ?? f.residualErrorKm)).filter(v=>v!==null);
  const meanFrontError=diagnosedFrontError ?? avg(fronts);
  return {
    surfaceLow:{pressureAgreement:lowErr===null?null:Math.exp(-lowErr/180),fieldErrorKm:lowErr,confidence:finite(s.objectConfidence?.surfaceLow)},
    fronts:{fieldAgreement:meanFrontError===null?null:Math.exp(-meanFrontError/120),meanFieldErrorKm:meanFrontError,residualErrorKm:finite(diagnostics.meanFrontResidualErrorKm),confidence:finite(diagnostics.objectConfidence ?? s.objectConfidence?.overall)},
    warmSector:{coverage:finite(s.warmSectorCoverage),dewpointF:finite(s.meanWarmSectorDewpointF)},
    triplePoint:{present:Boolean(s.triplePoint),confidence:finite(s.triplePoint?.confidence)},
    atmosphericConsistency:finite(diagnostics.atmosphericConsistency ?? s.atmosphericConsistency ?? s.constraintSolver?.atmosphericConsistency)
  };
}
function stormGenealogy(event={}){
 const ti=event.stormTrackIntelligence??{};
 return {stormsCreated:event.stormsCreated??0,trackedStorms:ti.stormCount??0,splits:ti.splits??0,mergers:ti.mergers??0,mesocycloneCycles:ti.mesocycloneCycles??0,boundaryInteractions:ti.boundaryInteractions??0,swathPoints:ti.swathPoints??{tornado:0,hail:0,wind:0},integrity:(event.stormsCreated??0)>0?(ti.stormCount??0)>0:true};
}
export function buildConsistencyAudit(report, critic={}){
  const spatial=critic.spatialProduct;
  const event=report.event??{};
  const verification=event.stormTrackVerification??{};
  const stageCentroids={
    initiation:spatial?.initiation?.contour?.forecastCentroid??null,
    forecastTracks:verification.forecastCentroid??null,
    realizedTracks:verification.realizedCentroid??null,
    outlook:contourCentroid(spatial),
    observed:observedCentroid(spatial)
  };
  const lineage=[];
  const ordered=['initiation','forecastTracks','realizedTracks','outlook','observed'];
  for(let i=1;i<ordered.length;i++){
    const from=ordered[i-1],to=ordered[i],d=dist(stageCentroids[from],stageCentroids[to]);
    lineage.push({from,to,displacementGridCells:d,displacementKm:d===null?null:d*10});
  }
  const valid=lineage.filter(x=>x.displacementKm!==null && x.to!=='observed');
  const primary=valid.sort((a,b)=>b.displacementKm-a.displacementKm)[0]??null;
  const reconcile={
    surfaceLowAligned:(critic.diagnostics?.surfaceLowFieldErrorKm??Infinity)<150,
    frontsAligned:(critic.diagnostics?.meanFrontResidualErrorKm??Infinity)<100,
    atmosphereConsistent:(critic.diagnostics?.atmosphericConsistency??0)>=0.45,
    initiationAligned:(spatial?.initiation?.contour?.centroidErrorMiles??Infinity)<60,
    tracksMeasured:Boolean(stageCentroids.forecastTracks && stageCentroids.realizedTracks && (verification.forecastTrackPoints??0)>0 && (verification.realizedTrackPoints??0)>0),
    telemetryComplete:stormGenealogy(event).integrity
  };
  return {
    version:'2.61.1',
    stageCentroids,
    corridorLineage:lineage,
    objectHealth:objectHealth(event, critic.diagnostics??{}),
    stormGenealogy:stormGenealogy(event),
    reconciliation:reconcile,
    regressionDiagnosis:{primaryStage:primary?.to??'unresolved',largestInternalDisplacementKm:primary?.displacementKm??null,summary:primary?`Largest internal corridor shift occurs entering ${primary.to} (${primary.displacementKm.toFixed(1)} km).`:'Insufficient stage centroids for automatic attribution.'},
    failFastFailures:Object.entries(reconcile).filter(([,ok])=>!ok).map(([name])=>name)
  };
}
export function aggregateConsistencyAudits(members=[]){
 const audits=members.map(m=>m.consistencyAudit).filter(Boolean);
 const failures={}; for(const a of audits) for(const f of a.failFastFailures??[]) failures[f]=(failures[f]??0)+1;
 return {version:'2.61.1',members:audits.length,meanLargestInternalDisplacementKm:avg(audits.map(a=>a.regressionDiagnosis?.largestInternalDisplacementKm)),failureCounts:failures,primaryStages:audits.reduce((o,a)=>{const k=a.regressionDiagnosis?.primaryStage??'unresolved';o[k]=(o[k]??0)+1;return o;},{})};
}
