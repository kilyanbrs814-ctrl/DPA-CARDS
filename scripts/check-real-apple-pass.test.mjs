import { parseCode } from '../src/scanner.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realAppleBrand, realApplePassData, assetPath, onBackground, visibleCardNumber, appleHeaderName } from '../supabase/functions/apple-pass/real-card.js';

const MID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const token = '44444444-4444-4444-8444-444444444444';
const folder = MID + '/' + PID;
const logo = folder + '/designer/logo-' + token + '.png';
const cover = folder + '/designer/hero-' + token + '.jpg';
const card = { id: ID, merchant_id: MID, program_id: PID, qr_token: token, card_number: 'DPA 0001' };
const merchant = { business_name: 'Commerce réel' };
const customer = { first_name: 'Nicolas', last_name: 'Moreau' };
const program = { name: 'Fidélité artisan', mode: 'passages', goal: 10, reward: 'Un dessert offert',
  design_status: 'validated', bg: '#282B34', accent: '#2854FF', logo_path: logo, hero_path: cover,
  card_design: { identity: { name: 'Boulangerie des Arts', subtitle: 'Artisans gourmands' },
    colors: { primary: '#16191F', secondary: '#2854FF', text: '#FFFFFF', accent: '#F2C94C' },
    apple: { colors: { primary: '#20242A' }, showHero: true, heroFocus: 75, showSubtitle: true, label: 'TAMPONS' },
    assets: { logo: {path:logo}, hero: {path:cover} }, stamps: { filled: '#F2C94C' },
    preview: { client: 'FAUX CLIENT', progress: 99, reward: 'FAUSSE RÉCOMPENSE' },
  } };

