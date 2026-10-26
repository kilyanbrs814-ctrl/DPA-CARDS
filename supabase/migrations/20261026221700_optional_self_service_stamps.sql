-- NULL preserves every existing card; only explicit new self-service choices
-- use the compact layout. This field is written by owner-checked finalization,
-- not granted to browser UPDATEs and not backfilled onto existing programs.
alter table public.programs add column self_service_show_stamps boolean;
comment on column public.programs.self_service_show_stamps is
  'Explicit self-service stamp visibility. Null preserves legacy/customized layouts; false selects compact counter/member/reward/QR layout.';
