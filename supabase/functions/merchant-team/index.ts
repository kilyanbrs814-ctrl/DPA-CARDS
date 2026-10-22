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
      merchant_id: merchantId, user_id: memberId, role: 'staff', permissions: { scan: true, add_clients: false, rewards: false, corrections: false, notifications: false },
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
  const { error: trackError } = await admin.from('employee_invitations').upsert({
    merchant_id: merchantId, user_id: memberId, email, first_name: first,
    invited_by: identity.user.id, invited_at: new Date().toISOString(),
  }, { onConflict: 'merchant_id,user_id' });
  if (trackError) console.error('employee invitation tracking failed', trackError.code);
  return { sent: true };
}


type TeamMember = { user_id: string; created_at: string; permissions: Record<string,boolean> };
type Invitation = { user_id: string; first_name: string; email: string; invited_at: string };
type Visit = { card_id: string; type: string; created_at: string; created_by: string | null; corrects_event_id: string | null; id: string };
type Card = { id: string; customer_id: string };
type Customer = { id: string; created_by: string | null };
type Scan = { event_id: string; user_id: string };

async function rows(table: string, fields: string, merchantId: string): Promise<any[]> {
  const out: any[] = [];
  for (let start = 0; start < 100000; start += 1000) {
    const {data,error} = await admin.from(table).select(fields).eq('merchant_id',merchantId)
      .order(({employee_invitations:'user_id',employee_scan_validations:'event_id'} as Record<string,string>)[table] || 'id', { ascending: true }).range(start,start+999);
    if(error) throw new AppError(500, 'team_stats_unavailable');
    out.push(...(data||[]));
    if (!data || data.length<1000) return out;
  }
  // Never show inaccurate totals as if they were complete.
  throw new AppError(503,'team_stats_too_large');
}
async function teamList(req: Request) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!bearer) throw new AppError(401, 'not_authenticated');
  const { data: who, error: ae } = await admin.auth.getUser(bearer[1]);
  if (ae || !who?.user) throw new AppError(401, 'not_authenticated');
  const merchantId = req.headers.get('x-merchant-id') || '';
  if (!uuidRe.test(merchantId)) throw new AppError(400, 'merchant_required');
  const { data: owner, error: me } = await admin.from('merchant_members')
    .select('role').eq('merchant_id',merchantId).eq('user_id',who.user.id).maybeSingle();
  if (me) throw new AppError(500,'employee_membership_error');
  if (owner?.role !== 'owner') throw new AppError(403,'owner_only');

  const [{data: staff,error: se}, invitations, events, cards, customers, scans] = await Promise.all([
    admin.from('merchant_members').select('user_id,created_at,permissions').eq('merchant_id',merchantId).eq('role','staff').limit(500),
    rows('employee_invitations','user_id,first_name,email,invited_at',merchantId),
    rows('card_events','id,card_id,type,created_by,created_at,corrects_event_id',merchantId),
    rows('cards','id,customer_id',merchantId),
    rows('customers','id,created_by',merchantId),
    rows('employee_scan_validations','event_id,user_id',merchantId),
  ]);
  if (se) throw new AppError(500,'employee_membership_error');
  const members = (staff || []) as TeamMember[];
  if (members.length >= 500) throw new AppError(503,'team_stats_too_large');
  const inviteById = new Map((invitations as Invitation[]).map(i => [i.user_id,i]));
  const customerByCard = new Map((cards as Card[]).map(c=>[c.id,c.customer_id]));
  const franceDay = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
  const corrected = new Set((events as Visit[]).filter(e=>e.type==='correction' && e.corrects_event_id).map(e=>e.corrects_event_id));
  const visits = (events as Visit[]).filter(e=>e.type==='visit' && !corrected.has(e.id));
  const validIds = new Set(visits.map(e=>e.id));
  const allScans = (scans as Scan[]).filter(v=>validIds.has(v.event_id));
  const active: any[] = [], pending: any[] = [];
  for (const membership of members) {
    const {data: lookup,error: ue} = await admin.auth.admin.getUserById(membership.user_id);
    if (ue || !lookup?.user) throw new AppError(500,'team_stats_unavailable');
    const account = lookup.user;
    const invitation = inviteById.get(membership.user_id);
    const invitedAt = invitation?.invited_at || membership.created_at;
    const lastSignIn = account.last_sign_in_at || '';
    const joined = !!lastSignIn && new Date(lastSignIn).getTime() >= new Date(invitedAt).getTime();
    const ownVisits = visits.filter(v=>v.created_by===membership.user_id);
    const ownScans = allScans.filter(v=>v.user_id===membership.user_id);
    const dayByCustomer = new Map<string, Set<string>>();
    for (const v of ownVisits) {
      const cid = customerByCard.get(v.card_id);
      if (!cid) continue;
      if (!dayByCustomer.has(cid)) dayByCustomer.set(cid,new Set());
      dayByCustomer.get(cid)!.add(franceDay.format(new Date(v.created_at)));
    }
    const item={
      id: membership.user_id,
      permissions: membership.permissions || { scan: true, add_clients: false, rewards: false, corrections: false, notifications: false },
      first: invitation?.first_name || String(account.user_metadata?.first_name || '').trim() || (account.email||'').split('@')[0],
      email: invitation?.email || account.email || '',
      invitedAt,
      stats: {
        scans: ownScans.length,
        uniqueScannedCards: new Set(ownScans.map(v=>visits.find(ev=>ev.id===v.event_id)?.card_id).filter(Boolean)).size,
        validatedVisits: ownVisits.length,
        addedClients: (customers as Customer[]).filter(c=>c.created_by===membership.user_id).length,
        recurringClients: [...dayByCustomer.values()].filter(days=>days.size>=2).length,
      },
    };
    (joined?active:pending).push(item);
  }
  const alpha=(a:any,b:any)=>a.first.localeCompare(b.first,'fr');
  active.sort(alpha);pending.sort((a,b)=>b.invitedAt.localeCompare(a.invitedAt));
  return { active,pending };
}


