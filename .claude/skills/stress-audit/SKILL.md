---
name: stress-audit
description: CHỦ ĐỘNG check toàn app / nhiều module dưới TẢI THẬT để tìm lỗi ẩn + cải tiến hiệu năng (không gắn với 1 tính năng vừa code). Dựng SIM harness gọi API thật + dữ liệu SIM tự seed (KHÔNG đụng data thật), bắn tải đa-module đồng thời (rải + tranh chấp), kiểm bất biến từng wave, PHÂN LOẠI vi phạm (ảo do đo lúc in-flight vs THẬT), đo độ trễ đọc-dưới-tải-ghi, tìm nguyên nhân gốc (EXPLAIN/đọc controller), fix tối thiểu + đo lại trước/sau, dọn 0 sót. Gọi khi user muốn "kiểm tra app / rà lỗi / tìm chỗ chậm / test tải / cải tiến" ở phạm vi rộng. Khác verify-feature (gate 1 tính năng trước khi báo xong) và review-module (liệt kê bề mặt 1 module).
---

# Stress Audit — check app dưới tải thật, tìm lỗi, cải tiến

> Playbook cho **chiến dịch chủ động**: đặt app vào tình huống hàng trăm nhân sự thao tác đồng thời đa-module để lộ **lỗi ẩn về toàn vẹn dữ liệu** + **điểm nghẽn hiệu năng** mà kiểm từng-tính-năng bỏ sót, rồi sửa + đo lại.
> Bổ trợ (không thay): [[verify-feature]] (Cổng 5 = gate tải cho 1 tính năng vừa build) · [[review-module]] (bề mặt 1 module) · [[debug-systematic]] (khoanh 1 bug) · [[concurrency-hardening]] / [[cap-1000-campaign]] (họ lỗi đã biết).

## Bài học gốc (vì sao có skill này — 23/07/2026)
Chạy tải đa-module trên staging đã lộ **2 lỗi THẬT mà per-feature test không thấy**: (1) `adjust` cập-nhật-tồn rồi ghi `AdjustmentLog` ở **2 bước không cùng transaction** → dưới 504 tồn đổi mà mất log (audit hụt + không idempotent); (2) list nặng (Tồn/Xuất/Nhập) chậm **3–10×** dưới tải ghi vì thiếu index composite (Seq Scan 36k dòng/lượt). Cả hai chỉ hiện khi **nhiều module ghi đồng thời + đo dưới tải**. Cốt lõi phương pháp: **API thật + dữ liệu SIM tự sed + bất biến CHÍNH XÁC + phân loại vi phạm ảo/thật + đo trước-sau.**

---

## Nguyên tắc cốt tử (đọc trước, sai là hỏng)
1. **KHÔNG BAO GIỜ đụng dữ liệu thật.** Tự seed dữ liệu SIM có **TAG** (vd `SIMWMS`), thao tác + dọn trên chính nó. Cấm tiêu thụ tồn thật / hoàn thành đơn thật / book slot thật. Cần tồn để xuất → **tự tạo pallet SIM** rồi xuất, đừng quét pallet thật.
2. **Mặc định STAGING** (`.mcp.json` + `.env` trỏ staging; branch `dev`). Staging là môi trường test — seed/tải/dọn thoải mái. **Production chỉ đụng khi user nói RÕ** (xem mục "Fix lên production").
3. **Không lộ mật khẩu trong tool call.** Đọc creds từ `frontend/.env`/`backend/.env` **trong tiến trình node**, không echo. Playwright không login được production (admin khác) → verify tầng DB là chính.
4. **Dọn 0 sót + verify ĐỘC LẬP.** Xem mục Dọn — tag có thể nằm GIỮA chuỗi, verifyClean có thể sót nhánh → quét phòng thủ.
5. **Quy mô khớp yêu cầu.** "Rà nhanh" → vài wave. "Test kỹ/toàn diện" → nhiều wave + reader-under-writer + nhiều module. Đừng bão hoà `max_connections=60` (in-flight ~15–25) và **đừng bắn tải lớn lúc user thật đang dùng**.

