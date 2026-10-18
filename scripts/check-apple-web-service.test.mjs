import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passAuthToken, passServiceUrl, validPassToken } from '../supabase/functions/apple-pass/auth.js';
import { handlePasskit } from '../supabase/functions/apple-pass/web-service.js';

const card='10000000-0000-4000-8000-000000000001';
const signer='-----BEGIN PRIVATE KEY-----\ntest-secret-signer\n-----END PRIVATE KEY-----';
const base='https://fiuffxchvjcghcvfaout.supabase.co/functions/v1/apple-pass';
function mock(){
  const state={registrations:[],devices:[],changes:[]};
  return {state,admin:{
    from(table){return {
      select(){
        const chain={
          eq(field,value){
            this.where={...(this.where||{}),[field]:value};
            return this;
          },
          maybeSingle:async()=>({data:table==='cards'?{id:card}:null,error:null}),
        };
        return chain;
      },
      upsert:async(data)=>{
        state[table==='apple_wallet_registrations'?'registrations':table==='apple_wallet_devices'?'devices':'changes'].push(data);
        return {error:null};
      },
    }}
  }};
}
test('Apple PassKit authorization is deterministic and cannot be guessed from a card ID',async()=>{
  const a=await passAuthToken(card,signer);
  const b=await passAuthToken(card,signer);
  assert.equal(a,b);
  assert.equal(a.length,64);
  assert.ok(validPassToken(a,b));
  assert.equal(validPassToken('z'.repeat(64),a),false);
  assert.notEqual(a,await passAuthToken('10000000-0000-4000-8000-000000000002',signer));
  assert.equal(passServiceUrl('https://fiuffxchvjcghcvfaout.supabase.co/'),base);
});
test('Wallet can register a pass, but rejects an incorrect ApplePass token',async()=>{
  const {admin,state}=mock();
  const url=base+'/v1/devices/test_device_123456/registrations/pass.fr.digitalprojectagency.cards/'+card;
  const token=await passAuthToken(card,signer);
  const denied=await handlePasskit(new Request(url,{method:'POST',headers:{Authorization:'ApplePass invalid'},body:JSON.stringify({pushToken:'A'.repeat(64)})}),
    {admin,signerKey:signer,renderPass:async()=>({pkpass:new Uint8Array([1])})});
  assert.equal(denied.status,401);assert.equal(state.registrations.length,0);
  const ok=await handlePasskit(new Request(url,{method:'POST',headers:{Authorization:'ApplePass '+token},body:JSON.stringify({pushToken:'A'.repeat(64)})}),
    {admin,signerKey:signer,renderPass:async()=>({pkpass:new Uint8Array([1])})});
  assert.equal(ok.status,201);
  assert.equal(state.registrations[0].card_id,card);
  assert.equal(state.devices[0].push_token,'A'.repeat(64));
});
test('Wallet returns only an authorized and signed updated pass',async()=>{
  const {admin}=mock(),token=await passAuthToken(card,signer);
  const url=base+'/v1/passes/pass.fr.digitalprojectagency.cards/'+card;
  const forbidden=await handlePasskit(new Request(url,{headers:{Authorization:'ApplePass bad'}}),
    {admin,signerKey:signer,renderPass:async()=>({pkpass:new Uint8Array([1])})});
  assert.equal(forbidden.status,401);
  let rendered=false;
  const ok=await handlePasskit(new Request(url,{headers:{Authorization:'ApplePass '+token}}),
    {admin,signerKey:signer,renderPass:async()=>{rendered=true;return {pkpass:new Uint8Array([80,75,3,4])}}});
  assert.equal(ok.status,200);
  assert.match(ok.headers.get('content-type'),/apple.pkpass/);
  assert.equal(rendered,true);
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())],[80,75,3,4]);
});
