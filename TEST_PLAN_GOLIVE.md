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

- [ ] **Gói smoke** (~5'): login → mỗi module chính gọi 1 GET list + 1 chu trình tạo/sửa/xóa nhỏ rồi dọn (Inbound, Outbound, Inventory, TMS bookings, Gate, Materials, Locations).
- [ ] **Gói invariant** (~1'): bộ query SQL bất biến — chạy TRƯỚC và SAU mọi đợt test, 2 lần phải giống nhau:
  - tồn không âm: `cartons_remaining < 0` = 0 dòng
  - không xuất quá: `cartons_scanned > cartons_ordered` = 0 dòng
  - không mồ côi: TmsOrder→GDO, inbound_plan_lines→TmsOrder, OutboundScanEntry→Item, InventoryEntry→ProductionImport
  - không lệnh chuyển kho TRÙNG: 2+ TmsOrder cùng transfer_gdo_id = 0
  - booking: booked_count khớp đếm thật (recount_slot drift = 0)
- [ ] **Gói race** (~10'): các bài đua đã có + mở rộng — N request đồng thời cùng 1 tài nguyên, bất biến giữ nguyên:
  - 10× "Xuất luôn" cùng 1 GDO → 1 lệnh, tồn trừ 1 lần
  - 10× Hoàn thành (patchGDO) cùng 1 chuyến
  - 25× book slot cùng khung giờ sức chứa nhỏ → không overbooking
  - 10× scan cùng 1 pallet ở 2 chuyến khác nhau → không âm tồn
  - Hoàn thành ↔ Bỏ hoàn thành ↔ kho nhận Bắt đầu nhận bắn xen kẽ → trạng thái cuối hợp lệ
- [ ] **Gói scale** (~15'): seed 300–500 bản ghi vào module đích → đo latency (ngưỡng: list < 2s, không response > 5MB) → cleanup về baseline. Luân phiên module mỗi đợt.
- [ ] Viết `scripts/qa/README.md`: thứ tự chạy, tài khoản test, cách đọc kết quả, lệnh cleanup khẩn.

**Definition of Done tầng 0**: 1 lệnh chạy tuần tự 4 gói, kết quả PASS/FAIL rõ ràng, sau khi chạy DB staging về đúng baseline.

---

## TẦNG 1 (P0) — Ma trận chức năng từng module

Mỗi module tick đủ 5 cột: **CRUD 4-case** (tạo/sửa/xóa/làm lại) · **Realtime** (2 tab, không refresh tay) · **Phân quyền 3 lớp** (BE 403 + FE ẩn nút + happy-path bằng vai thật — chuẩn `perm-test-standard-e2e`) · **Undo chain** (mọi nút Gỡ/Bỏ/Hủy đi ngược được và số liệu khớp) · **Responsive** (PC/tablet/phone 360px).

| Module | CRUD | Realtime | Quyền | Undo | Responsive |
|---|---|---|---|---|---|
| Nhập kho (tạo phiếu, quét V1/V2, sửa/xóa pallet, hoàn thành/bỏ HT, NCC ghép) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Xuất kho (upload, tạo tay, giao/bắt đầu/quét/hoàn thành, Xuất luôn, Xác nhận nhanh, in phiếu, sửa PAUSED) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Tồn kho (list/facets/summary, điều chỉnh, đổi vị trí, recode, QA, sửa NCC, export) | ☐ | ☐ | ☐ | ☐ | ☐ |
| TMS Đặt lịch + Chuyển kho (booking, đổi ngày, thu hồi, nhận hàng, badge Kho đang sửa) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Đăng ký cổng (đăng ký/gọi/vào/ra, đếm Lần, liên kết chuyến) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Nhặt lẻ (đồng bộ layout Xuất, confirm) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Kiểm kho + Check vị trí | ☐ | ☐ | ☐ | ☐ | ☐ |
| Dồn / Tách pallet (số dư khớp, báo cáo nhập không đổi) | ☐ | ☐ | ☐ | ☐ | ☐ |
| In tem pallet (sinh V1/V2 theo cờ, in lại, truy cứu, lịch sử) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Mã hàng + NCC + Vị trí + Cài đặt WMS/TMS (upsert import, cờ hệ thống) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Quản lý người dùng + phân quyền (cấp/gỡ quyền hiệu lực ≤5', chống leo thang, scope kho+loại) | ☐ | ☐ | ☐ | ☐ | ☐ |
| HR (phân công, chấm công, nghỉ phép) | ☐ | ☐ | ☐ | ☐ | ☐ |

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

Kịch bản "1 giờ cao điểm của kho": chạy đồng thời trong 10–15 phút, ~25–30 request in-flight (không vượt — max_connections=60):

- [ ] Nhóm A: 10 "người" quét nhập liên tục (2 kho, cả V1 lẫn V2)
- [ ] Nhóm B: 10 "người" quét xuất + Xuất luôn + sửa số lượng
- [ ] Nhóm C: 5 "người" book/đổi/thu hồi slot TMS cùng khung giờ
- [ ] Nhóm D: 3 "người" điều chỉnh tồn + dồn/tách cùng lúc
- [ ] Trong lúc chạy: Playwright refresh app 10 lần — **không văng /login, không trang trắng**
- [ ] Kết thúc: chạy gói invariant — phải sạch tuyệt đối
- [ ] Cleanup toàn bộ về baseline

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
