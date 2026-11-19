import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createContactHandler } from './handler.js';

// Public form: JWT verification is disabled for this function only. The handler
// checks the project's publishable apikey, origin, payload and durable rate limit.
const url = Deno.env.get('SUPABASE_URL') || '';
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const secret = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const publicKeys = Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}'))
  .filter((key): key is string => typeof key === 'string')
  .map(key => Deno.env.get(key) || key);
const apiKeys = new Set([...publicKeys, Deno.env.get('SUPABASE_ANON_KEY')].filter(Boolean));
const resendKey = Deno.env.get('RESEND_API_KEY') || '';
const from = Deno.env.get('EMAIL_FROM') || '';
const db = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const hashKey = secret ? crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) : null;

async function fingerprint(value: string) {
  const signature = await crypto.subtle.sign('HMAC', await hashKey!, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(createContactHandler({
  apiKeys,
  configured: Boolean(url && secret && resendKey && from && apiKeys.size),
  consumeRate: async (request: Request, email: string) => {
    const ip = (request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 100);
    const [ipHash, emailHash] = await Promise.all([fingerprint('ip:' + ip), fingerprint('email:' + email.toLowerCase())]);
    const { data, error } = await db!.rpc('consume_public_contact_limit', { p_ip_hash: ipHash, p_email_hash: emailHash });
    if (error) { console.error('public-contact rate limit unavailable', error.code); throw new Error('rate_limit_unavailable'); }
    return data === true;
  },
  sendEmail: async (message: { requestId: string; replyTo: string; subject: string; text: string; html: string }) => {
    const body = JSON.stringify({ from, to: ['contact@digitalprojectagency.fr'], reply_to: message.replyTo, subject: message.subject, text: message.text, html: message.html });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { authorization: 'Bearer ' + resendKey, 'content-type': 'application/json', 'idempotency-key': 'dpa-public-contact/' + message.requestId },
        body,
      });
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      if (!response.ok) console.error('public-contact email status', response.status);
      await response.body?.cancel();
      return { ok: response.ok, status: response.status };
    }
    return { ok: false, status: 503 };
  },
}));