## Công cụ
- **pg trực tiếp** (module `pg` có sẵn ở `scratchpad/node_modules`) cho SETUP/CLEANUP/EXPLAIN + kiểm bất biến ghi được. Staging URL từ `.mcp.json`; production URL = `LOF_DATABASE_URL` trong `backend/.env` (chỉ khi được phép).
- **Postgres MCP** (`mcp__postgres__query`) cho soi read-only staging (tiện, nhưng chỉ đọc + chỉ staging).
- **Vercel Preview dev** (`wms-webapp-git-dev-...vercel.app`) = target API tải (ổn định, giống prod, không phụ thuộc local dev). Login `POST /api/auth/login` {email,password} → JWT.
- Node 18+ `fetch` global. `qty_semantics:'base'` phải nằm trong **BODY** mọi write (thiếu → 409 APP_OUTDATED). Prefix: WMS `/api/wms`, TMS `/api/tms`.

---

## Bước 1 — Trích HỢP ĐỒNG API chính xác TỪ CODE (đừng đoán payload)
Đoán sai payload → "phát hiện giả". Với mỗi action định bắn: đọc `backend/src/routes/*` + controller → ghi **METHOD + path đầy đủ + permission + body JSON (field bắt buộc, kiểu, field số lượng có phải BASE) + shape success + điều kiện chặn + cơ chế đồng thời (RPC/CAS)**. Việc rộng → **cử 2–3 subagent song song** trích từng cụm module (mẫu session: Inbound+Inventory / Outbound+Transfer+NPP / Booking+Gate+Upload) trả spec ngắn dùng viết payload ngay.

## Bước 2 — Neo dữ liệu thật + seed SIM tự chứa
- Neo từ DB thật: kho (id/inventory_mode/warehouse_type), mã theo loại (cpp/upc/base_unit/entry_unit), vị trí, loại xe, NPP. Introspect **tên bảng/cột thật** (`information_schema`) — đừng tin tên nhớ (vd `OutboundItem.do_id` không phải `delivery_id`; `inbound_plan_lines.tms_order_id` không phải `order_id`).
- Seed trực tiếp DB (nhanh): tồn SIM (pallet_code `SIMWMS_…`, status IN_STOCK, cartons_reserved 0, origin 'PRODUCTION', +id/updated_at), vài location SIM (1 cái max_pallets nhỏ để test tràn sức chứa), slot+order+vehicle-slot SIM (tag bằng ngày đặc biệt vd `2026-12-30`). Ghi `sim_ctx.json`.
- **PHÂN TÁCH pallet theo MỤC ĐÍCH** để bất biến CHÍNH XÁC: nhóm mã A→ chỉ outbound consume (INV: `remaining==imported−Σscanned`); nhóm mã B→ chỉ adjust/move/stocktake (INV: `remaining==imported+Σdelta`). Trộn lẫn → không viết được bất biến exact.
- Insert lỗi check-constraint → đọc `pg_get_constraintdef` lấy giá trị hợp lệ (vd DeliverySlot.status ∈ OPEN/CLOSED/FULL).

## Bước 3 — SMOKE 1-mỗi-flow TRƯỚC khi scale
Chạy đúng 1 lần mỗi action, in status + error. Sửa payload tới khi mọi flow xanh. **Bỏ bước này = bản tải dài đầy lỗi giả, phí cả giờ.** (Lấy id lồng như `OutboundItem` → query DB, response GDO không lồng items.)

## Bước 4 — Tải waves đa-module + đa-kho ĐỒNG THỜI
Pool ~15–25 in-flight. Mỗi wave trộn nhiều module: outbound scan (tranh chấp cùng pallet giữa nhiều GDO) · adjust (±, có subset "hot" cùng pallet để ép CAS) · move (vào location cap nhỏ → ép LOCATION_FULL) · stocktake · booking burst (release-rồi-book N xe trên slot cap nhỏ → ép overbooking) · gate lifecycle · inbound create+scan · upload. Track **phân bố status theo module** (bắt 500/504/401). Lặp waves tới hết thời lượng/ngân sách.

