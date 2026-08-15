-- 20260805g — fill_task_topup: ĐƠN PHÁT SINH → ra lệnh trùng (kho, ngày xuất, mã, date) đang treo
-- thì CỘNG DỒN vào dòng cũ thay vì bắt hủy-tạo-lại (user chốt 05/08). Một câu UPDATE nguyên tử
-- (qty = qty + delta dưới row-lock của chính UPDATE — không đọc-rồi-ghi, 2 người cộng cùng lúc
-- đều ăn); điều kiện status='PENDING' để không hồi sinh dòng vừa DONE/hủy — trả NULL thì caller
-- thử INSERT lại (unique đã nhả).
CREATE OR REPLACE FUNCTION fill_task_topup(
  p_warehouse_id  text,
  p_target_date   date,
  p_material_id   text,
  p_required_date date,      -- NULL = dòng không ràng date
  p_add_qty       numeric,
  p_add_pallets   int,
  p_now           text       -- ISO UTC
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE t "FillTask"%ROWTYPE;
BEGIN
  IF COALESCE(p_add_qty, 0) <= 0 OR COALESCE(p_add_pallets, 0) <= 0 THEN RETURN NULL; END IF;
  UPDATE "FillTask" SET
    qty_base         = qty_base + p_add_qty,
    required_pallets = required_pallets + p_add_pallets,
    updated_at       = p_now::timestamptz
  WHERE warehouse_id = p_warehouse_id
    AND target_date  = p_target_date
    AND material_id  = p_material_id
    AND required_date IS NOT DISTINCT FROM p_required_date
    AND status = 'PENDING'
  RETURNING * INTO t;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(t);
END $$;
