-- ============================================================================
-- 20260902b — REALTIME CHUYỂN SANG BROADCAST TỪ TRIGGER DB (PHA 1: chỉ THÊM, không phá)
-- ============================================================================
-- VÌ SAO (kiểm định 02/09): cơ chế cũ `postgres_changes` bắt buộc người nghe phải có quyền SELECT
-- dòng đó, nên app phải mở 64 policy `FOR SELECT TO authenticated USING (true)` — và vé realtime
-- (JWT role=authenticated, nằm trong localStorage của MỌI tài khoản) trở thành chìa khoá gọi thẳng
-- PostgREST đọc trọn 58/73 bảng: chi phí kho, bảng công, nghỉ phép, tồn mọi kho, ma trận quyền…
-- vòng qua toàn bộ requirePerm + cắt scope của backend.
--
-- Frontend KHÔNG đọc bảng nào qua Supabase (0 chỗ `supabase.from(`); nó chỉ cần tín hiệu
-- "bảng X vừa đổi" để refetch qua API (đã cắt scope). Nên: trigger gửi gói tin TỐI THIỂU
-- {table, op} (+ row_id/booked_count cho đúng 2 bảng FE cần) vào kênh Broadcast RIÊNG TƯ,
-- rồi pha 2 (20260902c) thu hồi toàn bộ quyền đọc bảng của authenticated/anon.
--
-- AN TOÀN:
--  • `realtime.send` tự bọc EXCEPTION (chỉ RAISE WARNING) + hàm trigger bọc thêm một lớp
--    ⇒ hạ tầng realtime hỏng KHÔNG BAO GIỜ làm hỏng giao dịch nghiệp vụ.
--  • Trigger mức STATEMENT cho 60 bảng: upload 500 dòng = 1 tín hiệu (trước: 500 sự kiện).
--    Mức ROW chỉ cho 3 bảng cần dữ liệu dòng: DeliverySlot (row_id + booked_count để patch cache
--    khung giờ tức thì) · ProductionImport (row_id để dọn localStorage khi xoá) ·
--    user_notifications (định tuyến sang kênh cá nhân).
--  • Kênh cá nhân `wms-user-<employee_id>`: thông báo đích danh chỉ tới đúng người — không để
--    hàng trăm máy cùng refetch khi một người được giao việc, và không lộ ai-được-báo cho ai.
--  • Pha 1 để nguyên policy cũ + publication ⇒ hai cơ chế chạy song song, deploy FE xong mới
--    chạy pha 2. Publication `supabase_realtime` GIỮ NGUYÊN = đường lui tức thì.
-- ============================================================================

-- 1. Hàm trigger — payload KHÔNG BAO GIỜ chứa cột nghiệp vụ.
CREATE OR REPLACE FUNCTION public.wms_notify_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, realtime
AS $$
DECLARE
  v_payload jsonb;
  v_topic   text := 'wms-db-changes';
  v_row_id  text;
