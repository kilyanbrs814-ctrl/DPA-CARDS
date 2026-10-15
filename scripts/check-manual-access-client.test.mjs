import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('index.html');
const client=read('src/backend.js');
const wallet=read('supabase/functions/wallet/index.ts');
const billing=read('supabase/functions/billing/index.ts');
test('merchant entitlement is resolved by authenticated Wallet API and same database predicate as server gates',()=>{
  assert.match(wallet,/async function merchantAccess\(req: Request\)/);
  const a=wallet.slice(wallet.indexOf('async function merchantAccess('),wallet.indexOf('async function requireAccess('));
  assert.match(a,/ownerOf\(req\)/);
  assert.match(a,/admin\.rpc\('merchant_has_access'/);
  assert.match(a,/\.eq\('merchant_id',member\.merchant_id\)/);
  assert.match(a,/has_access:allowed===true/);
  assert.match(wallet,/path\.endsWith\('\/merchant-access'\)/);
  assert.match(client,/invokeFn\('wallet\/merchant-access'/);
  assert.match(client,/hasAccess: access\.has_access===true/);
});
test('live dashboard and lock screens are governed by verified access, not Stripe billing status',()=>{
  assert.match(page,/hasAccess:d\.hasAccess===true/);
  assert.match(page,/const locked=!!s\.live&&!s\.hasAccess/);
  assert.match(page,/LOCKED_SCREENS\.includes\(screen\)&&!this\.state\.hasAccess/);
  assert.match(page,/if\(s\.live&&!s\.hasAccess\) return this\.go\('billing'\)/);
  assert.match(page,/refreshAccess=async\(\)=>/);
  assert.match(page,/if\(document\.visibilityState==='visible'\)this\.refreshAccess\(\)/);
  assert.match(page,/if\(document\.hasFocus\(\)\)this\.refreshAccess\(\)/);
  assert.match(page,/const \[sub,a\]=await Promise\.all/);
  assert.ok(!/LOCKED_SCREENS\.includes\(screen\)&&!subOk/.test(page));
  assert.ok(!/const locked=!!s\.live&&!subOk/.test(page));
  assert.match(page,/Accès offert par DPA Cards/);
});
test('manual access permits separate paid custom design while design is still charged by Stripe',()=>{
  const section=billing.slice(billing.indexOf('async function designCheckout('),billing.indexOf('async function designVerify('));
  assert.match(section,/admin\.rpc\('merchant_has_access'/);
  assert.match(section,/if\(hasAccess!==true\)throw new HttpError\(402,'subscription_required'\)/);
  assert.match(section,/const s = requireStripe\(\)/);
  assert.match(section,/custom_design/);
});
