const LEVELS = [1000,975,950,925,900,875,850,825,800,775,750,725,700,675,650,625,600,575,550,525,500,475,450,425,400,375,350,325,300,275,250,225,200,175,150,125,100];
const RD=287.05, RV=461.5, CP=1004, G=9.80665, EPS=RD/RV, KNOT_TO_MS=.514444;
const LOG_LEVELS=LEVELS.map(p=>Math.log(p));

export function buildSounding(cell) {
  const surfaceP = Math.min(1000, cell.surface.pressure);
  const surfaceT = fToC(cell.surface.temperature);
  const surfaceTd = Math.min(surfaceT, fToC(cell.surface.dewpoint));
  const anchors = buildAnchors(cell,surfaceP,surfaceT,surfaceTd);
  // Every figure below is the one the plain formulas give, to the last digit; what a level
  // needs more than once (its logarithm, its vapour pressure, an anchor's sine and cosine) is
  // worked out once and kept alongside the profile (`work`).
  for(const a of anchors){a.logP=Math.log(a.p);const r=a.dir*Math.PI/180;a.sin=Math.sin(r);a.cos=Math.cos(r)}
  const first=LEVELS.findIndex(p=>p<surfaceP), count=first<0?1:LEVELS.length-first+1;
  const profile=new Array(count), logP=new Float64Array(count), exner=new Float64Array(count), vapour=new Float64Array(count), envTv=new Float64Array(count);
  for(let i=0;i<count;i++){
    const p=i?LEVELS[first+i-1]:surfaceP, lp=i?LOG_LEVELS[first+i-1]:Math.log(surfaceP), row=interpolateAnchorAt(anchors,p,lp);
    row.heightM = pressureToHeight(p, cell.terrain.elevationM, surfaceP, surfaceT);
    const r=row.dir*Math.PI/180; row.u=-Math.sin(r)*row.spd; row.v=-Math.cos(r)*row.spd;
    const e=saturationVaporPressure(row.td);
    row.rh = clamp(100*e/saturationVaporPressure(row.t),0,100);
    // Environment virtual temperature is identical for every parcel lifted through this profile.
    envTv[i]=(row.t+273.15)*(1+.61*(EPS*e/(p-e)));
    profile[i]=row; logP[i]=lp; exner[i]=Math.pow(p/1000,RD/CP); vapour[i]=e;
  }
  for(const a of anchors){delete a.logP;delete a.sin;delete a.cos}
  const work={logP,exner,vapour};
  const surfaceResult = parcelDiagnosticsForSource(profile, 0, cell.terrain.elevationM, envTv, work);
  const mixedSource = mixedLayerSource(profile, 100, work);
  const mixedResult = parcelDiagnosticsForState(profile, mixedSource, cell.terrain.elevationM, envTv, work);
  const muResult = mostUnstableParcel(profile, cell.terrain.elevationM, 300, envTv, surfaceResult, work);
  const meanWind = meanWindLayer(profile,0,6000,cell.terrain.elevationM);
  const stormMotion = bunkers(profile,cell.terrain.elevationM,meanWind);
  const kinematics = diagnoseKinematics(profile,stormMotion,cell.terrain.elevationM,meanWind);
  const pw = precipitableWater(profile,vapour);
  const convectiveTemp = surfaceT + Math.max(0, Math.abs(surfaceResult.thermo.cin)/45);
  const capeTerm=clamp(mixedResult.thermo.cape/1500,0,3);
  const srhTerm=clamp(kinematics.srh01/150,0,3);
  const effectiveShearMs=kinematics.shear06*KNOT_TO_MS;
  const shearTerm=effectiveShearMs<12.5?0:clamp(effectiveShearMs/20,0,1.5);
  const mixedLclAgl=Math.max(0,mixedResult.thermo.lclM-cell.terrain.elevationM);
  const lclTerm=mixedLclAgl<1000?1:clamp((2000-mixedLclAgl)/1000,0,1);
  const cinMagnitude=Math.abs(mixedResult.thermo.cin);
  const cinTerm=cinMagnitude<50?1:clamp((200-cinMagnitude)/150,0,1);
  const surfaceRooted=mixedResult.thermo.cape>=100&&cinMagnitude<=250;
  const rawStp=surfaceRooted?clamp(capeTerm*srhTerm*shearTerm*lclTerm*cinTerm,0,15):0;
  const synopticSupport=diagnoseSynopticTornadoSupport(cell);
  // Standard SPC fixed-layer STP from the sounding alone.
  const stp=rawStp, targetAirMassFactor=1, airMassFactor=1;
  const vtp=diagnoseViolentTornadoParameter({stp,rawStp,synopticSupport,cape:mixedResult.thermo.cape,srh:kinematics.srh01,shear:kinematics.shear06,lcl:mixedResult.thermo.lclM,cin:Math.abs(mixedResult.thermo.cin),criticalAngle:kinematics.criticalAngle});
  const scp=clamp((muResult.thermo.cape/1000)*(kinematics.srh03/100)*clamp(kinematics.shear06/40,0,1.5),0,35);
  const lapseRate01km=layerLapseRateByHeight(profile,cell.terrain.elevationM,0,1000);
  const lapseRate03km=layerLapseRateByHeight(profile,cell.terrain.elevationM,0,3000);
  const lapseRate700500=layerLapseRate(profile,700,500);
  const lapseRate850500=layerLapseRate(profile,850,500);
  const dcape=downdraughtCape(profile, surfaceP);
  const t500=temperatureAtPressure(profile,500), muSource=profile[muResult.sourceIndex??0];
  const parcelRow=result=>({cape:result.thermo.cape,cin:result.thermo.cin,lclAglM:result.thermo.lclM-cell.terrain.elevationM,lfcAglM:result.thermo.lfcM-cell.terrain.elevationM,elAglM:result.thermo.elM-cell.terrain.elevationM,liftedIndex:t500-parcelTemperatureAtPressure(result.parcel,500)});
  const params={
    parcels:{surface:parcelRow(surfaceResult),mixedLayer:parcelRow(mixedResult),mostUnstable:parcelRow(muResult)}, muMixingRatioGkg:1000*mixingRatioFromDewpoint(muSource.td,muSource.p),
    sbcape:surfaceResult.thermo.cape, mlcape:mixedResult.thermo.cape, mucape:muResult.thermo.cape,
    sbcin:surfaceResult.thermo.cin, mlcin:mixedResult.thermo.cin, mucin:muResult.thermo.cin,
    lclM:mixedResult.thermo.lclM, lclAglM:mixedLclAgl, lfcM:mixedResult.thermo.lfcM, elM:mixedResult.thermo.elM,
    freezingM:interpolateHeightForTemp(profile,0), wetBulbZeroM:interpolateHeightForWetBulb(profile,0),
    liftedIndex:temperatureAtPressure(profile,500)-parcelTemperatureAtPressure(mixedResult.parcel,500),
    precipWater:pw, convectiveTempC:convectiveTemp, dcape, lapseRate01km, lapseRate03km, lapseRate700500, lapseRate850500,
    shear01:kinematics.shear01, shear03:kinematics.shear03, shear06:kinematics.shear06,
    srh01:kinematics.srh01, srh03:kinematics.srh03,
    meanWind:kinematics.meanWind, criticalAngle:kinematics.criticalAngle,
    stp, rawStp, vtp, synopticSupport, scp, stormMotion, effectiveLayer:mixedResult.thermo.effectiveLayer,
    stpComponents:{capeTerm,srhTerm,shearTerm,lclTerm,cinTerm,rawStp,fullRawStp:rawStp,synopticAdjustment:1,airMassFactor,targetAirMassFactor,parcelSupportBaseline:clamp((Number(cell.surface?.dewpoint)-42)/24,0,1)*clamp(1-(Number(cell.surface?.temperature)-Number(cell.surface?.dewpoint))/36,0,1),adjustedStp:stp,lclAglM:mixedLclAgl,surfaceRooted}
  };
  // parcel is the mixed-layer parcel; muParcel the most unstable one, from its own level up.
  return { profile, parcel:mixedResult.parcel, muParcel:muResult.parcel.slice(muResult.sourceIndex??0), params };
}

