import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeAdminScanner } from '../src/admin-scanner.js';

test('admin scanner factory returns the component directly, not a namespace object', () => {
  const AdminScanner = makeAdminScanner(React, {
    lookup: async () => { throw new Error('not called'); },
    addTest: async () => { throw new Error('not called'); },
  });
  assert.equal(typeof AdminScanner, 'function');
  const html = renderToStaticMarkup(React.createElement(AdminScanner));
  assert.match(html, /data-admin-scanner/);
  assert.match(html, /Scanner une carte/);
  assert.match(html, /Ouvrir la caméra/);
  assert.match(html, /DPA_TEST/);
});

test('admin page renders the actual scanner component, avoiding React error 130', () => {
  const page = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  const backend = readFileSync(new URL('../src/admin-backend.js', import.meta.url), 'utf8');
  assert.match(backend, /scanner: \(\) => scanner \|\| \(scanner = makeAdminScanner\(window\.React,scannerApi\)\)/);
  assert.match(page, /React\.createElement\(scannerApi\)/);
  assert.doesNotMatch(page, /React\.createElement\(scannerApi\.AdminScanner\)/);
});
