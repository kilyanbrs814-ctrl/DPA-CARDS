import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const backend = 'https://design-test.supabase.co';
const merchantId = '11111111-1111-4111-8111-111111111111';
const programId = '22222222-2222-4222-8222-222222222222';
const testId = '33333333-3333-4333-8333-333333333333';
const merchant = { id: merchantId, business_name: 'Boulangerie des Lilas', activity: 'Boulangerie' };
const user = { id: '44444444-4444-4444-8444-444444444444', email: 'admin@example.com', factors: [] };
const noProgram = { id: '55555555-5555-4555-8555-555555555555', business_name: 'Commerce sans carte' };

test('the merchant sheet reuses a saved design or opens a new design for the selected program', async t => {
  const server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(backend),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('test-key')
    }
  });
  await server.listen();
  t.after(() => server.close());
  const origin = server.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encoded({ alg: 'HS256' })}.${encoded({ sub: user.id, aal: 'aal2', exp: expiresAt })}.eA`;
  await page.addInitScript(session => localStorage.setItem('dpa-admin-auth', JSON.stringify(session)), {
    access_token: accessToken, refresh_token: 'test-refresh', expires_at: expiresAt, user
  });
  const writes = [];
  let program = { id: programId, name: 'Club des Lilas', mode: 'passages', goal: 7, reward: 'Un pain offert',
    bg: '#FFFFFF', accent: '#6644CC', logo: 'BL', design_status: 'draft' };
  let draft = { config: { identity: { name: 'Ancien brouillon' } }, status: 'draft' };
  let shouldFailList = true;
  let shouldFailAssign = true;
  await page.route('**/*.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, backend);
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body, status = 200) => route.fulfill({ headers, json: body, status });
    const payload = request.method() === 'POST' ? request.postDataJSON() : null;
    switch (url.pathname) {
      case '/auth/v1/user': return json(user);
      case '/rest/v1/admin_users': return json({ email: user.email });
      case '/functions/v1/wallet/admin-overview':
        return json({ merchants: [{ ...merchant, program }, noProgram], me: { role: 'admin' } });
      case '/functions/v1/wallet/admin-designs': return json({ requests: [] });
      case '/functions/v1/wallet/admin-merchant':
        return json({ program: payload.merchant_id === merchantId ? program : null, clients: [], activity: [] });
      case '/functions/v1/wallet/admin-test-cards':
        if (shouldFailList) {
          shouldFailList = false;
          return json({ error: 'unavailable' }, 503);
        }
        return json({ tests: [{ id: testId, name: 'Carte Lavande' }] });
      case '/functions/v1/wallet/admin-test-card-assign':
        writes.push(['assign', payload]);
        if (shouldFailAssign) {
          shouldFailAssign = false;
          return json({ error: 'demo_asset_copy_failed' }, 409);
        }
        program = { ...program, design_status: 'validated', bg: '#E9DBFC' };
        return json({ assigned: true, google: { status: 'synced' } });
      case '/functions/v1/wallet/admin-card-designer':
        assert.deepEqual(payload, { merchant_id: merchantId });
        return json({ merchant, program, draft, requests: [] });
      case '/functions/v1/wallet/admin-card-save':
        writes.push(['save', payload]);
        draft = { config: payload.config, status: 'draft', updated_at: new Date().toISOString() };
        return json({ draft });
      case '/functions/v1/wallet/admin-card-validate':
        writes.push(['validate', payload]);
        return json({ program, draft: { ...draft, status: 'validated' }, google: { status: 'synced' } });
      default: return json({ error: 'unexpected_test_route' }, 404);
    }
  });

  await page.goto(new URL('/admin.html', origin).href);
  const sheet = page.getByRole('dialog', { name: merchant.business_name });
  const openSheet = () => page.getByRole('button', { name: new RegExp(merchant.business_name) }).click();
  const change = sheet.getByRole('button', { name: 'Changer le design de la carte' });
  await openSheet();
  await change.click();
  const existing = sheet.getByRole('button', { name: 'Utiliser un design existant' });
  await existing.click();
  await expect(sheet.getByRole('alert')).toContainText('Impossible de charger les cartes test');
  await existing.click();
  const select = sheet.getByLabel('Design existant (carte test)');
  const apply = sheet.getByRole('button', { name: 'Appliquer ce design' });
  await expect(apply).toBeDisabled();
  await select.selectOption(testId);
  page.once('dialog', dialog => dialog.dismiss());
  await apply.click();
  assert.deepEqual(writes, []);
  page.once('dialog', dialog => dialog.accept());
  await apply.click();
  await expect(sheet.getByRole('alert')).toContainText('demo_asset_copy_failed');
  await expect(select).toHaveValue(testId);
  page.once('dialog', dialog => dialog.accept());
  await apply.click();
  await expect(sheet.getByText('Design appliqué au commerce.')).toBeVisible();
  await expect(sheet.getByText('Design : validé')).toBeVisible();
  assert.deepEqual(writes, Array(2).fill(['assign', { id: testId, merchant_id: merchantId, overwrite: true }]));
  await sheet.getByRole('button', { name: 'Fermer' }).click();

  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: new RegExp(noProgram.business_name) }).click();
  const emptySheet = page.getByRole('dialog', { name: noProgram.business_name });
  await expect(emptySheet.getByText('Aucun programme actif.')).toBeVisible();
  await expect(emptySheet.getByRole('button', { name: 'Changer le design de la carte' })).toHaveCount(0);
  await emptySheet.getByRole('button', { name: 'Fermer' }).click();
  await openSheet();
  await change.click();
  await sheet.getByRole('button', { name: 'Créer un nouveau design' }).click();
  await expect(page).toHaveURL(new RegExp(`#generateur/m/${merchantId}$`));
  await expect(page.getByText('Nouveau design · non enregistré')).toBeVisible();
  const name = page.getByRole('textbox', { name: 'Nom du commerce', exact: true });
  await expect(name).toHaveValue(merchant.business_name);
  await name.fill('Les Lilas');
  assert.equal(writes.length, 2);
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('Les Lilas');
  await page.getByRole('button', { name: 'Valider le design' }).click();
  await page.getByRole('button', { name: 'Valider et appliquer' }).click();
  await expect(page.getByText('Design validé et appliqué au programme.', { exact: false })).toBeVisible();
  for (const [operation, payload] of writes.slice(2)) {
    assert.ok(['save', 'validate'].includes(operation));
    assert.equal(payload.program_id, programId);
    assert.equal(payload.config.identity.name, 'Les Lilas');
    assert.equal(payload.config.preview.goal, 7);
    assert.equal(payload.config.preview.reward, 'Un pain offert');
  }
  assert.equal(writes.length, 4);
  assert.deepEqual(pageErrors, []);
});
