-- Adds contact@digitalprojectagency.fr to the admin allowlist. Existing admins are kept.
insert into public.admin_users (email) values ('contact@digitalprojectagency.fr') on conflict (email) do nothing;
