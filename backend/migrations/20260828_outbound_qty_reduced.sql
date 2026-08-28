-- GHI VẾT KHI HẠ SỐ LƯỢNG ĐƠN XUẤT (28/08)
--
-- Vì sao cần: luật hiện hành "xuất thiếu thì hạ SL đơn = thực xuất mới cho Hoàn thành" khiến dữ
-- liệu sau khi hoàn thành LUÔN nói giao đủ 100% (đo staging: 24.459/24.459 dòng COMPLETED khớp
-- tuyệt đối, 0 dòng lệch). Tức là app đang XOÁ DẤU VẾT của chính chỉ số quan trọng nhất chuỗi
-- cung ứng — fill rate / OTIF. Không có vết thì không đo được, không đo được thì không cải thiện.
--
-- Vì sao TRIGGER chứ không phải ghi trong controller: `cartons_ordered` bị hạ qua NHIỀU đường —
-- sửa đơn (2 nhánh multi-DO / single-DO trong updateGDO), SAP dội xuống khi sửa DO ở tab DO SAP,
-- và script vá dữ liệu. Ghi ở tầng ứng dụng thì mỗi đường mới mở ra là một lỗ hổng lặng lẽ; chặn
-- ở DB thì KHÔNG đường nào lách được (luật "bug chết hai lần" — đây là ràng buộc máy móc).
--
-- Phân loại ngay trong trigger để báo cáo chỉ việc gom theo event_type, không phải bóc chuỗi:
--   QTY_REDUCED_TO_ACTUAL — hạ đúng bằng số đã xuất  ⇒ GIAO THIẾU (cái ta cần đo)
--   QTY_REDUCED_PLAN      — hạ khi chưa xuất dòng nào ⇒ cắt kế hoạch, không phải lỗi phục vụ
--   QTY_REDUCED           — còn lại (hạ một phần khi đang xuất dở)
--
-- Hạn chế đã biết: trigger không biết AI thao tác (backend gọi bằng service_role, không mang danh
-- tính người dùng xuống DB) nên `actor` để trống; người gần đúng nhất là `GroupDeliveryOrder.
-- updated_by` tại thời điểm đó. Đổi lại là không bao giờ sót — đánh đổi có chủ đích.

CREATE OR REPLACE FUNCTION public.log_outbound_qty_reduced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_gdo_id text; v_group text; v_do text; v_scanned numeric; v_type text;
BEGIN
  IF NEW.cartons_ordered IS NULL OR OLD.cartons_ordered IS NULL THEN RETURN NEW; END IF;
  IF NEW.cartons_ordered >= OLD.cartons_ordered THEN RETURN NEW; END IF;

  v_scanned := COALESCE(NEW.cartons_scanned, 0);
  v_type := CASE
    WHEN v_scanned > 0 AND NEW.cartons_ordered = v_scanned THEN 'QTY_REDUCED_TO_ACTUAL'
    WHEN v_scanned = 0                                     THEN 'QTY_REDUCED_PLAN'
    ELSE 'QTY_REDUCED' END;

  SELECT d.gdo_id, g.group_code, d.delivery_code
    INTO v_gdo_id, v_group, v_do
  FROM "OutboundDelivery" d
  LEFT JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
  WHERE d.id = NEW.do_id;

  INSERT INTO outbound_events
    (id, gdo_id, group_code, event_type, source, actor, do_number, material_code,
     old_value, new_value, detail, created_at, updated_at)
  VALUES
    (gen_random_uuid()::text, v_gdo_id, COALESCE(v_group, '?'), v_type, 'WMS', NULL,
     v_do, NEW.material_code_raw,
     OLD.cartons_ordered::text, NEW.cartons_ordered::text,
     format('Hạ SL đơn %s → %s (đã xuất %s)', OLD.cartons_ordered, NEW.cartons_ordered, v_scanned),
     now(), now());

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_outbound_qty_reduced ON public."OutboundItem";
CREATE TRIGGER trg_outbound_qty_reduced
  AFTER UPDATE OF cartons_ordered ON public."OutboundItem"
  FOR EACH ROW EXECUTE FUNCTION public.log_outbound_qty_reduced();

-- Báo cáo fill rate lọc theo (event_type, thời gian) và gom theo chuyến
CREATE INDEX IF NOT EXISTS idx_outbound_events_type_time
  ON public.outbound_events (event_type, created_at DESC);
