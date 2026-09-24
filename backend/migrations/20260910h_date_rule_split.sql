-- MỘT DÒNG ĐƠN, NHIỀU MỨC DATE THEO SỐ LƯỢNG (user 10/09: "đơn 280 thùng nhưng 250 thùng date 60,
-- 30 thùng date 90"). Dòng đơn đến từ SAP nên không tách đôi được ⇒ chia ngay trên quy tắc:
--   {kind:'SPLIT', parts:[{qty_base, kind, value}, …]}
-- Ràng buộc cũ chỉ cho FEFO|MIN_PCT|EXACT nên mọi lần lưu SPLIT đều 23514 → app trả 400 (gói QA 57
-- [15m] bắt được ngay lượt đầu).
--
-- CHECK của Postgres KHÔNG nhận truy vấn con / hàm trả tập ⇒ đưa luật vào một hàm IMMUTABLE rồi gọi
-- trong CHECK. Kiểm cả HÌNH DẠNG parts để đường ghi khác (script, SQL tay) cũng không nhét được rác.
-- `qty_base` so bằng CASE + regex chứ không ép kiểu thẳng: chuỗi không phải số sẽ làm CHECK NÉM LỖI
-- thay vì trả false, tức là một dòng rác làm hỏng cả câu UPDATE của người khác.
CREATE OR REPLACE FUNCTION public.date_rule_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NULL
      OR (p->>'kind') IN ('FEFO', 'MIN_PCT', 'EXACT')
      OR (
        (p->>'kind') = 'SPLIT'
        AND jsonb_typeof(p->'parts') = 'array'
        AND jsonb_array_length(p->'parts') BETWEEN 1 AND 10
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE (e->>'kind') IS DISTINCT FROM 'FEFO'
             AND (e->>'kind') IS DISTINCT FROM 'MIN_PCT'
             AND (e->>'kind') IS DISTINCT FROM 'EXACT'
        )
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE CASE WHEN (e->>'qty_base') ~ '^[0-9]+(\.[0-9]+)?$'
                      THEN (e->>'qty_base')::numeric ELSE 0 END <= 0
        )
      )
$$;
REVOKE ALL ON FUNCTION public.date_rule_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.date_rule_valid(jsonb) TO service_role;

ALTER TABLE public."OutboundItem" DROP CONSTRAINT IF EXISTS outbounditem_date_rule_kind;
ALTER TABLE public."OutboundItem" ADD CONSTRAINT outbounditem_date_rule_kind
  CHECK (public.date_rule_valid(date_rule));

COMMENT ON COLUMN public."OutboundItem".date_rule IS
  'Quy tắc lấy hàng theo date do THỦ KHO chốt: {kind FEFO|MIN_PCT|EXACT, value, set_by, set_at} hoặc {kind:''SPLIT'', parts:[{qty_base,kind,value}]} khi một dòng cần nhiều mức date theo số lượng. NULL = chưa chốt ⇒ dòng KHÔNG lên "Việc cần làm" (user chốt 10/09: FEFO phải bấm xác nhận, không mặc định ngầm).';
