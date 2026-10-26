-- New self-service loyalty cards may choose an approved DPA stamp.
-- Separate from card_design, which is reserved for administrator-designed layouts.
alter table public.programs
  add column if not exists self_service_stamp_id text;

comment on column public.programs.self_service_stamp_id is
  'Static DPA stamp-library identifier selected during self-service onboarding. Null preserves existing Wallet layouts.';

alter table public.programs
  add constraint programs_self_service_stamp_id_valid
  check (self_service_stamp_id is null or self_service_stamp_id in (
    'pizza','baguette','glace','donut','riz-crousty','ciseaux','fleuriste','barber','burger','the',
    'carwash','spa','vernis','patte','fitness','poulet','bubble-tea','tacos','kebab','sushi',
    'crepe','croissant','cafe','milkshake','cookie','maquillage','sneaker','shopping','bijouterie',
    'vetements','telephonie','pneumatique','animalerie','tacos-2','wok','vape','cheveux-bruns',
    'e-liquide'
  ));
