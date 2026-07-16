---
name: mutation-realtime
description: BẮT BUỘC làm theo khi thêm/sửa endpoint có INSERT/UPDATE, mutation cập nhật số liệu (tồn kho, số lượng, trạng thái…), hoặc đổi DB schema. Gồm quy tắc INSERT (randomUUID + updated_at — thiếu lỗi 23502), invalidateQueries đủ key, TABLE_QUERY_MAP realtime, timezone VN, và quy trình migration. Chống bug số liệu không cập nhật / stale cache / 23502 — nguồn bug hay gặp nhất.
---

# Mutation & Realtime & Migration

## A. Backend INSERT/UPDATE
- **Mọi INSERT** phải có `id: randomUUID()` + `updated_at: new Date().toISOString()` — DB **không có DEFAULT** cho 2 cột này, thiếu → lỗi `23502`.
- `import { randomUUID } from 'crypto'` ở đầu mọi controller có INSERT.
- DB client: `import { supabase } from '../../lib/supabase'` (service role).
- **Timezone VN (Asia/Ho_Chi_Minh)**: business date (`import_date`, `update_date`…) lưu chỉ ngày theo giờ VN: `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })`. System timestamp (`created_at`/`updated_at`) UTC `toISOString()` là OK. Query khoảng ngày: `new Date(\`${vnDate}T00:00:00+07:00\`).toISOString()`.
- TypeScript: không `as any`; định nghĩa type rõ.

## B. Frontend mutation + realtime (mọi tính năng đụng số liệu)
- `onSettled`/`onSuccess` của mutation phải `invalidateQueries` cho **TẤT CẢ** query key liên quan (không chỉ query chính).
- Thêm query key mới vào `TABLE_QUERY_MAP` (`frontend/src/lib/realtimeEvents.ts`) ở bảng DB tương ứng → realtime tự invalidate, không cần polling.
- Optimistic update → phải rollback đúng khi lỗi.
- **Sửa 1 field trên 1 record đang mở (vd đổi vị trí phiếu) → BẮT BUỘC optimistic, KHÔNG `invalidate → refetch` query detail nặng.** Pattern: `onMutate` `setQueryData` patch field ngay (snapshot để `onError` rollback) → UI đổi tức thì; mutationFn trả về record đầy đủ thì `onSuccess` MERGE vào cache (`{...old, ...data}`, giữ field con như `inventory_entries`); `onSettled` chỉ invalidate query **list** ở nền. **Lý do (bài học 19/06/2026 — đổi vị trí Inbound chậm):** invalidate query detail khiến user chờ thêm 1 round-trip serverless refetch query nặng (nhiều join); cộng `emitInboundChanged()`→Realtime invalidate prefix → refetch detail LẦN 2 trùng lặp. ⇒ click thấy "đứng hình rất lâu". Optimistic + xài response + để Realtime reconcile nền = phản hồi tức thì, vẫn eventual-consistent. **Đừng vừa `invalidate(detail)` trong mutation vừa để Realtime invalidate cùng key → refetch kép.**
- Lỗi API hiển thị **banner đỏ inline** trong component (không chỉ console). Bulk action chạy song song `Promise.all(ids.map(...))`. Button: `disabled={saving}`.

## C. Đổi DB schema (migration)
1. Viết SQL → `backend/migrations/YYYYMMDD_<desc>.sql`.
2. Apply qua Supabase Dashboard → SQL Editor (hoặc Postgres MCP read-only để kiểm tra trước/sau).
3. Bảng mới cần realtime → thêm vào publication `supabase_realtime` **VÀ policy RLS** `CREATE POLICY rls_auth_select ON public."<Bảng>" FOR SELECT TO authenticated USING (true);` — FE nhận Realtime qua JWT role=authenticated (setRealtimeAuth); từ đợt khóa RLS 12/07, bảng bật RLS mà thiếu policy này = Realtime bị chặn ÂM THẦM (phải refresh tay — dính thật với WeighTicket 16/07).
4. Push GitHub + cập nhật `SCHEMA_REVIEW.md`.

## D. Sau khi xong
- Sửa `backend/src` → **bump rebuild-token** trong `api/index.ts`.
- Chạy [[verify-feature]] — đặc biệt **realtime 4 case**: tạo / sửa / xóa / làm lại → số liệu đúng, không stale.

## Checklist
- [ ] INSERT: `id: randomUUID()` + `updated_at` (+ import crypto)
- [ ] Business date theo giờ VN; timestamp UTC
- [ ] `invalidateQueries` đủ MỌI key liên quan; optimistic có rollback
- [ ] `TABLE_QUERY_MAP` có key mới ở bảng tương ứng (+ bảng đã bật realtime)
- [ ] (Đổi schema) file migration + apply + SCHEMA_REVIEW.md
- [ ] Bump rebuild-token; chạy verify-feature 4 case
