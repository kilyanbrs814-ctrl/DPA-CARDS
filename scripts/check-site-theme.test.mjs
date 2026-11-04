import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
function boot(initial = {}, blocked = false) {
  const saved = new Map(Object.entries(initial)), listeners = new Map(), changes = [];
  const root = {dataset: {}, style: {}};
  const storage = {
    getItem: key => { if (blocked) throw Error('Storage disabled'); return saved.get(key) ?? null; },
    setItem: (key, value) => { if (blocked) throw Error('Storage disabled'); saved.set(key, value); },
  };
  const window = {
    addEventListener(name, callback) { listeners.set(name, [...(listeners.get(name) || []), callback]); },
    dispatchEvent(event) { changes.push(event.detail.theme); for (const fn of listeners.get(event.type) || []) fn(event); },
  };
  const registry = new Map();
  runInNewContext(source, {window, document: {documentElement: root}, localStorage: storage,
    HTMLElement: class {}, customElements: {get: name => registry.get(name), define: (name, element) => registry.set(name, element)},
    CustomEvent: class { constructor(type, {detail}) { this.type = type; this.detail = detail; } },
  });
  return {api: window.dpaTheme, root, saved, changes, externalStorage: () => listeners.get('storage')[0]({key: 'dpa.theme.v1'})};
}

test('an existing sidebar night preference applies to the document before components mount', () => {
  const app = boot({'dpa.sidebar.theme.v1': 'dark'});
  assert.equal(app.root.dataset.dpaTheme, 'dark');
  assert.equal(app.root.style.colorScheme, 'dark');
  assert.equal(app.api.get(), 'dark');
});

test('global controls share one preference and another tab can update it', () => {
  const app = boot({'dpa.theme.v1': 'light', 'dpa.sidebar.theme.v1': 'dark'});
  assert.equal(app.api.get(), 'light');
  app.api.toggle();
  assert.equal(app.root.dataset.dpaTheme, 'dark');
  assert.equal(app.saved.get('dpa.theme.v1'), 'dark');
  assert.equal(app.saved.get('dpa.sidebar.theme.v1'), 'dark');
  app.saved.set('dpa.theme.v1', 'light');
  app.externalStorage();
  assert.equal(app.api.get(), 'light');
  assert.deepEqual(app.changes, ['light', 'dark', 'light']);
});

test('blocked storage still permits switching the current page', () => {
  const app = boot({}, true);
  app.api.toggle();
  assert.equal(app.root.dataset.dpaTheme, 'dark');
  app.api.set('light');
  assert.equal(app.root.dataset.dpaTheme, 'light');
});

test('an invalid stored value falls back to the light theme', () => {
  const app = boot({'dpa.theme.v1': '<invalid>'});
  assert.equal(app.api.get(), 'light');
});
