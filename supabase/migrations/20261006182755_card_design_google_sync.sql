-- State of the Google Wallet class update after a design is validated in the admin.
-- pending: not tried yet · synced: class updated · no_class: no Wallet class yet (it will be created
-- from the design) · error: Google failed, the design stays validated and the admin can retry.
alter table public.card_designs
  add column google_sync_status text check (google_sync_status in ('pending', 'synced', 'no_class', 'error')),
  add column google_sync_error  text check (char_length(google_sync_error) <= 300),
  add column google_synced_at   timestamptz;
