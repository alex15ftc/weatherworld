const HAZARDS = ['tornado','hail','wind'];
const LEVELS = { tornado:[0,2,5,10,15,30,45,60], hail:[0,5,15,30,45,60,75,90], wind:[0,5,15,30,45,60,75,90] };
const RISKS = ['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];
const NEIGHBORS_8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

export function applyRegionalOutlookTopology(grid,width,height,{key='day1'}={}){
  const diagnostics={islandsRemoved:0,holesFilled:0,gapsBridged:0,components:0};
  for(const hazard of HAZARDS){
    const preLevels=LEVELS[hazard].filter(v=>v>0).sort((a,b)=>b-a);
    for(const level of preLevels) diagnostics.gapsBridged+=bridgeSingleCellGaps(grid,width,height,hazard,level);
    regionalSmooth(grid,width,height,hazard,key);
    const levels=LEVELS[hazard].filter(v=>v>0).sort((a,b)=>b-a);
    for(const level of levels){
      const mask=grid.map(c=>(Number(c[`${hazard}Probability`])||0)>=level);
      const comps=components(mask,width,height); diagnostics.components+=comps.length;
      for(const comp of comps){
        const minArea=minComponentCells(hazard,level);
        if(comp.length>=minArea) continue;
        const supported=componentSupport(comp,grid,hazard);
        if(supported>=0.58 && comp.length>=Math.max(2,Math.floor(minArea/2))) continue;
        const lower=nextLower(level,hazard);
        for(const i of comp) grid[i][`${hazard}Probability`]=Math.min(Number(grid[i][`${hazard}Probability`])||0,lower);
        diagnostics.islandsRemoved+=comp.length;
      }
      diagnostics.holesFilled+=fillSmallHoles(grid,width,height,hazard,level,6);
      diagnostics.gapsBridged+=bridgeSingleCellGaps(grid,width,height,hazard,level);
    }
    enforceNestedProbabilities(grid,hazard);
  }
  return {version:'2.66.1',method:'corridor-aware-hazard-topology',...diagnostics};
}

// Final categorical repair runs after hazard categories are synthesized. It is
// deliberately regional: raw hazard probabilities remain available, while the
// issued overall risk becomes a coherent SPC-style region.
export function applyFinalCategoricalTopology(grid,width,height,{key='day1'}={}){
  const rawRanks=Uint8Array.from(grid,f=>Math.max(0,RISKS.indexOf(f.risk)));
  const ranks=Uint8Array.from(rawRanks);
  const diagnostics={version:'2.66.2',method:'hierarchical-risk-nesting-repair',islandsRemoved:0,holesFilled:0,gapsBridged:0,boundaryCellsSmoothed:0,rawComponents:0,finalComponents:0,invalidTransitionsFound:0,parentCellsAdded:0,childCellsReduced:0,nestingRepairPasses:0,unresolvedTransitions:0};

  // Work high-to-low so higher-tier cores remain nested inside lower tiers.
  for(let threshold=RISKS.length-1;threshold>=1;threshold--){
    diagnostics.gapsBridged += bridgeCategoricalGaps(ranks,grid,width,height,threshold,2);
    diagnostics.holesFilled += fillCategoricalHoles(ranks,width,height,threshold,maxHoleCells(threshold));
    diagnostics.boundaryCellsSmoothed += smoothCategoricalBoundary(ranks,grid,width,height,threshold);
    const mask=Array.from(ranks,r=>r>=threshold);
    const comps=components(mask,width,height);
    diagnostics.rawComponents += comps.length;
    for(const comp of comps){
      const minimum=minRiskComponentCells(threshold);
      if(comp.length>=minimum || categoricalSupport(comp,grid,threshold)>=0.61) continue;
      for(const i of comp) ranks[i]=Math.min(ranks[i],threshold-1);
      diagnostics.islandsRemoved += comp.length;
    }
    // Repair holes once more after island removal and smoothing.
    diagnostics.holesFilled += fillCategoricalHoles(ranks,width,height,threshold,maxHoleCells(threshold));
  }

  // Enforce the full categorical hierarchy after all independent topology
  // operations.  A child tier may never directly touch a cell more than one
  // tier lower (for example SLGT next to TSTM).  Prefer reconstructing the
  // missing parent shell from the strongest adjacent support; only reduce a
  // child at the domain edge or when a repair cannot converge.
  const nesting = repairHierarchicalTransitions(ranks,grid,width,height);
  Object.assign(diagnostics,nesting);

  for(let i=0;i<grid.length;i++){
    grid[i].rawRisk ??= RISKS[rawRanks[i]];
    grid[i].issuedRisk=RISKS[ranks[i]];
    grid[i].risk=grid[i].issuedRisk;
    grid[i].categoricalTopology={rawRisk:RISKS[rawRanks[i]],issuedRisk:RISKS[ranks[i]],changed:rawRanks[i]!==ranks[i],hierarchyRepaired:ranks[i]!==rawRanks[i]};
  }
  for(let threshold=1;threshold<RISKS.length;threshold++) diagnostics.finalComponents+=components(Array.from(ranks,r=>r>=threshold),width,height).length;
  diagnostics.cellsChanged=Array.from(ranks).reduce((n,r,i)=>n+(r!==rawRanks[i]?1:0),0);
  diagnostics.key=key;
  return diagnostics;
}

function repairHierarchicalTransitions(ranks,grid,w,h){
  let invalidTransitionsFound=0,parentCellsAdded=0,childCellsReduced=0,nestingRepairPasses=0;
  const maxPasses=RISKS.length+2;
  for(let pass=0;pass<maxPasses;pass++){
    const promotions=new Map();
    const reductions=new Map();
    let invalidThisPass=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,a=ranks[i];
      for(const [dx,dy] of NEIGHBORS_8){
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const j=ny*w+nx,b=ranks[j],difference=Math.abs(a-b);
        if(difference<=1)continue;
        // Count each undirected pair once.
        if(i<j){invalidThisPass++;invalidTransitionsFound++;}
        const high=a>b?i:j,low=a>b?j:i,highRank=ranks[high],requiredParent=highRank-1;
        const lowSupport=localCategoricalSupport(grid[low]);
        const highSupport=localCategoricalSupport(grid[high]);
        // Build the missing parent shell wherever possible. Even weak cells may
        // become a one-cell parent buffer because the child already supplies
        // regional meteorological support. Strong local support simply makes
        // the decision unequivocal.
        if(requiredParent>ranks[low] && (lowSupport>=0.20 || highSupport>=0.45 || requiredParent===1)){
          promotions.set(low,Math.max(promotions.get(low)??0,requiredParent));
        }else{
          reductions.set(high,Math.min(reductions.get(high)??highRank,ranks[low]+1));
        }
      }
    }
    if(invalidThisPass===0)break;
    nestingRepairPasses++;
    let changed=0;
    for(const [i,target] of promotions){if(ranks[i]<target){ranks[i]=target;parentCellsAdded++;changed++;}}
    for(const [i,target] of reductions){if(!promotions.has(i)&&ranks[i]>target){ranks[i]=target;childCellsReduced++;changed++;}}
    if(changed===0)break;
  }
  const unresolvedTransitions=countInvalidTransitions(ranks,w,h);
  return {invalidTransitionsFound,parentCellsAdded,childCellsReduced,nestingRepairPasses,unresolvedTransitions};
}
function countInvalidTransitions(ranks,w,h){let count=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;if(Math.abs(ranks[i]-ranks[ny*w+nx])>1)count++;}}return count;}

