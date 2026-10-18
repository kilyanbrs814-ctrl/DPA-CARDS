import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalize,defaultDesign} from '../src/card-designer.js';
import {STAMP_LIBRARY} from '../src/stamp-library.js';
import {libraryStampId} from '../supabase/functions/_shared/stamp-library.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('six uploaded DPA illustrations are in client/server stamp catalog',()=>{
  for(const id of ['tacos-2','wok','vape','cheveux-bruns','e-liquide','cadeau']) {
    assert.ok(STAMP_LIBRARY.some(s=>s.id===id),id);
    assert.equal(libraryStampId(id),id);
  }
});
test('last stamp keeps legacy star until independently changed',()=>{
  assert.equal(defaultDesign({}).stamps.rewardId,'reward-star');
  assert.equal(normalize({},{}).stamps.rewardId,'reward-star');
  assert.equal(normalize({stamps:{rewardId:'cadeau'}},{}).stamps.rewardId,'cadeau');
  assert.match(read('src/card-designer.js'),/data-reward-stamp-picker/);
  assert.match(read('src/card-designer.js'),/stampImageUrl\(st\?\.rewardId\)/);
});
test('signed Wallet code uses reward choice but never untrusted asset URLs',()=>{
  const source=read('supabase/functions/wallet/index.ts');
  assert.match(source,/rewardId: libraryStampId\(s\.rewardId\)\|\|'reward-star'/);
  assert.match(source,/loadRewardStamp\(design\.stamps\?\.rewardId\)/);
  const apple=read('supabase/functions/apple-pass/index.ts');
  assert.match(apple,/loadRewardStamp\(brand\.stamps\?\.rewardId\)/);
});
test('admin scanner endpoints are protected by admin access rules',()=>{
  const wallet=read('supabase/functions/wallet/index.ts');
  assert.match(wallet,/async function adminScanLookup/);
  assert.match(wallet,/await requireAdmin\(req\)/);
  assert.match(wallet,/await assertAdminMerchant\(user,card\.merchant_id\)/);
  const panel=read('admin.html');
  assert.match(panel,/label:'Scanner',icon:'qr_code_scanner'/);
  assert.match(panel,/tabScanner/);
});
