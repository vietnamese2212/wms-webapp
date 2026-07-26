-- 20260726 — SỬA LỖI 500 khi gõ từ khóa NGẮN/PHỔ BIẾN vào ô tìm kiếm (Tồn kho, Nhập kho).
--
-- Nguyên nhân gốc (đo 26/07 trên staging): omni-search resolve term → danh sách material_id/location_id
-- rồi nhét vào filter PostgREST `material_id.in.(…)`. Term phổ biến khớp >350 mã (vd "51" → 371 mã,
-- "-" → 453, "_" → 374, "a" → 500) ⇒ URL filter >13KB ⇒ PostgREST/gateway từ chối ⇒ API trả 500,
-- trang Tồn kho/Nhập kho lỗi trắng. Rất dễ gặp: mã pallet V1 toàn dấu "_", DO có dấu "-",
-- và người dùng hay gõ 2–3 ký tự đầu.
--
-- Cách sửa: THU HẸP danh sách id về đúng những id THỰC SỰ xuất hiện trong bảng dữ liệu
-- (mã có tồn / mã có phiếu nhập). KHÔNG mất dòng nào — id không xuất hiện thì cũng không thể khớp
-- dòng nào. Đo thực tế: "-" 453 → 38 mã, "_" (vị trí) 194 → 171. DISTINCT phải làm trong DB
-- (PostgREST không có DISTINCT và select thô bị cap 1000 dòng → thiếu id = MẤT DÒNG âm thầm).

CREATE OR REPLACE FUNCTION omni_narrow_material_ids(p_ids text[])
RETURNS TABLE(id text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT e.material_id FROM "InventoryEntry" e
  WHERE e.material_id = ANY(p_ids) AND e.material_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION omni_narrow_location_ids(p_ids text[])
RETURNS TABLE(id text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT e.location_id FROM "InventoryEntry" e
  WHERE e.location_id = ANY(p_ids) AND e.location_id IS NOT NULL
$$;

-- Nhập kho tìm theo mã hàng → thu hẹp về mã CÓ PHIẾU NHẬP (không dùng tồn: phiếu cũ có thể đã xuất hết)
CREATE OR REPLACE FUNCTION omni_narrow_import_material_ids(p_ids text[])
RETURNS TABLE(id text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT p.material_id FROM "ProductionImport" p
  WHERE p.material_id = ANY(p_ids) AND p.material_id IS NOT NULL
$$;

COMMENT ON FUNCTION omni_narrow_material_ids(text[])        IS 'Thu hẹp id mã hàng của omni-search về mã có mặt trong InventoryEntry (chống URL filter quá dài → 500).';
COMMENT ON FUNCTION omni_narrow_location_ids(text[])        IS 'Thu hẹp id vị trí của omni-search về vị trí có mặt trong InventoryEntry.';
COMMENT ON FUNCTION omni_narrow_import_material_ids(text[]) IS 'Thu hẹp id mã hàng của omni-search (trang Nhập) về mã có phiếu nhập.';
