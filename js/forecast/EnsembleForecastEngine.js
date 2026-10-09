import { buildForecastStormProjection } from './ForecastStormProjectionEngine.js';
import { assimilateOutlookFromStormHistories } from './OutlookAssimilationEngine.js';
import { applyForecastConfidence } from './ForecastConfidenceEngine.js';
import { applyRegionalOutlookTopology } from './RegionalOutlookTopologyEngine.js';

const HAZARDS = ['tornado','hail','wind'];
const THRESHOLDS = { tornado:0.012, hail:0.025, wind:0.025 };
const CORE_SUPPORT = { tornado:0.46, hail:0.50, wind:0.48 };

export function applyEnsembleForecast(grid, width, height, {
  key='day1', cellSizeKm=10, seed=0, issueHour=0, members=null
}={}) {
  const memberCount = members ?? (key==='day1' ? 8 : key==='day2' ? 12 : 16);
  const memberProducts=[];
  const maxPublished=Object.fromEntries(HAZARDS.map(h=>[h,Math.max(0,...grid.map(c=>Number(c[`${h}Probability`])||0))]));
  const clusters=new Map();

  for(let m=0;m<memberCount;m++){
    const rng=mulberry32(hashSeed(seed,issueHour,key,m,'2.59.0'));
    const perturbation=buildPerturbation(rng,key,m);
    // Members only overwrite top-level scalars (perturbGrid) and the projection only
    // reads cells, so a shallow copy isolates them. Deep-cloning 2,500 forecast cells
    // per member was ~half of total simulation time.
    const memberGrid=grid.map(cell=>({...cell}));
    perturbGrid(memberGrid,width,height,perturbation);
    const projection=buildForecastStormProjection(memberGrid,width,height,{key,cellSizeKm,memberPerturbation:perturbation});
    const clusterKey=clusterLabel(projection,perturbation);
    clusters.set(clusterKey,(clusters.get(clusterKey)||0)+1);
    memberProducts.push({
      index:m, perturbation, projection, clusterKey,
      candidateCount:projection.candidates.length,
      baseWeight:memberQualityWeight(projection,perturbation,grid.length)
    });
  }

  const diagnostics={};
  for(const hazard of HAZARDS){
    const centroids=memberProducts.map(m=>hazardCentroid(m.projection.fields[hazard],width,THRESHOLDS[hazard]));
    const consensus=weightedCentroid(centroids,memberProducts.map(m=>m.baseWeight));
    const weights=memberProducts.map((m,i)=>{
      const spatial=centroids[i]&&consensus ? Math.exp(-distance(centroids[i],consensus)/(key==='day1'?10:key==='day2'?14:18)) : 0.55;
      const clusterFraction=(clusters.get(m.clusterKey)||1)/memberCount;
      return clamp(m.baseWeight*(0.62+0.38*spatial)*(0.78+0.22*Math.sqrt(clusterFraction)),0.12,1.25);
    });
    const totalWeight=weights.reduce((a,b)=>a+b,0)||1;
    let spreadCells=0,coreCells=0,sumWeightedFrequency=0,sumRawFrequency=0;

    for(let i=0;i<grid.length;i++){
      let weightedVotes=0, rawVotes=0, weightedSupport=0, supportWeight=0;
      for(let m=0;m<memberProducts.length;m++){
        const p=memberProducts[m].projection.fields[hazard][i];
        if(p>=THRESHOLDS[hazard]){ weightedVotes+=weights[m]; rawVotes++; }
        weightedSupport+=p*weights[m];
        supportWeight+=weights[m];
      }
      const rawFrequency=rawVotes/memberCount;
      const weightedFrequency=weightedVotes/totalWeight;
      const meanSupport=weightedSupport/Math.max(1e-9,supportWeight);
      const localConcentration=neighborhoodConcentration(i,width,height,memberProducts,hazard,weights,totalWeight);
      const clusterSupport=dominantClusterSupport(i,memberProducts,hazard,weights,totalWeight);
      const occurrence=clamp(weightedFrequency*(0.72+0.28*localConcentration),0,1);
      const conditional=conditionalSeverity(meanSupport,maxPublished[hazard],hazard);
      const calibratedPct=calibrateIssuedProbability({hazard,occurrence,conditional,concentration:localConcentration,clusterSupport,ceiling:maxPublished[hazard],key});
      const background=(Number(grid[i][`${hazard}Probability`])||0)*(key==='day1'?0.025:0.05);
      grid[i][`${hazard}Probability`]=probabilityToPublished(Math.max(calibratedPct,background),hazard,{occurrence,concentration:localConcentration,clusterSupport});
      grid[i].ensembleForecast ??={};
      grid[i].ensembleForecast[hazard]={
        memberFrequency:rawFrequency,
        weightedMemberFrequency:weightedFrequency,
        meanSupport,
        occurrenceProbability:occurrence,
        conditionalHazardProbability:conditional,
        unconditionalHazardProbability:calibratedPct/100,
        spatialConcentration:localConcentration,
        dominantClusterSupport:clusterSupport,
        region: weightedFrequency>=CORE_SUPPORT[hazard]&&localConcentration>=0.58?'core':weightedFrequency>=0.10?'envelope':'outlier'
      };
      if(weightedFrequency>=0.1) spreadCells++;
      if(weightedFrequency>=CORE_SUPPORT[hazard]&&localConcentration>=0.58) coreCells++;
      sumWeightedFrequency+=weightedFrequency; sumRawFrequency+=rawFrequency;
    }
    diagnostics[hazard]={
      spreadCells,coreCells,
      meanMemberFrequency:sumRawFrequency/grid.length,
      meanWeightedMemberFrequency:sumWeightedFrequency/grid.length,
      maximumPublished:maxPublished[hazard],
      consensusCentroid:consensus,
      effectiveMemberCount:effectiveSampleSize(weights),
      calibration:'weighted-occurrence-x-conditional-severity-with-core-envelope-gates'
    };
  }

  const outlookAssimilation = assimilateOutlookFromStormHistories(grid, width, height, memberProducts, { key, cellSizeKm, maximumPublished: maxPublished });
  const forecastConfidence = applyForecastConfidence(grid, width, height, memberProducts, { key });
  const regionalTopology = applyRegionalOutlookTopology(grid, width, height, { key });

  return {
    version:'2.66.0', engineVersion:'2.66.0', method:'confidence-weighted-storm-history-assimilation',
    outlookAssimilation, forecastConfidence, regionalTopology,
    memberCount, seed, issueHour,
    clusters:[...clusters.entries()].map(([label,count])=>({label,count,fraction:count/memberCount})).sort((a,b)=>b.count-a.count),
    diagnostics,
    forecastStorms: memberProducts.flatMap(({projection,index})=>projection.candidates.map(c=>({ id:`F${index}-${c.index}`, memberIndex:index, initiationCell:{x:c.x,y:c.y}, mode:c.mode, lifetimeHours:c.lifetimeHours, confidence:c.confidence, track:c.track, motionHistory:c.motionHistory, modeHistory:c.modeHistory, boundaryInteractions:c.boundaryInteractions, stateHistory:c.stateHistory, kernelVersion:c.kernelVersion, finalState:c.finalState, corridor50RadiusCells:c.corridor50RadiusCells, corridor90RadiusCells:c.corridor90RadiusCells }))),
    members:memberProducts.map(({projection,...m})=>({ ...m, forecastStorms: projection.candidates.map(c=>({ id:`F${m.index}-${c.index}`, memberIndex:m.index, initiationCell:{x:c.x,y:c.y}, mode:c.mode, lifetimeHours:c.lifetimeHours, confidence:c.confidence, track:c.track, motionHistory:c.motionHistory, modeHistory:c.modeHistory, boundaryInteractions:c.boundaryInteractions, stateHistory:c.stateHistory, kernelVersion:c.kernelVersion, finalState:c.finalState, corridor50RadiusCells:c.corridor50RadiusCells, corridor90RadiusCells:c.corridor90RadiusCells })) }))
  };
}

