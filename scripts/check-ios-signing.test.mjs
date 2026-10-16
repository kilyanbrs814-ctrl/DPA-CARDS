import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureAppProfile} from './configure-ios-signing.mjs';
test('app profile does not leak into Swift package resource bundles',()=>{
 const project='project = { buildSettings = { SDKROOT = iphoneos; }; };\nDebug = { buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = fr.example; }; };\nRelease = { buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = fr.example;\nPROVISIONING_PROFILE_SPECIFIER = "Old"; }; };';
 const output=configureAppProfile(project,'DPA Cards App Store');assert.equal((output.match(/PROVISIONING_PROFILE_SPECIFIER/g)||[]).length,2);assert.ok(output.startsWith('project = { buildSettings = { SDKROOT = iphoneos; }; };'));assert.ok(!output.includes('"Old"'));
 assert.equal(configureAppProfile(output,'DPA Cards App Store'),output);
});
test('unexpected generated project is rejected rather than applying signing broadly',()=>assert.throws(()=>configureAppProfile('buildSettings = { SDKROOT=iphoneos; };','DPA'),/Expected exactly two/));