test('real pass honors merchant validated Apple design and true customer data', () => {
  const { brand, json, balance, goal } = realApplePassData({program,merchant,customer,card,balance:3});
  assert.equal(brand.issuer,'Boulangerie des Arts');
  assert.equal(brand.primary,'#20242A');
  assert.equal(brand.logo,logo);
  assert.equal(brand.artwork,cover);
  assert.equal(brand.heroFocus,75);
  assert.equal(brand.stamps.filled,'#F2C94C');
  assert.equal(json.storeCard.primaryFields[0].value,'3 / 10');
  assert.equal(json.storeCard.primaryFields[0].label,'TAMPONS');
  assert.equal(json.storeCard.secondaryFields[0].value,'Nicolas Moreau');
  assert.equal(json.storeCard.secondaryFields[1].value,'Un dessert offert');
  assert.equal(json.organizationName,'Boulangerie des Arts');
  assert.equal(json.barcode.message,'DPA1:'+token);
  assert.equal(json.serialNumber,ID);
  assert.equal(json.storeCard.backFields[0].value,'Artisans gourmands');
  assert.equal(goal,10);assert.equal(balance,3);
  assert.ok(!JSON.stringify(json).includes('FAUX CLIENT'));
  assert.ok(!JSON.stringify(json).includes('FAUSSE RÉCOMPENSE'));
});
test('Apple overrides do not alter Google settings and can hide hero/subtitle', () => {
  const p = structuredClone(program);
  p.card_design.apple.showHero=false;p.card_design.apple.showSubtitle=false;
  p.card_design.apple.useBackground=false;
  p.card_design.google={colors:{primary:'#FF0000'}};
  const a=realAppleBrand(p,merchant,card);
  assert.equal(a.artwork,null);
  assert.equal(a.subtitle,'');
  assert.equal(a.primary,'#20242A');
});
test('Apple stamp panel can be hidden without changing native counters, card number or QR',()=>{
  const visible=realApplePassData({program,merchant,customer,card,balance:3});
  assert.equal(visible.brand.showStampPanel,true,'saved older designs show stamps by default');
  const hidden=structuredClone(program);
  hidden.card_design.apple.showStampPanel=false;
  const result=realApplePassData({program:hidden,merchant,customer,card,balance:3});
  assert.equal(result.brand.showStampPanel,false);
  assert.deepEqual(result.json.storeCard,visible.json.storeCard);
  assert.deepEqual(result.json.barcode,visible.json.barcode);
  assert.equal(result.json.serialNumber,visible.json.serialNumber);
});
test('Apple native business name is opt-in and uses saved commerce text', () => {
  const p=structuredClone(program);
  assert.equal(realApplePassData({program:p,merchant,customer,card,balance:2}).json.logoText,undefined,'existing cards stay unchanged');
  p.card_design.apple.showBusinessName=true;
  const {brand,json}=realApplePassData({program:p,merchant,customer,card,balance:2});
  assert.equal(brand.showBusinessName,true);
  assert.equal(json.logoText,'Boulangerie des Arts','merchant name stays complete in native logoText');
  assert.equal(json.organizationName,'Boulangerie des Arts');
  assert.equal(json.storeCard.secondaryFields[0].value,'Nicolas Moreau','counter/customer data must be unchanged');
  p.card_design.apple.showBusinessName=false;
  assert.equal(realApplePassData({program:p,merchant,customer,card,balance:2}).json.logoText,undefined);
});
test('saved raster logo+name is ignored: real Wallet shows uploaded logo and full native name',()=>{
  const p=structuredClone(program);
  p.card_design.apple.showBusinessName=true;
  p.card_design.stamps.emoji='🍔'; // stamp-based passes have the native 4-digit header field
  const legacy=folder+'/designer/appleHeader-'+token+'.png';
  p.card_design.assets.appleHeader={path:legacy};
  p.card_design.apple.headerArtworkVersion=3;
  const {brand,json}=realApplePassData({program:p,merchant,customer,card,balance:2});
  assert.equal(brand.appleHeader,null,'never use rasterized lettering');
  assert.equal(brand.logo,logo,'keep independently uploaded logo');
  assert.equal(json.logoText,'Boulangerie des Arts');
  assert.equal(json.storeCard.headerFields[0].value,'0001');
  assert.equal(json.barcode.message,'DPA1:'+token);
  p.card_design.apple.showBusinessName=false;
  assert.equal(realApplePassData({program:p,merchant,customer,card,balance:2}).json.logoText,undefined);
});
test('branded background is preferred over hero when specifically selected', () => {
  const p=structuredClone(program);
  p.card_design.apple.useBackground=true;
  p.card_design.assets.background={path:folder+'/designer/background-'+token+'.jpg'};
  assert.equal(realAppleBrand(p,merchant,card).artwork,p.card_design.assets.background.path);
});
test('real pass is usable before merchant has a custom designer project', () => {
  const p={name:'Passages',mode:'points',goal:100,reward:'Boisson',bg:'#FFFFFF',card_design:null};
  const {brand,json}=realApplePassData({program:p,merchant,customer,card,balance:65});
  assert.equal(brand.issuer,'Commerce réel');
  assert.equal(brand.primary,'#FFFFFF');
  assert.equal(brand.foreground,'#1C1F24');
  assert.equal(json.storeCard.primaryFields[0].value,'65 / 100 pts');
});
test('cross-program paths and path traversal are rejected with service-role storage', () => {
  assert.equal(assetPath('../private.png',card,'logo'),null);
  assert.equal(assetPath('tests/'+ID+'/designer/logo-'+token+'.png',card,'logo'),null);
  assert.equal(assetPath(MID+'/'+ID+'/designer/logo-'+token+'.png',card,'logo'),null);
  assert.equal(assetPath(folder+'/designer/hero-'+token+'.jpg',card,'logo'),null);
  assert.equal(assetPath(folder+'/designer/logo-'+token+'.png',card,'logo'),logo);
});
test('accessibility contrasts invalid same-colored foreground',()=>{
  assert.equal(onBackground('#000000','#000000'),'#FFFFFF');
  assert.equal(onBackground('#FFFFFF','#FFFFFF'),'#1C1F24');
});

