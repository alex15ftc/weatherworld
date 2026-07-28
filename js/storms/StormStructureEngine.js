import { clamp } from '../scenarios/math.js?v=2.20.1';

export function initializeStormStructure(storm, env, seed='storm') {
  storm.structure = buildStructure(storm, env, null, seed);
  return storm.structure;
}

export function evolveStormStructure(storm, env, dtHours, seed='storm') {
  storm.structure = buildStructure(storm, env, storm.structure, seed, dtHours);
  return storm.structure;
}

function buildStructure(storm, env, prior, seed, dtHours=0) {
  const mode = String(storm.mode ?? 'cell').toLowerCase();
  const supercell = mode.includes('supercell') || mode.includes('discrete');
  const linear = mode.includes('qlcs') || mode.includes('linear') || mode.includes('squall');
  const mcs = mode.includes('mcs');
  const elevated = mode.includes('elevated');
  const intensity = clamp(storm.intensity ?? .2, 0, 1.25);
  const org = clamp(storm.organization ?? .2, 0, 1.2);
  const updraft = clamp(storm.updraftStrength ?? intensity, 0, 1.25);
  const meso = clamp(storm.mesocycloneStrength ?? storm.rotationStrength ?? 0, 0, 1.25);
  const cold = clamp(storm.coldPoolStrength ?? 0, 0, 1.2);
  const hailEnv = clamp(((env.cape ?? 0)/3500)*.35 + ((env.bulkShear ?? 0)/55)*.25 + (((env.midlevelLapseRate ?? env.lapseRate700500 ?? 6)-5.5)/2.5)*.28 + updraft*.25, 0, 1.2);
  const precipEff = clamp(((env.dewpoint ?? 55)-45)/28*.45 + intensity*.45 + ((linear||mcs)?0.2:0), .08, 1.2);
  const life = lifecycleFactor(storm.lifecycleState);
  const phase = ((storm.ageHours ?? 0) * .27 + hashUnit(`${seed}|phase`)) % 1;
  const orientationDeg = Number.isFinite(storm.orientationDeg) ? storm.orientationDeg : 0;
  const size = baseSize(supercell, linear, mcs, intensity, org, storm.mergeCount ?? 0);
  const hookStrength = supercell ? clamp((org-.35)*1.35 + meso*.72 + life*.18 - cold*.18, 0, 1.2) : 0;
  const hailStrength = clamp(hailEnv * (supercell?.9:.62) * life, 0, 1.2);
  const lineStrength = linear||mcs ? clamp(org*.55+cold*.58+intensity*.25,0,1.2) : 0;
  const tornadoActive = Boolean(storm.tornado?.active || storm.tornado?.onGround || storm.tornado?.isActive);
  const tornadoIntensity = clamp(storm.tornado?.intensity ?? storm.tornado?.currentIntensity ?? meso*.55,0,1.2);

  const features = [];
  if (supercell) {
    features.push(lobe('forwardFlank', size.x*.24, -size.y*.03, size.x*.72, size.y*.68, .58+.35*precipEff, 0, {rain:.86,ice:.2,graupel:.16}));
    features.push(lobe('updraftCore', -size.x*.10, size.y*.03, size.x*.19, size.y*.23, .6+.38*updraft, -8, {rain:.18,ice:.55,graupel:.48,hail:.25*hailStrength,vertical:updraft}));
    features.push(lobe('hailCore', -.04*size.x, .02*size.y, size.x*.12, size.y*.15, hailStrength, 6, {rain:.24,ice:.44,graupel:.68,hail:.9*hailStrength,vertical:updraft*.75}));
    features.push(lobe('rearFlank', -.34*size.x, .10*size.y, size.x*.31, size.y*.34, .3+.42*cold, 22, {rain:.5,graupel:.16,downdraft:cold}));
    features.push({type:'hookArc', centerXKm:-size.x*.29, centerYKm:size.y*.22, radiusKm:size.x*.34, thicknessKm:Math.max(2,size.x*.075), startDeg:120, endDeg:330, intensity:hookStrength, rain:.68, graupel:.25, age:phase});
    features.push(lobe('inflowNotch', -.02*size.x, -.18*size.y, size.x*.25, size.y*.28, clamp(.45+.4*org,0,1), -18, {subtractRain:.75,inflow:org}));
  } else if (linear || mcs) {
    features.push({type:'convectiveLine', centerXKm:-size.x*.12, centerYKm:0, lengthKm:size.y*1.65, widthKm:Math.max(5,size.x*.17), bowKm:size.x*.24, intensity:.52+.42*lineStrength, rain:.82, graupel:.34*hailStrength, hail:.18*hailStrength});
    features.push(lobe('rearStratiform', size.x*.42, 0, size.x*(mcs?.85:.63), size.y*.78, .35+.45*precipEff, 0, {rain:.58,ice:.28}));
    features.push(lobe('rearInflowJet', size.x*.14, 0, size.x*.46, size.y*.30, lineStrength, 0, {rearInflow:lineStrength,downdraft:cold}));
    const count = Math.max(2, Math.min(7, 2+Math.round(org*4)));
    for(let i=0;i<count;i++){
      const fy=((i+.5)/count-.5)*size.y*1.45;
      features.push(lobe('embeddedCore', -size.x*.17 + Math.sin(i*1.7+phase*6)*size.x*.05, fy, size.x*.13, size.y*.12, clamp(.5+intensity*.38+hashUnit(`${seed}|core|${i}`)*.16,0,1.15), 0, {rain:.8,graupel:.38,hail:.22*hailStrength,vertical:updraft*.6}));
    }
  } else {
    features.push(lobe('cellCore', 0,0,size.x*.42,size.y*.45,.45+.45*intensity,0,{rain:.72,ice:.2,graupel:.22,hail:.15*hailStrength,vertical:updraft*.6}));
  }
  if (tornadoActive) features.push(lobe('debris', -size.x*.33, size.y*.25, Math.max(1.2,size.x*.045), Math.max(1.2,size.y*.055), clamp(.35+.65*tornadoIntensity,0,1.2), 0, {debris:clamp(.5+.5*tornadoIntensity,0,1.2),rotation:1.2*tornadoIntensity}));

  const target = {
    schemaVersion:1, mode:storm.mode, orientationDeg, widthKm:size.x*2, heightKm:size.y*2,
    precipitationEfficiency:precipEff, hailGrowthPotential:hailStrength, hookStrength, lineStrength,
    mesocyclone:{strength:meso,radiusKm:Math.max(3,size.x*.15),offsetXKm:-size.x*.27,offsetYKm:size.y*.20,occlusionPhase:phase},
    wind:{inflowStrength:clamp(org*.7+meso*.3,0,1.2),rearFlankStrength:clamp(cold*.75+meso*.2,0,1.2),rearInflowStrength:lineStrength},
    features, updatedAgeHours:storm.ageHours ?? 0
  };
  if (!prior || !dtHours) return target;
  const blend=clamp(dtHours*2.4,0,1);
  target.hookStrength=lerp(prior.hookStrength??target.hookStrength,target.hookStrength,blend);
  target.hailGrowthPotential=lerp(prior.hailGrowthPotential??target.hailGrowthPotential,target.hailGrowthPotential,blend);
  return target;
}

function lobe(type,x,y,rx,ry,intensity,rotationDeg,props={}){return {type,centerXKm:x,centerYKm:y,radiusXKm:Math.max(.8,rx),radiusYKm:Math.max(.8,ry),intensity:clamp(intensity,0,1.4),rotationDeg,...props};}
function baseSize(sc,line,mcs,intensity,org,merges){return {x:clamp(sc?22+18*org+10*intensity:line?36+24*org:mcs?55+32*org:17+14*intensity,12,95),y:clamp(sc?18+13*org:line?48+35*org:mcs?58+38*org:15+12*intensity,11,110)};}
function lifecycleFactor(s){return s==='tower'?.22:s==='developing'?.55:s==='weakening'?.62:s==='dissipating'?.3:1;}
function lerp(a,b,t){return a+(b-a)*t;}
function hashUnit(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967296;}
