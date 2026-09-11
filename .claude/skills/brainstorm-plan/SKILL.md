---
name: brainstorm-plan
description: Quy trình brainstorm → chốt plan trước khi code việc LỚN (module mới, đổi schema, refactor nhiều file). Dùng khi yêu cầu mơ hồ/nhiều cách làm. Bỏ qua cho sửa nhỏ rõ ràng.
---

# Brainstorm → Plan (việc lớn)

Rút gọn từ tinh thần "plan trước, code sau" — khớp CLAUDE.md mục #1 (suy nghĩ trước) + #4 (tiêu chí kiểm chứng). Verify bằng `tsc --noEmit` + `npm run build` + **`cd backend && npm test`** (vitest: bất biến helper thuần + mirror BE⇄FE, từ 11/09) + Playwright (UI thật) + Postgres MCP (soi DB). Helper thuần MỚI có luật nghiệp vụ (quy đổi, ngày, parse) → viết test bất biến trong `backend/tests/unit` NGAY trong plan, đừng chờ bug.

## Khi nào dùng
- ✅ Module mới, đổi DB schema, refactor đụng nhiều file, yêu cầu có ≥2 cách hiểu.
- ❌ Bỏ qua: sửa 1 chỗ rõ ràng, đổi text/màu, fix bug nhỏ đã rõ nguyên nhân → làm thẳng.

## 3 bước (làm tuần tự, dừng lấy xác nhận giữa bước 2→3)

### 1. Brainstorm (làm rõ, chưa code)
- Nêu **giả định** của tôi. Nếu mơ hồ → liệt kê các cách hiểu, KHÔNG tự chọn ngầm.
- Nêu **cách đơn giản hơn** nếu có (CLAUDE.md #2). Sẵn sàng phản biện yêu cầu.
- Soi hiện trạng: Postgres MCP (schema/dữ liệu thật) + đọc file liên quan. Đừng suy diễn.

### 2. Plan ngắn (dạng checklist verify được)
```
1. [Bước] → kiểm tra: [điều verify được]
2. [Bước] → kiểm tra: [...]
```
- Mỗi bước truy ngược được tới yêu cầu user (CLAUDE.md #3 — phạm vi nhỏ).
- Nếu đổi schema: nêu file `backend/migrations/YYYYMMDD_*.sql` + cột `id`/`updated_at` + cập nhật `SCHEMA_REVIEW.md`.
- Nếu có mutation số liệu: nêu invalidateQueries + `TABLE_QUERY_MAP` + test 4 case (tạo/sửa/xóa/làm lại).
- Nếu thêm action: nêu permission key (FE+BE `config/permissions.ts`) + `requirePerm`.
- ⭐ **BẢNG CÔNG TẮC (bắt buộc từ 11/09 — lớp lỗi C5 "ra máy mà quên công tắc", đợt 1c Directed Work chỉ bật được bằng sửa DB):** mỗi cờ / cột cấu hình / tham số MỚI (`Warehouse.*`, `SystemSetting`, `LookupValue.meta`, `warehouse_type_configs`…) = 1 dòng: *tên cột → ô UI ở trang/tab nào → quyền nào sửa → giá trị mặc định = hành vi cũ?*. Không điền được ô "UI ở đâu" = tính năng chưa có cửa vào, chưa được báo xong.
- **3 luật code mới (ratchet 09 gác, đỏ ở CI):** route write mới phải có `validate({…})` từ `middlewares/validate.ts` · file BE mới import `db` (client có kiểu) không phải `supabase` · helper BE có bản FE (mirror) phải có `backend/tests/mirror/<tên>.mirror.test.ts`. Route mới phải được ≥ 1 gói QA gọi tới (ratchet độ phủ `coverage-surface.mjs --ratchet`).
- **Dừng, hỏi user duyệt plan** trước khi sang bước 3 (trừ khi user đã bảo "làm luôn").

### 3. Implement + verify
- Code đúng plan, đụng tối thiểu. Sau cùng: `tsc --noEmit` → `build` → (UI: Playwright) → push GitHub.
- Nếu sửa `backend/src` → bump rebuild-token trong `api/index.ts`.
- Báo kết quả trung thực: pass/fail kèm bằng chứng.
