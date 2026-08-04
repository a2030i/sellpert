-- Trendyol explicitly controls whether a question may expose the customer's
-- name. Do not retain hidden names, and enforce the provider's privacy flag at
-- the database boundary as defense in depth.

update public.trendyol_customer_questions
set customer_name = null,
    updated_at = now()
where show_customer_name is not true
  and customer_name is not null;

alter table public.trendyol_customer_questions
  drop constraint if exists trendyol_customer_questions_hidden_name_check;

alter table public.trendyol_customer_questions
  add constraint trendyol_customer_questions_hidden_name_check
  check (show_customer_name or customer_name is null);
