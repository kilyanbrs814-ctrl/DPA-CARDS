import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applePassPreviewGeometry } from '../src/apple-pass-preview-geometry.js';

const design = (icon = 'library', options = {}) => ({
  opt: { showStampPanel: true, showStamps: true, ...options },
  stamps: { icon, size: options.stampSize ?? 100,
    spacing: options.stampSpacing ?? 100, inactiveOpacity: 22, libraryId: 'cafe' },
  assets: {},
});
const data = (isTest, extra = {}) => ({
  isTest, mode: 'passages', goal: 10, progress: 3, ...extra,
});

test('illustrated test strips use the signed 375×144 Apple coordinates', () => {
  const g = applePassPreviewGeometry(design(), data(true));
  assert.equal(g.width, 375);
  assert.equal(g.height, 144);
  assert.equal(g.artwork, true);
  assert.equal(g.stamps.length, 10);
  assert.equal(g.stamps[0].x, 66);
  assert.equal(g.stamps[4].x, 310);
  assert.equal(g.stamps[0].y, 43);
  assert.equal(g.stamps[5].y, 101);
  assert.equal(g.stamps[0].diameter, 50);
  assert.equal(g.stamps.filter(s => s.done).length, 3);
  assert.equal(g.stamps[9].final, true);
});

test('size changes the bitmap, spacing moves center positions only', () => {
  const regular = applePassPreviewGeometry(design(), data(true));
  const varied = applePassPreviewGeometry(
    design('library', {stampSize: 50, stampSpacing: 120}), data(true));
  assert.equal(varied.stamps[0].diameter, 25);
  assert.equal(varied.stamps[0].x, Math.round(187.5 - 2 * 61 * 1.2));
  assert.equal(varied.stamps[0].y, Math.round(72 - .5 * 58 * 1.2));
  assert.equal(varied.stamps[5].y, Math.round(72 + .5 * 58 * 1.2));
  assert.notEqual(regular.stamps[0].x, varied.stamps[0].x);
});

test('a reward label shifts native stamp centers upwards', () => {
  const g = applePassPreviewGeometry(
    design('library', {showReward: true, rewardText: 'Cadeau offert'}), data(true));
  assert.equal(g.rewardArt, true);
  assert.equal(g.stamps[0].y, Math.round(60 - 24.5));
  assert.equal(g.stamps[5].y, Math.round(60 + 24.5));
  assert.equal(g.stamps[0].diameter, 44);
});

test('legacy plain demos have a 144pt strip, real plain cards have 123pt', () => {
  const demo = applePassPreviewGeometry(design('none'), data(true));
  const real = applePassPreviewGeometry(design('none'), data(false));
  assert.equal(demo.height, 144);
  assert.equal(demo.stamps[0].x, 217);
  assert.equal(real.height, 123);
  assert.equal(real.stamps[0].x, 223);
  assert.equal(real.stamps[0].diameter, 24);
  assert.equal(real.stamps.length, 10);
});

test('points use a progress bar when signed strip does, not for legacy real stamps', () => {
  const points = { mode: 'points', goal: 100, progress: 30 };
  const art = applePassPreviewGeometry(design(), data(true, points));
  assert.deepEqual(art.bar, { left: 70, top: 66, width: 235, height: 14, fraction: .3 });
  const plain = applePassPreviewGeometry(design('none'), data(false, points));
  assert.equal(plain.bar, null);
  assert.equal(plain.stamps.length, 10);
});

test('disabling stamps keeps native strip dimensions', () => {
  const g = applePassPreviewGeometry(design('library', {showStamps: false}), data(true));
  assert.equal(g.height, 144);
  assert.deepEqual(g.stamps, []);
  assert.equal(g.bar, null);
});

test('preview geometry is pure and does not modify saved designs or card data', () => {
  const d = design(), preview = data(true);
  const saved = JSON.stringify({d, preview});
  applePassPreviewGeometry(d, preview);
  assert.equal(JSON.stringify({d, preview}), saved);
});
