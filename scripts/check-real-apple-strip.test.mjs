import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { makeRealStrip } from '../supabase/functions/apple-pass/real-strip.js';

const brand={primary:'#121820',secondary:'#3040C0',accent:'#F2C94C',stamps:{filled:'#F2C94C',empty:'#FFFFFF'}};
const pngSignature=[137,80,78,71,13,10,26,10];
const parsePng=(png) => {
  assert.deepEqual(Array.from(png.slice(0,8)),pngSignature);
  let offset=8, w,h,payload=[];
  while(offset < png.length){
    const n=new DataView(png.buffer,png.byteOffset+offset,4).getUint32(0);
    const type=new TextDecoder().decode(png.slice(offset+4,offset+8));
    const bytes=png.slice(offset+8,offset+8+n);
    if(type==='IHDR'){w=new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0);h=new DataView(bytes.buffer,bytes.byteOffset+4,4).getUint32(0);}
    if(type==='IDAT')payload.push(bytes);
    offset += 12+n;
    if(type==='IEND')break;
  }
  const raw=inflateSync(Buffer.concat(payload));
  assert.equal(raw.length,h*(1+4*w));
  for(let y=0;y<h;y++)assert.equal(raw[y*(1+4*w)],0,'unfiltered PNG scanline');
  return {w,h,raw};
};
test('safe native PNG strip encodes true dimensions at 1x and 2x',async()=>{
  for (const scale of [1,2]) {
    const png=await makeRealStrip(brand,3,10,scale);
    const image=parsePng(png);
    assert.equal(image.w,375*scale);
    assert.equal(image.h,123*scale);
  }
});
test('different balances produce visibly different branded stamp strips',async()=>{
  const a=await makeRealStrip(brand,0,10,1), b=await makeRealStrip(brand,10,10,1);
  assert.notDeepEqual(a,b);
});
test('the Edge Function has no eager native image or WASM dependencies',()=>{
  const source=readFileSync(new URL('../supabase/functions/apple-pass/index.ts', import.meta.url),'utf8');
  assert.ok(!source.includes('npm:imagescript'));
  assert.ok(!source.includes('sharp'));
  assert.ok(source.includes('async function createDemoPass'));
  assert.ok(source.includes('makeRealStrip(brand, balance, goal'));
});
