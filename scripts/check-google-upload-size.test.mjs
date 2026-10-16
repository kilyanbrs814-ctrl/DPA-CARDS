import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { randomFillSync } from 'node:crypto';
import { crc32 } from '../supabase/functions/_shared/png.js';
import { decodePanelArt } from '../supabase/functions/apple-pass/real-strip.js';

test('Google accepts a full-size PNG above 2 MiB while Apple keeps its default bound', async () => {
  const width=1032,height=812;
  const raw=randomFillSync(Buffer.alloc(height*(width*4+1)));
  for(let y=0;y<height;y++)raw[y*(width*4+1)]=0;
  const chunk=(name,data)=>{const tag=Buffer.from(name),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([n,tag,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  assert.ok(png.length>2097152);
  const decoded=await decodePanelArt(png,{maxBytes:15728640});
  assert.equal(decoded.width,width);assert.equal(decoded.height,height);
  assert.deepEqual(Buffer.from(decoded.pixels.subarray(0,width*4)),raw.subarray(1,width*4+1));
  await assert.rejects(decodePanelArt(png));
  await assert.rejects(decodePanelArt(png,{maxBytes:png.length-1}));
});
