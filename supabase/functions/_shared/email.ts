// DPA Cards — transactional e-mail (server side only).
//
// The project had no e-mail service (Supabase Auth only sends its own login e-mails).
// This helper uses the Resend HTTP API once two Edge Function secrets exist:
//   RESEND_API_KEY  API key of the Resend account
//   EMAIL_FROM      verified sender, e.g. "DPA Cards <notifications@digitalprojectagency.fr>"
// Optional: DESIGN_ALERT_EMAIL (defaults to contact@digitalprojectagency.fr).
// Without them nothing is sent and the caller gets { sent: false, error: 'email_not_configured' },
// which is stored on the design request so the admin sees it. Keys never reach the browser.

export const ADMIN_ALERT_EMAIL = Deno.env.get('DESIGN_ALERT_EMAIL') ?? 'contact@digitalprojectagency.fr';

export async function sendEmail(msg: { to: string; subject: string; text: string; html?: string; replyTo?: string }): Promise<{ sent: boolean; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('EMAIL_FROM');
  if (!key || !from) return { sent: false, error: 'email_not_configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { sent: false, error: `email_${r.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String((e as Error).message || 'email_failed').slice(0, 120) };
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Plain-text + minimal HTML from label/value pairs and optional links.
export function simpleMail(title: string, rows: [string, string | null | undefined][], links: [string, string][] = []) {
  const lines = rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k} :\n${v}\n`);
  const text = `${title}\n\n${lines.join('\n')}${links.length ? '\n' + links.map(([k, u]) => `${k} : ${u}`).join('\n') + '\n' : ''}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1C1F24;line-height:1.5"><p style="font-size:17px;font-weight:bold">${esc(title)}</p>`
    + rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<p style="margin:0 0 10px"><span style="color:#5E636B">${esc(k)}</span><br>${esc(v).replace(/\n/g, '<br>')}</p>`).join('')
    + (links.length ? '<p>' + links.map(([k, u]) => `<a href="${esc(u)}">${esc(k)}</a>`).join('<br>') + '</p>' : '') + '</div>';
  return { text, html };
}
