import assert from 'node:assert/strict';
import { applyTrajectoryUncertaintyEnvelopes, forecastStormTrajectory, projectHazardsFromEnvironment, projectedDrylineGenesisSupport, projectedTornadoGenesisSupport, tornadoGenesisCorridorSupport } from '../js/forecast/OutlookCycleEngine.js';

const cell = {
  x:10,y:10,
  surface:{wind:{direction:170,speed:18}},
  levels:{850:{windDirection:210,windSpeed:38},500:{windDirection:245,windSpeed:58}},
  derived:{bulkShear:54,dcape:950},
  forecast:{linearFraction:.82,conditionalWindIntensity:.88}
};
const world = {
  cellSizeKm:16,
  mesoscale:{boundaries:[{
    strength:.85,widthKm:30,velocityKph:{east:28,north:-8},
    pointsKm:[{x:168,y:168}]
  }]}
};
const tornado = forecastStormTrajectory(cell,6,'discrete',16,world);
const wind = forecastStormTrajectory(cell,6,'linear',16,world);

assert.equal(tornado.method,'storm-engine-850-500-mean-wind');
assert.equal(wind.method,'storm-engine-linear-cold-pool-boundary');
assert.ok(wind.coldPoolPropagationKph>0,'linear motion omitted cold-pool propagation');
assert.ok(wind.boundaryPropagationKph.east>0,'linear motion omitted boundary propagation');
assert.ok(tornado.boundaryPropagationKph.east>0,'supercell motion omitted boundary propagation');
assert.notEqual(wind.motionDirection,tornado.motionDirection,'hazards shared one motion vector');
assert.ok(wind.uncertaintyRadiusCells>tornado.uncertaintyRadiusCells,'linear corridor was not given broader uncertainty');

const grid=Array.from({length:49},()=>({
  tornadoProbability:0,hailProbability:0,windProbability:0,
  hazardCorridors:{tornado:{trajectory:{uncertaintyRadiusCells:3}},hail:{trajectory:{uncertaintyRadiusCells:3}},wind:{trajectory:{uncertaintyRadiusCells:3}}}
}));
grid[24].tornadoProbability=5;
applyTrajectoryUncertaintyEnvelopes(grid,7,7,'day1');
assert.ok(grid.filter(cell=>cell.tornadoProbability>=5).length>1,'trajectory uncertainty did not broaden the 5% tornado corridor');
assert.equal(Math.max(...grid.map(cell=>cell.tornadoProbability)),5,'uncertainty envelope manufactured a stronger tornado tier');

const continuous=projectHazardsFromEnvironment({
  forecast:{discreteFraction:.55,linearFraction:.65},
  derived:{dcape:650}
},{
  cape:1800,cin:45,srh:160,shear:42,lcl:1200,
  realizationChain:{
    supercell:.55,organization:.6,linear:.65,balanceSupport:.55,
    inhibitionEfficiency:.85,lowlevelUH:85,realizedUpdraftMs:28,coldPoolSpeedMs:11,
    atLeastOneOrganizedStorm:.32,atLeastOneConvectiveStorm:.45,
    atLeastOneHailStorm:.38,atLeastOneWindStorm:.36,
    environmentSuitability:.7,initiation:.42
  }
});
assert.ok(Object.values(continuous).some(value=>value>0&&!([2,5,10,15,30,45,60,75,90].includes(value))),
  'environmental hazards were prematurely quantized');

const plainSupport=tornadoGenesisCorridorSupport(null,{x:10,y:10,features:{},mesoscaleFields:{}});
const intersectionSupport=tornadoGenesisCorridorSupport({
  cellSizeKm:16,mesoscale:{topology:{triplePointKm:{x:168,y:168}}}
},{
  x:10,y:10,
  features:{boundaryObjectIds:['dryline','warm'],drylineInfluence:.8,warmFrontInfluence:.75,explicitBoundaryInfluence:.85},
  mesoscaleFields:{effectiveInflow:.8,stretchingPotential:.75,convergenceCorridor:.8}
});
assert.ok(intersectionSupport>plainSupport+.6,'boundary intersection did not focus the tornado-genesis corridor');

const cells=Array.from({length:5},(_,x)=>({
  x,y:0,features:x===1?{boundaryObjectIds:['warm'],warmFrontInfluence:1,explicitBoundaryInfluence:1}:{},
  mesoscaleFields:x===1?{effectiveInflow:1,stretchingPotential:1,convergenceCorridor:1}:{}
}));
const movingWorld={
  width:5,height:1,cellSizeKm:20,setupForecast:{key:'warm_front_wave'},
  mesoscale:{boundaries:[{type:'warm',strength:1,velocityKph:{east:20,north:0}}]},
  getCell(x){return cells[x];}
};
assert.ok(projectedTornadoGenesisSupport(movingWorld,cells[3],5)>.5,
  'future tornado-genesis support did not follow the moving warm front');

const dryCells=Array.from({length:7},(_,x)=>({
  x,y:0,levels:{700:{windDirection:240,windSpeed:45}},
  features:x===1?{drylineInfluence:1,dewpointGradient:18}:{},
  mesoscaleFields:x===1?{dewpointGradientFPer100Km:18,convergenceCorridor:1,effectiveInflow:1,stretchingPotential:1,moisturePooling:1}:{}
}));
const dryWorld={
  width:7,height:1,cellSizeKm:20,
  mesoscale:{boundaries:[{type:'dryline',strength:1,velocityKph:{east:20,north:0}}]},
  getCell(x){return dryCells[x];}
};
assert.ok(projectedDrylineGenesisSupport(dryWorld,dryCells[5],5)>.6,
  'future dryline genesis did not follow the projected moisture-gradient ribbon');

console.log(`hazard motion models passed; tornado ${tornado.motionDirection.toFixed(0)}°/${tornado.motionSpeedKt.toFixed(0)} kt, line ${wind.motionDirection.toFixed(0)}°/${wind.motionSpeedKt.toFixed(0)} kt`);
