// "Commerciaux / Suivi des ventes" (director account only). Every figure comes from the wallet
// Edge Function (admin-sales*), which checks the director role on the server; this file only
// displays it. "Marquer comme payé" records a transfer already made: it never moves money.
// Built on the page's React (window.React, the instance dc-runtime renders with).

const C = { ink: '#1C1F24', muted: '#5E636B', line: '#E4E1DA', soft: '#F6F5F1', chip: '#ECEAE4', blue: '#2448F0', blueBg: '#E8EDFF', blueInk: '#1A36C4',
  green: '#1F6B45', greenBg: '#E4F3EB', amber: '#6B4E00', amberBg: '#FFF3DC', red: '#A11D14', redBg: '#FCEBEA', grey: '#3E424A', greyBg: '#EFEDE8' };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const eur = c => ((+c || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const nf = n => (+n || 0).toLocaleString('fr-FR');
const day = iso => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); };
const monthLabel = ym => { if (!ym) return 'Depuis le début'; const [y, m] = ym.split('-'); return MONTHS[+m - 1].replace(/^./, c => c.toUpperCase()) + ' ' + y; };
const ymOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

const COMM = { to_validate: ['À valider', C.amberBg, C.amber], to_pay: ['À payer', C.blueBg, C.blueInk], paid: ['Payé', C.greenBg, C.green], cancelled: ['Annulé', C.greyBg, C.grey] };
const PAY = { paid: ['Payé', C.greenBg, C.green], failed: ['Échoué', C.redBg, C.red], refunded: ['Remboursé', C.redBg, C.red], partially_refunded: ['Remboursé en partie', C.amberBg, C.amber], pending: ['En attente', C.greyBg, C.grey] };
const SUB = { active: ['Actif', C.greenBg, C.green], trialing: ['Essai', C.blueBg, C.blueInk], canceled: ['Résilié', C.redBg, C.red], past_due: ['Paiement en retard', C.amberBg, C.amber],
  unpaid: ['Impayé', C.redBg, C.red], incomplete: ['Non finalisé', C.amberBg, C.amber], incomplete_expired: ['Expiré', C.greyBg, C.grey], paused: ['Suspendu', C.redBg, C.red], expired: ['Offre terminée', C.greyBg, C.grey], prepaid: ['Payé en une fois', C.greenBg, C.green], none: ['Sans abonnement', C.greyBg, C.grey] };
const PAYKIND = { setup: 'Mise en place', subscription: 'Mensualité', prepaid: 'Engagement payé en une fois', design: 'Design', other: 'Autre' };
// A commitment paid in one go shows as such (never as a monthly subscription), until its period ends.
const subKey = m => (m.billing_mode === 'prepaid' && m.subscription_status === 'active' ? (m.period_end && new Date(m.period_end) <= new Date() ? 'expired' : 'prepaid')
  : m.subscription_status === 'canceled' || m.cancel_at_period_end ? 'canceled' : m.subscription_status || 'none');
const periodText = p => (p.period_start && p.period_end ? 'Période couverte : ' + day(p.period_start) + ' → ' + day(p.period_end) : '');
const commKind = c => (c.reverses_id ? 'Régularisation' : c.kind === 'initial' ? (PAYKIND[c.payment?.kind || c.rule?.payment_kind] || 'Hors mensualités') : 'Récurrente');
const PLAN = { no_commitment: 'Sans engagement', commitment: 'Engagement 12 mois' };
function ruleText(r, repName) {
  const v = r.calc === 'fixed' ? eur(r.amount_cents) : String(r.percent).replace('.', ',') + ' %';
  const parts = [r.kind === 'initial' ? 'Commission hors mensualités' : 'Commission récurrente', v + (r.calc === 'percent' ? ' du montant encaissé' : ' par paiement'),
    r.sales_rep_id ? repName(r.sales_rep_id) : 'tous les commerciaux', r.plan_type ? PLAN[r.plan_type] : 'toutes les offres'];
  if (r.kind === 'recurring') parts.push(r.duration_months ? `pendant ${r.duration_months} mois` : 'sans limite de durée');
  return parts.join(' · ');
}
const ERRORS = { duplicate_reference: 'Cette référence de virement est déjà enregistrée.', reference_required: 'Indiquez la référence du virement.', idempotency_conflict: 'Cette demande a déjà été utilisée avec des informations différentes.', mixed_payment_modes: 'Ne mélangez pas TEST et LIVE dans un versement.', not_director: 'Action réservée au compte de direction.', selection_changed: 'Les commissions ont changé depuis l’affichage : actualisez puis recommencez.',
  total_changed: 'Le total a changé depuis l’affichage : actualisez puis recommencez.', nothing_to_pay: 'Aucune commission à payer.', invalid_paid_on: 'Date de versement invalide.',
  invalid_rule: 'Règle incomplète ou invalide.', reason_required: 'Indiquez un motif.', not_cancellable: 'Cette commission ne peut plus être annulée.',
  not_authenticated: 'Session expirée. Reconnectez-vous.' };
const errText = e => ERRORS[e && (e.code || e.message)] || 'Action impossible pour le moment. Réessayez.';
const AUDIT = { attribution_auto: 'Attribution automatique', attribution_manual: 'Attribution modifiée', rule_created: 'Règle créée', rule_disabled: 'Règle désactivée',
  commissions_validated: 'Commissions validées', commission_cancelled: 'Commission annulée', payout_recorded: 'Versement enregistré' };

