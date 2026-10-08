# WMS Supply Chain Webapp

> **File này = LUẬT phải làm (bản rút gọn, 28/09/2026).** Bản đầy đủ có lý do · số đo · lịch sử: luật chung ở `docs/rules/*.md`, từng module ở `docs/modules/<key>.md`. **Sửa module nào: đọc file module đó + mọi file trong mục "Giao thoa với" của nó + mục "GIAO THOA GIỮA CÁC MODULE" dưới đây.** Thêm luật mới: luật ngắn vào đây, diễn giải dài vào `docs/`.

## Quy tắc làm việc
- Ngôn ngữ trao đổi: **tiếng Việt**.
- **User CHỈ làm trên `dev` / Preview + DB staging (user chốt 25–26/09 và nhắc lại 28/09: "không có main ở đây").** Báo cáo cho user KHÔNG nhắc `main` / production / merge / migration chờ lên production — đó là nhiễu. Việc cần làm khi lên production chỉ ghi vào `SCHEMA_REVIEW.md` / memory để lúc merge không sót; quy trình merge bên dưới chỉ áp khi user CHỦ ĐỘNG đòi lên production.
- **Quy trình 2 môi trường (từ 07/07/2026)** — remote `https://github.com/vietnamese2212/wms-webapp.git`:
  - **Làm việc mặc định trên branch `dev`** — push `dev` sau mỗi lần sửa → Vercel Preview (URL riêng) + **DB STAGING** (Supabase cũ `bxxryrmpfabvjitqbdnw`, data test). Dev/test/load-test/seed thoải mái ở đây.
  - **User nghiệm thu trên Preview → mới merge `dev` vào `main`** → Vercel Production (`wms-webapp.vercel.app`) + **DB LOF production** (`svicyfquresxaigfxsdb`). KHÔNG push thẳng main trừ hotfix khẩn (lỗi chặn vận hành) — hotfix phải verify kỹ hơn vì không qua staging.
  - **CHỐNG HỒI QUY — cổng CỨNG trước khi merge `dev`→`main`:** `node scripts/qa/run-all.mjs --tier full` phải **XANH TOÀN BỘ** (chưa xanh = KHÔNG merge, kể cả đã nghiệm thu Preview); hotfix thẳng main tối thiểu `invariant`+`smoke`. **Sau mỗi fix trên dev: `--tier fast`** + gói QA của module vừa sửa. **Gói tải `03-scale` · `05-rush` · `06-readload` PHẢI XIN PHÉP** (`QA_ALLOW_LOAD=1`, ngoài giờ) — staging là Supabase NANO, bắn tải cạn Disk IO là cả dev chết nhiều giờ. Chi tiết: [docs/rules/qa-and-release.md](docs/rules/qa-and-release.md).
  - **TẦNG MÁY RẺ NHẤT:** `cd backend && npm test` (~3 s, không cần DB) = `tests/unit` (bất biến helper thuần) + `tests/mirror` (bản BE và FE của một helper PHẢI ra cùng kết quả — ratchet `mirror_helper_without_test`). **Phép kiểm mới phải ĐỎ trên bản lỗi trước khi tin** (`git stash` bản vá). **Sổ lớp lỗi `docs/qa/BUG_CLASSES.md`**: mỗi lỗi gắn **LẶP** (sửa LƯỚI, không chỉ vá bug) / **MỚI** (thêm dòng + tầng lưới rẻ nhất: tsc → test đơn vị → ratchet 09 → ratchet độ phủ → gói QA → error_logs). Route write MỚI bắt buộc `validate({…})` (zod, `middlewares/validate.ts`); file BE MỚI import `db` có kiểu (`npm run db:types` sau mỗi migration đã apply); route/quyền mới phải có gói QA chạm (`coverage-surface.mjs --ratchet`). Chi tiết: [docs/rules/qa-and-release.md](docs/rules/qa-and-release.md).
  - **PIPELINE ĐI TUẦN + CỔNG KHÔNG ĐƯỢC KÊU OAN:** mỗi push dev = GitHub Actions `ci` (cổng tĩnh + tsc BE/FE + build) + QA smoke trên Preview; tài khoản chạy bộ kiểm do CI **tự cấp rồi xoá** (`scripts/qa/ci-account.mjs`, CHỈ staging — khoá production không bao giờ vào CI). **`.githooks/pre-push`** chạy `run-all --tier fast --offline` + `tsc` BE/FE, đỏ là chặn push (bật một lần mỗi máy: `git config core.hooksPath .githooks`) — cổng tại máy phải chặn ĐỦ những gì job `static` chặn, phần chênh lệch chính là phần thành email đỏ. Gói QA MỚI kết thúc bằng `finish()`/`tally()` (tự in `::error` nêu tên phép hỏng); chỉ gói đọc trạng thái CHUNG của DB mới dùng `retryOnFail`; phép kiểm mồ côi phải NÊU MÃ trong `detail`. Mọi 5xx BE + lỗi JS FE ghi `error_logs`, digest hằng ngày. **Cổng tĩnh ratchet** `09-static-gate.mjs` + `static-baseline.json`: vi phạm không được TĂNG, dọn được thì `--update-baseline`. Chi tiết + lịch sử các lần email đỏ oan: [docs/rules/qa-and-release.md](docs/rules/qa-and-release.md).
  - **LUẬT "BUG CHẾT HAI LẦN" (chốt 29/07, thêm tầng 11/09):** fix bug nào cũng phải kèm ÍT NHẤT 1 trong 4 — (1) ràng buộc KIỂU làm lỗi đó thành lỗi biên dịch (vd `FilterBar serverSearch` bắt buộc `selectedOpts`, `db` có kiểu), (2) **test đơn vị/mirror trong `backend/tests`** (helper thuần, hai bản BE⇄FE), (3) luật vào cổng tĩnh ratchet (09-static-gate), (4) phép kiểm vào bộ QA (mẫu: bug `?codes=` rỗng → gói 07-params-fuzz). Chọn tầng RẺ NHẤT bắt được lớp đó. Không có = CHƯA fix xong. Gốc rễ đã đo 29/07: cả 3 lỗi nghiệm thu đều là VI PHẠM LẶP LẠI của luật đã ghi trong file này — luật văn xuôi không tự thi hành, phải chuyển thành máy móc.
  - **Migration schema: apply STAGING trước → test → mới apply DB production** (cả 2 qua Supabase Dashboard từng project). `.env` local + `.mcp.json` trỏ STAGING; key production chỉ nằm trong Vercel env — Postgres MCP soi staging, muốn soi production phải nói rõ. ⚠️ `backend/.env` có **`LOF_DATABASE_URL`** (production) và **`DIRECT_URL`** (staging GHI ĐƯỢC — `DATABASE_URL` là read-only có chủ đích, `CREATE TRIGGER` qua nó sẽ 25006).
  - **CUTOVER production: SO SCHEMA HAI BÊN BẰNG MÁY** — `node scripts/qa/prod-parity.mjs` (production ↔ staging: bảng · cột · hàm · index · trigger · event trigger + 3 bất biến bảo mật), không tin sổ tay; ranh giới migration lấy từ `git ls-tree main` ∖ `dev`, KHÔNG theo ngày; gom part bọc `BEGIN…COMMIT`. Mẫu `docs/plans/CUTOVER_2026-09-24.md`. Chi tiết: [docs/rules/qa-and-release.md](docs/rules/qa-and-release.md).
  - Kiến trúc multi-tenant (1 code — mỗi đơn vị 1 DB+deploy, cờ theo khác biệt không theo tenant): memory `multi-tenant-silo-architecture`.
- **Đổi DB schema**: SQL → `backend/migrations/YYYYMMDD_<desc>.sql` → apply qua Supabase Dashboard → push → cập nhật `SCHEMA_REVIEW.md`. (Chi tiết: skill `mutation-realtime`.)
- **`Template upload.xlsx` (thư mục gốc) = DỮ LIỆU UPLOAD GỐC của user — TUYỆT ĐỐI KHÔNG sửa/ghi đè, KHÔNG `git add`** (OneDrive hay tự lưu lại đổi byte; luôn `git add` từng file cụ thể, đừng `git add -A`/`git add .`). Chỉ ĐỌC để soi cấu trúc/debug upload.

---
## Nguyên tắc hành vi khi xây dựng app

### 1. Suy nghĩ trước khi code
> **Đừng tự suy diễn. Đừng che giấu sự không chắc chắn. Hãy nêu rõ các đánh đổi.**

Trước khi triển khai:
- Nêu rõ các giả định của bạn. Nếu không chắc, hãy hỏi.
- Nếu có nhiều cách hiểu khác nhau, hãy trình bày chúng — đừng tự âm thầm chọn một.
- Nếu có cách đơn giản hơn, hãy nói ra. Sẵn sàng phản biện khi cần.
- Nếu có điều gì chưa rõ, hãy dừng lại. Chỉ rõ điểm gây mơ hồ. Hỏi lại.

### 2. Ưu tiên sự đơn giản
> **Chỉ viết lượng code tối thiểu để giải quyết vấn đề. Không thêm thứ chưa cần.**

- Không thêm tính năng ngoài yêu cầu.
- Không tạo abstraction cho thứ chỉ dùng một lần.
- Không thêm “tính linh hoạt” hay “khả năng cấu hình” nếu chưa được yêu cầu.
- Không viết xử lý lỗi cho các trường hợp gần như không thể xảy ra.
- Nếu bạn viết 200 dòng nhưng thực tế có thể giải bằng 50 dòng, hãy viết lại.

Tự hỏi:
> “Một senior engineer có thấy đoạn này bị over-engineering không?”

Nếu có, hãy đơn giản hóa.

### 3. Thay đổi có chủ đích, phạm vi nhỏ
> **Chỉ chạm vào thứ cần thiết. Chỉ dọn dẹp phần bạn gây ảnh hưởng.**

Khi chỉnh sửa code hiện có:
- Đừng “tiện tay cải thiện” code, comment hay format ở vùng liên quan.
- Đừng refactor thứ chưa hỏng.
- Hãy theo style hiện có, kể cả khi bạn thích cách khác hơn.
- Nếu thấy dead code không liên quan, hãy ghi chú — đừng tự xóa.

Khi thay đổi của bạn tạo ra phần thừa:
- Xóa import/variable/function mà CHÍNH thay đổi của bạn làm thành không dùng nữa.
- Đừng xóa dead code có sẵn từ trước nếu chưa được yêu cầu.

Nguyên tắc kiểm tra:
> Mỗi dòng thay đổi đều phải truy ngược được tới yêu cầu của người dùng.

### 4. Thực thi theo mục tiêu rõ ràng
> **Định nghĩa tiêu chí thành công. Lặp lại cho tới khi xác minh được.**

Biến task thành các mục tiêu có thể kiểm chứng:
- “Thêm validation” → “Viết test cho input không hợp lệ, sau đó làm cho test pass”
- “Fix bug” → “Viết test tái hiện bug, sau đó sửa để test pass”
- “Refactor X” → “Đảm bảo test pass cả trước và sau refactor”

Với task nhiều bước, hãy nêu kế hoạch ngắn gọn:
```txt
1. [Bước] → kiểm tra: [điều cần verify]
2. [Bước] → kiểm tra: [điều cần verify]
3. [Bước] → kiểm tra: [điều cần verify]
```

Tiêu chí thành công rõ ràng giúp bạn làm việc độc lập tốt hơn.
Tiêu chí mơ hồ kiểu “làm cho nó chạy được” sẽ khiến phải hỏi lại liên tục.

### Các nguyên tắc này đang hiệu quả nếu:
- Diff có ít thay đổi thừa hơn
- Ít phải viết lại do over-engineering
- Các câu hỏi làm rõ xuất hiện trước khi implement thay vì sau khi gây lỗi

---
## Chuẩn code bắt buộc (luật cốt tử — chi tiết nằm trong skill)

