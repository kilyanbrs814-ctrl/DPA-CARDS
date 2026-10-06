-- Admin "Créer une carte test": demo cards built with the card designer, linked to no merchant,
-- program, customer or subscription. Service role only (wallet Edge Function, admin_users check).
-- Images live in program-assets/tests/<id>/designer/. QR code: DPA_TEST:<qr_token>, never DPA1:.
create table public.test_card_designs (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  config            jsonb not null default '{}'::jsonb check (octet_length(config::text) <= 65536),
  qr_token          uuid not null unique default gen_random_uuid(),
  google_class_id   text,
  google_object_id  text,
  google_synced_at  timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.test_card_designs enable row level security;
revoke all on public.test_card_designs from anon, authenticated;
create trigger test_card_designs_touch before update on public.test_card_designs
  for each row execute function app_private.touch_updated_at();
