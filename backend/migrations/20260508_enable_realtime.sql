-- Enable Supabase Realtime for ALL current public tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    EXCEPTION WHEN others THEN
      NULL; -- already in publication, skip
    END;
  END LOOP;
END $$;

-- Auto-add any NEW table created in public schema to Realtime publication
CREATE OR REPLACE FUNCTION _auto_add_table_to_realtime()
RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.command_tag = 'CREATE TABLE' AND obj.schema_name = 'public' THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', obj.object_identity);
    END IF;
  END LOOP;
END $$;

DROP EVENT TRIGGER IF EXISTS auto_realtime_new_tables;
CREATE EVENT TRIGGER auto_realtime_new_tables
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION _auto_add_table_to_realtime();
