const number = new Intl.NumberFormat('fr-FR');
const dayLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const weekdays = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const palette = ['#3956db', '#7951d4', '#187d70', '#929bb2'];
const metricIcons = {
  monitoring: 'M3 3v18h18M7 15l4-5 4 2 5-6',
  calendar_month: 'M7 3v4m10-4v4M4 9h16M4 5h16v15H4zM8 13h2m4 0h2m-8 3h2m4 0h2',
  calendar_today: 'M7 3v4m10-4v4M4 9h16M4 5h16v15H4z',
  workspace_premium: 'M7 4h10v6a5 5 0 0 1-10 0zM7 6H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 2v5m-4 0h8',
  storefront: 'M4 10v10h16V10M3 10l2-6h14l2 6M3 10c0 4 6 4 6 0 0 4 6 4 6 0 0 4 6 4 6 0M10 20v-5h4v5',
  group: 'M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-4M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8 0a4 4 0 0 0 0-8',
  style: 'M5 4h15v13H5zM3 8v12h13',
  loyalty: 'M4 4h8l8 8-8 8-8-8zM8 8h.01',
  notifications: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zm5 3a2 2 0 0 0 4 0',
  account_balance_wallet: 'M20 8V5H4v14h16v-3M15 8h6v8h-6a4 4 0 0 1 0-8zm1 4h.01',
  phone_iphone: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm4 15h2',
  credit_card: 'M3 6h18v12H3zM3 10h18m-14 5h3',
  brush: 'M11 16 21 6l-3-3L8 13m-1 1c-2 0-3 1-3 3v3h3a3 3 0 1 0 0-6z',
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const dateKey = (date) => date.toISOString().slice(0, 10);

export function visitTrend(visitsByDay, today, days) {
  const end = new Date(today + 'T00:00:00Z');
  const weekdayCounts = weekdays.map(() => 0);
  const points = [];
  let previous = 0;
  for (let offset = 2 * days - 1; offset >= 0; offset--) {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - offset);
    const value = visitsByDay.get(dateKey(date)) || 0;
    if (offset >= days) {
      previous += value;
    } else {
      points.push({ label: dayLabel.format(date), value });
      weekdayCounts[(date.getUTCDay() + 6) % 7] += value;
    }
  }
  return {
    points, previous, total: sum(points.map(point => point.value)),
    weekdays: weekdays.map((label, index) => ({ label, value: weekdayCounts[index] })),
  };
}

export function registrationTrend(merchants, now) {
  const counts = new Map();
  for (const merchant of merchants) {
    const day = merchant.created_at?.slice(0, 10);
    if (!day || day > dateKey(now)) continue;
    const month = day.slice(0, 7);
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index - 5, 1));
    return { label: monthLabel.format(date), value: counts.get(dateKey(date).slice(0, 7)) || 0 };
  });
}

