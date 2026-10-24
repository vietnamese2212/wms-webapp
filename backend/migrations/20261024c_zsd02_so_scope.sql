-- 24/10/2026 — NẠP ZSD02 THEO SO (user chốt 24/10). Code: controllers/external/zsd02Controller.ts + services/dispatchPool.soScopedChanges.
-- Luật:
--   • MỌI tính toán với ZSD02 dùng NGÀY TẠO SO (file SAP lọc theo cột này — đo 4 file thật: mỗi lô một ngày tạo SO, DO tạo rải sau).
--   • SO có trong file = BẢN CUỐI của SO đó: dòng DO của SO đó vắng file ⇒ XOÁ MỀM (OBSOLETE, giữ dòng + lịch sử phiên bản).
--   • Hai kiểu nạp: LẺ (chỉ SO trong file) · BAO PHỦ (khai khoảng ngày tạo SO; phải chứa ngày tạo SO của mọi đơn CHƯA XUẤT của plant,
--     SO chưa xuất trong khoảng mà vắng file ⇒ SAP đã xoá).
--   • ĐÃ XUẤT chỉ tính theo APP (chuyến Xuất kho HOÀN THÀNH qua Kế hoạch xuất) — Mat Doc / post SAP không có ý nghĩa. Đơn đã xuất KHÔNG
--     bao giờ bị xoá mềm.
-- (1) erp_od_versions — mỗi lần một dòng DO SAP ĐỔI NGHIỆP VỤ (không tính raw / mốc giờ) thì chép bản CŨ (trừ raw) vào đây ⇒ truy vết.
-- (2) zsd02_upload_log — sổ các lần nạp ZSD02 (hộp upload hiện để người nạp biết đã nạp gì, lúc nào, kiểu nào).
-- (3) ods_shipped_in_app(text[]) — DO nào ĐÃ XUẤT theo app (một câu, danh sách đi POST body).
-- (4) zsd02_cover_gone(...) — dòng DO chưa xuất của SO tạo trong khoảng khai mà vắng file (nạp BAO PHỦ).
-- (5) zsd02_coverage — viết lại theo ngày tạo SO (bỏ ngày tạo OD, bỏ đếm "SAP đã post").
-- (6) archive_spec nhận erp_od_versions (nhóm sap_lines — cùng hạn giữ dòng SAP).
-- Idempotent.
BEGIN;

