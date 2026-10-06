// Card designer (admin): one design project per program, rendered in two layouts —
// Apple Wallet (full rectangle, rounded corners only) and Google Wallet (its own layout).
// The design only describes the look. Customer name, progress, rewards and the QR code are
// data passed to the renderer for each card; they are never baked into an image.
// Built on the page's React (window.React, the instance dc-runtime renders with).

import QRCode from 'qrcode';
import { makeCropper } from './cropper.js';

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
const ASSET_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(designer\/)?(logo|hero|background|stamp)-[0-9a-f-]{36}\.(png|jpg)$/;
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
    assets: { logo: asset(p.logo_path, p.logo_url), hero: asset(p.hero_path, p.hero_url), background: null, stamp: null },
    stamps: { shape: 'circle', icon: 'check', style: 'outline', filled: '#F2C94C', empty: onColor(bg) },
    apple: { colors: {}, showHero: true, showSubtitle: true, useBackground: false, heroFocus: 50, label: '' },
    google: { colors: {}, showHero: true, showSubtitle: true, useBackground: false, heroFocus: 50, label: '' },
    preview: { mode: p.mode === 'points' ? 'points' : 'passages', goal: p.goal || DEMO.goal, progress: Math.min(DEMO.progress, p.goal || DEMO.goal), reward: p.reward || DEMO.reward, available: DEMO.available, client: DEMO.client },
  };
}
// Saved documents may predate a field: fill the gaps from the defaults.
export function normalize(config, project) {
  const d = defaultDesign(project), c = config || {};
  const plat = k => ({ ...d[k], ...(c[k] || {}), colors: { ...((c[k] || {}).colors || {}) } });
  return { ...d, ...c, identity: { ...d.identity, ...(c.identity || {}) }, colors: { ...d.colors, ...(c.colors || {}) },
    assets: { ...d.assets, ...(c.assets || {}) }, stamps: { ...d.stamps, ...(c.stamps || {}) }, apple: plat('apple'), google: plat('google'),
    preview: { ...d.preview, ...(c.preview || {}) } };
}
// Shared design + the platform's own adjustments.
export function effective(design, platform) {
  const p = design[platform] || {};
  return { ...design, colors: { ...design.colors, ...(p.colors || {}) }, opt: p };
}

