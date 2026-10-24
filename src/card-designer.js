import { preparePngUpload, prepareBusinessNamePng, prepareGoogleLogoPng } from './png-upload.js';
import { createAppleWordmark, APPLE_WORDMARK_VERSION, createGoogleWideLogo, GOOGLE_WIDE_LOGO_VERSION, tightWordmarkPreview } from './apple-wordmark.js';
import { createRewardLabel, rewardLabelColor } from './apple-reward-label.js';
// Card designer (admin): one design project per program, rendered in two layouts —
// Apple Wallet (full rectangle, rounded corners only) and Google Wallet (its own layout).
// The design only describes the look. Customer name, progress, rewards and the QR code are
// data passed to the renderer for each card; they are never baked into an image.
// Built on the page's React (window.React, the instance dc-runtime renders with).

import QRCode from 'qrcode';
import { makeCropper } from './cropper.js';
import { normalizeStampEmoji } from './emoji-stamps.js';
import { stampImageUrl, makeStampLibraryPicker } from './stamp-library.js';
import { applePassPreviewGeometry } from './apple-pass-preview-geometry.js';

export const FONTS = {
  hanken: { label: 'Hanken Grotesk', css: "'Hanken Grotesk', system-ui, sans-serif" },
  space: { label: 'Space Grotesk', css: "'Space Grotesk', system-ui, sans-serif" },
  playfair: { label: 'Playfair Display', css: "'Playfair Display', Georgia, serif" },
};
export const STAMP_ICONS = [
  ['none', 'Aucune'], ['check', 'Coche'], ['star', 'Étoile'], ['favorite', 'Cœur'], ['local_cafe', 'Café'], ['local_pizza', 'Pizza'],
  ['content_cut', 'Ciseaux'], ['restaurant', 'Couverts'], ['cake', 'Gâteau'], ['spa', 'Fleur'], ['local_bar', 'Cocktail'],
  ['icecream', 'Glace'], ['bakery_dining', 'Viennoiserie'], ['custom', 'Personnalisée'],
];
const HEX = /^#[0-9A-Fa-f]{6}$/;
const ASSET_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(designer\/)?(logo|googleLogo|hero|background|stamp|googleStrip|appleStrip|appleHeader|rewardLabel|businessNameImage|googleBusinessNameImage|googleWideLogo)-[0-9a-f-]{36}\.(png|jpg)$/;
// Recommended source dimensions for EVERY upload in the card generator.
// Cropped assets are exported to exactly the dimensions below. The original
// logo and stamp keep their proportions; these sizes are recommendations only.
export const RECOMMENDED_IMAGE_SIZES = Object.freeze({
  logo: Object.freeze({ width: 660, height: 660, format: 'PNG transparent', note: 'Carré, important pour Google Wallet.' }),
  businessNameImage: Object.freeze({ width: 1000, height: 250, format: 'PNG transparent', note: 'Logo texte horizontal Apple Wallet.' }),
  googleLogo: Object.freeze({ width: 660, height: 660, format: 'PNG', note: 'Le fichier est adapté à 660 × 660 px pour Google Wallet.' }),
  googleBusinessNameImage: Object.freeze({ width: 1000, height: 250, format: 'PNG transparent', note: 'Logo texte Google Wallet, facultatif.' }),
  hero: Object.freeze({ width: 1032, height: 812, format: 'PNG, JPEG ou WebP', note: 'Format paysage ; recadrage automatique.' }),
  background: Object.freeze({ width: 680, height: 1120, format: 'PNG, JPEG ou WebP', note: 'Format portrait ; recadrage automatique.' }),
  stamp: Object.freeze({ width: 256, height: 256, format: 'PNG transparent', note: 'Carré, sans fond pour un beau rendu.' }),
  googleStrip: Object.freeze({ width: 1032, height: 812, format: 'PNG, JPEG ou WebP', note: 'Image Google Wallet derrière les tampons.' }),
  appleStrip: Object.freeze({ width: 1125, height: 432, format: 'PNG, JPEG ou WebP', note: 'Bandeau Apple Wallet pleine largeur (375 × 144 pt).' }),
});
// Demo data of the editor (the real card gets its own customer, balance and QR token).
export const DEMO = { client: 'Nicolas Moreau', progress: 3, goal: 10, reward: '1 dessert offert', available: 1, qr: 'DPA1:DEMO-DPA-CARDS-PREVIEW', cardNumber: 'DPA-DEMO-0003' };