function calibrateIssuedProbability({hazard,occurrence,conditional,concentration,clusterSupport,ceiling,key}){
  const leadPenalty=key==='day1'?1:key==='day2'?0.88:0.76;
  const concentrationFactor=0.35+0.65*Math.pow(concentration,1.35);
  const clusterFactor=0.58+0.42*Math.sqrt(clusterSupport);
  const raw=100*occurrence*conditional*concentrationFactor*clusterFactor*leadPenalty;
  const ceilingFactor=hazard==='tornado'?0.92:hazard==='hail'?0.88:0.9;
  return Math.min(ceiling*ceilingFactor,raw);
}
function conditionalSeverity(meanSupport,ceiling,hazard){
  const normalized=ceiling>0?clamp((meanSupport*100)/ceiling,0,1):0;
  const floor=hazard==='tornado'?0.12:0.16;
  return clamp(floor+normalized*(1-floor),0,1);
}
function probabilityToPublished(value,hazard,ctx={}){
  const levels=hazard==='tornado'?[0,2,5,10,15,30,45,60]:[0,5,15,30,45,60,75,90];
  let r=0;
  for(const l of levels){
    if(value<l) continue;
    if(l>=15 && (ctx.occurrence<0.34 || ctx.concentration<0.48 || ctx.clusterSupport<0.28)) continue;
    if(l>=30 && (ctx.occurrence<0.56 || ctx.concentration<0.64 || ctx.clusterSupport<0.42)) continue;
    r=l;
  }
  return r;
}
function neighborhoodConcentration(index,width,height,members,hazard,weights,totalWeight){
  const x=index%width,y=Math.floor(index/width); let local=0,center=0;
  for(let m=0;m<members.length;m++){
    const field=members[m].projection.fields[hazard];
    if(field[index]>=THRESHOLDS[hazard]) center+=weights[m];
    let hit=false;
    for(let dy=-1;dy<=1&&!hit;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
      if(field[ny*width+nx]>=THRESHOLDS[hazard]){hit=true;break;}
    }
    if(hit)local+=weights[m];
  }
  const c=center/totalWeight,n=local/totalWeight;
  return n>0?clamp(c/n,0,1):0;
}
function dominantClusterSupport(index,members,hazard,weights,totalWeight){
  const by=new Map();
  for(let m=0;m<members.length;m++) if(members[m].projection.fields[hazard][index]>=THRESHOLDS[hazard]) by.set(members[m].clusterKey,(by.get(members[m].clusterKey)||0)+weights[m]);
  return Math.max(0,...by.values())/totalWeight;
}
function memberQualityWeight(projection,p,gridSize){
  const candidates=projection.candidates.length;
  const candidateScore=clamp(candidates/Math.max(4,Math.sqrt(gridSize)*0.55),0.2,1);
  const perturbMagnitude=Math.hypot(p.objectDx,p.objectDy)/3 + Math.abs(p.motionFactor-1)+Math.abs(p.lifetimeFactor-1)+Math.abs(p.initiationFactor-1);
  const coherence=Math.exp(-0.55*perturbMagnitude);
  const attributed=HAZARDS.reduce((s,h)=>s+(projection.attribution?.[h]?.contributingCandidates||0),0);
  const attributionScore=clamp(attributed/Math.max(1,candidates*1.5),0.25,1);
  return clamp(0.25+0.38*coherence+0.22*candidateScore+0.15*attributionScore,0.15,1);
}
function hazardCentroid(field,width,threshold){let sx=0,sy=0,w=0;for(let i=0;i<field.length;i++){const v=field[i];if(v<threshold)continue;sx+=(i%width)*v;sy+=Math.floor(i/width)*v;w+=v;}return w?{x:sx/w,y:sy/w}:null;}
function weightedCentroid(points,weights){let sx=0,sy=0,w=0;for(let i=0;i<points.length;i++)if(points[i]){sx+=points[i].x*weights[i];sy+=points[i].y*weights[i];w+=weights[i];}return w?{x:sx/w,y:sy/w}:null;}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function effectiveSampleSize(weights){const s=weights.reduce((a,b)=>a+b,0),q=weights.reduce((a,b)=>a+b*b,0);return q?s*s/q:0;}