export function updateCellDiagnostics(cell) {
  const previousMagnitude=Number(cell.thermodynamics?.cin?.mlMagnitude ?? cell.derived?.mlcinMagnitude ?? cell.derived?.cin);
  const sounding=buildSounding(cell), p=sounding.params;
  cell.derived ??= {};
  const cin={
    sbSigned:p.sbcin, mlSigned:p.mlcin, muSigned:p.mucin,
    sbMagnitude:Math.abs(p.sbcin), mlMagnitude:Math.abs(p.mlcin), muMagnitude:Math.abs(p.mucin)
  };
  const tendency=Number.isFinite(previousMagnitude)?cin.mlMagnitude-previousMagnitude:0;
  const erosion=Math.max(0,-tendency), rebuilding=Math.max(0,tendency);
  const state=cin.mlMagnitude<=5?'breached':cin.mlMagnitude<=25?'nearly-breached':tendency<=-2?'eroding':tendency>=2?'strengthening':'steady';
  const priorBreach=cell.cap?.breachHourUtc ?? null;
  cell.thermodynamics={
    // (The profile and the parcels are not kept on the cell: nothing reads them there, and every
    // cell holding ~75 of them from step to step was 40% of a world's memory (82 MB of heap, 48
    // without them; measured 2026-10-17). A sounding that is
    // asked for is built afresh: buildSounding.)
    parcels:{surface:{cape:p.sbcape,cinSigned:p.sbcin,cinMagnitude:cin.sbMagnitude},mixedLayer:{cape:p.mlcape,cinSigned:p.mlcin,cinMagnitude:cin.mlMagnitude},mostUnstable:{cape:p.mucape,cinSigned:p.mucin,cinMagnitude:cin.muMagnitude}},
    cape:{sb:p.sbcape,ml:p.mlcape,mu:p.mucape}, cin,
    lapseRates:{km0_1:p.lapseRate01km,km0_3:p.lapseRate03km,mb700_500:p.lapseRate700500,mb850_500:p.lapseRate850500},
    stpComponents:{...p.stpComponents}, revision:'2.29.0'
  };
  cell.cap={...(cell.cap??{}),cinSigned:cin.mlSigned,cinMagnitude:cin.mlMagnitude,previousCinMagnitude:Number.isFinite(previousMagnitude)?previousMagnitude:cin.mlMagnitude,tendencyJkgPerHour:tendency,erosionJkgPerHour:erosion,rebuildingJkgPerHour:rebuilding,state,breached:cin.mlMagnitude<=5,breachHourUtc:cin.mlMagnitude<=5?(priorBreach??cell.validHourUtc??null):null};
  cell.derived.cape=p.mlcape;
  cell.derived.cin=cin.mlMagnitude;
  cell.derived.sbcinSigned=cin.sbSigned; cell.derived.sbcinMagnitude=cin.sbMagnitude;
  cell.derived.mlcinSigned=cin.mlSigned; cell.derived.mlcinMagnitude=cin.mlMagnitude;
  cell.derived.mucinSigned=cin.muSigned; cell.derived.mucinMagnitude=cin.muMagnitude;
  cell.derived.dcape=p.dcape;
  cell.derived.lapseRate01km=p.lapseRate01km; cell.derived.lapseRate03km=p.lapseRate03km;
  cell.derived.lapseRate700500=p.lapseRate700500; cell.derived.lapseRate850500=p.lapseRate850500;
  cell.derived.midLevelLapseRate=p.lapseRate700500;
  cell.derived.lcl=p.lclM;
  cell.derived.lclAgl=Math.max(0,p.lclM-(cell.terrain?.elevationM??0));
  cell.derived.bulkShear=p.shear06; cell.derived.srh=p.srh01;
  cell.derived.stp=p.stp; cell.derived.rawStp=p.rawStp; cell.derived.stpComponents={...p.stpComponents};
  cell.derived.vtp=p.vtp; cell.derived.synopticTornadoSupport=p.synopticSupport; cell.derived.scp=p.scp;
  cell.derived.sounding={sbcape:p.sbcape,mlcape:p.mlcape,mucape:p.mucape,sbcin:p.sbcin,mlcin:p.mlcin,mucin:p.mucin,lclM:p.lclM,lclAglM:cell.derived.lclAgl,lfcM:p.lfcM,elM:p.elM,shear01:p.shear01,shear03:p.shear03,shear06:p.shear06,srh01:p.srh01,srh03:p.srh03,lapseRate01km:p.lapseRate01km,lapseRate03km:p.lapseRate03km,lapseRate700500:p.lapseRate700500,lapseRate850500:p.lapseRate850500,wetBulbZeroAglM:Number.isFinite(p.wetBulbZeroM)?p.wetBulbZeroM-(cell.terrain?.elevationM??0):null,stpComponents:{...p.stpComponents}};
  return sounding;
}


function layerLapseRateByHeight(profile,elevationM,lowerAglM,upperAglM){
  const lower=interpolateProfileAtHeight(profile,elevationM+lowerAglM);
  const upper=interpolateProfileAtHeight(profile,elevationM+upperAglM);
  const dz=Math.max(250,(upper.heightM??0)-(lower.heightM??0));
  return clamp((lower.t-upper.t)/(dz/1000),2,12);
}
function interpolateProfileAtHeight(profile,heightM){
  for(let i=0;i<profile.length-1;i++){const a=profile[i],b=profile[i+1];if((a.heightM??0)<=heightM&&(b.heightM??0)>=heightM){const f=(heightM-a.heightM)/Math.max(1e-6,b.heightM-a.heightM);return {t:a.t+(b.t-a.t)*f,td:a.td+(b.td-a.td)*f,heightM};}}
  return heightM<=(profile[0]?.heightM??0)?profile[0]:profile.at(-1);
}
// The layer's depth from its own mean temperature (the hypsometric equation). (Until 2026-10-20 from
// the profile's heights, which are worked out with the surface temperature for the whole column:
// a 700-500 mb layer about 10% too deep under a hot surface, and its lapse rate about 10% too small.)
function layerLapseRate(profile, lowerP, upperP){
  const lower=interpolateProfileAtPressure(profile,lowerP);
  const upper=interpolateProfileAtPressure(profile,upperP);
  const dz=Math.max(500,RD*((lower.t+upper.t)/2+273.15)/G*Math.log(lowerP/upperP));
  return clamp(((lower.t-upper.t)/(dz/1000)),3,10.5);
}
function interpolateProfileAtPressure(profile,p){
  for(let i=0;i<profile.length-1;i++){const a=profile[i],b=profile[i+1];if(a.p>=p&&b.p<=p){const f=(a.p-p)/Math.max(1e-6,a.p-b.p);return {t:a.t+(b.t-a.t)*f,td:a.td+(b.td-a.td)*f,heightM:a.heightM+(b.heightM-a.heightM)*f};}}
  return profile.at(-1);
}
// Downdraught CAPE (J/kg): the energy a downdraught can gain. The driest, coolest air aloft
// (lowest equivalent potential temperature between 100 and 400 mb above the ground) is
// cooled to its wet-bulb temperature by rain evaporating into it and sinks along the moist
// adiabat to the ground; the energy is how much colder than its surroundings it stays on the
// way down. Dry air above moist air gives large values; a moist column gives small ones.
function downdraughtCape(profile, surfaceP) {
  let source = -1, lowest = Infinity;
  for (let i = 0; i < profile.length; i++) {
    const row = profile[i];
    if (row.p > surfaceP - 100 || row.p < surfaceP - 400) continue;
    const tK = row.t + 273.15, w = mixingRatioFromDewpoint(row.td, row.p);
    const thetaE = tK * Math.pow(1000 / row.p, RD / CP) * Math.exp(2.5e6 * w / (CP * tK));
    if (thetaE < lowest) { lowest = thetaE; source = i; }
  }
  if (source < 0) return 0;
  // Down from the source level by level (the profile runs from the ground up).
  let parcelT = wetBulbApprox(profile[source].t, profile[source].rh), energy = 0;
  let above = { p: profile[source].p, deficit: virtualTemperatureK(profile[source].t, profile[source].td, profile[source].p) - virtualTemperatureK(parcelT, parcelT, profile[source].p) };
  for (let i = source - 1; i >= 0; i--) {
    const row = profile[i];
    parcelT = moistLift(parcelT, above.p, row.p);
    const deficit = virtualTemperatureK(row.t, row.td, row.p) - virtualTemperatureK(parcelT, parcelT, row.p);
    energy += RD * 0.5 * (deficit + above.deficit) * Math.log(row.p / above.p);
    above = { p: row.p, deficit };
  }
  return Math.max(0, energy);
}

