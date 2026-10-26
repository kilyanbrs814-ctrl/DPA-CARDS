-- Existing cards keep their current appearance (32% for self-service stamps).
-- Only owner-checked backend finalization can write the new setting.
alter table public.programs add column self_service_inactive_opacity integer
  check (self_service_inactive_opacity between 0 and 100);
comment on column public.programs.self_service_inactive_opacity is
  'Opacity percentage of unearned self-service stamps. Null preserves the historical 32 percent. Earned stamps remain fully opaque.';
