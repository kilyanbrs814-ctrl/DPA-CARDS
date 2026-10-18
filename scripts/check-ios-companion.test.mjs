import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('iOS paid companion: signup and purchase paths are guarded', () => {
  const guards = [
    /signup=e=>\{[^\n]*if\(DPA_NATIVE_IOS\)return;/,
    /choosePlan=async\(plan,billing\)=>\{\s*if\(DPA_NATIVE_IOS\|\|this\.state\.busy\) return;/,
    /resumeDesign=async\(\)=>\{\s*if\(DPA_NATIVE_IOS\|\|this\.state\.busy\) return;/,
    /openPortal=async\(\)=>\{\s*if\(DPA_NATIVE_IOS\|\|this\.state\.busy\) return;/,
    /cancelSub=async\(\)=>\{\s*if\(DPA_NATIVE_IOS\|\|this\.state\.busy\) return;/,
    /async obSubmitRequest\(\)\{\s*if\(DPA_NATIVE_IOS\)return;/,
    /if\(DPA_NATIVE_IOS&&\(!d\.merchant\|\|!d\.program\|\|!d\.hasAccess\|\|d\.program\.designStatus==='draft'\)\)/,
    /screen='nativeAccess'/,
    /if\(!DPA_NATIVE_IOS&&DESIGN_RETURN&&d\.merchant\)/,
    /if\(DPA_NATIVE_IOS\)\{[\s\S]*?\['billing','signup','signupSent','ob'/,
  ];
  for (const expression of guards) assert.match(html, expression);
  assert.match(html, /<sc-if value="\{\{ isWeb \}\}">[^\n]*Pas encore de compte/);
  assert.match(html, /<sc-if value="\{\{ s\.nativeAccess \}\}"/);
  assert.match(html, /!DPA_NATIVE_IOS&&s\.live\?\[\{icon:'credit_card',label:'Mon abonnement'/);
});

test('iOS app still has authenticated login, scanner and account settings', () => {
  assert.match(html, /const DPA_NATIVE_IOS=window\.location\.protocol==='capacitor:'/);
  assert.match(html, /await api\.signIn\(em\.trim\(\),pw\)/);
  assert.match(html, /LOCKED_SCREENS=\['invite','scanner'/);
  assert.match(html, /this\.api\.saveQrToPhotos\(href\)/);
});
