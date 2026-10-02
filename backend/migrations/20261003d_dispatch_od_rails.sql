-- 03/10/2026 — RÀO CỨNG chống một đơn đi hai ngày + phả hệ DO + dấu "Ngoài app" + RPC "ngày tạo cần phủ" của ZSD02.
-- User chốt 03/10: "sai sót kiểu double 2 lần cho kế hoạch đi hàng các ngày khác nhau ⇒ hậu quả nghiêm trọng" — chặn bằng MÁY ở DB,
-- không trông vào code kiểm trước ghi (ba cửa cùng ghi khvc_lines: Xác nhận điều vận · thêm tay · Excel; đua là lọt).
-- Thiết kế: docs/plans/DISPATCH_OD_LIFECYCLE_2026-10-03.md.
BEGIN;

-- ── 1. PHẢ HỆ DO (SAP xoá DO cũ, sinh DO mới cho cùng SO Item: thay 1→1 · tách 1→N · gộp N→1 · tạo lại sau khi đã post) ──
-- Số DO hay đổi, SO Item ổn định. Rào chống trùng kiểm trên CẢ HỌ (mọi DO nối nhau qua bảng này) chứ không chỉ số DO,
-- vì DO 3 tách từ DO 1 đã đi hôm qua mà lên bàn hôm nay như đơn sạch chính là đường dẫn tới xuất hai lần.
-- `resolved_*`: người đã xử lý quan hệ này (Đổi số DO trên chuyến · Xác nhận đơn bổ sung · Ngoài app) ⇒ rào không xét cạnh đó nữa.
CREATE TABLE IF NOT EXISTS public.od_lineage (
  id           uuid PRIMARY KEY,
  so_number    text,
  so_item      text,
  old_od       text NOT NULL,
  new_od       text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('REPLACE', 'SPLIT', 'MERGE', 'PARTIAL', 'AFTER_POST')),
  qty_old      numeric,
  qty_new      numeric,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  source       text,
  resolved_at  timestamptz,
  resolved_by  text,
  resolution   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL,
  CHECK (old_od <> new_od)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_od_lineage ON public.od_lineage (old_od, new_od);
CREATE INDEX IF NOT EXISTS idx_od_lineage_new ON public.od_lineage (new_od);
ALTER TABLE public.od_lineage ENABLE ROW LEVEL SECURITY;