function regionalSmooth(grid,w,h,hazard,key){
  const field=`${hazard}Probability`,copy=grid.map(c=>Number(c[field])||0),out=[...copy];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,local=grid[i].forecastConfidence?.[hazard]??{},corridor=Number(local.corridorConfidence)||0;
    const vals=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const j=ny*w+nx,weight=(dx===0&&dy===0)?2.2:1;
      vals.push({v:copy[j],weight});
    }
    const regional=weightedMedian(vals);
    const blend=key==='day1'?0.30:0.38;
    const target=copy[i]*(1-blend)+regional*blend;
    const floor=corridor>=0.66?copy[i]:0;
    out[i]=quantize(Math.max(target,floor),hazard);
  }
  for(let i=0;i<grid.length;i++)grid[i][field]=out[i];
}
function componentSupport(comp,grid,hazard){let s=0;for(const i of comp){const c=grid[i].forecastConfidence?.[hazard]??{};s+=0.45*(Number(c.overallConfidence)||0)+0.35*(Number(c.corridorConfidence)||0)+0.20*(Number(c.memberAgreement)||0);}return s/Math.max(1,comp.length);}
function categoricalSupport(comp,grid,threshold){let sum=0;for(const i of comp){let best=0;for(const h of HAZARDS){const c=grid[i].forecastConfidence?.[h]??{};best=Math.max(best,0.38*(Number(c.overallConfidence)||0)+0.38*(Number(c.corridorConfidence)||0)+0.24*(Number(c.memberAgreement)||0));}sum+=best;}const tierPenalty=Math.max(0,(threshold-3)*0.025);return sum/Math.max(1,comp.length)-tierPenalty;}
function components(mask,w,h){const seen=new Uint8Array(mask.length),all=[];for(let i=0;i<mask.length;i++){if(!mask[i]||seen[i])continue;const q=[i],comp=[];seen[i]=1;for(let n=0;n<q.length;n++){const a=q[n],x=a%w,y=Math.floor(a/w);comp.push(a);for(const [dx,dy] of NEIGHBORS_8){const nx=x+dx,ny=y+dy,j=ny*w+nx;if(nx>=0&&ny>=0&&nx<w&&ny<h&&mask[j]&&!seen[j]){seen[j]=1;q.push(j);}}}all.push(comp);}return all;}
function fillSmallHoles(grid,w,h,hazard,level,maxCells){const field=`${hazard}Probability`,mask=grid.map(c=>(Number(c[field])||0)<level),seen=new Uint8Array(mask.length);let filled=0;for(let i=0;i<mask.length;i++){if(!mask[i]||seen[i])continue;const q=[i],comp=[];let edge=false;seen[i]=1;for(let n=0;n<q.length;n++){const a=q[n],x=a%w,y=Math.floor(a/w);comp.push(a);if(x===0||y===0||x===w-1||y===h-1)edge=true;for(const [dx,dy] of NEIGHBORS_8){const nx=x+dx,ny=y+dy,j=ny*w+nx;if(nx>=0&&ny>=0&&nx<w&&ny<h&&mask[j]&&!seen[j]){seen[j]=1;q.push(j);}}}if(!edge&&comp.length<=maxCells){for(const a of comp)grid[a][field]=level;filled+=comp.length;}}return filled;}
function bridgeSingleCellGaps(grid,w,h,hazard,level){const field=`${hazard}Probability`;let n=0;const pending=[];for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if((Number(grid[i][field])||0)>=level)continue;let opposite=false;for(const [[ax,ay],[bx,by]] of [[[1,0],[-1,0]],[[0,1],[0,-1]],[[1,1],[-1,-1]],[[1,-1],[-1,1]]]){if((Number(grid[(y+ay)*w+x+ax][field])||0)>=level&&(Number(grid[(y+by)*w+x+bx][field])||0)>=level){opposite=true;break;}}const c=grid[i].forecastConfidence?.[hazard]??{};if(opposite&&(Number(c.corridorConfidence)||0)>=0.40)pending.push(i);}for(const i of pending){grid[i][field]=level;n++;}return n;}
function bridgeCategoricalGaps(ranks,grid,w,h,threshold,maxGap){let changed=0;const pending=new Set();for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(ranks[i]>=threshold)continue;const support=localCategoricalSupport(grid[i]);if(support<0.38&&ranks[i]<threshold-1)continue;for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){for(let gap=1;gap<=maxGap;gap++){
      const ax=x-dx,ay=y-dy,bx=x+dx*gap,by=y+dy*gap;
      if(ax<0||ay<0||bx<0||by<0||ax>=w||ay>=h||bx>=w||by>=h)continue;
      if(ranks[ay*w+ax]>=threshold&&ranks[by*w+bx]>=threshold){for(let k=0;k<gap;k++)pending.add((y+dy*k)*w+(x+dx*k));break;}
    }}
  }for(const i of pending){if(ranks[i]<threshold){ranks[i]=threshold;changed++;}}return changed;}
