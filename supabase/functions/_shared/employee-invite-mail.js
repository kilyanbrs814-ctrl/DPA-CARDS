// Invitation d'employé DPA Cards — même identité visuelle que l'e-mail de confirmation.
// HTML à tableaux et styles intégrés pour Gmail, Apple Mail et les clients mobiles.
// L'URL d'activation reste privée : elle n'est incluse que dans l'e-mail du destinataire.

const LOGO_URL = 'https://cards.digitalprojectagency.fr/assets/dpa-cards-logo.png';

function escapeHtml(input) {
  return String(input ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function employeeInvitationMail({ first, merchant, actionLink }) {
  const safeFirst = escapeHtml(first);
  const safeMerchant = escapeHtml(merchant);
  const safeLink = escapeHtml(actionLink);
  const text = [
    'DPA CARDS — INVITATION EMPLOYÉ',
    'Bonjour ' + first + ',',
    'Vous avez été invité(e) à rejoindre l’équipe de ' + merchant + ' sur DPA Cards.',
    'Créez votre mot de passe pour accéder à votre espace employé :',
    actionLink,
    'Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.',
    'DPA Cards — https://cards.digitalprojectagency.fr',
  ].join('\n\n');

  const html = [
    '<!doctype html><html lang="fr"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="dark light">',
    '<meta name="supported-color-schemes" content="dark light">',
    '<style>',
    '@media only screen and (max-width:620px){.mail-padding{padding:24px 18px!important}.mail-title{font-size:30px!important}.mail-header{padding:26px 18px 10px!important}.mail-footer{padding:18px!important}}',
    '</style></head>',
    '<body style="margin:0;padding:0;width:100%;background-color:#242428;color:#f7f6fb;font-family:Arial,Helvetica,sans-serif">',
    '<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;max-height:0;overflow:hidden;mso-hide:all">',
    'Vous êtes invité(e) à rejoindre l’équipe de ' + safeMerchant + ' sur DPA Cards.',
    '</div>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#242428" style="border-collapse:collapse;background-color:#242428">',
    '<tr><td align="center" style="padding:28px 12px 36px">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;max-width:600px;background-color:#202125;border:1px solid #34343a;border-radius:22px;overflow:hidden">',
    '<tr><td class="mail-header" align="center" style="padding:36px 28px 14px;background-color:#202125">',
    '<img src="' + LOGO_URL + '" alt="DPA Cards" width="246" border="0" style="display:block;width:246px;max-width:100%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none">',
    '</td></tr>',
    '<tr><td class="mail-padding" style="padding:30px 46px 42px;background-color:#202125">',
    '<p style="margin:0 0 16px;text-align:center;font-size:12px;font-weight:700;letter-spacing:2.1px;line-height:1.7;color:#b5adff">BIENVENUE SUR DPA CARDS</p>',
    '<h1 class="mail-title" style="margin:0 0 28px;text-align:center;color:#ffffff;font-size:38px;font-weight:800;line-height:1.17;letter-spacing:-0.7px">Rejoignez votre<br>équipe sur DPA Cards</h1>',
    '<p style="margin:0 0 18px;font-size:20px;font-weight:700;line-height:1.5;color:#ffffff">Bonjour ' + safeFirst + ',</p>',
    '<p style="margin:0 0 18px;font-size:17px;line-height:1.75;color:#c8c9d2">Vous avez été invité(e) à rejoindre l’équipe de <strong style="color:#ffffff;overflow-wrap:anywhere;word-break:break-word">' + safeMerchant + '</strong> sur DPA Cards.</p>',
    '<p style="margin:0 0 28px;font-size:17px;line-height:1.75;color:#c8c9d2">Pour accéder à votre espace employé, choisissez votre mot de passe en cliquant sur le bouton ci-dessous.</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate"><tr><td align="center" bgcolor="#9e96f3" style="border-radius:15px;background-color:#9e96f3">',
    '<a href="' + safeLink + '" target="_blank" style="display:block;padding:21px 14px;border-radius:15px;background-color:#9e96f3;color:#191820;text-decoration:none;text-align:center;font-size:18px;font-weight:800;line-height:1.35">Créer mon mot de passe <span aria-hidden="true" style="font-size:22px">&rarr;</span></a>',
    '</td></tr></table>',
    '<p style="margin:25px 0 0;font-size:13px;line-height:1.65;text-align:center;color:#9597a3">Ce lien est personnel et sécurisé. Ne le partagez pas.</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:27px"><tr><td style="border-top:1px solid #393940;padding-top:22px">',
    '<p style="margin:0 0 12px;font-size:13px;line-height:1.65;color:#a3a4b0">Le bouton ne fonctionne pas ? <a href="' + safeLink + '" style="color:#b4a9ff;text-decoration:underline">Ouvrir le lien d’invitation</a>.</p>',
    '<p style="margin:0;font-size:13px;line-height:1.65;color:#858792">Si vous n’attendiez pas cette invitation, vous pouvez ignorer cet e-mail.</p>',
    '</td></tr></table>',
    '</td></tr>',
    '</table>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px">',
    '<tr><td class="mail-footer" align="center" style="padding:22px 20px;font-size:12px;line-height:1.8;color:#91929b">',
    'DPA Cards &middot; Cartes de fidélité digitales<br>',
    '<a href="https://cards.digitalprojectagency.fr" style="color:#a9a0f6;text-decoration:none">cards.digitalprojectagency.fr</a>',
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');
  return { text, html };
}