export function diagnoseSynopticTornadoSupport(cell) {
  const ascent=clamp(cell.features?.synopticAscent ?? cell.mesoscaleFields?.ascent ?? 0,0,1);
  const coherence=clamp(cell.features?.synopticCoherence ?? 0.75,0,1);
  const pooling=clamp(cell.mesoscaleFields?.moisturePooling ?? 0,0,1);
  const erosion=clamp(cell.mesoscaleFields?.capErosion ?? 0,0,1);
  const warmSector=cell.features?.warmSector ? 1 : 0;
  return clamp(ascent*.30+coherence*.20+pooling*.18+erosion*.16+warmSector*.16,0,1);
}

export function diagnoseViolentTornadoParameter({stp=0,rawStp=stp,synopticSupport=0,cape=0,srh=0,shear=0,lcl=2000,cin=200,criticalAngle=0}={}) {
  if (rawStp <= 0 || cape < 500 || srh < 75 || shear < 28) return 0;
  const stpTerm=clamp(stp/6,0,1.5);
  const srhTerm=clamp((srh-125)/325,0,1.2);
  const shearTerm=clamp((shear-35)/35,0,1.1);
  const capeTerm=clamp((cape-1000)/2500,0,1.1);
  const lclTerm=clamp((1500-lcl)/800,0,1);
  const cinTerm=clamp((150-Math.abs(cin))/125,0,1);
  const angleTerm=clamp((criticalAngle-45)/75,0,1);
  const violentOverlap=stpTerm*.32+srhTerm*.18+shearTerm*.14+capeTerm*.10+lclTerm*.10+cinTerm*.06+angleTerm*.04+synopticSupport*.06;
  // Analysis-only 0–5 display scale. This value is never consumed by storm,
  // tornado, hazard-probability, CIG, or categorical-outlook logic.
  const raw=violentOverlap*(0.55+0.45*stpTerm)*(0.72+0.28*synopticSupport);
  return clamp((raw/1.5)*5,0,5);
}

const SKEW_C=60;
// Skew-T log-p in the layout forecasters know from SHARPpy-style soundings: temperature red,
// dewpoint green, wet-bulb thin cyan, parcels dashed, the 0 and -20 C isotherms picked out,
// heights above ground down the left, parcel levels on the right, wind barbs outside.
export function drawSounding(canvas, sounding) {
  const ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height, profile=sounding.profile, p=sounding.params;
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#05080d';ctx.fillRect(0,0,w,h);
  const left=44,right=w-64,top=14,bottom=h-30;
  const y=pr=>bottom-(Math.log(1000)-Math.log(pr))/(Math.log(1000)-Math.log(100))*(bottom-top);
  // Isotherms are straight lines leaning right, SKEW_C degrees per tenfold fall in pressure.
  const x=(t,pr)=>left+((t+50)+SKEW_C*Math.log10(1000/pr))/100*(right-left);
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  drawDryAdiabats(ctx,x,y,top,bottom);
  drawMoistAdiabats(ctx,x,y,top,bottom);
  drawMixingRatio(ctx,x,y,top,bottom);
  drawCAPEAndCIN(ctx,sounding,x,y);
  drawIsotherms(ctx,x,y,top,bottom);
  ctx.save();ctx.strokeStyle='rgba(96,165,250,.8)';ctx.lineWidth=1.2;ctx.setLineDash([6,5]);
  for(const t of [0,-20]){ctx.beginPath();ctx.moveTo(x(t,1000),y(1000));ctx.lineTo(x(t,100),y(100));ctx.stroke();}
  ctx.restore();
  drawPressureLines(ctx,y,left,right);
  drawProfile(ctx,profile.map(r=>({p:r.p,t:Math.min(r.t,Math.max(r.td,wetBulbApprox(r.t,r.rh)))})),'t','#22d3ee',1.1,x,y);
  drawProfile(ctx,profile,'td','#3ddc64',2.6,x,y);
  drawProfile(ctx,profile,'t','#ff4d4d',2.6,x,y);
  ctx.setLineDash([6,5]);
  if(sounding.muParcel?.length>1&&p.mucape>p.mlcape+100)drawProfile(ctx,sounding.muParcel,'t','#fbbf24',1.5,x,y);
  drawProfile(ctx,sounding.parcel,'t','#f1f5f9',1.8,x,y);
  ctx.setLineDash([]);
  ctx.restore();
  ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.strokeRect(left,top,right-left,bottom-top);
  // Wind at the ground and every 50 hPa, as barbs down the right-hand side.
  profile.forEach((row,i)=>{if(i===0||(row.p%50===0&&row.p>=150&&profile[0].p-row.p>=20))drawBarb(ctx,right+34,y(row.p),row.dir,row.spd);});

  ctx.font='11px system-ui';ctx.textAlign='right';ctx.fillStyle='#9eacbb';
  for(const pr of [1000,850,700,500,400,300,250,200,150,100]) ctx.fillText(pr,left-6,y(pr)+4);
  ctx.textAlign='center';for(let t=-40;t<=40;t+=10) ctx.fillText(`${t}`,x(t,1000),bottom+15);
  // Heights above the ground.
  const ground=profile[0].heightM;
  ctx.textAlign='left';ctx.font='10px system-ui';
  for(const km of [1,3,6,9,12,15]){const pr=pressureAtHeight(profile,ground+km*1000);if(!Number.isFinite(pr)||pr<100)continue;ctx.strokeStyle='#f87171';ctx.fillStyle='#f87171';ctx.beginPath();ctx.moveTo(left,y(pr));ctx.lineTo(left+9,y(pr));ctx.stroke();ctx.fillText(`${km} km`,left+12,y(pr)+3);}
  // Parcel levels (mixed-layer parcel).
  const level=(label,heightM,color)=>{if(!Number.isFinite(heightM))return;const pr=pressureAtHeight(profile,heightM);if(!Number.isFinite(pr))return;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(right-26,y(pr));ctx.lineTo(right,y(pr));ctx.stroke();ctx.textAlign='right';ctx.fillText(label,right-30,y(pr)+3);};
  level('LCL',p.lclM,'#4ade80');level('LFC',p.lfcM,'#facc15');level('EL',p.elM,'#c084fc');
  ctx.textAlign='left';ctx.font='10px system-ui';
  [['T','#ff4d4d'],['Td','#3ddc64'],['Tw','#22d3ee'],['parcel','#f1f5f9']].reduce((at,[text,color])=>{ctx.fillStyle=color;ctx.fillText(text,at,top+12);return at+ctx.measureText(text).width+10;},left+70);
}

