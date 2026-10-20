import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realAppleBrand, realApplePassData } from '../supabase/functions/apple-pass/real-card.js';

const merchantId='11111111-1111-4111-8111-111111111111';
const programId='22222222-2222-4222-8222-222222222222';
const uuid='33333333-3333-4333-8333-333333333333';
const logoPath=merchantId+'/'+programId+'/designer/logo-'+uuid+'.png';
const wordmarkPath=merchantId+'/'+programId+'/designer/businessNameImage-'+uuid+'.png';
const appleHeaderPath=merchantId+'/'+programId+'/designer/appleHeader-'+uuid+'.png';

function sample(version) {
 return {
  program:{id:programId,mode:'passages',goal:10,bg:'#14202C',accent:'#FFFFFF',reward:'Un café',name:'Club',
   card_design:{identity:{name:'À fleur de peau'},apple:{showBusinessName:true,headerMode:'custom',headerArtworkVersion:version},
    assets:{logo:{path:logoPath},businessNameImage:{path:wordmarkPath},appleHeader:{path:appleHeaderPath}}}},
  merchant:{business_name:'À fleur de peau'},
  customer:{first_name:'Test',last_name:'Client'},
  card:{id:uuid,merchant_id:merchantId,program_id:programId,card_number:'DPA-00001234',qr_token:'QRTEST'},
  balance:3
 };
}

test('New Apple paired-header artwork appears as native logo alongside card number',()=>{
 const d=sample(5);
 const {brand,json}=realApplePassData(d);
 assert.equal(brand.appleHeader,appleHeaderPath);
 assert.equal(json.logoText,undefined);
 assert.equal(json.storeCard.headerFields[0].value,'1234');
 assert.equal(json.barcode.message,'DPA1:QRTEST');
});

test('Apple legacy version 4 remains compatible, unknown version falls back to native text',()=>{
 const old=realApplePassData(sample(4));
 assert.equal(old.brand.appleHeader,appleHeaderPath);
 const invalid=realApplePassData(sample(8));
 assert.equal(invalid.brand.appleHeader,null);
 assert.equal(invalid.json.logoText,'À fleur de peau');
});

test('New Google image is whitelisted and can be removed on future class updates',()=>{
 const server=readFileSync(new URL('../supabase/functions/wallet/index.ts',import.meta.url),'utf8');
 const designer=readFileSync(new URL('../src/card-designer.js',import.meta.url),'utf8');
 assert.match(server,/wideProgramLogo:/);
 assert.match(server,/delete next\.wideProgramLogo/);
 assert.match(server,/googleWideLogo/);
 assert.match(designer,/createGoogleWideLogo\(next\)/);
 assert.match(designer,/prepareBusinessNamePng\(f\)/);
});
