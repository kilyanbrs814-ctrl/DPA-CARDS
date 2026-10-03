-- Covering indexes for the composite (id, merchant_id) foreign keys flagged by the advisor.
create index design_requests_program_merchant_idx on public.design_requests (program_id, merchant_id);
create index wallet_classes_program_merchant_idx on public.wallet_classes (program_id, merchant_id);
create index wallet_passes_card_merchant_idx on public.wallet_passes (card_id, merchant_id);
