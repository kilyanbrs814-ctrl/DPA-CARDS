// A stable, unguessable per-card credential derived from the existing Apple
// signing key. No new signing material is exposed to clients or the database.
// This is deliberately independent from the short-lived download link.
const enc = new TextEncoder();
export const passTypeId = 'pass.fr.digitalprojectagency.cards';
export function passServiceUrl(supabaseUrl) {
  return String(supabaseUrl).replace(/\/$/, '') + '/functions/v1/apple-pass';
}
export async function passAuthToken(cardId, signerPrivateKey) {
  if (!signerPrivateKey || !/PRIVATE KEY-----/.test(signerPrivateKey)) throw new Error('apple_signer_missing');
  const key = await crypto.subtle.importKey('raw', enc.encode(signerPrivateKey.replace(/\\n/g, '\n')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('DPA-CARDS:PASSKIT:V1:' + cardId)));
  return Array.from(signature, b => b.toString(16).padStart(2, '0')).join('');
}
export function validPassToken(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