export function makeCardDesigner(React, api) {
  const { useState, useEffect, useMemo, useRef } = React;
  const h = React.createElement;
  const Cropper = makeCropper(React);
  const icon = (name, size, extra) => h('span', { className: 'material-symbols-rounded', 'aria-hidden': true, style: { fontSize: size || 20, lineHeight: 1, ...extra } }, name);

  // ------------------------------------------------------------ real QR code (vector, never an image)
  function Qr({ value, size }) {
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
  function Stamp({ on, st, size, stampUrl }) {
    const radius = st.shape === 'circle' ? '50%' : st.shape === 'rounded' ? '30%' : '4px';
    const base = { width: size, height: size, borderRadius: radius, flex: 'none', display: 'grid', placeItems: 'center', boxSizing: 'border-box' };
    if (!on) return h('div', { 'data-stamp': 'empty', style: { ...base, ...(st.style === 'soft' ? { background: rgba(st.empty, 0.28) } : { border: `2px solid ${rgba(st.empty, 0.85)}` }) } });
    const custom = st.icon === 'custom' && stampUrl;
    return h('div', { 'data-stamp': 'filled', style: { ...base, background: custom ? 'transparent' : st.filled, color: onColor(st.filled) } },
      custom ? h('img', { src: stampUrl, alt: '', style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } })
        : st.icon !== 'none' && st.icon !== 'custom' ? icon(st.icon, Math.round(size * 0.6), { fontVariationSettings: "'FILL' 1, 'wght' 600" }) : null);
  }
  function Progress({ d, data, width, align, dark }) {
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
    const size = Math.max(14, Math.min(34, Math.floor((width - (per - 1) * gap) / per)));
    const stampUrl = d.assets.stamp && d.assets.stamp.url;
    const lines = Array.from({ length: rows }, (_, r) => Array.from({ length: Math.min(per, goal - r * per) }, (_, i) => r * per + i));
    return h('div', { 'data-progress': 'stamps', 'data-done': done, 'data-goal': goal, style: { display: 'flex', flexDirection: 'column', gap, alignItems: align === 'center' ? 'center' : 'flex-start' } },
      lines.map((l, r) => h('div', { key: r, style: { display: 'flex', gap } }, l.map(i => h(Stamp, { key: i, on: i < done, st: d.stamps, size, stampUrl })))));
  }

  const Logo = ({ d, size, round }) => d.assets.logo && d.assets.logo.url
    ? h('div', { style: { width: size, height: size, borderRadius: round ? '50%' : Math.round(size * 0.22), overflow: 'hidden', flex: 'none', background: round ? '#FFFFFF' : 'transparent' } },
      h('img', { src: d.assets.logo.url, alt: 'Logo', style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } }))
    : h('div', { style: { width: size, height: size, borderRadius: round ? '50%' : Math.round(size * 0.22), flex: 'none', background: d.colors.accent, color: onColor(d.colors.accent), display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: Math.round(size * 0.32) } },
      (d.identity.name || 'DPA').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase());
  const cardBg = (d, opt) => opt.useBackground && d.assets.background && d.assets.background.url
    ? `linear-gradient(${rgba(d.colors.primary, 0.62)}, ${rgba(d.colors.primary, 0.62)}), url("${d.assets.background.url}") center / cover no-repeat, ${d.colors.primary}`
    : d.colors.primary;
  const label = (d, opt, data) => (opt.label || d.label || (data.mode === 'points' ? 'POINTS' : 'TAMPONS')).toUpperCase();
  const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

  // ------------------------------------------------------------ Apple Wallet: full rectangle, rounded corners only
  function AppleCard({ design, data }) {
    const d = effective(design, 'apple'), o = d.opt, W = 340, c = d.colors;
    const hero = o.showHero && d.assets.hero && d.assets.hero.url;
    const small = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.72 };
    return h('div', { 'data-layout': 'apple', style: { width: W, borderRadius: 16, overflow: 'hidden', background: cardBg(d, o), color: c.text, fontFamily: FONTS[d.font].css, boxShadow: '0 18px 40px rgba(20,22,28,0.22)', display: 'flex', flexDirection: 'column' } },
      // Zone 1 — header
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px' } },
        h(Logo, { d, size: 40 }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { 'data-field': 'business', style: { fontWeight: 700, fontSize: 16, lineHeight: 1.2, ...ellipsis } }, d.identity.name || 'Nom du commerce'),
          o.showSubtitle && d.identity.subtitle ? h('div', { style: { fontSize: 12, opacity: 0.75, marginTop: 2, ...ellipsis } }, d.identity.subtitle) : null),
        h('div', { style: { textAlign: 'right', flex: 'none' } },
          h('div', { style: small }, label(d, o, data)),
          h('div', { 'data-field': 'progress', style: { fontWeight: 700, fontSize: 22, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: c.accent } }, data.mode === 'points' ? data.progress.toLocaleString('fr-FR') : `${Math.min(data.progress, data.goal)}/${data.goal}`))),
      // Zones 2 + 3 — main visual with the stamps on it
      h('div', { style: { position: 'relative', width: W, height: Math.round(W / 2.45), background: hero ? '#000' : `linear-gradient(135deg, ${c.secondary}, ${c.primary})`, overflow: 'hidden' } },
        hero ? h('img', { src: d.assets.hero.url, alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${o.heroFocus}%`, display: 'block' } }) : null,
        h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '10px 18px', background: hero ? 'linear-gradient(rgba(0,0,0,0.05), rgba(0,0,0,0.28))' : 'none', color: '#FFFFFF' } },
          h(Progress, { d, data, width: W - 36, align: 'center', dark: false }))),
      // Zone 4 — information (3 columns)
      h('div', { style: { display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.9fr', gap: 10, padding: '12px 16px 4px' } },
        [['Client', data.client, 'client'], ['Récompense', data.reward, 'reward'], ['Récompenses dispo', String(data.available), 'available']].map(([k, v, f]) =>
          h('div', { key: k, style: { minWidth: 0, textAlign: f === 'available' ? 'right' : 'left' } },
            h('div', { style: { ...small, fontSize: 9 } }, k), h('div', { 'data-field': f, style: { fontWeight: 600, fontSize: 13, marginTop: 3, ...ellipsis } }, v)))),
      // Zone 5 — QR code, always on white
      h('div', { style: { display: 'flex', justifyContent: 'center', padding: '12px 16px 18px' } },
        h('div', { style: { background: '#FFFFFF', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } },
          h(Qr, { value: data.qr, size: 124 }), h('div', { style: { color: '#1C1F24', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" } }, data.cardNumber))));
  }

  // ------------------------------------------------------------ Google Wallet: its own layout
  function GoogleCard({ design, data }) {
    const d = effective(design, 'google'), o = d.opt, W = 340, c = d.colors;
    const hero = o.showHero && d.assets.hero && d.assets.hero.url;
    const lab = { fontSize: 12, fontWeight: 500, opacity: 0.75 };
    const dark = lum(c.primary) > 0.45;
    return h('div', { 'data-layout': 'google', style: { width: W, borderRadius: 26, overflow: 'hidden', background: cardBg(d, o), color: c.text, fontFamily: FONTS[d.font].css, boxShadow: '0 14px 36px rgba(20,22,28,0.2)', display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 18 } },
      // Header — round logo, name, progress chip
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 0' } },
        h(Logo, { d, size: 38, round: true }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { 'data-field': 'business', style: { fontWeight: 600, fontSize: 15, ...ellipsis } }, d.identity.name || 'Nom du commerce'),
          o.showSubtitle && d.identity.subtitle ? h('div', { style: { fontSize: 12, opacity: 0.75, ...ellipsis } }, d.identity.subtitle) : null),
        h('div', { 'data-field': 'progress', style: { flex: 'none', padding: '6px 12px', borderRadius: 999, background: c.accent, color: onColor(c.accent), fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' } },
          data.mode === 'points' ? `${data.progress.toLocaleString('fr-FR')} pts` : `${Math.min(data.progress, data.goal)} / ${data.goal}`)),
      // Main visual, inset with rounded corners
      hero ? h('div', { style: { margin: '0 16px', height: 158, borderRadius: 16, overflow: 'hidden', background: '#000' } },
        h('img', { src: d.assets.hero.url, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${o.heroFocus}%`, display: 'block' } })) : null,
      // Progress on the card background
      h('div', { style: { padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: lab }, label(d, o, data).charAt(0) + label(d, o, data).slice(1).toLowerCase()),
        h('div', { style: { padding: 12, borderRadius: 14, background: rgba(dark ? '#000000' : '#FFFFFF', 0.12) } }, h(Progress, { d, data, width: W - 56, align: 'left', dark }))),
      // Information rows
      h('div', { style: { padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px 16px' } },
        h('div', { style: { minWidth: 0 } }, h('div', { style: lab }, 'Client'), h('div', { 'data-field': 'client', style: { fontWeight: 600, fontSize: 15, ...ellipsis } }, data.client)),
        h('div', { style: { textAlign: 'right' } }, h('div', { style: lab }, 'Récompenses dispo'), h('div', { 'data-field': 'available', style: { fontWeight: 600, fontSize: 15 } }, String(data.available))),
        h('div', { style: { gridColumn: '1 / -1', minWidth: 0 } }, h('div', { style: lab }, 'Récompense'), h('div', { 'data-field': 'reward', style: { fontWeight: 600, fontSize: 15, ...ellipsis } }, data.reward))),
      // QR code, white square
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 } },
        h('div', { style: { background: '#FFFFFF', borderRadius: 16, padding: 12 } }, h(Qr, { value: data.qr, size: 140 })),
        h('div', { style: { fontSize: 12, opacity: 0.8, fontFamily: "'IBM Plex Mono', monospace" } }, data.cardNumber)));
  }

  function CardPreview({ design, data, platform }) { return h(platform === 'google' ? GoogleCard : AppleCard, { design, data }); }

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
  function ImagePick({ label, asset, onPick, onRemove, busy, hint, testId }) {
    const ref = useRef(null);
    return h(Field, { label, hint },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        asset && asset.url ? h('img', { src: asset.url, alt: '', style: { width: 56, height: 56, objectFit: 'contain', borderRadius: 10, border: '1px solid #E4E1DA', background: 'repeating-conic-gradient(#ECEAE4 0% 25%, #FFFFFF 0% 50%) 0 0/12px 12px' } }) : null,
        h('input', { ref, type: 'file', accept: 'image/png,image/jpeg,image/webp', 'data-upload': testId, style: { display: 'none' }, onChange: e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onPick(f); } }),
        h('button', { type: 'button', disabled: busy, onClick: () => ref.current && ref.current.click(), style: { minHeight: 44, padding: '0 14px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 } },
          icon('upload', 18), busy ? 'Envoi…' : asset ? 'Remplacer' : 'Importer'),
        asset ? h('button', { type: 'button', onClick: onRemove, style: { minHeight: 44, padding: '0 12px', border: 0, background: 'none', color: '#B42318', fontWeight: 600, fontSize: 14 } }, 'Retirer') : null));
  }

  const CROPS = {
    logo: { aspect: 1, outW: 660, outH: 660, mime: 'image/png', title: 'Recadrer le logo', hint: 'Format carré. Le logo n’est jamais déformé : il est affiché en entier sur la carte.' },
    hero: { aspect: 1032 / 812, outW: 1032, outH: 812, mime: 'image/jpeg', title: 'Recadrer l’image principale', hint: 'L’image est ensuite cadrée pour chaque plateforme (réglage « Cadrage vertical »).' },
    background: { aspect: 340 / 560, outW: 680, outH: 1120, mime: 'image/jpeg', title: 'Recadrer l’image de fond', hint: 'Elle est assombrie par la couleur principale pour garder le texte lisible.' },
    stamp: { aspect: 1, outW: 256, outH: 256, mime: 'image/png', title: 'Recadrer l’icône de tampon', hint: 'Une image PNG à fond transparent donne le meilleur rendu.' },
  };
  const DST = { submitted: 'À traiter', in_progress: 'En cours', delivered: 'Livré', cancelled: 'Annulé' };
  const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
  const ERR = { program_not_found: 'Programme introuvable.', merchant_not_found: 'Commerce introuvable.', design_request_not_found: 'Demande de design introuvable ou non payée.', invalid_design_request: 'Cette demande de design ne correspond pas à ce programme.', not_admin: 'Accès refusé.' };
  const errText = e => ERR[e && (e.code || e.message)] || (e && /^(missing|invalid)_(logo|hero|background|stamp)$/.test(e.code || '') ? 'Une image du design est introuvable ou invalide : importez-la à nouveau.' : 'Opération impossible pour le moment. Réessayez.');

  let fontsLoaded = false;
  function loadFonts() {
    if (fontsLoaded || typeof document === 'undefined') return; fontsLoaded = true;
    const l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700;800&display=swap';
    document.head.appendChild(l);
  }

  // ------------------------------------------------------------ the designer screen
  function CardDesigner({ merchants, target, onTarget, toast, width }) {
    const [project, setProject] = useState(null);
    const [design, setDesign] = useState(null);
    const [saved, setSaved] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [platform, setPlatform] = useState('apple');
    const [busy, setBusy] = useState(null);
    const [crop, setCrop] = useState(null);
    const [confirm, setConfirm] = useState(false);
    const [requestId, setRequestId] = useState(null);
    const key = target ? (target.requestId ? 'r:' + target.requestId : target.merchantId ? 'm:' + target.merchantId : '') : '';
    useEffect(loadFonts, []);

    useEffect(() => {
      if (!key) { setProject(null); setDesign(null); return undefined; }
      let live = true; setLoading(true); setError(null);
      api.load(target.requestId ? { design_request_id: target.requestId } : { merchant_id: target.merchantId })
        .then(p => { if (!live) return; setProject(p); setRequestId(p.request ? p.request.id : null);
          const cfg = p.program ? normalize((p.draft && p.draft.config) || p.program.card_design || null, p) : null;
          setDesign(cfg); setSaved(cfg ? JSON.stringify(cfg) : ''); setLoading(false);
          if (p.merchant && target.merchantId !== p.merchant.id) onTarget({ merchantId: p.merchant.id, requestId: target.requestId || null }); })
        .catch(e => { if (live) { setLoading(false); setError(errText(e)); } });
      return () => { live = false; };
    }, [key]);

    const dirty = !!design && JSON.stringify(design) !== saved;
    useEffect(() => {
      const w = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w);
    }, [dirty]);

    const set = (path, value) => setDesign(d => { const n = JSON.parse(JSON.stringify(d)); let o = n; const ks = path.split('.'); ks.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; }); o[ks[ks.length - 1]] = value; return n; });
    const pickFile = kind => f => {
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Format non pris en charge : PNG, JPEG ou WebP.');
      if (f.size > 15 * 1024 * 1024) return toast('Image trop lourde (15 Mo maximum).');
      setCrop({ kind, src: URL.createObjectURL(f) });
    };
    const uploadCropped = async blob => {
      const kind = crop.kind; URL.revokeObjectURL(crop.src); setCrop(null); setBusy('up-' + kind);
      try { const a = await api.upload(project.program.id, kind, blob); set('assets.' + kind, a); if (kind === 'stamp') set('stamps.icon', 'custom'); }
      catch (e) { toast(errText(e)); }
      finally { setBusy(null); }
    };
    const save = async () => {
      if (busy) return; setBusy('save');
      try { const snap = JSON.stringify(design); await api.save(project.program.id, requestId, design); setSaved(snap); toast('Brouillon enregistré.'); }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };
    const validate = async () => {
      if (busy) return; setBusy('validate');
      try { const snap = JSON.stringify(design); const r = await api.validate(project.program.id, requestId, design);
        setProject(p => ({ ...p, program: r.program, draft: r.draft })); setSaved(snap); setConfirm(false); toast('Design validé et appliqué au programme.'); }
      catch (e) { toast(errText(e)); } finally { setBusy(null); }
    };

    const desk = width >= 1024, two = width >= 900;
    const merchantOptions = [['', 'Choisir un commerce…'], ...merchants.map(m => [m.id, m.name + (m.program ? '' : ' (sans programme)')])];
    const top = h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
      h('div', null,
        h('h1', { style: { margin: 0, fontWeight: 800, fontSize: 'clamp(28px,5vw,38px)', letterSpacing: '-0.03em', lineHeight: 1.05 } }, 'Générateur de cartes'),
        h('div', { style: { marginTop: 6, color: '#5E636B', fontSize: 15 } }, 'Un seul projet de design par programme, décliné en Apple Wallet et Google Wallet.')),
      h('div', { style: { minWidth: 260, flex: desk ? 'none' : '1 1 260px' } },
        h(Select, { label: 'Créer la carte pour', value: project && project.merchant ? project.merchant.id : (target && target.merchantId) || '', options: merchantOptions,
          onChange: v => { if (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Changer de commerce ?')) return; onTarget(v ? { merchantId: v, requestId: null } : null); } })));

    if (!key) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top,
      h('div', { style: { background: '#FFFFFF', border: '1px solid #E4E1DA', borderRadius: 18, padding: '32px 20px', textAlign: 'center', color: '#5E636B' } }, icon('style', 36, { color: '#9A9EA6' }),
        h('div', { style: { marginTop: 10, fontWeight: 700, fontSize: 17, color: '#1C1F24' } }, 'Choisissez un commerce'), h('div', { style: { marginTop: 6, fontSize: 15 } }, 'Ou ouvrez une demande de design payée avec « Créer la carte ».')));
    if (loading || (!design && !error && !(project && !project.program))) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top, h('div', { role: 'status', style: { padding: 30, textAlign: 'center', color: '#5E636B' } }, 'Chargement du projet…'));
    if (error) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top, h('div', { role: 'alert', style: { padding: '14px 16px', borderRadius: 14, background: '#FCEBEA', color: '#7A1A13', fontWeight: 600 } }, error));
    if (!project.program) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, top, h('div', { style: { padding: '14px 16px', borderRadius: 14, background: '#FFF3DC', color: '#5C4200', fontWeight: 600 } }, 'Ce commerce n’a pas encore de programme de fidélité : terminez d’abord son inscription.'));

    const pg = project.program, req = (project.requests || []).find(r => r.id === requestId) || null, pv = design.preview;
    const data = { ...DEMO, client: pv.client || DEMO.client, progress: pv.progress, goal: pv.goal, mode: pv.mode, reward: pv.reward || DEMO.reward, available: pv.available };
    const po = design[platform], pName = platform === 'apple' ? 'Apple Wallet' : 'Google Wallet';
    const status = project.draft && project.draft.status === 'validated' && !dirty ? ['Design validé le ' + fmtDate(project.draft.validated_at), '#E4F3EB', '#1F6B45']
      : dirty ? ['Modifications non enregistrées', '#FFF3DC', '#8A5A00']
      : project.draft ? ['Brouillon enregistré le ' + fmtDate(project.draft.updated_at), '#E8EDFF', '#1A36C4'] : ['Nouveau projet', '#EFEDE8', '#3E424A'];
    const applied = pg.card_design_validated_at ? 'Design appliqué au programme le ' + fmtDate(pg.card_design_validated_at) : 'Aucun design appliqué à ce programme pour l’instant.';

    const params = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      h(Section, { title: 'Projet' },
        h('div', { style: { fontSize: 15 } }, h('strong', null, project.merchant.business_name), ' · ', pg.name, ' · ', `${pg.goal} ${pg.mode === 'points' ? 'points' : 'passages'} = ${pg.reward}`),
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, applied),
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
        h(ImagePick, { label: 'Logo', testId: 'logo', asset: design.assets.logo, busy: busy === 'up-logo', onPick: pickFile('logo'), onRemove: () => set('assets.logo', null), hint: 'PNG, JPEG ou WebP. Recadré au carré, jamais déformé.' })),
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
          h(Num, { label: 'Progression de démonstration', value: pv.progress, min: 0, max: pv.mode === 'points' ? 100000 : pv.goal, onChange: v => set('preview.progress', v) }),
          h(Num, { label: 'Récompenses disponibles', value: pv.available, min: 0, max: 99, onChange: v => set('preview.available', v) })),
        h(Text, { label: 'Récompense', value: pv.reward, max: 80, onChange: v => set('preview.reward', v) }),
        h(Text, { label: 'Libellé du type de fidélité', value: design.label, max: 16, placeholder: pv.mode === 'points' ? 'POINTS' : 'TAMPONS', onChange: v => set('label', v) }),
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, 'Ces valeurs servent uniquement à l’aperçu : la règle du programme n’est pas modifiée et chaque carte affiche les données de son client.')),
      h(Section, { title: 'Client de démonstration' },
        h(Text, { label: 'Prénom et nom', value: pv.client, max: 60, onChange: v => set('preview.client', v) })),
      h(Section, { title: 'Tampons' },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 } },
          h(Select, { label: 'Forme', value: design.stamps.shape, options: [['circle', 'Cercle'], ['rounded', 'Carré arrondi'], ['square', 'Carré']], onChange: v => set('stamps.shape', v) }),
          h(Select, { label: 'Icône', value: design.stamps.icon, options: STAMP_ICONS, onChange: v => set('stamps.icon', v) }),
          h(Color, { label: 'Couleur tampon rempli', value: design.stamps.filled, onChange: v => set('stamps.filled', v) }),
          h(Color, { label: 'Couleur tampon vide', value: design.stamps.empty, onChange: v => set('stamps.empty', v) }),
          h(Select, { label: 'Tampon vide', value: design.stamps.style, options: [['outline', 'Contour'], ['soft', 'Plein léger']], onChange: v => set('stamps.style', v) })),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, background: '#1C1F24' } },
          h(Stamp, { on: true, st: design.stamps, size: 34, stampUrl: design.assets.stamp && design.assets.stamp.url }), h(Stamp, { on: true, st: design.stamps, size: 34, stampUrl: design.assets.stamp && design.assets.stamp.url }),
          h(Stamp, { on: false, st: design.stamps, size: 34 }), h('span', { style: { color: '#FFFFFF', fontSize: 13, opacity: 0.8 } }, 'Rempli · Rempli · Vide')),
        h(ImagePick, { label: 'Icône personnalisée', testId: 'stamp', asset: design.assets.stamp, busy: busy === 'up-stamp', onPick: pickFile('stamp'), onRemove: () => { set('assets.stamp', null); if (design.stamps.icon === 'custom') set('stamps.icon', 'check'); }, hint: 'Choisie automatiquement comme icône une fois importée.' })),
      h(Section, { title: 'Typographie' },
        h(Select, { label: 'Police de la carte', value: design.font, options: Object.entries(FONTS).map(([k, f]) => [k, f.label]), onChange: v => set('font', v) })),
      h(Section, { title: 'Ajustements ' + pName },
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, 'Ces réglages ne s’appliquent qu’à la version ' + pName + '. Le reste du design est commun aux deux plateformes.'),
        h(Check, { label: 'Afficher l’image principale', checked: po.showHero, onChange: v => set(platform + '.showHero', v) }),
        h(Check, { label: 'Afficher le sous-titre', checked: po.showSubtitle, onChange: v => set(platform + '.showSubtitle', v) }),
        h(Check, { label: 'Utiliser l’image de fond', checked: po.useBackground, onChange: v => set(platform + '.useBackground', v) }),
        h(Field, { label: 'Cadrage vertical de l’image principale : ' + po.heroFocus + ' %' },
          h('input', { type: 'range', min: 0, max: 100, value: po.heroFocus, 'aria-label': 'Cadrage vertical', onChange: e => set(platform + '.heroFocus', +e.target.value), style: { width: '100%', accentColor: '#2448F0' } })),
        h(Text, { label: 'Libellé spécifique (facultatif)', value: po.label, max: 16, placeholder: design.label || (pv.mode === 'points' ? 'POINTS' : 'TAMPONS'), onChange: v => set(platform + '.label', v) }),
        h(Check, { label: 'Couleurs spécifiques à ' + pName, checked: Object.keys(po.colors || {}).length > 0, onChange: v => set(platform + '.colors', v ? { ...design.colors } : {}) }),
        Object.keys(po.colors || {}).length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 } },
          [['primary', 'Fond'], ['secondary', 'Secondaire'], ['text', 'Texte'], ['accent', 'Accent']].map(([k, l]) => h(Color, { key: k, label: l + ' (' + pName + ')', value: po.colors[k] || design.colors[k], onChange: v => set(platform + '.colors.' + k, v) }))) : null),
      h(Section, { title: 'QR code' },
        h(Check, { label: 'QR de démonstration dans l’éditeur', checked: true, onChange: () => toast('L’éditeur utilise toujours un QR de démonstration : le vrai QR est généré pour chaque carte.') }),
        h('div', { style: { fontSize: 13, color: '#5E636B' } }, 'Le QR code est généré par DPA Cards pour chaque carte (format DPA1). Il reste toujours sur fond blanc et ne fait jamais partie d’une image.')));

    const tabs = h('div', { role: 'tablist', 'aria-label': 'Plateforme', style: { display: 'flex', gap: 6, padding: 4, borderRadius: 14, background: '#ECEAE4', alignSelf: 'center' } },
      [['apple', 'Apple Wallet', 'phone_iphone'], ['google', 'Google Wallet', 'android']].map(([k, l, ic]) => h('button', { key: k, type: 'button', role: 'tab', 'aria-selected': platform === k, onClick: () => setPlatform(k),
        style: { minHeight: 42, padding: '0 16px', border: 0, borderRadius: 11, background: platform === k ? '#FFFFFF' : 'transparent', color: '#1C1F24', fontWeight: platform === k ? 700 : 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, boxShadow: platform === k ? '0 1px 4px rgba(20,22,28,0.12)' : 'none' } }, icon(ic, 18), l)));
    const scale = Math.min(1, ((two ? Math.min(width * 0.5, 560) : width) - 48) / 340);
    const preview = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch', ...(two ? { position: 'sticky', top: 84 } : {}) } },
      tabs,
      h('div', { 'data-preview': platform, style: { display: 'flex', justifyContent: 'center', padding: '22px 12px', borderRadius: 20, background: 'repeating-linear-gradient(45deg,#EFEDE8 0 12px,#F4F2EE 12px 24px)' } },
        h('div', { style: { width: 340 * scale, display: 'flex', justifyContent: 'center' } }, h('div', { style: { transform: `scale(${scale})`, transformOrigin: 'top center', height: 'fit-content' } }, h(CardPreview, { design, data, platform })))),
      h('div', { style: { fontSize: 13, color: '#5E636B', lineHeight: 1.45, textAlign: 'center' } }, 'Aperçu avec des données de démonstration. Sur une vraie carte, le nom du client, la progression, les récompenses et le QR code sont générés pour chaque client.'));

    const actions = h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('span', { role: 'status', style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: status[1], color: status[2], fontSize: 13, fontWeight: 700 } }, status[0]),
      h('div', { style: { flex: 1 } }),
      h('button', { type: 'button', onClick: save, disabled: !!busy, style: { minHeight: 46, padding: '0 16px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 } }, icon('save', 20), busy === 'save' ? 'Enregistrement…' : 'Enregistrer le brouillon'),
      h('button', { type: 'button', onClick: () => setConfirm(true), disabled: !!busy, style: { minHeight: 46, padding: '0 16px', border: 0, borderRadius: 12, background: '#2448F0', color: '#FFFFFF', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 } }, icon('verified', 20), 'Valider le design'));

    const modal = (body, onClose, label) => h('div', { onClick: onClose, style: { position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(20,22,28,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 } },
      h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': label, onClick: e => e.stopPropagation(), style: { width: '100%', maxWidth: 520, maxHeight: '92vh', overflow: 'auto', background: '#FFFFFF', borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 } }, body));
    const cropC = crop && CROPS[crop.kind];

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      top, actions,
      h('div', { style: two ? { display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(380px, 1fr)', gap: 24, alignItems: 'start' } : { display: 'flex', flexDirection: 'column', gap: 18 } },
        two ? params : preview, two ? preview : params),
      crop ? modal(h(Cropper, { key: crop.src, src: crop.src, aspect: cropC.aspect, outW: cropC.outW, outH: cropC.outH, mime: cropC.mime, round: false, title: cropC.title, hint: cropC.hint, onDone: uploadCropped, onCancel: () => { URL.revokeObjectURL(crop.src); setCrop(null); } }), () => {}, cropC.title) : null,
      confirm ? modal([
        h('h2', { key: 't', style: { margin: 0, fontWeight: 800, fontSize: 22 } }, 'Valider le design ?'),
        h('p', { key: 'p', style: { margin: 0, fontSize: 15, color: '#3E424A', lineHeight: 1.5 } }, `Le design sera appliqué au programme « ${pg.name} » de ${project.merchant.business_name} : couleurs, logo, image principale et style des tampons, pour Apple Wallet et Google Wallet. Les données de chaque client restent générées par DPA Cards.`),
        req ? h('p', { key: 'r', style: { margin: 0, fontSize: 14, color: '#5E636B', lineHeight: 1.5 } }, 'La demande de design garde son statut actuel (' + (DST[req.status] || req.status) + ') : utilisez « Marquer comme livré » dans les demandes de design quand la carte est prête.') : null,
        h('div', { key: 'b', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: () => setConfirm(false), disabled: busy === 'validate', style: { flex: 1, minWidth: 120, minHeight: 50, border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontWeight: 600, fontSize: 15 } }, 'Annuler'),
          h('button', { type: 'button', onClick: validate, disabled: busy === 'validate', style: { flex: 2, minWidth: 160, minHeight: 50, border: 0, borderRadius: 12, background: '#2448F0', color: '#FFFFFF', fontWeight: 700, fontSize: 15 } }, busy === 'validate' ? 'Validation…' : 'Valider et appliquer'))],
        () => busy !== 'validate' && setConfirm(false), 'Valider le design') : null);
  }

  return { CardDesigner, CardPreview, AppleCard, GoogleCard, Qr };
}
