// The radar's picture of a storm, built from the storm's own state: how far it rotates and how
// far it is part of a line (both continuous), how much rain it holds, its cold pool, and where
// the wind through its depth carries its rain (StormGeometry.js). Nothing here reads what the
// storm is called or which phase it is said to be in.
// Local frame: +x downstream along the storm's motion, +y to the right of it.
import { clamp } from '../scenarios/math.js';
import { rotatingShare, lineShare } from './StormModeEngine.js';
import { buildStormGeometry, rainOffsetInStormFrame } from './StormGeometry.js';

const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);

export function initializeStormStructure(storm, env, seed='storm') {
  storm.structure = buildStructure(storm, env, null, seed);
  return storm.structure;
}

export function evolveStormStructure(storm, env, dtHours, seed='storm') {
  storm.structure = buildStructure(storm, env, storm.structure, seed, dtHours);
  return storm.structure;
}

function buildStructure(storm, env, prior, seed, dtHours=0) {
  buildStormGeometry(storm, env);
  const rotating = rotatingShare(storm), linear = lineShare(storm);
  // How much of the picture is a rotating storm's, a line's, or a plain cell's.
  const asSupercell = ramp(rotating * (1 - linear), 0.15, 0.6), asLine = ramp(linear, 0.25, 0.7), asCell = clamp(1 - Math.max(asSupercell, asLine), 0, 1);
  const system = asLine * ramp(storm.lineHalfLengthKm ?? 0, 60, 140);     // a long, old line has a wide rain shield behind it
  const intensity = clamp(storm.intensity ?? .2, 0, 1.25);
  const org = clamp(storm.organization ?? .2, 0, 1.2);
  const updraft = clamp(storm.updraftStrength ?? intensity, 0, 1.25);
  const meso = clamp(storm.mesocycloneStrength ?? storm.rotationStrength ?? 0, 0, 1.25);
  const low = clamp(storm.lowRotationFree ?? storm.lowRotation ?? 0, 0, 1.2), occlusion = clamp(storm.occlusion ?? 0, 0, 1);
  const cold = clamp(storm.coldPoolStrength ?? 0, 0, 1.2);
  const rain = clamp(storm.precipitation ?? intensity, 0, 1), rearInflow = clamp(storm.rearInflow ?? 0, 0, 1);
  const hail = clamp((storm.currentHailSizeInches ?? 0) / 2.5, 0, 1.2);
  // How much rain there is to see: what the storm holds, a little more in moist air.
  const precipEff = clamp(.12 + .85 * rain + ((env.dewpoint ?? 55) - 55) / 28 * .2 + .15 * asLine, .08, 1.2);
  const phase = occlusion;
  const orientationDeg = Number.isFinite(storm.orientationDeg) ? storm.orientationDeg : 0;
  const size = {
    x: clamp(asCell * (17 + 14 * intensity) + asSupercell * (22 + 18 * org + 10 * intensity) + asLine * (36 + 24 * org + 26 * system), 12, 95),
    y: clamp(asCell * (15 + 12 * intensity) + asSupercell * (18 + 13 * org) + asLine * (48 + 35 * org + 18 * system), 11, 110)
  };
  const hookStrength = asSupercell * clamp(.3 * org + 1.6 * low + .3 * meso - .18 * cold, 0, 1.2);
  const lineStrength = asLine * clamp(org * .55 + cold * .58 + intensity * .25, 0, 1.2);
  const tornadoActive = Boolean(storm.tornado?.onGround);
  const tornadoIntensity = clamp(((storm.tornado?.windSpeedMph ?? 0) - 65) / 120, 0, 1.2);
  // Where the wind carries the rain, kept within the storm's own extent.
  const offset = rainOffsetInStormFrame(storm), reach = Math.hypot(offset.x, offset.y) || 1, limit = Math.min(1, size.x * .45 / reach);
  const flank = { x: offset.x * limit, y: offset.y * limit };

  const features = [];
  if (asSupercell > .05) {
    features.push(lobe('forwardFlank', flank.x, flank.y, size.x*.72, size.y*.68, (.2+.75*precipEff)*asSupercell, 0, {rain:.86,ice:.2,graupel:.16}));
    features.push(lobe('updraftCore', -size.x*.10, size.y*.03, size.x*.19, size.y*.23, (.6+.38*updraft)*asSupercell, -8, {rain:.18,ice:.55,graupel:.48,hail:.25*hail,vertical:updraft}));
    features.push(lobe('hailCore', flank.x*.3-.04*size.x, flank.y*.3+.02*size.y, size.x*.12, size.y*.15, hail*asSupercell, 6, {rain:.24,ice:.44,graupel:.68,hail:.9*hail,vertical:updraft*.75}));
    features.push(lobe('rearFlank', -.34*size.x, .10*size.y, size.x*.31, size.y*.34, (.3+.42*cold)*asSupercell, 22, {rain:.5,graupel:.16,downdraft:cold}));
    // The hook wraps further round as the storm occludes.
    features.push({type:'hookArc', centerXKm:-size.x*.29, centerYKm:size.y*.22, radiusKm:size.x*.34, thicknessKm:Math.max(2,size.x*.075), startDeg:120, endDeg:300+60*occlusion, intensity:hookStrength, rain:.68, graupel:.25, age:phase});
    // The inflow notch sits on the right flank between the forward flank and the hook.
    features.push(lobe('inflowNotch', -.02*size.x, .18*size.y, size.x*.25, size.y*.28, clamp(.45+.4*org,0,1)*asSupercell, 18, {subtractRain:.75,inflow:org}));
  }
  if (asLine > .05) {
    // The line bows forward where air from aloft is driven down behind it.
    features.push({type:'convectiveLine', centerXKm:-size.x*.12, centerYKm:0, lengthKm:size.y*1.65, widthKm:Math.max(5,size.x*.17), bowKm:size.x*(.10+.5*rearInflow), intensity:(.3+.3*precipEff+.42*lineStrength)*asLine, rain:.82, graupel:.34*hail, hail:.18*hail});
    // Trailing rain and the rear inflow lie behind (upstream of) the leading line.
    features.push(lobe('rearStratiform', -size.x*.66, 0, size.x*(.63+.22*system), size.y*.78, (.1+.7*precipEff)*asLine, 0, {rain:.58,ice:.28}));
    features.push(lobe('rearInflowJet', -size.x*.38, 0, size.x*.46, size.y*.30, Math.max(lineStrength*.5, rearInflow)*asLine, 0, {rearInflow:Math.max(lineStrength*.5, rearInflow),downdraft:cold}));
    const count = Math.max(2, Math.min(7, 2+Math.round(org*4)));
    for(let i=0;i<count;i++){
      const fy=((i+.5)/count-.5)*size.y*1.45;
      features.push(lobe('embeddedCore', -size.x*.17 + Math.sin(i*1.7+hashUnit(`${seed}|wave`)*6)*size.x*.05, fy, size.x*.13, size.y*.12, clamp(.5+intensity*.38+hashUnit(`${seed}|core|${i}`)*.16,0,1.15)*asLine, 0, {rain:.8,graupel:.38,hail:.22*hail,vertical:updraft*.6}));
    }
  }
  if (asCell > .05) features.push(lobe('cellCore', flank.x*.4, flank.y*.4, size.x*.42, size.y*.45, (.2+.7*precipEff)*asCell, 0, {rain:.72,ice:.2,graupel:.22,hail:.15*hail,vertical:updraft*.6}));
  if (tornadoActive) features.push(lobe('debris', -size.x*.33, size.y*.25, Math.max(1.2,size.x*.045), Math.max(1.2,size.y*.055), clamp(.35+.65*tornadoIntensity,0,1.2), 0, {debris:clamp(.5+.5*tornadoIntensity,0,1.2),rotation:1.2*tornadoIntensity}));

  const target = {
    schemaVersion:2, orientationDeg, widthKm:size.x*2, heightKm:size.y*2,
    precipitationEfficiency:precipEff, hailGrowthPotential:hail, hookStrength, lineStrength,
    mesocyclone:{strength:Math.max(meso, low),radiusKm:Math.max(3,size.x*.15),offsetXKm:-size.x*.27,offsetYKm:size.y*.20,occlusionPhase:phase},
    wind:{inflowStrength:clamp(org*.7+meso*.3,0,1.2),rearFlankStrength:clamp(cold*.75+meso*.2,0,1.2),rearInflowStrength:Math.max(lineStrength*.5, rearInflow)},
    features, updatedAgeHours:storm.ageHours ?? 0
  };
  if (!prior || !dtHours) return target;
  const blend=clamp(dtHours*2.4,0,1);
  target.hookStrength=lerp(prior.hookStrength??target.hookStrength,target.hookStrength,blend);
  target.hailGrowthPotential=lerp(prior.hailGrowthPotential??target.hailGrowthPotential,target.hailGrowthPotential,blend);
  return target;
}

function lobe(type,x,y,rx,ry,intensity,rotationDeg,props={}){return {type,centerXKm:x,centerYKm:y,radiusXKm:Math.max(.8,rx),radiusYKm:Math.max(.8,ry),intensity:clamp(intensity,0,1.4),rotationDeg,...props};}
function lerp(a,b,t){return a+(b-a)*t;}
function hashUnit(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967296;}
