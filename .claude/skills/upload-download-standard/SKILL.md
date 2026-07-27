# Chuẩn Upload / Download (Excel & bulk data)

> BẮT BUỘC theo khi thêm/sửa BẤT KỲ tính năng upload file (Excel/bulk) hoặc download/export dữ liệu.
> Sinh từ sự cố thật 25/07: file KH nhập 8.6k dòng / 3.7k nhóm timeout 60s Vercel (ghi tuần tự),
> + yêu cầu user: "nhiều người cùng upload các kế hoạch của các kho họ" + dữ liệu lớn.
> Mẫu chuẩn ĐẦY ĐỦ NHẤT: `inboundPlanController.bulkCreatePlanLines` (parse→validate→upsert→race-safe→recalc lô).

## A. PARSE file — map theo TÊN cột
- `sheet_to_json(ws)` mặc định (object theo header) hoặc helper `parseSheetByHeader` (`backend/src/utils/excelHeader.ts`) — alias = {key snake_case + nhãn tiếng Việt}, chuẩn hóa trim/lowercase/bỏ dấu → chịu ĐẢO thứ tự cột + đổi tên nhãn. **KHÔNG map theo vị trí cột** (`header: 1` + mảng KEYS — đảo cột là lệch dữ liệu âm thầm).
- Lấy **sheet ĐẦU TIÊN** (chốt user). Guard cột bắt buộc thiếu → 400 báo tên cột (đừng nuốt).
- Ngày: nhận serial Excel (SSF, không qua Date/timezone — bẫy lệch -1 ngày) + dd/mm/yyyy + yyyy-mm-dd. Số: `parseVnNumber` (phẩy = thập phân).
- Template tải về: dấu `*` CHỈ ở cột bắt buộc thực sự (khớp validation BE).

## B. VALIDATE
- Số lượng theo BASE UNIT: cột "Thùng" = entry (mã có entry → SỐ NGUYÊN; mã không entry = base, thập phân OK); cột "Hộp"/lẻ = base. Convert 1 lần tại rìa bằng `qtyFromEntryBase`; BE chốt `qtyIntegerError` (422 theo dòng kèm gợi ý quy đổi).
- Chọn ngữ nghĩa rõ: **all-or-nothing** (Tồn kho · Mã hàng · Vị trí kho — 1 dòng lỗi là KHÔNG ghi gì) hoặc **per-row** (KH nhập — dòng lỗi bị loại, trả list lỗi). Ghi rõ trong response VÀ trong hint dialog. ⚠️ **Mặc định nên all-or-nothing với UPLOAD DANH MỤC** (Mã hàng/Vị trí/Tồn): per-row để lại DB NỬA VỜI — sự cố thật 27/07: file Mã hàng có vài dòng khai Entry Unit mà thiếu Đv/Thùng, per-row ghi 2.662 mã rồi liệt kê lỗi ⇒ user phải xoá tay 2.662 mã mới up lại được. Per-row chỉ hợp khi mỗi dòng là 1 GIAO DỊCH độc lập (KH nhập), không phải khi cả file là 1 bộ danh mục.
- Scope kho + loại hàng: guard TRƯỚC khi ghi (all-or-nothing với scope).

## C. GHI — theo LÔ, idempotent, chống đua
1. **KHÔNG BAO GIỜ ghi tuần tự từng dòng/nhóm** (`for...await` per-row): file 8.6k dòng / 3.7k nhóm = hàng nghìn roundtrip nối tiếp → quá `maxDuration=60s`. Mọi thao tác phải LÔ:
   - INSERT: `insert(chunk 500)`.
   - UPDATE nhiều dòng giá trị khác nhau: `upsert(chunk 500, { onConflict: 'id' })` với **FULL RECORD merge trong JS** — ⚠️ upsert thiếu cột NOT NULL bị **23502: Postgres kiểm NOT NULL trên tuple insert TRƯỚC khi xét conflict** (mẫu: materialController).
   - ⚠️⚠️ **"FULL RECORD" nghĩa là ĐỦ MỌI CỘT file có thể đắp — không phải chỉ cột thường dùng.** PostgREST dựng INSERT từ **HỢP các key của CẢ LÔ**, nên cột chỉ có mặt ở VÀI dòng sẽ bị **ghi NULL đè** ở những dòng còn lại → **mất dữ liệu ÂM THẦM** (không lỗi, không warning), phá đúng cam kết "ô trống giữ giá trị cũ". Tái hiện thật 27/07: 1 file sửa `entry_unit` cho 3 mã + `category` cho 25 mã → 25 mã kia MẤT `entry_unit='CAR'`. **Luật: mỗi field trong `FieldDef[]` phải có mặt trong (a) select nạp record cũ, (b) type, (c) bản ghi `base` khởi tạo từ record cũ.** Thêm cột mới vào mẫu upload = phải sửa đủ 3 chỗ đó. An toàn hơn nữa: nạp bằng `select('*')` rồi `{...ex, ...ô_có_giá_trị}` (mẫu: `inventoryController.uploadExcel` — không dính lỗi này).
   - Find-or-create hàng loạt: fetch ứng viên 1 lượt (phân trang) → khớp trong JS → insert lô phần thiếu. KHÔNG gọi helper find-or-create per-item.
   - Recalc/cache: fetch dòng liên quan 1 lượt (`fetchAllByIdChunks`) → tính trong JS → upsert lô. KHÔNG `Promise.all(ids.map(recalcX))` không giới hạn.