export function lum(hex) {
  const h = (HEX.test(hex || '') ? hex : '#FFFFFF').slice(1);
  const v = [0, 2, 4].map(i => { const c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const onColor = hex => (lum(hex) < 0.45 ? '#FFFFFF' : '#1C1F24');
const rgba = (hex, a) => { const h = (HEX.test(hex || '') ? hex : '#000000').slice(1); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };

// New project: everything the program and the merchant already have.
export function defaultDesign(project) {
  const m = project.merchant || {}, p = project.program || {};
  const bg = HEX.test(p.bg || '') ? p.bg.toUpperCase() : '#1C1F24';
  const asset = (path, url) => (path && ASSET_RE.test(path) ? { path, url } : null);
  return {
    v: 1,
    identity: { name: m.business_name || '', subtitle: m.activity || '' },
    colors: { primary: bg, secondary: HEX.test(p.accent || '') ? p.accent.toUpperCase() : '#2448F0', text: onColor(bg), accent: '#F2C94C' },
    font: 'hanken', label: '',
    assets: { logo: asset(p.logo_path, p.logo_url), hero: asset(p.hero_path, p.hero_url), background: null, stamp: null, googleStrip: null, appleStrip: null, appleHeader: null, rewardLabel: null, businessFont: null, businessNameImage: null, googleLogo: null, googleBusinessNameImage: null, googleWideLogo: null },
    stamps: { shape: 'circle', icon: 'library', libraryId: 'cafe', emoji: '', style: 'outline', filled: '#F2C94C', empty: onColor(bg), size: 100, spacing: 100, inactiveOpacity: 22, rewardId: 'reward-star' },
    apple: { colors: {}, showHero: true, showSubtitle: true, showBusinessName: false, headerMode: 'classic', showStampPanel: true, showStamps: true, stampSize: 100, stampSpacing: 100, headerArtworkVersion: 0, businessNameFont: 'system', showReward: false, rewardText: 'Débloque la coupe offerte !', rewardTextColor: '', useBackground: false, heroFocus: 50, label: '' },
    google: { colors: {}, showStamps: true, stampSize: 100, stampSpacing: 100, reuseAppleStrip: true, showHero: true, showSubtitle: true, useBackground: false, heroFocus: 50, label: '', wideArtworkVersion: 0 },
    preview: { mode: p.mode === 'points' ? 'points' : 'passages', goal: p.goal || DEMO.goal, progress: Math.min(DEMO.progress, p.goal || DEMO.goal), reward: p.reward || DEMO.reward, available: DEMO.available, client: DEMO.client },
  };
}
// Saved documents may predate a field: fill the gaps from the defaults.
// Stamp size is a percentage of each Wallet's original stamp dimensions.
// Missing/invalid legacy settings render at precisely the previous 100% size.
export function stampSizePercent(raw) {
  const value=Number(raw);
  return raw==null || raw==='' || !Number.isFinite(value) ? 100
    : Math.max(50,Math.min(120,Math.round(value)));
}
// 100% preserves the historical layout. Less than 100% moves stamps
// symmetrically toward the center without changing the size of each icon.
export function stampSpacingPercent(raw) {
  const value=Number(raw);
  return raw==null || raw==='' || !Number.isFinite(value) ? 100
    : Math.max(50,Math.min(120,Math.round(value)));
}
// Legacy unvalidated PNG/emoji stamps are grayscale with 22% opacity.
export function inactiveStampOpacity(raw) {
 const n=Number(raw);
 return raw==null||raw===''||!Number.isFinite(n)?22:Math.max(0,Math.min(100,Math.round(n)));
}
export function normalize(config, project) {
  const d = defaultDesign(project), c = config || {};
  const plat = k => ({ ...d[k], ...(c[k] || {}), colors: { ...((c[k] || {}).colors || {}) },
    stampSize:stampSizePercent(c[k]?.stampSize ?? c.stamps?.size),stampSpacing:stampSpacingPercent(c[k]?.stampSpacing ?? c.stamps?.spacing) });
  return { ...d, ...c, identity: { ...d.identity, ...(c.identity || {}) }, colors: { ...d.colors, ...(c.colors || {}) },
    assets: { ...d.assets, ...(c.assets || {}) }, stamps: { ...d.stamps, ...(c.stamps || {}), icon: c.stamps?.icon || (normalizeStampEmoji(c.stamps?.emoji) ? 'emoji' : d.stamps.icon), emoji: c.stamps && !Object.prototype.hasOwnProperty.call(c.stamps, 'emoji') ? '' : (c.stamps?.emoji ?? d.stamps.emoji), size: stampSizePercent(c.stamps?.size), spacing: stampSpacingPercent(c.stamps?.spacing), inactiveOpacity: inactiveStampOpacity(c.stamps?.inactiveOpacity) }, apple: plat('apple'), google: plat('google'),
    preview: { ...d.preview, ...(c.preview || {}) } };
}
// Real cards: the validated programs.card_design (paths only) → a renderable design. Missing parts fall
// back to the program's own values (bg, accent, logo, cover), so an incomplete design never breaks a card.
// program: { bg, accent, mode, goal, reward, logo_path, hero_path }, merchant: { business_name, activity }.
export function prepareDesign(cardDesign, program, merchant, assetUrl) {
  if (!cardDesign || typeof cardDesign !== 'object') return null;
  const project = { merchant, program: { ...program, logo_url: assetUrl(program.logo_path), hero_url: assetUrl(program.hero_path) } };
  const d = normalize(cardDesign, project), base = defaultDesign(project);
  const withUrl = (a, fb) => (a && a.path ? { path: a.path, url: assetUrl(a.path), fallback: fb ? fb.url : null } : fb);
  d.assets = { logo: cardDesign.assets && Object.hasOwn(cardDesign.assets,'logo') ? withUrl(cardDesign.assets.logo,null) : base.assets.logo, hero: withUrl(cardDesign.assets && cardDesign.assets.hero, base.assets.hero),
    background: withUrl(cardDesign.assets && cardDesign.assets.background, null), stamp: withUrl(cardDesign.assets && cardDesign.assets.stamp, null),
    googleStrip: withUrl(cardDesign.assets && cardDesign.assets.googleStrip, null),
    appleStrip: withUrl(cardDesign.assets && cardDesign.assets.appleStrip, null),
    appleHeader: withUrl(cardDesign.assets && cardDesign.assets.appleHeader, null),
    rewardLabel: withUrl(cardDesign.assets && cardDesign.assets.rewardLabel, null),
    businessFont: withUrl(cardDesign.assets && cardDesign.assets.businessFont, null),
    businessNameImage: withUrl(cardDesign.assets && cardDesign.assets.businessNameImage, null),
    googleLogo: withUrl(cardDesign.assets && cardDesign.assets.googleLogo, null),
    googleBusinessNameImage: withUrl(cardDesign.assets && cardDesign.assets.googleBusinessNameImage, null),
    googleWideLogo: withUrl(cardDesign.assets && cardDesign.assets.googleWideLogo, null) };
  if (!d.identity.name) d.identity.name = base.identity.name;
  if (d.stamps.icon === 'custom' && !d.assets.stamp) d.stamps.icon = 'check';
  return d;
}

// Shared design + the platform's own adjustments.
export function effective(design, platform) {
  const p = design[platform] || {};
  return { ...design, colors: { ...design.colors, ...(p.colors || {}) }, opt: p,
    stamps:{...design.stamps,size:stampSizePercent(p.stampSize ?? design.stamps?.size),spacing:stampSpacingPercent(p.stampSpacing ?? design.stamps?.spacing)},
    // Google-only logos override Apple artworks in the Google preview, not in Apple Wallet.
    assets: platform==='google'
      ? { ...design.assets,
          logo: design.assets?.googleLogo || design.assets?.logo,
          businessNameImage: design.assets?.googleBusinessNameImage || design.assets?.businessNameImage }
      : design.assets };
}

export function makeCardDesigner(React, api) {
  const { useState, useEffect, useMemo, useRef } = React;
  const h = React.createElement;
  const Cropper = makeCropper(React);
  const StampLibraryPicker = makeStampLibraryPicker(React);
  const icon = (name, size, extra) => h('span', { className: 'material-symbols-rounded', 'aria-hidden': true, style: { fontSize: size || 20, lineHeight: 1, ...extra } }, name);

  // ------------------------------------------------------------ real QR code (vector, never an image)
  function Qr({ value, size }) {
    // Overview cards (no customer card yet): a neutral box, never a fake code.
    if (!value) return h('div', { 'data-qr-placeholder': true, style: { width: size, height: size, display: 'grid', placeItems: 'center', textAlign: 'center', color: '#5E636B', fontSize: 11, lineHeight: 1.3, border: '1.5px dashed #C9C6BE', borderRadius: 6, boxSizing: 'border-box', padding: 8 } },
      h('div', null, icon('qr_code_2', 28), h('div', null, 'QR personnel du client')));
    return h(QrCode, { value, size });
  }
  function QrCode({ value, size }) {
    const d = useMemo(() => {
      const q = QRCode.create(value, { errorCorrectionLevel: 'M' }), n = q.modules.size, bits = q.modules.data;
      let path = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (bits[y * n + x]) path += `M${x} ${y}h1v1h-1z`;
      return { n, path };
    }, [value]);
    return h('svg', { width: size, height: size, viewBox: `0 0 ${d.n} ${d.n}`, role: 'img', 'aria-label': 'QR code de la carte', 'data-dpa-qr': value, shapeRendering: 'crispEdges', style: { display: 'block' } },
      h('rect', { width: d.n, height: d.n, fill: '#FFFFFF' }), h('path', { d: d.path, fill: '#000000' }));
  }

  // ------------------------------------------------------------ stamps / points
  function Stamp({ on, st, size, stampUrl, final=false }) {
    const fade=inactiveStampOpacity(st?.inactiveOpacity)/100;
    if(final) return h('img',{src:stampImageUrl(st?.rewardId)||'/assets/stamps/reward-star.png',alt:on?'Récompense débloquée':'Récompense à débloquer',
      'data-stamp':on?'filled-final-star':'empty-final-star',style:{width:size,height:size,display:'block',objectFit:'contain',flex:'none',opacity:on?1:fade,filter:on?'none':'grayscale(1)'}});
    const libraryUrl = st?.icon === 'library' ? stampImageUrl(st.libraryId) : '';
    if (libraryUrl) return h('img', {
      src:libraryUrl, alt:on?'Tampon validé':'Tampon restant', 'data-stamp':on?'filled-library-png':'empty-library-png',
      style:{width:size,height:size,objectFit:'contain',display:'block',flex:'none',opacity:on?1:fade,filter:on?'none':'grayscale(1)'}
    });
    if(st?.icon==='custom' && stampUrl) return h('img', {
      src:stampUrl, alt:on?'Tampon validé':'Tampon restant', 'data-stamp':on?'filled-png':'empty-png',
      style:{width:size,height:size,objectFit:'contain',display:'block',flex:'none',opacity:on?1:fade,filter:on?'none':'grayscale(1)'}
    });
    const unicode = normalizeStampEmoji(st?.emoji);
    if (unicode) return h('span', {
      'data-stamp': on ? 'filled-emoji' : 'empty-emoji',
      role: 'img', 'aria-label': on ? 'Tampon validé' : 'Tampon restant',
      style: { width:size, height:size, display:'grid', placeItems:'center', flex:'none',
        fontFamily: "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif",
        fontSize:Math.round(size*.86), lineHeight:1, opacity:on?1:fade,
        filter:on?'none':'grayscale(1)', overflow:'visible' }
    },unicode);
    const radius = st.shape === 'circle' ? '50%' : st.shape === 'rounded' ? '30%' : '4px';
    const base = { width: size, height: size, borderRadius: radius, flex: 'none', display: 'grid', placeItems: 'center', boxSizing: 'border-box' };
    if (!on) {
      // Keep old outlined stamps unchanged at 22%; fade strokes below that.
      const relative=Math.min(1,fade/.22);
      return h('div', { 'data-stamp': 'empty', style: { ...base, ...(st.style === 'soft'
        ? { background: rgba(st.empty,0.28*relative) }
        : { border: `2px solid ${rgba(st.empty,0.85*relative)}` }) } });
    }
    const custom = st.icon === 'custom' && stampUrl;
    return h('div', { 'data-stamp': 'filled', style: { ...base, background: custom ? 'transparent' : st.filled, color: onColor(st.filled) } },
      custom ? h('img', { src: stampUrl, alt: '', style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } })
        : st.icon !== 'none' && st.icon !== 'custom' ? icon(st.icon, Math.round(size * 0.6), { fontVariationSettings: "'FILL' 1, 'wght' 600" }) : null);
  }
  function Progress({ d, data, width, align, dark, large=false }) {
    const goal = Math.max(1, data.goal), done = Math.min(data.progress, goal);
    if (data.mode === 'points' || goal > 30) {
      const pct = Math.min(100, Math.round(data.progress / goal * 100));
      return h('div', { 'data-progress': 'points', style: { width, display: 'flex', flexDirection: 'column', gap: 8, alignItems: align === 'center' ? 'center' : 'stretch' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: align === 'center' ? 'center' : 'flex-start' } },
          h('span', { style: { fontWeight: 800, fontSize: 34, lineHeight: 1, letterSpacing: '-0.02em' } }, data.progress.toLocaleString('fr-FR')),
          h('span', { style: { fontWeight: 600, fontSize: 14, opacity: 0.85 } }, `/ ${goal.toLocaleString('fr-FR')} ${data.mode === 'points' ? 'points' : 'passages'}`)),
        h('div', { style: { height: 8, borderRadius: 4, background: rgba(dark ? '#000000' : '#FFFFFF', 0.25), overflow: 'hidden', width: '100%' } },
          h('div', { style: { width: pct + '%', height: '100%', background: d.stamps.filled } })));
    }
    const rows = goal <= 6 ? 1 : goal <= 14 ? 2 : 3, per = Math.ceil(goal / rows), gap = 8;
    const size = Math.max(14, Math.min(large?50:34, Math.floor((width - (per - 1) * gap) / per)));
    const stampUrl = d.assets.stamp && d.assets.stamp.url;
    const visibleSize=Math.max(7,Math.round(size*stampSizePercent(d.stamps?.size)/100));
    const spacing=stampSpacingPercent(d.stamps?.spacing)/100;
    const lines = Array.from({ length: rows }, (_, r) => Array.from({ length: Math.min(per, goal - r * per) }, (_, i) => r * per + i));
    return h('div', { 'data-progress': 'stamps', 'data-done': done, 'data-goal': goal, style: { display: 'flex', flexDirection: 'column', gap, alignItems: align === 'center' ? 'center' : 'flex-start' } },
      lines.map((l, r) => h('div', { key: r, style: { display: 'flex', gap } }, l.map((i, col) => {
        const dx=(col-(l.length-1)/2)*(size+gap)*(spacing-1);
        const dy=(r-(rows-1)/2)*(size+gap)*(spacing-1);
        return h('div',{key:i,'data-stamp-slot':true,style:{width:size,height:size,flex:'none',display:'grid',placeItems:'center',overflow:'visible',
          transform:spacing===1?undefined:`translate(${dx}px, ${dy}px)`}},
          h(Stamp, { on: i < done, st: d.stamps, size:visibleSize, stampUrl, final:i===goal-1 }));
      }))));
  }

  // An image that cannot load falls back to the program's own image, then to `fallback` (never a broken icon).
  function Img({ asset, style, alt, fallback }) {
    const srcs = asset ? [asset.url, asset.fallback].filter(Boolean) : [];
    const [i, setI] = useState(0);
    useEffect(() => setI(0), [srcs.join('|')]);
    if (i >= srcs.length) return fallback || null;
    return h('img', { src: srcs[i], alt: alt || '', onError: () => setI(n => n + 1), style });
  }
  // Visually crop transparent margins without changing the original uploaded logo.
  function WordmarkImg({asset,style,alt}) {
    const source=asset?.url||'';
    const [display,setDisplay]=useState(source);
    useEffect(()=>{
      let alive=true;
      setDisplay(source);
      if(source)tightWordmarkPreview(source).then(url=>{if(alive)setDisplay(url||source);}).catch(()=>{if(alive)setDisplay(source);});
      return ()=>{alive=false;};
    },[source]);
    return source ? h('img',{src:display||source,alt:alt||'Logo texte',style}) : null;
  }
  const initialsOf = d => (d.identity.name || 'DPA').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase();
  const Logo = ({ d, size, round }) => {
    const box = { width: size, height: size, borderRadius: round ? '50%' : Math.round(size * 0.22), overflow: 'hidden', flex: 'none' };
    const mono = h('div', { style: { ...box, background: d.colors.accent, color: onColor(d.colors.accent), display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: Math.round(size * 0.32) } }, initialsOf(d));
    if (!d.assets.logo || !d.assets.logo.url) return mono;
    return h(Img, { asset: d.assets.logo, alt: 'Logo', fallback: mono,
      style: { ...box, objectFit: 'contain', display: 'block', background: round ? '#FFFFFF' : 'transparent' } });
  };
  const cardBg = (d, opt) => opt.useBackground && d.assets.background && d.assets.background.url
    ? `linear-gradient(${rgba(d.colors.primary, 0.62)}, ${rgba(d.colors.primary, 0.62)}), url("${d.assets.background.url}") center / cover no-repeat, ${d.colors.primary}`
    : d.colors.primary;
  const label = (d, opt, data) => (opt.label || d.label || (data.mode === 'points' ? 'POINTS' : 'TAMPONS')).toUpperCase();
  const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

  // Native-structure preview only. Apple PassKit keeps ownership of the signed
  // .pkpass, field typography and device-specific spacing; this HTML never signs a card.
  function AppleCard({ design, data }) {
    const d = effective(design, 'apple'), o = d.opt, c = d.colors;
    const geo = applePassPreviewGeometry(d, data);
    const W = 375, scale = 340 / W;
    const st = d.stamps, hasPanelArt = !!d.assets.appleStrip?.url;
    const nativeName = o.showBusinessName === true;
    const composed = nativeName && o.headerMode === 'custom' &&
      [4, 5, 6].includes(o.headerArtworkVersion) && !!d.assets.appleHeader?.url;
    const name = String(d.identity.name || 'DPA Cards').slice(0, 40);
    // A test pass derives these colors from its primary background, regardless
    // of the editor's arbitrary font selection.
    const rgb = (c.primary.match(/[0-9a-f]{2}/gi) || ['1c', '1f', '24']).map(v => parseInt(v, 16));
    const light = (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) / 255;
    const ink = data.isTest ? (light > .62 ? '#181C25' : '#FFFFFF') : onColor(c.primary);
    const completed = geo.done, remaining = Math.max(0, geo.goal - completed);
    const isPoints = data.mode === 'points';
    const digits = (String(data.cardNumber || '').replace(/\D/g, '') || '0000').slice(-4);
    const stampUrl = st.icon === 'library' ? stampImageUrl(st.libraryId) :
      st.icon === 'custom' ? d.assets.stamp?.url : '';
    const rewardUrl = stampImageUrl(st.rewardId) || '/assets/stamps/reward-star.png';
    const inactive = inactiveStampOpacity(st.inactiveOpacity);
    const rewardUrlReady = !!(geo.rewardArt && d.assets.rewardLabel?.url);
    const labelStyleNative = { fontSize: 11, lineHeight: '14px', fontWeight: 500,
      textTransform: 'uppercase', letterSpacing: '.02em', opacity: .9 };
    const absolute = (x, y, w, height) => ({ position: 'absolute', left: x - w / 2,
      top: y - height / 2, width: w, height, boxSizing: 'border-box' });

    const stampView = (s, i) => {
      const fade = inactive / 100;
      const img = s.final ? rewardUrl : stampUrl;
      // The signed strip uses color images for acquired stamps and grayscale,
      // faded images for the empty slots.
      if (s.type === 'image' && (img || st.emoji)) {
        const style = { ...absolute(s.x, s.y, s.diameter, s.diameter),
          objectFit: 'contain', display: 'block', opacity: s.done ? 1 : fade,
          filter: s.done ? 'none' : 'grayscale(1)' };
        return img
          ? h('img', { key: i, src: img, alt: '', 'data-native-stamp': s.done ? 'filled' : 'empty', style })
          : h('span', { key: i, 'data-native-stamp': s.done ? 'filled' : 'empty',
              style: { ...style, display: 'grid', placeItems: 'center', fontSize: Math.round(s.diameter * .85) } },
              st.emoji);
      }
      if (s.type === 'image') return null;
      const radius = s.diameter / 2;
      const ring = { ...absolute(s.x, s.y, s.diameter, s.diameter), borderRadius: '50%',
        background: s.done ? st.filled : c.primary };
      if (!s.done) {
        const opacity = inactive < 22 ? inactive / 22 : 1;
        ring.border = (geo.real ? 3 : 2.4) * Math.max(.5, s.diameter / 26) +
          'px solid ' + st.empty;
        ring.opacity = opacity;
      }
      return h('div', { key: i, 'data-native-stamp': s.done ? 'filled' : 'empty',
        style: ring }, s.done && st.icon === 'check'
          ? h('span', { style: { color: c.primary, fontSize: 16, fontWeight: 700,
              display: 'grid', placeItems: 'center', height: '100%' } }, '✓')
          : null);
    };

    const stripBackground = geo.artwork
      ? c.primary
      : geo.real
        ? 'linear-gradient(90deg,' + c.primary + ' 50%,' +
          (o.showStampPanel === false ? c.primary : c.secondary) + ' 50%)'
        : o.showStampPanel === false
          ? c.primary
          : 'linear-gradient(108deg,' + c.secondary + ',' + c.primary + ')';

    const strip = h('div', { 'data-apple-native-strip': true,
      style: { position: 'relative', width: W, height: geo.height,
        background: stripBackground, overflow: 'hidden' } },
      geo.artwork && !hasPanelArt && o.showStampPanel !== false &&
        h('div', { style: { position: 'absolute', left: 16, top: 3,
          width: 343, height: geo.height - 6, background: c.secondary,
          borderRadius: 15 } }),
      hasPanelArt && h(Img, { asset: d.assets.appleStrip, alt: 'Bandeau Apple Wallet',
        style: { position: 'absolute', inset: 0, width: W, height: geo.height,
          objectFit: 'cover', objectPosition: 'center' } }),
      geo.bar && h('div', { 'data-apple-native-progress': true,
        style: { position: 'absolute', left: geo.bar.left, top: geo.bar.top,
          width: geo.bar.width, height: geo.bar.height, background: st.empty } },
        h('div', { style: { width: (geo.bar.fraction * 100) + '%',
          height: '100%', background: st.filled } })),
      geo.stamps.map(stampView),
      !geo.artwork && h('div', { 'data-apple-native-primary': true,
        style: { position: 'absolute', left: 17, top: geo.real ? 28 : 38,
          width: 148, overflow: 'hidden' } },
        h('div', { style: labelStyleNative },
          (o.label || d.label || (isPoints ? 'POINTS' : 'TAMPONS')).slice(0, 16)),
        h('div', { style: { fontWeight: 650, fontSize: 29, lineHeight: 1.3 } },
          completed + ' / ' + geo.goal + (isPoints ? ' pts' : ''))),
      geo.rewardArt && (rewardUrlReady
        ? h(Img, { asset: d.assets.rewardLabel, alt: 'Récompense',
            style: { position: 'absolute', left: 30, top: geo.height === 123 ? 91 : 112,
              width: 315, height: 26, objectFit: 'contain' } })
        : o.rewardText?.trim() && h('div', { 'data-apple-reward': true,
            style: { position: 'absolute', left: 30, top: geo.height === 123 ? 91 : 112,
              width: 315, height: 26, textAlign: 'center', fontSize: 15,
              fontWeight: 700, color: rewardLabelColor(design),
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } },
            o.rewardText.trim())));

    const field = (label, value, align, dataField) =>
      h('div', { 'data-field': dataField || undefined,
        style: { minWidth: 0, flex: 1, textAlign: align || 'left' } },
        h('div', { style: { ...labelStyleNative, ...ellipsis } }, label),
        h('div', { style: { fontWeight: 600, fontSize: geo.artwork ? 26 : 18,
          lineHeight: '30px', ...ellipsis } }, String(value)));

    const fields = geo.artwork
      ? h('div', { 'data-native-apple-fields': 'counters',
          style: { display: 'flex', justifyContent: 'space-between',
            gap: 16, height: 88, boxSizing: 'border-box', padding: '19px 18px 12px' } },
          field(isPoints ? 'Points gagnés' : 'Passages effectués',
            completed, 'left', 'completed-count'),
          field(isPoints ? 'Points restants' : 'Passages restants',
            remaining, 'right', 'remaining-count'))
      : h('div', { 'data-native-apple-fields': 'details',
          style: { height: 130, boxSizing: 'border-box', padding: '16px 18px 8px' } },
          h('div', { style: { display: 'flex', gap: 12 } },
            field('CLIENT', data.client || 'Client test'),
            field('RÉCOMPENSE', data.reward || 'Récompense fidélité')),
          h('div', { style: { marginTop: 13, ...labelStyleNative } },
            data.isTest ? 'DISPONIBLES' : 'CARTE'),
          h('div', { style: { fontSize: 17, fontWeight: 600, marginTop: 2 } },
            data.isTest ? String(data.available || 0) : String(data.cardNumber || '—')));

    const top = h('div', { style: { display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 10, width: W,
      boxSizing: 'border-box', padding: '0 17px', height: 79 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8,
        minWidth: 0, flex: 1 } },
        composed
          ? h(Img, { asset: d.assets.appleHeader, alt: 'En-tête Apple',
              style: { width: 160, height: 50, objectFit: 'contain', flexShrink: 0 } })
          : h(Img, { asset: d.assets.logo, alt: 'Logo',
              style: { width: nativeName ? 64 : 160, height: nativeName ? 48 : 50,
                objectFit: 'contain', objectPosition: 'left center', flexShrink: 0 } }),
        nativeName && !composed && h('div', {
          'data-field': 'apple-native-business-name',
          style: { ...ellipsis, fontWeight: 650, fontSize: 18,
            fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' } },
          name)),
      geo.artwork
        ? h('div', { 'data-field': 'card-number', style: { fontSize: 16,
            fontWeight: 600, flexShrink: 0, fontVariantNumeric: 'tabular-nums' } }, digits)
        : !data.isTest && h('div', { style: { fontSize: 12, fontWeight: 600,
            maxWidth: 126, textAlign: 'right', ...ellipsis } },
            String(data.programName || 'Fidélité').slice(0, 22)));

    const qr = h('div', { 'data-field': 'qr',
      style: { height: 176, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 9 } },
      h('div', { style: { background: '#FFFFFF', borderRadius: 4,
        padding: 10, lineHeight: 0 } }, h(Qr, { value: data.qr, size: 125 })),
      h('div', { style: { fontSize: 11, opacity: .85 } }, 'Par DPA Cards'));
    const nativeHeight = 79 + geo.height + (geo.artwork ? 88 : 130) + 176;
    return h('div', { 'data-layout': 'apple', 'data-apple-passkit-preview': true,
      style: { width: 340, height: Math.ceil(nativeHeight * scale),
        position: 'relative' } },
      h('div', { style: { width: W, height: nativeHeight, borderRadius: 22,
        overflow: 'hidden', background: c.primary, color: ink,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        boxShadow: '0 14px 36px rgba(20,22,28,.19)', transform: 'scale(' + scale + ')',
        transformOrigin: 'top left' } },
        top, strip, fields, qr));
  }
  function GoogleCard({design,data}){
    const d=effective(design,'google'),c=d.colors;
    const art=d.assets.googleStrip || (d.opt.reuseAppleStrip!==false?d.assets.appleStrip:null);
    const done=Math.max(0,Number(data.progress)||0),goal=Math.max(1,Number(data.goal)||10);
    const points=data.mode==='points';
    return h('div',{'data-layout':'google',style:{width:340,borderRadius:22,overflow:'hidden',background:c.primary,color:c.text,fontFamily:FONTS[d.font].css,boxShadow:'0 14px 36px rgba(20,22,28,.19)'}},
      h('div',{style:{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',padding:20}},
        d.assets.businessNameImage?.url
          ? h('div',{'data-field':'google-wide-logo',style:{display:'flex',gap:6,alignItems:'center',minWidth:0,flex:1}},
              d.assets.logo?.url && h(Img,{asset:d.assets.logo,alt:'Logo symbole',style:{width:28,height:32,objectFit:'contain',flexShrink:0}}),
              h(WordmarkImg,{asset:d.assets.businessNameImage,alt:'Logo texte',style:{width:'100%',maxWidth:216,height:44,objectFit:'contain',objectPosition:'left center',minWidth:0,flex:'1 1 auto'}}))
          : h('div',{style:{display:'flex',alignItems:'center',gap:12,minWidth:0}},h(Logo,{d,size:40,round:true}),h('strong',{style:{fontSize:20,...ellipsis}},d.identity.name||'Nom du commerce')),
        d.assets.businessNameImage?.url && h('span',{'data-field':'card-number',style:{fontSize:14,fontWeight:700,flexShrink:0,fontVariantNumeric:'tabular-nums'}},
          (String(data.cardNumber||'').replace(/\D/g,'')||'0000').slice(-4))),
      h('div',{style:{display:'flex',justifyContent:'space-between',padding:'8px 18px 24px'}},
        h('div',null,h('div',null,points?'Points gagnés':'Passages effectués'),h('strong',{'data-field':'completed-count'},String(done))),
        h('div',{style:{textAlign:'right'}},h('div',null,points?'Points restants':'Passages restants'),h('strong',{'data-field':'remaining-count'},String(Math.max(0,goal-done))))),
      h('div',{'data-field':'qr',style:{display:'flex',justifyContent:'center',padding:'0 16px 24px'}},h('div',{style:{background:'#FFF',padding:12,borderRadius:14}},h(Qr,{value:data.qr,size:125}))),
      h('div',{'data-google-stamp-panel':true,style:{position:'relative',width:340,height:340*812/1032,display:'grid',placeItems:'center',background:c.primary}},
        art?.url && h('img',{src:art.url,alt:'Visuel Google Wallet',style:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain'}}),
        d.opt.showStamps!==false && h('div',{style:{position:'relative'}},h(Progress,{d,data,width:250,align:'center',dark:false,large:false}))))
  }

  function CardPreview({ design, data, platform }) { return h(platform === 'google' ? GoogleCard : AppleCard, { design, data }); }
  // The card is drawn at 340 px and scaled to the width of its container (merchant screens use 280–330 px).
  function FitCard({ design, data, platform }) {
    const outer = useRef(null), inner = useRef(null);
    const [box, setBox] = useState({ w: 0, h: 0 });
    useEffect(() => {
      const o = outer.current, i = inner.current; if (!o || !i || typeof ResizeObserver === 'undefined') return undefined;
      const upd = () => setBox({ w: o.clientWidth, h: i.offsetHeight });
      const ro = new ResizeObserver(upd); ro.observe(o); ro.observe(i); upd();
      return () => ro.disconnect();
    }, []);
    const k = box.w ? Math.min(1, box.w / 340) : 1;
    return h('div', { ref: outer, 'data-card-design': platform, style: { width: '100%', height: box.h ? Math.ceil(box.h * k) : 'auto', position: 'relative' } },
      h('div', { ref: inner, style: { width: 340, position: box.w ? 'absolute' : 'static', left: box.w ? Math.max(0, (box.w - 340 * k) / 2) : 0, top: 0, transform: `scale(${k})`, transformOrigin: 'top left' } },
        h(CardPreview, { design, data, platform })));
  }

  // ------------------------------------------------------------ editor controls
  const inputStyle = { width: '100%', height: 46, padding: '0 12px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6 };
  let uid = 0; const useId = p => { const r = useRef(null); if (!r.current) r.current = `${p}-${++uid}`; return r.current; };
  function Field({ label, children, hint }) { return h('div', null, h('div', { style: labelStyle }, label), children, hint ? h('div', { style: { fontSize: 13, color: '#5E636B', marginTop: 5 } }, hint) : null); }
  function Text({ label, value, onChange, max, placeholder }) {
    const id = useId('t');
    return h('div', null, h('label', { htmlFor: id, style: labelStyle }, label), h('input', { id, type: 'text', value, maxLength: max, placeholder, onChange: e => onChange(e.target.value), style: inputStyle }));
  }
  function Num({ label, value, onChange, min, max }) {
    const id = useId('n'); const set = v => onChange(Math.min(max, Math.max(min, Math.round(+v || 0))));
    const b = (txt, d, aria) => h('button', { type: 'button', 'aria-label': aria, onClick: () => set(value + d), disabled: value + d < min || value + d > max, style: { width: 46, height: 46, border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontSize: 20, fontWeight: 700, flex: 'none' } }, txt);
    return h('div', null, h('label', { htmlFor: id, style: labelStyle }, label),
      h('div', { style: { display: 'flex', gap: 8 } }, b('−', -1, 'Diminuer : ' + label),
        h('input', { id, type: 'number', min, max, value, onChange: e => set(e.target.value), style: { ...inputStyle, textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }), b('+', 1, 'Augmenter : ' + label)));
  }
  function Color({ label, value, onChange }) {
    const id = useId('c'); const [txt, setTxt] = useState(value);
    useEffect(() => setTxt(value), [value]);
    return h('div', null, h('label', { htmlFor: id, style: labelStyle }, label),
      h('div', { style: { display: 'flex', gap: 8 } },
        h('input', { type: 'color', 'aria-label': label + ' (sélecteur)', value: (value || '#000000').toLowerCase(), onChange: e => onChange(e.target.value.toUpperCase()), style: { width: 52, height: 46, padding: 3, border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', flex: 'none' } }),
        h('input', { id, type: 'text', value: txt, maxLength: 7, spellCheck: false, onChange: e => { const v = e.target.value.toUpperCase(); setTxt(v); if (HEX.test(v)) onChange(v); }, style: { ...inputStyle, fontFamily: "'IBM Plex Mono', monospace", borderColor: HEX.test(txt) ? '#D4D1C9' : '#B42318' } })));
  }
  function Select({ label, value, onChange, options }) {
    const id = useId('s');
    return h('div', null, h('label', { htmlFor: id, style: labelStyle }, label),
      h('select', { id, value, onChange: e => onChange(e.target.value), style: { ...inputStyle, fontWeight: 600 } }, options.map(([v, l]) => h('option', { key: v, value: v }, l))));
  }
  function Check({ label, checked, onChange }) {
    return h('label', { style: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, fontSize: 15, cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked, onChange: e => onChange(e.target.checked), style: { width: 20, height: 20, accentColor: '#2448F0' } }), label);
  }
  function Section({ title, children }) {
    return h('section', { style: { background: '#FFFFFF', border: '1px solid #E4E1DA', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 } },
      h('h3', { style: { margin: 0, fontWeight: 700, fontSize: 16 } }, title), children);
  }
  function ImagePick({ label, asset, onPick, onRemove, busy, hint, testId, showBusinessName, onToggleBusinessName }) {
    const ref = useRef(null);
    const dimensions = RECOMMENDED_IMAGE_SIZES[testId];
    return h(Field, { label, hint },
      dimensions ? h('div', { 'data-recommended-size': testId, role: 'note',
        style: { marginBottom: 10, padding: '9px 11px', borderRadius: 10, background: '#EEF1FF', color: '#1A36C4', fontSize: 13, lineHeight: 1.45 } },
        h('div', { style: { fontWeight: 750 } }, 'Taille recommandée : ' + dimensions.width + ' × ' + dimensions.height + ' px'),
        h('div', { style: { fontWeight: 500, marginTop: 2 } }, dimensions.format + ' · ' + dimensions.note)) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        asset && asset.url ? h('img', { src: asset.url, alt: '', style: { width: 56, height: 56, objectFit: 'contain', borderRadius: 10, border: '1px solid #E4E1DA', background: 'repeating-conic-gradient(#ECEAE4 0% 25%, #FFFFFF 0% 50%) 0 0/12px 12px' } }) : null,
        h('input', { ref, type: 'file', accept: ['logo','stamp','businessNameImage','googleLogo','googleBusinessNameImage'].includes(testId)?'image/png':'image/png,image/jpeg,image/webp', 'data-upload': testId, style: { display: 'none' }, onChange: e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onPick(f); } }),
        h('button', { type: 'button', disabled: busy, onClick: () => ref.current && ref.current.click(), style: { minHeight: 44, padding: '0 14px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 } },
          icon('upload', 18), busy ? 'Envoi…' : asset ? 'Remplacer' : 'Importer'),
        asset ? h('button', { type: 'button', onClick: onRemove, style: { minHeight: 44, padding: '0 12px', border: 0, background: 'none', color: '#B42318', fontWeight: 600, fontSize: 14 } }, 'Retirer') : null,
        testId==='logo' && h('button', { type:'button', 'data-show-apple-business-name':true, 'aria-pressed':!!showBusinessName,
          onClick:onToggleBusinessName, style:{minHeight:44,padding:'0 12px',border:showBusinessName?'1.5px solid #2448F0':'1.5px solid #D4D1C9',background:showBusinessName?'#EEF1FF':'#FFFFFF',borderRadius:12,color:showBusinessName?'#2448F0':'#1C1F24',fontSize:14,fontWeight:700,display:'flex',alignItems:'center',gap:6} },
          showBusinessName?icon('check_circle',18):icon('text_fields',18),'Afficher le nom du commerce')));
  }

  const CROPS = {
    logo: { aspect: 1, outW: 660, outH: 660, mime: 'image/png', title: 'Recadrer le logo', hint: 'Format carré. Le logo n’est jamais déformé : il est affiché en entier sur la carte.' },
    hero: { aspect: RECOMMENDED_IMAGE_SIZES.hero.width / RECOMMENDED_IMAGE_SIZES.hero.height, outW: RECOMMENDED_IMAGE_SIZES.hero.width, outH: RECOMMENDED_IMAGE_SIZES.hero.height, mime: 'image/jpeg', title: 'Recadrer l’image principale', hint: 'L’image est ensuite cadrée pour chaque plateforme (réglage « Cadrage vertical »).' },
    googleStrip: { aspect: 1032/812, outW: 1032, outH: 812, mime: 'image/png', title: 'Recadrer l’image Google Wallet', hint: 'Image pleine largeur, derrière les tampons Google Wallet.' },
    appleStrip: { aspect: RECOMMENDED_IMAGE_SIZES.appleStrip.width / RECOMMENDED_IMAGE_SIZES.appleStrip.height, outW: RECOMMENDED_IMAGE_SIZES.appleStrip.width, outH: RECOMMENDED_IMAGE_SIZES.appleStrip.height, mime: 'image/png', title: 'Recadrer le bandeau Apple Wallet', hint: 'Bandeau Apple Wallet pleine largeur (375 × 144), recadré au centre sans déformation.' },
    background: { aspect: RECOMMENDED_IMAGE_SIZES.background.width / RECOMMENDED_IMAGE_SIZES.background.height, outW: RECOMMENDED_IMAGE_SIZES.background.width, outH: RECOMMENDED_IMAGE_SIZES.background.height, mime: 'image/jpeg', title: 'Recadrer l’image de fond', hint: 'Elle est assombrie par la couleur principale pour garder le texte lisible.' },
    stamp: { aspect: 1, outW: 256, outH: 256, mime: 'image/png', title: 'Recadrer l’icône de tampon', hint: 'Une image PNG à fond transparent donne le meilleur rendu.' },
  };
  const DST = { submitted: 'À traiter', in_progress: 'En cours', delivered: 'Livré', cancelled: 'Annulé' };
  const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
  const ERR = { test_card_not_found: 'Carte test introuvable (supprimée ?).', program_not_found: 'Programme introuvable.', merchant_not_found: 'Commerce introuvable.', design_request_not_found: 'Demande de design introuvable ou non payée.', invalid_design_request: 'Cette demande de design ne correspond pas à ce programme.', not_admin: 'Accès refusé.' };
  // Admin screen: always show the real error code (route included) rather than a generic message.
  const errText = e => {
    const code = (e && (e.code || e.message)) || 'erreur_inconnue';
    if (ERR[code]) return ERR[code];
    if (/^(missing|invalid)_(logo|googleLogo|hero|background|stamp|businessNameImage|googleBusinessNameImage|googleWideLogo)$/.test(code)) return 'Une image du design est introuvable ou invalide : importez-la à nouveau.';
    const where = e && e.route ? ' — ' + e.route : '';
    if (code === 'network_or_cors') return `Requête bloquée avant le serveur (réseau ou CORS) depuis ${typeof location !== 'undefined' ? location.origin : 'cette page'}${where}. Code : network_or_cors.`;
    return `Opération impossible — code : ${code}${where}.`;
  };

  let fontsLoaded = false;
  function loadFonts() {
    if (fontsLoaded || typeof document === 'undefined') return; fontsLoaded = true;
    const l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700;800&display=swap';
    document.head.appendChild(l);
  }

  // ------------------------------------------------------------ "Ajouter un client" (new merchant account)
  const ACTIVITIES = ['Restaurant', 'Fast-food', 'Coiffeur', 'Barbier', 'Boulangerie', 'Autre'];
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 24).replace(/-+$/, '');
  const ACCESS_ERR = { over_email_send_rate_limit: 'Limite d’envoi d’e-mails atteinte : réessayez dans quelques minutes.', email_address_not_authorized: 'Le service e-mail du projet n’autorise pas encore cette adresse (serveur SMTP à configurer dans Supabase).' };
  function Input({ id, label, value, onChange, error, type, max, placeholder, hint, required, multi }) {
    const base = { ...inputStyle, borderColor: error ? '#B42318' : '#D4D1C9', ...(multi ? { height: 88, padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit' } : {}) };
    return h('div', null, h('label', { htmlFor: id, style: labelStyle }, label, required ? h('span', { 'aria-hidden': true, style: { color: '#B42318' } }, ' *') : null),
      h(multi ? 'textarea' : 'input', { id, name: id, type: multi ? undefined : (type || 'text'), value, maxLength: max, placeholder, 'aria-invalid': !!error, list: id === 'nc-activity' ? 'nc-activities' : undefined,
        onChange: e => onChange(e.target.value), style: base }),
      id === 'nc-activity' ? h('datalist', { id: 'nc-activities' }, ACTIVITIES.map(a => h('option', { key: a, value: a }))) : null,
      error ? h('div', { role: 'alert', style: { marginTop: 6, color: '#B42318', fontSize: 14, fontWeight: 500 } }, error) : hint ? h('div', { style: { fontSize: 13, color: '#5E636B', marginTop: 5 } }, hint) : null);
  }
  function NewClientForm({ onCancel, onCreated }) {
    const [f, setF] = useState({ first: '', last: '', email: '', phone: '', business: '', activity: '', address: '', slug: '', slugEdited: false, program: '', programEdited: false, mode: 'passages', goal: 10, reward: '', conditions: '' });
    const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [ask, setAsk] = useState(null); const [fail, setFail] = useState('');
    const up = k => v => setF(x => { const n = { ...x, [k]: v };
      if (k === 'business') { if (!x.slugEdited) n.slug = slugify(v); if (!x.programEdited) n.program = v.trim() ? ('Club ' + v.trim()).slice(0, 80) : ''; }
      if (k === 'slug') { n.slugEdited = true; n.slug = v.toLowerCase(); } if (k === 'program') n.programEdited = true; if (k === 'mode') n.goal = v === 'points' ? 100 : 10; return n; });
    const check = () => { const e = {}, pts = f.mode === 'points';
      if (!f.first.trim()) e.first = 'Indiquez le prénom du responsable.';
      if (!EMAIL.test(f.email.trim())) e.email = 'Adresse e-mail invalide.';
      if (!f.business.trim()) e.business = 'Indiquez le nom du commerce.';
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug) || f.slug.length > 24) e.slug = 'Lettres minuscules, chiffres et tirets uniquement (24 caractères maximum).';
      if (pts ? !(f.goal >= 50 && f.goal <= 1000) : !(f.goal >= 3 && f.goal <= 20)) e.goal = pts ? 'Entre 50 et 1000 points.' : 'Entre 3 et 20 passages.';
      if (!f.reward.trim()) e.reward = 'Indiquez la récompense.';
      setErr(e); return !Object.keys(e).length; };
    const submit = async (opts = {}) => {
      if (busy || !check()) return; setBusy(true); setFail(''); setAsk(null);
      try {
        const r = await api.createMerchant({ owner: { first: f.first, last: f.last, email: f.email.trim(), phone: f.phone }, business: { name: f.business, activity: f.activity, address: f.address, slug: f.slug },
          program: { name: f.program, mode: f.mode, goal: f.goal, reward: f.reward, conditions: f.conditions }, ...opts });
        onCreated(r);
      } catch (e) {
        const c = e && e.code, info = (e && e.info) || {}, FIELD = { invalid_first: 'first', invalid_email: 'email', invalid_business: 'business', invalid_slug: 'slug', invalid_goal: 'goal', invalid_reward: 'reward' };
        if (FIELD[c]) setErr({ [FIELD[c]]: 'Valeur refusée par le serveur : vérifiez ce champ.' });
        else if (c === 'slug_taken') setErr({ slug: 'Ce lien public est déjà utilisé par un autre commerce.' });
        else if (c === 'email_has_merchant') setErr({ email: 'Cette adresse possède déjà un commerce DPA Cards. Utilisez une autre adresse : deux commerces ne sont jamais fusionnés.' });
        else if (c === 'email_exists') setAsk({ text: 'Un compte DPA Cards existe déjà avec cette adresse, sans commerce. Rattacher ce nouveau commerce à ce compte (aucun second compte ne sera créé) ?', label: 'Rattacher et créer', opts: { ...opts, attach_existing: true } });
        else if (c === 'business_exists') setAsk({ text: `Un commerce porte déjà ce nom (${(info.existing || []).join(', ')}). Les deux commerces resteront distincts. Créer quand même ?`, label: 'Créer quand même', opts: { ...opts, allow_same_name: true } });
        else setFail(errText(e));
      } finally { setBusy(false); }
    };
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 };
    return h('form', { 'data-new-client': true, noValidate: true, onSubmit: e => { e.preventDefault(); submit(); }, style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, icon('person_add', 26, { color: '#2448F0' }), h('h2', { style: { margin: 0, fontWeight: 800, fontSize: 24 } }, 'Ajouter un client')),
      h('p', { style: { margin: 0, color: '#4A4E55', fontSize: 15, lineHeight: 1.5 } }, 'Créez le compte complet du commerçant : il s’ouvre ensuite dans le générateur pour préparer sa carte. Aucun abonnement n’est créé et aucun e-mail n’est envoyé tant que vous ne cliquez pas sur « Envoyer l’accès au commerçant ».'),
      h(Section, { title: 'Responsable' }, h('div', { style: grid },
        h(Input, { id: 'nc-first', label: 'Prénom', required: true, value: f.first, max: 80, onChange: up('first'), error: err.first }),
        h(Input, { id: 'nc-last', label: 'Nom', value: f.last, max: 80, onChange: up('last') }),
        h(Input, { id: 'nc-email', label: 'E-mail', required: true, type: 'email', value: f.email, max: 254, onChange: up('email'), error: err.email }),
        h(Input, { id: 'nc-phone', label: 'Téléphone', type: 'tel', value: f.phone, max: 40, onChange: up('phone') }))),
      h(Section, { title: 'Commerce' }, h('div', { style: grid },
        h(Input, { id: 'nc-business', label: 'Nom du commerce', required: true, value: f.business, max: 120, onChange: up('business'), error: err.business }),
        h(Input, { id: 'nc-activity', label: 'Activité', value: f.activity, max: 60, onChange: up('activity'), placeholder: 'Restaurant, Barbier…' }),
        h(Input, { id: 'nc-address', label: 'Adresse', value: f.address, max: 200, onChange: up('address') }),
        h(Input, { id: 'nc-slug', label: 'Lien public', required: true, value: f.slug, max: 24, onChange: up('slug'), error: err.slug, hint: 'dpa-cards.vercel.app/join/' + (f.slug || '…') }))),
      h(Section, { title: 'Programme de fidélité' }, h('div', { style: grid },
        h(Input, { id: 'nc-program', label: 'Nom du programme', value: f.program, max: 80, onChange: up('program'), placeholder: 'Club ' + (f.business || '…') }),
        h(Select, { label: 'Mode', value: f.mode, options: [['passages', 'Passages'], ['points', 'Points']], onChange: up('mode') }),
        h('div', null, h(Num, { label: 'Objectif', value: f.goal, min: f.mode === 'points' ? 50 : 3, max: f.mode === 'points' ? 1000 : 20, onChange: up('goal') }), err.goal ? h('div', { role: 'alert', style: { marginTop: 6, color: '#B42318', fontSize: 14 } }, err.goal) : null),
        h(Input, { id: 'nc-reward', label: 'Récompense', required: true, value: f.reward, max: 120, onChange: up('reward'), error: err.reward, placeholder: '1 dessert offert' })),
        h(Input, { id: 'nc-conditions', label: 'Conditions (facultatif)', value: f.conditions, max: 600, onChange: up('conditions'), multi: true })),
      h(Section, { title: 'Compte' },
        h('div', { style: { fontSize: 15 } }, 'E-mail de connexion : ', h('strong', null, f.email.trim() || '—')),
        h('div', { style: { fontSize: 13, color: '#5E636B', lineHeight: 1.45 } }, 'Aucun mot de passe à saisir : le commerçant choisira le sien grâce au lien « Envoyer l’accès au commerçant », quand vous le déciderez.'),
        h('div', { style: { fontSize: 13, color: '#2448F0', lineHeight: 1.5 } },
          'Paiement : après création, les frais d’activation sont réglés en ligne ou enregistrés après encaissement sans-contact réel. Le commerçant autorise ensuite ses mensualités par carte ou SEPA directement sur Stripe.')),
      ask ? h('div', { role: 'alertdialog', 'aria-label': 'Confirmation', style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 14, background: '#FFF3DC', color: '#5C4200', fontSize: 15 } }, ask.text,
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: () => submit(ask.opts), disabled: busy, style: { minHeight: 44, padding: '0 14px', border: 0, borderRadius: 12, background: '#1C1F24', color: '#FFFFFF', fontWeight: 700 } }, ask.label),
          h('button', { type: 'button', onClick: () => setAsk(null), style: { minHeight: 44, padding: '0 14px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600 } }, 'Modifier'))) : null,
      fail ? h('div', { role: 'alert', style: { padding: '12px 14px', borderRadius: 12, background: '#FCEBEA', color: '#7A1A13', fontWeight: 600 } }, fail) : null,
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
        h('button', { type: 'button', onClick: onCancel, disabled: busy, style: { minHeight: 50, padding: '0 18px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600, fontSize: 15 } }, 'Annuler'),
        h('button', { type: 'submit', disabled: busy, style: { minHeight: 50, padding: '0 20px', border: 0, borderRadius: 12, background: '#2448F0', color: '#FFFFFF', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 } }, icon('person_add', 20), busy ? 'Création…' : 'Créer le client')));
  }

  // A test card as a designer project: no merchant, no program, no request.
  const testProject = t => { const pv = (t.config && t.config.preview) || {};
    return { test: t, merchant: { id: null, business_name: (t.config && t.config.identity && t.config.identity.name) || 'Commerce test', activity: '' },
      program: { id: null, name: 'Carte de démonstration', mode: pv.mode === 'points' ? 'points' : 'passages', goal: pv.goal || 10, reward: pv.reward || DEMO.reward, bg: '#1C1F24', accent: '#2448F0', logo_path: null, hero_path: null },
      draft: null, requests: [], account: null }; };

  // ------------------------------------------------------------ the designer screen
  function CardDesigner({ merchants, target, onTarget, toast, width, onMerchantsChanged }) {
    const [project, setProject] = useState(null);
    const [design, setDesign] = useState(null);
    const [saved, setSaved] = useState('');
    const [autoSaveError,setAutoSaveError]=useState('');
    const latestSnapshot=useRef({key:'',value:''});
    const failedSnapshot=useRef('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [platform, setPlatform] = useState('apple');
    const [busy, setBusy] = useState(null);
    const [crop, setCrop] = useState(null);
    const [confirm, setConfirm] = useState(false);
    const [requestId, setRequestId] = useState(null);
    const [adding, setAdding] = useState(false);
    const [created, setCreated] = useState(null);
    const [askAccess, setAskAccess] = useState(false);
    const [testName, setTestName] = useState('');
    const [tests, setTests] = useState(null);
    const [askDelete, setAskDelete] = useState(null);
    const [assignTest, setAssignTest] = useState(null);
    const [assignTarget, setAssignTarget] = useState('');
    const [onsiteOpen, setOnsiteOpen] = useState(false);
    const [onsiteRef, setOnsiteRef] = useState('');
    const [onsiteChecked, setOnsiteChecked] = useState(false);
    const [salePlan, setSalePlan] = useState('no_commitment');
    const [saleBilling, setSaleBilling] = useState('monthly');
    const [saleLink, setSaleLink] = useState('');
    const [rewardPickerOpen, setRewardPickerOpen] = useState(false);
    const key = target ? (target.testId ? 't:' + target.testId : target.requestId ? 'r:' + target.requestId : target.merchantId ? 'm:' + target.merchantId : '') : '';
    // A Stripe link is tied to exactly one merchant and one selected plan.
    useEffect(() => { setSaleLink(''); setSalePlan('no_commitment'); setSaleBilling('monthly'); setOnsiteOpen(false); }, [key]);
    useEffect(loadFonts, []);
    const refreshTests = () => api.testList().then(r => setTests(r.tests || [])).catch(() => setTests(t => t || []));
    useEffect(() => { refreshTests(); }, [key]);

    useEffect(() => {
      if (!key) { setProject(null); setDesign(null); return undefined; }
      let live = true; setLoading(true); setError(null);
      // Test card: a project of its own, linked to no merchant (same designer, same layouts).
      if (target.testId) {
        api.testGet(target.testId).then(r => { if (!live) return; const p = testProject(r.test), cfg = normalize(r.test.config, p);
          setProject(p); setRequestId(null); setTestName(r.test.name); setDesign(cfg); setSaved(JSON.stringify(cfg) + '|' + r.test.name); setAutoSaveError('');failedSnapshot.current=''; setLoading(false); })
          .catch(e => { if (live) { setLoading(false); setError(errText(e)); } });
        return () => { live = false; };
      }
      api.load(target.requestId ? { design_request_id: target.requestId } : { merchant_id: target.merchantId })
        .then(p => { if (!live) return; setProject(p); setRequestId(p.request ? p.request.id : null);
          const cfg = p.program ? normalize((p.draft && p.draft.config) || p.program.card_design || null, p) : null;
          setDesign(cfg); setSaved(cfg ? JSON.stringify(cfg) : ''); setAutoSaveError('');failedSnapshot.current=''; setLoading(false);
          if (p.merchant && target.merchantId !== p.merchant.id) onTarget({ merchantId: p.merchant.id, requestId: target.requestId || null }); })
        .catch(e => { if (live) { setLoading(false); setError(errText(e)); } });
      return () => { live = false; };
    }, [key]);

    const isTest = !!(project && project.test);
    const snap = () => JSON.stringify(design) + (isTest ? '|' + testName : '');
    const dirty = !!design && snap() !== saved;
    latestSnapshot.current={key,value:design?snap():''};
    useEffect(() => {
      const w = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w);
    }, [dirty]);

    const set = (path, value) => setDesign(d => {
      const n = JSON.parse(JSON.stringify(d)); let o = n; const ks = path.split('.');
      ks.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; });
      o[ks[ks.length - 1]] = value;
      // Recompose only when bitmap content changes; preserve custom art when
      // switching Classic / Custom so reverting remains instantaneous.
      if(['identity.name','identity.subtitle','assets.logo','assets.businessNameImage','apple.showSubtitle'].includes(path)
        || path.startsWith('colors.') || path.startsWith('apple.colors.')) {
        n.assets.appleHeader=null;n.apple.headerArtworkVersion=0;
      }
      if(['assets.logo','assets.businessNameImage','assets.googleLogo','assets.googleBusinessNameImage'].includes(path)) {
         n.assets.googleWideLogo=null;n.google.wideArtworkVersion=0;
       }
       if(path==='assets.businessNameImage' && value) {
         n.apple.headerMode='custom';n.apple.showBusinessName=true;
       }
       if(path==='apple.headerMode' && value==='custom')n.apple.showBusinessName=true;
      if(path==='apple.showReward'||path==='apple.rewardText'||path==='apple.rewardTextColor'||path.startsWith('colors.')||path.startsWith('apple.colors.'))
        n.assets.rewardLabel=null;
      return n;
    });
    const forSave=async()=>{
      const next=JSON.parse(JSON.stringify(design));
      // Keep the existing native header by default. The composed bitmap is
      // generated ONLY for the selected custom mode, never during signing.
      next.apple.headerMode=next.apple.headerMode==='custom'?'custom':'classic';
      if(next.apple.headerMode==='custom' && next.apple.showBusinessName===true
        && (!next.assets.appleHeader?.path || next.apple.headerArtworkVersion!==APPLE_WORDMARK_VERSION)) {
        const artwork=await createAppleWordmark(next);
        const asset=isTest ? await api.testUpload(project.test.id,'appleHeader',artwork)
          : await api.upload(project.program.id,'appleHeader',artwork);
        next.assets.appleHeader=asset;
        next.apple.headerArtworkVersion=APPLE_WORDMARK_VERSION;
      }
      if(next.assets.googleBusinessNameImage?.path || next.assets.businessNameImage?.path) {
        if(!next.assets.googleWideLogo?.path || next.google.wideArtworkVersion!==GOOGLE_WIDE_LOGO_VERSION) {
          const artwork=await createGoogleWideLogo(next);
          next.assets.googleWideLogo=isTest ? await api.testUpload(project.test.id,'googleWideLogo',artwork)
            : await api.upload(project.program.id,'googleWideLogo',artwork);
          next.google.wideArtworkVersion=GOOGLE_WIDE_LOGO_VERSION;
        }
      } else { next.assets.googleWideLogo=null;next.google.wideArtworkVersion=0; }
      if(next.apple?.showReward===true&&!next.assets?.rewardLabel?.path){
        const bitmap=await createRewardLabel(next);
        const asset=isTest ? await api.testUpload(project.test.id,'rewardLabel',bitmap)
          : await api.upload(project.program.id,'rewardLabel',bitmap);
        next.assets.rewardLabel=asset;
      }
      if(next.apple?.showReward!==true)next.assets.rewardLabel=null;
      return next;
    };
    const savedMark=next=>JSON.stringify(next)+(isTest?'|'+testName:'');
    const pickFile = kind => async f => {
      if(['logo','googleLogo','stamp','businessNameImage','googleBusinessNameImage'].includes(kind)) {
        setBusy('up-'+kind);
        try {
          const blob=kind==='googleLogo' ? await prepareGoogleLogoPng(f)
             : ['businessNameImage','googleBusinessNameImage'].includes(kind) ? await prepareBusinessNamePng(f) : await preparePngUpload(f);
          const a=isTest ? await api.testUpload(project.test.id,kind,blob) : await api.upload(project.program.id,kind,blob);
          set('assets.'+kind,a); if(kind==='stamp')set('stamps.icon','custom');
        } catch(e) {toast(e.message || errText(e));} finally {setBusy(null);}
        return;
      }
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Format non pris en charge : PNG, JPEG ou WebP.');
      if (f.size > 15 * 1024 * 1024) return toast('Image trop lourde (15 Mo maximum).');
      setCrop({ kind, src: URL.createObjectURL(f) });
    };
    const uploadCropped = async blob => {
      const kind = crop.kind; URL.revokeObjectURL(crop.src); setCrop(null); setBusy('up-' + kind);
      try { const a = isTest ? await api.testUpload(project.test.id, kind, blob) : await api.upload(project.program.id, kind, blob); set('assets.' + kind, a); if (kind === 'stamp') set('stamps.icon', 'custom'); }
      catch (e) { toast(errText(e)); }
      finally { setBusy(null); }
    };
    const save = async () => {
      if (busy) return; failedSnapshot.current='';setAutoSaveError('');setBusy('save');
      try { const next=await forSave();
        if (isTest) { const r = await api.testSave(project.test.id, testName, next); setProject(p => ({ ...p, test: r.test })); if(latestSnapshot.current.value===snap())setDesign(next); setSaved(savedMark(next)); refreshTests(); toast('Carte test enregistrée.'); }
        else { await api.save(project.program.id, requestId, next); setDesign(next); setSaved(savedMark(next)); toast('Brouillon enregistré.'); } }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };
    // Test cards autosave after the admin stops typing or moving a slider.
    // Writes are serialized by busy; changes made during a request are never overwritten.
    useEffect(()=>{
      if(!isTest||!project?.test?.id||!design||!dirty||loading||busy) return undefined;
      if(target?.testId!==project.test.id) return undefined;
      const signature=key+'|'+snap();
      if(failedSnapshot.current===signature) return undefined;
      const timer=setTimeout(async()=>{
        if(latestSnapshot.current.key!==key || latestSnapshot.current.value!==snap())return;
        const captured=snap(),capturedName=testName, capturedId=project.test.id;
        setBusy('save');setAutoSaveError('');
        try{
          const next=await forSave();
          const r=await api.testSave(capturedId,capturedName,next);
          if(latestSnapshot.current.key!==key)return;
          setProject(p=>p?.test?.id===capturedId?{...p,test:r.test}:p);
          // If the editor changed while the server was saving, keep the newer draft;
          // the next effect will save that newer snapshot as well.
          if(latestSnapshot.current.value===captured)setDesign(next);
          setSaved(JSON.stringify(next)+'|'+capturedName);
          failedSnapshot.current='';
          refreshTests();
        }catch(e){
          if(latestSnapshot.current.key===key){
            failedSnapshot.current=signature;
            setAutoSaveError(errText(e));
          }
        }finally{
          if(latestSnapshot.current.key===key)setBusy(null);
        }
      },850);
      return ()=>clearTimeout(timer);
    },[key,isTest,dirty,design,testName,project?.test?.id,busy,loading,saved]);

    // ---- test cards
    const createTest = async () => {
      if (busy) return; if (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Continuer ?')) return; setBusy('test');
      try { const base = defaultDesign({ merchant: { business_name: 'Commerce test', activity: 'Démonstration' }, program: { bg: '#1C1F24', accent: '#2448F0', mode: 'passages', goal: 10, reward: DEMO.reward } });
        base.preview.progress = 0;
        const r = await api.testSave(null, 'Nouvelle carte test', base); setAdding(false); setCreated(null); refreshTests(); onTarget({ testId: r.test.id }); toast('Carte test créée.'); }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };
    const duplicateTest = async id => {
      if (busy) return; setBusy('dup');
      try { const r = await api.testDuplicate(id); refreshTests(); onTarget({ testId: r.test.id }); toast('Carte test dupliquée.'); }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };
    const deleteTest = async id => {
      if (busy) return; setBusy('del');
      try { await api.testDelete(id); setAskDelete(null); refreshTests(); if (project && project.test && project.test.id === id) { setSaved(''); setDesign(null); onTarget(null); } toast('Carte test supprimée.'); }
      catch (e) { setAskDelete(null); toast(errText(e)); } finally { setBusy(null); }
    };
    const refreshTest = async () => {
      if(!isTest || busy) return;
      if(dirty && !window.confirm('Des changements non enregistrés seront perdus. Actualiser ?'))return;
      setBusy('refresh');
      try{
        const r=await api.testGet(project.test.id),cfg=normalize(r.test.config,testProject(r.test));
        setProject(testProject(r.test));setDesign(cfg);setTestName(r.test.name);
        setSaved(JSON.stringify(cfg)+'|'+r.test.name);toast('Progression test actualisée.');
      }catch(e){toast(errText(e));}finally{setBusy(null);}
    };
    const newQr = async () => {
      if (busy) return; setBusy('qr');
      try { const r = await api.testNewQr(project.test.id); setProject(p => ({ ...p, test: r.test })); toast('Nouveau QR de test généré.'); }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };
    const testWallet = async () => {
      if (busy) return; setBusy('wallet');
      try { if (dirty) { const next=await forSave(); const r0 = await api.testSave(project.test.id, testName, next); setProject(p => ({ ...p, test: r0.test })); setDesign(next); setSaved(savedMark(next)); }
        const r = await api.testWallet(project.test.id); window.open(r.url, '_blank', 'noopener'); toast('Carte de démonstration prête pour Google Wallet.'); }
      catch (e) { toast(e && e.code === 'wallet_not_configured' ? 'Google Wallet n’est pas configuré.' : errText(e)); } finally { setBusy(null); }
    };
    const testApple = async () => {
      if (busy) return; setBusy('apple');
      try {
        if (dirty || (design.apple?.headerMode==='custom' && design.apple?.showBusinessName && (!design.assets?.appleHeader?.path || design.apple?.headerArtworkVersion!==APPLE_WORDMARK_VERSION)) || (design.apple?.showReward && !design.assets?.rewardLabel?.path)) { const next=await forSave(); const saved = await api.testSave(project.test.id, testName, next);
          setProject(p => ({ ...p, test: saved.test })); setDesign(next); setSaved(savedMark(next)); }
        const result = await api.testApple(project.test.id);
        if (!result.url) throw new Error('apple_wallet_unavailable');
        window.location.assign(result.url);
      } catch (e) {
        toast(e && e.code === 'apple_wallet_not_configured'
          ? 'Apple Wallet : configurez le certificat Apple dans les secrets Supabase.'
          : errText(e));
      } finally { setBusy(null); }
    };
    const validate = async () => {
      if (busy) return; setBusy('validate');
      try { const next=await forSave(); const r = await api.validate(project.program.id, requestId, next);
        setProject(p => ({ ...p, program: r.program, draft: r.draft })); setDesign(next); setSaved(savedMark(next)); setConfirm(false);
        toast('Design validé et appliqué au programme.' + (r.google && r.google.status === 'synced' ? ' Google Wallet mis à jour.' : r.google && r.google.status === 'error' ? ' Synchro Google Wallet en erreur : réessayez.' : '')); }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };
    const retryGoogle = async () => {
      if (busy) return; setBusy('google');
      try { const r = await api.googleSync(project.program.id); setProject(p => ({ ...p, draft: r.draft || p.draft }));
        toast(r.google.status === 'synced' ? 'Google Wallet mis à jour.' : r.google.status === 'no_class' ? 'Aucune carte Google Wallet pour l’instant : le design sera utilisé à la première.' : 'La synchro Google Wallet a encore échoué.'); }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };

    const sendAccess = async () => {
      if (busy || !project) return; setBusy('access');
      try { const r = await api.sendAccess(project.merchant.id);
        setProject(p => ({ ...p, account: { ...p.account, admin_created: { ...(p.account.admin_created || {}), access_sent_at: r.sent_at, access_sent_count: ((p.account.admin_created || {}).access_sent_count || 0) + 1, access_last_error: null } } }));
        setAskAccess(false); toast('Accès envoyé à ' + r.email + '.'); }
      catch (e) { setAskAccess(false); const d = e && e.info && e.info.detail; toast(e && e.code === 'access_email_failed' ? 'Envoi impossible : ' + (ACCESS_ERR[d] || d || 'erreur du service e-mail') : errText(e)); }
      finally { setBusy(null); }
    };
    const refreshSaleStatus = async () => {
      if(busy || !project?.merchant?.id)return;
      setBusy('sale-status');
      try {
        const r=await api.load({merchantId:project.merchant.id});
        setProject(p=>({...p,account:r.account || p.account}));
        toast(['active','trialing'].includes(r.account?.subscription_status)?'Abonnement confirmé par Stripe.':
          'Statut mis à jour. Le paiement ou le mandat peut encore être en cours de confirmation.');
      } catch(e) { toast(errText(e)); }
      finally { setBusy(null); }
    };
    const createSaleLink = async () => {
      if(busy || !project?.merchant?.id) return;
      setBusy('stripe-sale'); setSaleLink('');
      try {
        const r=await api.paymentQuote(project.merchant.id,salePlan,saleBilling);
        const q=r.quote;
        if(!q) throw new Error('quote_unavailable');
        const checkout=await api.paymentCheckout(project.merchant.id,salePlan,saleBilling,q);
        if(!checkout?.url || !/^https:\/\/checkout\.stripe\.com\//.test(checkout.url))throw new Error('invalid_checkout_url');
        setSaleLink(checkout.url);
        toast('Lien Stripe prêt : le commerçant choisit carte bancaire ou IBAN directement sur la page sécurisée.');
      } catch(e) { toast(errText(e)); }
      finally { setBusy(null); }
    };
    const copySaleLink = async () => {
      if(!saleLink)return;
      try {
        await navigator.clipboard.writeText(saleLink);
        toast('Lien de paiement sécurisé copié.');
      } catch(e) { toast('Copie impossible : ouvrez le paiement sur cet appareil.'); }
    };
    const recordOnsite = async () => {
      if (busy || !project?.merchant?.id || !onsiteChecked || onsiteRef.trim().length < 6) return;
      setBusy('onsite');
      try {
        await api.recordOnsiteActivation(project.merchant.id, onsiteRef.trim());
        setProject(prev => ({ ...prev, account: { ...prev.account,
          can_record_onsite: false, activation: {source:'onsite',amount_cents:5000,confirmed_at:new Date().toISOString()} } }));
        setOnsiteOpen(false); setOnsiteRef(''); setOnsiteChecked(false);
        toast('50 € encaissés sur place : référence enregistrée. Le commerçant doit encore autoriser son abonnement sur le site.');
      } catch (e) { toast(e?.code==='already_activated'?'Activation déjà comptabilisée pour ce commerce.':errText(e)); }
      finally { setBusy(null); }
    };
    const onCreated = async r => {
      setAdding(false); setCreated(r);
      if (assignTest) {
        setBusy('assign');
        try {
          await api.testAssign(assignTest, r.merchant.id);
          toast('Compte créé et design de démonstration attribué au commerce.');
        } catch (e) {
          toast('Compte créé, mais la carte n’a pas été attribuée. Rouvrez la carte test pour réessayer.');
        } finally { setBusy(null); setAssignTest(null); setAssignTarget(''); }
      }
      setProject(null); setDesign(null);
      onTarget({ merchantId: r.merchant.id, requestId: null });
      if (onMerchantsChanged) onMerchantsChanged();
    };
    const assignExisting = async () => {
      if (busy || !assignTest || !assignTarget) return;
      if (dirty) return toast('Enregistrez la carte test avant son attribution.');
      const targetMerchant = merchants.find(m => m.id === assignTarget);
      if (!targetMerchant || !targetMerchant.program) return toast('Choisissez un commerce avec programme de fidélité.');
      if (!window.confirm('Appliquer le design de cette carte test à « ' + targetMerchant.name + ' » ? Son design actuel sera remplacé. Les tampons test et le QR de démonstration ne seront jamais transférés.')) return;
      setBusy('assign');
      try {
        const r = await api.testAssign(assignTest, assignTarget);
        setAssignTest(null); setAssignTarget('');
        onTarget({ merchantId: r.merchant_id, requestId: null });
        toast(r.google?.status==='error'?'Design attribué. Synchronisation Google Wallet à réessayer.':'Design attribué au commerce.');
        if (onMerchantsChanged) onMerchantsChanged();
      } catch (e) { toast(errText(e)); }
      finally { setBusy(null); }
    };

    const desk = width >= 1024, two = width >= 900;
    const list = created && !merchants.some(m => m.id === created.merchant.id) ? [...merchants, { id: created.merchant.id, name: created.merchant.business_name, program: true }] : merchants;
    const testCardLabel = t => t.name + (t.creator_name ? ' (' + t.creator_name + ')' : '');
    const merchantOptions = [['', 'Sélectionner un commerce…'], ...list.map(m => [m.id, m.name + (m.program ? '' : ' (sans programme)')]),
      ...(tests || []).map(t => ['t:' + t.id, 'Carte test · ' + testCardLabel(t)])];
    const selValue = adding ? '' : target && target.testId ? 't:' + target.testId : project && project.merchant && project.merchant.id ? project.merchant.id : (target && target.merchantId) || '';
    const pickSel = v => { if (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Changer de carte ?')) return; setAdding(false); setCreated(null);
      onTarget(!v ? null : v.startsWith('t:') ? { testId: v.slice(2) } : { merchantId: v, requestId: null }); };
    const btnTop = (label, ic, onClick, dark, extra) => h('button', { type: 'button', onClick, disabled: !!busy, ...extra,
      style: { minHeight: 46, padding: '0 16px', border: dark ? 0 : '1.5px solid #1C1F24', borderRadius: 12, background: dark ? '#1C1F24' : '#FFFFFF', color: dark ? '#FFFFFF' : '#1C1F24', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' } }, icon(ic, 20), label);
    const testsPanel = h('section', { 'aria-labelledby': 'tests-h', 'data-tests': (tests || []).length, style: { background: '#FFFFFF', border: '1px solid #E4E1DA', borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, icon('science', 22, { color: '#1A36C4' }), h('h2', { id: 'tests-h', style: { margin: 0, fontWeight: 800, fontSize: 18, flex: 1 } }, 'Cartes test'),
        h('span', { style: { fontSize: 13, color: '#5E636B' } }, 'Démos liées à aucun commerce')),
      tests === null ? h('div', { role: 'status', style: { color: '#5E636B', fontSize: 14 } }, 'Chargement…')
        : !tests.length ? h('div', { style: { color: '#5E636B', fontSize: 14 } }, 'Aucune carte test. « + Créer une carte test » en crée une, avec le même générateur que les vraies cartes.')
        : tests.map(t => h('div', { key: t.id, 'data-test-row': t.id, style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid #EFEDE8' } },
          h('div', { style: { flex: '1 1 200px', minWidth: 0 } }, h('div', { style: { fontWeight: 700, fontSize: 15, overflowWrap: 'anywhere' } }, testCardLabel(t)), h('div', { style: { fontSize: 13, color: '#5E636B' } }, 'Modifiée le ' + fmtDate(t.updated_at))),
          h('button', { type: 'button', onClick: () => pickSel('t:' + t.id), style: { minHeight: 40, padding: '0 12px', border: 0, borderRadius: 10, background: '#2448F0', color: '#FFFFFF', fontWeight: 700, fontSize: 14 } }, 'Ouvrir'),
          h('button', { type: 'button', onClick: () => duplicateTest(t.id), disabled: !!busy, style: { minHeight: 40, padding: '0 12px', border: '1.5px solid #D4D1C9', borderRadius: 10, background: '#FFFFFF', fontWeight: 600, fontSize: 14 } }, 'Dupliquer'),
          h('button', { type: 'button', onClick: () => setAskDelete(t), disabled: !!busy, style: { minHeight: 40, padding: '0 12px', border: 0, borderRadius: 10, background: 'none', color: '#B42318', fontWeight: 600, fontSize: 14 } }, 'Supprimer'))));
    const top = h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
      h('div', null,
        h('h1', { style: { margin: 0, fontWeight: 800, fontSize: 'clamp(28px,5vw,38px)', letterSpacing: '-0.03em', lineHeight: 1.05 } }, 'Générateur de cartes'),
        h('div', { style: { marginTop: 6, color: '#5E636B', fontSize: 15 } }, 'Un seul projet de design par programme, décliné en Apple Wallet et Google Wallet.')),
      h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', flex: desk ? 'none' : '1 1 260px' } },
        h('div', { style: { minWidth: 260, flex: '1 1 260px' } }, h(Select, { label: 'Commerce', value: selValue, options: merchantOptions, onChange: pickSel })),
        btnTop('Ajouter un client', 'add', () => { if (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Continuer ?')) return; setAdding(true); setCreated(null); }, true, { 'aria-pressed': adding }),
        btnTop(busy === 'test' ? 'Création…' : 'Créer une carte test', 'science', createTest, false, { 'data-create-test': true })));
    const deleteDialog = askDelete ? h('div', { onClick: () => busy !== 'del' && setAskDelete(null), style: { position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(20,22,28,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 } },
      h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': 'Supprimer la carte test', onClick: e => e.stopPropagation(), style: { width: '100%', maxWidth: 480, background: '#FFFFFF', borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 } },
        h('h2', { style: { margin: 0, fontWeight: 800, fontSize: 22 } }, 'Supprimer la carte test ?'),
        h('p', { style: { margin: 0, fontSize: 15, color: '#3E424A', lineHeight: 1.5 } }, `« ${askDelete.name} », ses images et sa carte Google Wallet de démonstration seront supprimées. Aucun commerce, programme ou client n’est concerné.`),
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: () => setAskDelete(null), disabled: busy === 'del', style: { flex: 1, minWidth: 120, minHeight: 50, border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600, fontSize: 15 } }, 'Annuler'),
          h('button', { type: 'button', onClick: () => deleteTest(askDelete.id), disabled: busy === 'del', style: { flex: 2, minWidth: 160, minHeight: 50, border: 0, borderRadius: 12, background: '#B42318', color: '#FFFFFF', fontWeight: 700, fontSize: 15 } }, busy === 'del' ? 'Suppression…' : 'Supprimer la carte test')))) : null;

    if (adding) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top, h(NewClientForm, { onCancel: () => setAdding(false), onCreated }));
    if (!key) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top,
      h('div', { style: { background: '#FFFFFF', border: '1px solid #E4E1DA', borderRadius: 18, padding: '32px 20px', textAlign: 'center', color: '#5E636B' } }, icon('style', 36, { color: '#9A9EA6' }),
        h('div', { style: { marginTop: 10, fontWeight: 700, fontSize: 17, color: '#1C1F24' } }, 'Choisissez un commerce'), h('div', { style: { marginTop: 6, fontSize: 15 } }, 'Ou ouvrez une demande de design payée avec « Créer la carte », ajoutez un client, ou créez une carte test.')),
      testsPanel, deleteDialog);
    if (loading || (!design && !error && !(project && !project.program))) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top, h('div', { role: 'status', style: { padding: 30, textAlign: 'center', color: '#5E636B' } }, 'Chargement du projet…'));
    if (error) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top, h('div', { role: 'alert', style: { padding: '14px 16px', borderRadius: 14, background: '#FCEBEA', color: '#7A1A13', fontWeight: 600 } }, error));
    if (!project.program) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top, h('div', { style: { padding: '14px 16px', borderRadius: 14, background: '#FFF3DC', color: '#5C4200', fontWeight: 600 } }, 'Ce commerce n’a pas encore de programme de fidélité : terminez d’abord son inscription.'));

    const pg = project.program, req = (project.requests || []).find(r => r.id === requestId) || null, pv = design.preview;
    const data = { ...DEMO, isTest, programName: pg.name, client: pv.client || DEMO.client, progress: pv.progress, goal: pv.goal, mode: pv.mode, reward: pv.reward || DEMO.reward, available: pv.available,
      ...(isTest ? { qr: project.test.qr_value, cardNumber: project.test.card_number } : {}) };
    const po = design[platform], pName = platform === 'apple' ? 'Apple Wallet' : 'Google Wallet';
    const status = isTest ? (busy==='save' ? ['Enregistrement automatique…','#EEF1FF','#1A36C4'] : autoSaveError ? ['Échec de sauvegarde automatique','#FCEBEA','#B42318'] : dirty ? ['Sauvegarde automatique prévue…', '#FFF3DC', '#8A5A00'] : ['CARTE TEST · enregistrée le ' + fmtDate(project.test.updated_at), '#EEF1FF', '#1A36C4'])
      : project.draft && project.draft.status === 'validated' && !dirty ? ['Design validé le ' + fmtDate(project.draft.validated_at), '#E4F3EB', '#1F6B45']
      : dirty ? ['Modifications non enregistrées', '#FFF3DC', '#8A5A00']
      : project.draft ? ['Brouillon enregistré le ' + fmtDate(project.draft.updated_at), '#E8EDFF', '#1A36C4'] : ['Nouveau projet', '#EFEDE8', '#3E424A'];
    const applied = pg.card_design_validated_at ? 'Design appliqué au programme le ' + fmtDate(pg.card_design_validated_at) : 'Aucun design appliqué à ce programme pour l’instant.';

    // Shop prepared by the admin: its owner gets the access link only when the admin sends it.
    const acc = project.account || {}, ac = acc.admin_created;
    const accessBtn = (primary) => h('button', { type: 'button', onClick: () => setAskAccess(true), disabled: !!busy, 'data-send-access': true,
      style: { minHeight: 44, padding: '0 14px', border: primary ? 0 : '1.5px solid #1C1F24', borderRadius: 12, background: primary ? '#1C1F24' : '#FFFFFF', color: primary ? '#FFFFFF' : '#1C1F24', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 } },
      icon('forward_to_inbox', 18), ac && ac.access_sent_at ? 'Renvoyer l’accès au commerçant' : 'Envoyer l’accès au commerçant');
    const accessBlock = ac ? h('div', { 'data-access': ac.access_sent_at ? 'sent' : 'not_sent', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: '#F6F5F1', fontSize: 14 } },
      icon('badge', 20, { color: '#5E636B' }),
      h('span', { style: { flex: '1 1 220px', minWidth: 0 } }, 'Compte préparé par DPA Cards · ', acc.owner_email || '—', ' · ',
        ac.access_sent_at ? 'accès envoyé le ' + fmtDate(ac.access_sent_at) + (ac.access_sent_count > 1 ? ` (${ac.access_sent_count} envois)` : '') : 'accès pas encore envoyé',
        ac.access_last_error ? ' · dernier envoi en erreur' : ''),
      accessBtn(false)) : null;
    const SUBL = { trialing: 'Essai gratuit', active: 'Actif', past_due: 'Paiement en retard', canceled: 'Résilié', incomplete: 'Non finalisé', unpaid: 'Impayé', paused: 'Suspendu', expired: 'Offre terminée' };
    const summary = created && created.merchant.id === project.merchant.id ? h('section', { 'data-created': created.merchant.id, 'aria-label': 'Client créé', style: { background: '#E4F3EB', border: '1px solid #B9E0CB', borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, icon('task_alt', 26, { color: '#1F6B45' }), h('h2', { style: { margin: 0, fontWeight: 800, fontSize: 20, color: '#1F6B45' } }, 'Client créé avec succès')),
      h('dl', { style: { margin: 0, display: 'grid', gridTemplateColumns: 'minmax(120px,max-content) minmax(0,1fr)', gap: '6px 16px', fontSize: 15 } },
        [['Commerce', created.merchant.business_name], ['Responsable', [created.merchant.first_name, created.merchant.last_name].filter(Boolean).join(' ')], ['E-mail', created.owner.email + (created.owner.attached ? ' (compte existant rattaché)' : '')],
          ['Lien public', created.public_url], ['Abonnement', acc.subscription_status ? (SUBL[acc.subscription_status] || acc.subscription_status) : 'Non activé'],
          ['Programme', `${created.program.name} · ${created.program.goal} ${created.program.mode === 'points' ? 'points' : 'passages'} = ${created.program.reward}`]]
          .map(([k, v]) => [h('dt', { key: k + 't', style: { color: '#3E424A' } }, k), h('dd', { key: k + 'd', style: { margin: 0, fontWeight: 600, overflowWrap: 'anywhere' } }, v)])),
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
        h('button', { type: 'button', onClick: () => setCreated(null), style: { minHeight: 46, padding: '0 18px', border: 0, borderRadius: 12, background: '#2448F0', color: '#FFFFFF', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 } }, icon('style', 20), 'Créer sa carte'),
        accessBtn(false))) : null;

    // Test card: its name, its unique test QR, duplicate / delete. No merchant, no request, no validation.
    const smallBtn = (label, onClick, extra) => h('button', { type: 'button', onClick, disabled: !!busy, style: { minHeight: 40, padding: '0 12px', border: '1.5px solid #D4D1C9', borderRadius: 10, background: '#FFFFFF', fontWeight: 600, fontSize: 14, ...((extra && extra.style) || {}) } }, label);
    const testSection = isTest ? h(Section, { title: 'Carte test' },
      h('span', { 'data-test-badge': true, style: { alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 999, background: '#1A36C4', color: '#FFFFFF', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em' } }, 'CARTE TEST'),
      h(Text, { label: 'Nom de la carte test', value: testName, max: 80, placeholder: 'Démo Restaurant', onChange: setTestName }),
      h('div', { style: { fontSize: 14 } }, 'QR de test unique : ', h('code', { 'data-test-qr': project.test.qr_value, style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, overflowWrap: 'anywhere' } }, project.test.qr_value)),
      h('div', { style: { fontSize: 13, color: '#5E636B', lineHeight: 1.45 } }, 'Mode test : la carte commence à 0 passage. Scannez son QR depuis un scanner DPA Cards connecté, puis validez « Ajouter 1 passage test ». Les vrais clients ne sont jamais modifiés.'),
      h('div', { style: { fontWeight: 800, fontSize: 16 } }, `Progression : ${project.test.progress || 0} / ${pv.goal} passages`),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, smallBtn('Actualiser les passages', refreshTest), smallBtn(busy === 'qr' ? 'Génération…' : 'Générer un nouveau QR', newQr), smallBtn('Dupliquer', () => duplicateTest(project.test.id)),
        smallBtn('Supprimer', () => setAskDelete(project.test), { style: { border: 0, background: 'none', color: '#B42318' } })),
      h('button', { type: 'button', disabled: !!busy, onClick: () => { setAssignTest(project.test.id); setAssignTarget(''); },
        'data-assign-test-card': project.test.id, style: { minHeight: 48, padding: '0 18px', border: 0, borderRadius: 12,
          background: '#2448F0', color: '#FFFFFF', fontWeight: 750, fontSize: 15 } }, 'Attribuer cette carte à un commerce'),
      project.test.google_synced_at ? h('div', { style: { fontSize: 13, color: '#5E636B' } }, 'Carte Google Wallet de démonstration mise à jour le ' + fmtDate(project.test.google_synced_at)) : null) : null;
    const params = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      testSection, !isTest && h(Section, { title: 'Projet' },
        h('div', { style: { fontSize: 15 } }, h('strong', null, project.merchant.business_name), ' · ', pg.name, ' · ', `${pg.goal} ${pg.mode === 'points' ? 'points' : 'passages'} = ${pg.reward}`),
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, applied),
        accessBlock,
        ac && h(Section, { title: 'Activation et prélèvements' },
          acc.activation ? h('p', { style: { margin: 0, fontSize: 14, lineHeight: 1.5 } },
            acc.activation.source === 'onsite' ? 'Activation de 50 € enregistrée sur place : aucun second frais d’activation.' :
              'Activation déjà comptabilisée : ' + acc.activation.source) :
            h('p', { style: { margin: 0, fontSize: 14, lineHeight: 1.5 } },
              '50 € d’activation à régler en ligne sur DPA Cards, ou par sans-contact sur votre terminal.'),
          h('p', { style: { margin: 0, fontSize: 13, color: '#5E636B', lineHeight: 1.5 } },
            'Abonnement : le commerçant choisit carte bancaire ou mandat SEPA/IBAN sur Stripe. Les coordonnées bancaires ne sont pas saisies dans cette administration.'),
          acc.can_record_onsite && h('button', { type: 'button', 'data-onsite-activation': true,
            disabled: !!busy, onClick: () => { setOnsiteRef(''); setOnsiteChecked(false); setOnsiteOpen(true); },
            style: { minHeight: 46, border: '1.5px solid #2448F0', borderRadius: 12, background: '#FFFFFF', color: '#2448F0', fontWeight: 750 } },
            'J’ai encaissé 50 € en sans-contact'),
          h('button', { type: 'button', disabled: !!busy, onClick: refreshSaleStatus,
            style: { minHeight: 42, border: '1px solid #D4D1C9', borderRadius: 10, background: '#FFFFFF', fontWeight: 700 } },
            busy==='sale-status'?'Actualisation…':'Actualiser le statut de paiement'),
          !['active','trialing'].includes(acc.subscription_status) && h('div', {
            'data-admin-stripe-checkout': true, style: { display: 'flex', flexDirection: 'column', gap: 12,
              borderTop: '1px solid #E4E1DA', paddingTop: 14 } },
            h('h3', { style: { margin: 0, fontWeight: 800, fontSize: 16 } }, 'Configurer le paiement avec le commerçant'),
            h('p', { style: { margin: 0, fontSize: 13, color: '#5E636B', lineHeight: 1.5 } },
              'Générez un lien Stripe à utiliser en face à face ou à transmettre au commerçant. Stripe demande son consentement et recueille sa carte ou son mandat SEPA.'),
            h(Select, { label: 'Offre', value: salePlan,
              options: [['no_commitment','20 €/mois sans engagement'],['commitment','20 €/mois avec engagement de 12 mois']],
              onChange: v => { setSalePlan(v); if(v==='no_commitment')setSaleBilling('monthly');setSaleLink(''); } }),
            salePlan==='commitment' && h(Select, { label: 'Règlement de l’engagement', value: saleBilling,
              options: [['monthly','20 €/mois'],['prepaid','Engagement réglé en une fois']],
              onChange: v => { setSaleBilling(v); setSaleLink(''); } }),
            h('p', { style: { margin: 0, fontSize: 14 } },
              acc.activation ? '50 € d’activation déjà enregistrés : aucune seconde facturation.' :
                '50 € d’activation seront demandés sur Stripe.'),
            h('button', { type: 'button', disabled: !!busy, onClick: createSaleLink,
              style: { minHeight: 46, padding: '0 14px', border: 0, borderRadius: 12,
                background: '#2448F0', color: '#FFFFFF', fontWeight: 750 } },
              busy==='stripe-sale'?'Création du paiement sécurisé…':'Créer le lien de paiement sécurisé'),
            saleLink && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10,
              padding: 12, border: '1px solid #D4D1C9', borderRadius: 12 } },
              h('a', { href: saleLink, target: '_blank', rel: 'noopener noreferrer',
                style: { minHeight: 46, padding: '12px 14px', display: 'inline-flex',
                  justifyContent: 'center', alignItems: 'center', background: '#1C1F24',
                  color: '#FFFFFF', borderRadius: 10, textDecoration: 'none', fontWeight: 700 } },
                'Ouvrir Stripe avec le commerçant'),
              h('button', { type: 'button', onClick: copySaleLink,
                style: { minHeight: 44, border: '1.5px solid #D4D1C9', borderRadius: 10,
                  background: '#FFFFFF', fontWeight: 700 } }, 'Copier le lien à envoyer au commerçant'),
              h('p', { style: { margin: 0, color: '#5E636B', fontSize: 12, lineHeight: 1.5 } },
                'Une validation Stripe peut être immédiate ou différée (SEPA). Le statut du commerçant est mis à jour par les événements Stripe.'))
          )),
        pg.card_design_validated_at && project.draft && project.draft.google_sync_status ? (() => {
          const g = project.draft, G = { synced: ['Google Wallet à jour' + (g.google_synced_at ? ' (' + fmtDate(g.google_synced_at) + ')' : ''), '#E4F3EB', '#1F6B45'],
            no_class: ['Google Wallet : aucune carte ajoutée pour l’instant, le design sera utilisé à la première', '#EFEDE8', '#3E424A'],
            pending: ['Google Wallet : synchronisation en attente', '#FFF3DC', '#8A5A00'], error: ['Google Wallet : synchronisation en erreur', '#FCEBEA', '#A11D14'] }[g.google_sync_status];
          return h('div', { 'data-google-sync': g.google_sync_status, style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: G[1], color: G[2], fontSize: 14, fontWeight: 600 } },
            icon(g.google_sync_status === 'error' ? 'sync_problem' : g.google_sync_status === 'synced' ? 'cloud_done' : 'cloud_sync', 20), h('span', { style: { flex: 1, minWidth: 0 } }, G[0]),
            g.google_sync_status === 'error' || g.google_sync_status === 'pending' ? h('button', { type: 'button', onClick: retryGoogle, disabled: !!busy, style: { minHeight: 40, padding: '0 12px', border: 0, borderRadius: 10, background: '#1C1F24', color: '#FFFFFF', fontWeight: 700, fontSize: 14 } }, busy === 'google' ? 'Synchronisation…' : 'Réessayer') : null);
        })() : null,
        (project.requests || []).length ? h(Select, { label: 'Demande de design liée', value: requestId || '', onChange: v => setRequestId(v || null),
          options: [['', 'Aucune'], ...project.requests.map(r => [r.id, 'Payée le ' + fmtDate(r.paid_at) + ' — ' + (DST[r.status] || r.status)])] }) : null,
        req ? h('div', { 'data-request': req.id, style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, background: '#F6F5F1', fontSize: 14 } },
          h('div', null, h('strong', null, 'Brief : '), req.description || '—'),
          h('div', null, h('strong', null, 'Couleurs souhaitées : '), req.colors || '—'),
          h('div', null, h('strong', null, 'Contact : '), [req.contact_name, req.contact_email, req.contact_phone].filter(Boolean).join(' · ') || '—'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            req.logo_url ? h('a', { href: req.logo_url, target: '_blank', rel: 'noopener', style: { display: 'block' } }, h('img', { src: req.logo_url, alt: 'Logo fourni', style: { width: 56, height: 56, objectFit: 'contain', borderRadius: 8, background: '#FFFFFF', border: '1px solid #E4E1DA' } })) : null,
            (req.reference_urls || []).map((u, i) => h('a', { key: i, href: u, target: '_blank', rel: 'noopener', style: { display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 36, padding: '0 10px', border: '1.5px solid #D4D1C9', borderRadius: 10, color: '#1C1F24', textDecoration: 'none', fontWeight: 600, fontSize: 13, background: '#FFFFFF' } }, icon('collections', 16), 'Référence ' + (i + 1)))),
          h('div', { style: { fontSize: 12, color: '#5E636B' } }, 'Le logo fourni n’est pas importé automatiquement : téléchargez-le puis importez-le dans « Identité » pour le recadrer.')) : null),
      h(Section, { title: 'Identité' },
        h(Text, { label: 'Nom du commerce', value: design.identity.name, max: 40, onChange: v => set('identity.name', v) }),
        h(Text, { label: 'Activité / sous-titre (facultatif)', value: design.identity.subtitle, max: 40, onChange: v => set('identity.subtitle', v) }),
        h('p',{style:{fontSize:13,color:'#5E636B',margin:0}},'Les logos sont désormais configurés séparément dans les sections Apple Wallet et Google Wallet ci-dessous.')),
      h(Section, { title: 'Logos Apple Wallet' },
        h(ImagePick, { label: 'Logo symbole Apple Wallet', testId: 'logo', asset: design.assets.logo,
          busy: busy === 'up-logo', onPick: pickFile('logo'), onRemove: () => set('assets.logo', null),
          showBusinessName: design.apple.showBusinessName === true,
          onToggleBusinessName: () => set('apple.showBusinessName', design.apple.showBusinessName !== true),
          hint: 'Symbole du commerce pour Apple Wallet. Ne modifie pas le logo Google spécifique si tu en as importé un.' }),
        h(ImagePick, { label: 'Logo texte Apple Wallet', testId: 'businessNameImage',
          asset: design.assets.businessNameImage, busy: busy === 'up-businessNameImage',
          onPick: pickFile('businessNameImage'), onRemove: () => set('assets.businessNameImage', null),
          hint: 'PNG transparent. Le logo texte apparaît juste après le symbole dans le mode personnalisé Apple.' })),
      h(Section, { title: 'Logos Google Wallet' },
        h('p',{style:{fontSize:13,color:'#5E636B',margin:0}},
          'Importe ici un logo réservé à Google Wallet. Sans image spécifique, le logo Apple correspondant est repris automatiquement. Pour colorer ton symbole dans le cercle Google, intègre cette couleur dans le PNG : le fond du cercle est géré par Google.'),
        h(ImagePick, { label: 'Logo symbole Google Wallet', testId: 'googleLogo',
          asset: design.assets.googleLogo, busy: busy === 'up-googleLogo',
          onPick: pickFile('googleLogo'), onRemove: () => set('assets.googleLogo', null),
          hint: 'PNG propre à Google Wallet. Retirer revient au logo symbole Apple, sans modifier Apple Wallet.' }),
        h(ImagePick, { label: 'Logo texte Google Wallet', testId: 'googleBusinessNameImage',
          asset: design.assets.googleBusinessNameImage, busy: busy === 'up-googleBusinessNameImage',
          onPick: pickFile('googleBusinessNameImage'), onRemove: () => set('assets.googleBusinessNameImage', null),
          hint: 'PNG texte réservé à Google Wallet. Facultatif : reprend le logo texte Apple si absent.' })),
      h(Section, { title: 'En-tête Apple Wallet' },
        h(Select,{label:'Style de l’en-tête',value:design.apple.headerMode==='custom'?'custom':'classic',
          options:[['classic','Classique — texte natif Apple (actuel)'],['custom','Personnalisé — symbole + logo texte']],
          onChange:v=>set('apple.headerMode',v)}),
        h('div',{style:{fontSize:13,color:'#5E636B',lineHeight:1.55}},
          design.apple.headerMode==='custom'
            ? 'Symbole à gauche et logo texte importé juste après, dans une image Retina. Sans logo texte, le nom du commerce et son activité sont écrits comme avant. Le numéro de carte reste à droite dans son champ natif.'
            : 'Design actuel : logo PNG à gauche, nom affiché en texte natif Apple Wallet. Vous pouvez essayer le mode personnalisé et revenir ici à tout moment.'),
        design.apple.headerMode==='custom' && design.apple.showBusinessName!==true &&
          h('div',{style:{fontSize:12,color:'#A15A12'}},'Activez « Afficher le nom du commerce » pour voir également l’activité.')),
      h(Section, { title: 'Couleurs' },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 } },
          h(Color, { label: 'Couleur principale (fond)', value: design.colors.primary, onChange: v => set('colors.primary', v) }),
          h(Color, { label: 'Couleur secondaire', value: design.colors.secondary, onChange: v => set('colors.secondary', v) }),
          h(Color, { label: 'Couleur du texte', value: design.colors.text, onChange: v => set('colors.text', v) }),
          h(Color, { label: 'Couleur d’accent', value: design.colors.accent, onChange: v => set('colors.accent', v) }))),
      h(Section, { title: 'Visuels' },
        h(ImagePick, { label: 'Image principale', testId: 'hero', asset: design.assets.hero, busy: busy === 'up-hero', onPick: pickFile('hero'), onRemove: () => set('assets.hero', null), hint: 'Photo, illustration ou création graphique.' }),
        h(ImagePick, { label: 'Image de fond (facultatif)', testId: 'background', asset: design.assets.background, busy: busy === 'up-background', onPick: pickFile('background'), onRemove: () => set('assets.background', null), hint: 'Utilisée si « Image de fond » est cochée dans les ajustements de la plateforme.' })),
      h(Section, { title: 'Programme (aperçu)' },
        h(Select, { label: 'Type de fidélité', value: pv.mode, options: [['passages', 'Passages (tampons)'], ['points', 'Points']], onChange: v => set('preview.mode', v) }),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 } },
          h(Num, { label: 'Objectif', value: pv.goal, min: 1, max: 1000, onChange: v => { set('preview.goal', v); if (pv.progress > v && pv.mode === 'passages') set('preview.progress', v); } }),
          isTest ? h('div', { style: {padding:12,borderRadius:12,background:'#EEF1FF',fontSize:14,color:'#1A36C4'} }, `Progression réelle de la carte test : ${pv.progress} / ${pv.goal}. Utilisez le scanner pour ajouter un passage.`)
            : h(Num, { label: 'Progression de démonstration', value: pv.progress, min: 0, max: pv.mode === 'points' ? 100000 : pv.goal, onChange: v => set('preview.progress', v) }),
          h(Num, { label: 'Récompenses disponibles', value: pv.available, min: 0, max: 99, onChange: v => set('preview.available', v) })),
        h(Text, { label: 'Récompense', value: pv.reward, max: 80, onChange: v => set('preview.reward', v) }),
        h(Text, { label: 'Libellé du type de fidélité', value: design.label, max: 16, placeholder: pv.mode === 'points' ? 'POINTS' : 'TAMPONS', onChange: v => set('label', v) }),
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, isTest ? 'Les passages test sont enregistrés séparément des vrais clients. Actualisez la carte pour voir les passages ajoutés depuis le scanner.' : 'Ces valeurs servent uniquement à l’aperçu : la règle du programme n’est pas modifiée et chaque carte affiche les données de son client.')),
      h(Section, { title: 'Client de démonstration' },
        h(Text, { label: 'Prénom et nom', value: pv.client, max: 60, onChange: v => set('preview.client', v) })),
      h(Section, { title: 'Tampons' },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 } },
          h('div', { style: {gridColumn:'1 / -1'} }, h(StampLibraryPicker, { value: design.stamps.icon === 'library' ? design.stamps.libraryId : '',
            onChange: v => { set('stamps.icon', 'library'); set('stamps.libraryId', v); set('stamps.emoji', ''); set('assets.stamp', null); } }))),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, background: '#1C1F24' } },
          h(Stamp, { on: true, st: design.stamps, size: 34, stampUrl: design.assets.stamp && design.assets.stamp.url }), h(Stamp, { on: true, st: design.stamps, size: 34, stampUrl: design.assets.stamp && design.assets.stamp.url }),
          h(Stamp, { on: false, st: design.stamps, size: 34, stampUrl:design.assets.stamp?.url }), h('span', { style: { color: '#FFFFFF', fontSize: 13, opacity: 0.8 } }, 'Rempli · Rempli · Vide')),
        h(ImagePick, { label: 'Ou importer un tampon PNG personnalisé', testId: 'stamp', asset: design.assets.stamp, busy: busy === 'up-stamp', onPick: pickFile('stamp'), onRemove: () => { set('assets.stamp', null); if (design.stamps.icon === 'custom') { set('stamps.icon', 'library'); set('stamps.libraryId', 'cafe'); } }, hint: 'Un seul PNG transparent : passages effectués en couleur, restants grisés à 22 %. 2 Mo maximum.' }),
        h('div',{'data-wallet-stamp-layout':platform,style:{padding:'12px 14px',background:'#EEF1FF',borderRadius:12,display:'flex',flexDirection:'column',gap:10}},
          h('div',{style:{fontWeight:800,fontSize:15,color:'#1A36C4'}},'Disposition des tampons · '+pName),
          h('p',{style:{fontSize:13,color:'#3E424A',lineHeight:1.45,margin:0}},'Ces deux réglages ne modifient que '+pName+'. Les autres cartes Wallet gardent leurs propres dimensions.'),
          h(Field,{label:'Taille des tampons '+pName+' : '+stampSizePercent(po.stampSize)+' %'},
            h('input',{type:'range',min:50,max:120,step:5,value:stampSizePercent(po.stampSize),
              'data-stamp-size-control':platform,'aria-label':'Taille des tampons '+pName,
              onChange:e=>set(platform+'.stampSize',+e.target.value),
              style:{width:'100%',accentColor:'#2448F0'}})),
          h(Field,{label:'Espacement des tampons '+pName+' : '+stampSpacingPercent(po.stampSpacing)+' %'},
            h('input',{type:'range',min:50,max:120,step:5,value:stampSpacingPercent(po.stampSpacing),
              'data-stamp-spacing-control':platform,'aria-label':'Espacement des tampons '+pName,
              onChange:e=>set(platform+'.stampSpacing',+e.target.value),
              style:{width:'100%',accentColor:'#2448F0'}})),
          h('div',{style:{fontSize:12,color:'#4A4E55',lineHeight:1.4}},'100 % = rendu habituel · 50 % = plus resserré ou plus petit · 120 % = plus espacé ou plus grand. Sans effet sur les cartes à points.')),
        h(Field,{label:'Opacité des tampons non validés : '+inactiveStampOpacity(design.stamps.inactiveOpacity)+' %'},
          h('input',{type:'range',min:0,max:100,step:1,value:inactiveStampOpacity(design.stamps.inactiveOpacity),
            'data-stamp-opacity-control':true,'aria-label':'Opacité des tampons non validés',
            onChange:e=>set('stamps.inactiveOpacity',+e.target.value),
            style:{width:'100%',accentColor:'#2448F0'}}),
          h('div',{style:{marginTop:5,fontSize:13,color:'#5E636B',lineHeight:1.4}},
            '0 % = invisibles · 22 % = gris actuel · 100 % = gris bien visible. Les tampons validés restent en couleur.'))),
      h(Section,{title:'Tampon récompense — dernier tampon'},
        h('div',{style:{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}},
          h('img',{src:stampImageUrl(design.stamps.rewardId)||'/assets/stamps/reward-star.png',
            alt:'Tampon récompense sélectionné',width:56,height:56,style:{objectFit:'contain',background:'#F6F5F1',borderRadius:12,padding:4}}),
          h('div',{style:{flex:'1 1 160px',fontSize:14,color:'#4A4E55'}},'Sélectionnez une autre image pour le dernier tampon. Les anciens modèles gardent leur étoile.'),
          h('button',{type:'button','data-reward-stamp-picker':true,'aria-expanded':rewardPickerOpen,
            onClick:()=>setRewardPickerOpen(v=>!v),
            style:{minHeight:44,padding:'0 14px',borderRadius:12,border:'1.5px solid #2448F0',background:'#EEF1FF',color:'#1A36C4',fontWeight:700,cursor:'pointer'}},
            rewardPickerOpen?'Fermer le choix':'Choisir le tampon récompense')),
        rewardPickerOpen && h(StampLibraryPicker,{includeRewardStar:true,value:design.stamps.rewardId||'reward-star',
          onChange:v=>{set('stamps.rewardId',v);setRewardPickerOpen(false);}})),
      platform==='apple' && h(Section, { title: 'Apple Wallet' },
        h(ImagePick, { label: 'Image du bandeau Apple Wallet (facultatif)', testId: 'appleStrip',
          asset: design.assets.appleStrip, busy: busy==='up-appleStrip', onPick: pickFile('appleStrip'),
          onRemove: () => set('assets.appleStrip', null),
          hint: 'L’image couvre tout le bandeau Apple Wallet, bord à bord, derrière les tampons. Recadrage centré.' }),
        h(Check, { label: 'Afficher les tampons', checked: design.apple.showStamps!==false,
          onChange: v => set('apple.showStamps', v) })),
      platform==='google' && h(Section, { title: 'Google Wallet' },
        h(ImagePick, { label:'Image Google Wallet (facultatif)', testId:'googleStrip', asset:design.assets.googleStrip,
          busy:busy==='up-googleStrip', onPick:pickFile('googleStrip'), onRemove:()=>set('assets.googleStrip',null),
          hint:'1032 × 812 px. Image derrière les tampons, indépendante du bandeau Apple.' }),
        h(Check,{label:'À défaut, reprendre le visuel Apple sans le modifier',checked:design.google.reuseAppleStrip!==false,onChange:v=>set('google.reuseAppleStrip',v)}),
        h(Check,{label:'Afficher les tampons Google',checked:design.google.showStamps!==false,onChange:v=>set('google.showStamps',v)})),
      h(Section, { title: 'Typographie' },
        h(Select, { label: 'Police de la carte', value: design.font, options: Object.entries(FONTS).map(([k, f]) => [k, f.label]), onChange: v => set('font', v) })),
      h(Section, { title: 'Ajustements ' + pName },
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, 'Ces réglages ne s’appliquent qu’à la version ' + pName + '. Le reste du design est commun aux deux plateformes.'),
        h(Check, { label: 'Afficher l’image principale', checked: po.showHero, onChange: v => set(platform + '.showHero', v) }),
        h(Check, { label: 'Afficher le sous-titre', checked: po.showSubtitle, onChange: v => set(platform + '.showSubtitle', v) }),
        platform==='apple' && h(Check, { label: 'Afficher le rectangle des tampons',
          checked: po.showStampPanel!==false, onChange: v => set('apple.showStampPanel', v) }),
        h(Check, { label: 'Utiliser l’image de fond', checked: po.useBackground, onChange: v => set(platform + '.useBackground', v) }),
        h(Field, { label: 'Cadrage vertical de l’image principale : ' + po.heroFocus + ' %' },
          h('input', { type: 'range', min: 0, max: 100, value: po.heroFocus, 'aria-label': 'Cadrage vertical', onChange: e => set(platform + '.heroFocus', +e.target.value), style: { width: '100%', accentColor: '#2448F0' } })),
        h(Text, { label: 'Libellé spécifique (facultatif)', value: po.label, max: 16, placeholder: design.label || (pv.mode === 'points' ? 'POINTS' : 'TAMPONS'), onChange: v => set(platform + '.label', v) }),
        platform==='apple' && h('div',{'data-apple-reward-settings':true,style:{
          padding:'13px 14px',background:'#F6F5F1',borderRadius:12,
          display:'flex',flexDirection:'column',gap:10
        }},
          h(Check,{label:'Afficher la récompense dans le bloc des tampons',checked:po.showReward===true,onChange:v=>set('apple.showReward',v)}),
          po.showReward===true && h(Text,{label:'Texte de récompense',value:po.rewardText||'',max:64,
            placeholder:'Débloque la coupe offerte !',onChange:v=>set('apple.rewardText',v)}),
          po.showReward===true && h('div',null,
            h(Color,{label:'Couleur du texte de récompense',value:po.rewardTextColor||rewardLabelColor(design),
              onChange:v=>set('apple.rewardTextColor',v)}),
            po.rewardTextColor && h('button',{type:'button',onClick:()=>set('apple.rewardTextColor',''),
              style:{marginTop:8,padding:'8px 10px',border:'1px solid #D4D1C9',borderRadius:8,background:'#FFFFFF',cursor:'pointer'}},
              'Revenir à la couleur automatique')),
          h('div',{style:{fontSize:13,color:'#5E636B',lineHeight:1.4}},
            po.showStampPanel===false ? 'Seul le fond du rectangle est masqué. L’image du bandeau, les tampons activés et la récompense restent visibles, sans déplacer les compteurs ni le QR code.' : 'Récompense désactivée : design actuel inchangé. Activée : phrase centrée dans le rectangle des tampons.')
        ),
        h(Check, { label: 'Couleurs spécifiques à ' + pName, checked: Object.keys(po.colors || {}).length > 0, onChange: v => set(platform + '.colors', v ? { ...design.colors } : {}) }),
        Object.keys(po.colors || {}).length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 } },
          [['primary', 'Fond'], ['secondary', 'Secondaire'], ['text', 'Texte'], ['accent', 'Accent']].map(([k, l]) => h(Color, { key: k, label: l + ' (' + pName + ')', value: po.colors[k] || design.colors[k], onChange: v => set(platform + '.colors.' + k, v) }))) : null),
      h(Section, { title: 'QR code' },
        h(Check, { label: 'QR de démonstration dans l’éditeur', checked: true, onChange: () => toast('L’éditeur utilise toujours un QR de démonstration : le vrai QR est généré pour chaque carte.') }),
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, isTest ? 'Carte test : QR unique au format DPA_TEST, reconnu par le scanner comme carte de démonstration. Il reste sur fond blanc et ne fait jamais partie d’une image.' : 'Le QR code est généré par DPA Cards pour chaque carte (format DPA1). Il reste toujours sur fond blanc et ne fait jamais partie d’une image.')));

    const tabs = h('div', { role: 'tablist', 'aria-label': 'Plateforme', style: { display: 'flex', gap: 6, padding: 4, borderRadius: 14, background: '#ECEAE4', alignSelf: 'center' } },
      [['apple', 'Apple Wallet', 'phone_iphone'], ['google', 'Google Wallet', 'android']].map(([k, l, ic]) => h('button', { key: k, type: 'button', role: 'tab', 'aria-selected': platform === k, onClick: () => setPlatform(k),
        style: { minHeight: 42, padding: '0 16px', border: 0, borderRadius: 11, background: platform === k ? '#FFFFFF' : 'transparent', color: '#1C1F24', fontWeight: platform === k ? 700 : 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, boxShadow: platform === k ? '0 1px 4px rgba(20,22,28,0.12)' : 'none' } }, icon(ic, 18), l)));
    const scale = Math.min(1, ((two ? Math.min(width * 0.5, 560) : width) - 48) / 340);
    const preview = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch', ...(two ? { position: 'sticky', top: 84 } : {}) } },
      tabs,
      h('div', { 'data-preview': platform, style: { display: 'flex', justifyContent: 'center', padding: '22px 12px', borderRadius: 20, background: 'repeating-linear-gradient(45deg,#EFEDE8 0 12px,#F4F2EE 12px 24px)' } },
        h('div', { style: { width: 340 * scale, display: 'flex', justifyContent: 'center' } }, h('div', { style: { transform: `scale(${scale})`, transformOrigin: 'top center', height: 'fit-content' } }, h(CardPreview, { design, data, platform })))),
      h('div', { style: { fontSize: 13, color: '#5E636B', lineHeight: 1.45, textAlign: 'center' } }, isTest ? 'Carte test : données et QR de démonstration (DPA_TEST), propres à cette carte.' : 'Aperçu avec des données de démonstration. Sur une vraie carte, le nom du client, la progression, les récompenses et le QR code sont générés pour chaque client.'));

    const actions = h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('span', { role: 'status', style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: status[1], color: status[2], fontSize: 13, fontWeight: 700 } }, status[0]),
      h('div', { style: { flex: 1 } }),
      h('button', { type: 'button', onClick: save, disabled: !!busy, style: { minHeight: 46, padding: '0 16px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 } }, icon('save', 20), busy === 'save' ? 'Enregistrement…' : isTest ? 'Enregistrer la carte test' : 'Enregistrer le brouillon'),
      isTest ? h('button', { type: 'button', onClick: testWallet, disabled: !!busy, 'data-test-wallet': true, 'aria-label':busy==='wallet'?'Préparation de la carte Google Wallet':'Ajouter à Google Wallet', style: { width: 260, maxWidth:'100%', padding:0, border:0, borderRadius:12, overflow:'hidden', background:'#000000', cursor:busy?'progress':'pointer', lineHeight:0 } }, h('img',{src:'/assets/wallet-badge-google.png',alt:'Ajouter à l’app Google Wallet',width:580,height:180,style:{width:'100%',height:'auto',display:'block',opacity:busy==='wallet'?.6:1}})) : null,
      isTest ? h('button', { type: 'button', onClick: testApple, disabled: !!busy, 'data-test-apple': true, 'aria-label':busy==='apple'?'Préparation de la carte Apple Wallet':'Ajouter à Apple Wallet', style: { width: 260, maxWidth:'100%', padding:0, border:0, borderRadius:12, overflow:'hidden', background:'#000000', cursor:busy?'progress':'pointer', lineHeight:0 } }, h('img',{src:'/assets/wallet-badge-apple.png',alt:'Ajouter à l’app Apple Cartes',width:580,height:180,style:{width:'100%',height:'auto',display:'block',opacity:busy==='apple'?.6:1}})) : null,
      !isTest && h('button', { type: 'button', onClick: () => setConfirm(true), disabled: !!busy, style: { minHeight: 46, padding: '0 16px', border: 0, borderRadius: 12, background: '#2448F0', color: '#FFFFFF', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 } }, icon('verified', 20), 'Valider le design'));

    const modal = (body, onClose, label) => h('div', { onClick: onClose, style: { position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(20,22,28,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 } },
      h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': label, onClick: e => e.stopPropagation(), style: { width: '100%', maxWidth: 520, maxHeight: '92vh', overflow: 'auto', background: '#FFFFFF', borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 } }, body));
    const cropC = crop && CROPS[crop.kind];

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      top, summary,
      isTest ? h('div', { role: 'note', 'data-test-mode': true, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, background: '#1A36C4', color: '#FFFFFF' } }, icon('science', 24),
        h('div', null, h('div', { style: { fontWeight: 800, fontSize: 16, letterSpacing: '0.06em' } }, 'MODE TEST'), h('div', { style: { fontSize: 14, opacity: 0.9 } }, 'Carte de démonstration : aucun commerce, aucun compte, aucun client, aucun abonnement.'))) : null,
      actions, isTest ? h('div',{role:'status','data-autosave-status':true,style:{fontSize:13,color:autoSaveError?'#B42318':'#5E636B',lineHeight:1.4}},
        autoSaveError?'Sauvegarde automatique échouée : '+autoSaveError+' · Utilise « Enregistrer la carte test » pour réessayer.':'Les changements de cette carte test sont enregistrés automatiquement après une courte pause.') : null, deleteDialog,
      onsiteOpen && !isTest ? modal([
        h('h2', { key: 'title', style: { margin: 0, fontSize: 22, fontWeight: 800 } }, 'Enregistrer les 50 € encaissés sur place'),
        h('p', { key: 'body', style: { fontSize: 14, lineHeight: 1.55, color: '#3E424A' } },
          'Ce bouton n’encaisse pas de paiement. Utilisez-le uniquement après un paiement sans-contact réel sur votre terminal. Vérifiez le reçu. Aucun second paiement des 50 € ne sera demandé.'),
        h('label', { key: 'ref', style: { display: 'flex', flexDirection: 'column', gap: 8, fontWeight: 700 } },
          'Référence de transaction du terminal',
          h('input', { type: 'text', required: true, maxLength: 100, minLength: 6, value: onsiteRef,
            placeholder: 'Référence imprimée sur le reçu', onChange: e => setOnsiteRef(e.target.value),
            style: { padding: '12px 14px', minHeight: 48, border: '1px solid #D4D1C9', borderRadius: 12, fontSize: 15 } })),
        h('label', { key: 'confirm', style: { display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5 } },
          h('input', { type: 'checkbox', checked: onsiteChecked, onChange: e => setOnsiteChecked(e.target.checked),
            style: { width: 22, height: 22, flexShrink: 0 } }),
          'Je certifie avoir encaissé 50 € pour ce commerce et vérifié le reçu.'),
        h('button', { key: 'save', type: 'button', disabled: !!busy || !onsiteChecked || onsiteRef.trim().length < 6,
          onClick: recordOnsite, style: { minHeight: 48, padding: '0 16px', border: 0, borderRadius: 12,
            background: '#2448F0', color: '#FFFFFF', fontWeight: 750 } },
          busy === 'onsite' ? 'Vérification…' : 'Enregistrer le paiement sur place'),
        h('button', { key: 'cancel', type: 'button', disabled: !!busy, onClick: () => setOnsiteOpen(false),
          style: { minHeight: 44, border: 0, background: '#FFFFFF', fontWeight: 650 } }, 'Annuler')
      ], () => !busy && setOnsiteOpen(false), 'Paiement sans-contact déjà effectué') : null,
      assignTest && isTest && assignTest===project.test.id ? modal([
        h('h2', { key: 'title', style: { margin: 0, fontSize: 22, fontWeight: 800 } }, 'Attribuer cette carte test'),
        h('p', { key: 'note', style: { margin: 0, color: '#3E424A', fontSize: 14, lineHeight: 1.5 } },
          'Le design et ses images sont copiés sur une vraie carte de commerce. Le QR DPA_TEST, les passages fictifs et les cartes Wallet de démonstration restent séparés. Aucun abonnement ni paiement n’est créé automatiquement.'),
        dirty ? h('p', { key: 'dirty', role: 'alert', style: { color: '#B42318', fontSize: 14 } },
          'Enregistrez d’abord vos modifications, puis recommencez.') : null,
        h(Select, { key: 'merchant', label: 'Commerce déjà existant', value: assignTarget,
          options: [['', 'Sélectionner un commerce…'], ...list.filter(m => m.program).map(m => [m.id, m.name])], onChange: setAssignTarget }),
        h('button', { key: 'existing', type: 'button', disabled: !!busy || dirty || !assignTarget, onClick: assignExisting,
          style: { minHeight: 48, border: 0, borderRadius: 12, background: '#2448F0', color: '#FFFFFF', fontWeight: 750 } },
          busy==='assign'?'Attribution…':'Attribuer au commerce sélectionné'),
        h('div', { key: 'separator', style: { textAlign: 'center', color: '#5E636B' } }, 'ou'),
        h('button', { key: 'create', type: 'button', disabled: !!busy || dirty, onClick: () => { setAdding(true); setAssignTarget(''); },
          style: { minHeight: 48, border: '1.5px solid #1C1F24', borderRadius: 12, background: '#FFFFFF', fontWeight: 750 } },
          'Créer un nouveau compte commerçant'),
        h('button', { key: 'cancel', type: 'button', disabled: !!busy, onClick: () => { setAssignTest(null); setAssignTarget(''); },
          style: { minHeight: 44, border: 0, background: 'none', color: '#3E424A' } }, 'Annuler')
      ], () => { if(!busy){ setAssignTest(null); setAssignTarget(''); } }, 'Attribuer une carte test') : null,
      h('div', { style: two ? { display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(380px, 1fr)', gap: 24, alignItems: 'start' } : { display: 'flex', flexDirection: 'column', gap: 18 } },
        two ? params : preview, two ? preview : params),
      isTest ? testsPanel : null,
      crop ? modal(h(Cropper, { key: crop.src, src: crop.src, aspect: cropC.aspect, outW: cropC.outW, outH: cropC.outH, mime: cropC.mime, round: false, title: cropC.title, hint: cropC.hint, onDone: uploadCropped, onCancel: () => { URL.revokeObjectURL(crop.src); setCrop(null); } }), () => {}, cropC.title) : null,
      askAccess ? modal([
        h('h2', { key: 't', style: { margin: 0, fontWeight: 800, fontSize: 22 } }, 'Envoyer l’accès au commerçant ?'),
        h('p', { key: 'p', style: { margin: 0, fontSize: 15, color: '#3E424A', lineHeight: 1.5 } }, `Un e-mail sera envoyé à ${acc.owner_email || 'l’adresse du commerçant'} avec un lien pour choisir son mot de passe et se connecter à son espace DPA Cards. Son abonnement restera à choisir de son côté.`),
        h('div', { key: 'b', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: () => setAskAccess(false), disabled: busy === 'access', style: { flex: 1, minWidth: 120, minHeight: 50, border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600, fontSize: 15 } }, 'Annuler'),
          h('button', { type: 'button', onClick: sendAccess, disabled: busy === 'access', style: { flex: 2, minWidth: 160, minHeight: 50, border: 0, borderRadius: 12, background: '#1C1F24', color: '#FFFFFF', fontWeight: 700, fontSize: 15 } }, busy === 'access' ? 'Envoi…' : 'Envoyer l’accès'))],
        () => busy !== 'access' && setAskAccess(false), 'Envoyer l’accès au commerçant') : null,
      confirm ? modal([
        h('h2', { key: 't', style: { margin: 0, fontWeight: 800, fontSize: 22 } }, 'Valider le design ?'),
        h('p', { key: 'p', style: { margin: 0, fontSize: 15, color: '#3E424A', lineHeight: 1.5 } }, `Le design sera appliqué au programme « ${pg.name} » de ${project.merchant.business_name} : couleurs, logo, image principale et style des tampons, pour Apple Wallet et Google Wallet. Les données de chaque client restent générées par DPA Cards.`),
        req ? h('p', { key: 'r', style: { margin: 0, fontSize: 14, color: '#5E636B', lineHeight: 1.5 } }, 'La demande de design garde son statut actuel (' + (DST[req.status] || req.status) + ') : utilisez « Marquer comme livré » dans les demandes de design quand la carte est prête.') : null,
        h('div', { key: 'b', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: () => setConfirm(false), disabled: busy === 'validate', style: { flex: 1, minWidth: 120, minHeight: 50, border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600, fontSize: 15 } }, 'Annuler'),
          h('button', { type: 'button', onClick: validate, disabled: busy === 'validate', style: { flex: 2, minWidth: 160, minHeight: 50, border: 0, borderRadius: 12, background: '#2448F0', color: '#FFFFFF', fontWeight: 700, fontSize: 15 } }, busy === 'validate' ? 'Validation…' : 'Valider et appliquer'))],
        () => busy !== 'validate' && setConfirm(false), 'Valider le design') : null);
  }

  return { CardDesigner, CardPreview, FitCard, AppleCard, GoogleCard, Qr };
}
