import './dashboard-experience.css';
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function makeDashboardExperience(React) {
  const h = React.createElement;
  return function DashboardExperience({ commands, pageKey, role }) {
    const [open, setOpen] = React.useState(false), [query, setQuery] = React.useState(''), [index, setIndex] = React.useState(0);
    const dialog = React.useRef(null), input = React.useRef(null), origin = React.useRef(null), toolbar = React.useRef(null), entered = React.useRef(false);
    const id = React.useId();
    const matches = commands.filter((command, i) => commands.findIndex(other => fold(other.label) === fold(command.label)) === i).filter(command => fold(command.label + ' ' + (command.detail || '')).includes(fold(query.trim()))).slice(0, 12);
    const pick = command => { setOpen(false); command.run(); };
    const show = () => { if (document.querySelector('dialog[open], [aria-modal="true"]')) return; origin.current = document.activeElement; setQuery(''); setIndex(0); setOpen(true); };
    React.useEffect(() => {
      const root = document.documentElement;
      root.dataset.dpaDashboard = role; root.dataset.dpaAccent = 'violet';
      try { localStorage.removeItem('dpa.dashboard.accent.v1'); } catch {}
      return () => { delete root.dataset.dpaDashboard; delete root.dataset.dpaAccent; };
    }, [role]);
    React.useEffect(() => {
      const shortcut = event => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
          if (document.querySelector('dialog[open], [aria-modal="true"]') && !dialog.current?.open) return;
          event.preventDefault(); event.stopImmediatePropagation();
          if (dialog.current?.open) setOpen(false); else show();
        }
      };
      document.addEventListener('keydown', shortcut, true);
      return () => document.removeEventListener('keydown', shortcut, true);
    }, []);
    React.useEffect(() => {
      if (open) { dialog.current.showModal(); input.current?.focus(); }
      else if (dialog.current?.open) { dialog.current.close(); origin.current?.isConnected && origin.current.focus(); }
    }, [open]);
    React.useEffect(() => {
      if (index >= matches.length) setIndex(0);
    }, [matches.length, index]);
    React.useEffect(() => { if (open) dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}); }, [index, query, open]);
    React.useLayoutEffect(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const main = toolbar.current?.closest('main');
      if (!main || reduced || !main.animate) return;
      let animations;
      if (!entered.current) {
        entered.current = true;
        animations = [main.animate([
          { opacity: .25, clipPath: 'circle(34% at 50% 32%)', transform: 'scale(.975)', filter: 'brightness(1.18)' },
          { opacity: 1, clipPath: 'circle(150% at 50% 32%)', transform: 'none', filter: 'brightness(1)' },
        ], { duration: 640, easing: 'cubic-bezier(.16,1,.3,1)' })];
      } else {
        animations = [...main.children].filter(el => !el.contains(toolbar.current)).slice(0, 16).map((el, i) => el.animate([
          { opacity: .25, transform: 'perspective(1000px) translateY(12px) rotateX(3deg)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ], { duration: 320, delay: Math.min(i * 25, 125), easing: 'cubic-bezier(.16,1,.3,1)' }));
      }
      return () => animations.forEach(animation => animation.cancel());
    }, [pageKey]);
    return h('div', { className: 'dpa-experience', ref: toolbar },
      h('button', { type: 'button', className: 'dpa-experience-search', onClick: show, 'aria-haspopup': 'dialog' },
        h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true }, h('path', { d: 'm21 21-5-5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15' })),
        h('span', null, 'Rechercher'), h('kbd', null, '⌘ / Ctrl K')),
      h('dialog', { ref: dialog, className: 'dpa-command-dialog', 'aria-labelledby': id + '-title', onCancel: event => { event.preventDefault(); setOpen(false); },
        onClick: event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setOpen(false); } } },
        h('header', null, h('h2', { id: id + '-title' }, 'Que souhaitez-vous ouvrir ?'), h('button', { type: 'button', onClick: () => setOpen(false), 'aria-label': 'Fermer la recherche' }, '×')),
        h('input', { ref: input, value: query, type: 'search', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': true,
          'aria-label': 'Rechercher une page ou un commerce', 'aria-controls': id + '-results', 'aria-activedescendant': matches[index] ? id + '-option-' + index : undefined,
          placeholder: 'Une page, une action, un commerce…', onChange: event => { setQuery(event.target.value); setIndex(0); },
          onKeyDown: event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setIndex(i => (i + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length)); }
            if (event.key === 'Enter' && matches[index]) { event.preventDefault(); pick(matches[index]); } } }),
        h('ul', { id: id + '-results', role: 'listbox', 'aria-label': 'Résultats' }, matches.map((command, i) => h('li', {
          key: command.id || command.label, id: id + '-option-' + i, role: 'option', 'aria-selected': index === i,
          onPointerMove: () => setIndex(i), onClick: () => pick(command) }, h('strong', null, command.label), command.detail && h('small', null, command.detail)))),
        !matches.length && h('p', { role: 'status' }, 'Aucun résultat.'), h('footer', null, '↑ ↓ pour choisir · Entrée pour ouvrir · Échap pour fermer')));
  };
}
