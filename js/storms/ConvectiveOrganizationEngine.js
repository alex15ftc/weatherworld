export function updateConvectiveOrganization(world, spatialIndex){
  const active=spatialIndex.active; const clusters=buildClusters(active); world.convectiveClusters=[];
  let next=1;
  for(const group of clusters){
    const id=`C${String(next++).padStart(3,'0')}`;
    const center=centroid(group), meanSpacing=averageSpacing(group), coldPool=mean(group,s=>s.coldPoolStrength??0);
    const alignment=trackAlignment(group), forcing=mean(group,s=>s.environment?.forcing??0);
    const score=clamp((group.length-1)/5*0.30+(1-Math.min(1,meanSpacing/80))*0.22+coldPool*0.20+alignment*0.14+forcing*0.14,0,1);
    const state=organizationState(score,group.length,coldPool,alignment);
    world.convectiveClusters.push({id,size:group.length,center,meanSpacingKm:meanSpacing,coldPoolStrength:coldPool,alignment,organizationScore:score,state,stormIds:group.map(s=>s.id)});
    for(const storm of group){
      const nearest=nearestDistance(storm,group);
      storm.convectiveOrganization={score,clusterId:id,clusterSize:group.length,nearestNeighborKm:Number.isFinite(nearest)?nearest:null,coldPoolOverlap:coldPool,alignment,state};
      storm.organizationHistory??=[]; const last=storm.organizationHistory.at(-1);
      if(!last||last.state!==state)storm.organizationHistory.push({hourUtc:world.stormEngine?.validHourUtc??world.validHourUtc,state,score,clusterId:id});
      applyModeState(storm,state,score);
    }
  }
  world.stormEngine.convectiveOrganization={version:'2.66.0',clusterCount:clusters.length,largestCluster:Math.max(0,...clusters.map(c=>c.length)),meanClusterSize:clusters.length?active.length/clusters.length:0,states:countStates(world.convectiveClusters)};
}
function buildClusters(storms){const seen=new Set(),out=[];for(const s of storms){if(seen.has(s))continue;const q=[s],g=[];seen.add(s);for(let n=0;n<q.length;n++){const a=q[n];g.push(a);for(const b of storms){if(seen.has(b)||a===b)continue;const d=distance(a,b),shared=sharedBoundary(a,b),radius=shared?75:55;if(d<=radius){seen.add(b);q.push(b);}}}out.push(g);}return out;}
function applyModeState(storm,state,score){if(storm.mode==='left-moving supercell'||storm.mode==='elevated convection')return;const old=storm.mode;if(state==='isolated'&&old==='discrete supercell')storm.mode='isolated discrete';else if(state==='semi-discrete'&&old.includes('supercell'))storm.mode='semi-discrete';else if(state==='discrete-cluster')storm.mode='discrete supercell cluster';else if(state==='mixed-cluster')storm.mode='mixed supercell cluster';else if(state==='broken-line')storm.mode='broken line';else if(state==='qlcs-embedded')storm.mode='QLCS with embedded supercells';if(storm.mode!==old){storm.modeAgeHours=0;storm.modeConfidence=Math.max(storm.modeConfidence,0.5+score*0.35);}}
function organizationState(score,size,cold,align){if(size<=1||score<0.18)return'isolated';if(score<0.34)return'semi-discrete';if(score<0.50)return align>0.62?'discrete-cluster':'mixed-cluster';if(score<0.67)return'broken-line';if(cold<0.58)return'qlcs-embedded';return'qlcs';}
function sharedBoundary(a,b){return a.boundaryInteraction?.id&&a.boundaryInteraction.id===b.boundaryInteraction?.id;}
function trackAlignment(g){if(g.length<2)return 0;const dirs=g.map(s=>(s.motion?.directionDeg??0)*Math.PI/180);const x=dirs.reduce((a,d)=>a+Math.cos(d),0)/g.length,y=dirs.reduce((a,d)=>a+Math.sin(d),0)/g.length;return Math.hypot(x,y);}
function nearestDistance(s,g){let d=Infinity;for(const o of g)if(o!==s)d=Math.min(d,distance(s,o));return d;}
function averageSpacing(g){if(g.length<2)return 120;let s=0,n=0;for(let i=0;i<g.length;i++)for(let j=i+1;j<g.length;j++){s+=distance(g[i],g[j]);n++;}return s/n;}
function centroid(g){return{x:mean(g,s=>s.positionKm.x),y:mean(g,s=>s.positionKm.y)};}
function distance(a,b){return Math.hypot(a.positionKm.x-b.positionKm.x,a.positionKm.y-b.positionKm.y);}
function mean(a,f){return a.length?a.reduce((s,x)=>s+(Number(f(x))||0),0)/a.length:0;}
function countStates(cs){const o={};for(const c of cs)o[c.state]=(o[c.state]||0)+1;return o;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
