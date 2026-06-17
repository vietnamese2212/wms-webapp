---
name: verify-feature
description: BẮT BUỘC chạy TRƯỚC khi báo "đã xong" cho bất kỳ tính năng/sửa lỗi nào. Quy trình kiểm chứng chuẩn của dự án (KHÔNG phải viết unit test — dự án không có test framework): compile (tsc + build) → soi DB thật bằng Postgres MCP → realtime 4 case (tạo/sửa/xóa/làm lại) → UI flow thật bằng Playwright → báo cáo trung thực kèm bằng chứng. Chống thói tuyên bố xong khi chưa chạy thử.
---

# Verify Feature — kiểm chứng trước khi báo xong

Hiện thực hóa CLAUDE.md mục #4 ("tiêu chí thành công verify được") + luật "Realtime & test bắt buộc". **Không claim "xong" nếu chưa qua các cổng dưới.** Báo cáo trung thực: pass/fail kèm bằng chứng; nếu skip bước nào, nói rõ skip.

## Cổng 1 — Compile (luôn luôn)
- Sửa frontend: `cd frontend && npx tsc --noEmit && npm run build`.
- Sửa backend: `cd backend && npx tsc --noEmit`. Nếu sửa `backend/src` → **bump rebuild-token** trong `api/index.ts` (Vercel mới rebuild function).
- Không pass → CHƯA xong, sửa ngay, không báo cáo.

## Cổng 2 — DB là nguồn sự thật (mọi tính năng đụng số liệu)
Dùng **Postgres MCP** (`mcp__postgres__query`, read-only) query trực tiếp bảng liên quan:
- Row tạo/sửa đúng giá trị? Có `id` (UUID) + `updated_at` chưa (DB không default → thiếu = lỗi 23502)?
- Xóa → row mất / số liệu hoàn lại đúng?
- Business date theo giờ VN (`YYYY-MM-DD`)? Timestamp UTC?

## Cổng 3 — Realtime 4 case (bắt buộc nếu có mutation số liệu)
Kiểm đủ: **1) Bắt đầu làm** (tạo mới → số liệu cập nhật ngay) · **2) Sửa** (giá trị mới phản ánh) · **3) Xóa** (hoàn lại đúng) · **4) Làm lại** (tích lũy đúng, không stale cache).
Đọc code xác nhận: `onSettled/onSuccess` của mutation `invalidateQueries` đủ MỌI query key liên quan; `TABLE_QUERY_MAP` trong `realtimeEvents.ts` có query key mới ở bảng DB tương ứng; optimistic update có rollback khi lỗi.

## Cổng 4 — UI flow thật (Playwright MCP)
- **Ưu tiên local dev**: nếu `localhost:5173` (FE) + `:4000` (BE) đang chạy thì test ở đó (an toàn, không đụng prod). Không chạy → hỏi user bật `npm run dev` hoặc cho phép test trên prod `wms-webapp.vercel.app` (lưu ý: thao tác ghi đụng DB production).
- **Login**: đọc `frontend/.env` (gitignored) → `TEST_EMAIL` + `TEST_PASSWORD` (hiện là tài khoản Admin toàn quyền). Trang login dùng **email + mật khẩu**. KHÔNG hardcode credential vào skill/repo/commit.
- **DB dùng chung (quan trọng)**: local dev và prod trỏ về CÙNG 1 Supabase — KHÔNG có DB test riêng. Nên thao tác GHI qua UI là đụng dữ liệu thật → ưu tiên smoke/đọc + verify bằng Postgres MCP; nếu cần test ghi thật thì dùng bản ghi nháp rõ ràng và DỌN sau, hoặc xin phép user.
- Thao tác đúng luồng vừa code (nút action, dialog, scan…) → `browser_snapshot`/`browser_take_screenshot` xác nhận hiển thị đúng.
- **BẮT BUỘC test CẢ desktop VÀ mobile** (không chỉ 1 cỡ) — dùng `browser_resize` rồi chụp từng cỡ:
  - **Desktop browser**: `1280×800` (kiểm bố cục đầy đủ, pane phải/cột, hover).
  - **Mobile**: `390×844` (iPhone) **và** `360×800` (Android nhỏ — mốc tràn màn) — kiểm FilterBar gom thành nút "Lọc", bottom nav, dialog/sheet không vỡ, KHÔNG tràn ngang.
  - (Có pane/tablet-specific) thêm `768×1024`.
  - Đọc lại ảnh từng cỡ để xác nhận, không chỉ chụp.
- Kiểm phân quyền: nút write có bị ẩn đúng khi thiếu `can(perms,…)` không.

## Cổng 5 — Báo cáo trung thực
Liệt kê từng cổng: ✅ pass (bằng chứng: số liệu DB / screenshot) hoặc ❌ fail (output lỗi) hoặc ⊘ skip (lý do). Test fail thì NÓI fail kèm output, không che. Xong + verified mới nói "xong" dứt khoát.

## Checklist nhanh
- [ ] tsc --noEmit + build pass (FE và/hoặc BE)
- [ ] (BE thay đổi) bump rebuild-token
- [ ] Postgres MCP: row đúng, id+updated_at đủ
- [ ] Realtime 4 case + invalidateQueries + TABLE_QUERY_MAP
- [ ] Playwright: luồng UI thật, chụp CẢ desktop (1280) VÀ mobile (390 + 360) + phân quyền
- [ ] Báo cáo pass/fail/skip kèm bằng chứng
