-- 11/10/2026 — Lưới cho lớp C79 (trigger TỪNG DÒNG ghi bảng khác ⇒ một câu N dòng hoá N câu con + N lần realtime.send):
-- RPC liệt kê trigger FOR EACH ROW mà hàm của nó có UPDATE / INSERT / DELETE bảng khác hoặc realtime.send / pg_notify.
-- Gói 00 mục 14d so với danh sách đã biết — xuất hiện tên mới là đỏ, buộc người thêm trigger cân nhắc bản theo lô (bảng chuyển tiếp)
-- hoặc khai vào danh sách kèm lý do. Chỉ đọc catalog, STABLE. Lên production: áp bất kỳ lúc nào.
CREATE OR REPLACE FUNCTION public.qa_row_triggers_with_writes() RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(c.relname || ' :: ' || t.tgname ORDER BY c.relname, t.tgname), '{}'::text[])
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE n.nspname = 'public' AND NOT t.tgisinternal AND (t.tgtype & 1) = 1
     AND (p.prosrc ~* '(^|[^a-z_])(update|insert into|delete from)\s+(public\.)?"?[a-z_]'
          OR p.prosrc ~* 'realtime\.send|pg_notify')
$$;