**QUY MÔ — app phục vụ VÀI NGHÌN người dùng, dữ liệu VÀI TRIỆU dòng/năm:**
- Mọi thiết kế/query phải giả định bảng nghiệp vụ (InventoryEntry, OutboundScanEntry, TmsOrder, Attendance, gate_registrations…) sẽ có **hàng triệu dòng** — "hiện tại mới vài trăm dòng" KHÔNG phải lý do bỏ qua.
- **PostgREST cap ~1000 dòng/response** — query không phân trang bị cắt ÂM THẦM (data thiếu, báo oan, dedup hỏng); `.limit(N>1000)` cũng KHÔNG vượt được cap.
  - **Lớp lỗi tái phát nhiều nhất** — có 2 lưới: RUNTIME (`lib/supabase.ts` bắt response đúng trần mà không khai `limit` ⇒ `error_logs` `CAP_TRUNCATED`) + CI ratchet `unpaginated_in_query`. Gốc rễ: **đừng KÉO DÒNG để tính ra một TẬP** — hỏi DB trả DISTINCT/count (RPC). List dùng `fetchAllRowsParallel` (`utils/pagination`) / range-loop; kiểm quyền/scope phải trên ĐỦ mọi dòng; test tra-tập phải seed vượt ngưỡng. Chi tiết: [docs/rules/scale-and-data.md](docs/rules/scale-and-data.md).
- **DANH SÁCH ID TRONG URL — 2 TRẦN CỨNG (đo thật 27/07, memory `id-list-url-limits`):** filter `.in()`/`.or(in.())` của PostgREST và query-string của API đều nằm trên URL.
  - **BE → PostgREST: tối đa ~300 id uuid (~11KB)** — 400 id đứt kết nối, 700 id → `400 Bad Request`. Giá trị ngắn (mã hàng/DO 9–10 ký tự): ~800–1000. ⇒ mọi `.in('col', ids)` mà ids **có thể** vượt 300 phải **chunk 300** (`fetchAllByIdChunks` / `chunkArray`), kể cả UPDATE/DELETE (filter cũng trên URL). Chunk 500 là SAI. **`.slice(0, 300)` trên lệnh GHI = CẮT ÂM THẦM** (08/10: Xác nhận 819 xe chỉ đổi trạng thái 300 xe) — chia lô `for (i += 300)`; đầu vào đã chặn ≤ 300 thì ghi chú `≤300: lý do` tại chỗ (ratchet `write_in_sliced_cap`).
  - **Client → API (Vercel): query string tối đa ~800 id uuid (~32KB)** → vượt là **414** *trước khi* tới BE (chunk phía BE vô hiệu). ⇒ FE **không** nhồi danh sách id lớn vào query: gửi **cờ ngữ nghĩa** để BE tự resolve (mẫu `requires_only=1` ở Kiểm kê), hoặc chặn + hướng dẫn thu hẹp (KHÔNG cắt âm thầm).
  - **Lọc theo KHO phải dùng cột `warehouse_id` trực tiếp**, KHÔNG liệt kê vị trí của kho (bug 504 Bàu Bàng 27/07 — 1.517 vị trí = 55KB URL).
  - **Danh sách id truyền cho RPC thì đi POST body → KHÔNG dính trần URL.** Cần lọc theo tập id lớn (vị trí của kho, scope nhân sự…) mà vẫn phải ORDER BY/OFFSET/COUNT chính xác ⇒ viết RPC nhận `text[]` rồi `= ANY($1)`. Kho 1.517 vị trí: từ 24 round-trip (chunk 300 × 4 câu đếm) còn **1**.
- **SỐ REQUEST PostgREST MỖI LẦN MỞ TRANG LÀ TÀI NGUYÊN HIẾM (đo 28/07, memory `postgrest-pool-roundtrips`):** nút thắt dưới tải KHÔNG phải máy Postgres mà là **pool ~10 khe NỘI BỘ của PostgREST**. Bằng chứng — cùng lúc 24 luồng ghi, một câu CỰC NHẸ qua 3 đường: **pg trực tiếp p95 347ms** (máy DB khoẻ hoàn toàn) · PostgREST trực tiếp p95 2.414ms · qua backend p95 4.404ms; đỉnh connection chỉ 24-27/60 nên **KHÔNG phải `max_connections`**. Mỗi request HTTP tới PostgREST chiếm 1 khe + tốn **3 câu SQL** (`set_config` + câu thật + `COMMIT`). Có hàng đợi thì độ trễ ≈ **SỐ REQUEST × thời gian chờ**, nên request thừa làm chậm CẢ APP, không chỉ trang đó. Ba luật:
  1. **RPC phân trang phải trả về DÒNG (jsonb), KHÔNG trả id rồi để backend nạp lại** — trả id biến 1 request thành `1 + n/300`. In tem 1 trang 100 phiếu (~3.000 tem): **11 request → 1**. Sắp xếp làm luôn trong SQL.
  2. **Ô SummaryBand/tổng: gom hết vào 1 lời gọi**, đừng mỗi ô một câu đếm. Suy ra được thì đừng đếm (`Vehicle.is_active` NOT NULL ⇒ `inactive = total − active`). Danh sách + tổng + tra tên của cùng một dải nên đi chung 1 RPC (Dashboard khu: 3 request → 1).
  3. **Đếm round-trip bằng ĐO, đừng đọc code đếm tay** (vòng lặp chunk phụ thuộc dữ liệu): `pg_stat_statements` lọc `userid` = role **`service_role`** (KHÔNG phải `authenticator`), và so khớp theo TỪNG `queryid` chỉ lấy delta dương — `sum(calls)` sai vì bảng đầy 5.000 entry sẽ EVICT làm tổng TỤT.
- **THẤY HẾT ≠ VẼ HẾT (07/10, C65):** bảng không phân trang mà số dòng tăng theo dữ liệu (Xem đơn Điều vận — user chốt thấy hết một màn) ⇒ thân bảng qua `WindowedRows` (chỉ vẽ dòng đang thấy, dòng phải cao đều). Đo: 3.529 dòng vẽ hết = 207 nghìn phần tử, tick 1 đơn ~1,1 s → ~38 ms. Test `backend/tests/unit/rowWindow.test.ts`. Chi tiết: skill `table-format` mục 4b.
- **TRẦN 4,5MB RESPONSE của Vercel (đo 28/07)** — không chỉ upload mới có trần. Mọi endpoint trả list phải hỏi "mỗi dòng bao nhiêu byte × bao nhiêu dòng tối đa?": dòng công 552 B, dòng nhân sự ~830 B, dòng tồn kho ~700 B. Bảng công 1 tháng vượt trần từ **~290 nhân sự**; danh sách nhân sự từ ~5.400. ⇒ Trang nào payload tăng theo dữ liệu thì phân trang server, đừng chờ "khi nào đông thì tính". **UPLOAD > 4MB (29/09, ZSD02 8,4 MB bị chặn): mọi hook upload Excel đi qua `excelUploadBody` — file lớn đẩy THẲNG lên bucket riêng tư `excel-uploads` bằng vé ký (`POST /wms/uploads/sign`) rồi gọi cửa nạp với `{ storage_path }`; BE middleware `excelFromStorage` (sau multer ở MỌI route upload Excel) tải về, dựng `req.file`, xoá file — controller không đổi. Cửa upload Excel MỚI phải nối `excelFromStorage`. Trần thật 10 MB (multer) / 30 MB (bucket).**
- **DANH MỤC LỚN KHÔNG ĐƯỢC NẠP CẢ VÀO TRÌNH DUYỆT (chốt 27/07, memory `catalogue-payload-campaign`):** Mã hàng / Vị trí / Biển số xe (và mọi danh mục sẽ vượt ~1.000 dòng). Đo thật: 2.740 mã = **2.566KB**/lần gọi, nạp ở 12 chỗ; cột **rỗng 100% vẫn tốn ~60KB** vì tên cột lặp theo SỐ DÒNG. Ba luật:
  1. **Ô chọn (dropdown/filter) = TÌM TRÊN SERVER** (`search` + `limit: 50` + `useDebouncedValue(term, 250)`, bật `serverSearch` của `SingleSelect`/`FilterBar`). **Giá trị đã chọn PHẢI LUÔN CÓ NHÃN** — ghép dòng đang chọn tra theo id (`useMaterialsByIds`…, chunk 300) với kết quả tìm qua `dedupOpts`; ưu tiên MÃ NGHIỆP VỤ làm value. Chi tiết: [docs/rules/scale-and-data.md](docs/rules/scale-and-data.md).
  1a′. **Số của MỘT mã đứng cạnh nhãn đơn vị = `qtyLabel` "N thùng + M hộp", KHÔNG `qtyEntryText` (thùng thập phân) — ratchet `entry_decimal_beside_unit_label` baseline 0 (19/09):** soi màn bằng vai thủ kho thấy cột "Vị trí lấy" in "76,438th" cho pallet mà bảng Tối ưu tuyến in "76 thùng + 21 hộp", dialog tra tồn in "16.345,667 thùng" — 0,438 thùng là 21 hộp, người kho không đọc ra; 10 chỗ cùng khuôn đã sửa. `qtyEntryText` CHỈ cho cột số hẹp có tiêu đề "Thùng" và ô tổng cross-mã.
  1b. **Ô tổng gộp nhiều ĐƠN VỊ = nhãn `QTY_CONVERTED_LABEL` "SL (quy đổi)" + `QTY_CONVERTED_TIP`** (từ `utils/qtyUnits.ts` — nguồn DUY NHẤT, đừng tự đặt chữ; từ vựng chốt 26/07, quét toàn app 29/07): ô "Thùng tồn" cũ thực chất = thùng thật + EA + KG + SET/M2/BAG (đo staging: 118.195.050 mà chỉ 1.127.990 là thùng) — công thức đúng luật base-unit nhưng nhãn khiến đọc ra "118 triệu thùng hàng". Cột per-MÃ tách Thùng/Hộp (OutboundDetail/LoosePickingDetail) giữ nhãn "Tổng thùng" — đó là số CHÍNH XÁC per-mã, không phải bug. Cổng tĩnh 09 gác nhãn sai bằng ratchet.
  2. **Bảng tra hiển thị (lịch sử, map code→tên) = tra ĐÚNG mã trên màn**: `useMaterialsByCodes(codes)` (chunk 300). KHÔNG nạp cả danh mục để dò vài dòng.
  3. **Chỗ quy đổi số lượng (`qtyFromEntryBase`) phải tra ĐỒNG BỘ trước khi ghi/điền** (`fetchMaterialsByCodes`) — điền trước rồi vá sau = **SỐ SAI**. Dán Excel: `e.preventDefault()` TRƯỚC `await`.
  Chỉ trang danh mục gốc mới lấy đủ cột (`useMaterialsFull` / `useLocationsFull`); còn lại mặc định `view=lite`.
  **Vị trí cũng thuộc luật này (15/08):** ô chọn vị trí tìm-trên-server, cắt 50 dòng phải giữ nhóm ★ "đang để dở cùng mã" (`sameMaterialLocIds`), nhãn giá trị qua param `ids` + `useLocationsByIds`; ratchet `catalogue_full_load` gác. Chi tiết: [docs/rules/scale-and-data.md](docs/rules/scale-and-data.md).
- **N+1 KHÔNG CÓ TRIỆU CHỨNG — để MÁY canh:** ratchet `n_plus_1_supabase_in_map` gác `.map(async …)` gọi supabase không chia lô; cần tập thì hỏi DB trả DISTINCT/tổng hợp. N+1 chạy SAU khi đã commit còn đẻ bản ghi đôi khi user bấm lại lúc quá hạn. Chi tiết: [docs/rules/scale-and-data.md](docs/rules/scale-and-data.md).
- Gặp vấn đề cùng họ scale (query kéo cả bảng, N+1 roundtrip, đếm/tổng client-side trên list cắt cụt, ghi tuần tự từng dòng…) → **tìm giải pháp và xử lý NGAY trong lượt làm việc đó**, không hoãn, không chỉ fix chỗ đang đụng — quét luôn các chỗ cùng pattern.

