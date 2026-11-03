// Only use this after Supabase Auth has validated this exact access token.
export function hasVerifiedSecondFactor(verifiedToken) {
  try {
    const payload = verifiedToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).aal === 'aal2';
  } catch {
    return false;
  }
}

export function merchantSessionError(user, verifiedToken) {
  if (!user.email_confirmed_at) return 'email_unconfirmed';
  if (user.factors?.some(factor => factor.status === 'verified') && !hasVerifiedSecondFactor(verifiedToken)) {
    return 'mfa_required';
  }
  return null;
}
