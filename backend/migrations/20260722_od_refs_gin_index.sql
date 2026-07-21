-- GIN index cho OutboundItem.od_refs (jsonb) — các truy vấn containment (od_refs @> [{od_number}])
-- của guard xóa DO SAP (classifyDoSapDelete) + reconcile engine đang seq-scan bảng triệu dòng.
-- jsonb_path_ops: nhỏ + nhanh cho toán tử @> (đủ cho mọi điểm dùng hiện tại).
create index if not exists idx_outbound_item_od_refs_gin
  on public."OutboundItem" using gin (od_refs jsonb_path_ops);
