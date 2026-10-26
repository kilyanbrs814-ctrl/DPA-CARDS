import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {realApplePassData} from '../supabase/functions/apple-pass/real-card.js';
import {makeRealStrip} from '../supabase/functions/apple-pass/real-strip.js';
import {makeGoogleStampHero} from '../supabase/functions/wallet/google-strip.js';
import {decodePng} from '../supabase/functions/_shared/png.js';

test('native Apple mapping preserves selected opacity including zero and existing advanced designs',()=>{
 const program={design_mode:'custom',card_design:null,mode:'passages',goal:10,reward:'Café',self_service_stamp_id:'pizza',self_service_show_stamps:true};
 const data={merchant:{business_name:'Commerce'},customer:{first_name:'Nora'},card:{id:'id',qr_token:'qr'},balance:3};
 for(const opacity of [0,32,67,100])assert.equal(realApplePassData({...data,program:{...program,self_service_inactive_opacity:opacity}}).brand.stamps.inactiveOpacity,opacity);
 assert.equal(realApplePassData({...data,program}).brand.stamps.inactiveOpacity,32);
 const advanced={...program,self_service_inactive_opacity:90,card_design:{stamps:{inactiveOpacity:15}}};
 assert.equal(realApplePassData({...data,program:advanced}).brand.stamps.inactiveOpacity,15);
});

test('real Apple and Google bitmap renderers change only unearned stamp opacity, preserving colored earned stamps',async()=>{
 const pixels=new Uint8Array(8*8*4);for(let i=0;i<pixels.length;i+=4)pixels.set([220,60,20,255],i);
 const icon={width:8,height:8,pixels};
 const pixel=(png,x,y)=>[...png.pixels.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)];
 for(const platform of ['apple','google']){
  const render=async opacity=>{
   const stamps={icon:'library',libraryId:'pizza',inactiveOpacity:opacity,rewardId:'cadeau'};
   const bytes=platform==='apple'
    ?await makeRealStrip({primary:'#FFFFFF',secondary:'#FFFFFF',showStampPanel:false,selfServiceStamps:true,libraryId:'pizza',mode:'passages',stamps},1,10,1,icon,null,icon)
    :await makeGoogleStampHero({colors:{primary:'#FFFFFF'},selfServiceStamps:true,stamps},1,10,'passages',icon,icon);
   return decodePng(bytes,{maxDimension:1200,maxBytes:5000000});
  };
  const zero=await render(0),full=await render(100),middle=await render(67);
  const find=predicate=>{for(let i=0;i<zero.pixels.length;i+=4)if(predicate(i))return [(i/4)%zero.width,Math.floor(i/4/zero.width)];throw new Error('Expected stamp pixels: '+platform);};
  const acquired=find(i=>zero.pixels[i]===220&&zero.pixels[i+1]===60&&zero.pixels[i+2]===20);
  const unearned=find(i=>zero.pixels[i]===255&&full.pixels[i]<240&&full.pixels[i]===full.pixels[i+1]&&full.pixels[i+1]===full.pixels[i+2]);
  assert.deepEqual(pixel(zero,...acquired),pixel(full,...acquired),platform+' acquired stamp stays unchanged');
  assert.deepEqual(pixel(zero,...acquired),[220,60,20,255]);
  assert.deepEqual(pixel(zero,...unearned),[255,255,255,255],platform+' zero opacity shows background');
  const low=pixel(full,...unearned),mid=pixel(middle,...unearned);
  assert.ok(low[0]===low[1]&&low[1]===low[2],platform+' unearned stamp stays grayscale');
  assert.ok(mid[0]>low[0]&&mid[0]<255,platform+' chosen 67% is between transparent and fully opaque');
 }
});

test('opacity migration leaves existing rows unchanged, constrains the range and grants no browser writes',async()=>{
 const db=new PGlite();try{
 await db.exec("create role authenticated;create table programs(id int);insert into programs values(1);grant select on programs to authenticated;");
 await db.exec(readFileSync(new URL('../supabase/migrations/20261026230713_self_service_stamp_opacity.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select self_service_inactive_opacity from programs')).rows[0].self_service_inactive_opacity,null);
 for(const n of [-1,101])await assert.rejects(db.query('update programs set self_service_inactive_opacity=$1',[n]),/check constraint/);
 await db.exec('set role authenticated;');await assert.rejects(db.exec('update programs set self_service_inactive_opacity=67'),/permission denied/);
 }finally{await db.close();}
});