BEGIN
  BEGIN
    IF TG_LEVEL = 'ROW' THEN
      v_row_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
      IF TG_TABLE_NAME = 'user_notifications' THEN
        v_topic   := 'wms-user-' || (CASE WHEN TG_OP = 'DELETE' THEN OLD.employee_id ELSE NEW.employee_id END)::text;
        v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
      ELSIF TG_TABLE_NAME = 'DeliverySlot' THEN
        v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'row_id', v_row_id,
                       'booked_count', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.booked_count END);
      ELSE
        v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'row_id', v_row_id);
      END IF;
    ELSE
      v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
    END IF;
    PERFORM realtime.send(v_payload, 'db_change', v_topic, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'wms_notify_change bỏ qua (%): giao dịch nghiệp vụ không bị ảnh hưởng', SQLERRM;
  END;
  RETURN NULL;
END $$;

-- Trigger KHÔNG cần người ghi có EXECUTE (chỉ cần lúc CREATE TRIGGER) — đóng cho anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.wms_notify_change() FROM PUBLIC, anon, authenticated;

-- 2. Gắn trigger cho ĐÚNG các bảng frontend khai trong TABLE_QUERY_MAP (realtimeEvents.ts, 63 bảng).
--    Bảng chưa có trên môi trường (production từng lệch schema) → bỏ qua có thông báo, không fail.
DO $$
DECLARE
  t text;
  stmt_tables text[] := ARRAY[
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
    'warehouse_cost_locks'];
  row_tables text[] := ARRAY['DeliverySlot','ProductionImport','user_notifications'];
BEGIN
  FOREACH t IN ARRAY stmt_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'wms_notify: bỏ qua bảng chưa có trên môi trường này: %', t; CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_wms_notify ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change()', t);
  END LOOP;
  FOREACH t IN ARRAY row_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'wms_notify: bỏ qua bảng chưa có trên môi trường này: %', t; CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_wms_notify ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.wms_notify_change()', t);
  END LOOP;
END $$;

-- 3. Bảng MỚI tự nhận trigger (event trigger có sẵn từ đợt bật realtime): giữ ADD TABLE vào
--    publication làm đường lui; KHÔNG tạo policy SELECT cho authenticated — đó là lỗ hổng vừa đóng.
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

-- 4. Quyền NHẬN tin trên kênh riêng tư (realtime.messages RLS bật, 0 policy trước đó):
--    chỉ vai authenticated (= có vé do backend cấp); kênh cá nhân khớp đúng sub của vé.
DROP POLICY IF EXISTS wms_broadcast_shared ON realtime.messages;
CREATE POLICY wms_broadcast_shared ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'wms-db-changes' AND extension = 'broadcast');

DROP POLICY IF EXISTS wms_broadcast_personal ON realtime.messages;
CREATE POLICY wms_broadcast_personal ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'wms-user-' || (SELECT auth.uid())::text AND extension = 'broadcast');

-- 5. RPC cho bộ QA (gói 00): trạng thái realtime theo bảng — thêm `has_trigger` (nguồn sự thật mới),
--    giữ in_pub/rls/sel_pol để so sánh trong lúc chuyển đổi.
CREATE OR REPLACE FUNCTION public.realtime_readiness() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_object_agg(t.tablename, jsonb_build_object(
           'in_pub', t.in_pub, 'rls', t.rls, 'sel_pol', t.sel_pol, 'has_trigger', t.has_trigger)), '{}'::jsonb)
  FROM (
    SELECT c.relname AS tablename,
           EXISTS (SELECT 1 FROM pg_publication_tables pt
                   WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
                     AND pt.tablename = c.relname) AS in_pub,
           c.relrowsecurity AS rls,
           (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname
               AND p.cmd IN ('SELECT', 'ALL') AND p.roles::text LIKE '%authenticated%') AS sel_pol,
           EXISTS (SELECT 1 FROM pg_trigger tg
                   WHERE tg.tgrelid = c.oid AND tg.tgname = 'trg_wms_notify' AND NOT tg.tgisinternal) AS has_trigger
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ) t
$$;

-- 6. RPC cho bộ QA (gói 00): MỌI cửa đọc qua PostgREST còn mở cho anon/authenticated/PUBLIC —
--    quyền bảng (đọc từ relacl, không qua information_schema vì view đó chỉ hiện grant liên quan
--    tới role đang gọi) + policy + default ACL. Sau pha 2 cả 3 mảng PHẢI rỗng, và phải RỖNG MÃI.
CREATE OR REPLACE FUNCTION public.rest_exposure() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'table_privs', COALESCE((
      SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT c.relname || ':' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
               || ':' || a.privilege_type AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
          AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
      ) s), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(p.tablename || ':' || p.policyname ORDER BY p.tablename, p.policyname)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND (p.roles::text LIKE '%anon%' OR p.roles::text LIKE '%authenticated%' OR p.roles::text LIKE '%public%')
    ), '[]'::jsonb),
    'default_acl', COALESCE((
      SELECT jsonb_agg(pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text || ':' || a.privilege_type
                       || '→' || pg_get_userbyid(a.grantee))
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE n.nspname = 'public' AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
        AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
    ), '[]'::jsonb)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.realtime_readiness() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rest_exposure()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.realtime_readiness() TO service_role;
GRANT  EXECUTE ON FUNCTION public.rest_exposure()      TO service_role;
