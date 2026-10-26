import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {walletUserHeaders,selectedMembership} from '../supabase/functions/_shared/merchant-context.ts';
import {selfServiceChoice} from '../supabase/functions/_shared/self-service-layout.js';

const source=readFileSync(new URL('../supabase/functions/wallet/index.ts',import.meta.url),'utf8');
class HttpError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
function extract(start,end,context){
 const code=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 return vm.runInNewContext(stripTypeScriptTypes(code)+';'+start.match(/function (\w+)/)[1],context);
}

test('real Wallet authentication forwards explicit profile and web-view together; old clients retain primary scope',async()=>{
 for(const selected of [null,'secondary']){
  let options;
  const user={id:'owner'},client={auth:{getUser:async token=>{assert.equal(token,'owner-token');return {data:{user}};}}};
  const authUser=extract('async function authUser','// Real format and dimensions',{
   SUPABASE_URL:'https://test.supabase.co',PUBLISHABLE_KEY:'publishable',HttpError,walletUserHeaders,
   createClient:(url,key,o)=>{options=o;return client;}
  });
  const headers={authorization:'Bearer owner-token',...(selected?{'x-merchant-id':selected}:{})};
  const result=await authUser(new Request('https://test/finalize-design',{headers}));
  assert.equal(result.user,user);assert.equal(result.userClient,client);
  assert.equal(options.global.headers.Authorization,'Bearer owner-token');
  assert.equal(options.global.headers['x-dpa-web-profiles'],selected?'1':undefined);
  assert.equal(options.global.headers['x-merchant-id'],selected||undefined);
  await assert.rejects(authUser(new Request('https://test/finalize-design')),e=>e.code==='not_authenticated');
 }
 assert.equal(walletUserHeaders(new Request('https://test',{headers:{'x-dpa-web-profiles':'1'}}))['x-dpa-web-profiles'],undefined,'Only explicit profile selection enables the internal view');
});

test('real finalization keeps owner checks and selected program; errors are not misreported as missing programs',async()=>{
 for(const mode of ['success','query-error','no-program','staff','foreign']){
  const member={merchant_id:'secondary',role:mode==='staff'?'staff':'owner'};
  const program={id:'program-b',merchant_id:'secondary',is_active:true,design_status:'draft',logo_path:'secondary/program-b/logo.png',hero_path:null,bg:'#FFFFFF'};
  let checks=0,patch;
  const query=table=>{
   const filters=[];let update;
   const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},is:(k,v)=>{filters.push([k,v]);return q;},update:p=>{update=p;return q;},
    single:async()=>({data:{business_name:'Commerce B'}}),
    maybeSingle:async()=>{
     assert.ok(filters.some(([k,v])=>k==='merchant_id'&&v==='secondary')||update,'Selected commerce is always constrained');
     if(update){patch=update;return {data:{...program,...update}};}
     if(mode==='query-error')return {data:null,error:{code:'42501'}};
     return {data:mode==='no-program'?null:program,error:null};
    },
    then:resolve=>resolve({data:mode==='foreign'?[]:[member],error:null})};
   return q;
  };
  const admin={from:query},userClient={from:query};
  const finalize=extract('async function finalizeDesign','const CARD_SELECT',{
   authUser:async()=>({user:{id:'owner'},userClient}),admin,selectedMembership,selfServiceChoice,HttpError,
   checkImage:async(path)=>{assert.equal(path,program.logo_path);checks++;},
   ensureClass:async p=>{assert.equal(p.id,'program-b');assert.equal(p.self_service_show_stamps,true);assert.equal(p.self_service_inactive_opacity,67);return 'class-b';},
   json:(req,status,body)=>({status,body}),console
  });
  const req=new Request('https://test/finalize-design',{method:'POST',headers:{'Content-Type':'application/json','x-merchant-id':'secondary'},body:JSON.stringify({show_stamps:true,stamp_id:'pizza',inactive_opacity:67})});
  if(mode==='success'){
   assert.equal((await finalize(req)).status,200);assert.equal(checks,1);
   assert.equal(patch.self_service_show_stamps,true);assert.equal(patch.self_service_stamp_id,'pizza');assert.equal(patch.self_service_inactive_opacity,67);
  }else{
   const expected={staff:'forbidden',foreign:'forbidden','query-error':'db_programs','no-program':'no_program'}[mode];
   await assert.rejects(finalize(req),e=>e.message===expected);assert.equal(patch,undefined);
  }
 }
});
