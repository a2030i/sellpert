-- Weekly briefs were created after the generic tenant-policy sweep and kept a
-- primary-workspace equality check. Align them with the centralized workspace
-- authorization contract so explicitly linked workspaces are readable while
-- unlinked merchants remain denied.

drop policy if exists tenant_boundary on public.merchant_weekly_briefs;
create policy tenant_boundary
on public.merchant_weekly_briefs
as restrictive
for all
to authenticated
using ((select security.can_access_merchant(merchant_code)))
with check ((select security.can_access_merchant(merchant_code)));

drop policy if exists merchant_weekly_briefs_select on public.merchant_weekly_briefs;
create policy merchant_weekly_briefs_select
on public.merchant_weekly_briefs for select
to authenticated
using (
  (select security.can_access_all_merchants())
  or (
    (select security.can_access_merchant(merchant_code))
    and not (select security.is_platform_staff_account())
    and (select security.current_has_any_merchant_permission(array['dashboard']::text[]))
  )
);

