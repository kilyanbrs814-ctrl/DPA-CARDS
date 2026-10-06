-- Card designer (admin): one design project per program, shared by the Apple and Google layouts.
--
-- public.card_designs   the admin's working copy (draft or validated). Only the service role
--                       (wallet Edge Function, after the admin_users check) reads or writes it.
-- programs.card_design  the validated design applied to the program: layout, colours, images,
--                       stamp style, typography. It never holds customer data (name, balance,
--                       rewards, QR code): those are rendered live for each card.

alter table public.programs
  add column card_design jsonb,
  add column card_design_validated_at timestamptz,
  add constraint programs_card_design_size check (card_design is null or octet_length(card_design::text) <= 32768);
-- Merchants keep their column-level UPDATE grants only (none on the new columns); reading stays as is.

create table public.card_designs (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references public.merchants(id) on delete cascade,
  program_id        uuid not null unique references public.programs(id) on delete cascade,
  design_request_id uuid references public.design_requests(id) on delete set null,
  config            jsonb not null default '{}'::jsonb check (octet_length(config::text) <= 65536),
  status            text not null default 'draft' check (status in ('draft', 'validated')),
  validated_at      timestamptz,
  updated_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index card_designs_merchant_idx on public.card_designs (merchant_id);
create index card_designs_request_idx on public.card_designs (design_request_id);

alter table public.card_designs enable row level security;
revoke all on public.card_designs from anon, authenticated;

create trigger card_designs_touch before update on public.card_designs
  for each row execute function app_private.touch_updated_at();