-- ── (1) LỊCH SỬ PHIÊN BẢN dòng DO SAP ──
CREATE TABLE IF NOT EXISTS public.erp_od_versions (
  id          uuid PRIMARY KEY,
  erp_id      text NOT NULL,
  od_number   text,
  od_item     text,
  so_number   text,
  changed_at  timestamptz NOT NULL,
  new_status  text,
  old_row     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_erp_od_versions_od ON public.erp_od_versions (od_number, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_od_versions_so ON public.erp_od_versions (so_number, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_od_versions_created ON public.erp_od_versions (created_at);
ALTER TABLE public.erp_od_versions ENABLE ROW LEVEL SECURITY;

-- Khoá nhiễu: mốc giờ / raw (bản chép SAP, dọn theo hạn giữ) / cờ sửa tay không phải thay đổi nghiệp vụ.
-- THEO LÔ (bảng chuyển tiếp, MỘT câu INSERT cho cả câu UPDATE / upsert) — không từng dòng: một lượt nạp ZSD02 ghi tới hàng chục nghìn dòng
-- (gói 00 [14d] gác trigger từng dòng ghi bảng khác — mẫu 20261011c). Bảng chuyển tiếp không đi cùng `UPDATE OF <cột>` ⇒ hàm tự lọc.
DROP TRIGGER IF EXISTS trg_erp_od_version ON public.erp_outbound_orders;
DROP FUNCTION IF EXISTS public.erp_od_version_capture();
CREATE OR REPLACE FUNCTION public.erp_od_version_capture_stmt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.erp_od_versions (id, erp_id, od_number, od_item, so_number, changed_at, new_status, old_row, updated_at)
  SELECT gen_random_uuid(), o.id, o.od_number, o.od_item, o.so_number, now(), n.sync_status, to_jsonb(o) - 'raw', now()
    FROM oldtab o JOIN newtab n ON n.id = o.id
   WHERE (to_jsonb(o) - 'raw' - 'updated_at' - 'last_synced_at' - 'manual_edited_at' - 'created_at')
         IS DISTINCT FROM (to_jsonb(n) - 'raw' - 'updated_at' - 'last_synced_at' - 'manual_edited_at' - 'created_at');
  RETURN NULL;
END $$;
CREATE TRIGGER trg_erp_od_version AFTER UPDATE ON public.erp_outbound_orders
  REFERENCING OLD TABLE AS oldtab NEW TABLE AS newtab FOR EACH STATEMENT EXECUTE FUNCTION public.erp_od_version_capture_stmt();

-- ── (2) SỔ CÁC LẦN NẠP ZSD02 ──
CREATE TABLE IF NOT EXISTS public.zsd02_upload_log (
  id            uuid PRIMARY KEY,
  uploaded_at   timestamptz NOT NULL,
  uploaded_by   text,
  file_name     text,
  kind          text NOT NULL CHECK (kind IN ('COVER', 'PARTIAL')),
  plants        text[] NOT NULL DEFAULT '{}',
  so_from       date,
  so_to         date,
  so_count      int NOT NULL DEFAULT 0,
  od_count      int NOT NULL DEFAULT 0,
  row_count     int NOT NULL DEFAULT 0,
  summary       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zsd02_upload_log_at ON public.zsd02_upload_log (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_zsd02_upload_log_plants ON public.zsd02_upload_log USING gin (plants);
ALTER TABLE public.zsd02_upload_log ENABLE ROW LEVEL SECURITY;

-- ── (3) ĐÃ XUẤT THEO APP: DO nằm trên Số xe của Kế hoạch xuất mà chuyến Xuất kho đã HOÀN THÀNH (cùng định nghĩa với zsd02_coverage) ──
CREATE OR REPLACE FUNCTION public.ods_shipped_in_app(p_ods text[]) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT k.do_no), '{}')
    FROM public.khvc_lines k JOIN public."GroupDeliveryOrder" g ON g.id = k.gdo_id
   WHERE k.do_no = ANY (p_ods) AND k.sync_status IS DISTINCT FROM 'OBSOLETE' AND g.status = 'COMPLETED'
$$;

-- ── (4) NẠP BAO PHỦ: dòng DO CHƯA XUẤT của SO tạo trong khoảng khai, thuộc plant của file, mà SO vắng file ⇒ SAP đã xoá SO ──
CREATE OR REPLACE FUNCTION public.zsd02_cover_gone(p_plants text[], p_from date, p_to date, p_file_sos text[]) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH cand AS (
    SELECT e.id, e.od_number, e.od_item, e.so_number
      FROM public.erp_outbound_orders e
     WHERE e.plant = ANY (p_plants) AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
       AND e.so_created_at BETWEEN p_from AND p_to
       AND NOT (e.so_number = ANY (p_file_sos))
  ), shipped AS (
    SELECT DISTINCT k.do_no FROM public.khvc_lines k JOIN public."GroupDeliveryOrder" g ON g.id = k.gdo_id
     WHERE k.do_no IN (SELECT od_number FROM cand) AND k.sync_status IS DISTINCT FROM 'OBSOLETE' AND g.status = 'COMPLETED'
  )
  SELECT jsonb_build_object(
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'od_number', c.od_number, 'od_item', c.od_item, 'so_number', c.so_number))
                         FROM cand c WHERE c.od_number NOT IN (SELECT do_no FROM shipped)), '[]'::jsonb),
    'kept_shipped', (SELECT count(DISTINCT c.od_number) FROM cand c WHERE c.od_number IN (SELECT do_no FROM shipped))
  )
$$;