## Bước 5 — Bất biến MỖI wave (đây là nơi lỗi lộ ra)
- Tồn **không âm**; `cartons_reserved` không âm.
- Consume: `remaining == imported − Σ(OutboundScanEntry.cartons_scanned theo pallet)`.
- Adjust: `remaining == imported + Σ(AdjustmentLog.delta)` **và** `Σdelta == adjustment_qty` (bắt lệch audit).
- Sức chứa: occupancy mỗi location ≤ `max_pallets`.
- Booking: `DeliverySlot.booked_count ≤ max_vehicles` **và** `== số biển phân biệt đã book` (không overbooking, cache không drift).
- Hạ tầng: **0 lỗi 500** (bug server thật) · **0 lỗi 401** (mất phiên = đá /login). 4xx do tranh chấp (dup/FULL/insufficient) là **kỳ vọng**, không phải lỗi.

## Bước 6 — PHÂN LOẠI vi phạm: ẢO (đo lúc in-flight) vs THẬT ⭐
Vi phạm xuất hiện dưới tải cao **thường do đo lúc request 504/đang chạy dở server-side** (scan đã ghi nhưng consume chưa xong tại thời điểm snapshot). **Re-check bất biến SAU khi mọi in-flight đã lắng:**
- Khớp lại → **ẢO** (artifact đo), không phải bug. (Session: INV1 consume wave 6 lệch → lắng xong 0 lệch.)
- Còn lệch → **THẬT**, đào tiếp. (Session: INV2 adjust net_gap +192 giữ nguyên → soi ra `remaining==imported+adjustment_qty` đúng nhưng `Σlog<adjustment_qty` = ghi log không nguyên tử.)
Nguyên tắc: **đừng báo bug khi chưa re-check sau lắng; đừng bỏ qua khi còn lệch sau lắng.**

## Bước 7 — Đọc-dưới-tải-ghi (lo "user khác delay/crash khi xem")
N reader (vd 3) bắn GET các list nặng (Tồn/Xuất/Nhập/Dashboard) + list nhẹ (control) trong khi M writer (vd 15) hammer. Đo **p50/p95/max + status** ở 2 pha: **baseline (không tải ghi)** rồi **dưới tải**. So sánh: reader 200 hết = không crash; p95 phình nhiều = nghẽn cần cải tiến. (Session: Tồn p95 1.3s→10.9s.)

## Bước 8 — Nguyên nhân gốc + fix tối thiểu + ĐO LẠI
- Perf: `EXPLAIN (ANALYZE, BUFFERS)` từng query nghi (đọc-list). Seq Scan bảng lớn / thiếu index khớp shape (WHERE+ORDER BY) → thêm **index composite** (vd `(warehouse_id, import_date desc nulls last, id)`; `INCLUDE (cartons_remaining)` cho SUM/COUNT index-only). `ANALYZE` sau tạo.
- Toàn vẹn: đọc controller tìm **ghi nhiều bước không cùng transaction** → gộp vào **1 RPC row-lock** (mẫu `scan_insert_pallet`/`move_pallets_to_location`/`book_vehicle_slot`; bỏ CAS-retry giảm bão 409). Controller gọi RPC + **fallback path cũ** khi RPC chưa deploy.
- **ĐO LẠI cùng tham số** → so trước/sau (session: Tồn p95 10.9s→2.1s; adjust 0 drift dưới ~2.5k lệnh). Migration → `backend/migrations/YYYYMMDD_*.sql` + apply staging (pg) + `SCHEMA_REVIEW.md` + bump rebuild-token nếu sửa `backend/src`. tsc/build xanh. Theo [[mutation-realtime]] nếu đụng mutation.

