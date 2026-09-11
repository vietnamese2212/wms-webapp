# Chiến lược chất lượng — "kiểm phải ra lỗi ĐÚNG, và lỗi không lặp lại" (11/09/2026)

## Vấn đề user nêu
"Kiểm tra app / check lỗi code / logic đã có rồi nhưng lần nào yêu cầu test cũng ra nhiều lỗi, không có hồi kết.
App càng lớn lỗi càng nhiều." Yêu cầu: khi nói TEST app thì phải rà và phát hiện lỗi đúng, **lần sau không lặp lại**.

## Số đo lúc chẩn đoán
| Chỉ số | Giá trị |
|---|---|
| Commit từ 06/2026 | 2.018, **905 là fix (45 %)**; 8 tuần gần nhất 40–60 %/tuần |
| Bộ QA | 57 gói · 1.614 phép kiểm · chạy trên staging sống · CI mỗi push chỉ 3 gói read-only |
| Test đơn vị / ESLint | 0 · 30 helper BE có bản mirror FE mà không phép kiểm nào so hai bản |
| Luật | CLAUDE.md 150 KB văn xuôi + 12 skill · 60 luật ratchet |
| Code | 123k dòng TS · 402 route · `outboundController.ts` 7.259 dòng |

5 lớp lỗi chiếm đa số 90 commit fix gần nhất, lớp nào cũng đã gặp ≥ 3 lần (xem `docs/qa/BUG_CLASSES.md`).
Kết luận: **tháp kiểm bị lộn ngược** — tầng rẻ (kiểu tsc, test hàm thuần) trống, mọi thứ dồn lên tầng đắt
(audit khám phá trên staging), nên mỗi đợt kiểm lại bắt cùng lớp lỗi ở chỗ mới.

## Đã làm (đợt 1 — 11/09)
| # | Việc | Lưới máy | Bằng chứng |
|---|---|---|---|
| A3 | **vitest** ở `backend/` (`npm test`, 3 giây, không DB): 11 test mirror BE⇄FE + 4 test bất biến | tầng 2 | 55 phép xanh; `qrParser.mirror` ĐỎ trên `qr.ts` cũ (git stash) — bắt 1 lệch thật; `parseVnNumber` FE chép tay thiếu nhánh `1.234` → thay bằng import |
| A2 | **`middlewares/validate.ts`** (zod) — schema trên route, 400 tiếng Việt kèm tên trường, `req.body` đã ép kiểu | tầng 1+3: ratchet `write_route_without_validate` (baseline = hiện tại, route mới bắt buộc) | áp mẫu `PUT /wms/settings/:key` |
| A1 | **Kiểu DB** `backend/src/types/database.ts` sinh từ information_schema staging (`scripts/gen-db-types.mjs`, `npm run db:types`) + client `db = createClient<Database>` | tầng 1+3: `untyped_supabase_import_files` (file mới dùng `db`) · `db_types_unknown_table` | 93 bảng · 152 RPC; `notifyController` chuyển sang `db` biên dịch sạch |
| B4 | **run-all 3 bậc** `--tier fast|full` + `.github/workflows/qa-nightly.yml` chạy full 02:00 VN | tầng 5 | ci.yml thêm `npm test` + ratchet độ phủ |
| B5 | **Ratchet độ phủ** `coverage-surface.mjs --ratchet` + `coverage-baseline.json` | tầng 4 | baseline routes_uncovered 2 |
| C6 | **Sổ lớp lỗi** `docs/qa/BUG_CLASSES.md` + check-app bắt buộc nhãn LẶP/MỚI | quy trình | — |
| C7 | verify-feature: Cổng 0 `npm test`; Cổng 5 tải chỉ bắt buộc khi đụng bộ đếm/tồn/booking dùng chung | quy trình | — |
| C8 | brainstorm-plan: **bảng công tắc** (mỗi cờ/cột cấu hình mới → ô UI ở đâu) + 3 luật code mới | quy trình | — |

## Còn mở (đợt 2 — cần user quyết / làm khi chạm)
- **C9 Tách CLAUDE.md** (150 KB): giữ luật + chỉ mục, chuyển lịch sử từng tính năng sang `docs/modules/`. Chưa làm — file
  là chỉ dẫn của user, cần user duyệt cấu trúc trước khi di chuyển.
- **Trạng thái dạng text → enum Postgres** (lớp C10) để `DONE`/`COMPLETED` lên tầng tsc. Cần migration + backfill.
- **Áp `validate()` dần** cho 258 route cũ khi chạm; **chuyển `db`** cho 70 file khi chạm. Không mass-rewrite.
- **`qa-nightly.yml` chỉ chạy theo lịch khi nằm trên branch mặc định** (main). Hiện main sẽ được dựng lại từ dev
  (memory `main-branch-will-be-rebuilt`) — khi đó tự chạy; trước đó chạy tay bằng *Run workflow*.
- **8 bảng code gọi mà staging không có** (ratchet `db_types_unknown_table`, baseline 8) — soi từng tên: mã chết
  (`DeliveryBooking`), bảng chỉ có production, hay tên cũ.
- `outboundController.ts` 7.259 dòng: tính năng mới đặt ở `services/*.ts` (mẫu `directedTasks.ts`), không nhét thêm.

## Thước "có hồi kết"
1. Cột *Tái phát cuối* trong `BUG_CLASSES.md` của lớp có lưới tầng 1–3 **đứng yên** qua các đợt kiểm.
2. Tỷ lệ commit fix/tuần giảm dưới 30 % (đo `git log --since` như lúc chẩn đoán).
3. Đợt check-app ra lỗi **MỚI** là lành mạnh; ra ≥ 3 lỗi **LẶP** cùng lớp = sửa lưới, không vá lẻ.
