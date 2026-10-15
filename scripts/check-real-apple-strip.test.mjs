import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { makeRealStrip, makeDemoStrip, makeDemoLogo, makeGoogleStampHero, makeEmojiCardStrip, makeAppleHeaderLogo } from '../supabase/functions/apple-pass/real-strip.js';
import { decodeEmojiPng, emojiFilename, compositeEmoji, twemojiFilename } from '../supabase/functions/apple-pass/emoji-art.js';

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


const demoDesign={
  identity:{name:'Commerce test',subtitle:'Démonstration'},
  colors:{primary:'#1C1F24',secondary:'#2448F0',text:'#FFFFFF',accent:'#F2C94C'},
  apple:{colors:{},showHero:true,showSubtitle:true,heroFocus:50,useBackground:false},
  stamps:{icon:'check',filled:'#F2C94C',empty:'#FFFFFF',shape:'circle',style:'outline'},
  preview:{goal:10,progress:3,mode:'passages',client:'Nicolas Moreau',reward:'1 dessert offert',available:1},
};
const rgbaAt = (img,x,y) => {
  const z=y*(1+4*img.w)+1+4*x;
  return [...img.raw.subarray(z,z+4)];
};
test('demo pass renders blue gradient + exactly the configured 3 yellow tampons',async()=>{
  const img=parsePng(await makeDemoStrip(demoDesign,1));
  assert.equal(img.w,375);assert.equal(img.h,144);
  const blue=rgbaAt(img,10,60), dark=rgbaAt(img,355,60);
  assert.ok(blue[2]>dark[2], 'strip should gradient blue toward dark');
  const x=[217,249,281,313,345],y=[50,97];
  for(let i=0;i<10;i++){
    // Sample left of each center to avoid the checkmark in a filled stamp.
    const p=rgbaAt(img,x[i%5]-12,y[Math.floor(i/5)]);
    if(i<3) assert.ok(p[0]>=200 && p[1]>=150 && p[2]<=130,'filled stamp '+i);
    else assert.ok(p[0]>=180,'white outline '+i);
  }
});
test('demo strip reacts to saved preview progress and Apple primary color override',async()=>{
  const empty=structuredClone(demoDesign);
  empty.preview.progress=0;
  const all=structuredClone(demoDesign);
  all.preview.progress=10;
  all.apple.colors.primary='#111111';
  const p0=await makeDemoStrip(empty,1),p10=await makeDemoStrip(all,1);
  assert.notDeepEqual(p0,p10);
});
test('native badge shows commerce initials on yellow, not a generic DPA logo',async()=>{
  const logo=parsePng(await makeDemoLogo('Commerce test','#F2C94C',1,'logo'));
  assert.equal(logo.w,160);assert.equal(logo.h,50);
  const center=rgbaAt(logo,20,5);
  assert.ok(center[0]>=200 && center[1]>=150,'commerce logo should use yellow tile');
  const icon=parsePng(await makeDemoLogo('Commerce test','#F2C94C',2,'icon'));
  assert.equal(icon.w,58);assert.equal(icon.h,58);
});
test('real pass still uses independent logo and strip path; demo remains excluded from metrics',()=>{
  const source=readFileSync(new URL('../supabase/functions/apple-pass/index.ts',import.meta.url),'utf8');
  const demo=source.split('async function createDemoPass(')[1].split('// Real cards only.')[0];
  assert.ok(demo.includes('makeDemoStrip({...d,preview:{...pv,progress:balance}}, 1, stamp)'));
  assert.ok(demo.includes('makeDemoLogo(name, accent'));
  assert.ok(demo.includes('DPA_TEST:'));
  assert.ok(demo.includes('crypto.randomUUID()'));
  assert.ok(demo.includes('cardId: null, merchantId: null'));
  assert.ok(!demo.includes('apple_wallet_downloads'));
});

