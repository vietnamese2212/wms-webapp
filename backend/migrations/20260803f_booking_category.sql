-- LOẠI KHO BOOKING (user chốt 03/08) — "cửa" mà xe đặt lịch, CHỈ dùng cho booking khung giờ.
--
-- Bối cảnh: 1 Số xe chở LẪN nhiều loại (FG01+PM01+FG02) nhưng chỉ đậu MỘT cửa. Trước đó picker
-- gộp khung giờ của MỌI loại xe đang chở ⇒ nguy cơ đặt SAI CỬA. Luật mới: kế hoạch phải KHAI
-- cửa, và 1 Số xe chỉ được 1 giá trị.
--
-- PHÂN VAI RÕ (đừng lẫn — chính chỗ lẫn này gây 2 lỗi trước):
--   · GroupDeliveryOrder.warehouse_type / TmsOrder.warehouse_type = các loại hàng xe CHỞ (chuỗi
--     ghép 'FG01+PM01') → dùng cho PHÂN QUYỀN + BỘ LỌC theo luật GIAO ≥1. GIỮ NGUYÊN.
--   · booking_category = cửa ĐẶT LỊCH, giá trị ĐƠN → dùng DUY NHẤT cho khớp khung giờ + gác đặt
--     lịch. KHÔNG cắt scope, KHÔNG lọc, KHÔNG đụng chính sách quét tem thùng.
--
-- Dòng cũ (null) = "chưa chốt cửa": app fallback về luật giao ≥1 như trước, có badge nhắc — không
-- khoá chết dữ liệu đã nạp trước khi có cột này.
ALTER TABLE khvc_lines  ADD COLUMN IF NOT EXISTS booking_category text;
ALTER TABLE "TmsOrder"  ADD COLUMN IF NOT EXISTS booking_category text;

COMMENT ON COLUMN khvc_lines.booking_category IS
  'Loại kho BOOKING (cửa đặt lịch) — 1 Số xe chỉ 1 giá trị (trigger gác). Chỉ dùng cho khung giờ.';
COMMENT ON COLUMN "TmsOrder".booking_category IS
  'Cửa đặt lịch dội từ khvc_lines.booking_category. Khớp khung giờ = booking_category hoặc cargo_type ALL.';

-- ── KHOÁ CỨNG Ở DB: 1 Số xe không thể có 2 loại kho booking khác nhau ────────────────────────
-- Gác ở tầng DB (không chỉ ở controller) vì còn đường ghi KHÁC form: upload Excel, script import,
-- API tích hợp — bài học biển số bẩn 30/07 (form chuẩn hoá từ lâu mà dữ liệu vẫn bẩn).
-- DISTINCT bỏ qua NULL ⇒ dòng cũ chưa chốt cửa KHÔNG làm upload mới đỏ oan; chỉ chặn 2 giá trị
-- KHÁC NHAU cùng tồn tại. AFTER STATEMENT + transition table để upsert lô 500 dòng chỉ kiểm 1 lần.
CREATE OR REPLACE FUNCTION khvc_booking_category_uniform() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE bad_gc text; vals text;
BEGIN
  SELECT l.group_code, string_agg(DISTINCT l.booking_category, ', ' ORDER BY l.booking_category)
    INTO bad_gc, vals
  FROM khvc_lines l
  WHERE l.group_code IN (SELECT DISTINCT group_code FROM newtab)
    AND l.sync_status <> 'OBSOLETE'
  GROUP BY l.group_code
  HAVING count(DISTINCT l.booking_category) > 1
  LIMIT 1;
  IF bad_gc IS NOT NULL THEN
    RAISE EXCEPTION '1 Số xe chỉ được 1 Loại kho booking — Số xe % đang có: %', bad_gc, vals
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

-- Postgres KHÔNG cho transition table trên trigger nhiều event ("INSERT OR UPDATE") ⇒ tách 2 trigger
-- dùng CHUNG một hàm.
DROP TRIGGER IF EXISTS trg_khvc_booking_category_uniform     ON khvc_lines;
DROP TRIGGER IF EXISTS trg_khvc_booking_category_uniform_ins ON khvc_lines;
DROP TRIGGER IF EXISTS trg_khvc_booking_category_uniform_upd ON khvc_lines;
CREATE TRIGGER trg_khvc_booking_category_uniform_ins
  AFTER INSERT ON khvc_lines
  REFERENCING NEW TABLE AS newtab
  FOR EACH STATEMENT EXECUTE FUNCTION khvc_booking_category_uniform();
CREATE TRIGGER trg_khvc_booking_category_uniform_upd
  AFTER UPDATE ON khvc_lines
  REFERENCING NEW TABLE AS newtab
  FOR EACH STATEMENT EXECUTE FUNCTION khvc_booking_category_uniform();
