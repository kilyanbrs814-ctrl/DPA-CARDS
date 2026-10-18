import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const backend=readFileSync(new URL('../src/backend.js',import.meta.url),'utf8');

test('iPhone companion can compose Apple, Google and dual-Wallet notifications',()=>{
  assert.match(ui,/platform:'both',type:'message'/);
  assert.match(ui,/\['both','Les deux'\]/);
  assert.match(ui,/\['apple','Apple Wallet'\]/);
  assert.match(ui,/\['google','Google Wallet'\]/);
  assert.match(ui,/nPlats:plats/);
  assert.match(ui,/appleQueued/);
  assert.match(ui,/googleSent/);
  assert.match(ui,/nValidate\(full\)[\s\S]+?nf\.platform==='both'/);
});
test('Only confirmed Apple Wallet installations are shown as Apple recipients',()=>{
  assert.match(backend,/rpc\('apple_wallet_registered_cards',\{p_merchant:merchant\.id\}\)/);
  assert.match(backend,/wallets:\{google:google\.has\(k\.id\),apple:apple\.has\(k\.id\)\}/);
  assert.match(backend,/platform: r\.platform \|\| 'google'/);
});
test('Backend sends authorized Apple and Google notifications independently',()=>{
  assert.match(backend,/if\(platform==='apple'\)return invokeFn\('apple-pass\/notify',body\)/);
  assert.match(backend,/const google=await invokeFn\('wallet\/notify',body\)/);
  assert.match(backend,/const apple=await invokeFn\('apple-pass\/notify'/);
  assert.match(backend,/platform: \['apple','google','both'\]\.includes\(nf\.platform\)/);
});
test('Native companion still blocks sign-up, subscription and checkout',()=>{
  assert.match(ui,/if\(DPA_NATIVE_IOS\)return/);
  assert.match(ui,/nativeAccess/);
  assert.doesNotMatch(ui,/React\.createElement\(this\.api\.ProfileControls/);
});
