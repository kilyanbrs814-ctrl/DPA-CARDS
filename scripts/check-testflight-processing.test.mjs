import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { appleToken, matchingBuild } from './check-testflight-processing.mjs';

test('App Store tokens use ES256 JOSE signatures, the expected audience and short expiry', () => {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const token=appleToken({keyId:'test-key',issuer:'test-issuer',pem:privateKey.export({type:'pkcs8',format:'pem'}),now:1000});
  const [head,body,signature]=token.split('.');
  assert.equal(JSON.parse(Buffer.from(head,'base64url')).alg,'ES256');
  assert.deepEqual(JSON.parse(Buffer.from(body,'base64url')),{iss:'test-issuer',iat:995,exp:1600,aud:'appstoreconnect-v1'});
  assert.equal(Buffer.from(signature,'base64url').length,64);
  assert.ok(verify('sha256',Buffer.from(head+'.'+body),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')));
});

test('Processing checks cannot confuse the same build number from another marketing version', () => {
  const response={data:[{id:'old',attributes:{version:'25'},relationships:{preReleaseVersion:{data:{id:'v1'}}}},{id:'current',attributes:{version:'25'},relationships:{preReleaseVersion:{data:{id:'v2'}}}}],included:[{id:'v1',type:'preReleaseVersions',attributes:{version:'1.1'}},{id:'v2',type:'preReleaseVersions',attributes:{version:'1.2'}}]};
  assert.equal(matchingBuild(response,'1.2',25).id,'current');
  assert.equal(matchingBuild(response,'1.2',24),undefined);
});