// A wind barb: the staff points to where the wind comes from; a pennant is 50 kt, a full barb 10, a half barb 5.
function drawBarb(ctx,bx,by,dir,spd){
 const d=dir*Math.PI/180,sx=Math.sin(d),sy=-Math.cos(d),px=Math.cos(d),py=Math.sin(d),length=22;
 ctx.save();ctx.strokeStyle='#cbd5e1';ctx.fillStyle='#cbd5e1';ctx.lineWidth=1.3;
 let kt=Math.round(spd/5)*5;
 if(kt<5){ctx.beginPath();ctx.arc(bx,by,3,0,Math.PI*2);ctx.stroke();ctx.restore();return;}
 ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+sx*length,by+sy*length);ctx.stroke();
 let at=length;
 for(;kt>=50;kt-=50,at-=6){ctx.beginPath();ctx.moveTo(bx+sx*at,by+sy*at);ctx.lineTo(bx+sx*(at-2.5)+px*8,by+sy*(at-2.5)+py*8);ctx.lineTo(bx+sx*(at-5),by+sy*(at-5));ctx.closePath();ctx.fill();}
 for(;kt>=10;kt-=10,at-=3.5){ctx.beginPath();ctx.moveTo(bx+sx*at,by+sy*at);ctx.lineTo(bx+sx*(at+2)+px*8,by+sy*(at+2)+py*8);ctx.stroke();}
 if(kt>=5){if(at===length)at-=3.5;ctx.beginPath();ctx.moveTo(bx+sx*at,by+sy*at);ctx.lineTo(bx+sx*(at+1)+px*4,by+sy*(at+1)+py*4);ctx.stroke();}
 ctx.restore();
}

// Hodograph: the wind from the ground to 12 km as one curve, coloured by height, zoomed to the
// curve itself. Rings are every 10 kt about calm. The shaded wedge is the air a right-moving
// storm draws in through the lowest kilometre: its area is the 0-1 km helicity.
const HODOGRAPH_BANDS=[[0,3000,'#ff4d4d','0-3 km'],[3000,6000,'#4ade80','3-6'],[6000,9000,'#facc15','6-9'],[9000,12000,'#22d3ee','9-12']];
export function drawHodograph(canvas, sounding){
 // Storm motion as the storm engine computes it, where the server supplies it; the sounding's own otherwise.
 const engine=sounding.engineMotion, p=sounding.params, profile=sounding.profile;
 const motion=engine?{right:engine.right,left:engine.left,mean:engine.ordinary}:{right:p.stormMotion.right,left:p.stormMotion.left,mean:p.meanWind};
 const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#05080d';ctx.fillRect(0,0,w,h);
 const ground=profile[0].heightM, top=Math.min(12000,profile.at(-1).heightM-ground), points=[];
 for(let z=0;z<=top+1;z+=250){const wind=windAtAgl(profile,z,ground);points.push({z,u:wind.u,v:wind.v});}
 // The view: everything drawn, with a margin, never zoomed in past a 70 kt span.
 const shown=[...points,motion.right,motion.left,motion.mean], margin=14;
 const uLow=Math.min(...shown.map(q=>q.u))-margin,uHigh=Math.max(...shown.map(q=>q.u))+margin,vLow=Math.min(...shown.map(q=>q.v))-margin,vHigh=Math.max(...shown.map(q=>q.v))+margin;
 const frame={left:14,right:w-14,top:14,bottom:h-46};
 const scale=Math.min((frame.right-frame.left)/Math.max(70,uHigh-uLow),(frame.bottom-frame.top)/Math.max(70,vHigh-vLow));
 const X=u=>(frame.left+frame.right)/2+(u-(uLow+uHigh)/2)*scale, Y=v=>(frame.top+frame.bottom)/2-(v-(vLow+vHigh)/2)*scale;
 ctx.save();ctx.beginPath();ctx.rect(frame.left,frame.top,frame.right-frame.left,frame.bottom-frame.top);ctx.clip();
 // Rings and axes about calm; ring speeds are labelled toward the middle of the view.
 const toward=Math.atan2((vLow+vHigh)/2,(uLow+uHigh)/2);
 ctx.font='10px system-ui';ctx.textAlign='center';
 for(let speed=10;speed<=220;speed+=10){
  ctx.strokeStyle=speed%20?'#1b2634':'#2a384a';ctx.lineWidth=1;ctx.beginPath();ctx.arc(X(0),Y(0),speed*scale,0,Math.PI*2);ctx.stroke();
  if(speed%20===0){ctx.fillStyle='#64748b';ctx.fillText(`${speed}`,X(speed*Math.cos(toward+0.5)),Y(speed*Math.sin(toward+0.5))+3);}
 }
 ctx.strokeStyle='#2a384a';ctx.beginPath();ctx.moveTo(X(0),frame.top);ctx.lineTo(X(0),frame.bottom);ctx.moveTo(frame.left,Y(0));ctx.lineTo(frame.right,Y(0));ctx.stroke();
 // Inflow through the lowest kilometre, relative to the right-moving storm.
 const lowest=points.filter(q=>q.z<=1000);
 if(lowest.length>1){
  ctx.fillStyle='rgba(34,211,238,.14)';ctx.beginPath();ctx.moveTo(X(motion.right.u),Y(motion.right.v));lowest.forEach(q=>ctx.lineTo(X(q.u),Y(q.v)));ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(34,211,238,.6)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X(lowest[0].u),Y(lowest[0].v));ctx.lineTo(X(motion.right.u),Y(motion.right.v));ctx.lineTo(X(lowest.at(-1).u),Y(lowest.at(-1).v));ctx.stroke();
 }
 ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';
 for(const [low,high,color] of HODOGRAPH_BANDS){const part=points.filter(q=>q.z>=low&&q.z<=high);if(part.length<2)continue;ctx.strokeStyle=color;ctx.beginPath();part.forEach((q,i)=>(i?ctx.lineTo(X(q.u),Y(q.v)):ctx.moveTo(X(q.u),Y(q.v))));ctx.stroke();}
 // A dot at each kilometre; the usual ones are numbered.
 ctx.font='bold 11px system-ui';ctx.textAlign='left';
 for(const q of points){if(q.z%1000)continue;const km=q.z/1000;ctx.fillStyle='#f8fafc';ctx.beginPath();ctx.arc(X(q.u),Y(q.v),[0,1,3,6,9,12].includes(km)?3.6:2,0,Math.PI*2);ctx.fill();if([0,1,3,6,9,12].includes(km))ctx.fillText(km?`${km}`:'SFC',X(q.u)+6,Y(q.v)-6);}
 const marker=(vector,label,color,square)=>{const mx=X(vector.u),my=Y(vector.v);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.8;ctx.beginPath();if(square)ctx.rect(mx-5,my-5,10,10);else{ctx.arc(mx,my,6,0,Math.PI*2);ctx.moveTo(mx-3,my);ctx.lineTo(mx+3,my);ctx.moveTo(mx,my-3);ctx.lineTo(mx,my+3);}ctx.stroke();ctx.fillText(label,mx+9,my+4);};
 marker(motion.right,'RM','#f8fafc');marker(motion.left,'LM','#94a3b8');marker(motion.mean,'MW','#c4b5fd',true);
 ctx.restore();
 ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.strokeRect(frame.left,frame.top,frame.right-frame.left,frame.bottom-frame.top);
 // Legend and the numbers the curve stands for.
 const from=vector=>`${String(vectorDirection(vector)).padStart(3,'0')}/${Math.round(Math.hypot(vector.u,vector.v))} kt`;
 ctx.font='11px system-ui';ctx.textAlign='left';
 HODOGRAPH_BANDS.reduce((at,[, , color,label])=>{ctx.fillStyle=color;ctx.fillText(label,at,h-28);return at+ctx.measureText(label).width+12;},frame.left);
 ctx.fillStyle='#cbd5e1';ctx.textAlign='right';ctx.fillText(`RM ${from(motion.right)}   LM ${from(motion.left)}   MW ${from(motion.mean)}`,frame.right,h-28);
 ctx.textAlign='left';ctx.fillStyle='#94a3b8';ctx.fillText(`Helicity 0-1 km ${Math.round(p.srh01)}  ·  0-3 km ${Math.round(p.srh03)} m²/s²  ·  critical angle ${Math.round(p.criticalAngle)}°  ·  rings every 10 kt`,frame.left,h-10);
}

