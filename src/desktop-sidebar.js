const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// The sidebar only receives actions already allowed by the merchant workspace.
export function makeDesktopSidebar(React) {
  const h = React.createElement;
  const paths = {
    home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    group: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m7-7.87a4 4 0 0 1 0 7.75',
    qr_code_scanner: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h3v3H7Zm7 0h3v3h-3ZM7 14h3v3H7Zm7 0h1v1h-1Zm3 0v3h-3',
    notifications: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    qr_code_2: 'M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h2v2h-2Zm6 0v3h-3v3m-3 0h1',
    settings: 'm9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-1 1-3 3-1 2-3-2-2 1-3-2-3-3 1Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    search: 'm21 21-5-5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15',
    chevron: 'm9 5 7 7-7 7',
    chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5 10 10 0 0 1-4-.8L3 21l1.8-5.5a10 10 0 0 1-.8-4A8.5 8.5 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z',
    moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10',
    sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0',
    switch: 'm8 9 4-4 4 4m-8 6 4 4 4-4',
  };
  const icon = name => h('svg', {className: 'dpa-sidebar-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d: paths[name] || paths.settings}));

  return function DesktopSidebar({items, settings, merchant, logo, initials, demo, onProfile, profilePopup}) {
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const [pinned, setPinned] = React.useState(false);
    const [suppressed, setSuppressed] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [settingsHovered, setSettingsHovered] = React.useState(false);
    const [failedLogo, setFailedLogo] = React.useState('');
    const [theme, setTheme] = React.useState(() => window.dpaTheme.get());
    const root = React.useRef(null);
    const search = React.useRef(null);
    const expanded = !suppressed && (hovered || focused || pinned);
    const term = fold(query.trim());
    const children = settings.filter(item => !term || fold(item.label).includes(term));
    const matches = items.filter(item => !term || fold(item.label).includes(term) || (item.k === 'more' && children.length));
    const showSettings = expanded && (settingsOpen || settingsHovered || !!term);

    React.useEffect(() => {
      const update = () => setTheme(window.dpaTheme.get());
      window.addEventListener('dpa:themechange', update);
      update();
      return () => window.removeEventListener('dpa:themechange', update);
    }, []);
    React.useEffect(() => {
      const shortcut = event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey && !document.querySelector('[aria-modal="true"]')) {
          event.preventDefault();
          setSuppressed(false);
          setPinned(true);
          search.current?.focus();
        }
      };
      document.addEventListener('keydown', shortcut);
      return () => document.removeEventListener('keydown', shortcut);
    }, []);

    const navigate = run => {
      setQuery('');
      setSettingsOpen(false);
      run();
    };
    const renderItem = item => {
      const hasChildren = item.k === 'more' && settings.length > 0;
      return h('div', {
        key: item.k, className: 'dpa-sidebar-entry',
        onMouseEnter: hasChildren ? () => setSettingsHovered(true) : undefined,
        onMouseLeave: hasChildren ? () => setSettingsHovered(false) : undefined,
      },
      h('div', {className: 'dpa-sidebar-row'},
        h('button', {type: 'button', className: 'dpa-sidebar-item', 'aria-label': item.label, 'aria-current': item.current,
          title: expanded ? undefined : item.label, onClick: () => navigate(item.go)},
          icon(item.icon), h('span', {className: 'dpa-sidebar-label'}, item.label)),
        hasChildren && h('button', {type: 'button', className: 'dpa-sidebar-disclosure', tabIndex: expanded ? 0 : -1,
          'aria-label': 'Sous-rubriques de Paramètres', 'aria-expanded': showSettings, 'aria-controls': 'dpa-sidebar-settings',
          onClick: () => { setSettingsHovered(false); setSettingsOpen(!settingsOpen); }}, icon('chevron'))),
      hasChildren && h('div', {id: 'dpa-sidebar-settings', className: 'dpa-sidebar-submenu', hidden: !showSettings},
        children.map((child, index) => h('button', {key: child.label, type: 'button', className: 'dpa-sidebar-child',
          onClick: () => navigate(child.run)}, h('span', {className: 'dpa-sidebar-dot', 'data-color': index % 3, 'aria-hidden': true}), child.label))));
    };
    const section = (label, list) => list.length > 0 && h('section', {className: 'dpa-sidebar-section', 'aria-label': label},
      h('div', {className: 'dpa-sidebar-section-title', 'aria-hidden': true}, h('span', {className: 'dpa-sidebar-label'}, label)), list.map(renderItem));

    return h('aside', {ref: root, className: 'dpa-desktop-sidebar', 'data-expanded': expanded, 'data-pinned': pinned && expanded, 'data-theme': theme, 'aria-label': 'Menu DPA Cards',
      onPointerEnter: event => { if (event.pointerType === 'mouse') setHovered(true); },
      onPointerLeave: () => { setHovered(false); setSettingsHovered(false); setSuppressed(false); },
      onFocusCapture: event => {
        if (event.target.closest('.dpa-sidebar-toggle')) return;
        setFocused(event.target === search.current || event.target.matches(':focus-visible'));
        setSuppressed(false);
      },
      onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget)) { setFocused(false); setSuppressed(false); } },
      onKeyDown: event => {
        if (event.key === 'Escape') {
          event.preventDefault(); setQuery(''); setSettingsOpen(false); setSettingsHovered(false); setPinned(false); setFocused(false);
          setSuppressed(true); root.current?.querySelector('.dpa-sidebar-toggle')?.focus(); setSuppressed(true);
        }
      }},
    h('button', {type: 'button', className: 'dpa-sidebar-toggle', 'aria-controls': 'dpa-sidebar-content', 'aria-expanded': expanded,
      'aria-label': pinned ? 'Replier le menu' : expanded ? 'Garder le menu ouvert' : 'Déplier le menu',
      title: pinned ? 'Replier le menu' : expanded ? 'Garder le menu ouvert' : 'Déplier le menu', 'aria-pressed': pinned,
      onClick: () => { if (pinned) { setPinned(false); setSuppressed(true); } else { setSuppressed(false); setPinned(true); } }}, icon('chevron')),
    h('div', {id: 'dpa-sidebar-content', className: 'dpa-sidebar-content'},
      h('div', {className: 'dpa-sidebar-brand'},
        h('span', {className: 'dpa-sidebar-brand-mark'}, h('img', {src: '/assets/dpa-cards-logo.png', alt: 'DPA Cards', width: 36, height: 36})),
        h('span', {className: 'dpa-sidebar-label dpa-sidebar-brand-text'}, h('strong', null, 'DPA Cards'), h('small', null, 'Espace commerçant'))),
      h('div', {className: 'dpa-sidebar-search'},
        h('button', {type: 'button', className: 'dpa-sidebar-search-button', 'aria-label': 'Rechercher une page', title: expanded ? undefined : 'Rechercher une page',
          onClick: () => { setSuppressed(false); setPinned(true); search.current?.focus(); }}, icon('search')),
        h('input', {ref: search, type: 'search', value: query, tabIndex: expanded ? 0 : -1, 'aria-label': 'Rechercher dans le menu',
          placeholder: 'Rechercher une page', onChange: event => setQuery(event.target.value)}),
        h('kbd', {'aria-hidden': true}, '⌘ / Ctrl K')),
      h('nav', {'aria-label': 'Navigation principale'},
        section('Principal', matches.filter(item => !['invite', 'more'].includes(item.k))),
        section('Mon commerce', matches.filter(item => ['invite', 'more'].includes(item.k))),
        !matches.length && h('p', {className: 'dpa-sidebar-empty', role: 'status'}, 'Aucune page trouvée.')),
      h('div', {className: 'dpa-sidebar-footer'},
        demo && h('span', {className: 'dpa-sidebar-demo dpa-sidebar-label'}, 'Mode démonstration'),
        h('button', {type: 'button', role: 'switch', 'aria-checked': theme === 'dark', 'aria-label': 'Mode nuit',
          className: 'dpa-sidebar-item dpa-sidebar-theme', title: expanded ? undefined : 'Mode nuit',
          onClick: () => window.dpaTheme.toggle()}, icon(theme === 'dark' ? 'moon' : 'sun'),
          h('span', {className: 'dpa-sidebar-label'}, 'Mode nuit'), h('span', {className: 'dpa-sidebar-switch', 'aria-hidden': true})),
        h('a', {className: 'dpa-sidebar-item', href: 'mailto:contact@digitalprojectagency.fr?subject=Support%20DPA%20Cards',
          'aria-label': 'Contacter le support DPA Cards par e-mail', title: expanded ? undefined : 'Support'}, icon('chat'), h('span', {className: 'dpa-sidebar-label'}, 'Support')),
        h('button', {type: 'button', className: 'dpa-desktop-profile dpa-sidebar-item', 'aria-haspopup': profilePopup,
          'aria-label': `${merchant.first} ${merchant.last} · ${merchant.business} · Gérer mes commerces`,
          title: expanded ? undefined : merchant.business, onClick: onProfile},
          h('span', {className: 'dpa-desktop-avatar', 'aria-hidden': true}, initials,
            logo && failedLogo !== logo && h('img', {src: logo, alt: '', onError: () => setFailedLogo(logo)})),
          h('span', {className: 'dpa-sidebar-label dpa-sidebar-profile-text'},
            h('strong', null, `${merchant.first} ${merchant.last}`), h('small', null, merchant.business)),
          h('span', {className: 'dpa-sidebar-label dpa-sidebar-profile-arrow'}, icon('switch'))))));
  };
}
