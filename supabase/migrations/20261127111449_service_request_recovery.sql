-- Restore the documented service-request schema only when all five tables
-- are absent. Existing tables/data are preserved; partial drift fails closed.
-- This is a new forward migration, not migration-ledger repair. New forms are
-- drafts; publishing a public intake form remains an explicit admin action.
do $recovery$
declare present integer; t text;
begin
 select count(*) into present from information_schema.tables where table_schema='public'
 and table_name=any(array['service_request_forms','service_request_questions','service_request_stages','service_request_submissions','service_request_activities']);
 if present not in (0,5) then raise exception 'Partial service-request schema; reviewed recovery required'; end if;
 if present=0 then
 execute $schema$
-- Configurable public service-request forms and their internal follow-up
-- pipeline. Public traffic is accepted only by the pricing-request Edge
-- Function; authenticated platform administrators manage these tables via RLS.

create table public.service_request_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 2 and 160),
  description text not null default '' check (char_length(description) <= 500),
  is_published boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_request_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.service_request_forms(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text not null check (char_length(label) between 2 and 200),
  type text not null check (type in ('short_text','long_text','single_choice','multiple_choice','dropdown','url','file')),
  help_text text not null default '' check (char_length(help_text) <= 500),
  placeholder text not null default '' check (char_length(placeholder) <= 160),
  required boolean not null default false,
  position integer not null check (position >= 0),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, key)
);

create table public.service_request_stages (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.service_request_forms(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  color text not null default '#078d92' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null check (position >= 0),
  is_terminal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, name)
);