const SHIFTED_FIELDS=['peakInitiation','projectedStormOccupancy','hazardOverlapScore','boundaryRelativePlacement'];
function perturbGrid(grid,width,height,p){
  // Snapshot only the shifted fields' pre-perturbation values (NaN = not finite).
  const shifted=SHIFTED_FIELDS.map(field=>Float64Array.from(grid,c=>Number(c[field])));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.max(0,Math.min(width-1,Math.round(x-p.objectDx)));
    const sy=Math.max(0,Math.min(height-1,Math.round(y-p.objectDy)));
    const src=sy*width+sx; const cell=grid[y*width+x];
    for(let f=0;f<SHIFTED_FIELDS.length;f++){ const v=shifted[f][src]; if(Number.isFinite(v)) cell[SHIFTED_FIELDS[f]]=v; }
    cell.peakInitiation=clamp((Number(cell.peakInitiation)||0)*p.initiationFactor+p.initiationBias,0,1);
    cell.projectedStormOccupancy=clamp((Number(cell.projectedStormOccupancy)||0)*p.occupancyFactor,0,1);
    cell.conditionalTornadoIntensity=clamp((Number(cell.conditionalTornadoIntensity)||0)*p.tornadoFactor,0,1.2);
    cell.conditionalHailIntensity=clamp((Number(cell.conditionalHailIntensity)||0)*p.hailFactor,0,1.2);
    cell.conditionalWindIntensity=clamp((Number(cell.conditionalWindIntensity)||0)*p.windFactor,0,1.2);
  }
}
function buildPerturbation(rng,key,index){const lead=key==='day1'?1:key==='day2'?1.55:2.1;return{index,objectDx:gaussian(rng)*0.9*lead,objectDy:gaussian(rng)*0.8*lead,motionAngleDeg:gaussian(rng)*7*lead,motionFactor:clamp(1+gaussian(rng)*0.10*lead,0.65,1.45),lifetimeFactor:clamp(1+gaussian(rng)*0.16*lead,0.55,1.65),initiationFactor:clamp(1+gaussian(rng)*0.18*lead,0.5,1.6),initiationBias:gaussian(rng)*0.018*lead,occupancyFactor:clamp(1+gaussian(rng)*0.13*lead,0.55,1.5),modeBias:gaussian(rng)*0.18*lead,tornadoFactor:clamp(1+gaussian(rng)*0.14,0.65,1.35),hailFactor:clamp(1+gaussian(rng)*0.12,0.7,1.3),windFactor:clamp(1+gaussian(rng)*0.14,0.65,1.35)};}
function clusterLabel(projection,p){const modes={discrete:0,cluster:0,linear:0};for(const c of projection.candidates)modes[c.mode]=(modes[c.mode]||0)+1;const mode=Object.entries(modes).sort((a,b)=>b[1]-a[1])[0][0];const timing=p.initiationFactor<0.88?'delayed/limited':p.initiationFactor>1.12?'early/widespread':'baseline timing';return `${mode} — ${timing}`;}
function gaussian(rng){let u=0,v=0;while(!u)u=rng();while(!v)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function hashSeed(...parts){let h=2166136261>>>0;for(const ch of parts.join('|')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function mulberry32(a){return()=>{let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
