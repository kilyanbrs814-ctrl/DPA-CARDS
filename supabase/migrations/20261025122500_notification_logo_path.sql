-- DPA Cards · logo carré 600x600 réservé aux notifications Apple Wallet.
-- Independent of the Wallet pass header and Google Wallet branding.
alter table public.programs
  add column if not exists notification_logo_path text;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='programs_notification_logo_scoped'
      and conrelid='public.programs'::regclass
  ) then
    alter table public.programs
      add constraint programs_notification_logo_scoped
      check (
        notification_logo_path is null or
        notification_logo_path ~ (
          '^' || merchant_id::text || '/' || id::text ||
          '/notification-logo-[0-9a-f-]{36}[.]png$'
        )
      );
  end if;
end;
$migration$;
