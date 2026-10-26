-- 26/10 chiều — LẬP PHIẾU NHẬP TRẢ NGUYÊN TỬ (C104).
-- Bản đầu kiểm "trả ≤ đã xuất − đã khai trả" trong Node rồi mới ghi ⇒ hai người lập cùng lúc trên cùng
-- dòng (DO × mã) đều qua: đo trên Preview, đã xuất 10 thùng mà khai trả 13. Hàm này khoá THEO CHUYẾN GỐC
-- (advisory lock trong giao dịch), đếm lại phần đã khai DƯỚI khoá rồi mới ghi đầu phiếu + phiếu nhập + dòng
-- khai trong CÙNG một giao dịch. Lập tay (không chuyến) không có trần nên không khoá.
--   p_limits  {"<od>||<material_id>": shipped_base} — số đã xuất của chuyến (chuyến COMPLETED, không đổi nữa)
--   trả 'OK' | 'OVER|<od>||<material_id>|<còn trả được>'; trùng số phiếu ⇒ 23505 ném ra, Node đặt số mới rồi thử lại.
-- Đã khai = dòng khai còn phiếu nhập (chưa huỷ / chưa xoá) — cùng luật với loadTrip.
-- Kèm (C105): huỷ phiếu nhập trả XOÁ dòng ProductionImport ⇒ dòng khai còn lại với import_order_id NULL và bản đầu
-- vẫn đếm là "đã khai" (số còn trả được không hoàn lại). Code nay xoá dòng khai khi huỷ; dọn dòng mồ côi cũ ở đây.
DELETE FROM public.inbound_return_line WHERE import_order_id IS NULL;
DELETE FROM public.inbound_return r WHERE NOT EXISTS (SELECT 1 FROM public."ProductionImport" pi WHERE pi.return_id = r.id);
CREATE OR REPLACE FUNCTION public.inbound_return_create(
  p_head jsonb, p_imports jsonb, p_lines jsonb, p_gdo_id text DEFAULT NULL, p_limits jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  k text; shipped numeric; od text; mid text; done numeric; want numeric;
BEGIN
  IF p_gdo_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('inbound_return:' || p_gdo_id));
    FOR k, shipped IN SELECT key, value::numeric FROM jsonb_each_text(COALESCE(p_limits, '{}'::jsonb)) LOOP
      od  := split_part(k, '||', 1);
      mid := split_part(k, '||', 2);
      SELECT COALESCE(SUM(l.qty_base), 0) INTO done
      FROM inbound_return_line l
      JOIN inbound_return r     ON r.id = l.return_id
      JOIN "ProductionImport" pi ON pi.id = l.import_order_id
      WHERE r.gdo_id = p_gdo_id AND COALESCE(l.od_number, '') = od AND l.material_id = mid AND pi.status <> 'CANCELLED';
      SELECT COALESCE(SUM((x->>'qty_base')::numeric), 0) INTO want
      FROM jsonb_array_elements(p_lines) x
      WHERE COALESCE(x->>'od_number', '') = od AND x->>'material_id' = mid;
      IF want > shipped - done + 1e-9 THEN
        RETURN 'OVER|' || k || '|' || GREATEST(shipped - done, 0)::text;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO inbound_return (id, return_code, warehouse_id, gdo_id, group_code, ship_to_code, ship_to_name, reason, qa_hold,
                              created_by, created_by_name, created_at, updated_at)
  SELECT h.id, h.return_code, h.warehouse_id, h.gdo_id, h.group_code, h.ship_to_code, h.ship_to_name, h.reason, COALESCE(h.qa_hold, false),
         h.created_by, h.created_by_name, h.created_at, h.updated_at
  FROM jsonb_populate_record(NULL::inbound_return, p_head) h;

  INSERT INTO "ProductionImport" (id, import_code, warehouse_id, material_id, planned_cartons, status, source_type, warehouse_type,
                                  import_date, return_id, notes, created_by, updated_by, created_at, updated_at)
  SELECT i.id, i.import_code, i.warehouse_id, i.material_id, i.planned_cartons, i.status, i.source_type, i.warehouse_type,
         i.import_date, i.return_id, i.notes, i.created_by, i.updated_by, i.created_at, i.updated_at
  FROM jsonb_populate_recordset(NULL::"ProductionImport", p_imports) i;

  INSERT INTO inbound_return_line (id, return_id, od_number, material_id, qty_base, shipped_base, import_order_id, created_at, updated_at)
  SELECT l.id, l.return_id, l.od_number, l.material_id, l.qty_base, l.shipped_base, l.import_order_id, l.created_at, l.updated_at
  FROM jsonb_populate_recordset(NULL::inbound_return_line, p_lines) l;

  RETURN 'OK';
END;
$function$;