test('Unicode emoji filenames are validated and no arbitrary asset URLs allowed',()=>{
  assert.equal(emojiFilename('🍔'),'emoji_u1f354.png');
  assert.equal(emojiFilename('🍕'),'emoji_u1f355.png');
  assert.equal(emojiFilename('☕'),'emoji_u2615.png');
  assert.equal(emojiFilename('not emoji'),null);
  assert.equal(emojiFilename(''),null);
});
test('Noto image decoder reads genuine RGBA PNG produced by Web CompressionStream',async()=>{
  const png=await makeDemoLogo('Commerce test','#F2C94C',1,'logo');
  const img=await decodeEmojiPng(png);
  assert.equal(img.width,160);
  assert.equal(img.height,50);
  assert.equal(img.pixels.length,160*50*4);
});
test('Noto stamps are in color when filled and gray with 22 percent opacity when empty',()=>{
  const icon={width:1,height:1,pixels:new Uint8Array([255,0,0,255])};
  const filled=new Uint8Array(5*5*4).fill(0);
  const empty=new Uint8Array(5*5*4).fill(0);
  compositeEmoji(filled,5,5,2,2,1,icon,true);
  compositeEmoji(empty,5,5,2,2,1,icon,false);
  const full=Array.from(filled.slice((2*5+2)*4,(2*5+2)*4+3));
  const gray=Array.from(empty.slice((2*5+2)*4,(2*5+2)*4+3));
  assert.ok(full[0]>200 && full[1]===0 && full[2]===0);
  assert.ok(gray.every(v=>v>0 && v<100));
  assert.equal(gray[0],gray[1]);assert.equal(gray[1],gray[2]);
});

test('Google Wallet banner is a valid 1032x812 native image with no personal QR',async()=>{
  const png=await makeGoogleStampHero({
    colors:{primary:'#1C1F24',secondary:'#2448F0'},stamps:{}
  },3,10,'passages');
  const img=parsePng(png);
  assert.equal(img.w,1032);assert.equal(img.h,812);
  assert.ok(png.length>1000);
});
test('Apple and Google sources include emoji-safe image routes and balance updates',()=>{
  const server=readFileSync(new URL('../supabase/functions/wallet/index.ts',import.meta.url),'utf8');
  const apple=readFileSync(new URL('../supabase/functions/apple-pass/index.ts',import.meta.url),'utf8');
  assert.ok(server.includes("publicStampBoard(req,path)"));
  assert.ok(server.includes('hasStampEmoji(program)'));
  assert.ok(server.includes('async function stampSignature(id: string)'));
  assert.ok(server.includes('update.heroImage'));
  assert.ok(apple.includes('makeDemoStrip({...d,preview:{...pv,progress:balance}}, 1, stamp)'));
  assert.ok(apple.includes('realApplePassData({'));
});

test('new real and demo Apple emoji strips use the same centered 375x144 rectangular layout',async()=>{
  const base={primary:'#21252C',secondary:'#305ACA'};
  const stamps={emoji:'🦊',filled:'#F2C94C'};
  // Deterministic local asset: no remote download or dependency on CDN reachability.
  const original=globalThis.fetch;
  const image=await makeDemoLogo('Test','#F2C94C',1,'logo');
  try{
    globalThis.fetch=async url=> {
      if(String(url).startsWith('https://raw.githubusercontent.com/googlefonts/noto-emoji/'))
        return new Response(image,{status:200,headers:{'content-length':String(image.length)}});
      return original(url);
    };
    const real=await makeRealStrip({...base,stamps,emoji:'🦊',mode:'passages'},3,10,1);
    const demo=await makeDemoStrip({colors:base,stamps,preview:{goal:10,progress:3,mode:'passages'}},1);
    const a=parsePng(real),z=parsePng(demo);
    assert.deepEqual([a.w,a.h],[375,144]);
    assert.deepEqual(Array.from(real),Array.from(demo),'real/test art must match for identical config');
    const empty=await makeEmojiCardStrip(stamps,base,0,10,'passages',1);
    assert.notDeepEqual(Array.from(real),Array.from(empty),'stamped balance affects visible panel');
  } finally {globalThis.fetch=original;}
});

test('💧 Apple demo strip stays visible even when Noto and Twemoji are unavailable',async()=>{
  assert.equal(twemojiFilename('💧'),'1f4a7.png');
  const savedFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response('not found',{status:404});
    const design=structuredClone(demoDesign);
    design.stamps={icon:'emoji',emoji:'💧',filled:'#F2C94C',empty:'#FFFFFF'};
    const made=parsePng(await makeDemoStrip(design,1));
    assert.deepEqual([made.w,made.h],[375,144]);
    const completed=rgbaAt(made,188,44),waiting=rgbaAt(made,249,44);
    const panel=rgbaAt(made,190,16);
    assert.notDeepEqual(completed,panel,'completed droplet must have visible pixels');
    assert.notDeepEqual(waiting,panel,'remaining droplet must also be visible');
    assert.notDeepEqual(completed,waiting,'completed and gray stamps must differ');
    const real=await makeRealStrip({primary:'#1C1F24',secondary:'#2448F0',emoji:'💧',stamps:design.stamps},3,10,1);
    assert.deepEqual(Array.from(real),Array.from(await makeDemoStrip(design,1)));
  } finally { globalThis.fetch=savedFetch; }
});

