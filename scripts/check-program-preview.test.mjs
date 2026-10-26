import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {prepareProgramPreview} from '../src/program-card-preview.js';
import {makeCardDesigner} from '../src/card-designer.js';

const p={designMode:'custom',selfServiceStampId:'croissant',mode:'passages',goal:10,
  name:'Club Boulangerie',bg:'#FFFFFF',accent:'#EEEEEE',reward:'Café',cardDesign:null};
const kit=makeCardDesigner(React,null);
const draw=(program,platform='apple',extra={})=>{
  const design=prepareProgramPreview(program,'Boulangerie','',x=>x);
  return renderToStaticMarkup(React.createElement(kit.CardPreview,{design,platform,
    data:{isTest:false,programName:program.name,goal:10,mode:'passages',progress:3,client:'Nora',reward:'Café',cardNumber:'DPA 1234',qr:'DPA1:test',...extra}}));
};

test('new self-service preview uses real progression and gift at slot ten, without a front program title',()=>{
  const before=JSON.stringify(p),html=draw(p);
  assert.equal((html.match(/data-native-stamp=/g)||[]).length,10);
  assert.equal((html.match(/data-native-stamp="filled"/g)||[]).length,3);
  assert.equal((html.match(/stamps\/cadeau.png/g)||[]).length,1);
  assert.ok(html.indexOf('MEMBRE')<html.indexOf('RÉCOMPENSE'));
  assert.match(html,/Nora/);assert.match(html,/3 \/ 10/);assert.doesNotMatch(html,/Club Boulangerie/);
  assert.match(html,/data-dpa-qr="DPA1:test"/);assert.equal(JSON.stringify(p),before);
});

test('old self-service has its generic layout and saved designs retain all overrides',()=>{
  const old=draw({...p,selfServiceStampId:null});
  assert.match(old,/Club Boulangerie/);assert.doesNotMatch(old,/data-native-stamp/);assert.match(old,/CARTE/);
  for(const platform of ['apple','google']) {
    const compact=draw({...p,selfServiceStampId:null},platform,{onboarding:true});
    assert.doesNotMatch(compact,/data-field="program"|>CARTE<|N° de carte|Club Boulangerie/);
    assert.match(compact,/Nora/);assert.match(compact,/Café/);
    if(platform==='google')assert.match(compact,/data-google-brand="centered"/);
  }
  const advanced={...p,cardDesign:{identity:{name:'Sur mesure'},colors:{primary:'#123456'},stamps:{icon:'library',libraryId:'pizza',rewardId:'reward-star'},apple:{showBusinessName:true},google:{colors:{primary:'#654321'}}}};
  const saved=JSON.stringify(advanced),design=prepareProgramPreview(advanced,'Boulangerie','',x=>x);
  assert.equal(design.previewKind,undefined);assert.equal(design.stamps.rewardId,'reward-star');
  assert.equal(design.google.colors.primary,'#654321');assert.equal(JSON.stringify(advanced),saved);
});

test('Google preview orders issuer, program, member, counters, QR and stamp hero; reward is in details',()=>{
  const html=draw(p,'google');
  const order=['Boulangerie','Club Boulangerie','Membre','Passages effectués','data-field="qr"','data-google-stamp-panel','data-google-details'];
  for(let i=1;i<order.length;i++)assert.ok(html.indexOf(order[i])>html.indexOf(order[i-1]),order[i]);
  assert.equal((html.match(/stamps\/cadeau.png/g)||[]).length,1);
  assert.match(html,/Nora/);assert.match(html,/1234/);assert.match(html,/Café/);
});

test('explicit no-stamp programs stay compact outside onboarding and ignore an earlier stamp and hero',()=>{
  const simple={...p,selfServiceShowStamps:false,heroUrl:'/old-hero.png'};
  for(const platform of ['apple','google']) {
    const html=draw(simple,platform);
    assert.match(html,/self-service-simple/);assert.match(html,/3 \/ 10/);
    assert.match(html,/Nora/);assert.match(html,/Café/);assert.match(html,/data-dpa-qr="DPA1:test"/);
    assert.doesNotMatch(html,/data-native-stamp|data-stamp-slot|cadeau.png|old-hero.png|Club Boulangerie|>CARTE<|N° de carte/);
  }
});

test('self-service previews use saved opacity for remaining stamps while earned stamps stay opaque',()=>{
 for(const platform of ['apple','google']){
  const html=draw({...p,selfServiceInactiveOpacity:67},platform);
  assert.match(html,/opacity:0\.67/);assert.match(html,/opacity:1/);
  const hidden=draw({...p,selfServiceInactiveOpacity:0},platform);
  assert.match(hidden,/opacity:0;/);assert.match(hidden,/opacity:1/);
 }
});
