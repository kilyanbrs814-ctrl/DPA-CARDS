import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {STAMP_LIBRARY,stampById,stampImageUrl,filterStamps,mergedStampCatalog} from '../src/stamp-library.js';
import {decodePng} from '../supabase/functions/_shared/png.js';
import {compositeEmoji} from '../supabase/functions/apple-pass/emoji-art.js';
import {makeRealStrip,makeDemoStrip,makeGoogleStampHero} from '../supabase/functions/apple-pass/real-strip.js';
import {libraryStampId,LIBRARY_STAMP_IDS} from '../supabase/functions/_shared/stamp-library.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
test('all 39 catalogue entries are actually shipped as transparent 256px PNGs',async()=>{
  assert.equal(STAMP_LIBRARY.length,39);
  assert.equal(new Set(STAMP_LIBRARY.map(x=>x.id)).size,39);
  assert.deepEqual(STAMP_LIBRARY.map(x=>x.id),LIBRARY_STAMP_IDS);
  for(const item of STAMP_LIBRARY){
    const pathname='public'+stampImageUrl(item.id);
    const bytes=read(pathname);const png=await decodePng(bytes,{maxDimension:512});
    assert.deepEqual([png.width,png.height],[256,256],item.id);
    assert.equal(png.pixels[3],0,'transparent edge '+item.id);
    assert.ok(png.pixels.some((value,i)=>i%4===3 && value>150),'visible icon '+item.id);
    assert.equal(stampById(item.id).label,item.label);
    assert.equal(libraryStampId(item.id),item.id);
  }
  assert.equal(libraryStampId('../logo'),'');
  assert.equal(libraryStampId('https://evil.invalid/image.png'),'');
  assert.equal(stampImageUrl('outside'),'');
  assert.equal(filterStamps('coiffeur')[0].id,'barber');
});
test('Wallet strips display original colors for completed PNG and grayscale for pending PNG',async()=>{
  const icon=await decodePng(read('public/assets/stamps/burger.png'));
  const colors={primary:'#111827',secondary:'#2448F0'};
  const stamps={icon:'library',libraryId:'burger',emoji:''};
  const a=await makeRealStrip({...colors,stamps,libraryId:'burger',mode:'passages'},3,10,1,icon);
  const b=await makeDemoStrip({colors,stamps,preview:{progress:3,goal:10,mode:'passages'}},1,icon);
  assert.deepEqual(a,b,'same renderer for real and test cards');
  const zero=await makeRealStrip({...colors,stamps,libraryId:'burger',mode:'passages'},0,10,1,icon);
  assert.notDeepEqual(a,zero);
  const picture=await decodePng(a);
  let colored=false;
  for(let p=0;p<picture.pixels.length;p+=4){
    const r=picture.pixels[p],g=picture.pixels[p+1],bl=picture.pixels[p+2];
    if(r>120 && r>g*1.2 && g>bl*.6)colored=true;
  }
  assert.ok(colored,'completed stamps preserve native image colors');
  // A stamp composited over a colored card takes on the card background tint:
  // verify true grayscale on a neutral backdrop instead of comparing final RGB channels.
  const neutral=new Uint8Array(64*64*4);
  for(let i=0;i<neutral.length;i+=4)neutral.set([20,20,20,255],i);
  compositeEmoji(neutral,64,64,32,32,40,icon,false);
  let gray=false;
  for(let i=0;i<neutral.length;i+=4){
    if(neutral[i]>20 && neutral[i]===neutral[i+1] && neutral[i+1]===neutral[i+2]){gray=true;break;}
  }
  assert.ok(gray,'pending icon is gray and faded at source before card composition');
  const google=await makeGoogleStampHero({colors,stamps},3,10,'passages',icon);
  const gp=await decodePng(google,{maxDimension:1200,maxBytes:5000000});
  assert.deepEqual([gp.width,gp.height],[1032,812]);
});

test('Google Drive stamps show only one entry alongside the built-in library, without changing saved references',()=>{
  const names=[
    'baguette','cadeau','ciseaux','crousty','donuts','e liquide',
    'emoji bao pain blanc graines noires','emoji burger deux pains noirs',
    'emoji burger pain noir bas','emoji burger pain noir haut',
    'glace','Icône de cheveux bruns brillants en 3D','pizza','tacos 2','vape','wok',
  ];
  const remote=names.map((label,n)=>({id:'gd-DRIVESTAMPS'+String(n).padStart(5,'0'),label}));
  const original=STAMP_LIBRARY.map(x=>x.id);
  const items=mergedStampCatalog(remote);
  assert.equal(STAMP_LIBRARY.length,39,'the built-in library must stay intact');
  assert.deepEqual(STAMP_LIBRARY.map(x=>x.id),original,'never mutate the static catalogue');
  assert.equal(items.length,43,'12 overlapping icons are hidden, four distinct burger/bao designs remain');
  for(const label of ['baguette','cadeau','ciseaux','crousty','donuts','e liquide','pizza','tacos 2','vape','wok']){
    const item=remote.find(x=>x.label===label);
    assert.equal(items.filter(x=>x.id===item.id).length,1,label);
  }
  for(const label of ['emoji bao pain blanc graines noires','emoji burger deux pains noirs','emoji burger pain noir bas','emoji burger pain noir haut']){
    assert.ok(items.some(x=>x.label===label),'distinct variant remains: '+label);
  }
  const pizza=remote.find(x=>x.label==='pizza');
  const staticPizza=mergedStampCatalog(remote,'pizza');
  assert.ok(staticPizza.some(x=>x.id==='pizza'),'an existing card with built-in pizza remains selected');
  assert.ok(!staticPizza.some(x=>x.id===pizza.id),'selected built-in pizza is not duplicated');
  const drivePizza=mergedStampCatalog(remote,pizza.id);
  assert.ok(drivePizza.some(x=>x.id===pizza.id),'an existing card with imported pizza remains selected');
  assert.ok(!drivePizza.some(x=>x.id==='pizza'),'imported pizza and built-in pizza are not both shown');
  const two=[{id:'gd-DRIVESTAMPS00997',label:'Pâtisserie artisanale'},
    {id:'gd-DRIVESTAMPS00998',label:'patisserie-artisanale'}];
  assert.equal(mergedStampCatalog(two).length,40,'different Drive files with the same label appear once');
  assert.equal(mergedStampCatalog(two,two[1].id).at(-1).id,two[1].id,'keep the selected Drive duplicate');
  assert.equal(mergedStampCatalog([{id:'invalid',label:'pizza'}]).length,39,'ignore invalid Drive ids');
});
