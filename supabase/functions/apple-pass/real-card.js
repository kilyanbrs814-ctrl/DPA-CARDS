// Shared, pure mapping from a REAL, validated DPA Cards design to a native Apple store card.
// The Apple Wallet preview in the editor is illustrative: PassKit owns native layout.
// Keep this module free of Supabase, Deno and signing secrets so it can be unit tested.
import { libraryStampId } from '../_shared/stamp-library.js';
const HEX = /^#[0-9a-fA-F]{6}$/;
// Keep the actual DB card number for scanning. The number on the pass is
// display-only, while the full number stays available on the back for support.
export const visibleCardNumber = value => {
  const raw=String(value || '').trim();
  const digits=raw.replace(/\D/g, '');
  return digits ? digits.slice(-4) : (raw || '—');
};
// iOS gives logoText and the header card number a shared horizontal area.
// Shorten ONLY the visible header; the full merchant name remains metadata.
export const appleHeaderName = name => {
  const full=String(name||'DPA Cards').trim();
  if(full.length<=10)return full;
  const words=full.slice(0,11).trim().split(/\s+/);
  return words.length>1?words.slice(0,-1).join(' '):full.slice(0,10);
};
const txt = (value, limit = 60) => typeof value === 'string' ? value.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, limit) : '';
export const hex = (value, fallback) => HEX.test(value || '') ? value.toUpperCase() : fallback;
export const toRgb = (value) => {
  const h = hex(value, '#2448F0');
  return 'rgb(' + [1, 3, 5].map(n => parseInt(h.slice(n, n + 2), 16)).join(', ') + ')';
};
export const luminance = h => {
  const s = hex(h, '#000000').slice(1);
  const channels = [0, 2, 4].map(i => {
    const v = parseInt(s.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
};
export const onBackground = (background, preferred) => {
  const bg = luminance(background);
  const contrast = other => {
    const fg = luminance(other);
    return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
  };
  const pref = hex(preferred, '');
  if (pref && contrast(pref) >= 4.5) return pref;
  return contrast('#FFFFFF') > contrast('#1C1F24') ? '#FFFFFF' : '#1C1F24';
};
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
// Only branded image files belonging to THIS program may be read with service role.
export const assetPath = (value, card, kind) => {
  const path = typeof value === 'string' ? value : value?.path;
  if (!isUuid(card?.merchant_id) || !isUuid(card?.program_id) || !['logo', 'hero', 'background', 'stamp'].includes(kind)) return null;
  const prefix = card.merchant_id + '/' + card.program_id + '/';
  if (!path?.startsWith(prefix)) return null;
  const suffix = path.slice(prefix.length);
  return new RegExp('^(?:designer/)?' + kind + '-[0-9a-f-]{36}\\.(?:png|jpg)$', 'i').test(suffix) ? path : null;
};
export function testAssetPath(value, testId, kind) {
  if(!isUuid(testId) || !['logo','stamp'].includes(kind))return null;
  const path=typeof value==='string'?value:value?.path;
  return typeof path==='string' && new RegExp('^tests/'+testId+'/designer/'+kind+'-[0-9a-f-]{36}\\.png$','i').test(path)?path:null;
}
export function realAppleBrand(program, merchant, card) {
  const d = program?.card_design && typeof program.card_design === 'object' ? program.card_design : {};
  const apple = d.apple || {}, base = d.colors || {}, overrides = apple.colors || {}, assets = d.assets || {};
  const color = (name, fallback) => hex(overrides[name], hex(base[name], fallback));
  const primary = color('primary', hex(program?.bg, '#1C1F24'));
  const secondary = color('secondary', hex(program?.accent, primary));
  const accent = color('accent', secondary);
  const foreground = onBackground(primary, color('text', ''));
  const issuer = txt(d.identity?.name, 40) || txt(merchant?.business_name, 40) || 'DPA Cards';
  const subtitle = apple.showSubtitle !== false ? txt(d.identity?.subtitle, 50) : '';
  const label = txt(apple.label, 16) || txt(d.label, 16) || (program?.mode === 'points' ? 'POINTS' : 'TAMPONS');
  const showHero = apple.showHero !== false;
  const backgroundImage = apple.useBackground === true ? assetPath(assets.background, card, 'background') : null;
  const hero = showHero ? (assetPath(assets.hero, card, 'hero') || assetPath(program?.hero_path, card, 'hero')) : null;
  return {
    issuer, subtitle, label, primary, secondary, accent, foreground,
    showBusinessName: apple.showBusinessName === true,
    logo: Object.hasOwn(assets,'logo') ? assetPath(assets.logo, card, 'logo') : assetPath(program?.logo_path, card, 'logo'),
    stamp: d.stamps?.icon === 'custom' && assets.stamp?.path?.endsWith('.png') ? assetPath(assets.stamp, card, 'stamp') : null,
    libraryId: d.stamps?.icon === 'library' ? libraryStampId(d.stamps.libraryId) : '',
    artwork: backgroundImage || hero, heroFocus: Number.isFinite(+apple.heroFocus) ? Math.max(0, Math.min(100, +apple.heroFocus)) : 50,
    stamps: d.stamps || {}, mode: program?.mode === 'points' ? 'points' : 'passages',
    emoji: !['library','custom'].includes(d.stamps?.icon) && typeof d.stamps?.emoji === 'string' && /\p{Extended_Pictographic}/u.test(d.stamps.emoji) ? d.stamps.emoji.slice(0,32) : '',
  };
}
export function realApplePassData({ program, merchant, customer, card, balance }) {
  const brand = realAppleBrand(program, merchant, card);
  const b = Math.max(0, Math.floor(Number(balance) || 0));
  const goal = Math.max(1, Math.floor(Number(program.goal) || 10));
  const modePoints = program.mode === 'points';
  const client = [txt(customer?.first_name, 80), txt(customer?.last_name, 80)].filter(Boolean).join(' ') || 'Client';
  const barcode = { format: 'PKBarcodeFormatQR', message: 'DPA1:' + card.qr_token, messageEncoding: 'iso-8859-1', altText: (brand.emoji || brand.stamp || brand.libraryId) ? visibleCardNumber(card.card_number) : card.card_number };
  return { brand, goal, balance: b, json: {
    formatVersion: 1,
    passTypeIdentifier: 'pass.fr.digitalprojectagency.cards',
    teamIdentifier: 'HDK7R3283T',
    serialNumber: card.id,
    organizationName: brand.issuer,
    // Native PassKit text: iOS draws it in its system typography next to the logo.
    ...(brand.showBusinessName ? { logoText: brand.issuer } : {}),
    description: 'Carte de fidélité ' + brand.issuer,

    backgroundColor: toRgb(brand.primary),
    foregroundColor: toRgb(brand.foreground),
    labelColor: toRgb(brand.foreground),
    storeCard: (brand.emoji || brand.stamp || brand.libraryId) ? {
      // Apple controls native StoreCard placement. A tiny neutral primary
      // field reserves the strip artwork; no progress text obscures emojis.
      headerFields: [{key:'number',label:'',value:visibleCardNumber(card.card_number)}],
      primaryFields: [{key:'artwork',label:'',value:'\u00a0'}],
      secondaryFields: [
        // Apple styles field VALUES more prominently than field labels.
        // Keep counts native, accessible and synchronized with the actual balance.
        {key:'done',label:modePoints?'Points gagnés':'Passages effectués',value:String(b),textAlignment:'PKTextAlignmentLeft'},
        {key:'remaining',label:modePoints?'Points restants':'Passages restants',value:String(Math.max(0,goal-b)),textAlignment:'PKTextAlignmentRight'},
      ],
      backFields: [
        {key:'full_card',label:'NUMÉRO COMPLET',value:txt(card.card_number,42)},
        {key:'client',label:'CLIENT',value:client},
        {key:'reward',label:'RÉCOMPENSE',value:txt(program.reward,90)||'Récompense fidélité'},
        ...(brand.subtitle?[{key:'subtitle',label:'LE COMMERCE',value:brand.subtitle}]:[]),
        {key:'rule',label:'CONDITIONS',value:modePoints?goal+' points pour '+txt(program.reward,90):goal+' passages pour '+txt(program.reward,90)},
        {key:'info',label:'DPA Cards',value:'Présentez votre QR code en caisse. Le solde correspond à la dernière génération du pass ; les mises à jour automatiques ne sont pas encore activées.'},
        ...(brand.emoji ? [{key:'emoji_credits',label:'ILLUSTRATIONS',value:'Noto Emoji (Google, Apache 2.0) ; Twemoji (Twitter, CC BY 4.0) — github.com/jdecked/twemoji'}] : []),
      ],
    } : {
      headerFields: [{ key: 'program', label: 'PROGRAMME', value: txt(program.name, 22) || 'Fidélité' }],
      primaryFields: [{ key: 'progress', label: brand.label, value: modePoints ? b + ' / ' + goal + ' pts' : b + ' / ' + goal }],
      secondaryFields: [
        { key: 'client', label: 'CLIENT', value: client },
        { key: 'reward', label: 'RÉCOMPENSE', value: txt(program.reward, 60) || 'Récompense fidélité' },
      ],
      auxiliaryFields: [{ key: 'card', label: 'CARTE', value: txt(card.card_number, 42) }],
      backFields: [
        ...(brand.subtitle ? [{ key: 'subtitle', label: 'LE COMMERCE', value: brand.subtitle }] : []),
        { key: 'rule', label: 'COMMENT ÇA MARCHE ?', value: modePoints ? goal + ' points pour ' + txt(program.reward, 90) : goal + ' passages pour ' + txt(program.reward, 90) },
        { key: 'info', label: 'DPA Cards', value: 'Présentez votre QR code en caisse. Le solde reflète la date de création du pass ; les mises à jour automatiques ne sont pas encore activées.' },
      ],
    },
    barcode, barcodes: [barcode],
  }};
}
