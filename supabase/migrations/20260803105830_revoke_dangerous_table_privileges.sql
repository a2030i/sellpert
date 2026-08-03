-- RLS does not govern TRUNCATE, REFERENCES, or TRIGGER. Browser roles never
-- need these table-level privileges, so revoke them from every exposed table.
do $$
declare
  table_row record;
begin
  for table_row in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, references, trigger on table %I.%I from anon, authenticated',
      table_row.schemaname,
      table_row.tablename
    );
  end loop;
end
$$;

-- Keep future tables safe when migrations are run by the normal postgres owner.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
