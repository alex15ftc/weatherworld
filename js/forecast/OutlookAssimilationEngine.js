const HAZARDS = ['tornado', 'hail', 'wind'];
const PUBLISHED = {
  tornado: [0, 2, 5, 10, 15, 30, 45, 60],
  hail: [0, 5, 15, 30, 45, 60, 75, 90],
  wind: [0, 5, 15, 30, 45, 60, 75, 90]
};

export function assimilateOutlookFromStormHistories(grid, width, height, memberProducts, {
  key = 'day1', cellSizeKm = 10, maximumPublished = {}
} = {}) {
  const cellCount = width * height;
  const diagnostics = {};
  const stages = {};

  for (const hazard of HAZARDS) {
    const density = new Float64Array(cellCount);
    const memberMasks = Array.from({ length: memberProducts.length }, () => new Uint8Array(cellCount));
    const familyMasks = new Map();
    const clusterMasks = new Map();
    const corridorPoints = [];

    memberProducts.forEach((member, memberIndex) => {
      const storms = member.projection?.candidates ?? [];
      for (const storm of storms) {
        const familyId = `${memberIndex}:${storm.parentId ?? storm.index}`;
        const clusterId = `${member.clusterKey ?? 'unclustered'}:${dominantMode(storm)}`;
        const familyMask = familyMasks.get(familyId) ?? new Uint8Array(cellCount);
        const clusterMask = clusterMasks.get(clusterId) ?? new Uint8Array(cellCount);
        familyMasks.set(familyId, familyMask);
        clusterMasks.set(clusterId, clusterMask);
        const track = Array.isArray(storm.track) ? storm.track : [];
        const states = Array.isArray(storm.stateHistory) ? storm.stateHistory : [];
        for (let step = 0; step < track.length; step++) {
          const point = track[step];
          const state = states[Math.min(step, Math.max(0, states.length - 1))] ?? storm.finalState ?? {};
          const contribution = stormContribution(storm, state, hazard, step, track.length, key);
          if (contribution <= 0.002) continue;
          const motion = state.motion ?? storm.motionHistory?.[Math.max(0, step - 1)] ?? { east: 1, north: 0 };
          const radii = corridorRadii(storm, state, hazard, key);
          rasterizeDirectionalKernel(density, familyMask, clusterMask, memberMasks[memberIndex], width, height,
            point.x, point.y, motion.east ?? motion.dx ?? 1, motion.north ?? motion.dy ?? 0,
            radii.along, radii.cross, contribution);
          corridorPoints.push({ x: point.x, y: point.y, weight: contribution, clusterId, memberIndex });
        }
      }
    });

    const rawDensity = density.slice();
    const support = new Float64Array(cellCount);
    const concentration = new Float64Array(cellCount);
    const clusterSupport = new Float64Array(cellCount);
    const familyCount = new Uint16Array(cellCount);
    let densityCells = 0, coreCells = 0, unsupportedCells = 0;

    for (let i = 0; i < cellCount; i++) {
      let members = 0;
      for (const mask of memberMasks) members += mask[i] ? 1 : 0;
      let families = 0;
      for (const mask of familyMasks.values()) families += mask[i] ? 1 : 0;
      let maxCluster = 0;
      for (const mask of clusterMasks.values()) if (mask[i]) maxCluster++;
      support[i] = memberProducts.length ? members / memberProducts.length : 0;
      familyCount[i] = families;
      clusterSupport[i] = memberProducts.length ? Math.min(1, maxCluster / Math.max(1, memberProducts.length)) : 0;
      concentration[i] = localConcentration(rawDensity, width, height, i);
      if (rawDensity[i] > 0.01) densityCells++;
    }

    const ceiling = Number(maximumPublished[hazard]) || 0;
    const trackCentroid = weightedCentroid(corridorPoints);
    const issuedBefore = fieldCentroid(grid, width, `${hazard}Probability`, minimumTier(hazard));
    for (let i = 0; i < cellCount; i++) {
      const occurrence = support[i];
      const uniqueFamilySupport = Math.min(1, familyCount[i] / Math.max(2, memberProducts.length * 0.55));
      const concentrated = concentration[i];
      const cluster = clusterSupport[i];
      const densityScore = 1 - Math.exp(-rawDensity[i] * 1.35);
      const unconditional = densityScore * (0.25 + 0.75 * occurrence) * (0.35 + 0.65 * concentrated)
        * (0.55 + 0.45 * cluster) * (0.55 + 0.45 * uniqueFamilySupport);
      let pct = Math.min(ceiling, unconditional * 100);
      const region = occurrence >= 0.46 && concentrated >= 0.55 && uniqueFamilySupport >= 0.35 ? 'core'
        : occurrence >= 0.10 ? 'envelope' : 'outlier';
      if (region !== 'core') pct = Math.min(pct, hazard === 'tornado' ? 10 : 15);
      if (region === 'outlier') pct = Math.min(pct, hazard === 'tornado' ? 2 : 5);
      const published = quantize(pct, hazard, { occurrence, concentrated, cluster, uniqueFamilySupport });
      const prior = Number(grid[i][`${hazard}Probability`]) || 0;
      // Assimilation may contract unsupported probabilities, but preserve a weak low-tier envelope.
      const weakEnvelope = prior > 0 && occurrence >= 0.08 ? minimumTier(hazard) : 0;
      grid[i][`${hazard}Probability`] = Math.max(published, weakEnvelope);
      grid[i].outlookAssimilation ??= {};
      grid[i].outlookAssimilation[hazard] = {
        weightedHazardDensity: rawDensity[i],
        supportingMemberFraction: occurrence,
        uniqueStormFamilyCount: familyCount[i],
        spatialConcentration: concentrated,
        clusterSupport: cluster,
        region,
        issuedProbability: grid[i][`${hazard}Probability`]
      };
      if (region === 'core') coreCells++;
      if (grid[i][`${hazard}Probability`] > 0 && occurrence < 0.08) unsupportedCells++;
    }
    const issuedAfter = fieldCentroid(grid, width, `${hazard}Probability`, minimumTier(hazard));
    const unsupportedFraction = countIssued(grid, `${hazard}Probability`) ? unsupportedCells / countIssued(grid, `${hazard}Probability`) : 0;
    diagnostics[hazard] = {
      densityCells,
      coreCells,
      corridorCount: clusterMasks.size,
      uniqueStormFamilies: familyMasks.size,
      trackCentroid,
      issuedCentroidBeforeAssimilation: issuedBefore,
      issuedCentroidAfterAssimilation: issuedAfter,
      trackToIssuedDisplacementKm: centroidDistance(trackCentroid, issuedAfter) * cellSizeKm,
      unsupportedContourFraction: unsupportedFraction,
      method: 'time-integrated-genealogy-aware-directional-density'
    };
    stages[hazard] = { trackCentroid, densityCentroid: weightedFieldCentroid(rawDensity, width), probabilityCoreCentroid: coreCentroid(grid, width, hazard) };
  }

  return {
    version: '2.63.0',
    method: 'outlook-assimilation-engine',
    diagnostics,
    stages
  };
}

