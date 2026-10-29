// The radar's picture of a storm, built from the storm's own state: how far it rotates and how
// far it is part of a line (both continuous), how much rain it holds, its cold pool, and where
// the wind through its depth carries its rain (StormGeometry.js). Nothing here reads what the
// storm is called or which phase it is said to be in. Every size and place comes from the
// storm's geometry, so the radar shows the same storm the 3D object is built from: a rain
// core tens of kilometres long, an updraught a few kilometres across, and the hook, the
// rotation and any tornado together under the wall cloud.
// Local frame: +x downstream along the storm's motion, +y to the right of it.
import { clamp } from '../scenarios/math.js';
import { rotatingShare, lineShare } from './StormModeEngine.js';
import { buildStormGeometry, rainOffsetInStormFrame, offsetInStormFrame } from './StormGeometry.js';

const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);
// How the radar's shapes follow the geometry: a rain core's radius as a share of the core's
// length or width, how far downwind of the updraught its centre may lie (a share of its
// length), the rotation's radius as a share of the updraught's, and the shortest line segment.
const SHAPE = { rainRadiusShare: 0.32, rainCentreShare: 0.45, mesoShare: 0.4, minLineHalfKm: 15 };

export function initializeStormStructure(storm, env, seed='storm') {
  storm.structure = buildStructure(storm, env, null, seed);
  return storm.structure;
}

export function evolveStormStructure(storm, env, dtHours, seed='storm') {
  storm.structure = buildStructure(storm, env, storm.structure, seed, dtHours);
  return storm.structure;
}