**Mutation & realtime** (skill `mutation-realtime` + `verify-feature`):
- Mọi INSERT phải có `id: randomUUID()` + `updated_at: new Date().toISOString()` — DB không có DEFAULT, thiếu → **lỗi 23502**. `import { randomUUID } from 'crypto'`. DB client: `import { supabase } from '../../lib/supabase'`.
- **Upload/ghi hàng loạt KHÔNG ghi tuần tự từng dòng** (`for...await` ⇒ quá 60 s Vercel): ghi LÔ chunk ~500 — mã mới `insert(chunk)`, mã đã có `upsert(chunk, { onConflict: 'id' })` với record ĐỦ CỘT merge trong JS; lỗi lô rơi về từng dòng. Mẫu `materialController.uploadExcel`; chuẩn đầy đủ ở skill `upload-download-standard`. Chi tiết: [docs/rules/scale-and-data.md](docs/rules/scale-and-data.md).
- Tính năng cập nhật số liệu phải **realtime** (không refresh tay) + test đủ **4 case: tạo / sửa / xóa / làm lại**. `invalidateQueries` đủ MỌI key liên quan; thêm key vào `TABLE_QUERY_MAP` (`realtimeEvents.ts`); optimistic phải rollback khi lỗi.
- **REALTIME = BROADCAST TỪ TRIGGER DB** (`trg_wms_notify`, kênh riêng tư `wms-db-changes`), không còn `postgres_changes`. **Bảng mới cần realtime → chỉ thêm dòng `TABLE_QUERY_MAP`** (event trigger tự gắn trigger); **TUYỆT ĐỐI KHÔNG `CREATE POLICY … TO authenticated`** — `authenticated`/`anon` có 0 quyền bảng · 0 policy · 0 hàm (gói QA 00 mục 10b/10c gác); RPC mới KHÔNG cần GRANT. `SUPABASE_JWT_SECRET` trên Vercel bắt buộc (thiếu = realtime chết câm). Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).

**Đồng thời — VÀI TRĂM nhân sự cùng thao tác** (skill `verify-feature` Cổng 5 + `concurrency-hardening`):
- **Luôn đặt app vào tình huống hàng trăm người cùng xuất/nhập/booking** khi làm/test tính năng ghi số liệu. Hai điều TỐI KỴ: (1) app treo / đá user ra `/login`; (2) dữ liệu sai khi nhiều người cùng làm.
- Mọi cập nhật trên **bộ đếm/tổng/tồn/sức chứa DÙNG CHUNG** phải nguyên tử: đếm sống dưới row-lock (RPC, vd `book_vehicle_slot`) hoặc **optimistic-CAS** (`update … WHERE col=giá_trị_đọc`) — KHÔNG ghi mù `col = đọc + delta` (mất cập nhật khi đua). Mẫu: `consumeInventoryExact`, `addItemScanned`, `adjustInventoryAtomic`.
- **Optimistic-CAS / retry-on-conflict PHẢI có jitter+backoff** giữa các lần thử (không thì thundering herd → nửa số request 409 oan).
- Test tải: gọi **API thật**, dữ liệu **bám DB thật**, **rải + tranh chấp + đa-module đồng thời**, ~25–30 in-flight (đừng bão hoà `max_connections=60`, đừng bắn lúc user thật đang dùng), Playwright **refresh giữa tải** (không văng) + kiểm bất biến (tồn không âm/không xuất quá, không overbooking, cache khớp), rồi **dọn sạch**.

**Phân quyền** (skill `add-permission`):
- Mọi nút/route gọi API write phải gate `can(perms, module, action)` (FE) + `requirePerm` (BE). Mỗi action = 1 permission riêng (không gộp `manage`). Thêm action = đủ **4 nơi**: FE config, **BE config** (thiếu → admin mất quyền), gate nút, route BE.
- **Lối tắt tới trang module nằm NGOÀI menu** ("Thao tác nhanh", "Mở chuyến", "Khách hàng →"…) hỏi CÙNG luật với menu qua `useCanSeePath()` — không thì vai thiếu quyền thấy nút chết (C66, ratchet `page_link_without_perm_guard`).

**BASE UNIT — lõi số lượng (LUẬT CỐT TỬ, user chốt 19–20/07 — "làm sai là vứt đi"):**
- **App TÍNH TOÁN toàn bộ bằng BASE UNIT** (hộp/chai/KG… = đơn vị gốc khai per mã ở `Material.base_unit`): MỌI lưu trữ, cộng/trừ, tồn kho, xuất/nhập/nhặt lẻ, đối chiếu = số **BASE**. **Entry unit (thùng, `Material.entry_unit`, hệ số `units_per_carton`) CHỈ là lớp THỂ HIỆN.**
- **Hiển thị = Entry + phần Base thừa**: số base → `qtySplit` = **"N thùng + M hộp"** (M = phần lẻ vượt bội số 1 thùng). Mã KHÔNG entry → hiện nguyên base (KG/EA). Tồn kho, Xuất, Nhặt lẻ, quét… đều phải thể hiện **Thùng + Hộp lẻ**. Helper TẬP TRUNG BE+FE mirror `utils/qtyUnits.ts`: `qtySplit`/`qtyLabel`/`qtyEntryDecimal`/`qtyFromEntryBase`/`qtyIntegerError` — **sửa công thức = sửa 1 chỗ, KHÔNG tự `/`·`%`·`× upc` rải rác**.
- **Luật số nguyên**: mã có entry → base phải **SỐ NGUYÊN** (hộp không có 0,5); nhập liệu = **2 ô Thùng+Hộp** (`components/shared/QtyInput`), quy đổi tại rìa bằng `qtyFromEntryBase`. Mã không entry (KG) → thập phân tự do. BE chặn 422 (`qtyIntegerError`) + upload lỗi theo dòng kèm gợi ý quy đổi.
- **Tổng cross-mã (khác `units_per_carton`) PHẢI `qtyEntryDecimal` per-mã TRƯỚC khi cộng** → "thùng quy đổi" (cộng base thô rồi gắn nhãn "thùng" = SAI, thổi tổng). Mọi trường số lượng qua API = BASE (cờ `qty_semantics:'base'` chặn bundle cũ 409); FE quy đổi tại rìa.
- **Quét nhặt lẻ HỘP = quét QR PALLET (đã có) + trừ số hộp khỏi tồn base** — KHÔNG cần QR tới hộp (QR nhỏ nhất = pallet/thùng). Thùng lẻ = quét; hộp lẻ = nhập tay/đếm.
- **BẮT BUỘC CHÍNH XÁC + fix MỌI lỗi hiển thị/tính toán liên quan.** Rà kỹ mọi điểm đọc `cartons_*`/`loose_picking` (nhất là **tổng ở list/detail** + **Nhặt lẻ** — hay sót). **Luôn VERIFY SỐNG số hiển thị, đừng tin "đã kiểm OK".** Chi tiết + tiến độ: memory `base-unit-campaign` + `docs/plans/BASE_UNIT_EXECUTION_PLAN.md`.

**BIỂN SỐ XE — chỉ CHỮ và SỐ, viết HOA, không ngăn cách (`^[A-Z0-9]+$`, user chốt 31/07):**
- Chuẩn hoá bằng helper TẬP TRUNG, đừng tự `replace` rải rác: BE `utils/plate.ts` (`normalizePlate`) ↔ FE `utils/formatters.ts` (`normalizeLicensePlate`) — 2 bản MIRROR, sửa luật phải sửa cả hai.
- **Chuẩn hoá ở BACKEND, không chỉ ở ô nhập.** Form FE chuẩn hoá từ lâu mà dữ liệu vẫn bẩn (đo 30/07: Vehicle 11 dòng, gate 2 dòng) vì còn đường ghi KHÔNG qua form (API tích hợp, upload Excel, script import) — và `vehicleController` cũ chỉ bỏ khoảng trắng, GIỮ dấu gạch nên tự đẻ ra `29E-09404`. Thêm đường ghi biển số mới → gọi `normalizePlate` tại rìa.
- **DB có CHECK `^[A-Z0-9]+$`** trên `Vehicle` · `gate_registrations` · `GroupDeliveryOrder` · `TmsVehicleSlot` (migration `20260731_plate_format`) — ghi sai dạng là **23514**, không âm thầm.
- **NGOẠI LỆ — 2 cột lưu NGUYÊN VĂN nguồn ngoài, KHÔNG chuẩn hoá:** `WeighTicket.license_plate` (bản sao phiếu cân giấy; dạng chuẩn nằm ở cột `license_plate_norm`, FE hiển thị cột này) và `erp_outbound_orders.license_plate` (raw SAP). Sửa 2 cột đó = mất khả năng đối chiếu chứng từ gốc.
- So khớp biển giữa các module (phiếu cân ↔ chuyến ↔ cổng) luôn so trên dạng CHUẨN, đừng so chuỗi thô.

**Timezone — Asia/Ho_Chi_Minh (UTC+7):**
- ⚠️ **ĐỌC MỐC TỪ DB PHẢI QUA `utcMs()`; SO MỐC VỚI NGÀY VN PHẢI QUA `vnDayOf()`** (`utils/dates.ts`, phía script `scripts/qa/utcms.mjs`): schema trộn `timestamp` không offset và `timestamptz`, `new Date(chuỗi không offset)` lệch 7 giờ trên máy ở VN (không bao giờ lộ ở production). Ratchet `naive_db_timestamp_parse` · `utc_slice_as_vn_day`. **Khuôn: thấy `new Date(<cột thời gian>)` hoặc `.slice(0,10)` trên một mốc thì hỏi "đang đo bằng đồng hồ nào?"**. Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).
- Business date (`import_date`…): lưu ngày VN `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })`. System timestamp (`created_at`…): UTC `toISOString()`. Query khoảng ngày VN: `new Date(\`${vnDate}T00:00:00+07:00\`).toISOString()`.
- Hiển thị: date-only → `formatDate()`; timestamp → `formatDateTime()`/`formatTimestampDate()`/`formatTimestampTime()` (dùng `Intl` + timezone VN, không phụ thuộc OS). Cell hẹp: `formatTimestampDate(s, true)` → `dd-MM-yy`. Tất cả từ `utils/formatters.ts`.
- **`InventoryEntry.import_date` = NGÀY HÀNG THỰC TẾ VÀO KHO**, không phải ngày chứng từ; thao tác NỘI BỘ (tách pallet…) phải KẾ THỪA ngày này, không đặt `vnDate()`. Thêm đường ghi `InventoryEntry` mới → hỏi "hàng có thật sự vừa vào kho không?". Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).

**LỖI 5xx PHẢI NÓI RÕ CHỖ XẢY RA:** `recordServerError('be', …)` bắt buộc `url` ở mức kiểu; `fail()` tự lấy route. **Id rác trên `:param` → 400; tham số trông như injection → 400** (một middleware `/api` ở `app.ts`, QA gói 07). **Ngày đúng dạng nhưng không có thật → 400, lưới phủ CẢ `req.query` LẪN `req.body`**; trong controller dùng `isDay`/`dayOrNull` (`utils/dates.ts`), ratchet `date_regex_without_calendar_check`. Khuôn: lưới chặn input phải phủ cả query lẫn body, cả mọi động từ. Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).

**VIỆC NỀN HỎNG PHẢI PHÂN BIỆT QUÁ TẢI VỚI HỎNG THẬT:** đường nền (`alertScanner`, `planGdoTasks`…) ghi lỗi qua `recordBackgroundFailure(message, code, where, e)` — quá tải ⇒ 503 `*_OVERLOAD` (không cờ đỏ), hỏng thật ⇒ 500; ratchet `background_error_500_hardcoded`. Vá luật vào `fail()` thì hỏi "đường nào ghi error_logs mà không đi qua fail?". Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).

**LỖI POSTGRES = LỖI ĐẦU VÀO:** gọi `fail(res, error)` với CẢ đối tượng lỗi (đừng `error.message`) để `pgUserError` dịch 22P02/23xxx/22xxx → 400/409, PGRST116 0 dòng → 404. ĐỪNG chặn id theo hình dạng UUID (48/82 bảng khoá TEXT). Mọi `.delete()`/`.update()` theo id phải `.select()` rồi kiểm số dòng (0 dòng = 404). Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).

