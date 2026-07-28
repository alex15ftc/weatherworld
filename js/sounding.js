const LEVELS = [1000,975,950,925,900,875,850,825,800,775,750,725,700,675,650,625,600,575,550,525,500,475,450,425,400,375,350,325,300,275,250,225,200,175,150,125,100];
const RD=287.05, RV=461.5, CP=1004, G=9.80665, EPS=RD/RV, KNOT_TO_MS=.514444;

export function buildSounding(cell) {
  const surfaceP = Math.min(1000, cell.surface.pressure);
  const surfaceT = fToC(cell.surface.temperature);
  const surfaceTd = Math.min(surfaceT, fToC(cell.surface.dewpoint));
  const anchors = buildAnchors(cell,surfaceP,surfaceT,surfaceTd);
  const soundingLevels = [surfaceP, ...LEVELS.filter(p=>p<surfaceP)];
  const profile = soundingLevels.map(p=>interpolateAnchor(anchors,p));
  profile.forEach(row=>{
    row.heightM = pressureToHeight(row.p, cell.terrain.elevationM, surfaceP, surfaceT);
    const uv=uvFromDirSpeed(row.dir,row.spd); row.u=uv.u; row.v=uv.v;
    row.rh = relativeHumidity(row.t,row.td);
  });

  const surfaceResult = parcelDiagnosticsForSource(profile, 0, cell.terrain.elevationM);
  const mixedSource = mixedLayerSource(profile, 100);
  const mixedResult = parcelDiagnosticsForState(profile, mixedSource, cell.terrain.elevationM);
  const muResult = mostUnstableParcel(profile, cell.terrain.elevationM, 300);
  const stormMotion = bunkers(profile,cell.terrain.elevationM);
  const kinematics = diagnoseKinematics(profile,stormMotion,cell.terrain.elevationM);
  const pw = precipitableWater(profile);
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
  // Simulator STP includes the background pattern's ability to maintain the
  // local ingredient overlap, but never lets synoptic support manufacture STP.
  const stp=clamp(rawStp*(0.70+0.30*synopticSupport),0,15);
  const vtp=diagnoseViolentTornadoParameter({stp,rawStp,synopticSupport,cape:mixedResult.thermo.cape,srh:kinematics.srh01,shear:kinematics.shear06,lcl:mixedResult.thermo.lclM,cin:Math.abs(mixedResult.thermo.cin),criticalAngle:kinematics.criticalAngle});
  const scp=clamp((muResult.thermo.cape/1000)*(kinematics.srh03/100)*clamp(kinematics.shear06/40,0,1.5),0,35);
  const lapseRate01km=layerLapseRateByHeight(profile,cell.terrain.elevationM,0,1000);
  const lapseRate03km=layerLapseRateByHeight(profile,cell.terrain.elevationM,0,3000);
  const lapseRate700500=layerLapseRate(profile,700,500);
  const lapseRate850500=layerLapseRate(profile,850,500);
  const dcape=estimateDcape(profile, surfaceP, surfaceT, surfaceTd, pw, lapseRate700500);
  const params={
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
    stpComponents:{capeTerm,srhTerm,shearTerm,lclTerm,cinTerm,rawStp,synopticAdjustment:(0.70+0.30*synopticSupport),adjustedStp:stp,lclAglM:mixedLclAgl,surfaceRooted}
  };
  return { profile, parcel:mixedResult.parcel, params };
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
    profile:sounding.profile, parcel:sounding.parcel,
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
  const surfaceDepressionF=Math.max(0,cell.surface.temperature-cell.surface.dewpoint);
  const lowLevelDryness=clamp(surfaceDepressionF/28,0,1.4);
  const lapseSupport=clamp((Math.abs((cell.levels?.[700]?.temperature??8)-(cell.levels?.[500]?.temperature??-16))-18)/16,0,1.4);
  cell.derived.dcape=clamp(180 + 520*lowLevelDryness + 360*lapseSupport + 0.06*p.mlcape,100,1600);
  cell.derived.sounding={sbcape:p.sbcape,mlcape:p.mlcape,mucape:p.mucape,sbcin:p.sbcin,mlcin:p.mlcin,mucin:p.mucin,lclM:p.lclM,lclAglM:cell.derived.lclAgl,lfcM:p.lfcM,elM:p.elM,shear01:p.shear01,shear03:p.shear03,shear06:p.shear06,srh01:p.srh01,srh03:p.srh03,lapseRate01km:p.lapseRate01km,lapseRate03km:p.lapseRate03km,lapseRate700500:p.lapseRate700500,lapseRate850500:p.lapseRate850500,stpComponents:{...p.stpComponents}};
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
function layerLapseRate(profile, lowerP, upperP){
  const lower=interpolateProfileAtPressure(profile,lowerP);
  const upper=interpolateProfileAtPressure(profile,upperP);
  const dz=Math.max(500,(upper.heightM??0)-(lower.heightM??0));
  return clamp(((lower.t-upper.t)/(dz/1000)),3,10.5);
}
function interpolateProfileAtPressure(profile,p){
  for(let i=0;i<profile.length-1;i++){const a=profile[i],b=profile[i+1];if(a.p>=p&&b.p<=p){const f=(a.p-p)/Math.max(1e-6,a.p-b.p);return {t:a.t+(b.t-a.t)*f,td:a.td+(b.td-a.td)*f,heightM:a.heightM+(b.heightM-a.heightM)*f};}}
  return profile.at(-1);
}
function estimateDcape(profile,surfaceP,surfaceT,surfaceTd,pw,lapse){
  const mid=interpolateProfileAtPressure(profile,700);
  const depression=Math.max(0,mid.t-mid.td);
  const subcloud=Math.max(0,surfaceT-surfaceTd);
  const dryAir=clamp(depression/24,0,1.4);
  const lapseTerm=clamp((lapse-5.5)/3.5,0,1.4);
  const subcloudTerm=clamp(subcloud/18,0,1.2);
  const moisturePenalty=clamp((pw-1.75)/1.25,0,0.65);
  return clamp(250+900*dryAir+700*lapseTerm+450*subcloudTerm-500*moisturePenalty,0,2200);
}

export function diagnoseSynopticTornadoSupport(cell) {
  const ascent=clamp(cell.features?.synopticAscent ?? cell.mesoscaleFields?.ascent ?? 0,0,1);
  const coherence=clamp(cell.features?.synopticCoherence ?? 0.75,0,1);
  const pooling=clamp(cell.mesoscaleFields?.moisturePooling ?? 0,0,1);
  const erosion=clamp(cell.mesoscaleFields?.capErosion ?? 0,0,1);
  const warmSector=cell.features?.warmSector ? 1 : clamp(cell.forecast?.openWarmSectorSupport ?? 0,0,1);
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

export function drawSounding(canvas, sounding) {
  const ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#0b1119';ctx.fillRect(0,0,w,h);
  const left=58,right=w-58,top=28,bottom=h-45;
  const y=p=>bottom-(Math.log(1000)-Math.log(p))/(Math.log(1000)-Math.log(100))*(bottom-top);
  const x=(t,p)=>left+((t+50)+0.035*(1000-p))/100*(right-left);
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  drawDryAdiabats(ctx,x,y,top,bottom);
  drawMoistAdiabats(ctx,x,y,top,bottom);
  drawMixingRatio(ctx,x,y,top,bottom);
  drawCAPEAndCIN(ctx,sounding,x,y);
  drawIsotherms(ctx,x,y,top,bottom);
  drawPressureLines(ctx,y,left,right);
  drawProfile(ctx,sounding.profile,'t','#ff6464',2.7,x,y);
  drawProfile(ctx,sounding.profile,'td','#50d06b',2.7,x,y);
  drawProfile(ctx,sounding.parcel,'t','#ffd65a',2.2,x,y);
  ctx.restore();

  ctx.font='11px system-ui';ctx.textAlign='right';ctx.fillStyle='#9eacbb';
  for(const p of [1000,900,800,700,600,500,400,300,250,200,150,100]) ctx.fillText(p,left-8,y(p)+4);
  ctx.textAlign='center';for(let t=-50;t<=50;t+=10) ctx.fillText(`${t}`,x(t,1000),bottom+18);
  ctx.textAlign='left';ctx.fillStyle='#ffd65a';ctx.fillText('Parcel',left,16);ctx.fillStyle='#ff6464';ctx.fillText('Temperature',right-160,16);ctx.fillStyle='#50d06b';ctx.fillText('Dewpoint',right-78,16);
  ctx.fillStyle='#9eacbb';ctx.fillText('hPa',8,top+4);ctx.fillText('°C',right+17,bottom+18);
  drawLevelMarker(ctx,'LCL',sounding.params.lclM,sounding.profile,y,left,right,'#a78bfa');
  drawLevelMarker(ctx,'LFC',sounding.params.lfcM,sounding.profile,y,left,right,'#5eead4');
  drawLevelMarker(ctx,'EL',sounding.params.elM,sounding.profile,y,left,right,'#fbbf24');
}

export function drawHodograph(canvas, sounding){
 const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,scale=Math.min(w,h)/190;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#0b1119';ctx.fillRect(0,0,w,h);
 ctx.strokeStyle='#2d3948';ctx.fillStyle='#93a2b2';ctx.font='10px system-ui';
 for(const s of [20,40,60,80]){ctx.beginPath();ctx.arc(cx,cy,s*scale,0,Math.PI*2);ctx.stroke();ctx.fillText(`${s}`,cx+s*scale+3,cy-3)}
 ctx.beginPath();ctx.moveTo(cx,10);ctx.lineTo(cx,h-10);ctx.moveTo(10,cy);ctx.lineTo(w-10,cy);ctx.stroke();
 const rows=sounding.profile.filter(r=>agl(r,sounding.profile)<=12000).sort((a,b)=>a.heightM-b.heightM);
 const bands=[[0,1000,'#50d06b'],[1000,3000,'#60a5fa'],[3000,6000,'#c084fc'],[6000,9000,'#fb7185'],[9000,12001,'#fbbf24']];
 for(const [lo,hi,color] of bands){const seg=interpolatedLayer(rows,lo,hi,sounding.profile);if(seg.length<2)continue;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();seg.forEach((r,i)=>{const px=cx+r.u*scale,py=cy-r.v*scale;i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke();}
 ctx.fillStyle='#fff';[0,1000,3000,6000,9000,12000].forEach(z=>{const r=nearestAgl(rows,z,sounding.profile);ctx.beginPath();ctx.arc(cx+r.u*scale,cy-r.v*scale,3,0,Math.PI*2);ctx.fill();ctx.fillText(`${z/1000}`,cx+r.u*scale+5,cy-r.v*scale-5)});
 drawVector(ctx,cx,cy,scale,sounding.params.stormMotion.right,'RM','#ffd65a');
 drawVector(ctx,cx,cy,scale,sounding.params.stormMotion.left,'LM','#f59e0b');
 drawVector(ctx,cx,cy,scale,sounding.params.meanWind,'MW','#e5e7eb');
 drawMotionLegend(ctx, sounding.params, 10, 14);
 drawOverallMotionBadge(ctx, sounding.params.stormMotion.right, w-118, 14);
 ctx.fillStyle='#93a2b2';ctx.textAlign='left';ctx.fillText('kt',w-22,h-12);
}

function buildAnchors(cell,surfaceP,surfaceT,surfaceTd){
 const moistureDepth = clamp((surfaceTd+5)/28,0,1);
 const capStrength = clamp((cell.levels[700].temperature + 2) / 14,0,1);
 const t850=cell.levels[850].temperature + capStrength*1.2;
 const td850=Math.min(t850,surfaceTd-(3+7*(1-moistureDepth)));
 const t700=cell.levels[700].temperature;
 const td700=Math.min(t700,t700-(5+14*(1-moistureDepth)));
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
 return anchors.filter(a=>a.isSurface||a.p<surfaceP).sort((a,b)=>b.p-a.p);
}

function parcelDiagnosticsForSource(profile,index,elevation){
 const src=profile[index];
 return parcelDiagnosticsForState(profile,{p:src.p,t:src.t,td:src.td,index},elevation);
}
function mixedLayerSource(profile,depthHpa){
 const surfaceP=profile[0].p, rows=profile.filter(r=>r.p>=surfaceP-depthHpa);
 let theta=0,w=0;
 for(const r of rows){theta+=(r.t+273.15)*Math.pow(1000/r.p,RD/CP);w+=mixingRatioFromDewpoint(r.td,r.p)}
 theta/=rows.length;w/=rows.length;
 const t=theta*Math.pow(surfaceP/1000,RD/CP)-273.15;
 const e=w*surfaceP/(EPS+w),td=dewpointFromVaporPressure(e);
 return {p:surfaceP,t,td,index:0};
}
function mostUnstableParcel(profile,elevation,depthHpa){
 const surfaceP=profile[0].p;let best=null;
 profile.forEach((r,i)=>{if(r.p<surfaceP-depthHpa)return;const result=parcelDiagnosticsForState(profile,{p:r.p,t:r.t,td:r.td,index:i},elevation);if(!best||result.thermo.cape>best.thermo.cape)best=result});
 return best||parcelDiagnosticsForSource(profile,0,elevation);
}
function parcelDiagnosticsForState(profile,source,elevation){
 const parcel=buildParcelFromState(profile,source);
 const env=profile.slice(source.index||0);
 const aligned=parcel.slice(source.index||0);
 return {parcel,thermo:diagnoseParcel(env,aligned,elevation,source)};
}
function buildParcelFromState(profile,source){
 const tlclK=lclTemperatureK(source.t,source.td), theta=(source.t+273.15)*Math.pow(1000/source.p,RD/CP);
 const pLcl=source.p*Math.pow(tlclK/(source.t+273.15),CP/RD);
 const w0=mixingRatioFromDewpoint(source.td,source.p);
 let previous={p:source.p,t:source.t};
 return profile.map((r,i)=>{
   if(i<(source.index||0)) return {p:r.p,heightM:r.heightM,t:r.t,td:r.td};
   let t,td;
   if(r.p>=pLcl){t=theta*Math.pow(r.p/1000,RD/CP)-273.15;const e=w0*r.p/(EPS+w0);td=Math.min(t,dewpointFromVaporPressure(e));}
   else {if(previous.p>pLcl)previous={p:pLcl,t:tlclK-273.15};t=moistLift(previous.t,previous.p,r.p);td=t;}
   previous={p:r.p,t};return {p:r.p,heightM:r.heightM,t,td};
 });
}
function diagnoseParcel(env,parcel,elevation,source){
 const tlcl=lclTemperatureK(source.t,source.td), pLcl=source.p*Math.pow(tlcl/(source.t+273.15),CP/RD);
 const lclM=heightAtPressure(env,pLcl);
 let cape=0,cin=0,lfcM=NaN,elM=NaN,positive=false;
 for(let i=0;i<env.length-1;i++){
   const a=env[i],b=env[i+1],pa=parcel[i],pb=parcel[i+1];
   const tvEnvA=virtualTemperatureK(a.t,a.td,a.p),tvEnvB=virtualTemperatureK(b.t,b.td,b.p);
   const tvParA=virtualTemperatureK(pa.t,pa.td,a.p),tvParB=virtualTemperatureK(pb.t,pb.td,b.p);
   const buoyA=G*(tvParA-tvEnvA)/tvEnvA,buoyB=G*(tvParB-tvEnvB)/tvEnvB;
   const dz=Math.max(0,b.heightM-a.heightM),area=.5*(buoyA+buoyB)*dz,midH=.5*(a.heightM+b.heightM);
   if(midH>=lclM&&area>0){cape+=area;if(!positive){lfcM=midH;positive=true}}
   else if(!positive&&area<0&&midH<=elevation+4000)cin+=area;
   if(positive&&area<0&&Number.isNaN(elM))elM=midH;
 }
 if(Number.isNaN(lfcM)){lfcM=NaN;elM=NaN;cape=0;}
 else if(Number.isNaN(elM))elM=env[env.length-1].heightM;
 return {cape:Math.max(0,cape),cin:Math.max(-500,Math.min(0,cin)),lclM,lfcM,elM,effectiveLayer:{bottomM:elevation,topM:Number.isFinite(elM)?Math.min(elM,elevation+6000):elevation}};
}

function diagnoseKinematics(profile,stormMotion,elevation){
 const wind=z=>windAtAgl(profile,z,elevation);
 const w0=wind(0),w1=wind(1000),w3=wind(3000),w6=wind(6000);
 const shear=(a,b)=>Math.hypot(b.u-a.u,b.v-a.v);
 const srh=top=>stormRelativeHelicity(profile,stormMotion.right,0,top,elevation);
 const meanWind=meanWindLayer(profile,0,6000,elevation);
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
function drawLevelMarker(ctx,label,height,profile,y,left,right,color){if(!Number.isFinite(height))return;const p=pressureAtHeight(profile,height);if(!Number.isFinite(p))return;ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(left,y(p));ctx.lineTo(right,y(p));ctx.stroke();ctx.setLineDash([]);ctx.font='10px system-ui';ctx.textAlign='right';ctx.fillText(label,right-3,y(p)-3);ctx.restore();}
function drawVector(ctx,cx,cy,scale,v,label,color){
 ctx.save();
 ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.5;
 ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+v.u*scale,cy-v.v*scale);ctx.stroke();
 ctx.beginPath();ctx.arc(cx+v.u*scale,cy-v.v*scale,5,0,Math.PI*2);ctx.fill();
 ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillText(label,cx+v.u*scale+7,cy-v.v*scale);
 ctx.restore();
}

function drawOverallMotionBadge(ctx,vector,x,y){
 const speedKt=Math.hypot(vector.u,vector.v);
 const speedMph=Math.round(speedKt*1.15078);
 const direction=vectorDirection(vector);
 const toward=Math.atan2(vector.v,vector.u);
 const iconX=x+13, iconY=y+12;
 ctx.save();
 ctx.fillStyle='rgba(11,17,25,.86)';ctx.strokeStyle='#4b5b6d';ctx.lineWidth=1;
 ctx.beginPath();ctx.roundRect(x,y,108,42,7);ctx.fill();ctx.stroke();
 ctx.translate(iconX,iconY);ctx.rotate(-toward);
 ctx.strokeStyle='#ffd65a';ctx.fillStyle='#ffd65a';ctx.lineWidth=2;
 ctx.beginPath();ctx.moveTo(-8,0);ctx.lineTo(8,0);ctx.stroke();
 ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(2,-4);ctx.lineTo(2,4);ctx.closePath();ctx.fill();
 ctx.restore();
 ctx.save();ctx.font='10px system-ui';ctx.textAlign='left';
 ctx.fillStyle='#93a2b2';ctx.fillText('STORM MOTION',x+28,y+12);
 ctx.fillStyle='#ffd65a';ctx.font='bold 12px system-ui';
 ctx.fillText(`${String(direction).padStart(3,'0')}°  ${speedMph} mph`,x+28,y+29);
 ctx.restore();
}

function drawMotionLegend(ctx,params,x,y){
 const entries=[
  ['RM',params.stormMotion.right,'#ffd65a'],
  ['LM',params.stormMotion.left,'#f59e0b'],
  ['MW',params.meanWind,'#e5e7eb']
 ];
 ctx.save();ctx.font='10px system-ui';ctx.textAlign='left';
 for(let i=0;i<entries.length;i++){
  const [label,vector,color]=entries[i];
  const speed=Math.round(Math.hypot(vector.u,vector.v));
  const direction=vectorDirection(vector);
  ctx.fillStyle=color;ctx.fillText(`${label} ${String(direction).padStart(3,'0')}° / ${speed} kt`,x,y+i*13);
 }
 ctx.restore();
}

function vectorDirection(vector){
 const toward=Math.atan2(vector.u,-vector.v)*180/Math.PI;
 return Math.round((toward+180+360)%360)%360;
}

function moistLift(tC,p1,p2){let t=tC+273.15,p=p1;const steps=Math.max(1,Math.ceil(Math.abs(p1-p2)/5)),dp=(p2-p1)/steps;for(let i=0;i<steps;i++){const next=p+dp,pm=.5*(p+next),ws=saturationMixingRatio(t-273.15,pm),lv=2.5e6-2360*(t-273.15);const gamma=(RD*t/pm)*(1+lv*ws/(RD*t))/(CP+lv*lv*ws*EPS/(RD*t*t));t+=gamma*(next-p);p=next}return t-273.15;}
function lclTemperatureK(tC,tdC){const t=tC+273.15,td=tdC+273.15;return 1/(1/(td-56)+Math.log(t/td)/800)+56;}
function saturationVaporPressure(tC){return 6.112*Math.exp(17.67*tC/(tC+243.5));}
function saturationMixingRatio(tC,p){const e=Math.min(p*.99,saturationVaporPressure(tC));return EPS*e/(p-e);}
function vaporPressureFromDewpoint(tdC){return saturationVaporPressure(tdC);}
function dewpointFromVaporPressure(e){const l=Math.log(e/6.112);return 243.5*l/(17.67-l);}
function relativeHumidity(t,td){return clamp(100*saturationVaporPressure(td)/saturationVaporPressure(t),0,100);}
function virtualTemperatureK(t,td,p){const e=vaporPressureFromDewpoint(td),w=EPS*e/(p-e);return(t+273.15)*(1+.61*w);}
function precipitableWater(rows){let total=0;for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1],qa=specificHumidity(a.td,a.p),qb=specificHumidity(b.td,b.p);total+=.5*(qa+qb)*(a.p-b.p)*100/G}return total/25.4;}
function mixingRatioFromDewpoint(td,p){const e=Math.min(p*.99,vaporPressureFromDewpoint(td));return EPS*e/(p-e);}
function specificHumidity(td,p){const e=vaporPressureFromDewpoint(td),w=EPS*e/(p-e);return w/(1+w);}
function wetBulbApprox(t,rh){return t*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+.00391838*Math.pow(rh,1.5)*Math.atan(.023101*rh)-4.686035;}
function interpolateHeightForWetBulb(rows,target){const wb=rows.map(r=>({...r,t:wetBulbApprox(r.t,r.rh)}));return interpolateHeightForTemp(wb,target);}
function interpolateAnchor(a,p){let lo=a[a.length-1],hi=a[0];for(let i=0;i<a.length-1;i++){if(p<=a[i].p&&p>=a[i+1].p){hi=a[i];lo=a[i+1];break}}const f=(Math.log(hi.p)-Math.log(p))/(Math.log(hi.p)-Math.log(lo.p));return{p,t:lerp(hi.t,lo.t,f),td:Math.min(lerp(hi.td,lo.td,f),lerp(hi.t,lo.t,f)),dir:blendDir(hi.dir,lo.dir,f),spd:lerp(hi.spd,lo.spd,f)}}
function pressureToHeight(p,elev,surfaceP,surfaceT){const tv=surfaceT+273.15;return elev+(RD*tv/G)*Math.log(surfaceP/p);}
function interpolateHeightForTemp(rows,target){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if((a.t-target)*(b.t-target)<=0&&b.t!==a.t){const f=(target-a.t)/(b.t-a.t);return lerp(a.heightM,b.heightM,f)}}return NaN}
function heightAtPressure(rows,p){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(p<=a.p&&p>=b.p){const f=(Math.log(a.p)-Math.log(p))/(Math.log(a.p)-Math.log(b.p));return lerp(a.heightM,b.heightM,f)}}return rows[rows.length-1].heightM}
function pressureAtHeight(rows,z){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(z>=a.heightM&&z<=b.heightM){const f=(z-a.heightM)/(b.heightM-a.heightM);return Math.exp(lerp(Math.log(a.p),Math.log(b.p),f))}}return NaN}
function temperatureAtPressure(rows,p){return interpolatePressureValue(rows,p,'t')}
function parcelTemperatureAtPressure(rows,p){return interpolatePressureValue(rows,p,'t')}
function interpolatePressureValue(rows,p,key){for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(p<=a.p&&p>=b.p){const f=(Math.log(a.p)-Math.log(p))/(Math.log(a.p)-Math.log(b.p));return lerp(a[key],b[key],f)}}return rows[rows.length-1][key]}
function bunkers(rows,elevation){const mean=meanWindLayer(rows,0,6000,elevation),low=windAtAgl(rows,0,elevation),upper=windAtAgl(rows,6000,elevation),du=upper.u-low.u,dv=upper.v-low.v,mag=Math.hypot(du,dv)||1,dev=7.5/KNOT_TO_MS;return{right:{u:mean.u+dv/mag*dev,v:mean.v-du/mag*dev},left:{u:mean.u-dv/mag*dev,v:mean.v+du/mag*dev}}}
function windAtAgl(rows,z,elev){const target=elev+z;for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(target>=a.heightM&&target<=b.heightM){const f=(target-a.heightM)/(b.heightM-a.heightM);return{u:lerp(a.u,b.u,f),v:lerp(a.v,b.v,f)}}}return rows[rows.length-1]}
function meanWindLayer(rows,bottom,top,elev){let u=0,v=0,n=0;for(let z=bottom;z<=top;z+=250){const w=windAtAgl(rows,z,elev);u+=w.u;v+=w.v;n++}return{u:u/n,v:v/n}}
function stormRelativeHelicity(rows,storm,bottom,top,elev){let sum=0,prev=windAtAgl(rows,bottom,elev);for(let z=bottom+250;z<=top;z+=250){const cur=windAtAgl(rows,z,elev);sum+=(cur.u-storm.u)*(prev.v-storm.v)-(prev.u-storm.u)*(cur.v-storm.v);prev=cur}return Math.abs(sum)*KNOT_TO_MS*KNOT_TO_MS}
function agl(r,rows){return r.heightM-rows[0].heightM}
function nearestAgl(rows,z,all){return rows.reduce((a,b)=>Math.abs(agl(b,all)-z)<Math.abs(agl(a,all)-z)?b:a)}
function interpolatedLayer(rows,lo,hi,all){return rows.filter(r=>agl(r,all)>=lo&&agl(r,all)<=hi)}
function uvFromDirSpeed(dir,spd){const r=dir*Math.PI/180;return{u:-Math.sin(r)*spd,v:-Math.cos(r)*spd}}
function blendDir(a,b,t){const ar=a*Math.PI/180,br=b*Math.PI/180;return(Math.atan2((1-t)*Math.sin(ar)+t*Math.sin(br),(1-t)*Math.cos(ar)+t*Math.cos(br))*180/Math.PI+360)%360}
function lerp(a,b,t){return a+(b-a)*t}function fToC(f){return(f-32)*5/9}function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
