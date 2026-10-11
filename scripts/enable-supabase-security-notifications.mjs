// DPA Cards — active uniquement les 7 notifications de sécurité Supabase.
// Aucun modèle, aucune URL et aucun paramètre SMTP ne sont modifiés.
// Prérequis : Node.js 18+, variable SUPABASE_ACCESS_TOKEN configurée de manière sécurisée.
// node scripts/enable-supabase-security-notifications.mjs           -> simulation
// node scripts/enable-supabase-security-notifications.mjs --apply  -> publication
const PROJECT_REF = 'fiuffxchvjcghcvfaout';
const URL = 'https://api.supabase.com/v1/projects/' + PROJECT_REF + '/config/auth';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN absent : aucune modification effectuée.');
  process.exit(1);
}

const notificationTypes = [
  'password_changed',
  'email_changed',
  'phone_changed',
  'mfa_factor_enrolled',
  'mfa_factor_unenrolled',
  'identity_linked',
  'identity_unlinked',
];
const fields = notificationTypes.map(t => 'mailer_notifications_' + t + '_enabled');

async function api(method, body) {
  const response = await fetch(URL, {
    method,
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Supabase ' + response.status + ': ' + JSON.stringify(data).slice(0, 600));
  return data;
}

try {
  const current = await api('GET');
  const missing = fields.filter(field => typeof current[field] !== 'boolean');
  if (missing.length) {
    throw new Error('Champs absents ou inattendus. Rien ne sera changé : ' + missing.join(', '));
  }
  const inactive = fields.filter(field => current[field] === false);
  const missingModels = notificationTypes.filter(type => (
    !String(current['mailer_subjects_' + type + '_notification'] || '').trim() ||
    !String(current['mailer_templates_' + type + '_notification_content'] || '').includes('dpa-cards-logo.png')
  ));
  if (missingModels.length) {
    throw new Error('Modèles personnalisés manquants ou incomplets : ' + missingModels.join(', '));
  }
  console.log('État actuel : ' + fields.map(f => f + '=' + current[f]).join(', '));
  console.log(inactive.length + ' notification(s) à activer.');
  if (!process.argv.includes('--apply')) {
    console.log('SIMULATION : aucune configuration modifiée. Relancez avec --apply.');
    process.exit(0);
  }
  if (inactive.length === 0) {
    console.log('Les 7 notifications sont déjà activées.');
    process.exit(0);
  }
  const {writeFile} = await import('node:fs/promises');
  const backup = {};
  for (const field of fields) backup[field] = current[field];
  const filename = 'supabase-email-backup-security-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  await writeFile(filename, JSON.stringify(backup, null, 2), {mode: 0o600});
  console.log('Sauvegarde locale : ' + filename);
  await api('PATCH', Object.fromEntries(inactive.map(field => [field, true])));
  const after = await api('GET');
  const notEnabled = fields.filter(field => after[field] !== true);
  if (notEnabled.length) throw new Error('Activation non confirmée : ' + notEnabled.join(', '));
  const otherFieldsChanged = Object.keys(current).filter(key => {
    if (fields.includes(key)) return false;
    return JSON.stringify(current[key]) !== JSON.stringify(after[key]);
  });
  if (otherFieldsChanged.length) {
    console.warn('ATTENTION : d’autres champs ont changé côté Supabase : ' + otherFieldsChanged.join(', '));
    process.exitCode = 2;
  } else {
    console.log('Succès : 7/7 notifications activées. Aucune autre configuration modifiée.');
  }
  console.log('La livraison réelle ne sera vérifiée que lors des tests de parcours.');
} catch (e) {
  console.error('Échec : ' + e.message);
  process.exitCode = 1;
}