-- ── (5) NGÀY TẠO SO CẦN PHỦ khi nạp BAO PHỦ — đơn CHƯA XUẤT theo app (còn hiệu lực · lên xe được · chưa có chuyến Xuất kho HOÀN THÀNH ·
--        chưa mang dấu Ngoài app). Bản 03/10 tính theo ngày tạo OD + đếm "SAP đã post" — bỏ cả hai (user chốt 24/10). ──
--        Khoá cũ by_od_created / sap_posted_ods / sap_max_od_created giữ lại để bản app đang chạy (trước khi deploy) không gãy giữa chừng;
--        code mới không đọc chúng.
CREATE OR REPLACE FUNCTION public.zsd02_coverage(p_plant text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH od AS (
    SELECT e.od_number, min(e.so_created_at) AS soc, min(e.so_number) AS so_number, min(e.od_created_at) AS odc,
           bool_or(e.mat_doc IS NOT NULL OR coalesce(e.qty_issued_base, 0) > 0) AS sap_posted
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
       AND e.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET')
       AND NOT EXISTS (SELECT 1 FROM public.khvc_lines k JOIN public."GroupDeliveryOrder" g ON g.id = k.gdo_id
                        WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE' AND g.status = 'COMPLETED')
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_outside x JOIN public."Warehouse" w ON w.id = x.warehouse_id
                        WHERE x.od_number = e.od_number AND w.sap_plant = p_plant)
     GROUP BY e.od_number)
  SELECT jsonb_build_object(
    'pending_ods', (SELECT count(*) FROM od),
    'no_so_date', (SELECT count(*) FROM od WHERE soc IS NULL),
    'no_so_date_ods', (SELECT coalesce(jsonb_agg(x.od_number ORDER BY x.od_number), '[]'::jsonb) FROM (SELECT od_number FROM od WHERE soc IS NULL ORDER BY od_number LIMIT 20) x),
    'by_so_created', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', x.soc, 'ods', x.n) ORDER BY x.soc), '[]'::jsonb)
                        FROM (SELECT soc, count(*) AS n FROM od WHERE soc IS NOT NULL GROUP BY soc) x),
    'oldest', (SELECT jsonb_agg(jsonb_build_object('od_number', x.od_number, 'so_number', x.so_number, 'so_created', x.soc) ORDER BY x.soc, x.od_number)
                 FROM (SELECT * FROM od WHERE soc IS NOT NULL ORDER BY soc, od_number LIMIT 5) x),
    'sap_posted_ods', (SELECT count(*) FROM od WHERE sap_posted),
    'no_created_date', (SELECT count(*) FROM od WHERE odc IS NULL),
    'by_od_created', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', x.odc, 'ods', x.n) ORDER BY x.odc), '[]'::jsonb)
                        FROM (SELECT odc, count(*) AS n FROM od WHERE odc IS NOT NULL GROUP BY odc) x),
    'sap_max_od_created', (SELECT max(od_created_at) FROM public.erp_outbound_orders WHERE plant = p_plant AND sync_status = 'ACTIVE')
  )
$$;

-- ── (6) Lưu trữ theo hạn giữ: lịch sử phiên bản đi cùng nhóm dòng SAP ──
CREATE OR REPLACE FUNCTION public.archive_spec(p_table text, OUT time_col text, OUT cond text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  CASE p_table
    WHEN 'outbound_events'     THEN time_col := 'created_at';  cond := $c$event_type NOT IN ('QTY_REDUCED', 'QTY_REDUCED_TO_ACTUAL')$c$;  -- service_level dựng nhu cầu gốc từ đây
    WHEN 'admin_audit_events'  THEN time_col := 'created_at';  cond := 'true';
    WHEN 'alert_events'        THEN time_col := 'resolved_at'; cond := 'resolved_at IS NOT NULL';                                     -- chỉ cảnh báo đã đóng
    WHEN 'erp_outbound_orders' THEN time_col := 'created_at';  cond := 'true';
    WHEN 'erp_so_lines'        THEN time_col := 'created_at';  cond := 'true';
    WHEN 'erp_od_versions'     THEN time_col := 'created_at';  cond := 'true';
    ELSE RAISE EXCEPTION 'ARCHIVE_TABLE_NOT_ALLOWED: %', p_table;
  END CASE;
END $$;

-- Công tắc cũ "zsd02_coverage_mode" (Nhắc / Bắt buộc) hết nghĩa: kiểu nạp BAO PHỦ luôn bắt buộc phủ, LẺ không kiểm phủ.
DELETE FROM public."SystemSetting" WHERE key = 'zsd02_coverage_mode';

COMMIT;
