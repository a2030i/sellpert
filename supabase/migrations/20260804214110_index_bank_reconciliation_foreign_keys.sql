create index bank_transactions_upload_idx
  on public.bank_transactions (upload_id);

create index settlement_bank_matches_bank_transaction_idx
  on public.settlement_bank_matches (bank_transaction_id);
