# Kiểm kho (`stocktake`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Kiểm kho (4 tab, Luân phiên ABC)

**Quyền (BE `ALL_PERMISSIONS`):** view · scan · complete · export

## Giao thoa với
<!-- giao-thoa:start -->
- [`inventory`](inventory.md) — Tồn kho (hai chiều)
- [`slotting`](slotting.md) — Tối ưu vị trí (Slotting) (file này nhắc tới)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Kiểm kho (4 tab: Check vị trí · Tổng hợp KK · Lịch sử kiểm · **Luân phiên ABC** — 06/08: kiểm kê luân phiên thay kiểm full, hạng A 7 ngày/B 30/C 90 từ engine Slotting `slotting_stats` MỘT nguồn + lần kiểm gần nhất từ `StocktakeLog` qua RPC `cycle_count_info`; chọn mã đến hạn → nút "Kiểm N mã" chỉ PREFILL bộ lọc Tổng hợp KK rồi điều hướng — KHÔNG API write mới nên cả tab dùng `view`, trần LOC_ID_CAP 500 vị trí chặn có hướng dẫn)

## Actions

view (gồm tab Luân phiên ABC), create, scan, complete, **export**=Xuất Excel (cả tab Kiểm kê + Lịch sử kiểm) 
