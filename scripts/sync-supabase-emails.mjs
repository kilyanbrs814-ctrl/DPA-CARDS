// DPA Cards — synchronisation de 12 modèles d'e-mails Supabase.
// Ne modifie PAS le modèle Reset Password déjà validé.
// Pré-requis : Node.js 18+ et variable SUPABASE_ACCESS_TOKEN.
// Utilisation : node scripts/sync-supabase-emails.mjs [--dry-run]
// Créer le jeton : https://supabase.com/dashboard/account/tokens
// Ne jamais commiter le jeton ni le transmettre dans un chat.
const PROJECT = 'fiuffxchvjcghcvfaout';
const API = 'https://api.supabase.com/v1/projects/' + PROJECT + '/config/auth';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN manquant. Aucun modèle modifié.');
  process.exit(1);
}

const LOGO = 'https://dpa-cards.vercel.app/assets/dpa-cards-logo.png';
// `with` instead of `if .Data.first_name`: no template execution error (and no unsent e-mail)
// when a template receives no metadata.
const HELLO = '{{ with .Data }}{{ with .first_name }}Bonjour {{ . }},{{ else }}Bonjour,{{ end }}{{ else }}Bonjour,{{ end }}';
const URL = '{{ .ConfirmationURL }}';
const SUPPORT = 'mailto:contact@digitalprojectagency.fr';

function render({ kicker, title, body, cta, url = URL, foot = '', code = false, alert = false }) {
  const action = code
    ? '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:26px auto"><tr><td align="center" style="background:#F0F3FF;border-radius:12px;padding:18px 30px;color:#2448F0;font-size:28px;font-weight:800;letter-spacing:4px">{{ .Token }}</td></tr></table>'
    : cta
      ? '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto"><tr><td align="center" bgcolor="#2448F0" style="border-radius:12px;background:#2448F0"><a href="' + url + '" style="display:inline-block;padding:17px 26px;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:24px;font-weight:700">' + cta + ' &rarr;</a></td></tr></table>'
      : '';
  return [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>',
    title, ' — DPA Cards</title></head><body style="margin:0;padding:0;background:#F6F5F1;font-family:Arial,Helvetica,sans-serif;color:#1F232B">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5F1;border-collapse:collapse"><tr><td align="center" style="padding:42px 16px;text-align:center">',
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border:1px solid #E8E7E2;border-radius:20px;border-collapse:separate;margin:0 auto">',
    '<tr><td align="center" style="padding:42px 24px 28px;text-align:center"><img src="', LOGO, '" alt="DPA Cards" width="190" style="display:block;width:190px;max-width:100%;height:auto;margin:0 auto;border:0"></td></tr>',
    '<tr><td align="center" style="padding:0 32px 42px;text-align:center">',
    '<p style="margin:0 0 17px;color:', alert ? '#B42318' : '#2448F0', ';font-size:12px;font-weight:700;letter-spacing:1.6px;text-align:center;text-transform:uppercase">', kicker, '</p>',
    '<h1 style="margin:0 0 25px;color:#1F232B;font-size:29px;line-height:1.3;letter-spacing:-.5px;text-align:center">', title, '</h1>',
    '<p style="margin:0 0 18px;color:#1F232B;font-size:17px;font-weight:700;line-height:1.65;text-align:center">', HELLO, '</p>',
    '<p style="margin:0;color:#4E5360;font-size:16px;line-height:1.75;text-align:center">', body, '</p>',
    action,
    foot ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px"><tr><td style="border-top:1px solid #E9E8E5;font-size:1px">&nbsp;</td></tr></table><p style="margin:22px 0 0;color:#727782;font-size:14px;line-height:1.7;text-align:center">' + foot + '</p>' : '',
    '</td></tr></table><p style="margin:22px 0 4px;color:#81848D;font-size:12px;line-height:1.6;text-align:center">DPA Cards — Digital Project Agency</p>',
    '<p style="margin:0;color:#9699A2;font-size:12px;line-height:1.6;text-align:center">Cet e-mail a été envoyé automatiquement. Merci de ne pas y répondre.</p>',
    '</td></tr></table></body></html>',
  ].join('');
}