2. **Idempotent theo KEY nghiệp vụ** (user chốt: KH nhập = Ngày+Kho+NCC+Mã hàng): trùng key → UPDATE (last-write-wins), key mới → INSERT, trùng trong file → tự GỘP + warning. Re-upload sau timeout/lỗi mạng = tự vá, không double.
3. **Chống đua đa-user = UNIQUE INDEX ở DB** (JS check không đỡ được 2 người ghi cùng mili-giây):
   - Partial unique index trên key nghiệp vụ, `NULLS NOT DISTINCT` (PG17) cho cột nullable, `WHERE status <> 'CANCELLED'` (vd `uq_inbound_plan_line_active_key`, `uq_tms_order_inbound_group` — migration `20260725_upload_concurrency.sql`).
   - BE bắt **23505** → jitter (100–400ms) → re-fetch dòng/lệnh người thắng → chuyển insert thành UPDATE (hoặc dùng chung lệnh); tối đa 3 vòng rồi 409 "vui lòng upload lại". KHÔNG trả 500.
   - Trước khi tạo index: DỌN di sản trùng trong CHÍNH migration (backup bảng `x_bak_*` + gộp giữ dòng cũ nhất) + `DO $$ RAISE EXCEPTION` nếu còn trùng — production apply nguyên trạng.
4. Giới hạn hạ tầng: payload > 4.5MB → Vercel 413 text thô (FE phải catch báo "tách file"); response phải xong < 60s (đã lô hóa thì 8.6k dòng ≈ 12s, 12 upload đồng thời ≈ 3s).

## D. FE upload dialog
- Dialog CÓ preview bảng → **chip lọc `Tất cả / ✓ Hợp lệ / Lỗi`** (`components/shared/RowFilterChips.tsx` — component dùng chung, mẫu TMSBookings); file có lỗi → mở sẵn tab Lỗi. Preview lớn → dialog 80% màn hình (`w-[80vw] h-[80vh]`, mobile 95vw/90dvh, bảng `flex-1 min-h-0 overflow-auto`).
- Dialog upload-THẲNG (không preview — validate ở server, vd Mã hàng/Tồn kho/KH xuất/VL06O): kết quả phải PHÂN VÙNG rõ (banner xanh OK · vàng cảnh báo nhóm theo lý do · đỏ lỗi) + **tự nới dialog ~80% màn hình khi danh sách dài** (mẫu `UploadExcelDialog` big + 2 modal Outbound), KHÔNG bắt user đọc list trăm dòng trong khung max-w-lg.
- Nút Lưu `disabled={saving}` + spinner; lỗi API = banner đỏ inline; ghi rõ hành vi upsert trong hint ("dòng trùng key … sẽ được cập nhật").
- Resolver danh mục nhận **cả MÃ lẫn TÊN** (kho, NCC — normalize trim+lower/upper).

## E. DOWNLOAD / EXPORT
- Server đọc: `fetchAllRowsParallel` / `fetchAllByIdChunks` (chunk `.in` 300) — **KHÔNG** query trần (cap ~1000 cắt âm thầm), không `.limit(N>1000)`.
- FE xuất: `sanitizeRows` + `saveWorkbook` (saveExcel lazy-load); số theo chuẩn VN; ngày date-only `YYYY-MM-DD`/`dd-mm-yyyy` nhất quán với parser upload (round-trip: file export phải upload lại được — vd export Tồn kho 2 cột Thùng+Hộp nguyên).
- Export tôn trọng filter đang áp trên list; dữ liệu lớn → nút hiện trạng thái đang tải.

## Checklist
- [ ] Parse theo TÊN cột (sheet đầu, guard cột bắt buộc, ngày/số VN-safe)
- [ ] Validate base-unit + số nguyên; ngữ nghĩa all-or-nothing/per-row rõ
- [ ] Ghi LÔ 500 (insert/upsert full-record/find-or-create lô/recalc lô) — 0 vòng `for...await` per-row
- [ ] Key nghiệp vụ + upsert idempotent (re-upload không double)
- [ ] Unique index DB + bắt 23505 retry/jitter → 201/409, không 500, không dup
- [ ] FE: chip lọc hợp lệ/lỗi, dialog lớn khi preview lớn, disabled saving, hint upsert
- [ ] Download: phân trang đầy đủ + chunk .in + round-trip với template upload
- [ ] Test: file lớn (≥ file thật) đo thời gian < 55s + test đua (N request cùng key đồng thời → 0 dup) + dọn sạch
