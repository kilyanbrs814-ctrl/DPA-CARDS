// Password recovery authenticates the email link, not a regular password login.
// Establish a fresh password session before loading the merchant workspace.
export async function completePasswordSetup(auth, password) {
  const updated = await auth.updateUser({ password });
  if (updated.error) return { error: updated.error };
  const email = updated.data?.user?.email || '';
  try {
    if (email) {
      const signed = await auth.signInWithPassword({ email, password });
      if (!signed.error && signed.data?.session) return { error: null, email, session: signed.data.session };
    }
  } catch { /* The password is saved; a network issue must not report it as failed. */ }
  await auth.signOut({ scope: 'local' }).catch(() => {});
  return { error: null, email, session: null };
}
