-- 11/10/2026 — Trigger giữ cờ `erp_outbound_orders.in_khvc` chạy THEO LÔ thay vì TỪNG DÒNG (user "giải quyết 2 vấn đề cho rõ":
-- Mở lại 150 xe / lô lúc 12:02 trả 503 quá hạn mà không truy được câu nào).
--
-- Đo staging 11/10 (BEGIN … EXPLAIN ANALYZE … ROLLBACK, 150 Số xe × ~3 OD = 460 dòng Kế hoạch xuất, OD thật Ba Vì):
--   xoá 460 dòng (đúng câu trong RPC dispatch_reopen_trips): trigger trg_khvc_sync_erp_in_khvc 2.134 ms / 460 lần gọi — tức là
--   MỘT câu xoá hoá thành 460 câu UPDATE erp_outbound_orders + 460 lần realtime.send (trg_wms_notify của bảng ZSD02 nổ theo từng
--   câu con); ghi 460 dòng (Xác nhận): 2.714 ms. Cache nguội + I/O NANO là chạm trần statement_timeout 8 s của PostgREST ⇒ 503.
--   Bản theo lô (bảng chuyển tiếp, MỘT câu UPDATE cho cả lô): xoá 786 ms · ghi 1.810 ms · đổi sync_status 22 ms · đổi DO 18 ms;
--   erp_in_khvc_mismatch() = 0 sau mỗi bước. Phần còn lại là chi phí thật: lật ~3.400 dòng ZSD02 rộng 1,7 KB (7 dòng/OD) + 9 chỉ mục.
--
-- Nghĩa KHÔNG đổi: cờ = "OD đang có dòng Kế hoạch xuất không OBSOLETE" (erp_in_khvc_of), tính lại cho OD cũ lẫn OD mới của lô.
-- Bảng chuyển tiếp không đi cùng `UPDATE OF <cột>` ⇒ trigger UPDATE bắt mọi cột, hàm tự lọc dòng đổi do_no / sync_status.
-- Lên production: áp bất kỳ lúc nào (thay trigger, không đổi dữ liệu; idempotent).
BEGIN;

CREATE OR REPLACE FUNCTION public.khvc_sync_erp_in_khvc_stmt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ods text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.do_no) INTO ods FROM newtab n;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.do_no) INTO ods FROM oldtab o;
  ELSE
    SELECT array_agg(DISTINCT u.do_no) INTO ods
      FROM (SELECT o.do_no FROM oldtab o JOIN newtab n ON n.id = o.id
             WHERE o.do_no IS DISTINCT FROM n.do_no OR o.sync_status IS DISTINCT FROM n.sync_status
            UNION
            SELECT n.do_no FROM newtab n JOIN oldtab o ON o.id = n.id
             WHERE o.do_no IS DISTINCT FROM n.do_no OR o.sync_status IS DISTINCT FROM n.sync_status) u;
  END IF;
  IF ods IS NULL THEN RETURN NULL; END IF;
  UPDATE public.erp_outbound_orders e SET in_khvc = v.flag
    FROM (SELECT x.od, public.erp_in_khvc_of(x.od) AS flag FROM unnest(ods) AS x(od)) v
   WHERE e.od_number = v.od AND e.in_khvc IS DISTINCT FROM v.flag;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_khvc_sync_erp_in_khvc ON public.khvc_lines;
DROP TRIGGER IF EXISTS trg_khvc_sync_erp_in_khvc_ins ON public.khvc_lines;
DROP TRIGGER IF EXISTS trg_khvc_sync_erp_in_khvc_del ON public.khvc_lines;
DROP TRIGGER IF EXISTS trg_khvc_sync_erp_in_khvc_upd ON public.khvc_lines;
CREATE TRIGGER trg_khvc_sync_erp_in_khvc_ins AFTER INSERT ON public.khvc_lines
  REFERENCING NEW TABLE AS newtab FOR EACH STATEMENT EXECUTE FUNCTION public.khvc_sync_erp_in_khvc_stmt();
CREATE TRIGGER trg_khvc_sync_erp_in_khvc_del AFTER DELETE ON public.khvc_lines
  REFERENCING OLD TABLE AS oldtab FOR EACH STATEMENT EXECUTE FUNCTION public.khvc_sync_erp_in_khvc_stmt();
CREATE TRIGGER trg_khvc_sync_erp_in_khvc_upd AFTER UPDATE ON public.khvc_lines
  REFERENCING OLD TABLE AS oldtab NEW TABLE AS newtab FOR EACH STATEMENT EXECUTE FUNCTION public.khvc_sync_erp_in_khvc_stmt();

-- hàm từng dòng cũ không còn trigger nào dùng
DROP FUNCTION IF EXISTS public.khvc_sync_erp_in_khvc();

COMMIT;
