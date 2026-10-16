import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { crc32,decodePng } from '../supabase/functions/_shared/png.js';
import { makeAppleHeaderLogo,makeDemoStrip,makeRealStrip } from '../supabase/functions/apple-pass/real-strip.js';
import { assetPath,testAssetPath,realApplePassData } from '../supabase/functions/apple-pass/real-card.js';
import { normalize,prepareDesign } from '../src/card-designer.js';
import {fixture} from './fixtures/png.mjs';
const at=(im,x,y)=>[...im.pixels.slice((y*im.width+x)*4,(y*im.width+x)*4+4)];
const mid='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const stamp=`${mid}/${pid}/designer/stamp-${id}.png`,logo=`${mid}/${pid}/designer/logo-${id}.png`;
const design={assets:{logo:{path:logo},stamp:{path:stamp}},stamps:{icon:'custom',emoji:'🍔'},colors:{primary:'#000000',secondary:'#000000'},preview:{goal:10,progress:3,mode:'passages'}};
test('PNG validation rejects corrupt CRC, fake MIME bytes, truncation, oversize dimensions and trailing data',async()=>{
 const png=fixture(),bad=Buffer.from(png);bad[45]^=1;
 for(const b of [bad,Buffer.from('<svg/>'),png.subarray(0,png.length-1),Buffer.concat([png,Buffer.from('x')])]) await assert.rejects(decodePng(b));
 await assert.rejects(decodePng(png,{maxBytes:50}));
 await assert.rejects(decodePng(png,{maxDimension:30}));
 const im=await decodePng(png);assert.deepEqual(at(im,0,0),[0,0,0,0]);assert.deepEqual(at(im,40,20),[220,70,20,255]);
});
test('logo preserves aspect ratio and alpha at 1x/2x/3x, no surrounding text or background',async()=>{
 for(const scale of [1,2,3]){
  const im=await decodePng(await makeAppleHeaderLogo('unused','unused','unused',fixture(),scale));
  assert.deepEqual([im.width,im.height],[160*scale,50*scale]);
  assert.deepEqual(at(im,50*scale,25*scale),[220,70,20,255]);
  assert.equal(at(im,140*scale,25*scale)[3],0);
  // Auto-trimmed fully transparent padding may now bring the artwork to x=0.
  // The empty region to the right must still remain genuinely transparent.
 }
});
test('ten PNG stamps are five plus five: 3 original color, 7 grayscale at 22%, same demo and real raster',async()=>{
 const icon=await decodePng(fixture(40,40));
 for(const scale of [1,2]){
  const png=await makeDemoStrip(design,scale,icon),im=await decodePng(png);
  assert.deepEqual([im.width,im.height],[375*scale,144*scale]);
  for(let i=0;i<10;i++){
   const x=Math.round((187.5+(i%5-2)*61)*scale),y=(43+Math.floor(i/5)*58)*scale;
   const px=at(im,x,y);
   if(i<3)assert.deepEqual(px,[220,70,20,255]);
   else assert.deepEqual(px,[22,22,22,255]);
  }
  const real=await makeRealStrip({...design.colors,stamps:design.stamps,stamp,mode:'passages'},3,10,scale,icon);
  assert.deepEqual(real,png);
 }
});
test('persisted PNG choice and explicit logo removal survive JSON reload; real values never use preview',()=>{
 const saved=JSON.parse(JSON.stringify(design)),p={id:pid,merchant_id:mid,goal:10,mode:'passages',card_design:saved,logo_path:logo};
 assert.equal(normalize(saved,{program:p}).stamps.icon,'custom');
 assert.equal(prepareDesign(saved,p,{},v=>v).assets.stamp.path,stamp);
 saved.assets.logo=null;
 assert.equal(prepareDesign(saved,p,{},v=>v).assets.logo,null);
 const {json,brand}=realApplePassData({program:p,merchant:{business_name:'Own'},customer:{first_name:'Own client'},card:{id,merchant_id:mid,program_id:pid,card_number:'DPA-9876',qr_token:'own-token'},balance:6});
 assert.equal(brand.logo,null);assert.equal(brand.stamp,stamp);
 assert.equal(json.storeCard.secondaryFields[0].value,'6');assert.equal(json.storeCard.secondaryFields[1].value,'4');
 assert.equal(json.barcode.message,'DPA1:own-token');assert.equal(json.storeCard.headerFields[0].value,'9876');assert.ok(!Object.hasOwn(json,'logoText'));
});
test('real and demo assets cannot reference another merchant, program, test, or URL',()=>{
 const card={merchant_id:mid,program_id:pid};
 assert.equal(assetPath(stamp,card,'stamp'),stamp);
 assert.equal(assetPath(stamp,{...card,merchant_id:id},'stamp'),null);
 assert.equal(assetPath(stamp,{...card,program_id:id},'stamp'),null);
 const testStamp=`tests/${id}/designer/stamp-${pid}.png`;
 assert.equal(testAssetPath(testStamp,id,'stamp'),testStamp);
 for(const path of [testStamp.replace(id,pid),stamp,'https://example.com/a.png',`tests/${id}/designer/../stamp-${pid}.png`])assert.equal(testAssetPath(path,id,'stamp'),null);
 assert.equal(assetPath(testStamp,card,'stamp'),null);
});

