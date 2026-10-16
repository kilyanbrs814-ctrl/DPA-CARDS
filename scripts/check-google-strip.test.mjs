import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeGoogleStampHero} from '../supabase/functions/wallet/google-strip.js';
import {decodePng} from '../supabase/functions/_shared/png.js';
const art={width:4,height:2,pixels:new Uint8Array([255,0,0,255, 0,255,0,255, 0,255,0,255, 0,0,255,255,255,0,0,255, 0,255,0,255, 0,255,0,255, 0,0,255,255])};
const d={colors:{primary:'#FFD1EB'},google:{showStamps:false},stamps:{}};
const px=(img,x,y)=>Array.from(img.pixels.slice((y*img.width+x)*4,(y*img.width+x)*4+4));
test('Google preserves both edges of wide artwork and uses the card background outside it',async()=>{
 const img=await decodePng(await makeGoogleStampHero(d,0,10,'passages',null,null,art));
 assert.equal(img.width,1032);assert.equal(img.height,812);
 assert.deepEqual(px(img,0,0),[255,209,235,255]);
 assert.deepEqual(px(img,0,406),[255,0,0,255]);
 assert.deepEqual(px(img,1031,406),[0,0,255,255]);
});
test('Google stamps update with balance; Apple visibility and colors cannot affect Google',async()=>{
 const cfg={...d,google:{showStamps:true},stamps:{filled:'#F2C94C',empty:'#FFFFFF'}};
 const empty=await makeGoogleStampHero(cfg,0,10);
 const earned=await makeGoogleStampHero(cfg,5,10);
 assert.notDeepEqual(empty,earned);
 assert.deepEqual(empty,await makeGoogleStampHero({...cfg,apple:{showStamps:false,colors:{primary:'#000000'}}},0,10));
});
test('Google-specific visibility hides stamps but preserves uploaded art',async()=>{
 assert.deepEqual(await makeGoogleStampHero(d,0,10,'passages',null,null,art),await makeGoogleStampHero(d,10,10,'passages',null,null,art));
});
