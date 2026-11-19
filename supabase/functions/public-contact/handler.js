export const PROJECTS = Object.freeze({
  creation: 'Créer ma carte de fidélité',
  'multi-commerce': 'Équiper plusieurs commerces',
  'sur-mesure': 'Faire dessiner ma carte sur mesure',
  autre: 'Une autre demande',
});

const origins = new Set(['https://cards.digitalprojectagency.fr', 'capacitor://localhost']);
const MAX_BYTES = 20000;
const text = value => typeof value === 'string' ? value.trim() : '';
const singleLine = (value, min, max) => value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BYTES) { await reader.cancel(); throw new RangeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createContactHandler({ apiKeys, configured, consumeRate, sendEmail }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = new Headers({
      vary: 'Origin', 'cache-control': 'no-store',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'apikey, content-type',
    });
    const json = (status, body) => Response.json(body, { status, headers });
    if (!origins.has(origin)) return json(403, { error: 'origin_not_allowed' });
    headers.set('access-control-allow-origin', origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!configured) return json(503, { error: 'contact_unavailable' });
    if (!apiKeys.has(request.headers.get('apikey'))) return json(401, { error: 'invalid_api_key' });
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(415, { error: 'json_required' });

    try {
      const body = await readBody(request);
      if (!body || Array.isArray(body) || typeof body !== 'object') return json(422, { error: 'invalid_contact_request' });
      if (text(body.website)) return json(200, { ok: true });
      const data = Object.fromEntries(['name', 'company', 'email', 'phone', 'subject', 'project', 'message', 'requestId'].map(name => [name, text(body[name])]));
      const invalid = [];
      for (const [name, min, max] of [['name', 2, 100], ['company', 2, 120], ['subject', 3, 130]]) {
        if (!singleLine(data[name], min, max)) invalid.push(name);
      }
      if (!singleLine(data.email, 3, 254) || /[,;:()\[\]]/.test(data.email) || !/^[^\s@<>"\\]+@[^\s@<>"\\]+\.[^\s@<>"\\]+$/.test(data.email)) invalid.push('email');
      if (data.phone && !/^[+()0-9 .-]{6,30}$/.test(data.phone)) invalid.push('phone');
      if (!Object.hasOwn(PROJECTS, data.project)) invalid.push('project');
      if (data.message.length < 10 || data.message.length > 4000 || /\u0000/.test(data.message)) invalid.push('message');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId)) invalid.push('requestId');
      if (invalid.length) return json(422, { error: 'invalid_contact_request', fields: invalid });
      if (!await consumeRate(request, data.email)) { headers.set('retry-after', '600'); return json(429, { error: 'contact_rate_limited' }); }

      const rows = [
        ['Nom et prénom', data.name], ['Entreprise', data.company],
        ['E-mail de contact', data.email], ['Téléphone', data.phone || 'Non renseigné'],
        ['Objet', data.subject], ['Projet', PROJECTS[data.project]], ['Message', data.message],
      ];
      const textBody = 'Nouvelle demande depuis la vitrine DPA Cards\n\n' + rows.map(([label, value]) => label + ' :\n' + value).join('\n\n');
      const html = '<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#1C1F24;line-height:1.5"><h1 style="font-size:22px">Nouvelle demande de contact DPA Cards</h1>'
        + rows.map(([label, value]) => '<p><strong>' + escapeHtml(label) + '</strong><br>' + escapeHtml(value).replace(/\r?\n/g, '<br>') + '</p>').join('') + '</body></html>';
      const result = await sendEmail({ requestId: data.requestId, replyTo: data.email, subject: '[DPA Cards — Contact] ' + data.subject, text: textBody, html });
      if (result.status === 429) return json(429, { error: 'contact_rate_limited' });
      if (!result.ok) return json(502, { error: 'contact_send_failed' });
      return json(200, { ok: true });
    } catch (error) {
      if (error instanceof RangeError) return json(413, { error: 'message_too_long' });
      if (error instanceof SyntaxError) return json(422, { error: 'invalid_contact_request' });
      return json(503, { error: 'contact_unavailable' });
    }
  };
}
