// Use explicit scoped queries instead of relying on an embedded relationship.
import { rememberedProfile, rememberProfile } from './merchant-profiles.js';
export async function workspaceIdentity(client,user,storage=globalThis.localStorage) {
 const {data:members,error}=await client.from('merchant_members').select('role, merchant_id, created_at').eq('user_id',user.id).order('created_at');
 if(error)throw Object.assign(new Error('workspace_members_unavailable'),{cause:error,code:error.code});
 const member=rememberedProfile(storage,user.id,members||[]);
 if(!member)return null;
 const {data:merchant,error:me}=await client.from('merchants').select('*').eq('id',member.merchant_id).single();
 if(me)throw Object.assign(new Error('workspace_merchant_unavailable'),{cause:me,code:me.code});
 rememberProfile(storage,user.id,merchant.id);
 return {role:member.role,merchants:merchant,memberships:members};
}
