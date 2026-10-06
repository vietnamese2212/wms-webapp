-- 20261006c: DẤU ĐẦU VÀO của bàn điều vận theo KHO (06/10).
--
-- VÌ SAO: tín hiệu realtime chỉ mang {table, op} — không biết kho nào (cố ý: kênh Broadcast không mang cột nghiệp vụ). Trước bản này
-- mỗi lần ghi ZSD02 (erp_outbound_orders), Kế hoạch xuất (khvc_lines), sổ dấu tay (dispatch_od_hold / _outside / _segment) hay phả hệ
-- DO (od_lineage) ở BẤT KỲ kho nào làm MỌI bàn điều vận đang mở tải lại Xem đơn · sync · dấu tay · hàng chờ "Cần xử lý" · cả kế hoạch.
-- Đo 06/10 (log Vercel 10 phút, gói QA 61 chạy ở kho QA61): một bàn Ba Vì (3.529 đơn) đang mở tải lại review 36 · decisions 42 ·
-- marks 38 · cả kế hoạch 20 lần ⇒ PostgREST kín 10 khe, câu của chính gói quá trần 8 s ⇒ lập nháp 503. Nay bàn gộp burst rồi hỏi dấu
-- của KHO mình (một câu nhẹ), trùng dấu đang giữ thì thôi.
--
-- Dấu = số dòng + mốc sửa cuối của từng nguồn: xoá làm giảm số dòng, thêm / sửa đẩy mốc (mọi cửa ghi đặt updated_at — luật dự án).
-- od_lineage không mang kho ⇒ lấy cạnh có một đầu là OD thuộc plant của kho. Bản đầu (cùng ngày) đếm CẢ bảng và đo ra ngay hậu quả:
-- gói 61 [17c] ghi phả hệ cho đơn của kho QA61 ⇒ dấu Ba Vì đổi ⇒ bàn Ba Vì đang mở tải lại Xem đơn 3.529 đơn (12 lô song song,
-- 6–13 s mỗi lô) đúng lúc gói lập nháp ⇒ 503 hai lượt liền ở cùng một phép. Hai index để câu đếm theo plant / mã kho không quét cả
-- bảng khi lịch sử lớn dần. File chạy lại được (IF NOT EXISTS · OR REPLACE).

CREATE INDEX IF NOT EXISTS idx_erp_ob_plant_updated ON public.erp_outbound_orders (plant, updated_at);
CREATE INDEX IF NOT EXISTS idx_khvc_wh_updated ON public.khvc_lines (warehouse_code, updated_at);

CREATE OR REPLACE FUNCTION public.dispatch_inputs_stamp(p_warehouse_id text)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT concat_ws('|',
    (SELECT count(*) || ':' || coalesce(max(e.updated_at)::text, '') FROM public.erp_outbound_orders e WHERE e.plant = w.sap_plant),
    (SELECT count(*) || ':' || coalesce(max(k.updated_at)::text, '') FROM public.khvc_lines k WHERE k.warehouse_code = w.code),
    (SELECT count(*) || ':' || coalesce(max(h.updated_at)::text, '') FROM public.dispatch_od_hold h WHERE h.warehouse_id = w.id),
    (SELECT count(*) || ':' || coalesce(max(x.updated_at)::text, '') FROM public.dispatch_od_outside x WHERE x.warehouse_id = w.id),
    (SELECT count(*) || ':' || coalesce(max(s.updated_at)::text, '') FROM public.dispatch_od_segment s WHERE s.warehouse_id = w.id),
    (SELECT count(*) || ':' || coalesce(max(l.updated_at)::text, '') FROM public.od_lineage l
      WHERE EXISTS (SELECT 1 FROM public.erp_outbound_orders e WHERE e.od_number IN (l.old_od, l.new_od) AND e.plant = w.sap_plant)))
  FROM public."Warehouse" w
  WHERE w.id = p_warehouse_id
$$;

-- Kiểm sau khi áp:
--   SELECT public.dispatch_inputs_stamp('56cf7a64-d3aa-4fd2-948d-490ec487acb9');   -- chuỗi 6 phần "n:mốc|…"
--   SELECT public.dispatch_inputs_stamp('khong-co');                               -- NULL (kho lạ)