-- ── 2. DẤU "NGOÀI APP" — người xác nhận đơn đã được xử lý ngoài bàn này (điều tay · trước khi dùng app · SAP tự gắn xe) ──
-- Dấu tay của người, không phải cờ SAP. Đơn mang dấu rời tab Điều, không tính vào "ngày tạo cần phủ", bỏ dấu được.
CREATE TABLE IF NOT EXISTS public.dispatch_od_outside (
  id           uuid PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES public."Warehouse"(id) ON DELETE CASCADE,
  od_number    text NOT NULL,
  reason       text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_od_outside ON public.dispatch_od_outside (warehouse_id, od_number);
ALTER TABLE public.dispatch_od_outside ENABLE ROW LEVEL SECURITY;

-- ── 3. HỌ HÀNG của một DO qua phả hệ chưa giải quyết (đệ quy hai chiều, UNION khử vòng) ──
CREATE OR REPLACE FUNCTION public.od_family(p_od text) RETURNS text[]
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE fam(od) AS (
    SELECT p_od
    UNION
    SELECT CASE WHEN l.old_od = f.od THEN l.new_od ELSE l.old_od END
    FROM fam f JOIN public.od_lineage l ON (l.old_od = f.od OR l.new_od = f.od) AND l.resolved_at IS NULL
  )
  SELECT coalesce(array_agg(od), ARRAY[p_od]) FROM fam
$$;

-- ── 4. RÀO 1: một DO (hoặc họ hàng) chỉ ở MỘT ngày xuất còn hiệu lực trong sổ Kế hoạch xuất ──
-- Cùng ngày, khác Số xe thì CHO (máy tách một OD vượt tải lên hai xe cùng ngày). Khác ngày là từ chối, kể cả chuyến ngày kia đã
-- hoàn thành (đó chính là ca xuất hai lần). Chuyến bị HUỶ không giữ chỗ. ERRCODE 23505 để pgUserError dịch thành 409; thông điệp
-- có tiền tố MÃ_LỖI: để backend trả đúng mã cho người dùng (xem utils/response.ts).
CREATE OR REPLACE FUNCTION public.khvc_one_export_day() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fam text[];
  hit record;
BEGIN
  IF NEW.sync_status = 'OBSOLETE' OR NEW.export_date IS NULL OR NEW.do_no IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.do_no = OLD.do_no AND NEW.export_date IS NOT DISTINCT FROM OLD.export_date
     AND OLD.sync_status IS DISTINCT FROM 'OBSOLETE' THEN RETURN NEW; END IF;
  fam := public.od_family(NEW.do_no);
  SELECT k.do_no, k.group_code, k.export_date INTO hit
    FROM public.khvc_lines k
    LEFT JOIN public."GroupDeliveryOrder" g ON g.id = k.gdo_id
   WHERE k.do_no = ANY (fam)
     AND k.id <> NEW.id
     AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
     AND k.export_date IS NOT NULL
     AND k.export_date <> NEW.export_date
     AND (g.id IS NULL OR g.status <> 'CANCELLED')
   ORDER BY k.export_date
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'OD_ALREADY_PLANNED: DO % đã ở Kế hoạch xuất ngày % (xe %)% — một đơn chỉ đi một ngày; gỡ bên kia trước (có nhật ký) rồi mới đưa vào ngày này',
      hit.do_no, to_char(hit.export_date, 'DD/MM/YYYY'), hit.group_code,
      CASE WHEN hit.do_no <> NEW.do_no THEN format(' — cùng họ với DO %s', NEW.do_no) ELSE '' END
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_khvc_one_export_day ON public.khvc_lines;
CREATE TRIGGER trg_khvc_one_export_day BEFORE INSERT OR UPDATE ON public.khvc_lines
  FOR EACH ROW EXECUTE FUNCTION public.khvc_one_export_day();

-- ── 5. RÀO 2: một OD (hoặc họ hàng) không lên XE ở hai kế hoạch điều vận đang mở; lên xe ở đâu thì rời khung chờ của nơi khác ──
-- Khung chờ (trip_id NULL) là TỰ DO — nhiều nháp cùng thấy một đơn chưa ai xếp (user 03/10: 283 đơn bị nháp 30/09 "giữ" dù chưa
-- lên xe nào). Khoá chỉ bắt đầu khi đơn lên xe. Cùng kế hoạch thì không xét (máy tách một OD lên hai xe cùng kế hoạch).
CREATE OR REPLACE FUNCTION public.dispatch_od_one_open_vehicle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fam text[];
  hit record;
BEGIN
  IF NEW.trip_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.trip_id IS NOT DISTINCT FROM OLD.trip_id AND NEW.od_number = OLD.od_number THEN RETURN NEW; END IF;
  fam := public.od_family(NEW.od_number);
  SELECT o.od_number, p.plan_date, p.created_by, t.seq INTO hit
    FROM public.dispatch_trip_od o
    JOIN public.dispatch_plan p ON p.id = o.plan_id
    JOIN public.dispatch_trip t ON t.id = o.trip_id
   WHERE o.od_number = ANY (fam)
     AND o.plan_id <> NEW.plan_id
     AND o.trip_id IS NOT NULL
     AND p.status IN ('DRAFT', 'TENDERED')
     AND t.status <> 'DISCARDED'
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'OD_ON_OTHER_PLAN: DO % đang xếp trên xe #% của nháp ngày % (%)% — "Kéo về đây" ở tab Đang xếp nơi khác, hoặc bên kia gỡ trước',
      hit.od_number, hit.seq, to_char(hit.plan_date, 'DD/MM/YYYY'), coalesce(hit.created_by, '?'),
      CASE WHEN hit.od_number <> NEW.od_number THEN format(' — cùng họ với DO %s', NEW.od_number) ELSE '' END
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dispatch_od_one_open_vehicle ON public.dispatch_trip_od;
CREATE TRIGGER trg_dispatch_od_one_open_vehicle BEFORE INSERT OR UPDATE OF trip_id, od_number ON public.dispatch_trip_od
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_od_one_open_vehicle();

-- Đơn vừa lên xe ở kế hoạch này ⇒ rời khung chờ của mọi kế hoạch đang mở khác (không thì hai bàn cùng thấy nó "chờ").
CREATE OR REPLACE FUNCTION public.dispatch_od_leave_other_pools() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trip_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.trip_id IS NOT NULL THEN RETURN NEW; END IF;
  DELETE FROM public.dispatch_trip_od o
   USING public.dispatch_plan p
   WHERE o.plan_id = p.id AND o.plan_id <> NEW.plan_id AND o.trip_id IS NULL
     AND o.od_number = ANY (public.od_family(NEW.od_number))
     AND p.status IN ('DRAFT', 'TENDERED');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dispatch_od_leave_other_pools ON public.dispatch_trip_od;
CREATE TRIGGER trg_dispatch_od_leave_other_pools AFTER INSERT OR UPDATE OF trip_id ON public.dispatch_trip_od
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_od_leave_other_pools();

-- ── 6. NGÀY TẠO CẦN PHỦ khi đổ ZSD02 (user 03/10: "app biết đơn nào còn pending ⇒ bắt buộc file phải có ngày tạo của chúng") ──
-- Đơn CHƯA ĐI theo lịch sử app = còn hiệu lực · lên xe được · chưa có chuyến Xuất kho HOÀN THÀNH · chưa mang dấu Ngoài app.
-- Gồm cả đơn ở tab Điều chưa ai đụng (SAP sửa tuần trước mà hôm nay người ghép theo số cũ vẫn là sai). Tính bằng SQL, không kéo dòng.
CREATE OR REPLACE FUNCTION public.zsd02_coverage(p_plant text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH od AS (
    SELECT e.od_number, min(e.od_created_at) AS odc, min(e.so_created_at) AS soc,
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
    'sap_posted_ods', (SELECT count(*) FROM od WHERE sap_posted),
    'no_created_date', (SELECT count(*) FROM od WHERE odc IS NULL),
    'by_od_created', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', x.odc, 'ods', x.n) ORDER BY x.odc), '[]'::jsonb)
                        FROM (SELECT odc, count(*) AS n FROM od WHERE odc IS NOT NULL GROUP BY odc) x),
    'by_so_created', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', x.soc, 'ods', x.n) ORDER BY x.soc), '[]'::jsonb)
                        FROM (SELECT soc, count(*) AS n FROM od WHERE soc IS NOT NULL GROUP BY soc) x),
    'sap_max_od_created', (SELECT max(od_created_at) FROM public.erp_outbound_orders WHERE plant = p_plant AND sync_status = 'ACTIVE')
  )
