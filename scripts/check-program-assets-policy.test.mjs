import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const patch=read('supabase/migrations/20261026220410_fix_program_asset_profile_scope.sql');
const ids={owner:'10000000-0000-4000-8000-000000000001',other:'10000000-0000-4000-8000-000000000002',staff:'10000000-0000-4000-8000-000000000003',
  a:'20000000-0000-4000-8000-000000000001',b:'20000000-0000-4000-8000-000000000002',c:'20000000-0000-4000-8000-000000000003',
  pa:'30000000-0000-4000-8000-000000000001',pb:'30000000-0000-4000-8000-000000000002',pc:'30000000-0000-4000-8000-000000000003',pv:'30000000-0000-4000-8000-000000000004'};
const path=(m,p,file='logo-test.png')=>`${m}/${p}/${file}`;

test('secondary draft upload works without web headers while tenant isolation and validated locks remain enforced',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;
      create schema auth;create schema app_private;create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.test_uid',true),'')::uuid$$;
      create table public.merchant_members(merchant_id uuid,user_id uuid,role text,created_at int,primary key(merchant_id,user_id));
      create table public.programs(id uuid primary key,merchant_id uuid,design_status text,logo_path text,hero_path text);
      create table storage.objects(name text primary key,bucket_id text);
      create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
      create function app_private.legacy_primary_merchant(p_user uuid) returns uuid language sql stable security definer set search_path='' as $$
        select mm.merchant_id from public.merchant_members mm where mm.user_id=p_user order by mm.created_at limit 1$$;
      alter table public.merchant_members enable row level security;
      create policy merchant_members_select on public.merchant_members for select to authenticated using (
        user_id=(select auth.uid()) and (coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-dpa-web-profiles','')='1'
        or merchant_id=app_private.legacy_primary_merchant((select auth.uid()))));
      alter table public.programs enable row level security;
      create policy programs_select on public.programs for select to authenticated using (merchant_id in (select merchant_id from public.merchant_members where user_id=(select auth.uid())));
      alter table storage.objects enable row level security;
      grant usage on schema auth,storage,app_private to authenticated,anon;
      grant select on public.merchant_members,public.programs to authenticated;
      grant select,insert,delete,update on storage.objects to authenticated;
      insert into public.merchant_members values('${ids.a}','${ids.owner}','owner',1),('${ids.b}','${ids.owner}','owner',2),('${ids.c}','${ids.other}','owner',1),('${ids.b}','${ids.staff}','staff',1);
      insert into public.programs values('${ids.pa}','${ids.a}','draft',null,null),('${ids.pb}','${ids.b}','draft','${path(ids.b,ids.pb,'logo-current.png')}',null),
        ('${ids.pc}','${ids.c}','draft',null,null),('${ids.pv}','${ids.b}','validated','${path(ids.b,ids.pv)}',null);
      insert into storage.objects values('${path(ids.b,ids.pb,'logo-current.png')}','program-assets'),('${path(ids.b,ids.pv)}','program-assets');`);
    const original=read('supabase/migrations/20261003083359_program_design.sql');
    await db.exec(original.slice(original.indexOf('create policy program_assets_insert'),original.indexOf('create policy design_requests_files_insert')));
    const actor=async user=>db.exec(`reset role;set role authenticated;set request.test_uid='${user}';set request.headers='{}';`);
    const upload=async name=>db.query("insert into storage.objects(name,bucket_id) values($1,'program-assets') returning name",[name]);
    await actor(ids.owner);
    await assert.rejects(upload(path(ids.b,ids.pb)),/row-level security/,'Reproduce the reported second-commerce failure');
    await db.exec('reset role;');await db.exec(patch);await actor(ids.owner);
    assert.equal((await upload(path(ids.b,ids.pb))).rows[0].name,path(ids.b,ids.pb));
    assert.deepEqual((await db.query('select merchant_id from public.merchant_members')).rows.map(r=>r.merchant_id),[ids.a],'Legacy membership visibility stays unchanged');
    assert.equal((await upload(path(ids.a,ids.pa))).rows.length,1,'Primary commerce still works');
    await assert.rejects(upload(path(ids.c,ids.pc)),/row-level security/,'Other owners stay isolated');
    await assert.rejects(upload(path(ids.b,ids.pa)),/row-level security/,'Merchant/program path mismatch stays forbidden');
    await assert.rejects(upload(path(ids.b,ids.pv,'logo-new.png')),/row-level security/,'Validated program stays locked');
    await assert.rejects(db.query("insert into storage.objects values($1,'another-bucket')",[path(ids.b,ids.pb,'logo-other.png')]),/row-level security/);
    assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path(ids.b,ids.pb)])).rows.length,1,'Unused draft uploads can be cleaned up');
    assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path(ids.b,ids.pb,'logo-current.png')])).rows.length,0,'Current logo cannot be deleted');
    assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path(ids.b,ids.pv)])).rows.length,0,'Validated assets cannot be deleted');
    assert.equal((await db.query('update storage.objects set name=name where name=$1 returning name',[path(ids.b,ids.pb,'logo-current.png')])).rows.length,0,'No UPDATE policy is added');
    await actor(ids.staff);await assert.rejects(upload(path(ids.b,ids.pb,'staff.png')),/row-level security/,'Staff cannot upload');
    await actor(ids.other);assert.equal((await db.query('select * from storage.objects where name=$1',[path(ids.b,ids.pb,'logo-current.png')])).rows.length,0);
    await db.exec("reset role;set role anon;set request.test_uid='';");
    await assert.rejects(db.query("select app_private.can_program_asset($1,'insert')",[path(ids.b,ids.pb)]),/permission denied/);
  } finally {await db.close();}
});
