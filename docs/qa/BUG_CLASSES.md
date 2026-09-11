# Sổ LỚP LỖI — lưới nào gác lớp nào, lần tái phát cuối

> **Vì sao có sổ này (11/09/2026):** user — "lần nào yêu cầu test kiểm lỗi cũng ra nhiều, không có hồi kết".
> Đo 30 ngày trước đó: 45 % commit là fix, và 5 lớp lỗi chiếm đa số, **lớp nào cũng đã gặp ≥ 3 lần**.
> Kiểm app trên bề mặt đang lớn 100–160 commit/tuần thì luôn ra lỗi; điều đo được là **lỗi thuộc lớp
> ĐÃ CÓ LƯỚI phải về 0**. Mỗi lần kiểm app (skill `check-app`) BẮT BUỘC gắn nhãn từng lỗi:
>
> - **LẶP** — lớp đã có trong sổ ⇒ lưới của lớp đó HỎNG hoặc CÓ LỖ. Việc phải làm: sửa **lưới** (không chỉ sửa bug),
>   ghi ngày tái phát vào cột cuối. Lặp ≥ 2 lần cùng lớp = lưới sai tầng, phải đổi tầng (vd ratchet regex → kiểu tsc).
> - **MỚI** — chưa có lớp ⇒ thêm dòng mới + chọn tầng lưới theo bảng tầng bên dưới. Không có lưới = CHƯA fix xong
>   (luật "bug chết hai lần", CLAUDE.md).
>
> **Bảng tầng lưới (rẻ → đắt; chọn tầng RẺ NHẤT bắt được lớp đó):**
> 1. **tsc** — ràng buộc kiểu (`db` có kiểu, overload bắt tham số, union phân biệt). Bắt lúc gõ code, 0 giây.
> 2. **Test đơn vị / mirror** — `backend/tests`, `npm test`, vài giây, không cần DB. Helper thuần + "hai bản phải ra cùng số".
> 3. **Cổng tĩnh ratchet** — `scripts/qa/09-static-gate.mjs`, regex/AST trên code, không cần server.
> 4. **Ratchet độ phủ** — `coverage-surface.mjs --ratchet`: route/quyền mới phải có gói QA chạm.
> 5. **Gói QA nghiệp vụ** — `scripts/qa/NN-*.mjs` trên Preview + staging (bậc `fast` mỗi push · `full` đêm).
> 6. **Tai mắt production** — `error_logs` + digest hằng ngày.

