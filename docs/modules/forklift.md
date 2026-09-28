# Xe nâng (`forklift`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Xe nâng (check list)

**Quyền (BE `ALL_PERMISSIONS`):** view · check · delete_check · manage_vehicle · manage_item

## Giao thoa với
<!-- giao-thoa:start -->
_(chưa ghi nhận)_
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Xe nâng (menu Kho WMS) — check list an toàn HÀNG NGÀY + đồng hồ giờ vận hành, 3 tab: Check list ngày (board — xe CHƯA check xếp LÊN ĐẦU, có cột Người check/Lúc) · Báo cáo vận hành = **DASHBOARD** (KPI: tổng giờ/giờ TB/tuân thủ %/lỗi + 4 khối chart CSS thuần kiểu Control Tower: giờ theo ngày · giờ theo xe · tuân thủ theo xe kém-nhất-lên-đầu · hạng mục lỗi top — RPC `forklift_report` trả object `{rows, issue_items}`, `checked_at` trong rows; các chart hiện ĐỦ mọi xe — không cắt top-N) · **Ma trận check** (dòng = ngày · cột = hạng mục WRAP TEXT · `GET /wms/forklift-logs?forklift_id&from&to` trả checklist jsonb, ≤92 ngày/1 xe, route TRƯỚC `/:id`) · **Tổng hợp xe** · **Chi tiết ngày** (3 tab tách khỏi dashboard 01/08, đều filter Khoảng ngày + Kho + Xe qua FilterBar) · Cài đặt (filter theo Kho). Mỗi xe mỗi ngày 1 bản ghi (unique, upsert đè — KHÔNG gửi `id` trong upsert kẻo đè khóa chính); form check = 2 checkbox loại trừ **Xe hoạt động / Xe nghỉ**: NGHỈ (IDLE) = khỏi check an toàn/số/ảnh; HOẠT ĐỘNG = số đồng hồ (chỉ tăng, BE kẹp 2 chiều 422) + **BẮT BUỘC ẢNH CHỤP XE** (bucket Storage riêng tư `forklift-photos`, FE nén canvas rồi gửi `photo_data`, BE phát signed URL 1h; sửa lại không bắt chụp lại). **Ảnh chỉ giữ 60 NGÀY gần nhất** (user chốt 31/07): job dọn lười `cleanupOldPhotos` (kiểu error_logs — không pg_cron) chạy khi có người lưu check list, throttle 6h/instance, lô ≤200; xóa object storage TRƯỚC rồi mới NULL `photo_path` (lỗi thì chờ lượt sau, không orphan); bản ghi số liệu/ai check GIỮ NGUYÊN, chỉ gỡ ảnh. **Hạng mục check list THEO KHO** (`warehouse_id` null = dùng chung mọi kho): check list 1 xe = bộ chung + bộ riêng kho xe đó; sửa/xóa hạng mục DÙNG CHUNG = chỉ user full scope kho (như khung giờ cargo ALL), hạng mục riêng kho = user có kho đó

## Actions

view, **check**=ghi/sửa check list ngày, **delete_check**=xóa bản ghi ngày (ghi nhầm — tách 05/08), **manage_vehicle**=danh mục Xe (tab Cài đặt), **manage_item**=hạng mục check list (tab Cài đặt) 