export function makeSales(React, api) {
  const { useState, useEffect, useMemo, useRef } = React;
  const h = React.createElement;
  const icon = (name, size, extra) => h('span', { className: 'material-symbols-rounded', 'aria-hidden': true, style: { fontSize: size || 20, lineHeight: 1, ...extra } }, name);
  const card = (extra, ...kids) => h('section', { style: { background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, ...extra } }, ...kids);
  const badge = ([label, bg, fg]) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: bg, color: fg, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' } },
    h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: fg } }), label);
  const btn = (label, onClick, { kind = 'secondary', disabled, ico, small } = {}) => h('button', { type: 'button', onClick, disabled,
    style: { minHeight: small ? 38 : 46, padding: small ? '0 12px' : '0 16px', borderRadius: 12, fontWeight: 700, fontSize: small ? 14 : 15, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1,
      border: kind === 'secondary' ? '1.5px solid #D4D1C9' : 0, background: kind === 'primary' ? C.blue : kind === 'success' ? '#1F7A4F' : kind === 'danger' ? '#FFFFFF' : '#FFFFFF',
      color: kind === 'primary' || kind === 'success' ? '#FFFFFF' : kind === 'danger' ? C.red : C.ink, ...(kind === 'danger' ? { border: `1.5px solid ${C.red}` } : {}) } },
    ico ? icon(ico, 18) : null, label);
  const field = (label, control, hint) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600, minWidth: 0 } }, label, control,
    hint ? h('span', { style: { fontWeight: 400, color: C.muted, fontSize: 13 } }, hint) : null);
  const inputStyle = { height: 46, padding: '0 12px', border: '1.5px solid #D4D1C9', borderRadius: 12, background: '#FFFFFF', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const select = (value, onChange, options, label) => h('select', { value, onChange: e => onChange(e.target.value), 'aria-label': label, style: { ...inputStyle, fontWeight: 600 } },
    options.map(([v, l]) => h('option', { key: v, value: v }, l)));
  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, background: '#F8F7F4', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' };
  const td = { padding: '11px 12px', borderBottom: '1px solid #EFEDE8', fontSize: 14, verticalAlign: 'middle' };
  const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const table = (head, rows, empty) => h('div', { style: { overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 14 } },
    h('table', { style: { width: '100%', borderCollapse: 'collapse', background: '#FFFFFF' } },
      h('thead', null, h('tr', null, head.map((x, i) => h('th', { key: i, style: { ...th, ...(x.num ? { textAlign: 'right' } : {}) } }, x.label || x)))),
      h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colSpan: head.length, style: { ...td, textAlign: 'center', color: C.muted, padding: 24 } }, empty)))));

  function Modal({ title, onClose, children, width = 520 }) {
    useEffect(() => { const k = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
    return h('div', { onClick: onClose, style: { position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(20,22,28,0.45)', display: 'grid', placeItems: 'center', padding: 16 } },
      h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': title, onClick: e => e.stopPropagation(), style: { width: '100%', maxWidth: width, maxHeight: '90vh', overflow: 'auto', background: '#FFFFFF', borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 60px rgba(20,22,28,0.3)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 } },
          h('h2', { style: { margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em' } }, title),
          h('button', { type: 'button', onClick: onClose, 'aria-label': 'Fermer', style: { width: 40, height: 40, border: 0, borderRadius: 12, background: C.chip, display: 'grid', placeItems: 'center' } }, icon('close'))),
        children));
  }

  function csv(name, head, lines) {
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const url = URL.createObjectURL(new Blob(['﻿' + [head.map(esc).join(';'), ...lines.map(l => l.map(esc).join(';'))].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const cents = c => ((+c || 0) / 100).toFixed(2).replace('.', ',');

  // ------------------------------------------------------------------------------------------------
  function SalesDashboard({ width, toast, onOpenMerchant }) {
    const isDesk = (width || 1200) >= 1024;
    const [period, setPeriod] = useState(ymOf(new Date()));
    const [mode, setMode] = useState('live');
    const [rep, setRep] = useState('all');
    const [subSt, setSubSt] = useState('all');
    const [commSt, setCommSt] = useState('all');
    const [view, setView] = useState('overview');
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [modal, setModal] = useState(null);
    const seq = useRef(0);

    const load = async () => {
      const n = ++seq.current; setError(null);
      try { const d = await api.sales({ ...(period === 'all' ? {} : { from: period, to: period }), mode }); if (n === seq.current) setData(d); }
      catch (e) { if (n === seq.current) setError(errText(e)); }
    };
    useEffect(() => { setData(null); load(); }, [period, mode]);
    const act = async (fn, okMsg) => { if (busy) return false; setBusy(true);
      try { await fn(); if (okMsg) toast(okMsg); setModal(null); await load(); return true; } catch (e) { toast(errText(e)); return false; } finally { setBusy(false); } };

    const periods = useMemo(() => { const out = [['all', 'Depuis le début']]; const d = new Date(); d.setDate(1);
      for (let i = 0; i < 18; i++) { out.push([ymOf(d), monthLabel(ymOf(d))]); d.setMonth(d.getMonth() - 1); } return out; }, []);
    const reps = data ? data.reps : [];
    const repName = id => (reps.find(r => r.id === id) || {}).name || '—';
    const shownReps = rep === 'all' ? reps : rep === 'none' ? [] : reps.filter(r => r.id === rep);
    const rules = data ? data.rules : [];
    const inForce = data ? data.rules_in_force : { initial: false, recurring: false };

    const header = h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
      h('div', null,
        h('h1', { style: { margin: 0, fontWeight: 800, fontSize: 'clamp(28px,5vw,38px)', letterSpacing: '-0.03em', lineHeight: 1.05 } }, 'Commerciaux'),
        h('div', { style: { marginTop: 6, color: C.muted, fontSize: 15 } }, 'Suivi des ventes, des encaissements et des commissions de Kilyan, Zak et Maël.')),
      btn('Actualiser', () => { setData(null); load(); }, { ico: 'refresh' }));

    const scopeTabs = h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      [['all','Global'], ...reps.map(r => [r.id,r.name === 'Kilyan' ? 'Mes ventes' : r.name])].map(([id,label]) => React.cloneElement(btn(label, () => setRep(id), { kind: rep === id ? 'primary' : 'secondary' }), { key: id })),
      field('Environnement', select(mode,setMode,[['live','LIVE — ventes réelles'],['test','TEST — simulation uniquement']], 'Environnement')));
    const filters = h('div', { style: { display: 'grid', gridTemplateColumns: isDesk ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: 10 } },
      field('Période', select(period, setPeriod, periods, 'Période')),
      field('Commercial', select(rep, setRep, [['all', 'Global'], ...reps.map(r => [r.id, r.name === 'Kilyan' ? 'Mes ventes' : r.name]), ['none', 'Anomalies historiques']], 'Commercial')),
      field('Abonnement', select(subSt, setSubSt, [['all', 'Tous'], ['active', 'Actif'], ['trialing', 'Essai'], ['prepaid', 'Payé en une fois'], ['expired', 'Offre terminée'], ['canceled', 'Résilié'], ['past_due', 'Paiement en retard'], ['none', 'Sans abonnement']], 'Statut d’abonnement')),
      field('Commission', select(commSt, setCommSt, [['all', 'Toutes'], ['to_validate', 'À valider'], ['to_pay', 'À payer'], ['paid', 'Payées'], ['cancelled', 'Annulées']], 'Statut de commission')));

    const VIEWS = [['overview', 'Vue d’ensemble', 'monitoring'], ['statement', 'Relevé et versements', 'receipt_long'], ['merchants', 'Commerçants', 'storefront'],
      ['payments', 'Paiements', 'credit_card'], ['rules', 'Règles de commission', 'tune'], ['history', 'Historique', 'history']];
    const tabs = h('nav', { role: 'tablist', 'aria-label': 'Suivi des ventes', style: { display: 'flex', gap: 6, padding: 4, borderRadius: 14, background: C.chip, alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' } },
      VIEWS.map(([k, label, ic]) => h('button', { key: k, type: 'button', role: 'tab', 'aria-selected': view === k, onClick: () => setView(k),
        style: { minHeight: 40, padding: '0 14px', border: 0, borderRadius: 11, background: view === k ? '#FFFFFF' : 'transparent', fontWeight: view === k ? 700 : 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', boxShadow: view === k ? '0 1px 4px rgba(20,22,28,0.12)' : 'none' } },
        icon(ic, 18), label)));

    const notConfigured = data && (!inForce.initial || !inForce.recurring)
      ? h('div', { role: 'status', style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 14, background: C.amberBg, color: C.amber, fontSize: 15, lineHeight: 1.45 } },
        icon('info', 22),
        h('div', null, h('strong', null, !inForce.initial && !inForce.recurring ? 'Commissions non configurées. ' : !inForce.initial ? 'Commission hors mensualités non configurée. ' : 'Commission récurrente non configurée. '),
          'Aucun montant n’est calculé ni payable tant qu’une règle n’est pas définie. ',
          h('button', { type: 'button', onClick: () => setView('rules'), style: { border: 0, background: 'transparent', color: C.blueInk, fontWeight: 700, padding: 0, textDecoration: 'underline' } }, 'Définir les règles')))
      : null;

    let body;
    if (error) body = h('div', { role: 'alert', style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 14, background: C.redBg, color: '#7A1A13', fontSize: 15, fontWeight: 600 } }, icon('error', 22), error);
    else if (!data) body = h('div', { role: 'status', style: { padding: 40, textAlign: 'center', color: C.muted } }, 'Chargement du suivi des ventes…');
    else body = { overview: Overview, statement: Statement, merchants: Merchants, payments: Payments, rules: Rules, history: History }[view]();

    // ---------------------------------------------------------------- overview
    function Overview() {
      const metric = (label, value, strong) => h('div', { style: { background: C.soft, borderRadius: 12, padding: '10px 12px', minWidth: 0 } },
        h('div', { style: { fontSize: 12.5, color: C.muted, lineHeight: 1.25 } }, label),
        h('div', { style: { fontWeight: 800, fontSize: strong ? 20 : 18, marginTop: 3, fontVariantNumeric: 'tabular-nums', color: strong || C.ink } }, value));
      const repCard = r => card({ gap: 14 },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('div', { style: { width: 44, height: 44, borderRadius: 12, background: C.ink, color: '#FFFFFF', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17 } }, r.name.slice(0, 1)),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 800, fontSize: 19 } }, r.name), h('div', { style: { fontSize: 13, color: C.muted, overflowWrap: 'anywhere' } }, r.email)),
          h('div', { style: { textAlign: 'right' } }, h('div', { style: { fontSize: 12, color: C.muted } }, 'Solde cumulé (reports compris)'), h('div', { style: { fontWeight: 800, fontSize: 22, color: (r.comm_to_validate_cents + r.comm_to_pay_cents) ? C.blueInk : C.ink, fontVariantNumeric: 'tabular-nums' } }, eur(r.balance_cents)))),
        h('div', { style: { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted } }, 'Activité commerciale'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 } },
          metric('Comptes créés', nf(r.merchants)), metric('Cartes créées', nf(r.cards)), metric('Ventes payées', nf(r.sales_paid)),
          metric('Abonnements actifs', nf(r.active)), metric('En essai', nf(r.trialing)), metric('Résiliés', nf(r.canceled)),
          ...(r.prepaid_active || r.prepaid_sales ? [metric('Payés en une fois (en cours)', nf(r.prepaid_active))] : [])),
        (r.payments_failed || r.refunds || r.past_due) ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          r.past_due ? badge([`${r.past_due} en retard de paiement`, C.amberBg, C.amber]) : null,
          r.payments_failed ? badge([`${r.payments_failed} paiement${r.payments_failed > 1 ? 's' : ''} échoué${r.payments_failed > 1 ? 's' : ''}`, C.redBg, C.red]) : null,
          r.refunds ? badge([`${r.refunds} remboursement${r.refunds > 1 ? 's' : ''}`, C.redBg, C.red]) : null) : null,
        h('div', { style: { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted } }, 'Chiffre d’affaires encaissé'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } }, metric('Initial (mise en place)', eur(r.revenue_initial_cents)), metric('Mensuel (abonnements)', eur(r.revenue_monthly_cents)),
          metric('Engagement payé en une fois', eur(r.revenue_prepaid_cents)), metric('Création de carte', eur(r.revenue_design_cents)), metric('Autres prestations', eur(r.revenue_other_cents)), metric('CA total', eur(r.revenue_total_cents))),
        h('div', { style: { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted } }, 'Commissions'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } },
          metric('Hors mensualités acquis', eur(r.comm_initial_cents)), metric('Récurrentes dues', eur(r.comm_recurring_cents)),
          metric('Déjà versées', eur(r.comm_paid_cents), '#1F6B45'), metric('Restant sur la période', eur(r.comm_to_validate_cents + r.comm_to_pay_cents), C.blueInk)));
      const cols = [{ label: 'Commercial' }, { label: 'Comptes', num: 1 }, { label: 'Cartes', num: 1 }, { label: 'Ventes payées', num: 1 }, { label: 'Actifs', num: 1 }, { label: 'Essai', num: 1 }, { label: 'Résiliés', num: 1 },
        { label: 'CA initial', num: 1 }, { label: 'CA mensuel', num: 1 }, { label: 'CA payé en une fois', num: 1 }, { label: 'CA création', num: 1 }, { label: 'CA autres', num: 1 }, { label: 'CA total', num: 1 }, { label: 'Comm. dues', num: 1 }, { label: 'Versées', num: 1 }, { label: 'Reste', num: 1 }];
      const totals = k => shownReps.reduce((s, r) => s + (+r[k] || 0), 0);
      const rowOf = (r, bold) => h('tr', { key: r.id || 'total', style: bold ? { fontWeight: 800, background: '#F8F7F4' } : null },
        h('td', { style: { ...td, fontWeight: 700 } }, r.name), ...['merchants', 'cards', 'sales_paid', 'active', 'trialing', 'canceled'].map(k => h('td', { key: k, style: { ...td, ...num } }, nf(r[k]))),
        ...['revenue_initial_cents', 'revenue_monthly_cents', 'revenue_prepaid_cents', 'revenue_design_cents', 'revenue_other_cents', 'revenue_total_cents'].map(k => h('td', { key: k, style: { ...td, ...num } }, eur(r[k]))),
        h('td', { style: { ...td, ...num } }, eur(r.comm_initial_cents + r.comm_recurring_cents)), h('td', { style: { ...td, ...num, color: C.green } }, eur(r.comm_paid_cents)),
        h('td', { style: { ...td, ...num, color: C.blueInk, fontWeight: 700 } }, eur(r.comm_to_validate_cents + r.comm_to_pay_cents)));
      const sum = { name: 'Total' }; ['merchants', 'cards', 'sales_paid', 'active', 'trialing', 'canceled', 'revenue_initial_cents', 'revenue_monthly_cents', 'revenue_prepaid_cents', 'revenue_design_cents', 'revenue_other_cents', 'revenue_total_cents', 'comm_initial_cents', 'comm_recurring_cents', 'comm_paid_cents', 'comm_to_validate_cents', 'comm_to_pay_cents'].forEach(k => { sum[k] = totals(k); });
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
        metric(rep === 'all' ? 'CA global · Kilyan + Zak + Maël' : 'CA total de la sélection', eur(totals('revenue_total_cents'))),
        data.anomalies && (data.anomalies.unattributed_merchants || data.anomalies.unknown_mode_payments || data.anomalies.unattributed_revenue_cents) ? h('div', { role: 'status', style: { padding: 14, borderRadius: 12, background: C.amberBg } }, `${data.anomalies.unattributed_merchants} commerce(s) historique(s) à attribuer · ${eur(data.anomalies.unattributed_revenue_cents)} non attribués · ${data.anomalies.unknown_mode_payments} paiement(s) à vérifier (TEST/LIVE). Hors total global.`) : null,
        isDesk ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 800 } }, 'Tableau des performances · ' + monthLabel(period === 'all' ? null : period)),
          table(cols, [...shownReps.map(r => rowOf(r)), shownReps.length > 1 ? rowOf(sum, true) : null].filter(Boolean), 'Aucun commercial.')) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: isDesk ? 'repeat(3, minmax(0, 1fr))' : '1fr', gap: 14 } }, shownReps.map(r => h(React.Fragment, { key: r.id }, repCard(r)))),
        h('p', { style: { margin: 0, color: C.muted, fontSize: 13, lineHeight: 1.5 } },
          'Comptes, cartes, ventes, chiffre d’affaires et commissions : sur la période choisie. Actifs, essais et résiliés : situation actuelle des commerces apportés. ',
          'Les commissions sont de 70 % des encaissements des commerces de Zak et Maël, sans déduction des frais. Les 30 % restants ne sont pas un bénéfice net. Les remboursements corrigent le CA de la période du paiement initial. Le chiffre d’affaires et les commissions reposent uniquement sur les paiements réellement encaissés (remboursements déduits).'));
    }

    // ---------------------------------------------------------------- statement and payouts
    function Statement() {
      const month = period === 'all' ? null : period;
      const list = data.commissions.filter(c => (commSt === 'all' || c.status === commSt));
      const forRep = r => list.filter(c => c.sales_rep_id === r.id);
      const block = r => {
        const rows = forRep(r), all = data.commissions.filter(c => c.sales_rep_id === r.id);
        const sumOf = st => all.filter(c => c.status === st).reduce((s, c) => s + c.amount_cents, 0);
        const toValidate = all.filter(c => c.status === 'to_validate'), toPay = all.filter(c => c.status === 'to_pay');
        // The statement month and earlier months still to pay (carried over): settled together.
        const payable = month ? toPay.filter(c => c.period <= month + '-01') : [];
        const payTotal = payable.reduce((s, c) => s + c.amount_cents, 0);
        return card(null,
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
            h('div', null, h('h3', { style: { margin: 0, fontSize: 19, fontWeight: 800 } }, r.name), h('div', { style: { fontSize: 14, color: C.muted } }, monthLabel(month) + ' · ' + all.filter(c => c.status !== 'cancelled').length + ' commission(s)')),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              btn(`Valider${toValidate.length ? ' (' + toValidate.length + ')' : ''}`, () => act(() => api.validate(toValidate.map(c => c.id)), 'Commissions validées : elles passent « à payer ».'), { disabled: !toValidate.length || busy, ico: 'task_alt', small: true }),
              btn('Marquer comme payé', () => setModal({ type: 'payout', rep: r, ids: payable.map(c => c.id), total: payTotal, key: uuid(), month }), { kind: 'success', disabled: !payable.length || payTotal <= 0 || busy, ico: 'payments', small: true }))),
          h('div', { style: { display: 'grid', gridTemplateColumns: isDesk ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: 8 } },
            ...[['À valider', sumOf('to_validate'), C.amber], ['À payer', sumOf('to_pay'), C.blueInk], ['Payé', sumOf('paid'), C.green], ['Total', sumOf('to_validate') + sumOf('to_pay') + sumOf('paid'), C.ink]]
              .map(([l, v, col]) => h('div', { key: l, style: { background: C.soft, borderRadius: 12, padding: '10px 12px' } }, h('div', { style: { fontSize: 12.5, color: C.muted } }, l), h('div', { style: { fontWeight: 800, fontSize: 19, color: col, fontVariantNumeric: 'tabular-nums' } }, eur(v))))),
          !month ? h('div', { style: { fontSize: 14, color: C.muted } }, 'Choisissez un mois dans « Période » pour enregistrer un versement.') : null,
          month && payable.length && payTotal <= 0 ? h('div', { style: { fontSize: 14, color: C.amber } }, 'Le total à payer est négatif (régularisation) : il sera déduit du prochain versement.') : null,
          isDesk
            ? table(['Commerce', 'Type', 'Paiement', { label: 'Encaissé', num: 1 }, { label: 'Commission', num: 1 }, 'Statut', 'Règle', ''],
              rows.map(c => h('tr', { key: c.id },
                h('td', { style: td }, c.merchant_id ? h('button', { type: 'button', onClick: () => onOpenMerchant(c.merchant_id), style: { border: 0, background: 'transparent', padding: 0, color: C.blueInk, fontWeight: 700, textAlign: 'left' } }, c.merchant_name) : c.merchant_name),
                h('td', { style: td }, commKind(c), month && c.period !== month + '-01' ? h('div', { style: { fontSize: 12, color: C.amber, fontWeight: 700 } }, 'Report de ' + monthLabel(c.period.slice(0, 7)).toLowerCase()) : null, c.note ? h('div', { style: { fontSize: 12, color: C.muted } }, c.note) : null),
                h('td', { style: td }, h('div', null, c.payment ? (PAYKIND[c.payment.kind] || '') + ' · ' + day(c.payment.paid_at) : '—'), h('div', { style: { fontSize: 12, color: C.muted, fontFamily: "'IBM Plex Mono',monospace" } }, c.payment ? c.payment.ref : '')),
                h('td', { style: { ...td, ...num } }, eur(c.base_cents)), h('td', { style: { ...td, ...num, fontWeight: 700, color: c.amount_cents < 0 ? C.red : C.ink } }, eur(c.amount_cents)),
                h('td', { style: td }, badge(COMM[c.status]), c.paid_at ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: 4 } }, 'Versé le ' + day(c.paid_at)) : null, c.cancel_reason ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: 4 } }, c.cancel_reason) : null),
                h('td', { style: { ...td, fontSize: 12.5, color: C.muted, maxWidth: 220 } }, ruleText(c.rule, repName)),
                h('td', { style: td }, ['to_validate', 'to_pay'].includes(c.status) ? btn('Annuler', () => setModal({ type: 'cancel', c, reason: '' }), { small: true, kind: 'danger', disabled: busy }) : null))),
              'Aucune commission sur cette période.')
            : rows.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, rows.map(c => h('div', { key: c.id, style: { border: `1px solid ${C.line}`, borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' } },
                  h('button', { type: 'button', onClick: () => c.merchant_id && onOpenMerchant(c.merchant_id), style: { border: 0, background: 'transparent', padding: 0, fontWeight: 700, fontSize: 15, textAlign: 'left', color: C.ink } }, c.merchant_name),
                  h('div', { style: { fontWeight: 800, color: c.amount_cents < 0 ? C.red : C.ink } }, eur(c.amount_cents))),
                h('div', { style: { fontSize: 13, color: C.muted } }, commKind(c) + (month && c.period !== month + '-01' ? ' · report de ' + monthLabel(c.period.slice(0, 7)).toLowerCase() : '') + ' · ' + (c.payment ? (PAYKIND[c.payment.kind] || '') + ' encaissé ' + eur(c.base_cents) + ' le ' + day(c.payment.paid_at) : '')),
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } }, badge(COMM[c.status]),
                  ['to_validate', 'to_pay'].includes(c.status) ? btn('Annuler', () => setModal({ type: 'cancel', c, reason: '' }), { small: true, kind: 'danger', disabled: busy }) : null))))
              : h('div', { style: { color: C.muted, fontSize: 14 } }, 'Aucune commission sur cette période.'));
      };
      const exportCsv = () => {
        const rows = list.filter(c => rep === 'all' || c.sales_rep_id === rep);
        if (!rows.length) return toast('Aucune commission à exporter.');
        csv(`dpa-cards-commissions-${month || 'toutes-periodes'}.csv`,
          ['Mois', 'Commercial', 'Commerce', 'Type', 'Paiement', 'Référence paiement', 'Date d’encaissement', 'Montant encaissé (€)', 'Commission (€)', 'Statut', 'Règle', 'Date de versement', 'Motif d’annulation'],
          rows.map(c => [c.period.slice(0, 7), repName(c.sales_rep_id), c.merchant_name, commKind(c), c.payment ? PAYKIND[c.payment.kind] : '', c.payment ? c.payment.ref : '', c.payment && c.payment.paid_at ? c.payment.paid_at.slice(0, 10) : '',
            cents(c.base_cents), cents(c.amount_cents), COMM[c.status][0], ruleText(c.rule, repName), c.paid_at || '', c.cancel_reason || '']));
      };
      const payouts = data.payouts.filter(p => rep === 'all' || p.sales_rep_id === rep);
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 800 } }, 'Relevé · ' + monthLabel(month)),
          btn('Exporter en CSV', exportCsv, { ico: 'download' })),
        h('p', { style: { margin: 0, fontSize: 14, color: C.muted, lineHeight: 1.5 } }, 'Validez les commissions, effectuez le virement depuis votre banque, puis enregistrez-le avec « Marquer comme payé ». Ce bouton ne déclenche aucun paiement.'),
        ...shownReps.map(block),
        h('h2', { style: { margin: '10px 0 0', fontSize: 20, fontWeight: 800 } }, 'Versements enregistrés'),
        table(['Date du versement', 'Commercial', 'Mois', { label: 'Montant', num: 1 }, 'Commissions', 'Référence', 'Enregistré par'],
          payouts.map(p => h('tr', { key: p.id }, h('td', { style: td }, day(p.paid_on)), h('td', { style: { ...td, fontWeight: 700 } }, repName(p.sales_rep_id)), h('td', { style: td }, monthLabel(p.period.slice(0, 7))),
            h('td', { style: { ...td, ...num, fontWeight: 700 } }, eur(p.amount_cents)), h('td', { style: td }, nf(p.commission_count)), h('td', { style: td }, p.reference || '—', p.note ? h('div', { style: { fontSize: 12, color: C.muted } }, p.note) : null),
            h('td', { style: { ...td, fontSize: 13, color: C.muted } }, p.created_by + ' · ' + day(p.created_at)))), 'Aucun versement enregistré.'));
    }

    // ---------------------------------------------------------------- merchants (attribution)
    function Merchants() {
      const list = data.merchants.filter(m => (rep === 'all' || (rep === 'none' ? !m.sales_rep_id : m.sales_rep_id === rep)) && (subSt === 'all' || subKey(m) === subSt));
      const unattributed = data.merchants.filter(m => !m.sales_rep_id).length;
      const edit = m => setModal({ type: 'attr', m, repId: m.sales_rep_id || '', reason: '' });
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        unattributed ? h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 14, background: C.blueBg, color: C.blueInk, fontSize: 14, fontWeight: 600 } }, icon('person_search', 20),
          `${unattributed} commerce${unattributed > 1 ? 's' : ''} sans commercial : attribuez-les manuellement (aucune attribution n’est devinée).`) : null,
        isDesk ? table(['Commerce', 'Commercial', 'Origine', 'Abonnement', 'Carte', { label: 'Encaissé', num: 1 }, { label: 'Commissions', num: 1 }, ''],
          list.map(m => h('tr', { key: m.id },
            h('td', { style: td }, h('button', { type: 'button', onClick: () => onOpenMerchant(m.id), style: { border: 0, background: 'transparent', padding: 0, color: C.blueInk, fontWeight: 700, textAlign: 'left' } }, m.business_name), h('div', { style: { fontSize: 12, color: C.muted } }, 'Créé le ' + day(m.created_at))),
            h('td', { style: { ...td, fontWeight: 700 } }, m.sales_rep || badge(['Non attribué', C.greyBg, C.grey])),
            h('td', { style: { ...td, fontSize: 13, color: C.muted } }, m.source === 'admin_creation' ? 'Créé depuis l’admin' : m.source === 'manual' ? 'Attribution manuelle' : '—', m.attributed_at ? h('div', null, day(m.attributed_at)) : null),
            h('td', { style: td }, badge(SUB[subKey(m)] || SUB.none)), h('td', { style: { ...td, fontSize: 13 } }, m.card_validated_at ? 'Créée le ' + day(m.card_validated_at) : '—'),
            h('td', { style: { ...td, ...num } }, eur(m.revenue_cents)), h('td', { style: { ...td, ...num } }, eur(m.commission_cents)),
            h('td', { style: td }, btn(m.sales_rep_id ? 'Modifier' : 'Attribuer', () => edit(m), { small: true, ico: 'person_add' })))), 'Aucun commerce pour ces filtres.')
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, list.length ? list.map(m => h('div', { key: m.id, style: { background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, h('button', { type: 'button', onClick: () => onOpenMerchant(m.id), style: { border: 0, background: 'transparent', padding: 0, fontWeight: 800, fontSize: 16, textAlign: 'left' } }, m.business_name), badge(SUB[subKey(m)] || SUB.none)),
            h('div', { style: { fontSize: 14 } }, 'Commercial : ', h('strong', null, m.sales_rep || 'non attribué')),
            h('div', { style: { fontSize: 13, color: C.muted } }, 'Encaissé ' + eur(m.revenue_cents) + ' · commissions ' + eur(m.commission_cents)),
            btn(m.sales_rep_id ? 'Modifier le commercial' : 'Attribuer un commercial', () => edit(m), { small: true, ico: 'person_add' }))) : h('div', { style: { color: C.muted } }, 'Aucun commerce pour ces filtres.')));
    }

    // ---------------------------------------------------------------- payments ledger
    function Payments() {
      const list = data.payments.filter(p => rep === 'all' || (rep === 'none' ? !p.sales_rep_id : p.sales_rep_id === rep));
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('p', { style: { margin: 0, color: C.muted, fontSize: 14, lineHeight: 1.5 } }, 'Paiements reçus de Stripe : mises en place, mensualités, engagements payés en une fois, échecs et remboursements. Un paiement reçu plusieurs fois par Stripe n’apparaît qu’une fois. Un paiement en une fois est compté une seule fois, à sa date, jamais comme des mensualités.'),
        table(['Date', 'Commerce', 'Commercial', 'Type', 'Statut', { label: 'Montant', num: 1 }, { label: 'Remboursé', num: 1 }, 'Référence'],
          list.map(p => h('tr', { key: p.id }, h('td', { style: td }, day(p.paid_at || p.failed_at)),
            h('td', { style: td }, p.merchant_id ? h('button', { type: 'button', onClick: () => onOpenMerchant(p.merchant_id), style: { border: 0, background: 'transparent', padding: 0, color: C.blueInk, fontWeight: 700, textAlign: 'left' } }, p.merchant_name) : p.merchant_name),
            h('td', { style: td }, p.sales_rep_id ? repName(p.sales_rep_id) : '—'), h('td', { style: td }, PAYKIND[p.kind] || p.kind,
              p.kind === 'prepaid' ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: 2 } }, periodText(p), p.prepaid ? h('div', null, eur(p.prepaid.setup_cents) + ' de mise en place + ' + p.prepaid.months + ' × ' + eur(p.prepaid.monthly_cents)) : null) : null,

              p.prepaid && p.prepaid.conflict ? h('div', { style: { marginTop: 4 } }, badge(['Offre déjà en cours : à rembourser', C.redBg, C.red])) : null,
              p.prepaid && p.prepaid.dispute_status ? h('div', { style: { marginTop: 4 } }, badge(['Litige ' + ({ open: 'en cours', won: 'gagné', lost: 'perdu' }[p.prepaid.dispute_status]), C.amberBg, C.amber])) : null),
            h('td', { style: td }, badge(PAY[p.status] || PAY.pending)),
            h('td', { style: { ...td, ...num, fontWeight: 700 } }, eur(p.amount_cents)), h('td', { style: { ...td, ...num, color: p.refunded_cents ? C.red : C.muted } }, p.refunded_cents ? eur(p.refunded_cents) : '—'),
            h('td', { style: { ...td, fontSize: 12, color: C.muted, fontFamily: "'IBM Plex Mono',monospace" } }, p.ref))), 'Aucun paiement sur cette période.'));
    }

    // ---------------------------------------------------------------- rules
    function Rules() {
      return h(RulesView, { rules, reps, repName, busy, onCreate: r => act(() => api.rule(r), 'Règle enregistrée. Les commissions concernées sont calculées « à valider ».'),
        onDisable: r => setModal({ type: 'disable', r }) });
    }

    // ---------------------------------------------------------------- history
    function History() {
      const detail = l => { const d = l.details || {};
        if (l.action === 'attribution_manual') return `${d.from ? repName(d.from) : 'Aucun'} → ${d.to ? repName(d.to) : 'aucun'}${d.reason ? ' · « ' + d.reason + ' »' : ''}`;
        if (l.action === 'attribution_auto') return repName(d.sales_rep_id);
        if (l.action === 'payout_recorded') return `${repName(d.sales_rep_id)} · ${monthLabel(String(d.period).slice(0, 7))} · ${eur(d.amount_cents)} (${d.count})`;
        if (l.action === 'commissions_validated') return `${d.count} commission(s)`;
        if (l.action === 'commission_cancelled') return `${eur(d.amount_cents)} · « ${d.reason} »`;
        if (l.action === 'rule_created') return ruleText(d, repName);
        return ''; };
      return table(['Date', 'Action', 'Commerce', 'Détail', 'Par'], data.audit.map((l, i) => h('tr', { key: i },
        h('td', { style: { ...td, whiteSpace: 'nowrap' } }, new Date(l.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })), h('td', { style: { ...td, fontWeight: 700 } }, AUDIT[l.action] || l.action),
        h('td', { style: td }, l.merchant_name || '—'), h('td', { style: { ...td, fontSize: 13 } }, detail(l)), h('td', { style: { ...td, fontSize: 13, color: C.muted } }, l.actor))), 'Aucune action enregistrée pour le moment.');
    }

    // ---------------------------------------------------------------- modals
    let modalEl = null;
    if (modal && modal.type === 'payout') modalEl = h(PayoutModal, { modal, busy, repName, onClose: () => setModal(null),
      onConfirm: f => act(() => api.payout({ sales_rep_id: modal.rep.id, period: modal.month, ids: modal.ids, expected_total_cents: modal.total, idempotency_key: modal.key, ...f }), 'Versement enregistré.') });
    if (modal && modal.type === 'cancel') modalEl = h(Modal, { title: 'Annuler la commission', onClose: () => setModal(null) },
      h('p', { style: { margin: 0, color: C.muted, lineHeight: 1.5 } }, `${modal.c.merchant_name} · ${commKind(modal.c)} · ${eur(modal.c.amount_cents)}. Une commission annulée n’est jamais recalculée automatiquement.`),
      field('Motif', h('input', { value: modal.reason, maxLength: 300, onChange: e => setModal({ ...modal, reason: e.target.value }), style: inputStyle })),
      h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' } }, btn('Retour', () => setModal(null)),
        btn('Annuler la commission', () => act(() => api.cancel(modal.c.id, modal.reason.trim()), 'Commission annulée.'), { kind: 'danger', disabled: busy || !modal.reason.trim() })));
    if (modal && modal.type === 'disable') modalEl = h(Modal, { title: 'Désactiver la règle', onClose: () => setModal(null) },
      h('p', { style: { margin: 0, lineHeight: 1.5 } }, ruleText(modal.r, repName)),
      h('p', { style: { margin: 0, color: C.muted, lineHeight: 1.5 } }, 'Les paiements encaissés à partir de maintenant ne seront plus calculés avec cette règle. Les commissions déjà calculées ne changent pas.'),
      h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' } }, btn('Retour', () => setModal(null)),
        btn('Désactiver', () => act(() => api.rule({ disable: modal.r.id }), 'Règle désactivée.'), { kind: 'danger', disabled: busy })));
    if (modal && modal.type === 'attr') modalEl = h(AttributionModal, { modal, reps, busy, onClose: () => setModal(null),
      onSave: (repId, reason) => act(() => api.attribute(modal.m.id, repId || null, reason), 'Attribution enregistrée.') });

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, header, scopeTabs, filters, tabs, notConfigured, body, modalEl);
  }

  // ------------------------------------------------------------------------------------------------
  function PayoutModal({ modal, busy, repName, onClose, onConfirm }) {
    const [paidOn, setPaidOn] = useState(todayIso());
    const [reference, setReference] = useState('');
    const [note, setNote] = useState('');
    const [sure, setSure] = useState(false);
    return h(Modal, { title: 'Marquer comme payé', onClose },
      h('div', { style: { background: C.soft, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { color: C.muted, fontSize: 14 } }, `${modal.rep.name} · ${monthLabel(modal.month)} · ${modal.ids.length} commission(s) à payer`),
        h('div', { style: { fontWeight: 800, fontSize: 28, fontVariantNumeric: 'tabular-nums' } }, eur(modal.total))),
      h('p', { style: { margin: 0, color: C.muted, fontSize: 14, lineHeight: 1.5 } }, 'Enregistre un virement que vous avez déjà effectué. Aucun paiement n’est déclenché par DPA Cards.'),
      field('Date du virement', h('input', { type: 'date', value: paidOn, max: todayIso(), onChange: e => setPaidOn(e.target.value), style: inputStyle })),
      field('Référence du virement', h('input', { value: reference, maxLength: 120, placeholder: 'Ex. : VIR-2026-11-ZAK', onChange: e => setReference(e.target.value), style: inputStyle })),
      field('Note (facultatif)', h('input', { value: note, maxLength: 500, onChange: e => setNote(e.target.value), style: inputStyle })),
      h('label', { style: { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, lineHeight: 1.4 } },
        h('input', { type: 'checkbox', checked: sure, onChange: e => setSure(e.target.checked), style: { width: 20, height: 20, marginTop: 1 } }),
        `Je confirme avoir versé ${eur(modal.total)} à ${modal.rep.name}.`),
      h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' } }, btn('Annuler', onClose),
        btn('Enregistrer le versement', () => onConfirm({ paid_on: paidOn, reference, note }), { kind: 'success', disabled: busy || !sure || !paidOn || !reference.trim() })));
  }

  function AttributionModal({ modal, reps, busy, onClose, onSave }) {
    const [repId, setRepId] = useState(modal.repId);
    const [reason, setReason] = useState('');
    const changed = repId !== (modal.m.sales_rep_id || '');
    return h(Modal, { title: 'Commercial responsable', onClose },
      h('p', { style: { margin: 0, color: C.muted, lineHeight: 1.5 } }, h('strong', { style: { color: C.ink } }, modal.m.business_name),
        '. Seuls les futurs encaissements suivent le nouveau commercial. Les anciens revenus, commissions et versements gardent leur bénéficiaire. Le commerçant reste propriétaire de son compte et de sa carte.'),
      field('Commercial', select(repId, setRepId, [['', 'Choisir un commercial'], ...reps.filter(r => r.active || r.id === repId).map(r => [r.id, r.name])], 'Commercial')),
      field('Motif', h('input', { value: reason, maxLength: 300, placeholder: 'Ex. : commerce apporté par Zak avant la mise en place du suivi', onChange: e => setReason(e.target.value), style: inputStyle }), 'Conservé dans l’historique.'),
      h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' } }, btn('Annuler', onClose),
        btn('Enregistrer', () => onSave(repId, reason.trim()), { kind: 'primary', disabled: busy || !changed || !reason.trim() || !repId })));
  }

  function RulesView({ rules, reps, repName, busy, onCreate, onDisable }) {
    const blank = { kind: 'initial', calc: 'fixed', value: '', sales_rep_id: '', plan_type: '', duration_months: '', valid_from: todayIso() };
    const [f, setF] = useState(blank);
    const up = k => v => setF(x => ({ ...x, [k]: v }));
    const value = Number(String(f.value).replace(',', '.'));
    const valid = Number.isFinite(value) && value > 0 && (f.calc !== 'percent' || value <= 100) && (f.kind !== 'recurring' || f.duration_months === '' || (+f.duration_months >= 1 && +f.duration_months <= 120)) && !!f.valid_from;
    const active = rules.filter(r => !r.disabled_at), old = rules.filter(r => r.disabled_at);
    const ruleRow = r => h('div', { key: r.id, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #EFEDE8', flexWrap: 'wrap' } },
      h('div', { style: { flex: '1 1 260px', minWidth: 0 } }, h('div', { style: { fontWeight: 700, fontSize: 15, lineHeight: 1.4 } }, ruleText(r, repName)),
        h('div', { style: { fontSize: 13, color: C.muted } }, `Paiements encaissés à partir du ${day(r.valid_from)}` + (r.disabled_at ? ` · désactivée le ${day(r.disabled_at)}` : '') + ` · créée par ${r.created_by}`)),
      r.disabled_at ? badge(['Désactivée', C.greyBg, C.grey]) : h(React.Fragment, null, badge(['En vigueur', C.greenBg, C.green]), btn('Désactiver', () => onDisable(r), { small: true, kind: 'danger', disabled: busy })));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      card(null, h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 800 } }, 'Règles en vigueur'),
        h('p', { style: { margin: 0, color: C.muted, fontSize: 14, lineHeight: 1.5 } }, 'La règle la plus précise s’applique : commercial et offre, puis commercial, puis offre, puis tous. Une règle n’est jamais modifiée : pour changer un taux, désactivez-la et créez-en une nouvelle. Chaque commission conserve la règle utilisée.'),
        active.length ? active.map(ruleRow) : h('div', { style: { color: C.muted, fontSize: 15 } }, 'Aucune règle : aucune commission n’est calculée.')),
      card(null, h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 800 } }, 'Nouvelle règle'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 } },
          field('Commission', select(f.kind, up('kind'), [['initial', 'Hors mensualités (chaque paiement)'], ['recurring', 'Récurrente (mensualités)']], 'Type de commission')),
          field('Calcul', select(f.calc, up('calc'), [['fixed', 'Montant fixe (€)'], ['percent', 'Pourcentage (%)']], 'Calcul')),
          field(f.calc === 'fixed' ? 'Montant par paiement (€)' : 'Pourcentage du montant encaissé', h('input', { inputMode: 'decimal', value: f.value, placeholder: f.calc === 'fixed' ? 'Ex. : 20' : 'Ex. : 10', onChange: e => up('value')(e.target.value), style: inputStyle })),
          field('Commercial', select(f.sales_rep_id, up('sales_rep_id'), [['', 'Tous les commerciaux'], ...reps.map(r => [r.id, r.name])], 'Commercial')),
          field('Offre', select(f.plan_type, up('plan_type'), [['', 'Toutes les offres'], ['no_commitment', 'Sans engagement'], ['commitment', 'Engagement 12 mois']], 'Offre')),
          f.kind === 'recurring' ? field('Durée (mois)', h('input', { inputMode: 'numeric', value: f.duration_months, placeholder: 'Vide = sans limite', onChange: e => up('duration_months')(e.target.value.replace(/\D/g, '')), style: inputStyle }), 'Comptée depuis la première mensualité encaissée.') : null,
          field('Date d’effet', h('input', { type: 'date', value: f.valid_from, onChange: e => up('valid_from')(e.target.value), style: inputStyle }), 'S’applique aux paiements encaissés à partir de cette date.')),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          btn('Enregistrer la règle', async () => { const ok = await onCreate({ kind: f.kind, calc: f.calc, value, sales_rep_id: f.sales_rep_id || null, plan_type: f.plan_type || null,
            duration_months: f.kind === 'recurring' && f.duration_months !== '' ? +f.duration_months : null, valid_from: f.valid_from }); if (ok) setF(blank); }, { kind: 'primary', disabled: busy || !valid, ico: 'add' }))),
      old.length ? card(null, h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 800 } }, 'Règles désactivées'), old.map(ruleRow)) : null);
  }

  // ------------------------------------------------------------------------------------------------
  // Director block of the merchant sheet: rep, change of rep, payments, commissions, history.
  function MerchantSales({ merchantId, businessName, sales, salesRep, onChanged, toast }) {
    const [modal, setModal] = useState(null);
    const [busy, setBusy] = useState(false);
    const reps = sales.reps || [];
    const repName = id => (reps.find(r => r.id === id) || {}).display_name || '—';
    const save = async (repId, reason) => { setBusy(true);
      try { await api.attribute(merchantId, repId || null, reason); toast('Attribution enregistrée.'); setModal(null); onChanged(); }
      catch (e) { toast(errText(e)); } finally { setBusy(false); } };
    const sub = { fontWeight: 700, fontSize: 16, margin: 0 };
    const line = (k, left, right, extra) => h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #EFEDE8' } },
      h('div', { style: { flex: 1, minWidth: 0, fontSize: 14 } }, left), extra, h('div', { style: { fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, right));
    const histText = l => { const d = l.details || {};
      if (l.action === 'attribution_auto') return 'Attribué automatiquement à ' + repName(d.sales_rep_id) + ' (création du commerce)';
      if (l.action === 'attribution_manual') return `Attribution : ${d.from ? repName(d.from) : 'aucun'} → ${d.to ? repName(d.to) : 'aucun'}${d.reason ? ' · « ' + d.reason + ' »' : ''}`;
      if (l.action === 'commission_cancelled') return 'Commission annulée · ' + eur(d.amount_cents) + (d.reason ? ' · « ' + d.reason + ' »' : '');
      return AUDIT[l.action] || l.action; };
    return h('section', { style: { background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 } }, h('h3', { style: sub }, 'Suivi commercial'),
        btn(salesRep ? 'Modifier' : 'Attribuer', () => setModal(true), { small: true, ico: 'person_add' })),
      h('div', { style: { fontSize: 15 } }, 'Commercial : ', h('strong', null, salesRep ? salesRep.name : 'non attribué'),
        salesRep ? h('span', { style: { color: C.muted, fontSize: 13 } }, ' · ' + (salesRep.source === 'admin_creation' ? 'créé depuis l’admin' : salesRep.source === 'direct_signup' ? 'inscription directe' : 'attribution manuelle') + ' le ' + day(salesRep.at)) : null),
      h('h4', { style: { ...sub, fontSize: 14, marginTop: 6 } }, 'Paiements'),
      sales.payments.length ? sales.payments.map((p, i) => line('p' + i, h('span', null, (p.livemode === false ? '[TEST] ' : p.livemode === null ? '[MODE À VÉRIFIER] ' : '') + (PAYKIND[p.kind] || p.kind) + ' · ' + day(p.paid_at || p.failed_at),
          p.kind === 'prepaid' ? h('div', { style: { fontSize: 12, color: C.muted } }, periodText(p)) : null), eur(Math.max(0,p.amount_cents-(p.refunded_cents || 0)-(p.disputed_cents || 0))), badge(PAY[p.status] || PAY.pending)))
        : h('div', { style: { fontSize: 14, color: C.muted } }, 'Aucun paiement encaissé.'),
      h('h4', { style: { ...sub, fontSize: 14, marginTop: 6 } }, 'Commissions'),
      sales.commissions.length ? sales.commissions.map(c => line(c.id, h('span', null, (c.livemode === false ? '[TEST] ' : c.livemode === null ? '[MODE À VÉRIFIER] ' : '') + commKind(c) + ' · ' + repName(c.sales_rep_id) + ' · ' + monthLabel(c.period.slice(0, 7))), eur(c.amount_cents), badge(COMM[c.status])))
        : h('div', { style: { fontSize: 14, color: C.muted } }, 'Aucune commission.'),
      h('h4', { style: { ...sub, fontSize: 14, marginTop: 6 } }, 'Historique'),
      sales.history.length ? sales.history.map((l, i) => line('h' + i, h('span', null, histText(l), h('div', { style: { fontSize: 12, color: C.muted } }, l.actor)), day(l.at)))
        : h('div', { style: { fontSize: 14, color: C.muted } }, 'Aucune modification.'),
      modal ? h(AttributionModal, { modal: { m: { business_name: businessName || 'Ce commerce', sales_rep_id: salesRep ? salesRep.id : null }, repId: salesRep ? salesRep.id : '' },
        reps: reps.map(r => ({ id: r.id, name: r.display_name, active: r.active })), busy, onClose: () => setModal(null), onSave: save }) : null);
  }

  return { SalesDashboard, MerchantSales };
}
