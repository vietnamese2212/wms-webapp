-- QUY ĐỊNH DATE — đợt 2 (user chốt 11/09/2026; plan: docs/plans/DATE_RULE_MASTER_V2_PLAN.md)
--
-- Đợt 1 cho mỗi khách MỘT mức (`Customer.date_rule`). Đo lại với user cho thấy mức thuộc về
-- cặp (KHÁCH × LOẠI HÀNG) và không phải lúc nào cũng diễn đạt được bằng phần trăm:
--   • FG01 hạn dùng 120–720 ngày (TB 248) · FG02 hạn dùng CHỈ 45–60 ngày (TB 50)
--   • "còn ≥ 35 ngày" = 77,8 % trên mã FG02 hạn 45 ngày, = 58,3 % trên mã hạn 60 ngày
--     ⇒ KHÔNG có con số % nào phục vụ được cả nhóm.
--   • FG02 đi kênh NPP ăn mức chung ≥ 60 % thì mã hạn 45 ngày chỉ cần còn 27 ngày là qua —
--     thiếu 8 ngày so với yêu cầu, và KHÔNG ai thấy gì sai.
--   • Mức khác nhau theo TỪNG KHÁCH: FG01 có khách 60 · 70 · 80 · 85 %; FG02 có khách 35 · 40 ngày.
--
-- Ba việc trong file này:
--   1. `date_rule_valid()` nhận thêm kiểu MIN_DAYS (còn tối thiểu N ngày).
--   2. Bảng `date_rule_master` — MỘT chỗ chứa mức cho CẢ khách lẫn kênh (cùng hình dạng sự thật
--      ⇒ hai kho chứa là hai bộ kiểm tra, hai giao diện, và sớm muộn cũng lệch nhau).
--   3. Chuyển `Customer.date_rule` + `LookupValue.meta.date_rule` sang bảng mới rồi BỎ cột cũ —
--      giữ song song là đẻ ra câu hỏi "cột nói 60 %, bảng nói 70 %, cái nào thắng".
--      Danh mục Customer đang có 3 dòng (đều do gói QA tự tạo, date_rule NULL) ⇒ đổi lúc này
--      không tốn một dòng dữ liệu nào.

-- ── 1. MIN_DAYS vào hàm kiểm tra hình dạng ────────────────────────────────────────────────────
-- CREATE OR REPLACE giữ nguyên chữ ký ⇒ mọi CHECK đang tham chiếu (OutboundItem, Customer) tự
-- dùng bản mới, không phải DROP CASCADE.
CREATE OR REPLACE FUNCTION public.date_rule_valid(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p IS NULL
      OR (p->>'kind') IN ('FEFO', 'MIN_PCT', 'MIN_DAYS', 'EXACT')
      OR (
        (p->>'kind') = 'SPLIT'
        AND jsonb_typeof(p->'parts') = 'array'
        AND jsonb_array_length(p->'parts') BETWEEN 1 AND 10
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE (e->>'kind') IS DISTINCT FROM 'FEFO'
             AND (e->>'kind') IS DISTINCT FROM 'MIN_PCT'
             AND (e->>'kind') IS DISTINCT FROM 'MIN_DAYS'
             AND (e->>'kind') IS DISTINCT FROM 'EXACT'
        )
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE CASE WHEN (e->>'qty_base') ~ '^[0-9]+(\.[0-9]+)?$'
                      THEN (e->>'qty_base')::numeric ELSE 0 END <= 0
        )
      )
$function$;

