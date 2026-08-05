BEGIN;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('account_transactions','raw','net_amount'),
      ('ad_metrics','raw','spend'),
      ('inbound_shipments','raw','expected_qty'),
      ('goods_received','raw','grn_quantity'),
      ('webhook_events','payload','status')
    ) AS checks(table_name, private_column, normalized_column)
  LOOP
    IF has_column_privilege('authenticated','public.' || item.table_name,item.private_column,'SELECT') THEN
      RAISE EXCEPTION 'browser role can read private %.%', item.table_name, item.private_column;
    END IF;
    IF NOT has_column_privilege('authenticated','public.' || item.table_name,item.normalized_column,'SELECT') THEN
      RAISE EXCEPTION 'browser role lost normalized %.%', item.table_name, item.normalized_column;
    END IF;
    IF NOT has_column_privilege('service_role','public.' || item.table_name,item.private_column,'SELECT') THEN
      RAISE EXCEPTION 'trusted worker lost private %.%', item.table_name, item.private_column;
    END IF;
  END LOOP;
END
$$;

ROLLBACK;
