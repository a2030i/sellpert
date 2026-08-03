-- Multiple permissive policies for the same table/action are OR-ed by
-- PostgreSQL, but every policy expression is evaluated independently. The
-- historical migrations accumulated hundreds of overlapping policies. Merge
-- them into one equivalent policy per table and command while preserving all
-- restrictive policies unchanged.

CREATE TEMP TABLE sellpert_policy_snapshot ON COMMIT DROP AS
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND permissive = 'PERMISSIVE'
  AND roles = ARRAY['authenticated']::name[];

DO $drop_old_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN SELECT * FROM sellpert_policy_snapshot
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END
$drop_old_policies$;

DO $create_consolidated_policies$
DECLARE
  table_row record;
  action_name text;
  using_expression text;
  check_expression text;
  policy_sql text;
BEGIN
  FOR table_row IN
    SELECT DISTINCT schemaname, tablename
    FROM sellpert_policy_snapshot
    ORDER BY schemaname, tablename
  LOOP
    FOREACH action_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      SELECT
        string_agg(
          format('(%s)', COALESCE(qual, 'true')),
          ' OR ' ORDER BY policyname
        ),
        string_agg(
          format('(%s)', COALESCE(with_check, qual, 'true')),
          ' OR ' ORDER BY policyname
        )
      INTO using_expression, check_expression
      FROM sellpert_policy_snapshot
      WHERE schemaname = table_row.schemaname
        AND tablename = table_row.tablename
        AND cmd IN ('ALL', action_name);

      IF using_expression IS NULL THEN
        CONTINUE;
      END IF;

      policy_sql := format(
        'CREATE POLICY %I ON %I.%I FOR %s TO authenticated',
        'sellpert_' || lower(action_name) || '_access',
        table_row.schemaname,
        table_row.tablename,
        action_name
      );

      IF action_name IN ('SELECT', 'UPDATE', 'DELETE') THEN
        policy_sql := policy_sql || format(' USING (%s)', using_expression);
      END IF;
      IF action_name IN ('INSERT', 'UPDATE') THEN
        policy_sql := policy_sql || format(' WITH CHECK (%s)', check_expression);
      END IF;

      EXECUTE policy_sql;
    END LOOP;
  END LOOP;
END
$create_consolidated_policies$;
