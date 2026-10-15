import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const wallet=read('supabase/functions/wallet/index.ts'),ui=read('admin.html'),db=read('supabase/migrations/20261015_isolated_admin_manual_access.sql'),client=read('src/admin-backend.js');
test('server filters admin overview, merchant detail and designs by server-side rep email',()=>{
  assert.match(wallet,/async function adminAllowedMerchantIds\(user:/);
  assert.match(wallet,/\.eq\('email',user\.dpaEmail\)\.eq\('active',true\)/);
  assert.match(wallet,/\.eq\('sales_rep_id',rep\.id\)/);
  assert.match(wallet,/visible=\(data\.merchants as any\[\]\)\.filter/);
  assert.match(wallet,/await assertAdminMerchant\(user,id\)/);
  assert.match(wallet,/const rows = \(data as any\[\]\)\.filter/);
  for(const name of ['adminCardDesigner','adminCardSave','adminCardValidate','adminCardUpload','adminCardGoogleSync','adminMerchantAccess']){
    const start=wallet.indexOf('async function '+name+'('),end=wallet.indexOf('\n}',start),section=wallet.slice(start,end);
    assert.ok(start>0&&section.includes('assertAdminMerchant(user,'),name+' requires scoped access');
  }
});
test('admin demo cards and their asset modifications are isolated by creator',()=>{
  assert.match(wallet,/testRow\(id: unknown, user\?: any\)/);
  assert.match(wallet,/data\.created_by!==user\?\.id/);
  assert.match(wallet,/q=q\.eq\('created_by',user\.id\)/);
  for(const fn of ['adminTestCardGet','adminTestCardSave','adminTestCardDuplicate','adminTestCardDelete','adminTestCardNewQr','adminTestCardUpload','adminTestCardApple','adminTestCardWallet']){
    const start=wallet.indexOf('async function '+fn+'('),end=wallet.indexOf('\n}',start);
    assert.ok(wallet.slice(start,end).includes('testRow(body.'),fn+' checks owner');
  }
});
test('director has all merchants, sales rep attribution and separate temporary subscription access',()=>{
  assert.match(db,/SET role='director'/i);
  assert.match(db,/UPDATE public\.admin_users SET role='director'/);
  assert.match(db,/SECURITY DEFINER SET search_path TO ''/);
  assert.match(db,/REVOKE ALL ON FUNCTION public\.admin_manual_access_change/);
  assert.match(db,/GRANT EXECUTE ON FUNCTION public\.admin_manual_access_change.*TO service_role/);
  assert.match(db,/INSERT INTO public\.merchant_manual_access_audit/);
  assert.match(wallet,/const user=await requireDirector\(req\)/);
  assert.match(wallet,/admin\.rpc\('admin_manual_access_change'/);
  assert.match(client,/admin-manual-access/);
  assert.match(ui,/data-director-access="1"/);
  assert.match(ui,/Commercial : \{\{ r\.rep \}\}/);
  assert.match(ui,/Accorder l’accès/);
  assert.match(ui,/Suspendre l’accès/);
});
