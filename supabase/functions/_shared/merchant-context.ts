// An identifier is context, never authorization. Every Edge route validates the
// membership on the server. Old single-commerce builds remain compatible.
export async function selectedMembership(admin: any, req: Request, userId: string) {
  const selected = req.headers.get('x-merchant-id');
  let q=admin.from('merchant_members').select('merchant_id, role').eq('user_id',userId);
  if(selected) q=q.eq('merchant_id',selected);
  const {data,error}=await q;
  if(error || !data?.length || data.length!==1) return null;
  return data[0];
}