-- Hình dạng GIÁ TRỊ của một mức master — dùng chung cho CHECK của bảng dưới.
-- MIN_PCT: 0 < v ≤ 100 · MIN_DAYS: số NGUYÊN 1..3650 (10 năm — quá mốc đó là gõ nhầm, không phải
-- yêu cầu thật) · FEFO: không có value.
CREATE OR REPLACE FUNCTION public.date_rule_master_value_ok(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE (p->>'kind')
    WHEN 'FEFO'     THEN true
    WHEN 'MIN_PCT'  THEN (p->>'value') ~ '^[0-9]+(\.[0-9]+)?$'
                     AND (p->>'value')::numeric > 0 AND (p->>'value')::numeric <= 100
    WHEN 'MIN_DAYS' THEN (p->>'value') ~ '^[0-9]+$'
                     AND (p->>'value')::numeric >= 1 AND (p->>'value')::numeric <= 3650
    ELSE false
  END
$function$;

-- ── 2. Bảng mức dùng chung khách + kênh ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.date_rule_master (
  id          text PRIMARY KEY,
  scope       text NOT NULL CHECK (scope IN ('CUSTOMER', 'CHANNEL')),
  scope_key   text NOT NULL,   -- Customer.id  |  LookupValue.value của kênh
  category    text,            -- FG01 · FG02 · …  |  NULL = mọi loại hàng CÒN LẠI
  rule        jsonb NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_by  text,
  CONSTRAINT date_rule_master_rule_ck CHECK (
    public.date_rule_valid(rule)
    AND (rule->>'kind') IN ('FEFO', 'MIN_PCT', 'MIN_DAYS')   -- EXACT/SPLIT là quyết định của TỪNG DÒNG ĐƠN
    AND public.date_rule_master_value_ok(rule)
  ),
  CONSTRAINT date_rule_master_category_ck CHECK (
    category IS NULL OR (category ~ '^[A-Z0-9_]+$' AND length(category) <= 30)
  )
);

-- NULLS NOT DISTINCT (PG17): dòng "mọi loại hàng" (category NULL) cũng chỉ được có MỘT cho mỗi
-- khách/kênh. Thiếu mệnh đề này thì NULL luôn khác NULL ⇒ khai 5 dòng chung mà không ai chặn.
CREATE UNIQUE INDEX IF NOT EXISTS uq_date_rule_master
  ON public.date_rule_master (scope, scope_key, category) NULLS NOT DISTINCT;

-- Tra theo scope_key là đường đọc duy nhất của bộ nạp ngữ cảnh (loadPolicyCtx).
CREATE INDEX IF NOT EXISTS idx_date_rule_master_key
  ON public.date_rule_master (scope, scope_key);

-- Backend đi service_role. KHÔNG cấp quyền cho authenticated/anon và KHÔNG tạo policy —
-- luật 02/09: FE không đọc bảng nào qua Supabase, realtime đi Broadcast từ trigger.
ALTER TABLE public.date_rule_master ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.date_rule_master IS
  'Mức Quy định date theo (khách|kênh) × loại hàng. category NULL = mọi loại còn lại. Đợt 2, 11/09/2026.';

-- ── 3. Chuyển dữ liệu cũ sang rồi bỏ hai chỗ chứa cũ ──────────────────────────────────────────
-- 3a. Mức riêng của từng khách → dòng "mọi loại hàng" của khách đó.
INSERT INTO public.date_rule_master (id, scope, scope_key, category, rule, created_by, updated_by)
SELECT gen_random_uuid()::text, 'CUSTOMER', c.id, NULL, c.date_rule,
       coalesce(c.updated_by, c.created_by), coalesce(c.updated_by, c.created_by)
  FROM public."Customer" c
 WHERE c.date_rule IS NOT NULL
   AND (c.date_rule->>'kind') IN ('FEFO', 'MIN_PCT')
ON CONFLICT DO NOTHING;

-- 3b. Mức mặc định của kênh (đang có đúng 1 dòng: NPP ≥ 60 %).
INSERT INTO public.date_rule_master (id, scope, scope_key, category, rule, created_by, updated_by)
SELECT gen_random_uuid()::text, 'CHANNEL', l.value, NULL, l.meta->'date_rule',
       coalesce(l.updated_by, l.created_by), coalesce(l.updated_by, l.created_by)
  FROM public."LookupValue" l
 WHERE l.type = 'customer_channel'
   AND l.meta ? 'date_rule'
   AND (l.meta->'date_rule'->>'kind') IN ('FEFO', 'MIN_PCT')
ON CONFLICT DO NOTHING;

-- 3c. Gỡ khỏi hai chỗ cũ — một sự thật một chỗ chứa.
UPDATE public."LookupValue"
   SET meta = meta - 'date_rule', updated_at = now()
 WHERE type = 'customer_channel' AND meta ? 'date_rule';

ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_date_rule_ck;
ALTER TABLE public."Customer" DROP COLUMN IF EXISTS date_rule;

-- ── 4. Loại hàng nào khai được Quy định date ──────────────────────────────────────────────────
-- Màn khai làm MỜ loại hàng không có mã nào khai hạn dùng (đo 11/09: PM01 = 0/888 mã) và nói rõ
-- lý do, thay vì im lặng bỏ. Danh sách đọc từ DỮ LIỆU, không phải hằng số trong code — ngày nào
-- có người khai hạn dùng cho một mã POSM thì loại đó tự sáng lên.
CREATE OR REPLACE FUNCTION public.date_rule_categories()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'category'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'category',        m.category,
               'materials',       count(*),
               'with_shelf_life', count(*) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0)
             ) AS x
        FROM public."Material" m
       WHERE coalesce(m.is_active, true) AND m.category IS NOT NULL
       GROUP BY m.category
    ) s
$function$;
