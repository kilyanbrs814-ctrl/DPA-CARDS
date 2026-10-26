import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
function app(){
 const context=vm.createContext({window:{innerWidth:1200,location:{pathname:'/',search:''}},document:{},console,setTimeout,clearTimeout,URLSearchParams,DCLogic:class {setState(p){Object.assign(this.state,typeof p==='function'?p(this.state):p);}}});
 vm.runInContext(script+'\nglobalThis.App=Component;',context);
 const a=new context.App(); a.reqId=()=> 'request'; a.settleReq=()=>{}; a.scrollTop=()=>{}; a.showToast=()=>{}; return a;
}
test('Other profession is required, sent to merchant persistence and restored on resume',async()=>{
 const a=app(); a.state.ob={...a.state.ob,biz:'Fleurs',activity:'Autre',otherActivity:''}; a.obNext(); assert.equal(a.state.ob.step,1); assert.ok(a.state.err.obactivity);
 a.state.ob.otherActivity=' Fleuriste '; a.obNext(); assert.equal(a.state.ob.step,2);
 a.state.program=null; a.state.merchant={first:'A',last:'B'};
 let payload;
 a.api={createMerchant:async p=>{payload=p;return {merchant:{},program:{designStatus:'draft',mode:'passages',goal:10,reward:''}};},toMerchant:()=>({id:'m',business:'Fleurs',activity:'Fleuriste'})};
 await a.obCreateProgram(); assert.equal(payload.activity,'Fleuriste'); assert.equal(a.state.ob.step,3);
 const resumed=a.obStep3({business:'Fleurs',activity:'Fleuriste',first:'A',last:'B'},{mode:'passages',goal:10});
 assert.equal(resumed.activity,'Autre'); assert.equal(resumed.otherActivity,'Fleuriste');
});
test('custom design requests without access always lead to offer selection, even if design was paid',async()=>{
 for(const paymentStatus of ['unpaid','paid']){
 const a=app(); a.state.hasAccess=false; a.state.ob={...a.state.ob,drDesc:'Une carte bleue avec mon logo',drName:'Client',drEmail:'client@example.com'};
 a.api={submitDesignRequest:async()=>({id:'req',paymentStatus})};
 await a.obSubmitRequest(); assert.equal(a.state.screen,'billing'); assert.equal(a.state.designReq.id,'req'); assert.equal(a.state.busy,false);
 }
});
test('returning unpaid merchant resumes at offer selection instead of dashboard',async()=>{
 const a=app(); a.api={loadAll:async()=>({merchant:{id:'m'},program:{designStatus:'pending_dpa'},clients:[],hasAccess:false,designRequest:{status:'pending_payment'}})};
 await a.openLive({user:{id:'u'}}); assert.equal(a.state.screen,'billing');
});
test('self-service card validation opens offer selection immediately when access is absent',async()=>{
 const a=app(); a.state.live=true; a.state.ob={...a.state.ob,biz:'Fleurs',prog:'Club Fleurs',hex:'#FFFFFF'}; a.state.program={logoPath:'logo.png'};
 a.saveDraftNow=async()=>{};
 a.api={stampCatalog:[{id:'cafe'}],finalizeDesign:async()=>({}),session:async()=>({user:{id:'u'}}),loadAll:async()=>({program:{},merchant:{},hasAccess:false})};
 await a.obValidateCustom(); assert.equal(a.state.screen,'billing'); assert.equal(a.state.hasAccess,false);
});
