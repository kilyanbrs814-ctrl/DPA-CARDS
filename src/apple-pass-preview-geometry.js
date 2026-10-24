// Read-only geometry for the Apple Wallet editor preview.
// Mirrors makeDemoStrip/makeRealStrip/makeEmojiCardStrip in the Apple Pass function.
// Do not import this into the server: the signed pass and its layouts are unchanged.
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const percent = raw => raw == null || raw === '' || !Number.isFinite(Number(raw))
  ? 1 : clamp(Number(raw), 50, 120) / 100;

export function applePassPreviewGeometry(d, data) {
  const st = d.stamps || {}, opt = d.opt || {}, assets = d.assets || {};
  const goal = Math.max(1, Math.round(Number(data.goal) || 10));
  const done = clamp(Math.round(Number(data.progress) || 0), 0, goal);
  const artwork = Boolean(st.emoji || st.icon === 'library' ||
    (st.icon === 'custom' && assets.stamp?.url));
  const rewardArt = opt.showReward === true &&
    Boolean(assets.rewardLabel?.url || (opt.rewardText || '').trim());
  const real = data.isTest === false;
  const size = percent(st.size), spacing = percent(st.spacing);
  const stamps = [];
  const stripHeight = artwork || !real ? 144 : 123;
  let bar = null;

  if (opt.showStamps !== false && (artwork || !real) && (data.mode === 'points' || goal > 30)) {
    const left = artwork ? 70 : real ? 190 : 190;
    const width = artwork ? 235 : 165;
    const top = artwork ? 66 : real ? 54 : 63;
    bar = { left, top, width, height: 14, fraction: clamp(done / goal, 0, 1) };
  } else if (opt.showStamps !== false && artwork) {
    // makeEmojiCardStrip: icon dimensions and row centers in Apple logical points.
    const n = Math.min(goal, 20), rows = n <= 6 ? 1 : n <= 14 ? 2 : 3;
    const per = Math.ceil(n / rows), gap = rows <= 2 ? 11 : 7;
    const limit = rewardArt ? (rows === 1 ? 48 : rows === 2 ? 44 : 30)
      : (rows === 1 ? 54 : rows === 2 ? 50 : 34);
    const nativeSize = Math.max(12, Math.min(limit, Math.floor((315 - (per - 1) * gap) / per)));
    const diameter = Math.round(nativeSize * size);
    const rowGap = rewardArt ? (rows === 3 ? 31 : rows === 2 ? 49 : 0)
      : (rows === 3 ? 40 : rows === 2 ? 58 : 0);
    const cy = 72 - (rewardArt ? 12 : 0);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / per), col = i % per;
      const count = Math.min(per, n - row * per);
      stamps.push({
        x: Math.round(187.5 + (col - (count - 1) / 2) * (nativeSize + gap) * spacing),
        y: Math.round(cy + (row - (rows - 1) / 2) * rowGap * spacing),
        diameter, done: i < done, final: i === n - 1, type: 'image',
      });
    }
  } else if (opt.showStamps !== false && real) {
    // makeRealStrip: two-tone legacy layout on the right half.
    const n = Math.max(1, Math.min(10, goal));
    const columns = Math.min(n, 5), rows = Math.ceil(n / columns);
    const completed = clamp(Math.floor(done / goal * n), 0, n);
    for (let i = 0; i < n; i++) {
      const col = i % columns, row = Math.floor(i / columns);
      stamps.push({
        x: Math.round(285 + (col - (columns - 1) / 2) * 31 * spacing),
        y: Math.round(123 / 2 - (rewardArt ? 14 : 0) +
          (row - (rows - 1) / 2) * (rows === 1 ? 0 : 43) * spacing),
        diameter: 24 * size, done: i < completed, final: i === n - 1, type: 'circle',
      });
    }
  } else if (opt.showStamps !== false) {
    // makeDemoStrip: three-row limit for plain demo cards.
    const n = Math.min(goal, 15), rows = n <= 6 ? 1 : n <= 14 ? 2 : 3;
    const columns = Math.ceil(n / rows);
    const nativeRadius = Math.max(5, Math.min(13, 73 / columns)) * size;
    const gapX = columns > 1 ? Math.min(32, 160 / (columns - 1)) : 0;
    const gapY = rows === 1 ? 0 : rows === 2 ? (rewardArt ? 39 : 47) : (rewardArt ? 30 : 35);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / columns), col = i % columns;
      const count = Math.min(columns, n - row * columns);
      stamps.push({
        x: Math.round(281 + (col - (count - 1) / 2) * gapX * spacing),
        y: Math.round((rewardArt ? 61 : 73) + (row - (rows - 1) / 2) * gapY * spacing),
        diameter: nativeRadius * 2, done: i < done, final: i === n - 1, type: 'circle',
      });
    }
  }
  return { width: 375, height: stripHeight, artwork, real, goal, done, bar,
    rewardArt, stamps };
}
