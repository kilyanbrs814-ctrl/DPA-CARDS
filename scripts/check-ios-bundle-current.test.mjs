import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('TestFlight embeds current main source, not the obsolete isolated iOS branch',()=>{
 const y=source('.github/workflows/ios-testflight.yml');
 assert.match(y,/ref: main\s+# Always bundle the same current card generator as the website/);
 assert.doesNotMatch(y,/ref:\s*feat\/ios-app-store-preparation/);
 assert.match(y,/npm run build/);
 assert.match(y,/npx cap sync ios/);
 assert.match(y,/scripts\/check-ios-bundle-current\.test\.mjs/);
});
test('iPhone bundle includes all Wallet logos and enlarged transparent wordmark treatment',()=>{
 const editor=source('src/card-designer.js'),art=source('src/apple-wordmark.js');
 for(const field of ['Logos Apple Wallet','Logos Google Wallet','googleLogo','googleBusinessNameImage',
   'businessNameImage','googleWideLogo','prepareGoogleLogoPng','tightWordmarkPreview']){
    assert.ok(editor.includes(field) || art.includes(field),field);
 }
 assert.match(art,/export async function createGoogleWideLogo/);
 assert.match(art,/export async function createAppleWordmark/);
 assert.match(editor,/assets: platform==='google'/);
 assert.match(editor,/next\.assets\.googleWideLogo/);
});
test('Existing iPhone admin OTP and merchant scanner stay intact',()=>{
 const page=source('admin.html'),login=source('src/admin-backend.js'),merchant=source('src/backend.js');
 assert.match(page,/id="admin-otp-code"/);
 assert.match(page,/autocomplete="one-time-code"/);
 assert.match(login,/nativeAdmin && nativeOtpEmail/);
 assert.match(login,/sb\.auth\.verifyOtp\(\{ email: nativeOtpEmail, token, type: 'email' \}\)/);
 assert.match(login,/makeAdminScanner/);
 assert.match(login,/admin-test-card-upload/);
 assert.match(login,/listenForAdminDeepLinks/);
 assert.match(merchant,/listenForAdminDeepLinks\(forwardAdminAuthToPage\)/);
 assert.match(merchant,/saveQrToPhotos/);
});