**HANDLER ASYNC NÉM LỖI = TREO 60s → 504:** router MỚI mount vào `app.ts` phải đi qua `catchAsyncErrors` (lưới cuối trả JSON `INTERNAL` + ghi `error_logs`); handler mới vẫn tự `try/catch` + kiểm kiểu. Thấy 504 ở route nhẹ → nghi TypeError trên body sai kiểu. Cổng ERP `/integration/v1/*` `MAX_LIMIT=999`; route xác thực bằng khoá API thì bộ kiểm tự cấp khoá. **Đường ĐỌC phải cắt scope như đường GHI.** Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).

**PHÉP KIỂM CŨNG CÓ ĐIỂM MÙ THEO CHIỀU (chốt 07/09, memory `qa-blind-spot-by-verb`):** lưới id-rác quét route TỪ CODE nhưng chỉ khớp `router.get(` ⇒ mù với PUT/PATCH/DELETE — nơi 500 sống dai nhất (12 ca bị bỏ lọt suốt 17 ngày). Viết phép kiểm quét-từ-code thì liệt kê **đủ mọi động từ**, và tự hỏi "lưới này bỏ sót CHIỀU nào?", không chỉ "bỏ sót ROUTE nào". Cùng họ: chỉ soi đường ĐỌC mà không soi đường GHI (lỗ hổng phạm vi kho 06/09), chỉ soi FORM mà không soi UPLOAD (loại hàng mồ côi 07/09) — **hai cửa cùng một sổ mà khác luật** là mẫu tìm bug nhanh nhất.