test('Apple header uses 3x Retina and high-quality anti-aliased transparent artwork',async()=>{
  const {resizeAppleLogo}=await import('../supabase/functions/apple-pass/logo-resize.js');
  const srcW=400,srcH=400,rgba=new Uint8Array(srcW*srcH*4);
  // High-resolution diagonal logo, with an intentionally transparent border.
  for(let y=60;y<340;y++)for(let x=60;x<340;x++){
    if(Math.abs(y-x)>92)continue;
    const index=(y*srcW+x)*4;
    rgba.set([235,75,36,255],index);
  }
  const source={width:srcW,height:srcH,pixels:rgba};
  for(const compact of [false,true])for(const scale of [1,2,3]){
    const w=(compact?52:160)*scale,h=(compact?40:50)*scale;
    const img=resizeAppleLogo(source,w,h);
    assert.equal(img.length,w*h*4);
    assert.equal(img[((h-1)*w)*4+3],0,'transparent area outside the diagonal stays transparent');
    assert.ok(img.some((v,i)=>i%4===3&&v===255),'logo has a visible opaque core');
    const translucent=img.filter((v,i)=>i%4===3&&v>0&&v<255);
    assert.ok(translucent.length>0,'fine diagonal edges must be antialiased');
  }
});
test('Apple header is transparent without a PNG, with no initials or bitmap name',async()=>{
  for(const scale of [1,2,3]) {
    const png=await makeAppleHeaderLogo('Commerce test','#F2C94C','#1C1F24',null,scale);
    const img=parsePng(png);
    assert.equal(img.w,160*scale);assert.equal(img.h,50*scale);
    assert.ok(img.raw.every(v=>v===0));
  }
});
test('Apple compact header logo reserves space for system text at 1x and 2x',async()=>{
  for(const scale of [1,2,3]){
    const png=await makeAppleHeaderLogo('Napolithein','#F2C94C','#1C1F24',null,scale,true);
    const img=parsePng(png);
    assert.equal(img.w,64*scale);
    assert.equal(img.h,48*scale);
    assert.ok(img.raw.every(v=>v===0),'only native PassKit draws the business name');
  }
});
test('Apple emojis are 50pt and 2x artwork doubles pixels rather than getting smaller',async()=>{
  const saved=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('missing',{status:404});
    const source={...demoDesign,stamps:{emoji:'💧',filled:'#F2C94C'},preview:{mode:'passages',goal:10,progress:3}};
    const img1=parsePng(await makeDemoStrip(source,1));
    const img2=parsePng(await makeDemoStrip(source,2));
    assert.deepEqual([img1.w,img1.h],[375,144]);
    assert.deepEqual([img2.w,img2.h],[750,288]);
    const bg=rgbaAt(img1,190,44);
    const widths=[img1,img2].map((img,index)=>{
      const scale=index+1,cy=Math.round(44*scale);
      let sum=0;
      for(let x=65*scale;x<127*scale;x++){
        const p=rgbaAt(img,x,cy);
        if(p[0]!==bg[0]||p[1]!==bg[1]||p[2]!==bg[2])sum++;
      }
      return sum;
    });
    assert.ok(widths[0]>=19,'larger stamp must occupy visibly more than 19px');
    assert.ok(widths[1]>=widths[0]*1.6,'high-res artwork must scale with device resolution');
  } finally {globalThis.fetch=saved;}
});

test('Apple header text uses native PassKit logoText only when the design opts in',()=>{
  const source=readFileSync(new URL('../supabase/functions/apple-pass/index.ts', import.meta.url),'utf8');
  assert.ok(source.includes("d.apple?.showBusinessName === true ? { logoText: name }"),'demo pass must use a native text field');
  assert.ok(!source.includes("json.logoText = ''"),'empty logoText is rejected by passkit-generator Joi schema');
  const json={organizationName:'Commerce',storeCard:{headerFields:[]}};
  assert.equal(Object.hasOwn(json,'logoText'),false,'existing cards remain logo-only by default');
});