function buildAnchors(cell,surfaceP,surfaceT,surfaceTd){
 const moistureDepth = clamp((surfaceTd+5)/28,0,1);
 const t850=cell.levels[850].temperature;
 // Stored moisture aloft when the state carries it; otherwise inferred from the surface.
 const td850=Math.min(t850,Number.isFinite(cell.levels[850].dewpoint)?cell.levels[850].dewpoint:surfaceTd-(3+7*(1-moistureDepth)));
 const t700=cell.levels[700].temperature;
 const td700=Math.min(t700,Number.isFinite(cell.levels[700].dewpoint)?cell.levels[700].dewpoint:t700-(5+14*(1-moistureDepth)));
 const t500=cell.levels[500].temperature;
 const t250=cell.levels[250].temperature;
 const anchors=[
  {p:surfaceP,t:surfaceT,td:surfaceTd,dir:cell.surface.wind.direction,spd:cell.surface.wind.speed,isSurface:true},
  {p:850,t:t850,td:td850,dir:cell.levels[850].windDirection,spd:cell.levels[850].windSpeed},
  {p:700,t:t700,td:td700,dir:cell.levels[700].windDirection,spd:cell.levels[700].windSpeed},
  {p:500,t:t500,td:Math.min(t500,t500-18-8*(1-moistureDepth)),dir:cell.levels[500].windDirection,spd:cell.levels[500].windSpeed},
  {p:250,t:t250,td:Math.min(t250,t250-28),dir:cell.levels[250].windDirection,spd:cell.levels[250].windSpeed},
  {p:100,t:-56,td:-76,dir:(cell.levels[250].windDirection+10)%360,spd:Math.max(55,cell.levels[250].windSpeed*.75)}
 ];
 // Elevated mixed layer: its base is a warm, dry inversion near 780 mb above the moist layer,
 // with a near dry-adiabatic lapse rate up to 700 mb. Interpolating straight from 850 to 700 mb
 // would miss the inversion that caps both surface parcels and the moist air below it.
 const eml=clamp(Number(cell.features?.emlInfluence)||0,0,1);
 if(eml>0.05&&surfaceP>800){
  const f=Math.log(850/780)/Math.log(850/700);
  // Warmth of the inversion base over 700 mb. The redesigned atmosphere supplies the value for
  // a layer mixed all the way down from 700 mb; the older scenarios keep their fitted one.
  const linear=t850+(t700-t850)*f, base=t700+(Number(cell.features?.emlBaseExcessC)||6.2);
  const t780=linear+Math.max(0,base-linear)*eml;
  const w850=uvFromDirSpeed(cell.levels[850].windDirection,cell.levels[850].windSpeed), w700=uvFromDirSpeed(cell.levels[700].windDirection,cell.levels[700].windSpeed);
  const u=w850.u+(w700.u-w850.u)*f, v=w850.v+(w700.v-w850.v)*f;
  anchors.push({p:780,t:t780,td:Math.min(td850,t780-(6+14*eml)),dir:(Math.atan2(-u,-v)*180/Math.PI+360)%360,spd:Math.hypot(u,v)});
 }
 return anchors.filter(a=>a.isSurface||a.p<surfaceP).sort((a,b)=>b.p-a.p);
}

function parcelDiagnosticsForSource(profile,index,elevation,envTv,work){
 const src=profile[index];
 return parcelDiagnosticsForState(profile,{p:src.p,t:src.t,td:src.td,index},elevation,envTv,work);
}
function mixedLayerSource(profile,depthHpa,work){
 const surfaceP=profile[0].p;
 let theta=0,w=0,n=0;
 for(let i=0;i<profile.length;i++){const r=profile[i];if(!(r.p>=surfaceP-depthHpa))continue;const e=Math.min(r.p*.99,work.vapour[i]);theta+=(r.t+273.15)*Math.pow(1000/r.p,RD/CP);w+=EPS*e/(r.p-e);n++}
 theta/=n;w/=n;
 const t=theta*Math.pow(surfaceP/1000,RD/CP)-273.15;
 const e=w*surfaceP/(EPS+w),td=dewpointFromVaporPressure(e);
 return {p:surfaceP,t,td,index:0};
}
function mostUnstableParcel(profile,elevation,depthHpa,envTv,surfaceResult,work){
 const surfaceP=profile[0].p;let bestIndex=-1,bestCape=0;
 // Every level in the layer is a candidate, but only its CAPE decides between them, so each
 // is lifted for its CAPE alone (parcelCape: the same arithmetic as the full diagnosis,
 // without building the parcel) and only the winner is diagnosed in full. The level-0
 // candidate is exactly the surface parcel; it is reused when already lifted.
 for(let i=0;i<profile.length;i++){
   const r=profile[i];if(r.p<surfaceP-depthHpa)continue;
   const cape=i===0&&surfaceResult?surfaceResult.thermo.cape:parcelCape(profile,r,i,envTv,work);
   if(bestIndex<0||cape>bestCape){bestIndex=i;bestCape=cape}
 }
 if(bestIndex<0)return surfaceResult||parcelDiagnosticsForSource(profile,0,elevation,envTv,work);
 const source=profile[bestIndex];
 const best=bestIndex===0&&surfaceResult?surfaceResult:parcelDiagnosticsForState(profile,{p:source.p,t:source.t,td:source.td,index:bestIndex},elevation,envTv,work);
 best.sourceIndex=bestIndex;
 return best;
}
// The CAPE diagnoseParcel gives for a parcel lifted from a level (buildParcelFromState), to
// the last digit: the same steps in the same order, keeping only what CAPE needs.
// source: the profile row the parcel starts from (its p, t and td); start: that row's index.
function parcelCape(profile,source,start,envTv,work){
 const last=profile.length-1,logP=work.logP,exner=work.exner;
 const tlclK=lclTemperatureK(source.t,source.td), theta=(source.t+273.15)*Math.pow(1000/source.p,RD/CP);
 const pLcl=source.p*Math.pow(tlclK/(source.t+273.15),CP/RD);
 const e0=Math.min(source.p*.99,work.vapour[start]), w0=EPS*e0/(source.p-e0);
 // Height of the condensation level, as heightAtPressure finds it in the profile from the source up.
 let lclM=profile[last].heightM;
 for(let i=start;i<last;i++){const a=profile[i],b=profile[i+1];if(pLcl<=a.p&&pLcl>=b.p){const f=(logP[i]-Math.log(pLcl))/(logP[i]-logP[i+1]);lclM=lerp(a.heightM,b.heightM,f);break}}
 let previousP=source.p,previousT=source.t,adiabat,cape=0,tvEnvB=0,tvParB=0,belowH=0;
 for(let i=start;i<=last;i++){
   const r=profile[i],p=r.p;let t,td;
   if(p>=pLcl){t=theta*exner[i]-273.15;const e=w0*p/(EPS+w0);td=Math.min(t,dewpointFromVaporPressure(e));}
   else {
     if(adiabat===undefined)adiabat=pseudoAdiabatThroughPoint(tlclK-273.15,pLcl);
     if(adiabat!==null)t=pseudoAdiabatTemperature(adiabat,p);
     else {if(previousP>pLcl){previousP=pLcl;previousT=tlclK-273.15}t=moistLift(previousT,previousP,p);}
     td=t;
   }
   previousP=p;previousT=t;
   const tvEnvA=tvEnvB,tvParA=tvParB,h=r.heightM;
   tvEnvB=envTv[i];
   tvParB=virtualTemperatureK(t,td,p);
   if(i!==start){
     const buoyA=G*(tvParA-tvEnvA)/tvEnvA,buoyB=G*(tvParB-tvEnvB)/tvEnvB;
     const dz=Math.max(0,h-belowH),area=.5*(buoyA+buoyB)*dz,midH=.5*(belowH+h);
     if(midH>=lclM&&area>0)cape+=area;
   }
   belowH=h;
 }
 return Math.max(0,cape);
}
function parcelDiagnosticsForState(profile,source,elevation,envTv=null,work=null){
 const parcel=buildParcelFromState(profile,source,work);
 const start=source.index||0;
 if(!start)return {parcel,thermo:diagnoseParcel(profile,parcel,elevation,source,envTv)};
 const env=profile.slice(start);
 const aligned=parcel.slice(start);
 return {parcel,thermo:diagnoseParcel(env,aligned,elevation,source,envTv?envTv.subarray(start):null)};
}
function buildParcelFromState(profile,source,work=null){
 const tlclK=lclTemperatureK(source.t,source.td), theta=(source.t+273.15)*Math.pow(1000/source.p,RD/CP);
 const pLcl=source.p*Math.pow(tlclK/(source.t+273.15),CP/RD);
 const w0=mixingRatioFromDewpoint(source.td,source.p);
 let previous={p:source.p,t:source.t}, adiabat;
 return profile.map((r,i)=>{
   if(i<(source.index||0)) return {p:r.p,heightM:r.heightM,t:r.t,td:r.td};
   let t,td;
   if(r.p>=pLcl){t=theta*(work?work.exner[i]:Math.pow(r.p/1000,RD/CP))-273.15;const e=w0*r.p/(EPS+w0);td=Math.min(t,dewpointFromVaporPressure(e));}
   else {
     if(adiabat===undefined)adiabat=pseudoAdiabatThroughPoint(tlclK-273.15,pLcl);
     if(adiabat!==null)t=pseudoAdiabatTemperature(adiabat,r.p);
     else {if(previous.p>pLcl)previous={p:pLcl,t:tlclK-273.15};t=moistLift(previous.t,previous.p,r.p);}
     td=t;
   }
   previous={p:r.p,t};return {p:r.p,heightM:r.heightM,t,td};
 });
}
function diagnoseParcel(env,parcel,elevation,source,envTv=null){
 const tlcl=lclTemperatureK(source.t,source.td), pLcl=source.p*Math.pow(tlcl/(source.t+273.15),CP/RD);
 const lclM=heightAtPressure(env,pLcl);
 let cape=0,cin=0,lfcM=NaN,elM=NaN,positive=false;
 // Each level's virtual temperature feeds two adjacent layers; carry it forward.
 let tvEnvB=env.length?(envTv?envTv[0]:virtualTemperatureK(env[0].t,env[0].td,env[0].p)):0;
 let tvParB=env.length?virtualTemperatureK(parcel[0].t,parcel[0].td,env[0].p):0;
 for(let i=0;i<env.length-1;i++){
   const a=env[i],b=env[i+1],pb=parcel[i+1];
   const tvEnvA=tvEnvB,tvParA=tvParB;
   tvEnvB=envTv?envTv[i+1]:virtualTemperatureK(b.t,b.td,b.p);
   tvParB=virtualTemperatureK(pb.t,pb.td,b.p);
   const buoyA=G*(tvParA-tvEnvA)/tvEnvA,buoyB=G*(tvParB-tvEnvB)/tvEnvB;
   const dz=Math.max(0,b.heightM-a.heightM),area=.5*(buoyA+buoyB)*dz,midH=.5*(a.heightM+b.heightM);
   // The equilibrium level is where the parcel last turns cold: buoyant again above a capping
   // layer, it has not reached it yet (until 2026-10-17 the first turn was kept, often at 2-3 km
   // under a cap with most of the CAPE above, and radar tops of strong storms sat there).
   if(midH>=lclM&&area>0){cape+=area;elM=NaN;if(!positive){lfcM=midH;positive=true}}
   else if(!positive&&area<0&&midH<=elevation+4000)cin+=area;
   if(positive&&area<0&&Number.isNaN(elM))elM=midH;
 }
 if(Number.isNaN(lfcM)){lfcM=NaN;elM=NaN;cape=0;}
 else if(Number.isNaN(elM))elM=env[env.length-1].heightM;
 return {cape:Math.max(0,cape),cin:Math.max(-500,Math.min(0,cin)),lclM,lfcM,elM,effectiveLayer:{bottomM:elevation,topM:Number.isFinite(elM)?Math.min(elM,elevation+6000):elevation}};
}