export function makeDashboardInsights(React) {
  const h = React.createElement;
  const icon = (name) => h('span', { className: 'dpa-di-icon', 'aria-hidden': true },
    h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: 'false' },
    h('path', { d: metricIcons[name] })));

  function Metrics({ items }) {
    return h('dl', { className: 'dpa-di-metrics' }, items.map((item, index) =>
      h('div', { className: 'dpa-di-metric', key: item.label, style: { '--di-accent': palette[index % 3] } },
        h('dt', null, icon(item.icon), h('span', null, item.label)),
        h('dd', null,
          h('strong', { className: item.text ? 'dpa-di-value dpa-di-text-value' : 'dpa-di-value' }, item.value),
          item.note && h('span', { className: 'dpa-di-note' }, item.note)))));
  }

  function Panel({ title, description, controls, children }) {
    return h('section', { className: 'dpa-di-panel' },
      h('header', { className: 'dpa-di-panel-head' },
        h('div', null, h('h3', null, title), description && h('p', null, description)), controls),
      children);
  }

  function Choices({ label, options }) {
    return h('div', { className: 'dpa-di-choices', role: 'group', 'aria-label': label },
      options.map(option => h('button', { key: option.label, type: 'button', 'aria-pressed': option.selected, onClick: option.pick }, option.label)));
  }

  function Trend({ points, unit, empty }) {
    const gradientId = 'dpa-trend-' + React.useId();
    const peak = Math.max(...points.map(point => point.value));
    if (!peak) return h('p', { className: 'dpa-di-empty' }, empty);
    const tickSize = Math.ceil(peak / 3);
    const ticks = [3, 2, 1, 0].map(tick => tick * tickSize);
    const coordinates = points.map((point, index) => [
      index * 600 / (points.length - 1), 150 - point.value * 150 / ticks[0],
    ]);
    const line = coordinates.map(([x, y]) => x + ',' + y).join(' ');
    const labels = points.length > 7 ? [0, 7, 14, 21, points.length - 1] : points.map((_, index) => index);
    return h(React.Fragment, null,
      h('div', { className: 'dpa-di-chart', 'aria-hidden': true },
        h('div', { className: 'dpa-di-ticks' }, ticks.map(tick => h('span', { key: tick }, number.format(tick)))),
        h('div', { className: 'dpa-di-plot' },
          h('svg', { viewBox: '0 0 600 150', preserveAspectRatio: 'none', focusable: 'false' },
            h('defs', null, h('linearGradient', { id: gradientId, x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
              h('stop', { stopColor: '#5265ec', stopOpacity: 0.28 }), h('stop', { offset: '100%', stopColor: '#5265ec', stopOpacity: 0.02 }))),
            h('polygon', { points: '0,150 ' + line + ' 600,150', fill: 'url(#' + gradientId + ')' }),
            h('polyline', { points: line, fill: 'none', stroke: '#3956db', strokeWidth: 2.5, strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' }))),
        h('div', { className: 'dpa-di-dates' }, labels.map(index => h('span', { key: index }, points[index].label)))),
      h('details', { className: 'dpa-di-values' },
        h('summary', null, 'Voir les valeurs'),
        h('dl', null, points.map(({ label, value }) => h('div', { key: label },
          h('dt', null, label), h('dd', null, number.format(value) + ' ' + unit))))));
  }

  function Ring({ slices, centerLabel, centerValue, empty }) {
    const total = sum(slices.map(slice => slice.value));
    if (!total) return h('p', { className: 'dpa-di-empty' }, empty);
    let start = 0;
    const stops = slices.map(({ value }, index) => {
      const end = start + value / total * 100;
      const stop = palette[index] + ' ' + start + '% ' + end + '%';
      start = end;
      return stop;
    });
    return h('div', { className: 'dpa-di-ring-layout' },
      h('div', { className: 'dpa-di-ring', style: { background: 'conic-gradient(' + stops.join(',') + ')' } },
        h('div', null, h('strong', null, centerValue ?? number.format(total)), h('span', null, centerLabel))),
      h('dl', { className: 'dpa-di-legend' }, slices.map(({ label, value }, index) =>
        h('div', { key: label }, h('dt', null, h('i', { style: { backgroundColor: palette[index] }, 'aria-hidden': true }), label),
          h('dd', null, number.format(value))))));
  }

  function Bars({ items, empty }) {
    const max = Math.max(0, ...items.map(item => item.value));
    if (!max) return h('p', { className: 'dpa-di-empty' }, empty);
    return h('ul', { className: 'dpa-di-bars' }, items.map(({ label, value, open, id }) => {
      const contents = [
        h('span', { key: 'label' }, label), h('strong', { key: 'value' }, number.format(value)),
        h('span', { key: 'bar', className: 'dpa-di-track', 'aria-hidden': true }, h('i', { style: { width: (value / max * 100) + '%' } })),
      ];
      return h('li', { key: id ?? label },
        open ? h('button', { type: 'button', onClick: open }, contents) : h('div', null, contents));
    }));
  }

  function Merchant({ analytics, today, year, retentionFilters }) {
    const [days, setDays] = React.useState(30);
    const trend = React.useMemo(() => visitTrend(analytics.visitsByDay, today, days), [analytics.visitsByDay, today, days]);
    const difference = trend.total - trend.previous;
    const comparison = difference === 0 ? 'Autant que sur la période précédente'
      : (difference > 0 ? '+' : '−') + number.format(Math.abs(difference)) + ' par rapport aux ' + days + ' jours précédents';
    const metrics = [
      { label: 'Passages sur ' + days + ' jours', value: number.format(trend.total), icon: 'monitoring', note: comparison },
      { label: 'Passages ce mois-ci', value: number.format(analytics.monthly), icon: 'calendar_month' },
      { label: 'Passages en ' + year, value: number.format(analytics.annual), icon: 'calendar_today' },
      { label: 'Client le plus assidu en ' + year, value: analytics.top?.name || '—', text: true, icon: 'workspace_premium',
        note: analytics.top && number.format(analytics.top.annual) + ' passages' },
    ];
    return h('div', { className: 'dpa-di' },
      h('header', { className: 'dpa-di-intro' }, h('h2', null, 'Analyse de fidélité'),
        h('p', null, 'Les passages validés dans votre commerce, hors corrections.')),
      h(Metrics, { items: metrics }),
      h('div', { className: 'dpa-di-grid dpa-di-grid-main' },
        h(Panel, { title: 'Évolution des passages', description: 'Passages par jour, aujourd’hui inclus.',
          controls: h(Choices, { label: 'Période des passages', options: [7, 30].map(value => ({
            label: value + ' jours', selected: days === value, pick: () => setDays(value),
          })) }) },
        h(Trend, { points: trend.points, unit: 'pass.', empty: 'Aucun passage enregistré sur cette période.' })),
        h(Panel, { title: 'Taux de retour des clients', description: 'Parmi les clients actifs sur la période, ceux qui étaient déjà venus avant.',
          controls: h(Choices, { label: 'Période du taux de retour', options: retentionFilters }) },
        h(Ring, { slices: [
          { label: 'Déjà venus', value: analytics.returned },
          { label: 'Aucun passage avant la période', value: analytics.active - analytics.returned },
        ], centerLabel: 'déjà venus', centerValue: analytics.retention + ' %', empty: 'Aucun client actif sur cette période.' }))),
      h(Panel, { title: 'Passages par jour de la semaine', description: 'Total par jour de la semaine sur les ' + days + ' derniers jours.' },
        h(Bars, { items: trend.weekdays, empty: 'Les jours les plus fréquentés apparaîtront après vos premiers passages.' })));
  }

  function Admin({ kpis, merchants, wallet, professions, open }) {
    const registrations = registrationTrend(merchants, new Date());
    const top = merchants.filter(merchant => merchant.visits > 0)
      .sort((a, b) => b.visits - a.visits || a.business_name.localeCompare(b.business_name, 'fr'))
      .slice(0, 5).map(merchant => ({
        id: merchant.id, label: merchant.business_name, value: Number(merchant.visits), open: () => open(merchant.id),
      }));
    return h('section', { className: 'dpa-di dpa-di-admin', 'aria-label': 'Indicateurs des commerces' },
      h('header', { className: 'dpa-di-intro dpa-di-admin-intro' },
        h('div', null, h('h2', null, 'Vue d’ensemble'), h('p', null, 'Indicateurs des commerces visibles avec votre compte.')),
        h('a', { href: '#admin-merchant-list' }, 'Aller à la liste des commerces')),
      h(Metrics, { items: kpis }),
      h('div', { className: 'dpa-di-grid dpa-di-grid-main' },
        h(Panel, { title: 'Inscriptions de commerces', description: 'Commerces créés par mois sur les six derniers mois. Le mois en cours est partiel.' },
          h(Trend, { points: registrations, unit: 'inscr.', empty: 'Aucune inscription sur cette période.' })),
        h(Panel, { title: 'Passes Wallet générés pour les clients',
          description: 'Passes Google préparés et fichiers Apple générés, hors cartes test. Ces chiffres ne mesurent pas les installations.' },
          h(Ring, { slices: wallet, centerLabel: 'cartes', empty: 'Aucune carte client à répartir.' }))),
      h('div', { className: 'dpa-di-grid dpa-di-grid-main' },
        h(Panel, { title: 'Commerces les plus actifs', description: 'Les cinq commerces ayant enregistré le plus de passages. Sélectionnez un commerce pour ouvrir sa fiche.' },
          h(Bars, { items: top, empty: 'Aucun passage enregistré dans les commerces visibles.' })),
        h(Panel, { title: 'Commerces par profession', description: 'Nombre de commerces inscrits par secteur d’activité.' },
          h('div', { className: 'dpa-di-scroll', tabIndex: 0, role: 'group', 'aria-label': 'Liste des professions' },
            h(Bars, { items: professions, empty: 'Aucun commerce inscrit.' })))));
  }

  return { Merchant, Admin };
}
