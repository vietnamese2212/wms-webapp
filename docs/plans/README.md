# docs/plans — Kế hoạch & Test plan (lưu trữ)

Các file plan / execution-log / test-plan đã dời khỏi thư mục gốc (23/07/2026) để gốc chỉ còn `CLAUDE.md` + `SCHEMA_REVIEW.md`.
Đây là **tài liệu quá trình** — phần lớn việc đã xong; giữ để tra cứu thiết kế & lịch sử quyết định. Reference SỐNG (cập nhật mỗi lần đổi schema) vẫn là `SCHEMA_REVIEW.md` ở **gốc repo**.

| File | Nội dung | Trạng thái |
|---|---|---|
| [SAP_INTEGRATION_PLAN.md](SAP_INTEGRATION_PLAN.md) | Thiết kế gốc tích hợp SAP + base-unit (10 vòng brainstorm 19/07). Doc cha, 2 file dưới trỏ tới. | Base-unit XONG; SAP live-pull còn tương lai → **reference** |
| [BASE_UNIT_EXECUTION_PLAN.md](BASE_UNIT_EXECUTION_PLAN.md) | Kế hoạch thi công base-unit (4 đợt, danh sách cột flip). | ✅ XONG + flip production 23/07 → nhật ký |
| [OUTBOUND_SAP_RECONCILE_PLAN.md](OUTBOUND_SAP_RECONCILE_PLAN.md) | Đồng bộ SAP↔WMS Xuất kho (engine reconcile, gác line-level 5 vùng, 3 GĐ). | Đợt 0+1+2 XONG trên `dev`; chờ merge main (4 migration 20260721) |
| [RECONCILE_TEST_PLAN.md](RECONCILE_TEST_PLAN.md) | Test plan cho reconcile (11 khu vực + ma trận 5 vùng). | Companion của OUTBOUND_SAP_RECONCILE |
| [TEST_PLAN_GOLIVE.md](TEST_PLAN_GOLIVE.md) | Kế hoạch test 6 tầng trước go-live + runbook. | Go-live XONG 23/07; phần sống (Tầng 0) = `scripts/qa/` |
| [EXTERNAL_REALTIME_TEST_PLAN.md](EXTERNAL_REALTIME_TEST_PLAN.md) | Test plan realtime dữ liệu ngoài (erp_outbound_orders). | Nhật ký |
| [DIRECTED_WORK_PLAN.md](DIRECTED_WORK_PLAN.md) · [DIRECTED_WORK_1C_PLAN.md](DIRECTED_WORK_1C_PLAN.md) | Sơ đồ kho → kế hoạch lấy hàng 3 vai (Fable plan → Opus code). | 1a/1b/1c ✅ XONG 09–10/09 |
| [CUSTOMER_DATE_RULE_PLAN.md](CUSTOMER_DATE_RULE_PLAN.md) | %Date theo Khách hàng / Kênh — danh mục `Customer` (khoá ship-to SAP) + kênh `customer_channel` + policy theo kho xuất, thay chốt tay 1.000 dòng/ngày; rule Chuyển kho đọc `Customer.warehouse_id`. | ✅ XONG 11/09 (dev b75b35ac→619269bb, QA 58 44/44) |