function diagnoseKinematics(profile,stormMotion,elevation,meanWind=meanWindLayer(profile,0,6000,elevation)){
 const wind=z=>windAtAgl(profile,z,elevation);
 const w0=wind(0),w1=wind(1000),w3=wind(3000),w6=wind(6000);
 const shear=(a,b)=>Math.hypot(b.u-a.u,b.v-a.v);
 const srh=top=>stormRelativeHelicity(profile,stormMotion.right,0,top,elevation);
 const inflow={u:w1.u-w0.u,v:w1.v-w0.v}, stormRel={u:stormMotion.right.u-w0.u,v:stormMotion.right.v-w0.v};
 const angle=Math.acos(clamp((inflow.u*stormRel.u+inflow.v*stormRel.v)/((Math.hypot(inflow.u,inflow.v)||1)*(Math.hypot(stormRel.u,stormRel.v)||1)),-1,1))*180/Math.PI;
 return {shear01:shear(w0,w1),shear03:shear(w0,w3),shear06:shear(w0,w6),srh01:srh(1000),srh03:srh(3000),meanWind,criticalAngle:angle};
}

function drawDryAdiabats(ctx,x,y,top,bottom){ctx.lineWidth=.7;ctx.strokeStyle='rgba(244,180,80,.22)';for(let theta=250;theta<=450;theta+=10){ctx.beginPath();let started=false;for(let p=1000;p>=100;p-=10){const t=theta*Math.pow(p/1000,RD/CP)-273.15,px=x(t,p),py=y(p);if(px<0||px>2000)continue;started?ctx.lineTo(px,py):ctx.moveTo(px,py);started=true}ctx.stroke();}}
function drawMoistAdiabats(ctx,x,y){ctx.lineWidth=.7;ctx.strokeStyle='rgba(90,190,255,.2)';for(let start=-10;start<=40;start+=10){ctx.beginPath();let t=start,prevP=1000;for(let p=1000,i=0;p>=100;p-=10,i++){if(p<1000)t=moistLift(t,prevP,p);const px=x(t,p),py=y(p);i?ctx.lineTo(px,py):ctx.moveTo(px,py);prevP=p}ctx.stroke();}}
function drawMixingRatio(ctx,x,y){ctx.lineWidth=.7;ctx.setLineDash([4,5]);ctx.strokeStyle='rgba(80,208,107,.18)';for(const grams of [.4,1,2,4,8,12,16,20]){ctx.beginPath();let started=false;for(let p=1000;p>=400;p-=10){const e=(grams/1000)*p/(EPS+grams/1000),td=dewpointFromVaporPressure(e),px=x(td,p),py=y(p);started?ctx.lineTo(px,py):ctx.moveTo(px,py);started=true}ctx.stroke()}ctx.setLineDash([]);}
function drawIsotherms(ctx,x,y){ctx.strokeStyle='rgba(150,160,175,.2)';ctx.lineWidth=.8;for(let t=-80;t<=50;t+=10){ctx.beginPath();ctx.moveTo(x(t,1000),y(1000));ctx.lineTo(x(t,100),y(100));ctx.stroke();}}
function drawPressureLines(ctx,y,left,right){ctx.strokeStyle='#2d3948';ctx.lineWidth=1;for(const p of [1000,900,800,700,600,500,400,300,250,200,150,100]){ctx.beginPath();ctx.moveTo(left,y(p));ctx.lineTo(right,y(p));ctx.stroke();}}
function drawCAPEAndCIN(ctx,s,x,y){for(let i=0;i<s.profile.length-1;i++){const e1=s.profile[i],e2=s.profile[i+1],p1=s.parcel[i],p2=s.parcel[i+1];const positive=(p1.t-e1.t+p2.t-e2.t)>0;ctx.fillStyle=positive?'rgba(239,68,68,.22)':'rgba(59,130,246,.18)';ctx.beginPath();ctx.moveTo(x(e1.t,e1.p),y(e1.p));ctx.lineTo(x(p1.t,p1.p),y(p1.p));ctx.lineTo(x(p2.t,p2.p),y(p2.p));ctx.lineTo(x(e2.t,e2.p),y(e2.p));ctx.closePath();ctx.fill();}}
function drawProfile(ctx,rows,key,color,width,x,y){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();rows.forEach((r,i)=>{const px=x(r[key],r.p),py=y(r.p);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke();}
function vectorDirection(vector){
 // The direction it comes from, as winds and storm motions are quoted.
 return Math.round((Math.atan2(-vector.u,-vector.v)*180/Math.PI+360)%360)%360;
}

function moistLift(tC,p1,p2){let t=tC+273.15,p=p1;const steps=Math.max(1,Math.ceil(Math.abs(p1-p2)/5)),dp=(p2-p1)/steps;for(let i=0;i<steps;i++){const next=p+dp,pm=.5*(p+next);t+=moistLapseRate(t,pm)*(next-p);p=next}return t-273.15;}
function moistLapseRate(tK,p){const ws=saturationMixingRatio(tK-273.15,p),lv=2.5e6-2360*(tK-273.15);return(RD*tK/p)*(1+lv*ws/(RD*tK))/(CP+lv*lv*ws*EPS/(RD*tK*tK));}

// Pseudo-adiabat lookup table: saturated-ascent temperature indexed by the curve's
// 1000-hPa temperature (wet-bulb potential temperature) and pressure. Lifting every
// parcel by numeric integration dominated simulation time; built once, then each
// parcel level is a bilinear lookup. Integrated with 1-hPa midpoint steps.
const PA_P_BOTTOM=1000, PA_P_TOP=100, PA_ROWS=PA_P_BOTTOM-PA_P_TOP+1;
const PA_THETA_MIN=-50, PA_THETA_STEP=0.25, PA_COLS=Math.round((45-PA_THETA_MIN)/PA_THETA_STEP)+1;
let pseudoAdiabatTable=null;
function buildPseudoAdiabatTable(){
 const table=new Float64Array(PA_COLS*PA_ROWS);
 for(let c=0;c<PA_COLS;c++){
   let t=PA_THETA_MIN+c*PA_THETA_STEP+273.15;
   table[c*PA_ROWS]=t-273.15;
   for(let r=1;r<PA_ROWS;r++){
     const p=PA_P_BOTTOM-(r-1),half=t+moistLapseRate(t,p)*-.5;
     t-=moistLapseRate(half,p-.5);
     table[c*PA_ROWS+r]=t-273.15;
   }
 }
 return table;
}
function pseudoAdiabatAt(column,row){
 const c0=Math.min(PA_COLS-2,Math.floor(column)),fc=column-c0,r0=Math.min(PA_ROWS-2,Math.floor(row)),fr=row-r0,T=pseudoAdiabatTable;
 const a=T[c0*PA_ROWS+r0],b=T[c0*PA_ROWS+r0+1],c=T[(c0+1)*PA_ROWS+r0],d=T[(c0+1)*PA_ROWS+r0+1];
 return (a+(b-a)*fr)*(1-fc)+(c+(d-c)*fr)*fc;
}
// Fractional table column of the pseudo-adiabat through (tC, p), or null if outside the table.
function pseudoAdiabatThroughPoint(tC,p){
 if(!(p<=PA_P_BOTTOM&&p>=PA_P_TOP))return null;
 pseudoAdiabatTable??=buildPseudoAdiabatTable();
 const row=PA_P_BOTTOM-p;
 let lo=0,hi=PA_COLS-1;
 if(!(tC>=pseudoAdiabatAt(lo,row)&&tC<=pseudoAdiabatAt(hi,row)))return null;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(pseudoAdiabatAt(mid,row)<=tC)lo=mid;else hi=mid;}
 const tLo=pseudoAdiabatAt(lo,row),tHi=pseudoAdiabatAt(hi,row);
 return lo+(tHi>tLo?(tC-tLo)/(tHi-tLo):0);
}
function pseudoAdiabatTemperature(column,p){return pseudoAdiabatAt(column,Math.max(0,Math.min(PA_ROWS-1,PA_P_BOTTOM-p)));}
function lclTemperatureK(tC,tdC){const t=tC+273.15,td=tdC+273.15;return 1/(1/(td-56)+Math.log(t/td)/800)+56;}
function saturationVaporPressure(tC){return 6.112*Math.exp(17.67*tC/(tC+243.5));}
function saturationMixingRatio(tC,p){const e=Math.min(p*.99,saturationVaporPressure(tC));return EPS*e/(p-e);}
function vaporPressureFromDewpoint(tdC){return saturationVaporPressure(tdC);}
function dewpointFromVaporPressure(e){const l=Math.log(e/6.112);return 243.5*l/(17.67-l);}
function relativeHumidity(t,td){return clamp(100*saturationVaporPressure(td)/saturationVaporPressure(t),0,100);}
function virtualTemperatureK(t,td,p){const e=vaporPressureFromDewpoint(td),w=EPS*e/(p-e);return(t+273.15)*(1+.61*w);}
// vapour: each row's vapour pressure (saturationVaporPressure of its dewpoint).
function precipitableWater(rows,vapour){let total=0,qb=0;for(let i=0;i<rows.length;i++){const p=rows[i].p,e=vapour[i],w=EPS*e/(p-e),qa=qb;qb=w/(1+w);if(i)total+=.5*(qa+qb)*(rows[i-1].p-p)*100/G}return total/25.4;}
function mixingRatioFromDewpoint(td,p){const e=Math.min(p*.99,vaporPressureFromDewpoint(td));return EPS*e/(p-e);}
function specificHumidity(td,p){const e=vaporPressureFromDewpoint(td),w=EPS*e/(p-e);return w/(1+w);}
function wetBulbApprox(t,rh){return t*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+.00391838*Math.pow(rh,1.5)*Math.atan(.023101*rh)-4.686035;}
// The height where the wet-bulb temperature crosses a value (interpolateHeightForTemp on the
// wet-bulb temperatures, worked out level by level as the search goes up).
function interpolateHeightForWetBulb(rows,target){if(!rows.length)return NaN;let b=wetBulbApprox(rows[0].t,rows[0].rh);for(let i=0;i<rows.length-1;i++){const a=b;b=wetBulbApprox(rows[i+1].t,rows[i+1].rh);if((a-target)*(b-target)<=0&&b!==a){const f=(target-a)/(b-a);return lerp(rows[i].heightM,rows[i+1].heightM,f)}}return NaN}
// The profile at a pressure, between the anchors either side of it. logP: the pressure's
// logarithm; each anchor carries its own, and the sine and cosine of its wind direction.
function interpolateAnchorAt(a,p,logP){let lo=a[a.length-1],hi=a[0];for(let i=0;i<a.length-1;i++){if(p<=a[i].p&&p>=a[i+1].p){hi=a[i];lo=a[i+1];break}}const f=(hi.logP-logP)/(hi.logP-lo.logP),t=lerp(hi.t,lo.t,f);return{p,t,td:Math.min(lerp(hi.td,lo.td,f),t),dir:(Math.atan2((1-f)*hi.sin+f*lo.sin,(1-f)*hi.cos+f*lo.cos)*180/Math.PI+360)%360,spd:lerp(hi.spd,lo.spd,f)}}
function pressureToHeight(p,elev,surfaceP,surfaceT){const tv=surfaceT+273.15;return elev+(RD*tv/G)*Math.log(surfaceP/p);}
function interpolateHeightForTemp(rows,target){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if((a.t-target)*(b.t-target)<=0&&b.t!==a.t){const f=(target-a.t)/(b.t-a.t);return lerp(a.heightM,b.heightM,f)}}return NaN}
function heightAtPressure(rows,p){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(p<=a.p&&p>=b.p){const f=(Math.log(a.p)-Math.log(p))/(Math.log(a.p)-Math.log(b.p));return lerp(a.heightM,b.heightM,f)}}return rows[rows.length-1].heightM}
function pressureAtHeight(rows,z){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(z>=a.heightM&&z<=b.heightM){const f=(z-a.heightM)/(b.heightM-a.heightM);return Math.exp(lerp(Math.log(a.p),Math.log(b.p),f))}}return NaN}
function temperatureAtPressure(rows,p){return interpolatePressureValue(rows,p,'t')}
function parcelTemperatureAtPressure(rows,p){return interpolatePressureValue(rows,p,'t')}
function interpolatePressureValue(rows,p,key){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(p<=a.p&&p>=b.p){const f=(Math.log(a.p)-Math.log(p))/(Math.log(a.p)-Math.log(b.p));return lerp(a[key],b[key],f)}}return rows[rows.length-1][key]}
function bunkers(rows,elevation,mean=meanWindLayer(rows,0,6000,elevation)){const low=windAtAgl(rows,0,elevation),upper=windAtAgl(rows,6000,elevation),du=upper.u-low.u,dv=upper.v-low.v,mag=Math.hypot(du,dv)||1,dev=7.5/KNOT_TO_MS;return{right:{u:mean.u+dv/mag*dev,v:mean.v-du/mag*dev},left:{u:mean.u-dv/mag*dev,v:mean.v+du/mag*dev}}}
function windAtAgl(rows,z,elev){const target=elev+z;for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(target>=a.heightM&&target<=b.heightM){const f=(target-a.heightM)/(b.heightM-a.heightM);return{u:lerp(a.u,b.u,f),v:lerp(a.v,b.v,f)}}}return rows[rows.length-1]}
function meanWindLayer(rows,bottom,top,elev){let u=0,v=0,n=0;for(let z=bottom;z<=top;z+=250){const w=windAtAgl(rows,z,elev);u+=w.u;v+=w.v;n++}return{u:u/n,v:v/n}}
function stormRelativeHelicity(rows,storm,bottom,top,elev){let sum=0,prev=windAtAgl(rows,bottom,elev);for(let z=bottom+250;z<=top;z+=250){const cur=windAtAgl(rows,z,elev);sum+=(cur.u-storm.u)*(prev.v-storm.v)-(prev.u-storm.u)*(cur.v-storm.v);prev=cur}return Math.abs(sum)*KNOT_TO_MS*KNOT_TO_MS}
function agl(r,rows){return r.heightM-rows[0].heightM}
function nearestAgl(rows,z,all){return rows.reduce((a,b)=>Math.abs(agl(b,all)-z)<Math.abs(agl(a,all)-z)?b:a)}
function interpolatedLayer(rows,lo,hi,all){return rows.filter(r=>agl(r,all)>=lo&&agl(r,all)<=hi)}
function uvFromDirSpeed(dir,spd){const r=dir*Math.PI/180;return{u:-Math.sin(r)*spd,v:-Math.cos(r)*spd}}
function blendDir(a,b,t){const ar=a*Math.PI/180,br=b*Math.PI/180;return(Math.atan2((1-t)*Math.sin(ar)+t*Math.sin(br),(1-t)*Math.cos(ar)+t*Math.cos(br))*180/Math.PI+360)%360}
function lerp(a,b,t){return a+(b-a)*t}function fToC(f){return(f-32)*5/9}function clamp(v,a,b){return Math.max(a,Math.min(b,v))}

