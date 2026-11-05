import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
function app(clipboard) {
  const context=vm.createContext({window:{innerWidth:1200,location:{pathname:'/',search:''}},document:{},
    navigator:{clipboard},console,setTimeout,clearTimeout,URLSearchParams,
    DCLogic:class {setState(patch){Object.assign(this.state,typeof patch==='function'?patch(this.state):patch);}}});
  vm.runInContext(script+'\nglobalThis.App=Component;',context);
  const a=new context.App();
  a.reqId=()=> 'same-enrollment-request';a.settleReq=()=>{};a.scrollTop=()=>assert.fail('Home enrollment must not leave its current position');
  a.toasts=[];a.showToast=(...args)=>a.toasts.push(args);
  Object.assign(a.state,{live:true,demo:false,hasAccess:true,role:'owner',screen:'home',clients:[],merchant:{id:'merchant-a'},
    f:{...a.state.f,joinFirst:' Nora ',joinEmail:'nora@example.com'},consent:true});
  return a;
}
const card={id:'card-created',first:'Nora',last:'',balance:0,history:[]};

test('home enrollment creates one card, remains home and offers that exact card for handoff',async()=>{
  const a=app();let calls=0;
  a.api={enroll:async(id,first,email)=>{calls++;assert.equal(id,'same-enrollment-request');assert.equal(first,'Nora');assert.equal(email,'nora@example.com');return card;}};
  await a.joinLive(a.state.f);
  assert.equal(calls,1);assert.equal(a.state.screen,'home');assert.equal(a.state.modal,'clientCreated');
  assert.equal(a.state.joinedId,card.id);assert.equal(a.state.clients[0],card);
  assert.equal(a.state.f.joinFirst,'');assert.equal(a.state.f.joinEmail,'');assert.equal(a.state.consent,false);
});

test('repeated clicks while enrollment is pending do not create another customer',async()=>{
  const a=app();let complete,calls=0;a.validate=()=>true;
  a.api={enroll:()=>{calls++;return new Promise(resolve=>{complete=resolve;});}};
  const pending=a.submitJoin();a.submitJoin();assert.equal(calls,1);
  complete(card);await pending;assert.equal(a.state.clients.length,1);assert.equal(a.state.busy,false);
});

test('failed enrollment leaves the form intact and never claims a card was created',async()=>{
  const a=app();a.api={enroll:async()=>{throw Error('network');},errorMessage:()=> 'Connexion interrompue'};
  await a.joinLive(a.state.f);
  assert.equal(a.state.busy,false);assert.equal(a.state.modal,null);assert.equal(a.state.clients.length,0);
  assert.equal(a.state.f.joinFirst,' Nora ');assert.equal(a.toasts[0][1],'error');
});

test('late enrollment results never appear under a different selected commerce',async()=>{
  const a=app();let complete;a.api={enroll:()=>new Promise(resolve=>{complete=resolve;})};
  const pending=a.joinLive(a.state.f);
  a.setState({merchant:{id:'merchant-b'},busy:false});complete(card);await pending;
  assert.equal(a.state.clients.length,0);assert.equal(a.state.modal,null);assert.equal(a.state.joinedId,null);
});

test('an existing card returned by an idempotent retry is not duplicated in the client list',async()=>{
  const a=app();a.state.clients=[card];a.api={enroll:async()=>card};
  await a.joinLive(a.state.f);assert.equal(a.state.clients.length,1);assert.equal(a.state.joinedId,card.id);
});

test('the explicit registration-on-this-device flow still opens the customer Wallet page',async()=>{
  const a=app();a.state.screen='join';a.scrollTop=()=>{};a.api={enroll:async()=>card};
  await a.joinLive(a.state.f);assert.equal(a.state.screen,'joinDone');assert.equal(a.state.modal,null);
});

test('Wallet copy reports success only after the clipboard accepts the link',async()=>{
  const failed=app({writeText:async()=>{throw Error('denied');}});
  await failed.copyWalletLink('https://wallet.example/link');assert.equal(failed.toasts[0][1],'error');
  assert.ok(!failed.toasts.some(([text])=>text==='Lien copié'));
  let copied;const success=app({writeText:async value=>{copied=value;}});
  await success.copyWalletLink('https://wallet.example/link');assert.equal(copied,'https://wallet.example/link');assert.equal(success.toasts[0][0],'Lien copié');
});