## Bước 9 — DỌN 0 SÓT + verify độc lập
- Cleaner robust theo TAG, **`LIKE '%TAG%'`** (tag có thể nằm GIỮA — vd pallet inbound `230726_..._SIMWMS_...`, `LIKE 'SIMWMS%'` sẽ SÓT).
- Nhận diện bản ghi SIM **CHÍNH XÁC, không đụng thật**: GDO không auto-tag → nhận qua join delivery (`delivery_code`/`distributor_name LIKE %TAG%`), **thu id vào JS trước khi xóa** (xóa con trước cha do FK). Order phụ auto-tạo (transfer TmsOrder) nhận qua `transfer_gdo_id`.
- Xóa theo thứ tự FK (scan→item→delivery→gdo; log→entry; ipl/vslot→order→slot; gate; location).
- **verifyClean có điểm mù** (chỉ soi vài cột tag) → thêm quét phòng thủ: orphan (vd PI mồ côi `from_gdo_id` không còn GDO), bản ghi trong cửa sổ thời gian test. Residue phải = 0 mọi bảng.
- Xóa script scratchpad (nhất là file chứa creds/đường dẫn creds). Xóa ảnh Playwright. `git status` sạch (đừng `git add` `Template upload.xlsx`).

## Bước 10 — Báo cáo trung thực + memory
Nêu: đã bắn gì (module/quy mô/thời lượng) · bất biến PASS · phát hiện THẬT (kèm bằng chứng số + phân loại) · fix + đo trước/sau · dọn 0 sót. Fail thì nói fail. Ghi memory `project` (phát hiện + trạng thái fix) + cập nhật `MEMORY.md`.

## Fix lên production (chỉ khi user nói RÕ)
Nếu fix cần go-live: **KHÔNG merge ẩu** (deploy code trước khi DB sẵn = vỡ). Trình runbook + hỏi (thời điểm + ai chạy DB). Trình tự an toàn: **preflight read-only production** (biết trạng thái thật, đừng giả định) → migration **additive trước** (thứ tự phụ thuộc, không phải tên file) → migration **cutover/data cùng cửa sổ deploy code** (nếu đổi nghĩa dữ liệu như base-unit: freeze + backup + transaction tự-verify + rollback path) → migration **phá hủy (DROP) sau khi code mới live** → **verify 4 tầng**: DB (dữ liệu) · RPC · code (probe route mới 401 vs 404) · app-smoke live (200, không 500). Giữ backup tới khi user xác nhận. Chi tiết cutover base-unit: [[production-golive-2026-07-23]] + `BASE_UNIT_EXECUTION_PLAN.md` mục 2.4.

## Checklist
- [ ] Trích hợp đồng API từ code (không đoán) — subagent song song nếu rộng
- [ ] Neo DB thật + introspect tên cột thật; seed SIM có TAG, **không đụng data thật**; phân tách pallet theo mục đích
- [ ] SMOKE 1-mỗi-flow xanh TRƯỚC khi scale
- [ ] Waves đa-module + đa-kho, in-flight ~15–25, rải + tranh chấp; track status/module (bắt 500/504/401)
- [ ] Bất biến mỗi wave (âm/consume/adjust+log/capacity/overbooking/500/401)
- [ ] **Re-check sau lắng → phân loại vi phạm ẢO vs THẬT**
- [ ] Reader-under-writer: p50/p95/max baseline vs dưới tải
- [ ] Nguyên nhân gốc (EXPLAIN / đọc controller) → fix tối thiểu → **đo lại trước/sau**
- [ ] Dọn 0 sót + verify ĐỘC LẬP (quét orphan) + xóa script/ảnh; git sạch
- [ ] Báo cáo trung thực + memory
- [ ] (Nếu lên production) preflight → additive → cutover cùng deploy → drop sau → verify 4 tầng; chỉ khi user cho phép rõ
