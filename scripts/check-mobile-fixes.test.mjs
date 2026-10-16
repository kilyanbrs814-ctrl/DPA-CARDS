import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {publicSiteUrl} from '../src/public-site.js';
import {completePasswordSetup} from '../src/password-setup.js';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('iOS QR and shared links use public HTTPS while local web development retains its origin',()=>{
 for(const loc of [{protocol:'capacitor:',hostname:'localhost',origin:'capacitor://localhost'},{protocol:'https:',hostname:'cards.digitalprojectagency.fr',origin:'https://cards.digitalprojectagency.fr'}])assert.equal(publicSiteUrl(loc),'https://cards.digitalprojectagency.fr');
 assert.equal(publicSiteUrl({protocol:'http:',hostname:'localhost',origin:'http://localhost:4176'}),'http://localhost:4176');
 const code=page.slice(page.indexOf('const PUBLIC_SITE='),page.indexOf('function joinUrl('));
 const result=vm.runInNewContext(code+'PUBLIC_SITE',{window:{location:{protocol:'capacitor:',hostname:'localhost',origin:'capacitor://localhost'}}});
 assert.equal(result,'https://cards.digitalprojectagency.fr');
});
test('password setup signs in with the new password before the workspace opens',async()=>{
 const calls=[];const session={user:{id:'u'}};
 const result=await completePasswordSetup({updateUser:async()=>{calls.push('save');return {data:{user:{email:'example@example.com'}},error:null}},signInWithPassword:async({email,password})=>{calls.push('signIn');assert.equal(password,'example-password');return {data:{session},error:null}}},'example-password');
 assert.deepEqual(calls,['save','signIn']);assert.equal(result.session,session);
});
test('an expired recovery session or network failure after saving does not claim the password failed',async()=>{
 for(const network of [false,true]){
 let signedOut=false;
 const result=await completePasswordSetup({updateUser:async()=>({data:{user:{email:'example@example.com'}}}),signInWithPassword:async()=>{if(network)throw Error('offline');return {error:{code:'session_expired'}}},signOut:async()=>{signedOut=true}},'example-password');
 assert.equal(result.error,null);assert.equal(result.session,null);assert.equal(signedOut,true);
 }
});
test('password save errors remain on the form and do not attempt sign-in',async()=>{
 const error={code:'weak_password'};assert.deepEqual(await completePasswordSetup({updateUser:async()=>({error})},'bad'),{error});
});
test('system insets are reserved once and viewport metadata stays consistent',()=>{
 const css=readFileSync(new URL('../src/mobile-layout.css',import.meta.url),'utf8');
 assert.ok(css.includes('100dvh - var(--dpa-safe-top) - var(--dpa-safe-bottom)'));
 for(const html of [page,readFileSync(new URL('../admin.html',import.meta.url),'utf8')]){
 assert.ok(!html.includes('100vh'));assert.ok(html.includes('/src/mobile-layout.css'));
 for(const m of html.matchAll(/<meta name="viewport" content="([^"]+)"/g))assert.ok(m[1].includes('viewport-fit=cover'));
 }
});
test('admin invitations from iOS use HTTPS, never the Capacitor origin',()=>{
 const source=readFileSync(new URL('../supabase/functions/wallet/index.ts',import.meta.url),'utf8');
 const expression=source.match(/const redirectTo = ([^;]+);/)[1];
 for(const origin of ['capacitor://localhost','https://untrusted.example','https://cards.digitalprojectagency.fr']){
 const result=vm.runInNewContext(expression,{origin,ALLOWED_ORIGINS:['capacitor://localhost','https://cards.digitalprojectagency.fr'],PUBLIC_SITE:'https://cards.digitalprojectagency.fr'});
 assert.equal(result,'https://cards.digitalprojectagency.fr/');
 }
});
