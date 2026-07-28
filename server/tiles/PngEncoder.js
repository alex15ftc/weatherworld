import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const CRC_TABLE = new Uint32Array(256);
for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; CRC_TABLE[n]=c>>>0; }
function crc32(parts){ let c=0xffffffff; for(const part of parts) for(const b of part) c=CRC_TABLE[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
function chunk(type,data){ const name=Buffer.from(type); const out=Buffer.alloc(12+data.length); out.writeUInt32BE(data.length,0); name.copy(out,4); data.copy(out,8); out.writeUInt32BE(crc32([name,data]),8+data.length); return out; }
export async function encodeRgbaPng(width,height,rgba){
  const scanlines=Buffer.alloc(height*(1+width*4));
  for(let y=0;y<height;y++){ const dst=y*(1+width*4); scanlines[dst]=0; Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(scanlines,dst+1); }
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
  const compressed = await new Promise((resolve,reject)=>zlib.deflate(scanlines,{level:4},(error,value)=>error?reject(error):resolve(value)));
  return Buffer.concat([SIGNATURE,chunk('IHDR',ihdr),chunk('IDAT',compressed),chunk('IEND',Buffer.alloc(0))]);
}
