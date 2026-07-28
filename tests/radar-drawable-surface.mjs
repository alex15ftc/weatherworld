import assert from 'node:assert/strict';
class FakeImageData{constructor(width,height){this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4)}}
globalThis.ImageData=FakeImageData;
class FakeCanvas{constructor(){this.width=0;this.height=0;this.put=false}getContext(){return{putImageData:()=>{this.put=true}}}}
globalThis.document={createElement(tag){assert.equal(tag,'canvas');return new FakeCanvas();}};
const {rasterizeRadar}=await import('../js/radar/RadarRenderer.js?v=2.17.0');
const snap={domainWidthKm:100,domainHeightKm:100,radarNetwork:{networkId:'t',scanNumber:1,stations:[]},storms:[]};
const frame=rasterizeRadar(snap,'reflectivity','composite');
assert.ok(frame.image instanceof FakeCanvas);assert.ok(frame.image.put);assert.ok(frame.imageData instanceof FakeImageData);
console.log('radar drawable surface passed');
