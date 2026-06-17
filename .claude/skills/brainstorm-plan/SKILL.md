---
name: brainstorm-plan
description: Quy trình brainstorm → chốt plan trước khi code việc LỚN (module mới, đổi schema, refactor nhiều file). Dùng khi yêu cầu mơ hồ/nhiều cách làm. Bỏ qua cho sửa nhỏ rõ ràng.
---

# Brainstorm → Plan (việc lớn)

Rút gọn từ tinh thần "plan trước, code sau" — khớp CLAUDE.md mục #1 (suy nghĩ trước) + #4 (tiêu chí kiểm chứng). **KHÔNG ép TDD** (dự án không có test suite); verify bằng `tsc --noEmit` + `npm run build` + Playwright (UI thật) + Postgres MCP (soi DB).

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
- **Dừng, hỏi user duyệt plan** trước khi sang bước 3 (trừ khi user đã bảo "làm luôn").

### 3. Implement + verify
- Code đúng plan, đụng tối thiểu. Sau cùng: `tsc --noEmit` → `build` → (UI: Playwright) → push GitHub.
- Nếu sửa `backend/src` → bump rebuild-token trong `api/index.ts`.
- Báo kết quả trung thực: pass/fail kèm bằng chứng.
