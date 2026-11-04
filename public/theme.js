// Runs before the page paints. This preference never changes account data.
(function () {
  'use strict';
  var KEY = 'dpa.theme.v1';
  var LEGACY_KEY = 'dpa.sidebar.theme.v1';
  var EVENT = 'dpa:themechange';
  function read() {
    try { return (localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY)) === 'dark' ? 'dark' : 'light'; }
    catch (_) { return 'light'; }
  }
  var theme = read();
  function apply(value, persist) {
    theme = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.dpaTheme = theme;
    document.documentElement.style.colorScheme = theme;
    if (persist) {
      try { localStorage.setItem(KEY, theme); localStorage.setItem(LEGACY_KEY, theme); } catch (_) {}
    }
    window.dispatchEvent(new CustomEvent(EVENT, {detail: {theme: theme}}));
  }
  window.dpaTheme = {
    get: function () { return theme; },
    set: function (value) { apply(value, true); },
    toggle: function () { apply(theme === 'dark' ? 'light' : 'dark', true); }
  };
  apply(theme, false);
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === LEGACY_KEY || event.key === null) apply(read(), false);
  });

  // A native element works in the merchant runtime, admin and static legal pages.
  // Its shadow DOM keeps the same control intact across React renders.
  class ThemeSwitch extends HTMLElement {
    constructor() {
      super();
      var shadow = this.attachShadow({mode: 'open'});
      shadow.innerHTML = '<style>' +
        ':host{display:inline-flex;flex:none;vertical-align:middle}' +
        'button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:9px 12px;border:1px solid var(--dpa-border,#dce1e8);border-radius:999px;background:var(--dpa-toggle-surface,#ffffff94);color:var(--dpa-text,#303846);font:inherit;font-size:13px;font-weight:600;line-height:1.2;white-space:nowrap;cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}' +
        'button:hover{background:var(--dpa-hover,#fff)}button:focus-visible{outline:2px solid var(--dpa-link,#2448f0);outline-offset:3px}' +
        'svg{width:18px;height:18px;flex:none}span{font-size:13px;font-weight:650}' +
        ':host([compact]) span{display:none}:host([compact]) button{width:44px;padding:10px}' +
        '@media(max-width:480px){span{display:none}button{width:44px;padding:10px}}' +
        '</style><button type="button" role="switch" aria-label="Mode nuit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path></path></svg><span>Mode nuit</span></button>';
      this.button = shadow.querySelector('button');
      this.path = shadow.querySelector('path');
      this.update = this.update.bind(this);
      this.button.addEventListener('click', window.dpaTheme.toggle);
    }
    connectedCallback() { window.addEventListener(EVENT, this.update); this.update(); }
    disconnectedCallback() { window.removeEventListener(EVENT, this.update); }
    update() {
      var dark = window.dpaTheme.get() === 'dark';
      this.button.setAttribute('aria-checked', String(dark));
      this.button.title = dark ? 'Passer au mode clair' : 'Passer au mode nuit';
      this.path.setAttribute('d', dark
        ? 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10'
        : 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0');
    }
  }
  if (!customElements.get('dpa-theme-switch')) customElements.define('dpa-theme-switch', ThemeSwitch);
}());
