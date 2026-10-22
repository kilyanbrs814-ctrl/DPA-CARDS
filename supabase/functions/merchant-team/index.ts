// DPA Cards — invitations d'employés, indépendantes de la facturation et de Wallet.
// Un propriétaire authentifié peut inviter un collaborateur uniquement dans son commerce.
// La clé secrète Supabase et le lien d'activation ne sont jamais renvoyés au navigateur.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail } from '../_shared/email.ts';
import { employeeInvitationMail } from '../_shared/employee-invite-mail.js';

const url = Deno.env.get('SUPABASE_URL')!;
function envKey(jsonVar: string, fallback: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(jsonVar) || '{}');
    if (typeof keys.default === 'string') return keys.default;
  } catch { /* legacy configuration */ }
  return Deno.env.get(fallback) || '';
}
const admin = createClient(url, envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const site = 'https://cards.digitalprojectagency.fr';
const allowedOrigins = [site, 'capacitor://localhost', 'http://localhost:5173', 'http://localhost:5174'];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return allowedOrigins.includes(origin)
    ? { 'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-merchant-id',
        'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' }
    : {};
}
function reply(req: Request, status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', ...cors(req) },
  });
}
class AppError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
async function invite(req: Request) {
  if (!Deno.env.get('RESEND_API_KEY') || !Deno.env.get('EMAIL_FROM'))
    throw new AppError(503, 'employee_email_not_configured');

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!bearer) throw new AppError(401, 'not_authenticated');
  const { data: identity, error: authError } = await admin.auth.getUser(bearer[1]);
  if (authError || !identity?.user) throw new AppError(401, 'not_authenticated');
  const merchantId = req.headers.get('x-merchant-id') || '';
  if (!uuidRe.test(merchantId)) throw new AppError(400, 'merchant_required');
  const { data: membership, error: membershipError } = await admin.from('merchant_members')
    .select('role, merchants(business_name)').eq('merchant_id', merchantId)
    .eq('user_id', identity.user.id).maybeSingle();
  if (membershipError) throw new AppError(500, 'employee_membership_error');
  if (membership?.role !== 'owner') throw new AppError(403, 'owner_only');

  const { data: access, error: accessError } = await admin.rpc('merchant_has_access', { p_merchant: merchantId });
  if (accessError || access !== true) throw new AppError(403, 'program_unavailable');

  const payload = await req.json().catch(() => ({}));
  const first = String(payload?.first || '').trim();
  const email = String(payload?.email || '').trim().toLowerCase();
  if (!first || first.length > 80) throw new AppError(422, 'employee_first_invalid');
  if (!emailRe.test(email) || email.length > 254) throw new AppError(422, 'employee_email_invalid');
  if (email === identity.user.email?.toLowerCase()) throw new AppError(409, 'employee_self_invite');

  // Auth issues a one-use invite link (new user) or a recovery/set-password link
  // (existing user). Neither option changes an existing account's password itself.
  let isNew = true;
  let generated = await admin.auth.admin.generateLink({
    type: 'invite', email, options: { redirectTo: site + '/' },
  });
  if (generated.error) {
    if (!/already|registered|exists/i.test(String(generated.error.message || '')))
      throw new AppError(502, 'employee_invite_link_failed');
    isNew = false;
    generated = await admin.auth.admin.generateLink({
      type: 'recovery', email, options: { redirectTo: site + '/' },
    });
  }
  const memberId = generated.data?.user?.id;
  const actionLink = generated.data?.properties?.action_link;
  if (generated.error || !memberId || !actionLink) throw new AppError(502, 'employee_invite_link_failed');

  const { data: already, error: alreadyError } = await admin.from('merchant_members')
    .select('role').eq('merchant_id', merchantId).eq('user_id', memberId).maybeSingle();
  if (alreadyError) throw new AppError(500, 'employee_membership_error');
  if (already?.role === 'owner') throw new AppError(409, 'employee_already_owner');

  let inserted = false;
  if (!already) {
    const { error: insertError } = await admin.from('merchant_members').insert({
      merchant_id: merchantId, user_id: memberId, role: 'staff',
    });
    if (insertError) {
      if (insertError.code !== '23505') throw new AppError(500, 'employee_membership_error');
    } else inserted = true;
  }

  const merchant = (membership.merchants as { business_name?: string } | null)?.business_name || 'votre commerce';
  const mail = employeeInvitationMail({ first, merchant, actionLink });
  const result = await sendEmail({
    to: email, subject: 'Invitation DPA Cards — ' + merchant, text: mail.text, html: mail.html,
  });
  if (!result.sent) {
    // Do not leave an unsolicited access grant when the invitation could not be sent.
    if (inserted) {
      await admin.from('merchant_members').delete().eq('merchant_id', merchantId).eq('user_id', memberId);
      if (isNew) await admin.auth.admin.deleteUser(memberId).catch(() => undefined);
    }
    throw new AppError(502, 'employee_email_failed');
  }
  return { sent: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/merchant-team/invite'))
    return reply(req, 404, { error: 'not_found' });
  try {
    return reply(req, 200, await invite(req));
  } catch (error) {
    if (error instanceof AppError) return reply(req, error.status, { error: error.code });
    console.error('merchant-team invite failed', error instanceof Error ? error.name : 'unknown');
    return reply(req, 500, { error: 'employee_invite_failed' });
  }
});