**TỔNG HỢP NẶNG KHÔNG ĐƯỢC NẰM TRONG ĐƯỜNG REQUEST (chốt 21/08):** nút thắt dưới tải KHÔNG phải máy Postgres mà là **xếp hàng ở pool ~10 khe PostgREST** — đo 06-readload trên dữ liệu lớn: Dashboard p50 28,3s (query ấm chỉ 64ms). ⇒ (a) số liệu tổng hợp toàn công ty phải **CACHE** (`dashboard_all_cached`, TTL = cờ `dashboard_cache_seconds`); (b) **việc nền không được ké vào GET của người xem** — quét cảnh báo đã tách khỏi `GET /wms/alerts` sang `POST /wms/alerts/scan` (FE gọi sau khi trang đã hiện + định kỳ 10'; đo trước khi tách: mở trang chờ **1.940ms**). Đừng dùng `void fn()` fire-and-forget trên serverless — response trả xong lambda có thể bị đóng băng giữa việc.

**ĐO MỨC PHỤC VỤ — KHÔNG ĐƯỢC XOÁ DẤU VẾT:** trigger `trg_outbound_qty_reduced` ghi mọi lần `OutboundItem.cartons_ordered` giảm (phân loại giao thiếu / cắt kế hoạch) ⇒ tab "Dịch vụ" (RPC `service_level`) dựng lại nhu cầu gốc; dữ liệu trước 28/08 không có vết và màn hình phải nói thẳng. Thêm bảng/cột nhu cầu MỚI thì nghĩ lại chỗ dựng nhu cầu gốc. Chi tiết: [docs/rules/backend.md](docs/rules/backend.md).

**TypeScript:** không `as any`/`as any[]` — type rõ ràng. Axios error: `import type { AxiosError } from 'axios'`.
- **Nợ `as any` (đang dọn dần):** code cũ còn ~341 chỗ `as any`/`: any` (Stage A đã gỡ 66% an toàn: `(supabase.from(...) as any)` + `(req as any).user`→`req.user`, BE 588→138). **Code MỚI tuyệt đối không `as any`**; đuôi dài chỉ dọn **khi đụng vào từng file**, KHÔNG mass-rewrite (rủi ro churn, lợi ích 0-runtime). Gốc rễ: `backend/src/lib/supabase.ts` thiếu generic `Database` → cách triệt để là `supabase gen types typescript` + `createClient<Database>()` (mini-project, chưa làm). Chi tiết: memory `as-any-cleanup`.

**Frontend:**
- Lỗi API: banner đỏ inline trong component (không chỉ `console.error`).
- Bulk action **song song** `Promise.all(ids.map(...))` (không `for...of await`). Button gọi API: `disabled={saving}` + text chờ.
- Date input form tạo & sửa: `min={TODAY()}` (sửa vẫn pre-fill & lưu được giá trị cũ). **"Hôm nay" phải là HÀM, không phải hằng module** — PDA/màn kho mở qua đêm sẽ giữ ngày HÔM QUA (min chặn oan, chip "Hôm nay" lọc sai); ratchet `today_frozen_at_import` (baseline 0) gác, khai trong thân component vẫn OK.
- **Nhãn đơn vị tính lấy từ DANH MỤC**, không hardcode: `unitLabel()` đọc bảng nạp từ LookupValue `unit_of_measure` (Shell gọi `setUnitLabels` lúc khởi động) — thêm ĐVT mới trong Cài đặt là hiện đúng tiếng Việt, không ra mã thô.
- Filter state mọi list page → `useWmsFilterStore` (không `useState` thuần). **Nhớ filter theo từng user là TỰ ĐỘNG** qua `scopedPersist.ts` (key persist gắn `user.id`) — field mới chỉ cần khai trong slice + có default trong `initialFilters()`; KHÔNG tự gắn `localStorage`/`useState` cho filter (sẽ dùng chung giữa các user). QR: sau parse ngày kiểm `isNaN(date.getTime())`.
- **BỐI CẢNH Kho/Loại kho TOÀN CỤC ở Header (19/08, kiểu Infor):** nút `GlobalScopePicker` (option từ 2 hook scoped = tự validate quyền, có "Tất cả") → `useGlobalScopeStore` (`stores/globalScopeStore.ts`, localStorage per-user qua scopedPersist) + `sweepGlobalScope` quét giá trị vào MỌI slice filter có Kho/Loại kho (đúng tên field + ngữ nghĩa từng trang; đổi tay = force ghi cả rỗng, mở app/login = chỉ áp phần đang chọn). **Thêm slice filter mới có Kho/Loại kho → BẮT BUỘC thêm dòng vào `sweepGlobalScope`**; form tạo mới init Kho/Loại → đọc `useGlobalScopeStore.getState()` làm mặc định (mẫu: Inbound CreateOrderDialog, Packing OpenRunSheet). Trang giữ quyền chỉnh filter lẻ sau khi sweep.

---
## UI — Manhattan Active WMS

**MENU 3 CẤP** (`config/navigation.ts`: nhóm lớn → `NavSection` → trang; chỉ gom nhóm đủ đông; `canSeeNavItem`/`visibleEntries` dùng chung Sidebar + MobileNav). **BỀ MẶT ĐIỆN THOẠI do superadmin cấu hình** (`config/mobileSurface.ts`, cờ `SystemSetting.mobile_surface`, hook `useMobileSurface`/`useMobileTabs`, UI `MobileSurfaceSettings` — hình thức kiểu "Views" của AppSheet đã chốt, đừng quay lại bản cũ): **trang có tab MỚI → khai vào `PAGE_TABS` + gọi `useMobileTabs`** (trước mọi return sớm); **một tab chỉ một nút Lưu** (ratchet `settings_draft_not_in_dirty`); điểm chạm 44 px; bảng mới có cột nút đứng cuối thì ghim `sticky right-0`. Chi tiết: [docs/rules/ui.md](docs/rules/ui.md).


**MÀN MỚI PHẢI TRÔNG NHƯ APP CŨ (user 25/09, lớp C40 — skill `table-format` mục 22):** một cụm một nút chính `variant:'default'`, không tự chế màu · hộp thoại xác nhận = `useConfirmDialog` (cấm `window.confirm/alert/prompt`) · tab cạnh tiêu đề · bảng nghiệp vụ = `ResizableTable` · chân bảng = `ListFooter` · nút toolbar qua `ActionCluster` · trang nằm trong `navigation.ts` là tự có đường dẫn đầu trang (`navTrail`, bảng chép tay cũ bỏ sót 26/38 trang). Sàn điểm chạm 44 px (`.touch-target`) chỉ áp `pointer: coarse` — trước 25/09 nó đè `h-7` của mọi `<Button>` thô trên PC. Ratchet `native_browser_dialog` · `action_item_custom_fill` · `list_table_not_resizable` gác. Trước khi báo xong: **chụp màn mới cạnh một màn chuẩn cùng loại ở 1280 + 390**.

**Mọi list page / table / trang detail: theo skill `table-format`** (card trên canvas xám, toolbar + FilterBar + SavedViews + density, SummaryBand, kéo giãn cột, sticky header/cột đầu, typography 2 cỡ, màu row theo trạng thái, responsive PC/tablet/phone, detail section-band). Module mẫu: `Inbound.tsx` / `InboundDetail.tsx`.
**Quét QR: theo skill `qr-scan-flow`** (flow confirm/instant, camera keep-alive, auto-resume).

**Mọi form Thêm/Sửa: dùng `FormSheet`** (`components/shared/FormSheet.tsx`) — panel trượt từ **lề PHẢI**, cao full màn hình, chia 3 vùng **header cố định · thân cuộn · footer dính đáy** (nút Lưu/Huỷ luôn thấy trên cả PC & mobile; mobile full-width). KHÔNG dùng `Dialog` giữa màn cho form thêm/sửa (Dialog giữa chỉ để **xác nhận/thông báo nhỏ**: xóa, đặt mật khẩu, kết quả). Nút thao tác đặt ở prop `footer`. Mẫu: form trong `UserManagement.tsx`.
- **Dropdown trong form panel phải render qua PORTAL VÀO NODE DIALOG** (`usePopoverAnchor` → `anchor.target` + `anchor.style`), KHÔNG portal ra `document.body`. Vì Radix Sheet/Dialog (modal) dùng `react-remove-scroll` + `pointer-events:none` trên body + bẫy focus → menu portal ra body sẽ **không cuộn / không gõ tìm / khó bấm**. Các dropdown tự chế đã theo chuẩn: `SingleSelect`, `WarehouseSingleSelect`, `WarehouseMultiSelect`, `PlateCombobox`/`NppCombobox`. Radix `Select`/`Popover` portal sẵn nên OK. Dropdown chọn-1 trong form ưu tiên `SingleSelect` (có ô tìm), không dùng `<Select>` Radix thô.
- **FORM CẤU HÌNH XẾP THEO KHU VỰC — XUẤT liền nhau rồi mới tới NHẬP:** `SettingsGroup area="XUẤT" | "NHẬP"` (tự in tiền tố), bộ chung `OutboundStrategyFields`/`InboundStrategyFields`; thêm nhóm mới → đặt vào lưới của đúng khu. Ratchet `settings_area_interleaved` (C26). Chi tiết: [docs/rules/ui.md](docs/rules/ui.md).
- **THANH THAO TÁC CHỌN-NHIỀU KHÔNG ĐƯỢC CHIẾM CHỖ TRONG LUỒNG (user chốt 16/09: "tick multi là hiện action lên, table không được resize — action lên header hoặc ở giữa như Tồn kho"):** thứ chỉ hiện khi có dòng được tick mà chèn một hàng giữa band và bảng thì bảng co lại đúng lúc đang tick, dòng nhảy dưới con trỏ. **MỘT lối duy nhất (user chốt lại 29/09: "chọn multi hiện action phải đồng bộ — như Tồn kho, action ở giữa"): `FloatingActionBar`** (`components/shared/FloatingActionBar.tsx` — pill tối nổi giữa đáy, `bottom-16` chừa bottom-nav, nút bên trong dùng `FLOATING_BTN`/`FLOATING_BTN_DANGER` hoặc `ActionCluster className="w-auto shrink-0"` với className đó; "Bỏ chọn" là link nhỏ cuối pill). Lối "nút h-7 trên header" (22/07) ĐÃ BỎ — Xuất kho · DO SAP · Kế hoạch xuất · Quy định date · Luân phiên ABC · Cảnh báo · Nhập kho chi tiết · In tem lịch sử chuyển hết 29/09; Mã hàng · Vị trí bỏ pill tự vẽ (bottom-20) dùng component chung. Ratchet **`bulk_bar_inline_reflows_table`** (baseline 0, nay bắt cả nút đặt theo `.size > 0` ngoài pill) gác. Lớp C28.
- **Action của mỗi dòng list nên có cả trong pane detail** (khỏi kéo ngang bảng mới thấy cột action) — gate đúng quyền như nút trong bảng. Mẫu: pane detail nhân viên `UserManagement.tsx`.

- **Ô "THEO CHA" PHẢI IN GIÁ TRỊ ĐANG HIỆU LỰC (user chốt 29/09):** mọi ô/nhãn kế thừa từ bảng cha (khách ← kênh · Loại kho ← kho · ô ← Loại kho · kho ← mục tiêu chung) ghi rõ giá trị cha đang áp — `Theo kênh GT: FG01 ≥ 60 %` · placeholder `Theo kênh GT: 3` · `— Theo kho (FEFO) —` — không ghi trần "theo kênh" bắt người xem sang bảng cha tra. Giá trị lấy theo cha ĐANG CHỌN trong form (đổi kênh là câu đổi theo), không theo bản đã lưu. Nút hành động gỡ khai riêng đặt chữ "Về theo …". Ratchet `inherit_label_without_value` gác. Chi tiết: [docs/rules/ui.md](docs/rules/ui.md).
- **Màu thương hiệu:** accent điều hướng `sky-400/500`; CTA `blue-600`; OK `green-500`; cảnh báo `amber-500`; lỗi `red-500`. Canvas `bg-slate-100`, app bar/sidebar `bg-slate-900`.
- **MỘT symbol QUÉT toàn app = `ScanIcon`** (`components/shared/ScanIcon.tsx`, user chốt 21/08 "mỗi chỗ 1 icon là k đc"): mọi nút/tiêu đề/placeholder của **hành động quét** dùng icon này — trước đó 3 icon sống lẫn (`QrCode` 25 chỗ · `ScanLine` · `ScanBarcode`) nên cùng một việc mà mỗi màn nhìn một kiểu. Ranh giới: nói về **TEM QR** (trang In tem, cờ "không theo dõi QR") mới dùng `QrCode`; **chụp ảnh** dùng `Camera`. Ratchet `scan_icon_not_unified` (baseline 0) gác.
- **Quét TEM VỊ TRÍ ở mọi chỗ chọn vị trí** (21/08): nút `LocationScanButton` đứng CẠNH ô chọn tay — **chỉ THÊM, không đổi** dropdown/checkbox đang có (user chốt). Cửa tra duy nhất `GET /masterdata/locations/resolve` khớp **TRỌN mã** (đừng dùng `?search=` — quét tem `_5_T1` sẽ nhận `_5_T10`); chuẩn hoá mã quét ở `utils/locationScan.ts` (mirror BE↔FE). Súng PDA: `useWedgeScanner` có **khoá độc quyền** (2 hook cùng bật = 1 phát bắn chạy cả hai việc); `armWedge` CHỈ bật ở trạng thái mà cò súng vốn đang tắt. Màn mới dùng hook vị trí mà thiếu nút quét ⇒ ratchet `location_picker_without_scan` đỏ. In tem vị trí: `locationLabel.tsx` (8 tem/A4, QR mã hoá NGUYÊN VĂN `location_code`), quyền `locations.print_label`.
- **Responsive bắt buộc** — đẹp ở PC + Tablet + Phone (≤360px không tràn); test cả 3 trước khi push.
- **DIỄN GIẢI = `InfoTip` ⓘ** (dưới `sm` là tấm trượt đáy): băng cảnh báo chỉ mang CON SỐ + việc phải làm, phần giải thích vào ⓘ; `tip` dạng hàm `close => …` khi bên trong có nút điều hướng. Chi tiết: [docs/rules/ui.md](docs/rules/ui.md).
- **DÒNG "TRỐNG" TRONG BẢNG RỘNG = `TableEmptyRow`** (câu căn giữa `colSpan` sẽ nằm ngoài màn 360 px; ratchet `empty_row_centered_in_wide_td`). **Badge/số đếm TOÀN KHO phải lấy từ truy vấn toàn kho**, không từ board đang xem (C34). Chi tiết: [docs/rules/ui.md](docs/rules/ui.md).
- **PHẦN CO ĐƯỢC ĐỨNG CẠNH PHẦN KHÔNG CO = CHỮ BỊ BẺ DỌC (16/09):** `ListFooter` để phần ĐẾM `min-w-0` còn ghi chú phụ (`right`) `shrink-0` ⇒ ở 360 px một câu dài (Tối ưu vị trí: "xếp hạng theo lượt nhặt 30 ngày…") bóp phần đếm còn ~20 px và bẻ **"1–132 / 132 mã" thành NĂM dòng dọc**, chân trang cao 111 px. Cùng họ `shrinking_flex_row_of_nowrap_chips` nhưng nạn nhân là CHỮ nên ratchet cũ không bắt. Đã sửa ở component dùng chung (mọi list page hưởng): phần đếm `whitespace-nowrap` (không co), ghi chú `flex-1 truncate` rồi tự xuống dòng nhờ `flex-wrap`. Khuôn: trong một hàng flex, **hỏi phần nào được phép co** — không được để thứ PHỤ giữ chỗ còn thứ CHÍNH co lại.
- **HÀNG NÚT KHÔNG CO ĐƯỢC THÌ PHẢI WRAP HOẶC CUỘN** (`flex-wrap` · `overflow-x-auto` · `grid-cols-*` · `sm:flex`) — không thì nút cuối trôi ra ngoài màn/nằm dưới phần tử khác mà không lỗi nào nổ; ratchet `shrinking_flex_row_of_nowrap_chips` + `tablist_center_blocks_scroll`. **Hỏi "ở 360 px hàng này rộng bao nhiêu?"**, đừng tin mắt nhìn ở 1280. Chi tiết: [docs/rules/ui.md](docs/rules/ui.md).
- **CUỘN ĐƯỢC MÀ KHÔNG AI BIẾT THÌ CŨNG NHƯ KHÔNG (chốt 12/09):** `TabsList` tràn khung nay (a) tự kéo **tab ĐANG CHỌN** vào tầm nhìn và (b) **mờ dần mép** nào còn nội dung khuất. Vì sao: Xe nâng 6 tab, ở 360 px chỉ thấy 2 tab rưỡi, 4 tab còn lại nằm ngoài màn **không một dấu hiệu nào** — và mở lại trang khi tab thứ 6 đang active thì dải vẫn hiện tab 1, người dùng tưởng mình đang đứng ở đó. Khác ca "Sắp quét" ở chỗ nó KHÔNG bị đè, chỉ là vô hình. Cả hai việc chỉ chạm `scrollLeft` của chính dải tab (không `scrollIntoView` — hàm đó kéo cả trang); không tràn thì không mờ gì, đừng làm nhoè tab cuối của trang chỉ có 2–3 tab.
- **`ActionCluster` mặc định `w-full` trên mobile — ĐÚNG cho header trang detail, SAI ở thanh tiêu đề khối:** ở thanh tiêu đề khối (section-band) nó nuốt trọn bề ngang, ép tiêu đề còn ~60 px và bẻ thành 5 dòng (đo 360 px: "DANH MỤC XE NÂNG (21)" ở tab Cài đặt Xe nâng). Cụm đứng CẠNH một tiêu đề thì truyền `className="w-auto shrink-0"` (tiêu đề giữ `flex-1 min-w-0`), hoặc `mobileInline` nếu là toolbar list page.
- **Thứ tự rollout còn lại:** Outbound (hoàn thiện) → Inventory → Nhặt lẻ → ScanLog → Deliveries → Đăng ký cổng → Materials → TMS Bookings/Report/Settings → Locations → Stocktake → HR.

---
## Tech Stack
- **Frontend:** React 18 + TS + Vite · Tailwind v3 + shadcn/ui · React Router v6 · TanStack Query · **quét QR = `BarcodeDetector` của trình duyệt, trượt thì rơi về `zxing-wasm`** (KHÔNG còn `html5-qrcode`/`qr-scanner` — gỡ 16/09 vì đã thay từ đợt 11/08 mà 2 gói vẫn nằm trong `package.json`) · `qrcode` chỉ để SINH tem · date-fns · Lucide. Supabase Realtime (`frontend/src/lib/supabase.ts`, anon key).
- **Backend:** Node + Express + TS · `@supabase/supabase-js` service role (`backend/src/lib/supabase.ts`). JWT auth **đã implement** (`authController.ts`: bcrypt + `jwt.sign`; route bảo vệ bằng `requirePerm`/`requireAnyPerm`).
- **Infra:** Supabase (PostgreSQL + Realtime) ×2: staging `bxxryrmpfabvjitqbdnw` (branch `dev` → Vercel Preview) + production LOF `svicyfquresxaigfxsdb` (branch `main` → Vercel Production) · backend serverless qua `api/index.ts`.

**API format:**
```json
{ "success": true, "data": {} }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

**Bối cảnh:** App dùng giữa Kho tổng và Kho NPP. Kho nhận có trong danh sách NPP → có inbound tại kho nhận, dùng nhập hàng / tồn kho bình thường.

---
## Đa đơn vị (multi-tenant SILO) — ĐANG XÂY cho 2 đơn vị, khác nhau ở ĐỊNH DẠNG QR PALLET

**1 codebase phục vụ NHIỀU đơn vị độc lập** — mỗi đơn vị 1 Supabase + 1 Vercel + 1 link riêng (cách ly dữ liệu tuyệt đối). **TUYỆT ĐỐI KHÔNG `if (tenant === 'X')`, không fork/copy project.** Khác biệt giữa đơn vị xử bằng **cờ theo KHÁC BIỆT** (không theo tên đơn vị) trong bảng `SystemSetting` (key-value jsonb, per-DB). Kiến trúc + thang xử lý khác biệt 5 bậc: memory `multi-tenant-silo-architecture`. Khác biệt ĐÃ CÓ THẬT hiện nay = **định dạng tem/QR pallet** (memory `qr-format-v2-semicolon`).

**2 định dạng QR sống chung VÔ THỜI HẠN** (tồn cũ toàn V1; đơn vị mỗi bên 1 format cố định):

| | **V1 — Đơn vị 1 (LOF), delimiter `_`** | **V2 — Đơn vị 2, delimiter `;`** |
|---|---|---|
| Ví dụ | `070526_510000127_C05_M1_001_B` | `50033;      1;TA260705A018;05/07/2026;05/03/2027;      1;05:26` |
| Cấu trúc | `ddmmyy_MãHàng_ChuKỳ_<Máy\|MãNCC>_STT_NMSX` | `MãHàng;QA;MãLô;NSX;HSD;Mẻ;Giờ:Phút` (7 đoạn, **có đệm SPACE → phải trim**) |
| Đoạn ý nghĩa | 1=ngày SX ddmmyy · 2=mã hàng · 3=chu kỳ · **4=Máy (thành phẩm) HOẶC mã NCC (hàng NCC: POSM/Raw/Thùng/Giấy)** · 5=STT pallet · 6=NMSX (hàng NCC: nơi nhận đầu) | 1=mã hàng · **2=QA (1=OK, 0/khác=X)** · **3=Mã lô** (`2 ký tự tắt hàng`+`yymmdd`+`Máy 1 ký tự`+`SEQ 3 số`, vd TA+260705+A+018) · 4=NSX dd/mm/yyyy · 5=HSD dd/mm/yyyy · 6+7=giờ:phút:giây SX |
| HSD / %Date | suy từ NSX + shelf-life (mã/NCC) | **HSD tường minh trên tem** → %Date dùng thẳng HSD (không cần khai shelf-life mã) |
| Mã lô (batch) | không có (cột `batch`=null) | **= khóa liên kết KẾ TOÁN/ERP** (kế toán chỉ giữ mã lô `TA260705A018`); khớp qua import/API sau khi có kết nối |
| NCC | đoạn 4 (hàng NCC) → tự resolve khi quét | tem KHÔNG mang NCC → chọn tay nếu cần |

**PARSE PHẢI TẬP TRUNG — KHÔNG tự `split('_')`/`split(';')` rải rác (nếu không, sửa 1 chỗ sẽ đè/lệch chỗ khác):**
- **BE:** `backend/src/utils/qrParser.ts` — `parseInboundQR(raw)` tự nhận nhánh theo delimiter, trả `ParsedQR` (có `format:'v1'|'v2'`, `qa_ok`, `batch`, `expiry_date`, `machine_code`, `pallet_sequence_no`…) + `normalizeQR(raw)` = **CHỈ trim NGOÀI, GIỮ đệm space bên trong** (pallet_code lưu ĐÚNG như QR quét ra — user chốt "QR quét sao lưu vậy"; trim từng đoạn CHỈ khi bóc tách field trong `parseV2`, KHÔNG khi lưu/khớp). MỌI điểm quét gọi `normalizeQR` trước khi khớp `pallet_code`: inbound scan, outbound scan (`checkScanItem`/`scanItem`), inventory `stocktakeCheck`, pallet-ops `merge`/`ungroup`/`split`.
- **FE:** `frontend/src/utils/qr.ts` — `normalizeQR` / `materialCodeOf(code)` (V2=đoạn 0, V1=đoạn 1) / `isValidDMY`; `frontend/src/components/shared/palletLabel.tsx` — `parseCodeFields(code)` (bóc trường hiển thị 2 format, QR luôn mã hóa NGUYÊN VĂN `pallet_code` nên scan không phụ thuộc). `InboundScanSheet` validate cả 2; `PalletLabels` (entryToLabel/logRowToLabel/auditSummary) + render tem V2 (Mã lô + HSD, đáy 2 ô Máy/Số pallet).
- **%Date TẬP TRUNG:** `computePctDate(entry, material, now)` ở `shelfLife.ts` (BE + FE KHỚP NHAU) — ưu tiên `expiry_date` tường minh (mẫu số HSD−NSX) → fallback NSX+shelflife (V1 kết quả không đổi). Áp mọi nơi tính %Date (inventory list/facets/summary, outbound check/scan/prepare, FE Inventory/PalletDetailDialog/StocktakeDashboard). **Sửa công thức %Date = sửa 1 hàm này**, đừng viết lại rời.

**Cờ & hạ tầng:**
- Cột: `InventoryEntry.batch` (mã lô V2, null với V1) + `InventoryEntry.expiry_date` (HSD V2) — migration `20260707_systemsetting_qr_v2.sql`.
- Bảng `SystemSetting` + cờ `label_format` (`'underscore'`/`'semicolon'`) điều khiển chiều IN tem **và** gate chiều QUÉT inbound (quét nhầm format ⇒ 422 `QR_FORMAT_MISMATCH`); sổ cờ `KNOWN_SETTINGS` (`systemSettingController.ts`), route `GET/PUT /wms/settings/:key`, tab Hệ thống ở Cài đặt WMS; sinh tem V2 đủ 7 đoạn giữ format nhà máy (`buildQRv2`/`buildBatchV2`). Chi tiết: [docs/rules/multi-tenant-qr.md](docs/rules/multi-tenant-qr.md).
- **Luật vàng chống đè:** mọi thay đổi liên quan format QR phải đi qua các helper tập trung trên (BE↔FE giữ KHỚP NHAU); thêm điểm quét mới → BẮT BUỘC `normalizeQR`; thêm cờ khác biệt mới → thêm vào `KNOWN_SETTINGS` (sổ cờ) + default = hành vi V1 cũ (đơn vị 1 không đổi).

**ĐỊNH HƯỚNG QR-tới-THÙNG (chốt 07/07, CHƯA build):** tồn vẫn theo pallet, tem thùng chỉ để quét-đếm; STT thùng = đoạn `;` thứ 8; đuôi tách pallet `.N` đặt ở đuôi MÃ LÔ. ⚠️ Nợ: `splitPallet` V2 đang gắn `.N` cuối chuỗi. Chi tiết: [docs/rules/multi-tenant-qr.md](docs/rules/multi-tenant-qr.md) + memory `qr-format-v2-semicolon`.

---
## Phân quyền (RBAC) — chi tiết skill `add-permission`

**Kiến trúc:**
- Quyền lưu trên **`JobTitle.module_permissions`** (KHÔNG phải Employee). Resolve khi login/`/me` (`authController`): superadmin → `ALL_PERMISSIONS`; còn lại → quyền của chức danh. Cột `Employee.module_permissions` không dùng (dead).
- **Hiệu lực khi ĐỔI quyền:** quyền nằm trong JWT 24 giờ; `/me` re-resolve + trả token mới, FE refresh định kỳ 5 phút ⇒ cấp/gỡ quyền có hiệu lực ≤ 5 phút. Login khớp `email`. **Chống dò mật khẩu** ở DB (RPC `auth_throttle`: 10 sai/15' theo tài khoản, 30 theo IP ⇒ 429), mở khoá trong app (`user_admin.unlock`). **Chính sách mật khẩu MỘT nguồn** `utils/passwordPolicy.ts` (BE + mirror FE; ratchet `password_rule_hand_rolled`). **Trang đăng nhập KHÔNG có nút hiện mật khẩu** — đừng thêm lại. `npm i` thư viện mới qua ratchet `npm audit` (gói 44); checklist bảo mật: skill `security-hardening`. Chi tiết: [docs/rules/rbac.md](docs/rules/rbac.md).
- **Hở đọc có chủ đích (chưa siết)**: `GET /inventory*`, `GET /inbound-orders*`, `/lookup`, `/zones`, `/tms/transport-companies`, `/tms/vehicles` (2 route TMS bỏ gate 10/07 — danh mục NCC/ĐVVT + biển số đọc chéo khắp WMS, gate TMS làm vai kho thuần 403 âm thầm: panel Sửa NCC rỗng) KHÔNG gate `view` ở BE (Header omni-search + nhiều trang cross-module cần) — user đăng nhập nào cũng đọc được, nhưng dữ liệu **vẫn bị cắt theo scope kho** trong controller. Muốn siết phải liệt kê đủ consumers rồi `requireAnyPerm`.
- **VAI TRÒ đọc theo CỜ DANH MỤC, không so TÊN tiếng Việt:** `JobTitle.is_driver` · `Department.is_carrier` · `JobTitle.is_forklift_driver` — cờ là nguồn DUY NHẤT cho CẢ ô chọn LẪN cửa ghi (lọc ở ô chọn là gợi ý, gác ở BE mới là luật); ratchet `role_by_vietnamese_name`. Thêm cờ vai trò là đổi điều kiện của FIXTURE QA. Ca làm việc gom ở `config/shifts.ts`. Chi tiết: [docs/rules/rbac.md](docs/rules/rbac.md).
- **Superadmin = CỘT `Employee.is_superadmin`** (từ 13/08, migration `20260813f` — hết so tên 'Admin'): authController nhét cờ vào JWT + user object; BE kiểm `req.user?.is_superadmin === true`, FE `isAdmin(user)` đọc cờ. Bỏ qua mọi `requirePerm`. **KHÔNG so tên/mã 'Admin' để quyết quyền** — ratchet `superadmin_by_name` (baseline 0) chặn tái sinh; guard duy nhất còn so tên = chặn ĐẶT TÊN tài khoản mới 'Admin' (employeeController, chống giả mạo).
- **Định nghĩa quyền** ở 2 file PHẢI khớp: FE `frontend/src/config/permissions.ts` (`MODULES` — có label/actions, hiển thị trong trình phân quyền) · BE `backend/src/config/permissions.ts` (`ALL_PERMISSIONS` — thiếu → **superadmin mất quyền** đó). Helper FE: `can(perms, module, action)` / `canAccess` / `isAdmin`. BE: `requirePerm` / `requireAnyPerm`.
- **Scope dữ liệu nhân sự** (`employeeController.visibleEmployeeIds`): non-admin chỉ thấy (kho được gán nếu `warehouse_scope==='ASSIGNED'`) ∩ (cấp dưới theo **`JobTitle.parent_id`** đệ quy + chính mình). Sơ đồ ở JobTitle, KHÔNG ở `Employee.manager_id`.
- **Scope Kho + Loại hàng — "phân quyền Kho + Loại kho nào thì CHỈ thấy dữ liệu của Kho + Loại đó":** FE lấy option qua `useScopedWhTypes()` / `useScopedWarehouses()` (`hooks/useUserScope.ts`); BE guard ghi (403) + cắt LIST bằng `utils/categoryScope.ts`, mọi cắt đều null-inclusive; pallet-ops guard theo kho THẬT của entry. **IDOR theo CẶP id:** route có 2 id phải ràng id con THUỘC id cha (mẫu `itemOfGdo`); DO SAP cắt theo `Warehouse.sap_plant`. Thêm form/filter/list mới có Kho/Loại → 2 hook scoped + guard/cắt BE. Chi tiết (danh sách từng chỗ đã cắt): [docs/rules/rbac.md](docs/rules/rbac.md).
- **MỘT BẢN GHI CÓ THỂ MANG NHIỀU LOẠI — "giao ≥1 loại là THẤY":** `GroupDeliveryOrder.warehouse_type` lưu chuỗi ghép `'FG01+PM01'` ⇒ tách rồi lấy GIAO ≥1 (TS `splitCategories`/`categoryAllowed`, SQL `wt_cats(x) && mảng`, KHÔNG `= ANY`) cho cả đọc lẫn ghi; facet trả từng loại. Ratchet `gdo_category_exact_match`. Chi tiết: [docs/rules/rbac.md](docs/rules/rbac.md).
- **CỬA ĐẶT LỊCH `booking_category` — tách khỏi luật giao ≥1:** `warehouse_type` (chuỗi ghép) = quyền + lọc; `booking_category` (giá trị ĐƠN, khai ở Kế hoạch xuất) = CHỈ khớp khung giờ + gác đặt lịch. **1 Số xe = 1 cửa**, khoá 4 tầng (trigger DB · upload từ chối cả file · CRUD ép theo xe · 422 `BOOKING_CATEGORY_MISMATCH` ở BE); đồng bộ cấp-xe ghi CẢ XE trong MỘT câu và TRƯỚC câu sửa dòng lẻ. Chi tiết: [docs/rules/rbac.md](docs/rules/rbac.md).
- **Bảo vệ Admin**: chỉ superadmin sửa hồ sơ/đặt-MK/xóa/đổi-kho tài khoản Admin (`blockIfTargetSuperadmin`, `isSuperadmin`). Sửa **hồ sơ** nhân viên = superadmin; non-admin chỉ chỉnh **Kỹ năng/Vị trí**. **Chống leo thang**: non-admin không cấp cho chức danh quyền vượt quyền mình (`escalationError`).
- **Sửa chức danh / phòng ban**: tên / phân quyền / cấu trúc (`createJobTitle`/`updateJobTitle`/`setJobTitleParent`/`create|updateDepartment`) = **chỉ superadmin**. Non-admin chỉ sửa **Danh mục Vị trí/Skill** của chức danh **CẤP DƯỚI mình** — `skillController` scope create/update/delete skill theo `JobTitle.parent_id` (cấp dưới của job_title người gọi, qua `writableJobTitleIds`); FE `JobTitleFormDialog` chỉ hiện phần Vị trí/Skill cho non-admin + ẩn nút Sửa nếu không phải chức danh cấp dưới.

**GIAO THOA GIỮA CÁC MODULE — luật chung, đọc TRƯỚC khi sửa bất kỳ module nào nằm trên các dòng chảy này** (chi tiết mỗi module ở `docs/modules/<key>.md`, mục "Giao thoa với" liệt kê hai chiều):
- **Dòng SAP → xe:** ZSD02/VL06O (`external_do_sap`) → Điều vận (`dispatch`) → Kế hoạch xuất (`external_khvc`) → chuyến Xuất kho (`outbound`) + lệnh VC (`tms_plan`) → khung giờ · cổng · cân (`tms_slots` · `gate_registration` · `weigh_station`) → cước (`freight`). Xuất là KẾT QUẢ DẪN XUẤT: muốn sửa thì sửa ở nguồn trước; OD bị SAP đổi / thay / huỷ phải hiện cờ ở MỌI màn đang cầm OD đó. **03/10 tối (user chốt): NGUỒN SỰ THẬT về điều vận = lịch sử của app + dấu tay của người; cờ SAP (Mat Doc · gắn xe) chỉ THAM CHIẾU, không tự loại đơn.** **05/10 (user chốt): NGÀY GIAO ZSD02 không đáng tin — KHÔNG quyết đơn vào / ra bàn, không cờ / luật / "trễ n ngày" theo nó; mọi đơn chưa đi nằm tab Điều, NGƯỜI chọn; Đã điều của ngày D = Kế hoạch xuất có ngày xuất D.** Rào cứng DB `trg_khvc_one_export_day` + `trg_dispatch_od_one_open_vehicle` (một DO hoặc HỌ HÀNG qua `od_lineage` chỉ ở MỘT ngày xuất / MỘT xe đang mở — ba cửa ghi Kế hoạch xuất đều qua); ZSD02 đổ theo NGÀY TẠO nên app chỉ kết luận "SAP xoá / thay" cho DO có ngày tạo TRONG khoảng phủ người khai khi nạp, và công tắc `zsd02_coverage_mode` (mặc định REQUIRE) bắt file phải phủ ngày tạo của mọi đơn CHƯA ĐI; kho không Bắt đầu / quét / Hoàn thành chuyến có đơn SAP đã bỏ / thay hoặc còn việc Cần xử lý (`sapIssueError`, 409 `SAP_ISSUE_OPEN`). Chi tiết: `docs/plans/DISPATCH_OD_LIFECYCLE_2026-10-03.md`.
- **%Date:** mức chốt (Quy định date · `customers` · `outbound.set_date`) thuộc về DÒNG ĐƠN; MỌI cửa chỉ đường (Việc cần làm · Tối ưu tuyến · Fill) VÀ mọi cửa trừ tồn (quét xuất · nhặt lẻ · Xuất luôn) đọc cùng một luật (`palletMeetsDateRule` / `dateRuleBelowError`). Vá luật ở một cửa thì hỏi ngay "cửa kia đã đọc luật này chưa?" (C19).
- **Hạ hàng xuống ô nhặt lẻ:** Fill (`fill`) ⇄ Việc cần làm (`directed_work`, việc `LOOSE_FEED`) ⇄ Nhặt lẻ (`loosepicking`) — mỗi phép trừ "đã có người lo" phải đếm CẢ hai nguồn và theo NGÀY; thêm đường thứ ba thì vào cả hai phép trừ.
- **Tồn kho (`inventory`)** là đích ghi của nhập · xuất · nhặt lẻ · kiểm kê · dồn/tách · slotting · fill: base unit + ghi nguyên tử (CAS / RPC row-lock) ở MỌI cửa. Mọi cửa đổi `location_id` gọi `logPalletMoves` (ratchet `move_without_ledger`); nguồn mới của sổ pallet = thêm nhánh vào RPC `pallet_ledger`, không dựng sổ mới.
- **Bản vẽ kho (`warehouse_map`)** nuôi cửa xuất có sức chứa (`outbound` RULE 3) và BFS đường đi (`directed_work`, `loosepicking`); khoảng cách không lưu, luôn tính từ bản vẽ (`utils/warehouseGrid.ts`).
- **Loại kho (`wms_settings`)** quyết phạm vi quyền, điều kiện bảo quản (→ `dispatch`, `tms_vehicle_types`) và chiến thuật 2 tầng Kho + Loại kho; đổi tên loại phải qua cascade `rename_warehouse_type` (mọi cột mang giá trị loại).
- **Khách hàng (`customers`)** nuôi %Date tự động (`outbound`), luật chuyển kho (`tms_plan`, `Customer.warehouse_id`) và dòng xe được vào / đi xe riêng / số khách tối đa cùng xe (`dispatch`; **29/09: KHÔNG còn kiểu đi Pallet/Xá** — họ xe = đúng danh sách dòng xe, "xe pallet một khách" = `vehicle_model.max_drops`). Kênh quyết %Date bên kho — bàn điều vận KHÔNG đổi kênh. **Kho WMS = plant (user chốt 28/09): kho đích của ship-to = CHỈ `Customer.warehouse_id`** (`services/transferDest` — không dò mã kho, không dò tên; dò tên chỉ là gợi ý theo cấu hình kho xuất NONE/WARN/BLOCK); ship-to trùng mã kho tự nối; xuất xong mới trỏ kho ⇒ nút "Đẩy lại cho kho nhận", không nối tự động. **Không tự ép gì — mọi thứ là cấu hình** (đi xe riêng, số khách/xe, nhắc/chặn).
- **Dòng xe (`tms_vehicle_types`) — MỘT bản Chung, cấu hình RIÊNG theo kho (03/10):** master data (mã SAP · tên · cha · ĐK bảo quản · thước đo · cách tính cước) chỉ ở `vehicle_model`; kho chỉ chỉnh dùng/không + sức chứa + điểm giao ở `warehouse_vehicle_model` (bản chụp, không kế thừa). **Mọi cửa đọc dòng xe "của một kho" (điều vận · cước ước tính · cột Tải Xuất kho · danh sách ở tab Mã dòng xe · bàn ghép xe) đi qua `services/vehicleModelScope.ts`**, không tự join. Sức chứa = MỘT thước đo (PALLET chỉ pallet, TON chỉ tấn); ngưỡng Non tải không còn ở dòng xe (dải tải theo cha của kho → ngưỡng kho → 70).
- **Mẫu lỗi giao thoa hay gặp nhất: HAI CỬA CÙNG MỘT SỔ MÀ KHÁC LUẬT** (form ↔ upload ↔ API ↔ máy tự làm, đọc ↔ ghi). Đổi luật ở một cửa thì rà mọi cửa ghi/đọc cùng bảng — `docs/modules` chỉ là bản đồ, lưới thật vẫn là gói QA + ratchet.

**Bản đồ module → trang (để biết nút nào dùng quyền nào):**

> **Chi tiết từng module (luật · lý do · số đo · gói QA) nằm ở `docs/modules/<key>.md`** — tách 28/09/2026, nguyên văn. Sửa module nào: đọc file của module đó **và mọi file trong mục "Giao thoa với"** của nó (bản đồ dựng hai chiều, `node scripts/docs/check-modules.mjs` kiểm). Thêm module mới: thêm dòng bảng này + file module + nối "Giao thoa với" hai phía.

| Module key | Nhãn (bảng quyền) | Trang / Menu | Actions (theo `ALL_PERMISSIONS`) | Chi tiết |
|---|---|---|---|---|
| `inventory` | Tồn kho | Tồn kho (+ Sổ pallet) | view, adjust, move_location, recode, qa_update, update_ncc, update_prod_date, export, import | [docs/modules/inventory.md](docs/modules/inventory.md) |
| `inbound` | Nhập kho | Nhập kho | view, create, edit, scan, edit_pallet, force_edit_pallet, delete_pallet, force_delete_pallet, cancel, complete, uncomplete, putaway_override | [docs/modules/inbound.md](docs/modules/inbound.md) |
| `outbound` | Xuất kho | Xuất kho · Chốt %Date · Quy định date (4 rule Bắt đầu chuyến, dẫn xuất từ SAP) | view, prepare, create, quick_export, import, edit, assign, unassign, start, unstart, scan, complete, uncomplete, cancel, reconcile, weigh_waive, gate_waive, rotation_override, set_date, push_transfer | [docs/modules/outbound.md](docs/modules/outbound.md) |
| `scanlog` | Lịch sử quét | Lịch sử quét | view, export | [docs/modules/scanlog.md](docs/modules/scanlog.md) |
| `traceability` | Truy xuất lô | Truy xuất lô (menu Báo cáo) | view, export, investigate | [docs/modules/traceability.md](docs/modules/traceability.md) |
| `loosepicking` | Nhặt lẻ | Nhặt lẻ (+ Tối ưu tuyến) | view, scan, complete, recalc | [docs/modules/loosepicking.md](docs/modules/loosepicking.md) |
| `stocktake` | Kiểm kho | Kiểm kho (4 tab, Luân phiên ABC) | view, scan, complete, export | [docs/modules/stocktake.md](docs/modules/stocktake.md) |
| `locations` | Vị trí kho | Vị trí kho (+ tab Sơ đồ kho) | view, create, edit, delete, import, export, print_label | [docs/modules/locations.md](docs/modules/locations.md) |
| `materials` | Mã hàng | Mã hàng (+ Nhà sản xuất) | view, create, edit, import, delete | [docs/modules/materials.md](docs/modules/materials.md) |
| `customers` | Khách hàng | Khách hàng (menu Cấu hình) — kênh · mức date · toạ độ điểm giao | view, edit, import, manage_channel, create_channel, locate, geocode | [docs/modules/customers.md](docs/modules/customers.md) |
| `external_do_sap` | Dữ liệu bên ngoài → DO SAP | Dữ liệu bên ngoài → DO SAP · Chưa có OD (ZSD02 / VL06O) | view, create, edit, delete, export | [docs/modules/external_do_sap.md](docs/modules/external_do_sap.md) |
| `pallet_print` | In tem pallet | In tem pallet | view, generate, reprint, history, audit | [docs/modules/pallet_print.md](docs/modules/pallet_print.md) |
| `pallet_ops` | Dồn / Tách pallet | Dồn / Tách pallet | view, merge, ungroup, split | [docs/modules/pallet_ops.md](docs/modules/pallet_ops.md) |
| `wms_settings` | Cài đặt WMS | Cài đặt WMS (kho, loại kho, ĐK bảo quản, khu, ca, QA, máy, hệ thống) | view, manage_warehouse, manage_type, manage_unit, manage_zone, manage_shift, manage_qa, manage_machine, manage_system | [docs/modules/wms_settings.md](docs/modules/wms_settings.md) |
| `employees` | Sơ đồ tổ chức (xem) | Sơ đồ tổ chức | view | [docs/modules/employees.md](docs/modules/employees.md) |
| `user_admin` | Quản lý người dùng | Quản lý người dùng (+ Nhật ký) | view, create, edit, set_password, unlock, delete, manage_roles, audit_log | [docs/modules/user_admin.md](docs/modules/user_admin.md) |
| `work_skill` | Vị trí & Skill | trong Quản lý người dùng | view, create, edit, delete, assign | [docs/modules/work_skill.md](docs/modules/work_skill.md) |
| `schedule` | Lịch làm việc | Lịch làm việc | _(không có trong config)_ | [docs/modules/schedule.md](docs/modules/schedule.md) |
| `work_assignment` | Phân công lịch làm việc | Phân công (Layout · Quy tắc ca) | view, create, edit, publish, delete, manage_layout, manage_shift_rules | [docs/modules/work_assignment.md](docs/modules/work_assignment.md) |
| `attendance` | Chấm công | Chấm công | view, self_log, edit, report | [docs/modules/attendance.md](docs/modules/attendance.md) |
| `leave` | Nghỉ phép | Chấm công → tab Nghỉ phép | view, request, approve, delete, export | [docs/modules/leave.md](docs/modules/leave.md) |
| `tms_plan` | Vận chuyển: Đặt lịch & Chuyển kho | TMS Bookings (Đặt lịch · Chuyển kho) | view, create, edit, delete, add_vehicle, release, change_date, book, revoke, upload_outbound, upload_inbound, confirm_receipt, export | [docs/modules/tms_plan.md](docs/modules/tms_plan.md) |
| `tms_vehicle_types` | TMS — Loại xe | Cài đặt TMS — Loại xe + Mã dòng xe | view, create, edit, delete | [docs/modules/tms_vehicle_types.md](docs/modules/tms_vehicle_types.md) |
| `freight` | Cước vận chuyển | Cước vận chuyển (menu TMS) | view, manage, export | [docs/modules/freight.md](docs/modules/freight.md) |
| `dispatch` | Điều vận | Điều vận (menu TMS) | view, plan, confirm, export, customer_vehicles | [docs/modules/dispatch.md](docs/modules/dispatch.md) |
| `tms_slots` | TMS — Khung giờ | Cài đặt TMS — Khung giờ | view, create, edit, delete | [docs/modules/tms_slots.md](docs/modules/tms_slots.md) |
| `tms_companies` | TMS — ĐVVT / NCC | Cài đặt TMS — ĐVVT / NCC | view, create, edit, delete | [docs/modules/tms_companies.md](docs/modules/tms_companies.md) |
| `tms_vehicles` | TMS — Xe | Cài đặt TMS — Xe | view, create, edit, delete | [docs/modules/tms_vehicles.md](docs/modules/tms_vehicles.md) |
| `gate_registration` | Đăng ký cổng | Đăng ký cổng | view, create, edit, delete, call, entry, exit | [docs/modules/gate_registration.md](docs/modules/gate_registration.md) |
| `weigh_station` | Phiếu cân (trạm cân) | Phiếu cân | view, match | [docs/modules/weigh_station.md](docs/modules/weigh_station.md) |
| `dashboard` | Dashboard (Tổng quan) | Tổng quan (+ tab KPI, Dịch vụ) | view, kpi_target, kpi_note | [docs/modules/dashboard.md](docs/modules/dashboard.md) |
| `warehouse_cost` | Chi phí kho | Chi phí kho | view, edit, lock, manage_item | [docs/modules/warehouse_cost.md](docs/modules/warehouse_cost.md) |
| `control_tower` | Giám sát vận hành | Giám sát vận hành | view | [docs/modules/control_tower.md](docs/modules/control_tower.md) |
| `alerts` | Cảnh báo vận hành | Thông báo + nút chuông | view, ack | [docs/modules/alerts.md](docs/modules/alerts.md) |
| `slotting` | Tối ưu vị trí (Slotting) | Tối ưu vị trí | view, plan, delete, complete, cancel, reopen, configure | [docs/modules/slotting.md](docs/modules/slotting.md) |
| `warehouse_map` | Sơ đồ kho | Sơ đồ kho (tab của Vị trí kho) | view, edit | [docs/modules/warehouse_map.md](docs/modules/warehouse_map.md) |
| `directed_work` | Việc cần làm | Việc cần làm (+ Hộp việc) | view, confirm, replan | [docs/modules/directed_work.md](docs/modules/directed_work.md) |
| `fill` | Fill hàng (nhặt lẻ) | Fill hàng | view, plan, cancel, change_dest, assign, execute | [docs/modules/fill.md](docs/modules/fill.md) |
| `forklift` | Xe nâng | Xe nâng (check list) | view, check, delete_check, manage_vehicle, manage_item | [docs/modules/forklift.md](docs/modules/forklift.md) |
| `packing` | Sổ đóng gói | Sổ đóng gói | view, record, open_run, edit, cancel, export | [docs/modules/packing.md](docs/modules/packing.md) |
| `inbound_plan` | Kế hoạch nhập chuyển kho | trong TMS Bookings (tab Kế hoạch) | view, edit | [docs/modules/inbound_plan.md](docs/modules/inbound_plan.md) |
| `external_khvc` | Dữ liệu bên ngoài → Kế hoạch xuất | Dữ liệu bên ngoài → Kế hoạch xuất | view, create, edit, delete | [docs/modules/external_khvc.md](docs/modules/external_khvc.md) |

> **Cross-module**:
> - Nút "Quét/Hoàn thành" + thao tác dòng NSX kho QTY_DATE (lưu số/xóa số đã lưu/hủy dòng — route `scan-manual`, `entries` DELETE, `cancel`) trong tab **Chuyển kho** gọi API Inbound nhưng được điều khiển bằng `tms_plan.confirm_receipt` (FE + BE `requireAnyPerm(['inbound',...],['tms_plan','confirm_receipt'])`). Khi nút ở trang A nhưng thao tác chạm module B → dùng `requireAnyPerm` + ghi nhãn cho rõ, đừng bắt user đoán.
> - Trang **Tồn kho** có nút tắt **Tách/Dồn** (thanh thao tác khi chọn pallet) dùng quyền `pallet_ops.split` / `pallet_ops.merge`: nút chỉ **điều hướng** sang trang Dồn/Tách (KHÔNG gọi API chéo) nên chỉ cần gate nút bằng `pallet_ops` (không cần `requireAnyPerm` ở route Inventory); API thực thi nằm ở route `/pallet-ops/*` đã gate `pallet_ops`.
> - **VỊ TRÍ PHẦN CÒN LẠI KHI XUẤT (30/07)**: quét xuất/nhặt lẻ mà pallet KHÔNG đi hết thì FE bắt chọn chỗ đặt phần dư mới cho Lưu, và `POST /outbound/:gdoId/items/:itemId/scan` nhận `leftover_location_id` (`'KEEP'` = giữ chỗ cũ | id vị trí mới) → BE tự chuyển vị trí qua RPC `move_pallets_to_location`. Đây là ghi `location_id` NẰM TRONG luồng quét: gate vẫn là `outbound.scan`/`loosepicking.scan` (KHÔNG đòi thêm `inventory.move_location`) vì người quét BẮT BUỘC phải khai được chỗ đặt — đòi quyền khác sẽ khóa chính người đang làm việc. Phạm vi ghi bị chặn hẹp: chỉ đúng pallet vừa quét, chỉ vị trí thuộc kho của chuyến. Đổi vị trí pallet BẤT KỲ ngoài luồng quét vẫn phải qua `inventory.move_location`.
> - **ĐỔI VỊ TRÍ phiếu nhập** (Inbound detail, nút bút chì + select "Chưa chọn vị trí") dùng quyền **`inbound.edit_pallet` / `force_edit_pallet`** (sửa pallet của mình / bất kỳ) — **KHÔNG** dùng `inbound.edit` (vốn là "Sửa nhóm phiếu NCC"). Route riêng `PATCH /inbound-orders/:id/location` (`requireAnyPerm(edit_pallet, force_edit_pallet)`) chỉ đổi `location_id` — KHÔNG gộp vào `updateOrder` (để không nới quyền sửa field khác). **Bài học: một capability riêng (đổi vị trí) phải map đúng quyền sở hữu nó, đừng gộp ké vào quyền không liên quan** — nếu cần tách thì tạo route/permission riêng, đừng dùng chung gây "gộp quyền".

**LUẬT khi thêm/sửa tính năng có nút/route write — BẮT BUỘC đủ 5 việc:**
1. Thêm action vào **FE `MODULES`** (label phải mô tả đúng TRANG nó điều khiển — để admin biết link tới đâu).
2. Thêm action vào **BE `ALL_PERMISSIONS`** (thiếu → superadmin mất quyền).
3. Gate nút FE: `can(perms, module, action)`.
4. Gate route BE: `requirePerm` / `requireAnyPerm`.
5. Cập nhật dòng module ở bảng bản đồ trên + `docs/modules/<key>.md` (chạm module khác ⇒ nối "Giao thoa với" CẢ HAI phía; `node scripts/docs/check-modules.mjs` kiểm). Nếu nút nằm khác module với quyền nó cần → dùng `requireAnyPerm` + nhãn rõ.
6. ⭐ **CẤP CHO CHỨC DANH NÀO (lớp C37, đã lặp HAI LẦN):** bốn việc trên chỉ làm quyền TỒN TẠI, không làm ai CÓ nó — superadmin bỏ qua mọi `requirePerm` nên người làm luôn thấy màn hình chạy tốt trong khi 100 % nhân viên thật không thấy mục menu. Đo thật: `directed_work` ra máy 10/09 với **0/9** chức danh kho; `dispatch` + `freight` ra máy 23–24/09 với **0/19** chức danh (41 nhân sự). Module MỚI ⇒ kèm migration cấp theo **NĂNG LỰC SẴN CÓ** (`20260912d`, `20260924d` là hai mẫu; KHÔNG so tên tiếng Việt — ratchet `role_by_vietnamese_name`), quyền GHI của module B thì đòi đúng năng lực ghi B. Gói QA 08 tầng **2b** nay FAIL nếu một module không chức danh nào nắm bất kỳ action nào (action lẻ chưa ai cấp vẫn chỉ warn — đó là quyết định quản trị); ngoại lệ khai `MODULE_ADMIN_ONLY` kèm lý do.

**NÚT XUẤT EXCEL / EXPORT = phải có quyền `export` RIÊNG (chốt 26/07)** — mang dữ liệu ra khỏi app là hành vi riêng, KHÔNG đi ké `view`. Đã gate: `inventory.export` · `scanlog.export` · `locations.export` · `stocktake.export` (2 tab) · `leave.export` (file có LÝ DO nghỉ) · `attendance.report` (bảng công) · `tms_plan.export` (Báo cáo nhập) · `external_do_sap.export`. Export dựng client-side (không có route BE riêng) thì gate ở NÚT; điểm chặn dữ liệu thật vẫn là **list API phải cắt scope kho + loại** — đã siết cho `/hr/attendance` + `/hr/leaves` ngày 26/07 (trước đó rò toàn công ty).

---
## Công cụ (skill · MCP · hook)

**Skill — BẮT BUỘC gọi đúng skill TRƯỚC khi làm** (đừng dựa vào trí nhớ, đừng tự suy luận lại chuẩn). Gọi qua công cụ Skill hoặc `/<tên>`; file ở `.claude/skills/<tên>/SKILL.md`:

| Khi… | BẮT BUỘC gọi skill |
|---|---|
| Bắt đầu việc lớn (module mới, đổi schema, refactor nhiều file, yêu cầu mơ hồ) | `brainstorm-plan` |
| Rà soát / audit toàn bộ 1 module (chiến dịch review từng module) | `review-module` |
| Kiểm tra app toàn diện · tìm lỗi · cải tiến (user gọi "kiểm tra app / rà lỗi / test / tìm chỗ sai"). 1 skill bao trọn: chức năng+nghiệp vụ · UI/hiển thị · phân quyền · đồng thời/tải · hiệu năng · edge/realtime · phán đoán nghiệp vụ+UX | `check-app` |
| Tạo/sửa list page · table · trang detail | `table-format` |
| Làm/sửa tính năng quét QR | `qr-scan-flow` |
| Thêm/sửa upload file (Excel/bulk) hoặc download/export dữ liệu | `upload-download-standard` |
| Thêm/sửa nút hay route gọi API write (tạo/sửa/xóa/quét/duyệt/phát hành…) | `add-permission` |
| Thêm/sửa INSERT/UPDATE · mutation số liệu · đổi DB schema | `mutation-realtime` |
| Trước khi báo “đã xong” bất kỳ tính năng/sửa lỗi nào | `verify-feature` |
| Gặp bug / hành vi sai chưa rõ nguyên nhân | `debug-systematic` |
| Thêm/sửa route có id trên URL · bảng/RPC mới · đăng nhập/mật khẩu · upload · `npm i` thư viện · user hỏi "bảo mật / rủi ro / IT chủ đầu tư hỏi" | `security-hardening` (cửa đã đóng 02–03/09 + lưới QA 40–44 gác từng cửa + việc còn mở) |

**Một việc thường chạm NHIỀU skill — gọi đủ.** Vd thêm nút Xóa trong table = `table-format` + `add-permission` + `mutation-realtime`, xong `verify-feature`.

**MCP:** Postgres (query DB read-only — `mcp__postgres__query`) · Playwright (test UI thật, login đọc từ `frontend/.env`) · Vercel (trạng thái deploy/log). Cấu hình ở `.mcp.json` — **gitignored** (chứa DATABASE_URL, không commit).

**Backend deploy:** sửa `backend/src` → **bump `// rebuild-token`** trong `api/index.ts` để Vercel rebuild function (có hook nhắc).

---
## Development
```bash
cd backend && npm run dev    # port 4000
cd frontend && npm run dev   # port 5173
```
Vercel env: `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` (BE) · `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` (FE).
