# KẾ HOẠCH TEST HOÀN CHỈNH TRƯỚC GO-LIVE

> Nguyên tắc: test không chứng minh được "0 lỗi" — kế hoạch này nhắm 3 mục tiêu đo được:
> 1. **Phủ đủ các HỌ rủi ro** đã từng gây lỗi thật của app này (đồng thời/race, scale/cap-1000, cross-module teardown, phân quyền, edge theo inventory_mode, timezone, upload).
> 2. **Chặn hồi quy**: mọi lỗi từng sửa có 1 bài test chạy lại được — sửa code là chạy, đỏ thì không lên main.
> 3. **Phát hiện sớm + có đường lùi** khi lỗi lọt lưới lúc live.
>
> Quy ước: **P0** = bắt buộc xong trước go-live · **P1** = nên có, làm được sau go-live tuần đầu.
> Môi trường test = **Preview (dev) + DB staging**. Tuyệt đối không test tải trên production.

---

## TẦNG 0 (P0) — Bộ regression tự động chạy được bằng 1 lệnh

Biến các script QA rời rạc thành bộ cố định `scripts/qa/*.mjs`, chạy trên Preview, **xanh hết mới được merge main**. Gồm 4 gói:

> ✅ **ĐÃ XÂY XONG 09/07** — `scripts/qa/` (lib + 4 gói + runner + README). Chạy: `node scripts/qa/run-all.mjs [--scale 300]`.
> Lần chạy đầu: XANH toàn bộ (invariant 7/7 ×3 · smoke 16/16 · race 14/14 · scale 6/6).

