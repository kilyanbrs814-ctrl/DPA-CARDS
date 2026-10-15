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
  assert.ok(/'data-onecup-inspired':\s*true/.test(designer),'layout present');
  assert.ok(designer.includes("stamps.emoji"),'emoji used in card preview');
  assert.ok(designer.includes("opacity:on?1:.22"),'same emoji grayscale when empty');
  assert.ok(server.includes("libraryId: libraryStampId(s.libraryId)"),'backend persists approved PNG id');
  assert.ok(server.includes("emoji', 'none'"),'emoji variant accepted');
});

test('wallet designer preview renders only digits in card number and inline counts',()=>{
  const designer=read('src/card-designer.js');
  const start=designer.indexOf('function WalletCard({ design, data, platform })');
  const finish=designer.indexOf('function AppleCard(',start);
  assert.ok(start>0 && finish>start);
  const preview=designer.slice(start,finish);
  assert.ok(preview.includes(String.raw`replace(/\D/g, '')`),'remove prefixes while retaining leading zeros');
  assert.ok(preview.includes("'data-field': 'completed-count'"),'completed counter exists');
  assert.ok(preview.includes("'data-field': 'remaining-count'"),'remaining counter exists');
  assert.ok(!preview.includes("'data-field': 'client'"),'remove customer info');
  assert.ok(!preview.includes("'data-field': 'reward'"),'remove extra reward field');
  assert.equal('DPA-DEMO-0003'.replace(/\D/g,''),'0003');
});

test('Apple preview keeps the header height constant when enlarging the logo',()=>{
  const src=read('src/card-designer.js');
  const start=src.indexOf('function WalletCard({ design, data, platform })');
  const end=src.indexOf('// 2. RECTANGLE CENTRAL AVEC LES TAMPONS PNG',start);
  const header=src.slice(start,end);
  assert.ok(start>0 && end>start);
  assert.ok(header.includes("height: platform==='apple' ? 80 : undefined"),
    'the logo and native name cannot increase the distance above the stamp rectangle');
  assert.ok(header.includes("padding: platform==='apple' ? '0 17px' : '20px 17px'"),
    'Apple uses fixed-height centered content without extra vertical padding');
  assert.ok(header.includes("width:o.showBusinessName?64:145,height:o.showBusinessName?48:45"),
    'larger logo remains inside the 50pt Apple native header');
  assert.ok(header.includes("'data-field':'apple-native-business-name'"),
    'the business name remains Apple-native, not burned into the PNG');
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
