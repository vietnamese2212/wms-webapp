-- ============================================================================
-- 20261026e — NHẬP TRẢ VỀ đợt 2 (user chốt 26/10 tối)
-- ============================================================================
--   • LÝ DO TRẢ thành DANH MỤC (LookupValue type 'return_reason': value = mã · meta.label = tên · meta.requires_recall
--     = bắt chọn đợt thu hồi). Ô `inbound_return.reason` cũ thành GHI CHÚ (không bắt buộc).
--   • ĐỢT THU HỒI `recall_campaign`: duyệt NGOÀI app, người có quyền tạo MÃ ĐỢT dạng chữ; phiếu trả lý do có
--     requires_recall phải chọn đợt đang MỞ. Gắn cho cả phiếu RT (inbound_return.recall_id) lẫn phiếu NPP chuyển về
--     (ProductionImport.recall_id — phiếu TF từ kho loại NPP).
--   • HÀNG THỪA: `inbound_return_scan.surplus` — phần nhận VƯỢT số tem đã xuất trên chuyến gốc. Truy xuất lô KHÔNG trừ
--     phần thừa khỏi "đã giao khách" (lot_trace ở 20261026f).
--   • THỐNG KÊ: RPC `inbound_return_report` (mỗi dòng một phiếu: RT hoặc một chuyến NPP chuyển về) + `recall_breakdown`.
--   • Quyền mới `inbound.export` · `inbound.recall_manage` — cấp theo năng lực sẵn có.
-- ============================================================================
BEGIN;

-- ── Danh mục lý do trả (mặc định user đồng ý 26/10) ──
INSERT INTO public."LookupValue" (type, value, sort_order, meta, created_by, updated_by)
SELECT 'return_reason', v.code, v.ord, v.meta, 'migration', 'migration'
FROM (VALUES
  ('TU_CHOI',   1, '{"label":"Khách từ chối"}'::jsonb),
  ('HU_HONG',   2, '{"label":"Hàng hư hỏng"}'::jsonb),
  ('DATE_THAP', 3, '{"label":"Date thấp"}'::jsonb),
  ('GIAO_NHAM', 4, '{"label":"Giao nhầm"}'::jsonb),
  ('THUA',      5, '{"label":"Thừa / không rõ đơn"}'::jsonb),
  ('THU_HOI',   6, '{"label":"Thu hồi","requires_recall":true}'::jsonb)
) AS v(code, ord, meta)
ON CONFLICT (type, value) DO NOTHING;