type ActionKind = 'resend' | 'change-email' | 'delete';

async function ownerForPending(req: Request, id: string) {
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!jwt) throw new AppError(401, 'not_authenticated');
  const {data: who,error: authError} = await admin.auth.getUser(jwt[1]);
  if (authError || !who?.user) throw new AppError(401,'not_authenticated');
  const merchantId = req.headers.get('x-merchant-id') || '';
  if (!uuidRe.test(merchantId) || !uuidRe.test(id)) throw new AppError(400,'invalid_request');
  const {data: owner,error: ownerError} = await admin.from('merchant_members')
    .select('role').eq('merchant_id',merchantId).eq('user_id',who.user.id).maybeSingle();
  if (ownerError) throw new AppError(500,'employee_membership_error');
  if (owner?.role !== 'owner') throw new AppError(403,'owner_only');
  const {data: membership,error: memberError} = await admin.from('merchant_members')
    .select('created_at,role').eq('merchant_id',merchantId).eq('user_id',id).maybeSingle();
  if (memberError) throw new AppError(500,'employee_membership_error');
  if (membership?.role !== 'staff') throw new AppError(404,'employee_pending_not_found');
  const [{data: target,error: targetError},{data: invitation,error: inviteError},{data: merchant,error: merchantError}] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin.from('employee_invitations').select('first_name,email,invited_at').eq('merchant_id',merchantId).eq('user_id',id).maybeSingle(),
    admin.from('merchants').select('business_name').eq('id',merchantId).single(),
  ]);
  if (targetError || !target?.user || inviteError || merchantError || !merchant) throw new AppError(500,'employee_membership_error');
  const invitedAt = invitation?.invited_at || membership.created_at;
  const signedIn = target.user.last_sign_in_at;
  if (signedIn && new Date(signedIn).getTime() >= new Date(invitedAt).getTime())
    throw new AppError(409,'employee_already_active');
  return {
    merchantId, actorId:who.user.id, targetId:id, originalEmail:(target.user.email||'').toLowerCase(),
    first:String(invitation?.first_name || target.user.user_metadata?.first_name || target.user.email?.split('@')[0] || 'Employé').trim().slice(0,80),
    business:merchant.business_name,
  };
}