// --- For the sounding display only (computed when a sounding is asked for, not for every cell).
// Positive area of a parcel below a height above the ground (J/kg).
function capeBelow(profile,parcel,elevation,topAglM){
 let total=0;
 for(let i=0;i<profile.length-1;i++){
  const a=profile[i],b=profile[i+1];if(a.heightM>=elevation+topAglM)break;
  const tvA=virtualTemperatureK(a.t,a.td,a.p),tvB=virtualTemperatureK(b.t,b.td,b.p);
  const buoyA=G*(virtualTemperatureK(parcel[i].t,parcel[i].td,a.p)-tvA)/tvA,buoyB=G*(virtualTemperatureK(parcel[i+1].t,parcel[i+1].td,b.p)-tvB)/tvB;
  const area=.5*(buoyA+buoyB)*(Math.min(b.heightM,elevation+topAglM)-a.heightM);
  if(area>0)total+=area;
 }
 return total;
}

// Extra numbers for the tables beside a sounding, and its possible hazard type: the label a
// SHARPpy-style sounding carries (PDS TOR, TOR, MRGL TOR, SVR, MRGL SVR or NONE). The label is
// read off the sounding's own indices by the decision ladder those soundings use; it is a
// forecaster's shorthand for the profile, not a statement of what the simulation will do.
// Where that ladder uses effective-layer quantities this uses the fixed-layer ones the
// sounding has (the tornado parameter, and 0-3 km helicity for effective helicity).
export function diagnoseSoundingDisplay(sounding,elevationM){
 const profile=sounding.profile,p=sounding.params,surfaceP=profile[0].p;
 const wind=z=>windAtAgl(profile,z,elevationM), mean=(low,high)=>meanWindLayer(profile,low,high,elevationM);
 const w0=wind(0),w8=wind(8000),rm=p.stormMotion.right,mw46=mean(4000,6000),mw135=mean(1000,3500);
 const shear08=Math.hypot(w8.u-w0.u,w8.v-w0.v), srw46=Math.hypot(mw46.u-rm.u,mw46.v-rm.v);
 const humidity=(low,high)=>{const rows=profile.filter(r=>r.p<=surfaceP-low&&r.p>=surfaceP-high);return rows.length?rows.reduce((sum,r)=>sum+r.rh,0)/rows.length:0;};
 const lowRh=humidity(0,150),midRh=humidity(150,350);
 const cape03=capeBelow(profile,sounding.parcel,elevationM,3000);
 const lapse36=layerLapseRateByHeight(profile,elevationM,3000,6000);
 const freezingAglM=p.freezingM-elevationM, wetBulbZeroAglM=p.wetBulbZeroM-elevationM;
 // Significant hail parameter.
 let ship=p.mucape*clamp(p.muMixingRatioGkg??12,11,13.6)*p.lapseRate700500*-Math.min(temperatureAtPressure(profile,500),-5.5)*clamp(p.shear06*KNOT_TO_MS,7,27)/42000000;
 if(p.mucape<1300)ship*=p.mucape/1300;
 if(p.lapseRate700500<5.8)ship*=p.lapseRate700500/5.8;
 if(Number.isFinite(freezingAglM)&&freezingAglM<2400)ship*=Math.max(0,freezingAglM)/2400;
 // Wind damage parameter.
 const windDamage=(p.mlcape/2000)*((p.lapseRate03km<7?0:p.lapseRate03km)/9)*(Math.hypot(mw135.u,mw135.v)*KNOT_TO_MS/15)*((50+Math.max(p.mlcin,-50))/40);

 const stp=p.stp,scp=p.scp,mlcin=p.mlcin,mucin=p.mucin,lcl=p.lclAglM,lapse01=p.lapseRate01km;
 // Surface-based inflow: a parcel from the ground with usable CAPE and not too much inhibition.
 const surfaceBased=p.sbcape>=100&&p.sbcin>=-250;
 let hazardType='NONE';
 if(surfaceBased&&stp>=3&&p.srh01>=200&&p.srh03>=200&&srw46>=15&&shear08>45&&lcl<1000&&lapse01>=5&&mlcin>=-50)hazardType='PDS TOR';
 else if(surfaceBased&&stp>=3&&mlcin>-125)hazardType='TOR';
 else if(surfaceBased&&stp>=1&&(srw46>=15||shear08>=40)&&mlcin>=-50)hazardType='TOR';
 else if(surfaceBased&&stp>=1&&(lowRh+midRh)/2>=60&&lapse01>=5&&mlcin>-50)hazardType='TOR';
 else if(surfaceBased&&stp>=1&&mlcin>-150)hazardType='MRGL TOR';
 else if(surfaceBased&&stp>=0.5&&p.srh01>=150&&mlcin>=-50)hazardType='MRGL TOR';
 else if((stp>=1||scp>=4)&&mucin>=-50)hazardType='SVR';
 else if(scp>=2&&(ship>=1||p.dcape>=750)&&mucin>=-50)hazardType='SVR';
 else if(mucin>=-75&&(windDamage>=0.5||ship>=0.5||scp>=0.5))hazardType='MRGL SVR';
 return {hazardType,ship,windDamage,cape03,lapse36,shear08,srw46,lowRh,midRh,freezingAglM,wetBulbZeroAglM,
  meanWind06:p.meanWind, stormMotion:p.stormMotion};
}