test('emoji design keeps card number at top, two counters, and branded QR footer on Apple front', () => {
  const p=structuredClone(program);
  p.card_design.stamps.emoji='🍔';
  const {brand,json}=realApplePassData({program:p,merchant,customer,card,balance:3});
  assert.equal(brand.emoji,'🍔');
  assert.equal(json.storeCard.headerFields[0].value,'0001');
  assert.equal(json.storeCard.primaryFields[0].value,'\u00a0');
  assert.equal(json.storeCard.secondaryFields.length,2);
  assert.equal(json.storeCard.secondaryFields[0].label,'Passages effectués');
  assert.equal(json.storeCard.secondaryFields[0].value,'3');
  assert.equal(json.storeCard.secondaryFields[0].textAlignment,'PKTextAlignmentLeft');
  assert.equal(json.storeCard.secondaryFields[1].label,'Passages restants');
  assert.equal(json.storeCard.secondaryFields[1].value,'7');
  assert.equal(json.storeCard.secondaryFields[1].textAlignment,'PKTextAlignmentRight');
  assert.equal(json.storeCard.auxiliaryFields?.length||0,0);
  assert.equal(json.barcode.message,'DPA1:'+token);
  assert.equal(json.barcode.altText,'Par DPA Cards');
  assert.equal(json.storeCard.backFields.find(f=>f.key==='full_card').value,card.card_number);
  assert.ok(!JSON.stringify(json.storeCard.secondaryFields).includes('Nicolas'));
  assert.ok(!JSON.stringify(json.storeCard.secondaryFields).includes('dessert'));
  assert.equal(visibleCardNumber('DPA-DEMO-0003'),'0003');
  assert.equal(visibleCardNumber('ABC'),'ABC','do not invent an unusable numeric ID');
});
test('points-mode real pass retains actual running balance and remaining target', () => {
  const p=structuredClone(program);
  p.mode='points';p.goal=100;
  p.card_design.stamps.emoji='⭐';
  const {json}=realApplePassData({program:p,merchant,customer,card,balance:37});
  assert.equal(json.storeCard.secondaryFields[0].label,'Points gagnés');
  assert.equal(json.storeCard.secondaryFields[0].value,'37');
  assert.equal(json.storeCard.secondaryFields[1].label,'Points restants');
  assert.equal(json.storeCard.secondaryFields[1].value,'63');
});

test('number printed on real pass works with manual scanner fallback', () => {
  const value=visibleCardNumber('DPA-00001234');
  assert.equal(value,'1234');
  assert.deepEqual(parseCode(value),{kind:'suffix',code:'1234'});
});

test('Apple header leaves room between merchant and last four digits',()=>{
  assert.equal(appleHeaderName('Commerce test'),'Commerce test');
  assert.equal(appleHeaderName('Barber Factory'),'Barber Factory');
  assert.equal(visibleCardNumber('TEST 931f x3'),'9313');
  const p=structuredClone(program);p.card_design.stamps.emoji='💧';
  const {json}=realApplePassData({program:p,merchant,customer,card,balance:3});
  assert.ok(!Object.hasOwn(json,'logoText'));
  assert.equal(json.storeCard.headerFields[0].value,'0001');
  assert.equal(json.barcode.altText,'Par DPA Cards');
});

test('custom Apple header is opt-in, keeps QR and preserves instant return to native',()=>{
  const p=structuredClone(program);
  p.card_design.stamps.emoji='🍔';
  p.card_design.apple.showBusinessName=true;
  const path=folder+'/designer/appleHeader-'+token+'.png';
  p.card_design.assets.appleHeader={path};
  p.card_design.apple.headerArtworkVersion=4;
  let {brand,json}=realApplePassData({program:p,merchant,customer,card,balance:4});
  assert.equal(brand.appleHeader,null,'classic remains default');
  assert.equal(json.logoText,'Boulangerie des Arts');
  p.card_design.apple.headerMode='custom';
  ({brand,json}=realApplePassData({program:p,merchant,customer,card,balance:4}));
  assert.equal(brand.appleHeader,path);
  assert.equal(json.logoText,undefined,'do not print native text over custom image');
  assert.equal(json.storeCard.headerFields[0].value,'0001');
  assert.equal(json.storeCard.secondaryFields[0].value,'4');
  assert.equal(json.barcode.message,'DPA1:'+token);
  p.card_design.apple.headerMode='classic';
  ({brand,json}=realApplePassData({program:p,merchant,customer,card,balance:4}));
  assert.equal(brand.appleHeader,null,'original image remains stored but unused');
  assert.equal(json.logoText,'Boulangerie des Arts');
  p.card_design.apple.headerMode='custom';
  p.card_design.apple.headerArtworkVersion=3;
  ({brand,json}=realApplePassData({program:p,merchant,customer,card,balance:4}));
  assert.equal(brand.appleHeader,null,'old bitmap is ignored');
  assert.equal(json.logoText,'Boulangerie des Arts');
});