function stormContribution(storm, state, hazard, step, length, key) {
  const confidence = clamp(Number(state.confidence ?? storm.confidence ?? 0.5), 0.1, 1);
  const intensity = clamp(Number(state.intensity ?? storm.finalState?.intensity ?? 0.5), 0, 1.2);
  const organization = clamp(Number(state.organization ?? 0.5), 0, 1);
  const inflow = clamp(Number(state.inflowQuality ?? 0.6), 0, 1);
  const coldPool = clamp(Number(state.coldPoolStrength ?? 0.1), 0, 1);
  const mode = String(state.mode ?? storm.mode ?? 'cluster');
  const durationWeight = length > 1 ? 0.75 + 0.25 * Math.sin(Math.PI * step / (length - 1)) : 1;
  let modeWeight = 0.5;
  if (hazard === 'tornado') modeWeight = mode.includes('discrete') ? 1 : mode.includes('linear') ? 0.28 : 0.58;
  if (hazard === 'hail') modeWeight = mode.includes('discrete') ? 0.95 : mode.includes('elevated') ? 0.85 : mode.includes('linear') ? 0.38 : 0.68;
  if (hazard === 'wind') modeWeight = mode.includes('linear') ? 1 : mode.includes('cluster') ? 0.72 : 0.34;
  const physical = hazard === 'wind'
    ? 0.35 * intensity + 0.25 * organization + 0.40 * coldPool
    : hazard === 'tornado'
      ? 0.35 * intensity + 0.30 * organization + 0.35 * inflow
      : 0.45 * intensity + 0.35 * organization + 0.20 * inflow;
  const lead = key === 'day1' ? 1 : key === 'day2' ? 0.88 : 0.76;
  return clamp(physical * confidence * modeWeight * durationWeight * lead, 0, 0.8);
}

