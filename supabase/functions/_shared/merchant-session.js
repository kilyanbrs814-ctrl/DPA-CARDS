// Only use this after Supabase Auth has validated this exact access token.
export function merchantSessionError(user, verifiedToken) {
  if (!user.email_confirmed_at) return 'email_unconfirmed';
  if (!user.factors?.some(factor => factor.status === 'verified')) return null;
  try {
    const payload = verifiedToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    if (JSON.parse(atob(payload)).aal === 'aal2') return null;
  } catch {
    // A malformed token must never satisfy the second-factor check.
  }
  return 'mfa_required';
}
