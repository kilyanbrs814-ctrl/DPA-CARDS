import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('TestFlight embeds the exact commit selected for the manual run',()=>{
 const y=source('.github/workflows/ios-testflight.yml');
 assert.match(y,/ref:\s*\$\{\{ github\.sha \}\}/);
 assert.match(y,/^on:\s+workflow_dispatch:/m);
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

test('iPhone and website share the lavender background and frosted-glass CSS',()=>{
 const html=source('index.html');
 const mobile=source('src/mobile-layout.css');
 const glass=source('src/glass.css');
 const night=source('src/theme.css');
 assert.match(html,/href="\/src\/mobile-layout\.css"/);
 assert.match(html,/dataset\.dpaGlassTest/);
 assert.match(mobile,/@import '\.\/glass\.css'/);
 assert.match(glass,/html\[data-dpa-glass-test\]::before/);
 assert.match(glass,/dpa-workspace-lavender-lossless-v2\.webp/);
 assert.match(glass,/\.dpa-glass-surface/);
 assert.match(glass,/-webkit-backdrop-filter:\s*blur\(12px\)/);
 // Dark mode must keep exactly the same lavender/white background image as light mode.
 assert.doesNotMatch(night,/html\[data-dpa-theme="dark"\]\[data-dpa-glass-test\]::before/);
 assert.doesNotMatch(night,/linear-gradient\(#0c1425df/);
 assert.match(night,/--dpa-surface:\s*#1b2639/);
 assert.match(glass,/background:#f4f1fb url\('\/assets\/dpa-workspace-lavender-lossless-v2\.webp'\)/);
 // The iOS safe-area veil must not replace the page artwork's ::before.
 assert.doesNotMatch(mobile,/html\.dpa-native-ios::before\s*\{/);
 assert.match(mobile,/html\.dpa-native-ios::after\s*\{/);
});
