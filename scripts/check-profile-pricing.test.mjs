import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activationFee,activationTotal,monthlyTotal,prepaidProration} from '../supabase/functions/_shared/profile-pricing.js';
import {rememberedProfile,changeProfile,profileKey} from '../src/merchant-profiles.js';
test('monthly totals have no volume discount or ten-commerce limit',()=>{
 for(let n=1;n<=100;n++)assert.equal(monthlyTotal(n),n*2000);
});
test('activation ranks and cumulative totals; batch equals separate dates',()=>{
 assert.deepEqual(Array.from({length:12},(_,i)=>activationFee(i+1)),[5000,3000,2500,2000,1500,1500,1500,1500,1500,1500,1500,1500]);
 assert.deepEqual(Array.from({length:10},(_,i)=>activationTotal(0,i+1)),[5000,8000,10500,12500,14000,15500,17000,18500,20000,21500]);
 assert.equal(activationTotal(0,27),Array.from({length:27},(_,i)=>activationTotal(i,1)).reduce((a,b)=>a+b,0));
 for(const bad of [0,-1,1.5,NaN])assert.throws(()=>activationFee(bad));
});
test('annual top-up prorates actual legacy monthly price and preserves original end',()=>{
 assert.equal(prepaidProration(1990,4000,0,1200,600,12),12060);
 assert.equal(prepaidProration(2000,4000,0,1200,600,12),12000);
 assert.equal(prepaidProration(2000,4000,0,1200,1200,12),0);
});
test('device-local selection validates access and destroys the old document on switch',()=>{
 const map=new Map([[profileKey('u'),'removed']]),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const memberships=[{merchant_id:'a'},{merchant_id:'b'}];
 assert.equal(rememberedProfile(storage,'u',memberships).merchant_id,'a');
 let destination;changeProfile(storage,{replace:p=>destination=p},'u','b',memberships);
 assert.equal(destination,'/');assert.equal(rememberedProfile(storage,'u',memberships).merchant_id,'b');
 assert.throws(()=>changeProfile(storage,{replace:()=>assert.fail()},'u','foreign',memberships));
 assert.equal(rememberedProfile(storage,'other',memberships).merchant_id,'a');
});