$$;

-- ── 7. Đơn QUÁ cửa sổ tồn đọng mà chưa ai quyết (không rớt im lặng — băng đỏ trên Xem đơn) ──
CREATE OR REPLACE FUNCTION public.dispatch_stale_ods(p_plant text, p_warehouse_id text, p_before date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH od AS (
    SELECT e.od_number, min(e.delivery_date) AS dd, min(e.od_created_at) AS odc, min(e.ship_to_code) AS ship_to_code, min(e.ship_to_name) AS ship_to_name,
           sum(coalesce(e.sap_pallets, 0)) AS sap_pallets, bool_or(e.mat_doc IS NOT NULL OR coalesce(e.qty_issued_base, 0) > 0) AS sap_posted
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND e.delivery_date < p_before
       AND e.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET')
       AND NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_outside x WHERE x.od_number = e.od_number AND x.warehouse_id = p_warehouse_id)
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.od_number = e.od_number AND h.warehouse_id = p_warehouse_id)
     GROUP BY e.od_number)
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM od),
    'rows', (SELECT coalesce(jsonb_agg(to_jsonb(od) ORDER BY od.dd, od.od_number), '[]'::jsonb) FROM (SELECT * FROM od ORDER BY dd, od_number LIMIT 500) od)
  )
$$;

COMMIT;