async function generateEmployeeLink(email: string) {
  let link = await admin.auth.admin.generateLink({
    type:'invite',email,options:{redirectTo:site+'/'},
  });
  if (link.error && /already|registered|exists/i.test(link.error.message||'')) {
    link = await admin.auth.admin.generateLink({
      type:'recovery',email,options:{redirectTo:site+'/'},
    });
  }
  if (link.error || !link.data?.user?.id || !link.data?.properties?.action_link)
    throw new AppError(502,'employee_invite_link_failed');
  return {id:link.data.user.id,href:link.data.properties.action_link};
}
async function deliverInvitation(email:string, first:string, business:string, href:string) {
  if (!Deno.env.get('RESEND_API_KEY') || !Deno.env.get('EMAIL_FROM'))
    throw new AppError(503,'employee_email_not_configured');
  const mail = employeeInvitationMail({first,merchant:business,actionLink:href});
  const sent = await sendEmail({
    to:email,subject:'Invitation DPA Cards — '+business,text:mail.text,html:mail.html,
  });
  if (!sent.sent) throw new AppError(502,'employee_email_failed');
}

async function pendingAction(req:Request, action:ActionKind) {
  const body = await req.json().catch(()=>({}));
  const employeeId = String(body?.employeeId||'');
  const context = await ownerForPending(req,employeeId);
  const {merchantId,actorId,targetId,originalEmail,first,business} = context;
  if (action === 'delete') {
    const {data: gone,error: de} = await admin.from('merchant_members').delete()
      .eq('merchant_id',merchantId).eq('user_id',targetId).eq('role','staff')
      .select('user_id');
    if (de) throw new AppError(500,'employee_delete_failed');
    if (!gone?.length) throw new AppError(404,'employee_pending_not_found');
    const {error: cleanError} = await admin.from('employee_invitations').delete()
      .eq('merchant_id',merchantId).eq('user_id',targetId);
    if (cleanError) console.error('employee invitation cleanup failed',cleanError.code);
    // Intentionally do not delete auth.users: the account may belong to another commerce.
    return {deleted:true};
  }
  if (!originalEmail) throw new AppError(409,'employee_email_invalid');
  if (action === 'resend') {
    const link = await generateEmployeeLink(originalEmail);
    if (link.id !== targetId) throw new AppError(409,'employee_account_changed');
    await deliverInvitation(originalEmail,first,business,link.href);
    const {error: recordError} = await admin.from('employee_invitations').upsert({
      merchant_id:merchantId,user_id:targetId,email:originalEmail,first_name:first,
      invited_by:actorId,invited_at:new Date().toISOString(),
    },{onConflict:'merchant_id,user_id'});
    if (recordError) console.error('employee resend tracking failed',recordError.code);
    return {sent:true};
  }

  const nextEmail=String(body?.email||'').trim().toLowerCase();
  if (!emailRe.test(nextEmail) || nextEmail.length>254) throw new AppError(422,'employee_email_invalid');
  if (nextEmail === originalEmail) throw new AppError(409,'employee_email_unchanged');
  const link = await generateEmployeeLink(nextEmail);
  if (link.id === targetId) throw new AppError(409,'employee_email_unchanged');
  const {data: existing,error: exErr} = await admin.from('merchant_members')
    .select('role').eq('merchant_id',merchantId).eq('user_id',link.id).maybeSingle();
  if (exErr) throw new AppError(500,'employee_membership_error');
  if (existing) throw new AppError(409,'employee_target_already_member');
  const {error: addError} = await admin.from('merchant_members').insert({
    merchant_id:merchantId,user_id:link.id,role:'staff', permissions: { scan: true, add_clients: false, rewards: false, corrections: false, notifications: false },
  });
  if (addError) throw new AppError(500,'employee_membership_error');
  try {
    await deliverInvitation(nextEmail,first,business,link.href);
  } catch(error) {
    await admin.from('merchant_members').delete().eq('merchant_id',merchantId).eq('user_id',link.id);
    throw error;
  }
  const {error: recordError} = await admin.from('employee_invitations').upsert({
    merchant_id:merchantId,user_id:link.id,email:nextEmail,first_name:first,
    invited_by:actorId,invited_at:new Date().toISOString(),
  },{onConflict:'merchant_id,user_id'});
  if (recordError) console.error('employee address update tracking failed',recordError.code);
  const {error: revokeError} = await admin.from('merchant_members').delete()
    .eq('merchant_id',merchantId).eq('user_id',targetId).eq('role','staff');
  if (revokeError) throw new AppError(500,'employee_email_change_partial');
  const {error: cleanError} = await admin.from('employee_invitations').delete()
    .eq('merchant_id',merchantId).eq('user_id',targetId);
  if (cleanError) console.error('employee old invitation cleanup failed',cleanError.code);
  // Changing an invitation never changes or deletes the account behind the old email.
  return {changed:true};
}


