-- ============================================================================
-- ROLLBACK cho 20260902c — KHÔNG apply trừ khi cần QUAY LẠI cơ chế postgres_changes.
-- ============================================================================
-- Dùng khi: broadcast không giao được sự kiện trên môi trường nào đó mà chưa tìm ra nguyên nhân,
-- cần realtime sống lại ngay bằng đường cũ. Kèm: git revert commit FE về `postgres_changes`.
-- Publication `supabase_realtime` vẫn còn đủ bảng (pha 1/2 không đụng) nên chỉ cần mở lại quyền đọc
-- + policy là postgres_changes gửi lại ngay. Trigger broadcast để nguyên — vô hại khi không ai nghe.
--
-- ⚠ Đây là mở lại đúng lỗ hổng đã đóng (mọi user đăng nhập đọc trọn 63 bảng qua PostgREST).
--    Chỉ dùng tạm, có thời hạn.
-- ============================================================================

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE SELECT ON public."Employee", public."ApiKey" FROM authenticated;   -- 2 bảng chưa từng mở

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'InventoryEntry','StocktakeLog','Location','FillTask','FillOrder','Material','Manufacturer',
    'PalletLabelPrint','PalletOperation','InventoryAdjustmentLog','Warehouse','WarehouseZone',
    'LookupValue','ImportShift','QAStatus','SystemSetting','VehicleType','SlotTemplate',
    'TransportCompany','Vehicle','TmsOrder','TmsVehicleSlot','gate_registrations','alert_events',
    'inbound_plan_lines','GroupDeliveryOrder','OutboundDelivery','OutboundItem','OutboundScanEntry',
    'reconcile_tasks','erp_outbound_orders','outbound_events','khvc_lines','WeighTicket',
    'SlottingPlan','SlottingPlanLine','forklift_vehicles','forklift_checklist_items',
    'forklift_daily_logs','packing_logs','packing_runs','warehouse_machines','JobTitle','Department',
    'UserWarehouseAccess','Skill','EmployeeSkill','LeaveRequest','WorkAssignmentSheet',
    'WorkAssignmentDemand','WorkAssignment','WorkLayout','WorkLayoutSkill','WorkLayoutJobTitle',
    'ShiftRestRule','Attendance','receipt_ratings','trace_investigations','warehouse_costs',
    'warehouse_cost_locks','DeliverySlot','ProductionImport']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS rls_auth_select ON public.%I', t);
    EXECUTE format('CREATE POLICY rls_auth_select ON public.%I FOR SELECT TO authenticated USING (true)', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS rls_own_select ON public.user_notifications;
CREATE POLICY rls_own_select ON public.user_notifications
  FOR SELECT TO authenticated USING (employee_id = auth.uid());
