import { Atmosphere } from './js/atmosphere.js';
import { generateScenario } from './js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from './js/evolution.js';
import { SIMULATION_CONFIG } from './js/simulationConfig.js';
const seed=Number(process.argv[2]??80444615), profile=process.argv[3]??'gameplay';
const w=new Atmosphere(SIMULATION_CONFIG.fixedColumns,SIMULATION_CONFIG.fixedRows);
initializeEvolution(w,generateScenario(w,seed),{profile});
function snap(){
 let best=null;
 w.forEachCell(c=>{const s=c.derived?.stp??0;if(!best||s>best.s)best={s,c};});
 const c=best.c,p=c.derived?.stpComponents??{};
 return {h:w.validHourUtc,max:+best.s.toFixed(2),xy:[c.x,c.y],raw:+(p.rawStp??0).toFixed(2),cape:+(p.capeTerm??0).toFixed(2),srh:+(p.srhTerm??0).toFixed(2),shear:+(p.shearTerm??0).toFixed(2),lcl:+(p.lclTerm??0).toFixed(2),cin:+(p.cinTerm??0).toFixed(2),air:+(p.airMassFactor??0).toFixed(2),syn:+(p.synopticAdjustment??0).toFixed(2),mlcape:Math.round(c.derived?.cape??0),srhVal:Math.round(c.derived?.srh??0),cinVal:Math.round(c.derived?.cin??0),lclVal:Math.round(c.derived?.lclAgl??0),t:+c.surface.temperature.toFixed(1),td:+c.surface.dewpoint.toFixed(1),thermoRuns:w.evolution.performance.phaseRuns.thermodynamics??0};
}
console.log(snap());
for(let i=0;i<6;i++){advanceAtmosphere(w,.5);console.log(snap());}
