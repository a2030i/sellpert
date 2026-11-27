-- Preserve historical confirmations in the legacy source, never assign them to
-- a newly connected seller based only on a matching settlement reference.
alter table public.settlement_bank_matches add column marketplace_account_id uuid;
update public.settlement_bank_matches set marketplace_account_id=security.ensure_legacy_marketplace_account(merchant_code,platform);
alter table public.settlement_bank_matches alter column marketplace_account_id set not null;
alter table public.settlement_bank_matches add constraint settlement_bank_matches_account_fk
 foreign key(merchant_code,platform,marketplace_account_id) references public.marketplace_accounts(merchant_code,platform,id);
alter table public.settlement_bank_matches drop constraint settlement_bank_matches_settlement_unique;
alter table public.settlement_bank_matches add constraint settlement_bank_matches_settlement_unique
 unique(merchant_code,platform,marketplace_account_id,settlement_id);
create trigger assign_legacy_marketplace_account before insert on public.settlement_bank_matches
 for each row execute function security.set_legacy_marketplace_account();
create index settlement_bank_matches_account_idx on public.settlement_bank_matches(merchant_code,marketplace_account_id);
-- Existing actor/MFA/tenant policies, identity stamping, and one-use-per-bank-row
-- uniqueness continue to apply. Account FK rejects cross-tenant/platform matches.
