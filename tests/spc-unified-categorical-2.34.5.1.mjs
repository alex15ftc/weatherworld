import assert from 'node:assert/strict';
import { rasterizeSpcOutlook, createSpcGeographicGrid } from '../js/historical/spc/SPCOutlookRasterizer.js';

const polygon = (minLon,maxLon,minLat,maxLat) => ({ outer:[[minLon,minLat],[maxLon,minLat],[maxLon,maxLat],[minLon,maxLat],[minLon,minLat]], holes:[], validation:{valid:true} });
const product = {
  schemaVersion:'2.34.5.1', forecastDay:'day1', hazards:{
    categorical:[
      {id:'TSTM',hazardType:'categorical',value:'TSTM',polygons:[polygon(0,6,0,6)]},
      {id:'MRGL',hazardType:'categorical',value:'MRGL',polygons:[polygon(1,5,1,5)]},
      {id:'SLGT',hazardType:'categorical',value:'SLGT',polygons:[{...polygon(2,4,2,4),holes:[[[2.9,1.9],[4.1,1.9],[4.1,3.1],[2.9,3.1],[2.9,1.9]]]}]}
    ], tornado:[],wind:[],hail:[],significantTornado:[],significantWind:[],significantHail:[]
  }
};
const grid=createSpcGeographicGrid({minLon:0,maxLon:6,minLat:0,maxLat:6,cellSizeKm:111.32,referenceLat:0});
const result=rasterizeSpcOutlook(product,{grid,coverageSamples:4,includeEmptyCells:true});
const at=(x,y)=>result.cells.find(c=>c.x===x&&c.y===y)?.hazards.categorical?.value ?? 'NONE';
assert.equal(at(0,0),'TSTM');
assert.equal(at(1,1),'MRGL');
assert.equal(at(2,2),'SLGT');
assert.equal(at(3,3),'MRGL','SLGT hole must reveal the next valid lower category');
assert.equal(at(5,5),'TSTM');
console.log('2.34.5.1 unified categorical field passed');
