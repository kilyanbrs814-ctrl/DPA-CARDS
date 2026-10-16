// Use explicit scoped queries instead of relying on an embedded relationship.
export async function workspaceIdentity(client,user) {
 const {data:member,error}=await client.from('merchant_members').select('role, merchant_id').eq('user_id',user.id).maybeSingle();
 if(error)throw Object.assign(new Error('workspace_members_unavailable'),{cause:error,code:error.code});
 if(!member)return null;
 const {data:merchant,error:me}=await client.from('merchants').select('*').eq('id',member.merchant_id).single();
 if(me)throw Object.assign(new Error('workspace_merchant_unavailable'),{cause:me,code:me.code});
 return {role:member.role,merchants:merchant};
}