- [x] **Gói smoke** (~2'): login → 11 GET list chính + chu trình tạo/sửa/xóa đơn xuất rồi dọn.
- [x] **Gói invariant** (~1'): bộ query SQL bất biến — chạy TRƯỚC và SAU mọi đợt test, 2 lần phải giống nhau:
  - tồn không âm: `cartons_remaining < 0` = 0 dòng
  - không xuất quá: `cartons_scanned > cartons_ordered` = 0 dòng
  - không mồ côi: TmsOrder→GDO, inbound_plan_lines→TmsOrder, OutboundScanEntry→Item, InventoryEntry→ProductionImport
  - không lệnh chuyển kho TRÙNG: 2+ TmsOrder cùng transfer_gdo_id = 0
  - booking: booked_count khớp đếm thật (recount_slot drift = 0)
- [x] **Gói race** (~2'): 10× "Xuất luôn" cùng GDO (1 lệnh, tồn trừ 1 lần) · 10× Hoàn thành đồng thời · xen kẽ Bỏ HT/Xuất luôn/HT. *(Race booking slot + scan QR đã verify ở chiến dịch riêng `tms-slot-booking-atomic` 1800 req + `concurrency-hardening` — không lặp lại trong suite.)*
- [x] **Gói scale** (~3'): seed 300 đơn+lệnh → list nóng < 3s & < 5MB → cleanup về baseline.
- [x] `scripts/qa/README.md`: cách chạy, cấu hình, xử lý khi FAIL, giới hạn đã biết.

**Definition of Done tầng 0**: 1 lệnh chạy tuần tự 4 gói, kết quả PASS/FAIL rõ ràng, sau khi chạy DB staging về đúng baseline.

---

## TẦNG 1 (P0) — Ma trận chức năng từng module

Mỗi module tick đủ 5 cột: **CRUD 4-case** (tạo/sửa/xóa/làm lại) · **Realtime** (2 tab, không refresh tay) · **Phân quyền 3 lớp** (BE 403 + FE ẩn nút + happy-path bằng vai thật — chuẩn `perm-test-standard-e2e`) · **Undo chain** (mọi nút Gỡ/Bỏ/Hủy đi ngược được và số liệu khớp) · **Responsive** (PC/tablet/phone 360px).

| Module | CRUD | Realtime | Quyền | Undo | Responsive |
|---|---|---|---|---|---|
| Nhập kho (tạo phiếu, quét V1/V2, sửa/xóa pallet, hoàn thành/bỏ HT, NCC ghép) | ✅09/07 | ✅ 2 chiều | ✅ BE 9/9 (vai Thủ kho TP; scan = cross-module confirm_receipt đúng thiết kế) | ✅ pool về baseline | ✅ 360px | *(chưa: quét QR camera thật — tầng 5)* |
| Xuất kho (upload, tạo tay, giao/bắt đầu/quét/hoàn thành, Xuất luôn, Xác nhận nhanh, in phiếu, sửa PAUSED) | ✅09/07 (suite+E2E) | ✅ 2 chiều | ✅ BE 9/9 + FE ẩn nút list/detail + scope kho tự áp (vai Lái xe nâng) | ✅ (race pack R2/R3) | ✅ 360px list+detail |
| Tồn kho (adjust ±CAS + AdjustmentLog, list/facets/summary/export) | ✅09/07 adjust 2 chiều về baseline | ✅ (map dày) | ✅ BE 403 (vai bảo vệ) | ✅ | ✅ 360px | *(bulk-qa/ncc/location/recode: gate quyền có, chưa chạy chu trình riêng — rủi ro thấp, cùng pattern adjust)* |
| TMS Đặt lịch + Chuyển kho (edit/book/release/đổi ngày, badge Kho đang sửa) | ✅09/07 | ✅ (map + test sống hôm nay) | ✅ BE 403 | ✅ (release + cascade) | ✅ 360px | *(booking slot nguyên tử: đã verify chiến dịch riêng 1800 req)* |
| Đăng ký cổng (đăng ký/gọi/vào/ra + 3 revert) | ✅09/07 chu trình 9 bước | — | ✅ granular: bảo vệ tạo/vào/ra được, KHÔNG call/edit (403) | ✅ revert cả 3 nấc | ✅ 360px |
| Nhặt lẻ (đồng bộ layout Xuất, confirm) | ✅ GET (đã verify sâu chiến dịch riêng) | ✅ map | (đi theo outbound) | — | ✅ 360px |
| Kiểm kho + Check vị trí | ✅ GET entries | — | gate quyền có sẵn | — | — | *(chu trình quét kiểm kho: tầng 5 camera)* |
| Dồn / Tách pallet | ⚠ CHƯA chạy chu trình (V2 split có nợ kỹ thuật đuôi .N đã ghi nhận — test khi build phần thùng) | | | | |
| In tem pallet (in lại, truy cứu, lịch sử) | ✅ GET (verify sống .160 chiến dịch riêng) | — | mỗi tab 1 quyền (đã có) | — | ✅ 360px | *(sinh tem V2 + quét lại tem in thật: tầng 5)* |
| Mã hàng + Vị trí + Cài đặt (cờ hệ thống) | ✅09/07 CRUD cả 2 + PUT cờ flip/restore | — | ✅ (manage_system đã gate) | ✅ xóa sạch | ✅ 360px |
| Quản lý người dùng (tạo/set MK/xóa) | ✅09/07 — chính là cơ chế tạo vai test (dùng 4 lần đều sạch) | — | ✅ (chỉ admin làm được) | ✅ | — |
| HR (phân công, chấm công) | ✅ GET smoke (module đã build+verify chiến dịch riêng) | — | — | — | ✅ 360px |

**Cách làm nhanh**: mỗi module 1 buổi, đi theo skill `review-module` (liệt kê bề mặt TỪ CODE, không từ trí nhớ — grep route + cross-module writes), tick vào bảng. Ưu tiên thứ tự: Outbound → Inbound → TMS → Tồn kho → Gate → còn lại.

---

## TẦNG 2 (P0) — Luồng CHÉO module (nơi lỗi ẩn nhiều nhất)

Mỗi luồng test **2 chiều** (xuôi + gỡ/hủy) và soi số liệu DB 2 đầu:

- [ ] **Xuất → TMS → Nhập**: hoàn thành đơn xuất (đủ 4 loại kho nhận QR/QTY/NONE/khách ngoài theo cờ) → lệnh TMS đúng đích → booking đủ → kho nhận quét/nhận → tồn kho nhận tăng đúng = kho xuất giảm. Chiều ngược: bỏ HT/hủy phiếu nhập/hủy nhận ở từng nấc.
- [ ] **Gate ↔ Xuất/Nhập**: chuyến gắn lượt cổng, đếm "Lần" đúng khi nhiều lượt cùng biển số/ngày.
- [ ] **Upload Excel cả 4 loại** (KH xuất, KH nhập, Tồn kho, Mã hàng/danh mục): file chuẩn + file bố cục lạ + file 4.5MB (phải bị chặn đẹp 413/4MB) + upload ĐÈ (replace giữ assignment, không mồ côi lệnh TMS) + ô trống giữ giá trị cũ.
- [ ] **QR V1/V2 theo cờ `label_format`**: quét đúng format nhận, sai format ra 422 lịch sự; đổi cờ ảnh hưởng trong ≤30s; tem in ra quét lại được bằng chính app (vòng tròn khép kín in → dán → quét).
- [ ] **Dồn/Tách ↔ Tồn ↔ Báo cáo nhập**: tổng nhập bất biến sau dồn/tách; %Date đúng cả V1 (shelf-life) lẫn V2 (HSD tường minh).

---

## TẦNG 3 (P0) — Đồng thời quy mô thật

> ✅ **CHẠY 09/07** — gói `scripts/qa/05-rush.mjs`: 27 luồng thật đồng thời (~25 in-flight, 4 nhóm nghiệp vụ + 6 người xem), 0 lỗi, pool về baseline, app refresh giữa tải không văng /login, invariant sạch. Chạy lại trước go-live: `node scripts/qa/05-rush.mjs`.

- [x] Nhóm A: 8 người tạo & Xuất luôn · Nhóm B: 6 người nhập-hủy (đụng pool 2 chiều) · Nhóm C: 4 người xuất↔gỡ HT kho QTY · Nhóm D: 3 chu trình cổng · Nhóm E: 6 người xem GET dồn dập
- [x] Refresh app giữa tải — không văng /login
- [x] Invariant sạch sau rush + cleanup về baseline
- [ ] (Trước go-live chạy lại 1 lần, kéo dài hơn: lặp `05-rush` 5–10 vòng liên tục)

---

## TẦNG 4 (P1→P0 nếu data thật lớn) — Dữ liệu lớn theo quy mô năm

- [ ] Seed staging tới mốc dữ liệu ~6 tháng vận hành dự kiến (ước từ số liệu thật: X pallet nhập/ngày, Y đơn xuất/ngày → nhân 180). Đã có sẵn kinh nghiệm 40k dòng upload OK.
- [ ] Đo mọi trang list + facets + dashboard + report: ngưỡng chấp nhận < 2–3s; đặc biệt các trang từng dính cap-1000.
- [ ] Kiểm "đủ dòng": tổng từng trang = tổng SQL (không bị cắt 1000 âm thầm).
- [ ] Xong thì restore staging (script cleanup — KHÔNG xoá data nền).

---

## TẦNG 5 (P0) — Thiết bị & hiện trường thật

Cái này KHÔNG thay được bằng script — cần người đứng ở kho:

- [ ] Điện thoại/tablet thật sẽ dùng ở kho (đúng model): quét QR tem in thật dưới ánh sáng kho, khoảng cách thật (nhớ giới hạn quang học tem nhỏ), camera keep-alive khi quét liên tục 15', pin/nhiệt.
- [ ] **iOS Safari riêng 1 vòng** (từng dính RangeError sập trang Tồn kho).
- [ ] Mạng kho thật/4G yếu: thao tác quét khi mạng chập chờn — không mất scan, không double-submit.
- [ ] In thật: phiếu xuất A4 + tem pallet ¼A4 trên đúng máy in ở kho, quét lại tem vừa in.
- [ ] 1 ngày UAT đóng vai: 3–5 nhân viên dùng **tài khoản vai thật** (không phải admin) chạy kịch bản "một ngày của kho": sáng nhập 20 pallet → trưa xuất 5 chuyến (có 1 chuyến sai phải sửa/gỡ) → chiều chuyển kho + nhận + kiểm kho. Ghi lại MỌI khựng/khó hiểu, kể cả không phải bug.

---

## GO-LIVE RUNBOOK

**Trước D-day:**
- [ ] **Freeze tính năng D-7**: chỉ nhận bugfix, mọi commit vào main phải qua tầng 0 xanh.
- [ ] Checklist migration: mọi file `backend/migrations/` đã apply đủ trên PRODUCTION (so `SCHEMA_REVIEW.md` với schema thật — hiện tại các đợt gần đây 0 migration, vẫn phải đối chiếu 1 lần cuối).
- [ ] Cấu hình production: cờ `label_format`, cờ `delivery_confirmation` (mode nào tick), phân quyền chức danh đủ (kể cả quyền mới: quick_export, confirm_receipt, prepare…), tài khoản nhân viên + kho + loại hàng gán đúng.
- [ ] Import dữ liệu nền bằng bộ template `scripts/` (Kho/NCC-ĐVVT/Xe/Vị trí/Tồn/Mã hàng) — đúng quy trình go-live-data-prep.
- [ ] Smoke test PRODUCTION sau deploy: login từng vai chính, mỗi module 1 GET, **1 giao dịch thử end-to-end rồi gỡ sạch** (1 phiếu nhập 1 pallet test → xóa).

**D-day + tuần đầu:**
- [ ] Ngày 1–3: chạy gói **invariant** trên production **mỗi tối** (read-only — an toàn), so với hôm trước.
- [ ] Theo dõi Vercel runtime errors + log 500 mỗi sáng.
- [ ] Kênh báo lỗi 1 chạm cho nhân viên kho (nhóm Zalo/ảnh chụp màn hình) + người trực phân loại: chặn-vận-hành (hotfix ngay, verify kỹ vì không qua staging) vs thường (đưa vào dev).
- [ ] **Đường lùi**: lỗi nặng → Vercel rollback về deployment trước (1 phút, không mất data); lỗi data → có sẵn script invariant để khoanh vùng bản ghi hỏng, sửa bằng SQL có kiểm soát.

---

## Nhịp làm việc đề xuất (nếu go-live trong ~2 tuần)

| Thời gian | Việc |
|---|---|
| Ngày 1–2 | Tầng 0: đóng bộ regression 4 gói chạy 1 lệnh |
| Ngày 3–7 | Tầng 1+2: mỗi ngày 2 module theo ma trận + luồng chéo |
| Ngày 8 | Tầng 3: giờ cao điểm đồng thời |
| Ngày 9 | Tầng 4: dữ liệu lớn |
| Ngày 10 | Tầng 5: hiện trường + UAT đóng vai |
| Ngày 11–12 | Sửa lỗi tồn đọng + chạy LẠI tầng 0 + freeze |
| Ngày 13 | Runbook: cấu hình + import + smoke production |
| Ngày 14 | Go-live + trực |