| # | Lớp lỗi | Lưới gác (tầng) | Bằng chứng lưới đỏ trên bản lỗi | Tái phát cuối |
|---|---|---|---|---|
| C1 | **Input xấu → 500 thay 4xx** (body sai kiểu `.trim()` nổ · id rác 22P02 · ngày không có thật 22008 · thiếu field 23502 · `.single()` coerce) | (1) `validate({…})` tại route (`middlewares/validate.ts`) · (3) `write_route_without_validate` — route write mới không schema = đỏ · (5) gói 07/37/38 fuzz · `fail(res, err)` dịch mã Postgres | gói 37 bodyfuzz 31/08: 61 ca; gói 53: 12 ca | 07/09 (16 chỗ forklift) |
| C2 | **Luật chép tay, bản sau thiếu một nhánh** (BASE⇄thùng · số VN `1.234` · ô gộp Excel · isDay · %Date · biển số · mã lô tem) | (2) `tests/mirror/*.mirror.test.ts` — cùng input, BE và FE ra cùng số · (3) `mirror_helper_without_test` — helper BE ghi "mirror" mà không có test = đỏ · (3) `*_hand_rolled` ratchet | 11/09 qrParser.mirror ĐỎ trên qr.ts cũ (mã lô ngày 32: BE nhận, FE loại) — chứng minh bằng `git stash` | 11/09 (qr.ts, parseVnNumber TMSBookings) |
| C3 | **Phạm vi kho lệch giữa ĐỌC và GHI** (controller không đọc `warehouse_ids`; cửa đọc hở, cửa ghi gác hoặc ngược lại) | (5) gói 41 idor-scope + 51/53 · (4) ratchet độ phủ (route mới không gói nào chạm = đỏ) | gói 53: sổ Dồn/Tách đọc trọn kho khác | 07/09 |
| C4 | **UI: hook sau return sớm · thiếu key invalidate · tràn ngang mobile · nút không có** | (3) `hook_after_early_return` (0) · `mutation_hook_without_button` · `filterbar_without_sheetbutton` · (5) Playwright 3 khổ trong check-app | 10/09 trang chuyến trắng | 10/09 |
| C5 | **Tính năng ra máy thiếu công tắc / trả 200 im lặng** (đợt 1c không có ô `work_mode`; sửa DO SAP không nói "chờ duyệt") | (3) `mutation_hook_without_button` · **bảng công tắc** trong plan (skill `brainstorm-plan`) · (5) gói QA theo bề mặt | 10/09 | 10/09 |
| C6 | **Sai tên bảng/cột · INSERT thiếu id/updated_at (23502) · RPC sai tên** | (1) client `db = createClient<Database>` (`npm run db:types` sau migration) · (3) `untyped_supabase_import_files` (file mới phải dùng `db`) · `db_types_unknown_table` | 11/09: kiểu sinh lộ 8 bảng code gọi mà staging không có (xem ghi chú) | — |
| C7 | **Cắt âm thầm trần 1000 / URL quá dài** | (6) `CAP_TRUNCATED` runtime · (3) `unpaginated_in_query` (144) · `fetchAllRowsParallel`/chunk 300 | 03/08 badge DO | 03/08 |
| C8 | **Đua ghi trên bộ đếm dùng chung** (khoá đúng mà đếm sai tập · CAS không jitter) | (5) gói 02/17/27/46/56 race · RPC row-lock | 09/09 QA 56 [6a] 5 xe 1 suất → 2 lọt | 09/09 |
| C9 | **Cache "kỳ đã qua" không làm mới khi dữ liệu về muộn** | (5) gói 55 [4k] oracle hai đường | 09/09 | 09/09 |
| C10 | **Hai tên cho một trạng thái** (`DONE` vs `COMPLETED`) | (5) gói 50 [29b][29c] danh sách đóng · CHECK ở DB · **chưa có tầng 1** (cột là text, kiểu sinh không thành enum — đổi cột sang enum Postgres mới lên tầng tsc) | 07/09 3.173 lệnh | 07/09 |
| C12 | **Bước CI xanh máy dev, đỏ runner** (Windows/Node 24/npm 11 ≠ Ubuntu/Node 22/npm 10: npm-audit 03/09 · vitest 11/09 vì supabase-js đòi WebSocket native trên Node 20) — mỗi lần là một chuỗi email đỏ | quy trình: bước CI mới chạy thử dưới đúng Node runner TRƯỚC khi push: `npx -y -p node@22 -- node …` + `env -u SUPABASE_URL …` mô phỏng không `.env`; sau push đọc kết luận qua API công khai (`/actions/runs?branch=dev` → `/jobs` → `/check-runs/{id}/annotations`) | 11/09: tái hiện đúng lỗi bằng `npx -p node@20` | 11/09 |
| C11 | **Phép kiểm QA khoá chính lỗi lại** (kiểm khớp hằng số cùng hiểu nhầm với code) | quy trình: phép kiểm mới phải ĐỎ trên bản lỗi (`git stash`) trước khi tin · oracle hai đường | 06/09 gói 22 [17] | 06/09 |

**Ghi chú C6 (11/09):** 8 tên bảng trong code không có trong kiểu sinh từ staging — phải soi từng tên: bảng
chỉ có ở production, bảng đã đổi tên, hay mã chết (`DeliveryBooking` của `tms/bookingController.ts` đã biết
là mã chết). Baseline ratchet đặt bằng số hiện tại; giảm được thì `--update-baseline`.

**Cách đọc "có hồi kết":** cột *Tái phát cuối* của mọi lớp có lưới tầng 1–3 phải đứng yên qua các đợt
kiểm; đợt kiểm chỉ còn thêm dòng MỚI. Khi một đợt check-app ra ≥ 3 lỗi LẶP cùng lớp ⇒ dừng vá lẻ, sửa lưới.