function corridorRadii(storm, state, hazard, key) {
  const lead = key === 'day1' ? 1 : key === 'day2' ? 1.25 : 1.55;
  const confidence = clamp(Number(state.confidence ?? storm.confidence ?? 0.5), 0.1, 1);
  const uncertainty = 1 + (1 - confidence) * 0.8;
  const baseCross = hazard === 'tornado' ? 1.2 : hazard === 'hail' ? 1.8 : 2.2;
  return { along: baseCross * (hazard === 'wind' ? 1.8 : 1.45) * lead, cross: baseCross * uncertainty * lead };
}

function rasterizeDirectionalKernel(field, familyMask, clusterMask, memberMask, width, height, cx, cy, vx, vy, along, cross, contribution) {
  const mag = Math.hypot(vx, vy) || 1, ux = vx / mag, uy = vy / mag, px = -uy, py = ux;
  const radius = Math.ceil(Math.max(along, cross) * 2.2);
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x++) {
      const dx = x - cx, dy = y - cy;
      const a = (dx * ux + dy * uy) / Math.max(0.5, along);
      const c = (dx * px + dy * py) / Math.max(0.5, cross);
      const d2 = a * a + c * c;
      if (d2 > 4) continue;
      const idx = y * width + x;
      const kernel = Math.exp(-0.5 * d2);
      field[idx] += contribution * kernel;
      if (kernel >= 0.25) familyMask[idx] = clusterMask[idx] = memberMask[idx] = 1;
    }
  }
}

function localConcentration(field, width, height, index) {
  const x = index % width, y = Math.floor(index / width), center = field[index];
  let sum = 0, count = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    sum += field[ny * width + nx]; count++;
  }
  return sum > 0 ? clamp(center / (sum / Math.max(1, count) * 2.2), 0, 1) : 0;
}
function quantize(value, hazard, ctx) { let result = 0; for (const tier of PUBLISHED[hazard]) { if (value < tier) continue; if (tier >= 15 && (ctx.occurrence < 0.30 || ctx.concentrated < 0.48 || ctx.uniqueFamilySupport < 0.28)) continue; if (tier >= 30 && (ctx.occurrence < 0.52 || ctx.concentrated < 0.62 || ctx.cluster < 0.35)) continue; result = tier; } return result; }
function minimumTier(hazard) { return hazard === 'tornado' ? 2 : 5; }
function dominantMode(storm) { return String(storm.finalState?.mode ?? storm.mode ?? 'cluster').split(' ')[0]; }
function weightedCentroid(points) { let x=0,y=0,w=0; for(const p of points){x+=p.x*p.weight;y+=p.y*p.weight;w+=p.weight;} return w?{x:x/w,y:y/w}:null; }
function weightedFieldCentroid(field,width){let x=0,y=0,w=0;for(let i=0;i<field.length;i++){const v=field[i];if(v<=0)continue;x+=(i%width)*v;y+=Math.floor(i/width)*v;w+=v;}return w?{x:x/w,y:y/w}:null;}
function fieldCentroid(grid,width,key,min){let x=0,y=0,w=0;for(let i=0;i<grid.length;i++){const v=Number(grid[i][key])||0;if(v<min)continue;x+=(i%width)*v;y+=Math.floor(i/width)*v;w+=v;}return w?{x:x/w,y:y/w}:null;}
function coreCentroid(grid,width,hazard){let x=0,y=0,w=0;for(let i=0;i<grid.length;i++){const a=grid[i].outlookAssimilation?.[hazard];if(a?.region!=='core')continue;const v=a.weightedHazardDensity;x+=(i%width)*v;y+=Math.floor(i/width)*v;w+=v;}return w?{x:x/w,y:y/w}:null;}
function countIssued(grid,key){let n=0;for(const c of grid)if((Number(c[key])||0)>0)n++;return n;}
function centroidDistance(a,b){return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
