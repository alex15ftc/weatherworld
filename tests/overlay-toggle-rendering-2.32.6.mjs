import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Renderer } from '../js/renderer.js';

const main=fs.readFileSync(new URL('../js/main.js',import.meta.url),'utf8');
const remote=fs.readFileSync(new URL('../js/remoteProductPage.js',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../js/pageBootstrap.js',import.meta.url),'utf8');
for(const control of ['toggleRegions','toggleRegionLabels','toggleFeatures']){
  assert.match(main,new RegExp(`ui\\.${control}[\\s\\S]{0,320}updateLayer\\(\\{ forceFull: true \\}\\)`),`${control} must force a full overlay redraw`);
}
assert.match(main,/fast: renderFast && !pendingForceFullRender/);
for(const control of ['boundaryButton','regionButton','regionLabelButton']){
  assert.ok(remote.includes(`${control}?.addEventListener('click'`),`remote viewer must bind ${control}`);
}
assert.match(remote,/if\(regionVisible\|\|regionLabelsVisible\)drawRegions/);
assert.match(remote,/if\(boundaryVisible\)drawBoundaries/);
assert.match(bootstrap,/remoteProductPage\.js\?v=2\.32\.6/,'remote viewer cache key must include this fix');

const renderer=Object.create(Renderer.prototype);
renderer.ctx={clearRect(){}};
renderer.canvas={width:80,height:40};
renderer.atmosphere={width:2,height:1,forEachCell(){}};
renderer.showRegions=false;
renderer.showRegionLabels=true;
renderer.showFeatures=false;
renderer.showGrid=false;
renderer.cellSize=40;
renderer.drawAtmosphericField=()=>{};
renderer.drawRegions=()=>{renderer.regionDraws=(renderer.regionDraws??0)+1};
renderer.drawStorms=()=>{};
renderer.drawSelection=()=>{};
renderer.draw('temperature',{fast:false});
assert.equal(renderer.regionDraws,1,'labels must draw independently when borders are hidden');
renderer.draw('temperature',{fast:true});
assert.equal(renderer.regionDraws,1,'fast previews may omit dense overlays');

const calls={stroke:0,text:0};
const context={
  save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},setLineDash(){},
  stroke(){calls.stroke++},strokeText(){calls.text++},fillText(){calls.text++}
};
renderer.ctx=context;
renderer.atmosphere.worldFramework={
  width:2,height:1,
  cells:[[{regionId:'west'},{regionId:'east'}]],
  regions:[{centroid:{x:.5,y:.5},shortLabel:'W'},{centroid:{x:1.5,y:.5},shortLabel:'E'}]
};
renderer.showRegions=false;
renderer.showRegionLabels=true;
Renderer.prototype.drawRegions.call(renderer);
assert.equal(calls.stroke,0,'hidden region borders must not be stroked');
assert.equal(calls.text,4,'region labels must remain independently visible');

console.log('2.32.6 overlay toggle rendering regression passed');
