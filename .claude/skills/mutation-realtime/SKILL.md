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
3. Bảng mới cần realtime → **CHỈ thêm dòng vào `TABLE_QUERY_MAP`** (`frontend/src/api/realtimeEvents.ts`). Trigger phát tín hiệu `trg_wms_notify` được **event trigger tự gắn** khi `CREATE TABLE` trong `public` (migration 20260902b); bảng có sẵn thì gắn tay: `CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public."<Bảng>" FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change();`. Gói QA 00 mục 10 đỏ nếu bảng khai trong map mà thiếu trigger.
   **⛔ TUYỆT ĐỐI KHÔNG tạo `CREATE POLICY … FOR SELECT TO authenticated USING (true)` nữa** (luật cũ 12/07→02/09). Cơ chế cũ `postgres_changes` đòi quyền SELECT nên 64 policy như vậy đã biến vé realtime (JWT role=authenticated nằm trong localStorage của MỌI tài khoản) thành chìa khoá gọi thẳng PostgREST đọc trọn 58/73 bảng — chi phí kho, bảng công, nghỉ phép, tồn mọi kho, ma trận quyền — vòng qua toàn bộ `requirePerm` + cắt scope (kiểm định trước chào bán 02/09). Nay realtime đi **Broadcast từ trigger DB** với gói tin tối thiểu `{table, op}` (+`row_id`/`booked_count` cho DeliverySlot, `row_id` cho ProductionImport; `user_notifications` đi kênh cá nhân `wms-user-<employee_id>`), và `authenticated`/`anon` có **0 quyền bảng · 0 policy · 0 default ACL** trong `public` (20260902c) — gói QA 00 mục 10b gác, không được mở lại. FE không đọc bảng nào qua Supabase (0 chỗ `supabase.from(`); cần dữ liệu thì qua API đã cắt scope.
   Bảng cần dữ liệu dòng trong tín hiệu (hiếm) → thêm nhánh trong `wms_notify_change` + đổi trigger sang `FOR EACH ROW`, và CHỈ gửi khóa/cột FE thật sự dùng — không bao giờ cả dòng.
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