test('tampon scaling defaults to 100%, bounds unsafe values and survives config hydration',()=>{
 const project={merchant:{},program:{goal:10,mode:'passages'}};
 assert.equal(normalize({},project).stamps.size,100);
 assert.equal(normalize({stamps:{size:50}},project).stamps.size,50);
 assert.equal(normalize({stamps:{size:120}},project).stamps.size,120);
 assert.equal(normalize({stamps:{size:'abc'}},project).stamps.size,100);
 assert.equal(normalize({stamps:{size:999}},project).stamps.size,120);
 const config=JSON.parse(JSON.stringify({stamps:{size:75},preview:{goal:10}}));
 const saved=prepareDesign(config,{}, {},p=>p);
 assert.equal(saved.stamps.size,75);
});

test('tampon spacing is optional, safely clamped and saved independently of size',()=>{
 const project={merchant:{},program:{goal:10,mode:'passages'}};
 assert.equal(normalize({},project).stamps.spacing,100);
 assert.equal(normalize({stamps:{spacing:65,size:110}},project).stamps.spacing,65);
 assert.equal(normalize({stamps:{spacing:-200}},project).stamps.spacing,50);
 assert.equal(normalize({stamps:{spacing:999}},project).stamps.spacing,120);
 assert.equal(normalize({stamps:{spacing:'n/a'}},project).stamps.spacing,100);
 const actual=prepareDesign({stamps:{spacing:75,size:115}}, {}, {}, p=>p);
 assert.equal(actual.stamps.spacing,75);
 assert.equal(actual.stamps.size,115);
});

test('unvalidated grayscale opacity normalizes securely and survives design hydration',()=>{
 const project={merchant:{},program:{goal:10,mode:'passages'}};
 assert.equal(normalize({},project).stamps.inactiveOpacity,22);
 assert.equal(normalize({stamps:{inactiveOpacity:0}},project).stamps.inactiveOpacity,0);
 assert.equal(normalize({stamps:{inactiveOpacity:100}},project).stamps.inactiveOpacity,100);
 assert.equal(normalize({stamps:{inactiveOpacity:'bad'}},project).stamps.inactiveOpacity,22);
 assert.equal(normalize({stamps:{inactiveOpacity:-300}},project).stamps.inactiveOpacity,0);
 assert.equal(normalize({stamps:{inactiveOpacity:700}},project).stamps.inactiveOpacity,100);
 const data={stamps:{size:120,spacing:65,inactiveOpacity:73}};
 const hydrated=prepareDesign(data, {}, {}, v=>v);
 assert.equal(hydrated.stamps.size,120);
 assert.equal(hydrated.stamps.spacing,65);
 assert.equal(hydrated.stamps.inactiveOpacity,73);
});
