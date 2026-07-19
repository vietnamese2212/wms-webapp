-- Chiến dịch BASE UNIT — Đợt 0: khai báo ĐVT trên Mã hàng (kế hoạch: BASE_UNIT_EXECUTION_PLAN.md)
-- base_unit = đơn vị gốc (LƯU TRỮ/TÍNH TOÁN sau đợt 2); entry_unit = đơn vị nhập liệu (CHỈ hiển thị).
-- Hệ số 1 Entry = N Base dùng lại cột units_per_carton (không tạo cột trùng nghĩa).
-- Backfill theo rule user chốt 19/07: TP+SCA → HOP (mã "chai" → BT), entry CAR khi có hệ số;
-- Pallet Loscam → EA không entry; các loại khác giữ đơn vị hiện tại, không entry.

ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS base_unit text;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS entry_unit text;

-- 1) Pallet Loscam: EA, không entry (đặt trước để không dính rule thành phẩm)
UPDATE "Material" SET base_unit = 'EA', entry_unit = NULL
WHERE (material_description ILIKE '%loscam%' OR short_name ILIKE '%loscam%')
  AND base_unit IS NULL;

-- 2) Thành phẩm + SCA: chai → BT, còn lại HOP; entry CAR khi có hệ số hộp/thùng
UPDATE "Material" SET
  base_unit  = CASE WHEN material_description ILIKE '%chai%' OR short_name ILIKE '%chai%' THEN 'BT' ELSE 'HOP' END,
  entry_unit = CASE WHEN units_per_carton IS NOT NULL AND units_per_carton > 0 THEN 'CAR' ELSE NULL END
WHERE category IN ('Thành phẩm', 'SCA') AND base_unit IS NULL;

-- 3) Còn lại: base = đơn vị hiện tại (chuẩn hóa Kg/KG), không entry
UPDATE "Material" SET base_unit = CASE
    WHEN upper(trim(COALESCE(unit, ''))) = 'KG' THEN 'KG'
    WHEN trim(COALESCE(unit, '')) <> '' THEN trim(unit)
    ELSE 'EA' END
WHERE base_unit IS NULL;