create table public.service_request_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.service_request_forms(id) on delete restrict,
  reference_code text not null unique,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  contact_email text check (contact_email is null or char_length(contact_email) between 5 and 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) between 9 and 32),
  current_stage_id uuid not null references public.service_request_stages(id) on delete restrict,
  source_hash text not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_request_activities (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_request_submissions(id) on delete cascade,
  stage_id uuid references public.service_request_stages(id) on delete set null,
  activity_type text not null check (activity_type in ('created','stage_changed','note','link','attachment')),
  content text not null default '' check (char_length(content) <= 4000),
  link_url text check (link_url is null or char_length(link_url) <= 1000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index service_request_questions_order_idx on public.service_request_questions(form_id, position);
create index service_request_stages_order_idx on public.service_request_stages(form_id, position);
create index service_request_submissions_pipeline_idx on public.service_request_submissions(form_id, current_stage_id, submitted_at desc);
create index service_request_submissions_rate_idx on public.service_request_submissions(source_hash, submitted_at desc);
create index service_request_activities_timeline_idx on public.service_request_activities(request_id, created_at desc);

create trigger service_request_forms_updated_at before update on public.service_request_forms
for each row execute function public.update_updated_at();
create trigger service_request_questions_updated_at before update on public.service_request_questions
for each row execute function public.update_updated_at();
create trigger service_request_stages_updated_at before update on public.service_request_stages
for each row execute function public.update_updated_at();
create trigger service_request_submissions_updated_at before update on public.service_request_submissions
for each row execute function public.update_updated_at();

alter table public.service_request_forms enable row level security;
alter table public.service_request_questions enable row level security;
alter table public.service_request_stages enable row level security;
alter table public.service_request_submissions enable row level security;
alter table public.service_request_activities enable row level security;

create policy service_request_forms_admin_all on public.service_request_forms for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_questions_admin_all on public.service_request_questions for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_stages_admin_all on public.service_request_stages for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_submissions_admin_all on public.service_request_submissions for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_activities_admin_select on public.service_request_activities for select to authenticated
using ((select public.is_admin()));
create policy service_request_activities_admin_insert on public.service_request_activities for insert to authenticated
with check ((select public.is_admin()));

grant select, insert, update, delete on public.service_request_forms to authenticated;
grant select, insert, update, delete on public.service_request_questions to authenticated;
grant select, insert, update, delete on public.service_request_stages to authenticated;
grant select, insert, update, delete on public.service_request_submissions to authenticated;
grant select, insert on public.service_request_activities to authenticated;
revoke all on public.service_request_forms, public.service_request_questions,
  public.service_request_stages, public.service_request_submissions,
  public.service_request_activities from anon;


$schema$;
 end if;
 if not exists(select 1 from public.service_request_forms where slug='sellpert-service-request') then
 execute $seed$
-- Seed the initial Sellpert intake form and the requested default pipeline.
with inserted_form as (
  insert into public.service_request_forms (name, slug, title, description, is_published)
  values ('طلب خدمة Sellpert', 'sellpert-service-request', 'طلب عرض سعر',
    'أخبرنا عن نشاطك لنجهّز لك عرضاً يناسب قنوات البيع واحتياجك.', false)
  returning id
)
insert into public.service_request_stages (form_id, name, color, position, is_terminal)
select id, stage.name, stage.color, stage.position, stage.is_terminal
from inserted_form
cross join (values
  ('تسجيل جديد', '#2f80ed', 0, false),
  ('جاري دراسة الطلب', '#d99a17', 1, false),
  ('التنسيق للاجتماع', '#8767c7', 2, false),
  ('تم تحديد الاجتماع', '#178f88', 3, false),
  ('تم إرسال العقد', '#db7b32', 4, false),
  ('تم توقيع العقد', '#2d9b5f', 5, true)
) as stage(name, color, position, is_terminal);

with target_form as (select id from public.service_request_forms where slug = 'sellpert-service-request')
insert into public.service_request_questions
  (form_id, key, label, type, help_text, placeholder, required, position, options, config)
select target_form.id, q.key, q.label, q.type, q.help_text, q.placeholder, q.required, q.position, q.options::jsonb, q.config::jsonb
from target_form
cross join (values
  ('signer_name', 'اسم الشخص المخول بالتوقيع', 'short_text', '', 'أدخل الاسم الكامل', true, 0, '[]', '{"section":"contact","format":"name"}'),
  ('business_email', 'البريد الإلكتروني للعمل', 'short_text', '', 'name@company.com', true, 1, '[]', '{"section":"contact","format":"email"}'),
  ('phone', 'رقم الجوال', 'short_text', '', '5xxxxxxxx', true, 2, '[]', '{"section":"contact","format":"saudi_phone"}'),
  ('store_url', 'رابط المتجر', 'url', 'اختياري', 'https://', false, 3, '[]', '{"section":"contact"}'),
  ('product_count', 'عدد المنتجات التي ترغب في عرضها', 'short_text', '', 'مثال: 120', true, 4, '[]', '{"section":"business","format":"number"}'),
  ('product_category', 'تصنيف المنتجات', 'dropdown', '', '', true, 5, '["العناية والجمال","الأزياء والملابس","الأجهزة والإلكترونيات","المنزل والمطبخ","الأغذية والمشروبات","أخرى"]', '{"section":"business"}'),
  ('existing_channels', 'القنوات التي لديك حساب قائم فيها', 'multiple_choice', '', '', false, 6, '["نون","أمازون","ترنديول"]', '{"section":"business"}'),
  ('desired_channels', 'القنوات التي ترغب في العمل عليها معنا', 'multiple_choice', '', '', true, 7, '["نون","أمازون","ترنديول"]', '{"section":"business","min":1}'),
  ('noon_url', 'رابط متجرك على نون', 'url', 'إن وجد', 'https://', false, 8, '[]', '{"section":"channels"}'),
  ('amazon_url', 'رابط متجرك على أمازون', 'url', 'إن وجد', 'https://', false, 9, '[]', '{"section":"channels"}'),
  ('trendyol_url', 'رابط متجرك على ترنديول', 'url', 'إن وجد', 'https://', false, 10, '[]', '{"section":"channels"}'),
  ('entity_type', 'نوع الكيان', 'single_choice', '', '', true, 11, '["شركة / مؤسسة","وثيقة عمل حر"]', '{"section":"documents"}'),
  ('entity_document', 'السجل التجاري / وثيقة العمل الحر', 'file', '', '', true, 12, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}'),
  ('trademark_status', 'هل لديك علامة تجارية خاصة؟', 'single_choice', '', '', true, 13, '["نعم ومسجلة","نعم لكن غير مسجلة","لا توجد علامة تجارية خاصة"]', '{"section":"documents"}'),
  ('trademark_certificate', 'شهادة العلامة التجارية', 'file', 'إن وجدت', '', false, 14, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}'),
  ('national_address', 'العنوان الوطني للمؤسسة', 'file', 'إن وجد', '', false, 15, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}'),
  ('tax_certificate', 'الشهادة الضريبية', 'file', 'إن وجدت', '', false, 16, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}')
) as q(key, label, type, help_text, placeholder, required, position, options, config);

comment on table public.service_request_submissions is
  'Service leads with dynamic answers and a configurable current pipeline stage.';
comment on table public.service_request_activities is
  'Operational timeline for notes, links, attachments, and stage changes.';

$seed$;
 end if;
 foreach t in array array['service_request_forms','service_request_questions','service_request_stages','service_request_submissions','service_request_activities'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('alter table public.%I force row level security',t);
   execute format('grant all on public.%I to service_role',t);
   if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='sellpert_require_mfa_if_enrolled') then
     execute format('create policy sellpert_require_mfa_if_enrolled on public.%I as restrictive for all to authenticated using ((select security.mfa_access_allowed())) with check ((select security.mfa_access_allowed()))',t);
   end if;
 end loop;
end $recovery$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-request-documents', 'service-request-documents', false, 5242880,
  array['application/pdf', 'image/jpeg', 'image/png']::text[])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $policy$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_request_documents_admin_select') then execute $ddl$create policy service_request_documents_admin_select on storage.objects for select to authenticated
using (bucket_id = 'service-request-documents' and (select public.is_admin()))$ddl$; end if; end $policy$;
do $policy$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_request_documents_admin_insert') then execute $ddl$create policy service_request_documents_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'service-request-documents' and (select public.is_admin()))$ddl$; end if; end $policy$;
do $policy$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_request_documents_admin_delete') then execute $ddl$create policy service_request_documents_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'service-request-documents' and (select public.is_admin()))$ddl$; end if; end $policy$;