-- ── Đợt thu hồi ──
CREATE TABLE IF NOT EXISTS public.recall_campaign (
  id              text PRIMARY KEY,
  code            text NOT NULL UNIQUE CHECK (length(btrim(code)) BETWEEN 1 AND 60),
  name            text CHECK (name IS NULL OR length(name) <= 200),
  note            text CHECK (note IS NULL OR length(note) <= 500),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_by      text REFERENCES public."Employee"(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL,
  closed_at       timestamptz
);
ALTER TABLE public.recall_campaign ENABLE ROW LEVEL SECURITY;

-- ── Phiếu trả RT: lý do theo danh mục + đợt; `reason` cũ = ghi chú ──
ALTER TABLE public.inbound_return ADD COLUMN IF NOT EXISTS reason_code text;
ALTER TABLE public.inbound_return ADD COLUMN IF NOT EXISTS recall_id text REFERENCES public.recall_campaign(id) ON DELETE RESTRICT;
ALTER TABLE public.inbound_return ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE public.inbound_return DROP CONSTRAINT IF EXISTS inbound_return_reason_check;
ALTER TABLE public.inbound_return ADD CONSTRAINT inbound_return_reason_check CHECK (reason IS NULL OR length(reason) <= 500);
CREATE INDEX IF NOT EXISTS idx_inbound_return_recall ON public.inbound_return (recall_id) WHERE recall_id IS NOT NULL;

-- ── Phiếu NPP chuyển về (TF từ kho loại NPP): gắn lý do / ghi chú / đợt trên phiếu nhập ──
ALTER TABLE public."ProductionImport" ADD COLUMN IF NOT EXISTS return_reason_code text;
ALTER TABLE public."ProductionImport" ADD COLUMN IF NOT EXISTS return_note text CHECK (return_note IS NULL OR length(return_note) <= 500);
ALTER TABLE public."ProductionImport" ADD COLUMN IF NOT EXISTS recall_id text REFERENCES public.recall_campaign(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_import_recall ON public."ProductionImport" (recall_id) WHERE recall_id IS NOT NULL;

-- ── Hàng thừa ──
ALTER TABLE public.inbound_return_scan ADD COLUMN IF NOT EXISTS surplus boolean NOT NULL DEFAULT false;

-- ── Quyền: export ← inbound.view ∧ inventory.export (mang dữ liệu ra là quyền RIÊNG) · recall_manage ← inbound.force_edit_pallet
--    (người quản kho nhập — tạo mã đợt đã duyệt ngoài app). Chỉ THÊM action còn thiếu, không đè. ──
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{inbound}',
         (j.module_permissions->'inbound')
         || CASE WHEN (j.module_permissions->'inventory' ? 'export') AND NOT (j.module_permissions->'inbound' ? 'export')
                 THEN '["export"]'::jsonb ELSE '[]'::jsonb END
         || CASE WHEN (j.module_permissions->'inbound' ? 'force_edit_pallet') AND NOT (j.module_permissions->'inbound' ? 'recall_manage')
                 THEN '["recall_manage"]'::jsonb ELSE '[]'::jsonb END),
       updated_at = now()
 WHERE jsonb_typeof(j.module_permissions->'inbound') = 'array'
   AND (j.module_permissions->'inbound' ? 'view')
   AND (((j.module_permissions->'inventory' ? 'export') AND NOT (j.module_permissions->'inbound' ? 'export'))
        OR ((j.module_permissions->'inbound' ? 'force_edit_pallet') AND NOT (j.module_permissions->'inbound' ? 'recall_manage')));

-- ── THỐNG KÊ HÀNG TRẢ VỀ: mỗi dòng một PHIẾU — RT (inbound_return) hoặc NPP chuyển về (các phiếu TF cùng chuyến NPP).
--    Số cộng nhiều mã = thùng QUY ĐỔI từng mã trước khi cộng (luật base unit). ──
CREATE OR REPLACE FUNCTION public.inbound_return_report(
  p_wh_ids text[] DEFAULT NULL, p_cats text[] DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
  p_kind text DEFAULT NULL, p_reason text DEFAULT NULL, p_recall_id text DEFAULT NULL, p_search text DEFAULT NULL,
  p_limit integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v jsonb;
BEGIN
WITH imp AS (
  SELECT pi.id, pi.warehouse_id, pi.warehouse_type, pi.status, pi.source_type, pi.return_id, pi.from_gdo_id, pi.planned_cartons,
         pi.posm_cartons, pi.posm_entry_id, pi.import_date, pi.created_at, pi.return_reason_code, pi.return_note, pi.recall_id,
         m.material_code, m.entry_unit, m.units_per_carton,
         CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> '' AND COALESCE(m.units_per_carton, 0) > 0
              THEN m.units_per_carton::numeric ELSE 1 END AS f
  FROM "ProductionImport" pi
  LEFT JOIN "Material" m ON m.id = pi.material_id
  WHERE pi.status <> 'CANCELLED'
    AND (pi.source_type = 'RETURN'
         OR (pi.source_type = 'TRANSFER' AND EXISTS (
               SELECT 1 FROM "GroupDeliveryOrder" g JOIN "Warehouse" w ON w.id = g.warehouse_id
               WHERE g.id = pi.from_gdo_id AND w.warehouse_type = 'NPP')))
    AND (p_wh_ids IS NULL OR pi.warehouse_id = ANY (p_wh_ids))
    AND (p_cats IS NULL OR pi.warehouse_type IS NULL OR pi.warehouse_type = ANY (p_cats))
),
recv AS (   -- thực nhận: phiếu RT = SỔ NHẬN TRẢ (gồm cả phần cộng dồn vào tem còn tồn — không sinh dòng tồn của phiếu);
            -- phiếu TF = dòng tồn của phiếu + phần lưu thủ công vào tồn chung
  SELECT i.id,
         CASE WHEN i.source_type = 'RETURN'
              THEN COALESCE((SELECT SUM(s.qty_base) FROM inbound_return_scan s WHERE s.import_order_id = i.id), 0)
              ELSE COALESCE((SELECT SUM(ie.cartons_imported) FROM "InventoryEntry" ie
                             WHERE ie.import_order_id = i.id AND ie.pallet_code IS DISTINCT FROM i.material_code), 0) + COALESCE(i.posm_cartons, 0)
         END AS qty,
         (SELECT COUNT(*) FROM "InventoryEntry" ie JOIN "QAStatus" q ON q.id = ie.qa_status_id
           WHERE ie.import_order_id = i.id AND ie.cartons_remaining > 0 AND q.code <> 'OK') AS held
  FROM imp i
),
sur AS (
  SELECT s.import_order_id AS id, SUM(s.qty_base) AS qty FROM inbound_return_scan s
  WHERE s.surplus AND s.import_order_id IN (SELECT id FROM imp) GROUP BY 1
),
per_imp AS (
  SELECT i.*, r.qty AS recv_base, r.held, COALESCE(su.qty, 0) AS surplus_base
  FROM imp i JOIN recv r ON r.id = i.id LEFT JOIN sur su ON su.id = i.id
),
rows_rt AS (
  SELECT 'RT'::text AS kind, h.id, h.return_code AS code, (h.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, h.created_at AS at,
         h.warehouse_id, h.group_code AS trip, h.gdo_id, h.ship_to_name AS party, h.reason_code, h.reason AS note, h.recall_id, h.created_by_name AS by_name,
         COUNT(p.id) AS n_mat,
         ROUND(SUM(COALESCE(p.planned_cartons, 0) / p.f), 3) AS declared,
         ROUND(SUM(p.recv_base / p.f), 3) AS received,
         ROUND(SUM(p.surplus_base / p.f), 3) AS surplus,
         SUM(p.held) AS held_pallets,
         BOOL_AND(p.status = 'COMPLETED') AS done,
         MIN(p.material_code) AS any_mat, COUNT(DISTINCT p.material_code) AS n_codes,
         (array_agg(p.id ORDER BY p.material_code, p.id))[1] AS first_import   -- bấm dòng ⇒ mở phiếu nhập
  FROM inbound_return h JOIN per_imp p ON p.return_id = h.id
  GROUP BY h.id
),
rows_npp AS (
  SELECT 'NPP'::text AS kind, g.id, g.group_code AS code, MIN(p.import_date)::date AS day, MIN(p.created_at)::timestamptz AS at,
         MIN(p.warehouse_id) AS warehouse_id, g.group_code AS trip, g.id AS gdo_id, w.name AS party,
         MAX(p.return_reason_code) AS reason_code, MAX(p.return_note) AS note, MAX(p.recall_id) AS recall_id, NULL::text AS by_name,
         COUNT(p.id) AS n_mat,
         ROUND(SUM(COALESCE(p.planned_cartons, 0) / p.f), 3) AS declared,
         ROUND(SUM(p.recv_base / p.f), 3) AS received,
         0::numeric AS surplus,
         SUM(p.held) AS held_pallets,
         BOOL_AND(p.status = 'COMPLETED') AS done,
         MIN(p.material_code) AS any_mat, COUNT(DISTINCT p.material_code) AS n_codes,
         (array_agg(p.id ORDER BY p.material_code, p.id))[1] AS first_import
  FROM per_imp p JOIN "GroupDeliveryOrder" g ON g.id = p.from_gdo_id JOIN "Warehouse" w ON w.id = g.warehouse_id
  WHERE p.source_type = 'TRANSFER'
  GROUP BY g.id, w.name
),
allrows AS (SELECT * FROM rows_rt UNION ALL SELECT * FROM rows_npp),
f AS (
  SELECT a.* FROM allrows a
  WHERE (p_kind IS NULL OR a.kind = p_kind)
    AND (p_from IS NULL OR a.day >= p_from) AND (p_to IS NULL OR a.day <= p_to)
    AND (p_reason IS NULL OR (p_reason = '__NONE__' AND a.reason_code IS NULL) OR a.reason_code = p_reason)
    AND (p_recall_id IS NULL OR a.recall_id = p_recall_id)
    AND (p_search IS NULL OR a.code ILIKE '%' || p_search || '%' OR a.party ILIKE '%' || p_search || '%' OR a.trip ILIKE '%' || p_search || '%')
)
SELECT jsonb_build_object(
  'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'at' ORDER BY x.at DESC, x.code) FROM (SELECT * FROM f ORDER BY at DESC, code LIMIT p_limit) x), '[]'::jsonb),
  'total', (SELECT count(*) FROM f),
  'summary', jsonb_build_object(
    'phieu', (SELECT count(*) FROM f), 'rt', (SELECT count(*) FROM f WHERE kind = 'RT'), 'npp', (SELECT count(*) FROM f WHERE kind = 'NPP'),
    'declared', COALESCE((SELECT SUM(declared) FROM f), 0), 'received', COALESCE((SELECT SUM(received) FROM f), 0),
    'surplus', COALESCE((SELECT SUM(surplus) FROM f), 0), 'held_pallets', COALESCE((SELECT SUM(held_pallets) FROM f), 0),
    'open', (SELECT count(*) FROM f WHERE NOT done), 'no_reason', (SELECT count(*) FROM f WHERE reason_code IS NULL))
) INTO v;
RETURN v;
END;
$function$;

-- ── Một đợt thu hồi: đã thu theo KHÁCH / NPP và theo MÃ (base + quy cách để FE in "N thùng + M hộp") ──
CREATE OR REPLACE FUNCTION public.recall_breakdown(p_recall_id text, p_wh_ids text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
AS $function$
WITH imp AS (
  SELECT pi.id, pi.material_id, pi.posm_cartons, pi.source_type, m.material_code,
         COALESCE(h.ship_to_name, w.name, '—') AS party,
         COALESCE(h.return_code, g.group_code) AS phieu
  FROM "ProductionImport" pi
  LEFT JOIN inbound_return h ON h.id = pi.return_id
  LEFT JOIN "GroupDeliveryOrder" g ON g.id = pi.from_gdo_id AND pi.return_id IS NULL
  LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
  LEFT JOIN "Material" m ON m.id = pi.material_id
  WHERE pi.status <> 'CANCELLED' AND COALESCE(h.recall_id, pi.recall_id) = p_recall_id
    AND (p_wh_ids IS NULL OR pi.warehouse_id = ANY (p_wh_ids))
),
q AS (   -- cùng cách đếm "thực nhận" với inbound_return_report
  SELECT i.id, i.material_id, i.party, i.phieu,
         CASE WHEN i.source_type = 'RETURN'
              THEN COALESCE((SELECT SUM(s.qty_base) FROM inbound_return_scan s WHERE s.import_order_id = i.id), 0)
              ELSE COALESCE((SELECT SUM(ie.cartons_imported) FROM "InventoryEntry" ie
                             WHERE ie.import_order_id = i.id AND ie.pallet_code IS DISTINCT FROM i.material_code), 0) + COALESCE(i.posm_cartons, 0)
         END AS qty
  FROM imp i
)
SELECT jsonb_build_object(
  'by_material', COALESCE((SELECT jsonb_agg(jsonb_build_object('material_id', m.id, 'material_code', m.material_code, 'short_name', m.short_name,
                     'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton, 'qty_base', t.qty, 'phieu', t.n) ORDER BY m.material_code)
                   FROM (SELECT material_id, SUM(qty) AS qty, COUNT(DISTINCT phieu) AS n FROM q GROUP BY 1) t JOIN "Material" m ON m.id = t.material_id), '[]'::jsonb),
  'by_party', COALESCE((SELECT jsonb_agg(jsonb_build_object('party', t.party, 'phieu', t.n, 'n_mat', t.nm) ORDER BY t.party)
                   FROM (SELECT party, COUNT(DISTINCT phieu) AS n, COUNT(DISTINCT material_id) AS nm FROM q GROUP BY 1) t), '[]'::jsonb),
  'by_party_material', COALESCE((SELECT jsonb_agg(jsonb_build_object('party', party, 'material_id', material_id, 'qty_base', qty))
                   FROM (SELECT party, material_id, SUM(qty) AS qty FROM q GROUP BY 1, 2) t), '[]'::jsonb)
);
$function$;

COMMIT;
