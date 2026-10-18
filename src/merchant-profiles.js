export const profileKey = userId => `dpa.profile.${userId}`;

export function rememberedProfile(storage, userId, memberships) {
  let saved;
  try { saved = storage.getItem(profileKey(userId)); } catch {}
  return memberships.find(m => m.merchant_id === saved) || memberships[0] || null;
}

export function rememberProfile(storage, userId, merchantId) {
  try { storage.setItem(profileKey(userId), merchantId); } catch {}
}

// The workspace context is immutable during a page lifetime. Switching profiles
// destroys the old React runtime, forms, QR/photo/scanner state and pending UI
// callbacks. Requests already sent retain the old commerce's explicit context.
export function changeProfile(storage, location, userId, merchantId, memberships) {
  if (!memberships.some(m => m.merchant_id === merchantId)) throw new Error('forbidden');
  rememberProfile(storage, userId, merchantId);
  location.replace('/');
}