function fillCategoricalHoles(ranks,w,h,threshold,maxCells){const low=Array.from(ranks,r=>r<threshold),seen=new Uint8Array(ranks.length);let filled=0;for(let i=0;i<low.length;i++){if(!low[i]||seen[i])continue;const q=[i],comp=[];let edge=false;seen[i]=1;for(let n=0;n<q.length;n++){const a=q[n],x=a%w,y=Math.floor(a/w);comp.push(a);if(x===0||y===0||x===w-1||y===h-1)edge=true;for(const [dx,dy] of NEIGHBORS_8){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(low[j]&&!seen[j]){seen[j]=1;q.push(j);}}}if(!edge&&comp.length<=maxCells){for(const j of comp)ranks[j]=Math.max(ranks[j],threshold);filled+=comp.length;}}return filled;}
function smoothCategoricalBoundary(ranks,grid,w,h,threshold){const pending=[];for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,count=NEIGHBORS_8.reduce((n,[dx,dy])=>n+(ranks[(y+dy)*w+x+dx]>=threshold?1:0),0);if(ranks[i]<threshold&&count>=6&&(ranks[i]>=threshold-1||localCategoricalSupport(grid[i])>=0.44))pending.push(i);else if(ranks[i]>=threshold&&count<=1&&localCategoricalSupport(grid[i])<0.50)ranks[i]=threshold-1;}for(const i of pending)ranks[i]=threshold;return pending.length;}
function localCategoricalSupport(cell){let best=0;for(const h of HAZARDS){const c=cell.forecastConfidence?.[h]??{};best=Math.max(best,0.4*(Number(c.overallConfidence)||0)+0.35*(Number(c.corridorConfidence)||0)+0.25*(Number(c.memberAgreement)||0));}return best;}
function enforceNestedProbabilities(grid,hazard){for(const c of grid)c[`${hazard}Probability`]=quantize(Number(c[`${hazard}Probability`])||0,hazard);}
function minComponentCells(hazard,level){if(level>=(hazard==='tornado'?30:45))return 8;if(level>=(hazard==='tornado'?15:30))return 6;if(level>=(hazard==='tornado'?5:15))return 5;return 3;}
function minRiskComponentCells(rank){return rank>=5?10:rank===4?8:rank===3?6:rank===2?5:3;}
function maxHoleCells(rank){return rank>=4?12:rank===3?10:rank===2?8:6;}
function nextLower(value,hazard){const levels=LEVELS[hazard];let r=0;for(const l of levels){if(l>=value)break;r=l;}return r;}
function quantize(value,hazard){let r=0;for(const l of LEVELS[hazard])if(value>=l)r=l;return r;}
function weightedMedian(items){const a=[...items].sort((x,y)=>x.v-y.v),total=a.reduce((s,x)=>s+x.weight,0);let s=0;for(const x of a){s+=x.weight;if(s>=total/2)return x.v;}return a.at(-1)?.v??0;}
