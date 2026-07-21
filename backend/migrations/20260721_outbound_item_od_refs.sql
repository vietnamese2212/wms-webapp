-- ĐỢT 1 reconcile SAP↔WMS — liên kết ngược DÒNG chuyến ↔ dòng OD của SAP.
-- OutboundItem gộp theo (NPP, mã hàng); 1 item có thể gom NHIỀU dòng OD (30 cặp ship-to×mã trải tới 4 DO).
-- od_refs = [{od_number, od_item, qty_base}] — nguồn để engine (Đợt 2) tính lại cartons_ordered = Σ qty_base
-- và phát hiện dòng OD nào đổi/thiếu. NULL-safe: mặc định '[]'. Chỉ populate từ luồng KHVC (join raw);
-- luồng upload file gộp trực tiếp (mất OD granularity) để '[]'.
ALTER TABLE public."OutboundItem"
  ADD COLUMN IF NOT EXISTS od_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
