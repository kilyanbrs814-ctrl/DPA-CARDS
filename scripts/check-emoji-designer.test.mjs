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
  assert.ok(designer.includes('makeEmojiPicker(React)'),'search picker registered');
  assert.ok(designer.includes("'data-onecup-inspired':true"),'layout present');
  assert.ok(designer.includes("stamps.emoji"),'emoji used in card preview');
  assert.ok(designer.includes("opacity:on?1:.22"),'same emoji grayscale when empty');
  assert.ok(server.includes("emoji: savedEmoji(s.emoji)"),'backend stores emoji');
  assert.ok(server.includes("emoji', 'none'"),'emoji variant accepted');
});
