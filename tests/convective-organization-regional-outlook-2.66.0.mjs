import assert from 'node:assert/strict';
import { Storm, STORM_MODES } from '../js/storms/Storm.js';
import { updateConvectiveOrganization } from '../js/storms/ConvectiveOrganizationEngine.js';
import { applyRegionalOutlookTopology } from '../js/forecast/RegionalOutlookTopologyEngine.js';

assert(STORM_MODES.includes('semi-discrete'));
assert(STORM_MODES.includes('discrete supercell cluster'));
assert(STORM_MODES.includes('broken line'));
const make=(id,x,y)=>{const s=new Storm({id,xKm:x,yKm:y,velocityEastKph:30,velocityNorthKph:10,sourceCell:{x:0,y:0},createdHourUtc:0,modeHint:'discrete supercell'});s.active=true;s.coldPoolStrength=.35;s.environment={forcing:.55};s.motion.directionDeg=70;return s;};
const storms=[make('S1',0,0),make('S2',25,4),make('S3',48,8)];
const world={storms,stormEngine:{validHourUtc:3},validHourUtc:3};
updateConvectiveOrganization(world,{active:storms});
assert.equal(world.convectiveClusters.length,1);
assert(storms.every(s=>s.convectiveOrganization.clusterSize===3));
assert(storms.some(s=>['semi-discrete','discrete supercell cluster','mixed supercell cluster','broken line'].includes(s.mode)));

const width=7,height=5,grid=Array.from({length:width*height},()=>({tornadoProbability:0,hailProbability:0,windProbability:0,forecastConfidence:{tornado:{corridorConfidence:.8,overallConfidence:.75,memberAgreement:.7},hail:{},wind:{}}}));
for(const [x,y] of [[1,2],[2,2],[4,2],[5,2]])grid[y*width+x].tornadoProbability=10;
grid[2*width+3].forecastConfidence.tornado.corridorConfidence=.75;
const result=applyRegionalOutlookTopology(grid,width,height,{key:'day1'});
assert.equal(grid[2*width+3].tornadoProbability,10);
assert(result.gapsBridged>0);
console.log('2.66.0 convective organization and regional outlook intelligence: PASS');
