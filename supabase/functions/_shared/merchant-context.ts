// The header selects context, never grants access. Every Edge route validates
// membership. Older signed iOS builds omit the header; when an owner gains new
// profiles, pin the old build to the original merchant instead of breaking it.
export function walletUserHeaders(req: Request): Record<string, string> {
  const selected = req.headers.get('x-merchant-id');
  return {
    Authorization: req.headers.get('authorization') ?? '',
    // Explicit selection needs the web membership view in internal PostgREST
    // requests too. This never bypasses auth.uid() or route membership checks.
    ...(selected ? {'x-merchant-id': selected, 'x-dpa-web-profiles': '1'} : {}),
  };
}

export async function selectedMembership(admin: any, req: Request, userId: string) {
  const selected = req.headers.get('x-merchant-id');
  const { data, error } = await admin.from('merchant_members')
    .select('merchant_id, role').eq('user_id', userId);
  if (error || !data?.length) return null;
  if (selected) return data.find((m: any) => m.merchant_id === selected) ?? null;
  if (data.length === 1) return data[0];

  // No heuristic "first commerce": only the persisted billing-account primary.
  const { data: account, error: accountError } = await admin
    .from('merchant_billing_accounts')
    .select('primary_merchant_id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (accountError || !account?.primary_merchant_id) return null;
  return data.find((m: any) => m.merchant_id === account.primary_merchant_id) ?? null;
}
