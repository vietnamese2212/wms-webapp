# Truy xuất lô (`traceability`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Truy xuất lô (menu Báo cáo)

**Quyền (BE `ALL_PERMISSIONS`):** view · export · investigate

## Giao thoa với
<!-- giao-thoa:start -->
- [`inventory`](inventory.md) — Tồn kho (file này nhắc tới)
- [`packing`](packing.md) — Sổ đóng gói (file này nhắc tới)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

**Truy xuất lô** (menu Báo cáo) — hồ sơ THU HỒI 2 chiều: xuôi (mã pallet/tiền tố · mã hàng + ngày SX · mã lô) → đã giao NPP nào, xe nào, ngày nào + còn bao nhiêu trong kho; ngược (NPP · chuyến · biển số) → đã nhận lô nào. Một RPC `lot_trace` trả cả danh sách lẫn ô tổng. **Quyền RIÊNG, không đi ké `inventory.view`**: màn này ghép tồn + xuất + khách hàng nên rộng hơn mọi trang lẻ. Tối ưu đo thật 1.839ms → 59–141ms: index `OutboundScanEntry(pallet_code)` (trước đó KHÔNG có — mọi truy xuất Seq Scan bảng giao dịch lớn nhất) · `text_pattern_ops` cho LIKE tiền tố · join `unnest(mảng)` thay `= ANY(mảng)` (999→113ms) · SQL ĐỘNG bỏ mẫu `(tham số IS NULL OR …)` làm planner bỏ index. Hai khoảng ngày TÁCH BẠCH: Ngày SX (truy từ lô) ≠ Ngày giao (truy từ khách). **FILTER CHUẨN TỔ HỢP (01/09, user chốt 3 vòng): switch chiều Xuôi/Ngược, mỗi tiêu chí = 1 chip dropdown tìm-trên-server (RPC trace_suggest), điền ô nào lọc ô đó KẾT HỢP AND, KHÔNG gì bắt buộc — Xuôi (kind=fwd trên tồn): Tem pallet tiền tố · Mã hàng · Chu kỳ · Máy · Kho SX ký hiệu (đoạn 3/4/6 tem V1, index biểu thức idx_ie_tem_* nên không cần ngày) · Ngày SX · Ngày giao; Ngược (kind=rev trên đường giao): NPP · Số xe · Biển số · Ngày giao; tập mã kẹp 5000; 'Mã lô' CHỈ hiện khi label_format=semicolon (đơn vị tem V1 batch luôn NULL); kind cũ 1-giá-trị giữ cho bundle PWA cũ**

## Actions

view (gồm xem bảng hồ sơ Truy xuất theo thùng), **export**=Xuất Excel hồ sơ truy xuất (2 sheet), **investigate**=TRUY XUẤT THEO THÙNG (01/09, v2 cùng ngày): tab = BẢNG HỒ SƠ + nút "Truy xuất mới" mở FormSheet — bắt buộc Ngày·Giờ·MÁY·CHU KỲ, tùy chọn Mã hàng + Kho SX theo KÝ HIỆU NMSX (`Warehouse.nmsx_code` B/D…) + ≤6 ảnh (AI đọc giờ tái dùng `/packing/vision-ocr`, route `requireAnyPerm(packing.record, traceability.investigate)`). **Tem pallet lệch được ±1–3 ngày so chữ in phun** ⇒ KHÔNG bám ngày: `GET /trace/runs` gợi ý SỔ ĐÓNG GÓI theo Máy+Chu kỳ (norm `normCycleCode`) cửa sổ **±3 ngày**, user xem pallet từng sổ rồi BUỘC CHỌN 1 sổ (`run_id` lưu trên hồ sơ); giờ chỉ đánh dấu ★ pallet nghi vấn (dò ±3 ngày). Kết quả = HÀNH TRÌNH TOÀN CÔNG TY (lot_trace kind='codes' KHÔNG cắt scope + lịch sử nhập mọi kho từ InventoryEntry kể cả dòng đã xuất hết): SX kho nào → nhập → xuất → kho nhận → xuất tiếp → còn ở đâu. Hồ sơ = `trace_investigations` (material_code nullable, run_id — migration 20260901b) + ảnh bucket `trace-photos`. Gói QA 39 (15 mục) gác 