const definitions = {
  confirmation: {
    subject: 'Confirmez votre adresse e-mail — DPA Cards',
    kicker: 'Bienvenue sur DPA Cards', title: 'Confirmez votre adresse e-mail',
    body: 'Merci de vous être inscrit sur DPA Cards. Confirmez votre adresse e-mail pour activer votre compte et accéder à votre espace commerçant.',
    cta: 'Confirmer mon adresse',
    foot: "Si vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.",
  },
  invite: {
    subject: 'Votre invitation à rejoindre DPA Cards',
    kicker: 'Invitation', title: 'Vous êtes invité sur DPA Cards',
    body: 'Vous avez été invité à rejoindre DPA Cards. Acceptez cette invitation pour accéder à votre espace.',
    cta: "Accepter l'invitation",
    foot: "Si vous n'attendiez pas cette invitation, ignorez cet e-mail.",
  },
  magic_link: {
    subject: 'Votre lien de connexion — DPA Cards',
    kicker: 'Connexion sécurisée', title: 'Votre lien de connexion',
    body: 'Vous avez demandé un lien pour vous connecter à DPA Cards. Cliquez sur le bouton pour accéder à votre espace.',
    cta: 'Accéder à mon espace',
    foot: "Ce lien est personnel et temporaire. Si vous n'avez pas demandé de connexion, ignorez cet e-mail.",
  },
  email_change: {
    subject: 'Confirmez votre nouvelle adresse e-mail — DPA Cards',
    kicker: 'Sécurité du compte', title: 'Confirmez votre nouvelle adresse',
    body: "Vous avez demandé à modifier l'adresse e-mail de votre compte DPA Cards. Nouvelle adresse : <strong>{{ .NewEmail }}</strong>. Confirmez ce changement ci-dessous.",
    cta: 'Confirmer cette adresse',
    foot: "Si vous n'êtes pas à l'origine de cette demande, ne cliquez pas sur le bouton et contactez notre assistance.",
  },
  reauthentication: {
    subject: 'Votre code de vérification — DPA Cards',
    kicker: 'Vérification de sécurité', title: 'Votre code de vérification',
    body: 'Pour confirmer cette opération sensible sur votre compte DPA Cards, utilisez le code ci-dessous.',
    code: true,
    foot: "Ce code est personnel et temporaire. Ne le communiquez à personne. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  },
  password_changed_notification: {
    subject: 'Votre mot de passe a été modifié — DPA Cards',
    kicker: 'Alerte de sécurité', title: 'Votre mot de passe a été modifié',
    body: 'Le mot de passe de votre compte DPA Cards vient d’être modifié.',
    cta: "Contacter l'assistance", url: SUPPORT, alert: true,
    foot: "Si vous avez effectué ce changement, aucune action n'est nécessaire. Sinon, contactez rapidement notre assistance.",
  },
  email_changed_notification: {
    subject: 'Votre adresse e-mail a été modifiée — DPA Cards',
    kicker: 'Alerte de sécurité', title: 'Votre adresse e-mail a été modifiée',
    body: "L'adresse e-mail de votre compte a été modifiée.<br><strong>Ancienne :</strong> {{ .OldEmail }}<br><strong>Nouvelle :</strong> {{ .Email }}",
    cta: "Contacter l'assistance", url: SUPPORT, alert: true,
    foot: "Si vous n'avez pas demandé ce changement, contactez rapidement notre assistance.",
  },
  phone_changed_notification: {
    subject: 'Votre numéro de téléphone a été modifié — DPA Cards',
    kicker: 'Alerte de sécurité', title: 'Votre numéro de téléphone a été modifié',
    body: 'Le numéro de téléphone de votre compte a été modifié.<br><strong>Ancien :</strong> {{ .OldPhone }}<br><strong>Nouveau :</strong> {{ .Phone }}',
    cta: "Contacter l'assistance", url: SUPPORT, alert: true,
    foot: "Si vous n'avez pas demandé ce changement, contactez rapidement notre assistance.",
  },
  mfa_factor_enrolled_notification: {
    subject: 'Nouvelle méthode de vérification — DPA Cards',
    kicker: 'Sécurité du compte', title: 'Nouvelle méthode de vérification',
    body: 'Une méthode de vérification (<strong>{{ .FactorType }}</strong>) a été ajoutée à votre compte DPA Cards.',
    cta: "Contacter l'assistance", url: SUPPORT, alert: true,
    foot: "Si vous n'avez pas effectué cet ajout, contactez rapidement notre assistance.",
  },
  mfa_factor_unenrolled_notification: {
    subject: 'Méthode de vérification supprimée — DPA Cards',
    kicker: 'Alerte de sécurité', title: 'Une méthode de vérification a été supprimée',
    body: 'Une méthode de vérification (<strong>{{ .FactorType }}</strong>) a été supprimée de votre compte DPA Cards.',
    cta: "Contacter l'assistance", url: SUPPORT, alert: true,
    foot: "Si vous n'avez pas effectué cette suppression, contactez rapidement notre assistance.",
  },
  identity_linked_notification: {
    subject: 'Nouvelle méthode de connexion — DPA Cards',
    kicker: 'Sécurité du compte', title: 'Nouvelle méthode de connexion',
    body: 'Une méthode de connexion (<strong>{{ .Provider }}</strong>) a été associée à votre compte DPA Cards.',
    cta: "Contacter l'assistance", url: SUPPORT, alert: true,
    foot: "Si vous n'avez pas effectué cet ajout, contactez rapidement notre assistance.",
  },
  identity_unlinked_notification: {
    subject: 'Méthode de connexion supprimée — DPA Cards',
    kicker: 'Alerte de sécurité', title: 'Une méthode de connexion a été supprimée',
    body: 'Une méthode de connexion (<strong>{{ .Provider }}</strong>) a été retirée de votre compte DPA Cards.',
    cta: "Contacter l'assistance", url: SUPPORT, alert: true,
    foot: "Si vous n'avez pas effectué ce retrait, contactez rapidement notre assistance.",
  },
};

const payload = {};
for (const [key, definition] of Object.entries(definitions)) {
  const { subject, ...template } = definition;
  const html = render(template);
  if (!html.includes(LOGO) || !html.includes(HELLO)) throw new Error('Modèle incomplet : ' + key);
  if (['confirmation', 'invite', 'magic_link', 'email_change'].includes(key) && !html.includes(URL)) throw new Error('Lien manquant : ' + key);
  if (key === 'reauthentication' && !html.includes('{{ .Token }}')) throw new Error('Code manquant');
  payload['mailer_subjects_' + key] = subject;
  payload['mailer_templates_' + key + '_content'] = html;
}
if (Object.keys(definitions).length !== 12) throw new Error('Le nombre de modèles doit être de 12');

async function request(method, data) {
  const response = await fetch(API, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Erreur Supabase ' + response.status + ' : ' + JSON.stringify(result).slice(0, 1200));
  return result;
}

try {
  const before = await request('GET');
  const backup = {};
  for (const key of Object.keys(payload)) backup[key] = before[key] ?? null;
  const { writeFile } = await import('node:fs/promises');
  const name = 'supabase-email-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  await writeFile(name, JSON.stringify(backup, null, 2), { mode: 0o600 });
  console.log('Sauvegarde locale : ' + name);
  if (process.argv.includes('--dry-run')) {
    console.log('Simulation : aucun changement publié.');
    console.log(Object.keys(definitions).join(', '));
    process.exit(0);
  }
  await request('PATCH', payload);
  const after = await request('GET');
  const differences = Object.keys(payload).filter(key => after[key] !== payload[key]);
  if (differences.length) throw new Error('Vérification incomplète : ' + differences.join(', '));
  console.log('12 modèles publiés et vérifiés. Reset Password conservé.');
  console.log('Les notifications actuellement désactivées restent désactivées.');
} catch (error) {
  console.error('Échec : ' + error.message);
  process.exitCode = 1;
}
