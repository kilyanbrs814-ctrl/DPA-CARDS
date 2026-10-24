import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_STAMP_EMOJI, QUICK_EMOJIS, normalizeStampEmoji, filterQuickEmojis } from '../src/emoji-stamps.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('French/English searchable catalog covers food, beauty and cars',()=>{
  assert.ok(QUICK_EMOJIS.length>=100,'curated offline catalog should not be trivial');
  assert.equal(filterQuickEmojis('hamburger')[0][0],'🍔');
  assert.equal(filterQuickEmojis('coiffure')[0][0],'💇');
  assert.equal(filterQuickEmojis('carwash')[0][0],'🧽');
  assert.equal(filterQuickEmojis('patisserie')[0][0],'🍰');
  assert.equal(filterQuickEmojis('onglerie')[0][0],'💅');
});
test('Unicode emoji is safely accepted, and ordinary text rejected',()=>{
  assert.equal(normalizeStampEmoji('🍔'),'🍔');
  assert.equal(normalizeStampEmoji('👩🏽‍🍳'),'👩🏽‍🍳');
  assert.equal(normalizeStampEmoji('not an emoji'),'');
  assert.equal(normalizeStampEmoji(''),'');
  assert.equal(normalizeStampEmoji(456),'');
  assert.equal(DEFAULT_STAMP_EMOJI,'⭐');
});
test('admin preview and save backend include emoji settings',()=>{
  const designer=read('src/card-designer.js'), server=read('supabase/functions/wallet/index.ts');
  assert.ok(designer.includes('makeStampLibraryPicker(React)'),'PNG gallery registered');
  assert.ok(!designer.includes('makeEmojiPicker(React)'),'old Unicode picker absent from generator');
  assert.ok(designer.includes("'data-apple-passkit-preview': true"),'native Apple preview present');
  assert.ok(designer.includes("stamps.emoji"),'emoji used in card preview');
  assert.ok(designer.includes("opacity:on?1:fade"),'unvalidated emojis use the editable grayscale opacity');
  assert.ok(designer.includes("inactiveStampOpacity(st?.inactiveOpacity)/100"),'legacy 22% default is preserved via normalized setting');
  assert.ok(server.includes("inactiveOpacity: int(s.inactiveOpacity, 0, 100, 22)"),'backend persists opacity between 0% and 100%');
  assert.ok(server.includes("libraryId: libraryStampId(s.libraryId)"),'backend persists approved PNG id');
  assert.ok(server.includes("emoji', 'none'"),'emoji variant accepted');
});

test('wallet designer preview renders only digits in card number and inline counts',()=>{
  const designer=read('src/card-designer.js');
  const start=designer.indexOf('function AppleCard({ design, data })');
  const finish=designer.indexOf('function GoogleCard(',start);
  assert.ok(start>0 && finish>start);
  const preview=designer.slice(start,finish);
  assert.ok(preview.includes(String.raw`replace(/\D/g, '')`),'remove prefixes while retaining leading zeros');
  assert.ok(preview.includes("'data-field': 'completed-count'"),'completed counter exists');
  assert.ok(preview.includes("'data-field': 'remaining-count'"),'remaining counter exists');
  assert.ok(preview.includes("'data-native-apple-fields': 'details'"),'plain cards use native client and reward fields');
  assert.ok(preview.includes("'data-native-apple-fields': 'counters'"),'illustrated cards use native counters');
  assert.ok(preview.includes("'data-apple-native-strip': true"),'native strip exists');
  assert.equal('DPA-DEMO-0003'.replace(/\D/g,''),'0003');
});

test('Apple header uses fixed height and PassKit bitmap bounds',()=>{
  const src=read('src/card-designer.js');
  const a=src.indexOf('function AppleCard({ design, data })');
  const b=src.indexOf('function GoogleCard(',a);
  const preview=src.slice(a,b);
  assert.ok(a>0 && b>a);
  assert.ok(preview.includes('height: 79'),'header stays fixed');
  assert.ok(preview.includes('width: nativeName ? 64 : 160, height: nativeName ? 48 : 50'));
  assert.ok(preview.includes("'data-field': 'apple-native-business-name'"));
});
test('native Google Wallet emits real completed/remaining counters without changing QR identity',()=>{
  const src=read('supabase/functions/wallet/index.ts');
  assert.ok(src.includes('secondaryLoyaltyPoints'));
  assert.ok(src.includes('walletCounter(now.balance,program.goal,program.mode)'));
  assert.ok(src.includes('walletCounter(r.balance,prog.goal,prog.mode)'));
  assert.ok(src.includes('walletCounter(t.test_balance||0,pv.goal||10,mode)'));
  assert.ok(src.includes('DPA1:${card.qr_token}'));
  assert.ok(src.includes('accountId: hasStampEmoji(program) ? walletCardDigits(card.card_number)'));
  assert.ok(src.includes('textModulesData: hasSavedStampArt(d) ? []'));
});

test('Classic stays native and the optional custom Apple header is reversible',()=>{
  const src=read('src/card-designer.js'),apple=read('supabase/functions/apple-pass/index.ts');
  assert.ok(src.includes("createAppleWordmark(next)"),'custom artwork is created in the designer');
  assert.ok(src.includes("'data-field': 'apple-native-business-name'"),'Classic keeps native text');
  assert.ok(src.includes("['classic','Classique"),'explicit Classic and Custom selector');
  assert.ok(apple.includes('&& !composedPath ? { logoText: appleHeaderName(name)'), 'native text remains when no custom image is selected');
  assert.ok(apple.includes("composed||uploaded"),'optional image is independent of native logo');
  assert.ok(!src.includes("data-upload':'businessNameImage'"),'no redundant name PNG upload');
});