const CAPABILITIES = ['scan','add_clients','rewards','corrections','notifications'] as const;

async function updatePermissions(req:Request) {
  const token=/^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!token) throw new AppError(401,'not_authenticated');
  const {data: identity,error:au}=await admin.auth.getUser(token);
  if(au || !identity?.user) throw new AppError(401,'not_authenticated');
  const mid=req.headers.get('x-merchant-id')||'';
  const body=await req.json().catch(()=>({}));
  const employeeId=String(body.employeeId||'');
  if(!uuidRe.test(mid)||!uuidRe.test(employeeId))throw new AppError(400,'invalid_request');
  const {data: owner,error:oe}=await admin.from('merchant_members').select('role')
    .eq('merchant_id',mid).eq('user_id',identity.user.id).maybeSingle();
  if(oe)throw new AppError(500,'employee_membership_error');
  if(owner?.role!=='owner')throw new AppError(403,'owner_only');
  const p=body.permissions;
  if(!p||typeof p!=='object'||Array.isArray(p)||
     Object.keys(p).length!==CAPABILITIES.length ||
     !CAPABILITIES.every(cap=>typeof p[cap]==='boolean'))
    throw new AppError(422,'employee_permissions_invalid');
  const {data: staff,error:se}=await admin.from('merchant_members')
    .update({permissions:Object.fromEntries(CAPABILITIES.map(k=>[k,p[k]]))})
    .eq('merchant_id',mid).eq('user_id',employeeId).eq('role','staff')
    .select('user_id,permissions').maybeSingle();
  if(se)throw new AppError(500,'employee_permissions_save_failed');
  if(!staff)throw new AppError(404,'employee_not_found');
  return {saved:true,permissions:staff.permissions};
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const route = new URL(req.url).pathname;
  const known=['invite','list','resend','change-email','delete','permissions'];
  const operation=known.find(name=>route.endsWith('/merchant-team/'+name));
  if (req.method !== 'POST' || !operation) return reply(req, 404, { error: 'not_found' });
  try {
    if (operation === 'invite') return reply(req,200,await invite(req));
    if (operation === 'list') return reply(req,200,await teamList(req));
    if (operation === 'permissions') return reply(req,200,await updatePermissions(req));
    return reply(req,200,await pendingAction(req,operation as ActionKind));
  } catch (error) {
    if (error instanceof AppError) return reply(req, error.status, { error: error.code });
    console.error('merchant-team operation failed', error instanceof Error ? error.name : 'unknown');
    return reply(req, 500, { error: 'employee_invite_failed' });
  }
});
