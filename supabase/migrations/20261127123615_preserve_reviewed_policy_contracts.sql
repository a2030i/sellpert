-- Reconstruct the reviewed existing production policy contract in clean rebuilds.
-- This is NOT a staff-role change or a production policy expansion. A production
-- policy already matching the recorded contract is left byte-for-byte unchanged.
-- Only the reviewed previous local definition may be replaced; any third state
-- aborts. No grants, customer rows, provider operations or role assignments change.
-- The intentional missing-effect corrections (service tables, sales targets,
-- Omniful MFA/tenant guards) and new account policies are excluded and preserved.
-- Existing broader staff capabilities are documented for a separate least-
-- privilege review; the owner explicitly deferred changing internal staff roles.
DO $policy_compatibility$
DECLARE
 entry jsonb;
 expected jsonb;
 desired jsonb;
 observed jsonb;
 target_schema text;
 target_table text;
 target_name text;
 role_list text;
 ddl text;
BEGIN
 PERFORM set_config('search_path', 'public,pg_catalog', true);
 FOR entry IN SELECT value FROM jsonb_array_elements($policy_manifest$
[
  {
    "key": "public.account_closure_requests.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(account_closure_requests.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "account_closure_requests",
      "using": "( SELECT security.can_access_merchant(account_closure_requests.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": null
  },
  {
    "key": "public.account_transactions.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.account_transactions.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.account_transactions.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.account_transactions.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "(( SELECT security.has_any_platform_permission('{view_finance,upload_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{statement,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.account_transactions.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.account_transactions.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(account_transactions.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "( SELECT security.can_access_merchant(account_transactions.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "account_transactions",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.ad_metrics.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.ad_metrics.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.ad_metrics.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_ads'::text))",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_ads'::text))",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.ad_metrics.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "(( SELECT security.has_any_platform_permission('{manage_ads}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{marketing,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.ad_metrics.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_ads'::text))",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_ads'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_ads'::text))",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_ads'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.ad_metrics.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(ad_metrics.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "( SELECT security.can_access_merchant(ad_metrics.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "ad_metrics",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.amazon_daily_sales.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.amazon_daily_sales.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)))",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.amazon_daily_sales.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "(( SELECT security.has_any_platform_permission('{view_finance,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{statement,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (( SELECT security.has_any_platform_permission('{view_finance,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{statement,dashboard}'::text[]) AS current_has_any_merchant_permission))))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.amazon_daily_sales.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)))",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.amazon_daily_sales.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(amazon_daily_sales.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "( SELECT security.can_access_merchant(amazon_daily_sales.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "amazon_daily_sales",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.app_settings.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "app_settings",
      "using": "(EXISTS ( SELECT 1\n   FROM merchants\n  WHERE ((merchants.id = ( SELECT auth.uid() AS uid)) AND (merchants.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.app_settings.sellpert_insert_access",
    "baseline": null,
    "production": {
      "name": "sellpert_insert_access",
      "check": "(EXISTS ( SELECT 1\n   FROM merchants\n  WHERE ((merchants.id = ( SELECT auth.uid() AS uid)) AND (merchants.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))",
      "roles": "{authenticated}",
      "table": "app_settings",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.app_settings.sellpert_select_access",
    "baseline": null,
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "app_settings",
      "using": "((EXISTS ( SELECT 1\n   FROM merchants\n  WHERE ((merchants.id = ( SELECT auth.uid() AS uid)) AND (merchants.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))) OR (EXISTS ( SELECT 1\n   FROM merchants\n  WHERE ((merchants.id = ( SELECT auth.uid() AS uid)) AND (merchants.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.app_settings.sellpert_update_access",
    "baseline": null,
    "production": {
      "name": "sellpert_update_access",
      "check": "(EXISTS ( SELECT 1\n   FROM merchants\n  WHERE ((merchants.id = ( SELECT auth.uid() AS uid)) AND (merchants.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))",
      "roles": "{authenticated}",
      "table": "app_settings",
      "using": "(EXISTS ( SELECT 1\n   FROM merchants\n  WHERE ((merchants.id = ( SELECT auth.uid() AS uid)) AND (merchants.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.audit_log.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "audit_log",
      "using": "security.has_any_platform_permission('{view_audit}'::text[])",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "audit_log",
      "using": "(( SELECT security.is_staff() AS is_staff) OR security.has_any_platform_permission('{view_audit}'::text[]))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.audit_log.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(audit_log.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "audit_log",
      "using": "( SELECT security.can_access_merchant(audit_log.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "audit_log",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.budget_alerts.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.budget_alerts.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.budget_alerts.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.budget_alerts.identity_scoped_update",
    "baseline": null,
    "production": {
      "name": "identity_scoped_update",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.budget_alerts.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "security.has_platform_permission('manage_ads'::text)",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.budget_alerts.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "(( SELECT security.has_any_platform_permission('{manage_ads}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{marketing,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.budget_alerts.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "security.has_platform_permission('manage_ads'::text)",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "security.has_platform_permission('manage_ads'::text)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.budget_alerts.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(budget_alerts.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "( SELECT security.can_access_merchant(budget_alerts.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "budget_alerts",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.entry_sessions.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(entry_sessions.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "entry_sessions",
      "using": "( SELECT security.can_access_merchant(entry_sessions.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "entry_sessions",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.goods_received.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.goods_received.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.goods_received.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.goods_received.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,manage_inbound}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{inventory,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.goods_received.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.goods_received.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(goods_received.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "( SELECT security.can_access_merchant(goods_received.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "goods_received",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.import_diagnostics.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.import_diagnostics.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.import_diagnostics.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,upload_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{integrations}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (( SELECT security.has_any_platform_permission('{view_files,upload_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{integrations}'::text[]) AS current_has_any_merchant_permission))))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.import_diagnostics.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.import_diagnostics.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(import_diagnostics.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "( SELECT security.can_access_merchant(import_diagnostics.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "import_diagnostics",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.inbound_shipment_items.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipment_items.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipment_items.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipment_items.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,manage_inbound}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{inventory,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.inbound_shipment_items.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipment_items.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(inbound_shipment_items.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "( SELECT security.can_access_merchant(inbound_shipment_items.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "inbound_shipment_items",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.inbound_shipments.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipments.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipments.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipments.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,manage_inbound}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{inventory,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.inbound_shipments.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('manage_inbound'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inbound_shipments.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(inbound_shipments.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "( SELECT security.can_access_merchant(inbound_shipments.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "inbound_shipments",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.inventory.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inventory.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inventory.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inventory.identity_scoped_update",
    "baseline": null,
    "production": {
      "name": "identity_scoped_update",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.inventory.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.inventory.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_files,manage_inbound}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{inventory,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.inventory.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.inventory.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(inventory.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "( SELECT security.can_access_merchant(inventory.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "inventory",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.marketplace_action_logs.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "marketplace_action_logs",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.marketplace_action_logs.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "marketplace_action_logs",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,view_audit}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{integrations}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.marketplace_action_logs.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(marketplace_action_logs.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "marketplace_action_logs",
      "using": "( SELECT security.can_access_merchant(marketplace_action_logs.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "marketplace_action_logs",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.merchant_account_links.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(merchant_account_links.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "merchant_account_links",
      "using": "( SELECT security.can_access_merchant(merchant_account_links.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "merchant_account_links",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.merchant_notes.crm_notes_delete",
    "baseline": null,
    "production": {
      "name": "crm_notes_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_notes.crm_notes_insert",
    "baseline": null,
    "production": {
      "name": "crm_notes_insert",
      "check": "( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_notes.crm_notes_select",
    "baseline": null,
    "production": {
      "name": "crm_notes_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "( SELECT security.has_any_platform_permission(ARRAY['crm'::text]) AS has_any_platform_permission)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_notes.crm_notes_update",
    "baseline": null,
    "production": {
      "name": "crm_notes_update",
      "check": "( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_notes.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_notes.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission) OR security.has_platform_permission('crm'::text))",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_notes.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "(( SELECT security.has_any_platform_permission(ARRAY['crm'::text]) AS has_any_platform_permission) OR security.has_any_platform_permission('{crm}'::text[]))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_notes.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission) OR security.has_platform_permission('crm'::text))",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "(( SELECT security.has_platform_permission('crm'::text) AS has_platform_permission) OR security.has_platform_permission('crm'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_notes.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(merchant_notes.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "( SELECT security.can_access_merchant(merchant_notes.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "merchant_notes",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.merchant_payout_schedule.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_payout_schedule.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_payout_schedule.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "security.has_platform_permission('edit_billing'::text)",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('edit_billing'::text))",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_payout_schedule.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "(( SELECT security.has_any_platform_permission('{view_finance}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{statement,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_payout_schedule.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "security.has_platform_permission('edit_billing'::text)",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "security.has_platform_permission('edit_billing'::text)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('edit_billing'::text))",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "(( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('edit_billing'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_payout_schedule.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(merchant_payout_schedule.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "( SELECT security.can_access_merchant(merchant_payout_schedule.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "merchant_payout_schedule",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.merchant_requests.merchant_action_owner_update",
    "baseline": null,
    "production": {
      "name": "merchant_action_owner_update",
      "check": "((request_kind = 'action'::text) AND (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)))",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "((request_kind = 'action'::text) AND (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_requests.merchant_request_safe_insert",
    "baseline": null,
    "production": {
      "name": "merchant_request_safe_insert",
      "check": "(security.has_platform_permission('tasks'::text) OR (security.can_access_merchant(merchant_code) AND (status = 'pending'::text) AND (COALESCE(created_by_role, 'merchant'::text) = 'merchant'::text) AND (assigned_to IS NULL) AND (admin_note IS NULL) AND (resolved_at IS NULL) AND (resolved_by IS NULL) AND (completion_result IS NULL) AND (completion_note IS NULL) AND (completion_recorded_at IS NULL)))",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_requests.merchant_request_tenant_select",
    "baseline": null,
    "production": {
      "name": "merchant_request_tenant_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_requests.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "(security.has_platform_permission('tasks'::text) OR (security.can_access_merchant(merchant_code) AND (status = 'pending'::text) AND (COALESCE(created_by_role, 'merchant'::text) = 'merchant'::text) AND (assigned_to IS NULL) AND (admin_note IS NULL) AND (resolved_at IS NULL) AND (resolved_by IS NULL) AND (completion_result IS NULL) AND (completion_note IS NULL) AND (completion_recorded_at IS NULL)) OR security.has_platform_permission('tasks'::text))",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_requests.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "(security.can_access_merchant(merchant_code) OR security.has_any_platform_permission('{tasks,crm,whatsapp_send,whatsapp_bulk}'::text[]))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_requests.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "(((request_kind = 'action'::text) AND (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))) OR security.has_platform_permission('tasks'::text))",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "(((request_kind = 'action'::text) AND (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))) OR security.has_platform_permission('tasks'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.merchant_requests.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(merchant_requests.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "( SELECT security.can_access_merchant(merchant_requests.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "merchant_requests",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.merchant_weekly_briefs.merchant_weekly_briefs_insert",
    "baseline": {
      "name": "merchant_weekly_briefs_insert",
      "check": "((merchant_code = ( SELECT current_merchant_code() AS current_merchant_code)) AND (NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_merchant_permission('dashboard'::text) AS current_has_merchant_permission))",
      "roles": "{authenticated}",
      "table": "merchant_weekly_briefs",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "merchant_weekly_briefs_insert",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) AND (NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_merchant_permission('dashboard'::text) AS current_has_merchant_permission))",
      "roles": "{authenticated}",
      "table": "merchant_weekly_briefs",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchant_weekly_briefs.merchant_weekly_briefs_update",
    "baseline": {
      "name": "merchant_weekly_briefs_update",
      "check": "((merchant_code = ( SELECT current_merchant_code() AS current_merchant_code)) AND (NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_merchant_permission('dashboard'::text) AS current_has_merchant_permission))",
      "roles": "{authenticated}",
      "table": "merchant_weekly_briefs",
      "using": "((merchant_code = ( SELECT current_merchant_code() AS current_merchant_code)) AND (NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_merchant_permission('dashboard'::text) AS current_has_merchant_permission))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "merchant_weekly_briefs_update",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) AND (NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_merchant_permission('dashboard'::text) AS current_has_merchant_permission))",
      "roles": "{authenticated}",
      "table": "merchant_weekly_briefs",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) AND (NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_merchant_permission('dashboard'::text) AS current_has_merchant_permission))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchants.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchants",
      "using": "(((role = 'merchant'::text) AND security.has_platform_permission('delete_merchants'::text)) OR ((role = 'staff'::text) AND (id <> ( SELECT auth.uid() AS uid)) AND security.has_platform_permission('create_staff'::text)))",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchants",
      "using": "(security.is_admin() OR (((role = 'merchant'::text) AND security.has_platform_permission('delete_merchants'::text)) OR ((role = 'staff'::text) AND (id <> ( SELECT auth.uid() AS uid)) AND security.has_platform_permission('create_staff'::text))))",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchants.sellpert_insert_access",
    "baseline": null,
    "production": {
      "name": "sellpert_insert_access",
      "check": "security.is_admin()",
      "roles": "{authenticated}",
      "table": "merchants",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchants.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchants",
      "using": "((merchant_code = ( SELECT current_merchant_code() AS current_merchant_code)) OR ( SELECT security.has_any_platform_permission(ARRAY['view_merchants'::text, 'edit_merchants'::text, 'create_merchants'::text, 'delete_merchants'::text, 'impersonate'::text, 'create_staff'::text, 'tasks'::text, 'crm'::text]) AS has_any_platform_permission) OR ((id = ( SELECT auth.uid() AS uid)) AND (role = 'staff'::text)) OR ((id = ( SELECT auth.uid() AS uid)) OR security.can_access_merchant(merchant_code) OR security.is_admin() OR security.is_staff() OR security.has_any_platform_permission(ARRAY['view_merchants'::text, 'edit_merchants'::text, 'create_merchants'::text, 'delete_merchants'::text, 'impersonate'::text, 'create_staff'::text, 'tasks'::text, 'crm'::text])))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "merchants",
      "using": "((id = ( SELECT auth.uid() AS uid)) OR security.can_access_merchant(merchant_code) OR security.is_admin() OR security.is_staff() OR security.has_any_platform_permission(ARRAY['view_merchants'::text, 'edit_merchants'::text, 'create_merchants'::text, 'delete_merchants'::text, 'impersonate'::text, 'create_staff'::text, 'tasks'::text, 'crm'::text]))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.merchants.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "(((role = 'merchant'::text) AND ( SELECT security.has_platform_permission('edit_merchants'::text) AS has_platform_permission)) OR ((role = 'staff'::text) AND ( SELECT security.has_platform_permission('create_staff'::text) AS has_platform_permission)) OR (security.can_access_merchant(merchant_code) OR security.is_admin() OR security.has_platform_permission('edit_merchants'::text) OR security.has_platform_permission('create_staff'::text)))",
      "roles": "{authenticated}",
      "table": "merchants",
      "using": "(((role = 'merchant'::text) AND ( SELECT security.has_platform_permission('edit_merchants'::text) AS has_platform_permission)) OR ((role = 'staff'::text) AND ( SELECT security.has_platform_permission('create_staff'::text) AS has_platform_permission)) OR (security.can_access_merchant(merchant_code) OR security.is_admin() OR security.has_platform_permission('edit_merchants'::text) OR security.has_platform_permission('create_staff'::text)))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(security.can_access_merchant(merchant_code) OR security.is_admin() OR security.has_platform_permission('edit_merchants'::text) OR security.has_platform_permission('create_staff'::text))",
      "roles": "{authenticated}",
      "table": "merchants",
      "using": "(security.can_access_merchant(merchant_code) OR security.is_admin() OR security.has_platform_permission('edit_merchants'::text) OR security.has_platform_permission('create_staff'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.mfa_recovery_attempts.mfa_recovery_attempts_deny_client_access",
    "baseline": null,
    "production": {
      "name": "mfa_recovery_attempts_deny_client_access",
      "check": "false",
      "roles": "{anon,authenticated}",
      "table": "mfa_recovery_attempts",
      "using": "false",
      "schema": "public",
      "command": "ALL",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.mfa_recovery_attempts.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "mfa_recovery_attempts",
      "using": "false",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.mfa_recovery_attempts.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "false",
      "roles": "{authenticated}",
      "table": "mfa_recovery_attempts",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.mfa_recovery_attempts.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "mfa_recovery_attempts",
      "using": "false",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.mfa_recovery_attempts.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "false",
      "roles": "{authenticated}",
      "table": "mfa_recovery_attempts",
      "using": "false",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.mfa_recovery_codes.mfa_recovery_codes_deny_client_access",
    "baseline": null,
    "production": {
      "name": "mfa_recovery_codes_deny_client_access",
      "check": "false",
      "roles": "{anon,authenticated}",
      "table": "mfa_recovery_codes",
      "using": "false",
      "schema": "public",
      "command": "ALL",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.mfa_recovery_codes.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "mfa_recovery_codes",
      "using": "false",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.mfa_recovery_codes.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "false",
      "roles": "{authenticated}",
      "table": "mfa_recovery_codes",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.mfa_recovery_codes.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "mfa_recovery_codes",
      "using": "false",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.mfa_recovery_codes.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "false",
      "roles": "{authenticated}",
      "table": "mfa_recovery_codes",
      "using": "false",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.notifications.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "notifications",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.notifications.sellpert_insert_access",
    "baseline": null,
    "production": {
      "name": "sellpert_insert_access",
      "check": "( SELECT security.is_staff() AS is_staff)",
      "roles": "{authenticated}",
      "table": "notifications",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.notifications.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "notifications",
      "using": "(( SELECT security.has_any_platform_permission('{}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "notifications",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (( SELECT security.has_any_platform_permission('{}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{dashboard}'::text[]) AS current_has_any_merchant_permission))) OR ((merchant_code IS NULL) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1))))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.notifications.sellpert_update_access",
    "baseline": null,
    "production": {
      "name": "sellpert_update_access",
      "check": "( SELECT security.is_staff() AS is_staff)",
      "roles": "{authenticated}",
      "table": "notifications",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.notifications.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(notifications.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "notifications",
      "using": "( SELECT security.can_access_merchant(notifications.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "notifications",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.nps_responses.merchant_nps_insert",
    "baseline": null,
    "production": {
      "name": "merchant_nps_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "nps_responses",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.nps_responses.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "nps_responses",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.nps_responses.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "nps_responses",
      "using": "security.has_any_platform_permission('{crm,tasks}'::text[])",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "nps_responses",
      "using": "(( SELECT security.is_staff() AS is_staff) OR security.has_any_platform_permission('{crm,tasks}'::text[]))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.nps_responses.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(nps_responses.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "nps_responses",
      "using": "( SELECT security.can_access_merchant(nps_responses.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "nps_responses",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.order_items.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "order_items",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.order_items.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "order_items",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{orders,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.order_items.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(order_items.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "order_items",
      "using": "( SELECT security.can_access_merchant(order_items.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "order_items",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.order_packages.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(order_packages.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "order_packages",
      "using": "( SELECT security.can_access_merchant(order_packages.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "order_packages",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.orders.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.orders.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.orders.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.orders.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{orders,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.orders.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.orders.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(orders.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "( SELECT security.can_access_merchant(orders.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "orders",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.performance_data.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.performance_data.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.performance_data.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.performance_data.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "security.has_platform_permission('upload_files'::text)",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.performance_data.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_finance,manage_ads,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{dashboard,statement,marketing}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.performance_data.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "security.has_platform_permission('upload_files'::text)",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "security.has_platform_permission('upload_files'::text)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(security.is_admin() OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "(( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.performance_data.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(performance_data.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "( SELECT security.can_access_merchant(performance_data.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "performance_data",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.platform_commission_rates.authenticated_reference_read",
    "baseline": null,
    "production": {
      "name": "authenticated_reference_read",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_commission_rates.finance_reference_delete",
    "baseline": null,
    "production": {
      "name": "finance_reference_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_commission_rates.finance_reference_insert",
    "baseline": null,
    "production": {
      "name": "finance_reference_insert",
      "check": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_commission_rates.finance_reference_update",
    "baseline": null,
    "production": {
      "name": "finance_reference_update",
      "check": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_commission_rates.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_commission_rates.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_commission_rates.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_commission_rates.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_commission_rates",
      "using": "( SELECT security.has_any_platform_permission(ARRAY['edit_billing'::text, 'edit_merchants'::text]) AS has_any_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_credentials.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(platform_credentials.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "platform_credentials",
      "using": "( SELECT security.can_access_merchant(platform_credentials.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "platform_credentials",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.platform_deals.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_deals.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_deals.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_deals.identity_scoped_update",
    "baseline": null,
    "production": {
      "name": "identity_scoped_update",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_deals.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_deals.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{products,integrations}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_deals.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_deals.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(platform_deals.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "( SELECT security.can_access_merchant(platform_deals.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "platform_deals",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.platform_fee_categories.authenticated_reference_read",
    "baseline": null,
    "production": {
      "name": "authenticated_reference_read",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fee_categories.finance_reference_delete",
    "baseline": null,
    "production": {
      "name": "finance_reference_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fee_categories.finance_reference_insert",
    "baseline": null,
    "production": {
      "name": "finance_reference_insert",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fee_categories.finance_reference_update",
    "baseline": null,
    "production": {
      "name": "finance_reference_update",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fee_categories.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_fee_categories.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_fee_categories.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_fee_categories.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fee_categories",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_file_uploads.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "security.has_platform_permission('delete_files'::text)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "(( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('delete_files'::text))",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_file_uploads.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR ( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_file_uploads.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,upload_files,delete_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{integrations}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_file_uploads.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR ( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR ( SELECT security.is_staff() AS is_staff) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_file_uploads.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(platform_file_uploads.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "( SELECT security.can_access_merchant(platform_file_uploads.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "platform_file_uploads",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.platform_fulfillment_models.authenticated_reference_read",
    "baseline": null,
    "production": {
      "name": "authenticated_reference_read",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fulfillment_models.finance_reference_delete",
    "baseline": null,
    "production": {
      "name": "finance_reference_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fulfillment_models.finance_reference_insert",
    "baseline": null,
    "production": {
      "name": "finance_reference_insert",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fulfillment_models.finance_reference_update",
    "baseline": null,
    "production": {
      "name": "finance_reference_update",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_fulfillment_models.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_fulfillment_models.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_fulfillment_models.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_fulfillment_models.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_fulfillment_models",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_other_fees.authenticated_reference_read",
    "baseline": null,
    "production": {
      "name": "authenticated_reference_read",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_other_fees.finance_reference_delete",
    "baseline": null,
    "production": {
      "name": "finance_reference_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_other_fees.finance_reference_insert",
    "baseline": null,
    "production": {
      "name": "finance_reference_insert",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_other_fees.finance_reference_update",
    "baseline": null,
    "production": {
      "name": "finance_reference_update",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_other_fees.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_other_fees.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_other_fees.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_other_fees.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_other_fees",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_shipping_tiers.authenticated_reference_read",
    "baseline": null,
    "production": {
      "name": "authenticated_reference_read",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_shipping_tiers.finance_reference_delete",
    "baseline": null,
    "production": {
      "name": "finance_reference_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_shipping_tiers.finance_reference_insert",
    "baseline": null,
    "production": {
      "name": "finance_reference_insert",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_shipping_tiers.finance_reference_update",
    "baseline": null,
    "production": {
      "name": "finance_reference_update",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.platform_shipping_tiers.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_shipping_tiers.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_shipping_tiers.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "true",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.platform_shipping_tiers.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "platform_shipping_tiers",
      "using": "( SELECT security.has_platform_permission('edit_billing'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.price_change_log.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "price_change_log",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.price_change_log.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "price_change_log",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.price_change_log.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "price_change_log",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.price_change_log.identity_scoped_update",
    "baseline": null,
    "production": {
      "name": "identity_scoped_update",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "price_change_log",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.price_change_log.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "price_change_log",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{products}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.price_change_log.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(price_change_log.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "price_change_log",
      "using": "( SELECT security.can_access_merchant(price_change_log.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "price_change_log",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.product_performance_snapshots.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_performance_snapshots.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_performance_snapshots.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR ( SELECT security.is_staff() AS is_staff))",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_performance_snapshots.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{products,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.product_performance_snapshots.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "(merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR ( SELECT security.is_staff() AS is_staff))",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR ( SELECT security.is_staff() AS is_staff))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_performance_snapshots.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(product_performance_snapshots.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "( SELECT security.can_access_merchant(product_performance_snapshots.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "product_performance_snapshots",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.product_platform_listings.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_platform_listings",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_listings.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "product_platform_listings",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_listings.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_platform_listings",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_listings.identity_scoped_update",
    "baseline": null,
    "production": {
      "name": "identity_scoped_update",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "product_platform_listings",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_listings.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_platform_listings",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{products,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.product_platform_listings.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(product_platform_listings.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "product_platform_listings",
      "using": "( SELECT security.can_access_merchant(product_platform_listings.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "product_platform_listings",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.product_platform_prices.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_prices.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_prices.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_prices.identity_scoped_update",
    "baseline": null,
    "production": {
      "name": "identity_scoped_update",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.product_platform_prices.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "security.has_platform_permission('edit_merchants'::text)",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.product_platform_prices.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_finance}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{products,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.product_platform_prices.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "security.has_platform_permission('edit_merchants'::text)",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "security.has_platform_permission('edit_merchants'::text)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.product_platform_prices.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(product_platform_prices.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "( SELECT security.can_access_merchant(product_platform_prices.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "product_platform_prices",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.products.identity_scoped_delete",
    "baseline": null,
    "production": {
      "name": "identity_scoped_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "products",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.products.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "products",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.products.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "products",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.products.identity_scoped_update",
    "baseline": null,
    "production": {
      "name": "identity_scoped_update",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "products",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.products.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "products",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.products.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "products",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{products,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.products.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "products",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.products.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(products.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "products",
      "using": "( SELECT security.can_access_merchant(products.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "products",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.returns.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)))",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.returns.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.returns.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants,view_finance,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{orders,statement,dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (( SELECT security.has_any_platform_permission('{view_merchants,view_finance,view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{orders,statement,dashboard}'::text[]) AS current_has_any_merchant_permission))) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.returns.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "((merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)) OR security.has_platform_permission('upload_files'::text))",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT security.current_merchant_code() AS current_merchant_code)) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)) OR security.has_platform_permission('upload_files'::text))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.returns.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(returns.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "( SELECT security.can_access_merchant(returns.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "returns",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.sales_targets.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "sales_targets",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)))",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sales_targets.sellpert_insert_access",
    "baseline": null,
    "production": {
      "name": "sellpert_insert_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)))",
      "roles": "{authenticated}",
      "table": "sales_targets",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sales_targets.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "sales_targets",
      "using": "(( SELECT security.has_any_platform_permission('{view_merchants}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{dashboard}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "sales_targets",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (( SELECT security.has_any_platform_permission('{view_merchants}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{dashboard}'::text[]) AS current_has_any_merchant_permission))) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sales_targets.sellpert_update_access",
    "baseline": null,
    "production": {
      "name": "sellpert_update_access",
      "check": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)))",
      "roles": "{authenticated}",
      "table": "sales_targets",
      "using": "(( SELECT security.is_staff() AS is_staff) OR (merchant_code = ( SELECT merchants.merchant_code\n   FROM merchants\n  WHERE (merchants.id = ( SELECT auth.uid() AS uid))\n LIMIT 1)))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sales_targets.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(sales_targets.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "sales_targets",
      "using": "( SELECT security.can_access_merchant(sales_targets.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "sales_targets",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.salla_connections.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(salla_connections.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "salla_connections",
      "using": "( SELECT security.can_access_merchant(salla_connections.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "salla_connections",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.sync_logs.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "sync_logs",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_logs.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "sync_logs",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_logs.sellpert_insert_access",
    "baseline": null,
    "production": {
      "name": "sellpert_insert_access",
      "check": "security.is_admin()",
      "roles": "{authenticated}",
      "table": "sync_logs",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_logs.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "sync_logs",
      "using": "(( SELECT security.has_any_platform_permission('{view_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{integrations}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.sync_logs.sellpert_update_access",
    "baseline": null,
    "production": {
      "name": "sellpert_update_access",
      "check": "security.is_admin()",
      "roles": "{authenticated}",
      "table": "sync_logs",
      "using": "( SELECT security.is_staff() AS is_staff)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_logs.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(sync_logs.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "sync_logs",
      "using": "( SELECT security.can_access_merchant(sync_logs.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "sync_logs",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.sync_queue.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "sync_queue",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_queue.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "sync_queue",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_queue.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "sync_queue",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,upload_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{integrations}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.sync_queue.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(sync_queue.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "sync_queue",
      "using": "( SELECT security.can_access_merchant(sync_queue.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "sync_queue",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.sync_requests.identity_scoped_insert",
    "baseline": null,
    "production": {
      "name": "identity_scoped_insert",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "sync_requests",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_requests.identity_scoped_select",
    "baseline": null,
    "production": {
      "name": "identity_scoped_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "sync_requests",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_requests.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "sync_requests",
      "using": "(( SELECT security.has_any_platform_permission('{view_files,upload_files}'::text[]) AS has_any_platform_permission) OR ((NOT ( SELECT security.is_platform_staff_account() AS is_platform_staff_account)) AND ( SELECT security.current_has_any_merchant_permission('{integrations}'::text[]) AS current_has_any_merchant_permission)))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.sync_requests.sellpert_update_access",
    "baseline": null,
    "production": {
      "name": "sellpert_update_access",
      "check": "security.is_admin()",
      "roles": "{authenticated}",
      "table": "sync_requests",
      "using": "security.is_admin()",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.sync_requests.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(sync_requests.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "sync_requests",
      "using": "( SELECT security.can_access_merchant(sync_requests.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "sync_requests",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  },
  {
    "key": "public.task_comments.sellpert_delete_access",
    "baseline": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.task_comments.sellpert_insert_access",
    "baseline": {
      "name": "sellpert_insert_access",
      "check": "(security.has_platform_permission('tasks'::text) OR (( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission) OR ((NOT is_internal) AND (EXISTS ( SELECT 1\n   FROM merchant_requests request\n  WHERE ((request.id = task_comments.task_id) AND security.can_access_merchant(request.merchant_code)))))))",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.task_comments.sellpert_select_access",
    "baseline": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "(security.has_any_platform_permission('{tasks,crm}'::text[]) OR (( SELECT security.has_any_platform_permission(ARRAY['tasks'::text, 'crm'::text]) AS has_any_platform_permission) OR ((NOT is_internal) AND (EXISTS ( SELECT 1\n   FROM merchant_requests request\n  WHERE ((request.id = task_comments.task_id) AND security.can_access_merchant(request.merchant_code)))))))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.task_comments.sellpert_update_access",
    "baseline": {
      "name": "sellpert_update_access",
      "check": "(security.has_platform_permission('tasks'::text) OR ( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission))",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "(security.has_platform_permission('tasks'::text) OR ( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission))",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    },
    "production": null
  },
  {
    "key": "public.task_comments.task_comments_delete",
    "baseline": null,
    "production": {
      "name": "task_comments_delete",
      "check": "",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.task_comments.task_comments_insert",
    "baseline": null,
    "production": {
      "name": "task_comments_insert",
      "check": "(( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission) OR ((NOT is_internal) AND (EXISTS ( SELECT 1\n   FROM merchant_requests request\n  WHERE ((request.id = task_comments.task_id) AND security.can_access_merchant(request.merchant_code))))))",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.task_comments.task_comments_select",
    "baseline": null,
    "production": {
      "name": "task_comments_select",
      "check": "",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "(( SELECT security.has_any_platform_permission(ARRAY['tasks'::text, 'crm'::text]) AS has_any_platform_permission) OR ((NOT is_internal) AND (EXISTS ( SELECT 1\n   FROM merchant_requests request\n  WHERE ((request.id = task_comments.task_id) AND security.can_access_merchant(request.merchant_code))))))",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.task_comments.task_comments_update",
    "baseline": null,
    "production": {
      "name": "task_comments_update",
      "check": "( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission)",
      "roles": "{authenticated}",
      "table": "task_comments",
      "using": "( SELECT security.has_platform_permission('tasks'::text) AS has_platform_permission)",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.webhook_events.sellpert_delete_access",
    "baseline": null,
    "production": {
      "name": "sellpert_delete_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "webhook_events",
      "using": "false",
      "schema": "public",
      "command": "DELETE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.webhook_events.sellpert_insert_access",
    "baseline": null,
    "production": {
      "name": "sellpert_insert_access",
      "check": "false",
      "roles": "{authenticated}",
      "table": "webhook_events",
      "using": "",
      "schema": "public",
      "command": "INSERT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.webhook_events.sellpert_select_access",
    "baseline": null,
    "production": {
      "name": "sellpert_select_access",
      "check": "",
      "roles": "{authenticated}",
      "table": "webhook_events",
      "using": "false",
      "schema": "public",
      "command": "SELECT",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.webhook_events.sellpert_update_access",
    "baseline": null,
    "production": {
      "name": "sellpert_update_access",
      "check": "false",
      "roles": "{authenticated}",
      "table": "webhook_events",
      "using": "false",
      "schema": "public",
      "command": "UPDATE",
      "permissive": "PERMISSIVE"
    }
  },
  {
    "key": "public.webhook_events.tenant_boundary",
    "baseline": {
      "name": "tenant_boundary",
      "check": "( SELECT security.can_access_merchant(webhook_events.merchant_code) AS can_access_merchant)",
      "roles": "{authenticated}",
      "table": "webhook_events",
      "using": "( SELECT security.can_access_merchant(webhook_events.merchant_code) AS can_access_merchant)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    },
    "production": {
      "name": "tenant_boundary",
      "check": "security.can_access_merchant(merchant_code)",
      "roles": "{authenticated}",
      "table": "webhook_events",
      "using": "security.can_access_merchant(merchant_code)",
      "schema": "public",
      "command": "ALL",
      "permissive": "RESTRICTIVE"
    }
  }
]
$policy_manifest$::jsonb)
 LOOP
  expected := nullif(entry->'baseline', 'null'::jsonb);
  desired := nullif(entry->'production', 'null'::jsonb);
  target_schema := coalesce(desired->>'schema', expected->>'schema');
  target_table := coalesce(desired->>'table', expected->>'table');
  target_name := coalesce(desired->>'name', expected->>'name');
  SELECT jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,
    'permissive',permissive,'roles',roles::text,'command',cmd,
    'using',coalesce(qual,''),'check',coalesce(with_check,''))
  INTO observed FROM pg_policies
  WHERE schemaname=target_schema AND tablename=target_table AND policyname=target_name;
  IF observed IS NOT DISTINCT FROM desired THEN CONTINUE; END IF;
  IF observed IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Unreviewed policy state for %.%; stop for review', target_table,target_name;
  END IF;
  IF observed IS NOT NULL THEN
    EXECUTE format('DROP POLICY %I ON %I.%I',target_name,target_schema,target_table);
  END IF;
  IF desired IS NOT NULL THEN
    SELECT string_agg(format('%I',role_name), ', ') INTO role_list
    FROM unnest(string_to_array(trim(both '{}' from desired->>'roles'),',')) role_name;
    IF desired->>'permissive' NOT IN ('PERMISSIVE','RESTRICTIVE')
       OR desired->>'command' NOT IN ('ALL','SELECT','INSERT','UPDATE','DELETE')
       OR role_list IS NULL THEN RAISE EXCEPTION 'Invalid reviewed policy metadata'; END IF;
    ddl := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      target_name,target_schema,target_table,desired->>'permissive',desired->>'command',role_list);
    IF desired->>'using' <> '' THEN ddl := ddl || ' USING (' || (desired->>'using') || ')'; END IF;
    IF desired->>'check' <> '' THEN ddl := ddl || ' WITH CHECK (' || (desired->>'check') || ')'; END IF;
    EXECUTE ddl;
  END IF;
 END LOOP;
END $policy_compatibility$;
