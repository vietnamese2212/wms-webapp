-- ĐƯỜNG LUI cho 20260902d — CHỈ cần khi quay về cơ chế postgres_changes cũ (đi CÙNG 20260902c_…_ROLLBACK.sql,
-- vì postgres_changes còn đòi policy SELECT). Broadcast từ trigger KHÔNG phụ thuộc publication này.
-- Phần thu EXECUTE hàm KHÔNG hoàn lại: frontend không gọi RPC nào, backend đi service_role đã được cấp.

-- 1. Đưa lại 73 bảng vào publication (danh sách chụp trên staging 02/09 trước khi bỏ).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ApiKey','Attendance','DeliverySlot','Department','EmployeeSkill','FillOrder','FillTask','FillTaskScan',
    'GroupDeliveryOrder','ImportShift','InventoryAdjustmentLog','InventoryEntry','JobTitle','LeaveRequest','Location',
    'LookupValue','Manufacturer','Material','OutboundDelivery','OutboundItem','OutboundScanEntry','PalletLabelPrint',
    'PalletOperation','ProductionImport','QAStatus','ShiftRestRule','Skill','SlotTemplate','SlottingPlan','SlottingPlanLine',
    'StocktakeLog','SystemSetting','TmsOrder','TmsVehicleSlot','TransportCompany','UserWarehouseAccess','Vehicle',
    'VehicleType','Warehouse','WarehouseZone','WeighTicket','WorkAssignment','WorkAssignmentDemand','WorkAssignmentSheet',
    'WorkLayout','WorkLayoutJobTitle','WorkLayoutSkill','_prisma_migrations','alert_events','base_unit_flip_round_report',
    'dashboard_cache','erp_outbound_orders','error_logs','forklift_checklist_items','forklift_daily_logs','forklift_vehicles',
    'gate_registrations','inbound_plan_lines','khvc_lines','notification_prefs','outbound_events','packing_logs','packing_runs',
    'push_config','push_subscriptions','receipt_ratings','reconcile_tasks','trace_investigations','user_notifications',
    'warehouse_cost_locks','warehouse_costs','warehouse_machines','warehouse_type_configs'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- 2. Event trigger: add publication trở lại cho bảng mới (bản 20260902b).
CREATE OR REPLACE FUNCTION public._auto_add_table_to_realtime() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF obj.command_tag = 'CREATE TABLE' AND obj.schema_name = 'public' THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', obj.object_identity);
      EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s '
                     'FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change()', obj.object_identity);
    END IF;
  END LOOP;
END $$;
