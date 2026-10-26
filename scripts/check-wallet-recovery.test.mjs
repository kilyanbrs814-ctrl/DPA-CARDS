import {test} from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import {createRecoveryLink} from '../src/wallet-recovery.js';

test('recovery QR encodes the installation link of the exact existing card for both Wallets',async()=>{
  const calls=[],urls={apple:'https://wallet.example/apple-pass?token=private-test',google:'https://pay.google.com/gp/v/save/test-existing-card'};
  const api={appleWalletLink:async id=>{calls.push(['apple',id]);return {url:urls.apple}},walletLink:async id=>{calls.push(['google',id]);return {url:urls.google}},
    enroll:()=>assert.fail('Recovery must never enroll a new customer')};
  for(const platform of ['apple','google']) {
    const result=await createRecoveryLink(api,'existing-card',platform);
    assert.equal(result.url,urls[platform]);
    const png=PNG.sync.read(Buffer.from(result.qr.split(',')[1],'base64'));
    const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
    assert.equal(decoded?.data,urls[platform]);
  }
  assert.deepEqual(calls,[['apple','existing-card'],['google','existing-card']]);
});

test('server authorization failures are preserved and unusable links are not shown',async()=>{
  await assert.rejects(createRecoveryLink({},'existing-card','other'),/invalid_card/);
  await assert.rejects(createRecoveryLink({appleWalletLink:async()=>{throw Error('forbidden')}},'existing-card','apple'),/forbidden/);
  await assert.rejects(createRecoveryLink({appleWalletLink:async()=>({url:'javascript:alert(1)'})},'existing-card','apple'),/wallet_unavailable/);
});
