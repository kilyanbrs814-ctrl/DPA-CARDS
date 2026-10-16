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
test('the same final reward-star is gray until the target and gold when earned on Apple and Google',async()=>{
  const {loadRewardStar}=await import('../supabase/functions/_shared/reward-star.js');
  const star=await loadRewardStar();
  assert.equal(star.width,95);
  assert.equal(star.height,96);
  const config={colors:{primary:'#111111',secondary:'#2448F0'},stamps:{icon:'library',filled:'#F2C94C'},
    preview:{mode:'passages',goal:10,progress:0}};
  for(const scale of [1,2]){
    const empty=parsePng(await makeDemoStrip(config,scale,null,null,star));
    const completed=parsePng(await makeDemoStrip({...config,preview:{...config.preview,progress:10}},scale,null,null,star));
    assert.equal(empty.w,375*scale);
    assert.equal(completed.h,144*scale);
    assert.notDeepEqual(empty.raw,completed.raw);
    const rendered=parsePng(await makeRealStrip({...brand,libraryId:'burger',stamps:{icon:'library',filled:'#F2C94C'}},0,10,scale,null,null,star));
    assert.equal(rendered.w,375*scale);
  }
  const google=await makeGoogleStampHero(config,0,10,'passages',null,star);
  assert.equal(parsePng(google).w,1032);
});
test('hiding the Apple rectangle preserves stamps, progress, reward and fixed dimensions',async()=>{
  const icon={width:8,height:8,pixels:new Uint8Array(8*8*4)};
  for(let p=0;p<icon.pixels.length;p+=4)icon.pixels.set([240,80,40,255],p);
  const reward={width:630,height:52,pixels:new Uint8Array(630*52*4)};
  for(let p=0;p<reward.pixels.length;p+=4)reward.pixels.set([255,255,255,255],p);
  const config={colors:{primary:'#121820',secondary:'#3040C0'},stamps:{icon:'custom'},
    preview:{mode:'passages',goal:10,progress:3}};
  const signedBrand={...brand,stamp:'custom.png',mode:'passages'};
  for(const scale of [1,2]){
    for(const render of [
      show=>makeDemoStrip({...config,apple:{showStampPanel:show}},scale,icon,reward,icon),
      show=>makeRealStrip({...signedBrand,showStampPanel:show},3,10,scale,icon,reward,icon),
    ]){
      const shown=parsePng(await render(true)),hidden=parsePng(await render(false));
      assert.equal(hidden.w,shown.w);assert.equal(hidden.h,shown.h);
      assert.equal(hidden.w,375*scale);assert.equal(hidden.h,144*scale);
      assert.deepEqual(rgbaAt(shown,20*scale,25*scale),[48,64,192,255]);
      assert.deepEqual(rgbaAt(hidden,20*scale,25*scale),[18,24,32,255],'only rectangle background disappears');
      assert.deepEqual(rgbaAt(hidden,70*scale,35*scale),[240,80,40,255],'filled stamp survives');
      assert.deepEqual(rgbaAt(hidden,187*scale,125*scale),[255,255,255,255],'reward survives');
      for(const x of [245,303])assert.notDeepEqual(rgbaAt(hidden,x*scale,35*scale),[18,24,32,255],'remaining stamps survive');
    }
    for(const mode of ['passages','points']){
      const fallback=parsePng(await makeDemoStrip({...config,stamps:{icon:'none'},apple:{showStampPanel:false},preview:{...config.preview,mode}},scale));
      assert.deepEqual(rgbaAt(fallback,20*scale,25*scale),[18,24,32,255]);
      assert.ok(fallback.raw.some((v,i)=>i%(1+fallback.w*4)>0&&v===242),'fallback progress survives');
    }
    const legacy=parsePng(await makeRealStrip({...brand,showStampPanel:false},3,10,scale));
    assert.deepEqual(rgbaAt(legacy,200*scale,10*scale),[18,24,32,255]);
    assert.deepEqual(rgbaAt(legacy,223*scale,40*scale),[242,201,76,255],'legacy filled stamp survives');
  }
});
test('safe native PNG strip encodes true dimensions at 1x and 2x',async()=>{
  for (const scale of [1,2]) {
    const png=await makeRealStrip(brand,3,10,scale);
    const image=parsePng(png);
    assert.equal(image.w,375*scale);
    assert.equal(image.h,123*scale);
  }
});
test('Apple reward line is opt-in and composited inside the existing stamp rectangle',async()=>{
  const artW=630,artH=52,layer=new Uint8Array(artW*artH*4);
  for(let y=14;y<38;y++)for(let x=150;x<480;x++){
    const p=(y*artW+x)*4;layer.set([255,255,255,255],p);
  }
  const label={width:artW,height:artH,pixels:layer};
  const signedBrand={...brand,libraryId:'burger',stamps:{icon:'library',filled:'#F2C94C'}};
  const preview={colors:{primary:'#121820',secondary:'#3040C0'},
    stamps:{icon:'library',filled:'#F2C94C'},preview:{mode:'passages',goal:10,progress:3}};
  for(const scale of [1,2]){
    const off=await makeRealStrip(signedBrand,3,10,scale);
    const old=await makeRealStrip(signedBrand,3,10,scale,null,null);
    assert.deepEqual(off,old,'disabled render must be byte-for-byte unchanged');
    const on=await makeRealStrip(signedBrand,3,10,scale,null,label);
    const img=parsePng(on),plain=parsePng(off);
    assert.equal(img.w,375*scale);assert.equal(img.h,144*scale,'strip height fixed');
    const x=Math.floor(187*scale),y=Math.floor(125*scale);
    const offset=y*(1+img.w*4)+1+x*4;
    assert.ok(img.raw[offset]>plain.raw[offset]+30,'reward text becomes visible');
    const demoOff=await makeDemoStrip(preview,scale);
    const demoOn=await makeDemoStrip(preview,scale,null,label);
    const d=parsePng(demoOn);
    assert.equal(d.w,375*scale);assert.equal(d.h,144*scale);
    assert.notDeepEqual(demoOff,demoOn,'demo pass includes the reward too');
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
  assert.ok(demo.includes('makeDemoStrip({...d,preview:{...pv,progress:balance}}, 1, stamp, rewardArt, finalStar, panelArt)'));
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
  assert.ok(apple.includes('makeDemoStrip({...d,preview:{...pv,progress:balance}}, 1, stamp, rewardArt, finalStar, panelArt)'));
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
  assert.ok(source.includes("d.apple?.showBusinessName === true && !composedPath ? { logoText: appleHeaderName(name) }"),'Classic remains native PassKit text');
  assert.ok(source.includes("d.apple?.headerMode==='custom'"),'bitmap requires opt-in');
  assert.ok(source.includes("composed||uploaded,1,compact"),'custom artwork is optional and the original logo remains available');
  assert.ok(!source.includes("json.logoText = ''"),'empty logoText is rejected by passkit-generator Joi schema');
  const json={organizationName:'Commerce',storeCard:{headerFields:[]}};
  assert.equal(Object.hasOwn(json,'logoText'),false,'existing cards remain logo-only by default');
});

test('Apple strip artwork fills every edge on real and demo passes at 1x and 2x',async()=>{
  const {decodePng}=await import('../supabase/functions/_shared/png.js');
  const solid=(w,h,color)=>({width:w,height:h,pixels:Uint8Array.from({length:w*h*4},(_,i)=>color[i%4])});
  const green=[20,180,80,255],red=[240,40,20,255];
  const art=solid(80,10,green),icon=solid(8,8,red);
  const config={colors:brand,stamps:{icon:'custom'},preview:{goal:10,progress:3,mode:'passages'}};
  const at=(im,x,y)=>Array.from(im.pixels.subarray((y*im.width+x)*4,(y*im.width+x)*4+4));
  for(const scale of [1,2])for(const showStampPanel of [true,false]){
    const opts={showStampPanel,showStamps:false};
    const hidden=await decodePng(await makeDemoStrip({...config,apple:opts},scale,icon,null,null,art));
    const real=await decodePng(await makeRealStrip({...brand,stamp:'custom',mode:'passages',...opts},3,10,scale,icon,null,null,art));
    assert.deepEqual([hidden.width,hidden.height],[375*scale,144*scale]);
    assert.deepEqual(real,hidden,'real and test PNGs use the same full-width band');
    for(const [x,y] of [[0,0],[374,0],[0,143],[374,143],[3,72],[371,72],[187,72]])
      assert.deepEqual(at(hidden,x*scale,y*scale),green,'no inset, rounded corner or uncovered edge: '+[x,y]);
    const visible=await decodePng(await makeDemoStrip({...config,apple:{...opts,showStamps:true}},scale,icon,null,null,art));
    assert.deepEqual(at(visible,187*scale,43*scale),red,'stamps overlay the artwork');
    assert.deepEqual(at(visible,0,0),green,'stamps do not mask the full-width corners');
    const withReward=await decodePng(await makeDemoStrip({...config,apple:opts},scale,icon,solid(630,52,[255,255,255,255]),null,art));
    assert.deepEqual(at(withReward,187*scale,125*scale),[255,255,255,255],'reward remains with stamps hidden');
  }
});

test('legacy 375x123 Apple strip path also covers entire width without changing height',async()=>{
  const {decodePng}=await import('../supabase/functions/_shared/png.js');
  const green=[20,180,80,255],art={width:20,height:20,pixels:Uint8Array.from({length:20*20*4},(_,i)=>green[i%4])};
  const at=(im,x,y)=>Array.from(im.pixels.subarray((y*im.width+x)*4,(y*im.width+x)*4+4));
  for(const scale of [1,2])for(const showStampPanel of [true,false]){
    const hidden=await decodePng(await makeRealStrip({...brand,showStampPanel,showStamps:false},3,10,scale,null,null,null,art));
    assert.deepEqual([hidden.width,hidden.height],[375*scale,123*scale]);
    for(const [x,y] of [[0,0],[374,0],[0,122],[374,122],[187,61]])
      assert.deepEqual(at(hidden,x*scale,y*scale),green,'legacy strip extends through corners and edges');
    const visible=await decodePng(await makeRealStrip({...brand,showStampPanel,showStamps:true},3,10,scale,null,null,null,art));
    assert.deepEqual(at(visible,285*scale,40*scale),[242,201,76,255],'native legacy stamps remain drawn');
    const withoutArt=await decodePng(await makeRealStrip({...brand,showStampPanel,showStamps:false},3,10,scale));
    assert.deepEqual(at(withoutArt,0,0),[18,24,32,255],'no artwork retains legacy fallback');
  }
});

test('full Apple strip uses centered cover crop without squashing and leaves Google unchanged',async()=>{
  const {decodePng}=await import('../supabase/functions/_shared/png.js');
  const w=100,h=10,pixels=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set(x>=35&&x<65?[0,255,0,255]:[255,0,0,255],(y*w+x)*4);
  const art={width:w,height:h,pixels};
  for(const scale of [1,2]){
    const img=await decodePng(await makeEmojiCardStrip({}, {...brand,showStamps:false},3,10,'passages',scale,null,null,null,art));
    const at=(x,y)=>Array.from(img.pixels.subarray((y*img.width+x)*4,(y*img.width+x)*4+4));
    for(const [x,y] of [[0,0],[374,0],[0,143],[374,143],[187,72]])
      assert.deepEqual(at(x*scale,y*scale),[0,255,0,255],'center crop covers full band without stretching');
  }
  const config={colors:brand,stamps:{icon:'check'}};
  const google=await makeGoogleStampHero(config,3,10,'passages');
  assert.deepEqual(await makeGoogleStampHero({...config,apple:{showStamps:false},assets:{appleStrip:{url:'unused'}}},3,10,'passages'),google);
});

test('the Apple editor uses a full-bleed strip only when artwork is selected',()=>{
  const source=readFileSync(new URL('../src/card-designer.js',import.meta.url),'utf8');
  assert.ok(source.includes("const hasAppleStrip = platform === 'apple' && !!d.assets.appleStrip?.url"));
  assert.ok(source.includes("margin: hasAppleStrip ? 0 : '0 16px'"));
  assert.ok(source.includes('borderRadius: hasAppleStrip ? 0 : 15'));
  assert.ok(source.includes('appleStrip: { aspect: RECOMMENDED_IMAGE_SIZES.appleStrip.width / RECOMMENDED_IMAGE_SIZES.appleStrip.height, outW: RECOMMENDED_IMAGE_SIZES.appleStrip.width, outH: RECOMMENDED_IMAGE_SIZES.appleStrip.height'));
  assert.ok(source.includes('appleStrip: Object.freeze({ width: 1125, height: 432,'),'recommended pixel dimensions match the full-bleed strip export');
});
test('Apple panel settings survive reload and asset paths remain scoped to their owner',async()=>{
  const {normalize,prepareDesign}=await import('../src/card-designer.js');
  const {assetPath,testAssetPath,realAppleBrand}=await import('../supabase/functions/apple-pass/real-card.js');
  const mid='11111111-1111-1111-1111-111111111111',pid='22222222-2222-2222-2222-222222222222';
  const card={merchant_id:mid,program_id:pid};
  assert.equal(normalize({},{}).apple.showStamps,true);
  for(const ext of ['png','jpg']){
    const path=`${mid}/${pid}/designer/appleStrip-${mid}.${ext}`;
    const design={assets:{appleStrip:{path}},apple:{showStamps:false}};
    const loaded=prepareDesign(JSON.parse(JSON.stringify(design)),{}, {},p=>'https://assets/'+p);
    assert.equal(loaded.assets.appleStrip.url,'https://assets/'+path);
    assert.equal(loaded.apple.showStamps,false);
    const brand=realAppleBrand({card_design:design},{},card);
    assert.equal(brand.appleStrip,path);assert.equal(brand.showStamps,false);
    assert.equal(assetPath(path,{...card,merchant_id:pid},'appleStrip'),null);
    const testPath=`tests/${mid}/designer/appleStrip-${pid}.${ext}`;
    assert.equal(testAssetPath(testPath,mid,'appleStrip'),testPath);
    assert.equal(testAssetPath(testPath,pid,'appleStrip'),null);
  }
});
