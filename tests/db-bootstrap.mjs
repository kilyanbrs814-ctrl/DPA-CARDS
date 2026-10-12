import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema extensions; create schema vault; create schema net; create schema cron;
create table public.admin_users(email text primary key); insert into public.admin_users values('contact@digitalprojectagency.fr'),('mael.81400@icloud.com'),('kilyan.brs814@gmail.com');
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create function vault.create_secret(text,text,text) returns uuid language sql as $$ select gen_random_uuid() $$;
create function extensions.gen_random_bytes(integer) returns bytea language sql as $$ select decode(repeat('ab',$1),'hex') $$;
create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
grant usage on schema public,auth,storage,app_private to service_role;`.replace(',app_private',''));
const dir='supabase/migrations';
for(const file of fs.readdirSync(dir).sort()) {
 let sql=fs.readFileSync(`${dir}/${file}`,'utf8').replace(/^create extension.*;$/gm,'');
 try {await db.exec(sql);}catch(e){console.error('FAIL',file,e.message); process.exit(1);}
}
await db.exec(`grant execute on all functions in schema public to service_role; grant usage on schema public,auth,app_private to service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema app_private to service_role; grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`);
export {db};