function buildStructure(storm, env, prior, seed, dtHours=0) {
  const geometry = buildStormGeometry(storm, env);
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
  // Sizes (km). A core's radius here is where its rain has fallen to about a third: the
  // geometry's rain core length and width are the extent of its moderate and heavy rain.
  const along = geometry.rain.alongKm, across = geometry.rain.acrossKm, U = geometry.updraught.radiusKm;
  const rainRadius = { x: SHAPE.rainRadiusShare * along, y: SHAPE.rainRadiusShare * across };
  const mesoRadius = clamp(SHAPE.mesoShare * U, 1.5, 4);
  // The storm grows from its mesocyclone: the rotation (wall cloud, couplet, hook centre) is the
  // origin, and the updraught leans downshear from it (StormGeometry). Bearings below are from
  // the mesocyclone, clockwise from the storm's motion (RESEARCH-SUPERCELL-LAYOUT).
  const side = storm.leftMover ? -1 : 1, rotation = { x: 0, y: 0 };
  const core = offsetInStormFrame(storm, geometry.updraught);
  // Where the tornado is while one is down (it drifts left-rear of the mesocyclone as the storm occludes).
  const tornadoAt = geometry.tornado ? offsetInStormFrame(storm, geometry.tornado) : rotation;
  // A line: as long as the storm's share of the line, its leading rain several km deep.
  const lineLength = 2 * Math.max(SHAPE.minLineHalfKm, geometry.line.halfLengthKm), lineWidth = 8 + 6 * clamp(precipEff, 0, 1);
  const shieldDepth = 12 + 35 * system;
  const hookStrength = asSupercell * clamp(.3 * org + 1.6 * low + .3 * meso - .18 * cold, 0, 1.2);
  const lineStrength = asLine * clamp(org * .55 + cold * .58 + intensity * .25, 0, 1.2);
  const tornadoActive = Boolean(storm.tornado?.onGround);
  const tornadoIntensity = clamp(((storm.tornado?.windSpeedMph ?? 0) - 65) / 120, 0, 1.2);
  // Where the wind carries the rain: the core starts at the updraught and lies downwind of it.
  const offset = rainOffsetInStormFrame(storm), reach = Math.hypot(offset.x, offset.y) || 1, limit = Math.min(1, SHAPE.rainCentreShare * along / reach);
  const flank = { x: offset.x * limit, y: offset.y * limit }, downwindDeg = Math.atan2(offset.y, offset.x) * 180 / Math.PI;

  const features = [];
  if (asSupercell > .05) {
    features.push(lobe('forwardFlank', flank.x, flank.y, rainRadius.x, rainRadius.y, (.2+.75*precipEff)*asSupercell, downwindDeg, {rain:.86,ice:.2,graupel:.16}));
    // The updraught's core: ahead of the mesocyclone where the column leans (the BWER and the
    // highest tops above it), on the side away from the rotation so the hook stands clear of it.
    features.push(lobe('updraftCore', core.x+.1*U, core.y-.25*U*side, .32*U, .36*U,(.6+.38*updraft)*asSupercell, -8, {rain:.18,ice:.55,graupel:.48,hail:.25*hail,vertical:updraft}));
    // The hail core hugs the updraught's forward-left edge (-100..-20 deg from the mesocyclone).
    features.push(lobe('hailCore', core.x+(flank.x-core.x)*.3+.1*U, core.y+(flank.y-core.y)*.3-.2*U*side, Math.max(1.5,.5*geometry.hail.radiusKm), Math.max(1.8,.6*geometry.hail.radiusKm),hail*asSupercell, 6, {rain:.24,ice:.44,graupel:.68,hail:.9*hail,vertical:updraft*.75}));
    // The rear-flank downdraught: behind the mesocyclone and a little left (~210 deg, 1-5 km).
    features.push(lobe('rearFlank', rotation.x-.55*U, rotation.y-.3*U*side, .4*U, .4*U,(.3+.42*cold)*asSupercell, 22, {rain:.5,graupel:.16,downdraft:cold}));
    // The hook curls round the rotation, further round as the storm occludes.
    features.push({type:'hookArc', centerXKm:rotation.x, centerYKm:rotation.y, radiusKm:1.2*mesoRadius, thicknessKm:Math.max(1.2,.35*mesoRadius), startDeg:120, endDeg:300+60*occlusion, intensity:hookStrength, rain:.68, graupel:.25, age:phase});
    // The inflow notch sits on the right flank between the forward flank and the hook, opening to
    // the right-front of the mesocyclone (+30..+120 deg, 2-8 km).
    features.push(lobe('inflowNotch', rotation.x+.6*U, rotation.y+.55*U*side, .6*U, .5*U,clamp(.45+.4*org,0,1)*asSupercell, 18, {subtractRain:.75,inflow:org}));
  }
  if (asLine > .05) {
    // The line bows forward where air from aloft is driven down behind it.
    features.push({type:'convectiveLine', centerXKm:-.25*lineWidth, centerYKm:0, lengthKm:lineLength, widthKm:lineWidth, bowKm:lineLength*(.04+.2*rearInflow), intensity:(.3+.3*precipEff+.42*lineStrength)*asLine, rain:.82, graupel:.34*hail, hail:.18*hail});
    // Trailing rain and the rear inflow lie behind (upstream of) the leading line.
    features.push(lobe('rearStratiform', -(lineWidth+shieldDepth), 0, shieldDepth, .4*lineLength, (.1+.7*precipEff)*asLine, 0, {rain:.58,ice:.28}));
    features.push(lobe('rearInflowJet', -(lineWidth+.6*shieldDepth), 0, .7*shieldDepth, .2*lineLength, Math.max(lineStrength*.5, rearInflow)*asLine, 0, {rearInflow:Math.max(lineStrength*.5, rearInflow),downdraft:cold}));
    const count = Math.max(2, Math.min(7, Math.round(lineLength/14)));
    for(let i=0;i<count;i++){
      const fy=((i+.5)/count-.5)*lineLength*.9;
      features.push(lobe('embeddedCore', -.3*lineWidth + Math.sin(i*1.7+hashUnit(`${seed}|wave`)*6)*lineWidth*.25, fy, .5*lineWidth, Math.max(3,lineLength/(count*2.6)), clamp(.5+intensity*.38+hashUnit(`${seed}|core|${i}`)*.16,0,1.15)*asLine, 0, {rain:.8,graupel:.38,hail:.22*hail,vertical:updraft*.6}));
    }
  }
  if (asCell > .05) features.push(lobe('cellCore', flank.x*.4, flank.y*.4, rainRadius.x, rainRadius.y, (.2+.7*precipEff)*asCell, downwindDeg, {rain:.72,ice:.2,graupel:.22,hail:.15*hail,vertical:updraft*.6}));
  // Debris where the tornado is: under the wall cloud, or where it has drifted to.
  if (tornadoActive) features.push(lobe('debris', tornadoAt.x, tornadoAt.y, 1.2, 1.2, clamp(.35+.65*tornadoIntensity,0,1.2), 0, {debris:clamp(.5+.5*tornadoIntensity,0,1.2),rotation:1.2*tornadoIntensity}));

  // How far the picture reaches from the storm's centre (km), for whatever draws it.
  const reachKm = features.reduce((most, f) => Math.max(most, f.type === 'hookArc' ? Math.hypot(f.centerXKm, f.centerYKm) + f.radiusKm + 3 * f.thicknessKm
    : f.type === 'convectiveLine' ? Math.max(.65 * f.lengthKm, Math.abs(f.centerXKm) + f.bowKm + 3 * f.widthKm)
    : Math.max(Math.abs(f.centerXKm), Math.abs(f.centerYKm)) + 2 * Math.max(f.radiusXKm, f.radiusYKm)), 8);
  const target = {
    schemaVersion:3, orientationDeg, widthKm:2*reachKm, heightKm:2*reachKm,
    precipitationEfficiency:precipEff, hailGrowthPotential:hail, hookStrength, lineStrength,
    mesocyclone:{strength:Math.max(meso, low),lowStrength:low,radiusKm:mesoRadius,offsetXKm:rotation.x,offsetYKm:rotation.y,occlusionPhase:phase},
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
