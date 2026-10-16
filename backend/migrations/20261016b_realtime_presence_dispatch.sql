-- 16/10/2026 tối — AI ĐANG LÀM trên một kế hoạch điều vận (user: "hiện tên người đang làm ok").
-- Presence của Supabase Realtime trên kênh riêng tư `wms-dispatch-<plan_id>`: mỗi bàn đang mở kế hoạch đó "track" { name, mode }
-- (mode = sửa / xem); không ghi DB, không đi qua PostgREST (quota egress). Kênh riêng tư ⇒ cần policy trên realtime.messages
-- cho extension 'presence' (SELECT để nhận, INSERT để track) — cùng khuôn hai policy broadcast 20260902b, chỉ vai authenticated
-- (= có vé realtime do backend cấp). Không chạm bảng public nào (gói QA 00 10b/10c soi schema public).
DROP POLICY IF EXISTS wms_presence_dispatch_read ON realtime.messages;
CREATE POLICY wms_presence_dispatch_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() LIKE 'wms-dispatch-%' AND extension = 'presence');

DROP POLICY IF EXISTS wms_presence_dispatch_write ON realtime.messages;
CREATE POLICY wms_presence_dispatch_write ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (realtime.topic() LIKE 'wms-dispatch-%' AND extension = 'presence');
