-- Thứ tự hiển thị lưới "Kế hoạch vận chuyển" (tab Kế hoạch) — chỉ thay tms_orders_page.
-- Trước: cụm xếp theo `date DESC, created_at` ⇒ trong 1 ngày là THỨ TỰ UPLOAD (file nào dòng nào
-- trước thì đứng trước) → Xuất/Nhập, loại kho, loại xe, ĐVVT trộn lẫn nhau, người đặt giờ phải
-- nhảy khắp bảng. Nay xếp theo cách người dùng LÀM VIỆC trên trang này:
--
--   1. Ngày TĂNG dần        — đọc như lịch (hôm nay → mai → mốt), trang KẾ HOẠCH là nhìn về trước
--   2. Ưu tiên (UT = x)     — việc gấp luôn nằm đầu ngày
--   3. Hướng: Xuất → Nhập   — 2 luồng khác đội/khác cửa, không xen kẽ
--   4. Loại kho (A→Z)       — khung giờ ràng theo cargo_type ⇒ đơn cùng loại hàng đứng liền nhau
--   5. Loại xe (A→Z)        — khung giờ ràng theo vehicle_type ⇒ đặt được cả loạt trong 1 mạch
--   6. ĐVVT (A→Z)           — gọi 1 nhà vận tải là thấy hết xe của họ liền khối
--   7. Mã đơn (A→Z)         — giữ dãy số thứ tự của SAP trong cùng nhóm (dễ đối chiếu file)
--   8. created_at, id       — chốt hạ, bảo đảm thứ tự TẤT ĐỊNH (không đổi giữa 2 lần tải)
--
-- CỐ Ý KHÔNG xếp theo GIỜ ĐÃ ĐẶT: nếu xếp theo giờ thì mỗi lần đặt xong 1 xe, dòng đó NHẢY khỏi
-- chỗ đang làm (và phân trang server kéo dòng trang sau lên) — đúng lúc user đang đặt giờ hàng loạt.
-- Xem lịch theo giờ đã có nút "Xem booking" (tình trạng khung giờ) + filter Khung giờ.
--
-- STT xe đánh theo ĐÚNG các khóa trên (trên tập NỀN, chưa áp filter) để: (a) STT tăng dần theo
-- chiều đọc, (b) màu vằn xen kẽ theo cụm (FE: groupParity = stt % 2) không bị vón cục.

DROP FUNCTION IF EXISTS tms_orders_page(int, int, date, date, text, uuid, text[], text[], text[], uuid[], text[], text[], uuid[], boolean, boolean);
CREATE FUNCTION tms_orders_page(
  p_offset        int,                        -- bỏ qua bao nhiêu CỤM
  p_limit         int,                        -- lấy bao nhiêu CỤM
  p_date_from     date,
  p_date_to       date,
  p_warehouse_id  text    DEFAULT NULL,
  p_ncc_user      uuid    DEFAULT NULL,       -- user ĐVVT: chỉ thấy lệnh của công ty mình
  p_categories    text[]  DEFAULT NULL,       -- scope Loại kho (NULL = đủ quyền)
  p_scope_wh      text[]  DEFAULT NULL,       -- scope Kho    (NULL = đủ quyền)
  p_directions    text[]  DEFAULT NULL,       -- lọc Hướng
  p_dvvt          uuid[]  DEFAULT NULL,       -- lọc ĐVVT
  p_wh_types      text[]  DEFAULT NULL,       -- lọc Loại kho
  p_vehicle_types text[]  DEFAULT NULL,       -- lọc Loại xe
  p_slot_ids      uuid[]  DEFAULT NULL,       -- lọc Khung giờ
  p_unbooked      boolean DEFAULT false,      -- lọc Khung giờ = "Chưa đặt"
  p_with_stt      boolean DEFAULT true        -- false + p_limit lớn = chỉ lấy TẬP ID của bộ lọc
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH base AS (   -- PHẠM VI NỀN: ngày + kho + scope. CHƯA áp filter người dùng (STT/facet đọc ở đây).
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.priority, o.order_code
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR o.warehouse_type = ANY (p_categories))
  ),
  skey AS (        -- KHÓA SẮP XẾP HIỂN THỊ của từng đơn — dùng CHUNG cho STT và cho xếp cụm
    SELECT b.id, b.date, b.created_at,
           COALESCE(b.priority, false)                             AS pri,
           (CASE WHEN b.direction = 'OUTBOUND' THEN 0 ELSE 1 END)   AS dir_rank,
           b.warehouse_type, b.vehicle_type, nc.name AS dvvt_name, b.order_code
    FROM base b LEFT JOIN "TransportCompany" nc ON nc.id = b.ncc_id
  ),
  bslots AS (      -- mọi slot của tập nền; đơn CHƯA có xe → 1 dòng ảo (slot_id NULL) để vẫn có STT
    SELECT b.id AS order_id, s.id AS slot_id, s.consolidation_group_id, s.is_consolidation_primary,
           b.date, b.created_at,
           row_number() OVER (PARTITION BY b.id ORDER BY s.created_at, s.id) - 1 AS slot_idx,
           (s.id IS NULL OR s.consolidation_group_id IS NULL OR s.is_consolidation_primary) AS numbered
    FROM base b LEFT JOIN "TmsVehicleSlot" s ON s.order_id = b.id
  ),
  sec_base AS (    -- đơn thứ cấp ĐÃ BỊ KÉO vào cụm của đơn chủ → KHÔNG có dòng xe riêng, KHÔNG có STT
    SELECT DISTINCT s.order_id
    FROM "TmsVehicleSlot" s
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s.consolidation_group_id AND p.is_consolidation_primary
    WHERE s.consolidation_group_id IS NOT NULL AND NOT s.is_consolidation_primary AND p.order_id <> s.order_id
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = s.order_id)
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = p.order_id)
  ),
  pick AS (        -- dòng được đánh STT: xe chính/độc lập; đơn TOÀN xe phụ mà đơn chủ KHÔNG có
                   -- trong tập (mồ côi) → vẫn 1 dòng riêng. Còn nếu đơn chủ có mặt thì đơn này là
                   -- DÒNG CON trong cụm ⇒ không đánh STT (đếm ở đây = đếm thừa xe).
    SELECT * FROM bslots WHERE numbered
    UNION ALL
    SELECT c.* FROM bslots c
    WHERE NOT c.numbered AND c.slot_idx = 0
      AND NOT EXISTS (SELECT 1 FROM bslots c2 WHERE c2.order_id = c.order_id AND c2.numbered)
      AND NOT EXISTS (SELECT 1 FROM sec_base sb WHERE sb.order_id = c.order_id)
  ),
  stt AS (         -- STT tăng dần theo ĐÚNG chiều đọc của lưới
    SELECT p.order_id, p.slot_id,
           row_number() OVER (ORDER BY k.date, k.pri DESC, k.dir_rank,
                                       k.warehouse_type NULLS LAST, k.vehicle_type NULLS LAST,
                                       k.dvvt_name NULLS LAST, k.order_code NULLS LAST,
                                       k.created_at, p.order_id, p.slot_idx) AS n
    FROM pick p JOIN skey k ON k.id = p.order_id
  ),
  f AS (           -- ÁP FILTER NGƯỜI DÙNG (thứ tự khớp FE: hướng/ĐVVT/loại kho → loại xe → khung giờ)
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR b.warehouse_type = ANY (p_wh_types))
      -- Loại xe: khớp trực tiếp HOẶC đi GOM CHUNG XE với một đơn khớp (giữ nguyên cụm, không xé lẻ)
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s
            JOIN "TmsVehicleSlot" s2 ON s2.consolidation_group_id = s.consolidation_group_id
            JOIN base d ON d.id = s2.order_id
            WHERE s.order_id = b.id AND s.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR d.warehouse_type = ANY (p_wh_types))))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s WHERE s.order_id = b.id
              AND ((p_unbooked AND s.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s.slot_id = ANY (p_slot_ids)))))
  ),
  sec AS (         -- đơn thứ cấp → đơn CHỦ (chỉ khi đơn chủ cũng còn trong tập lọc)
    SELECT DISTINCT ON (s.order_id) s.order_id, p.order_id AS leader_id
    FROM "TmsVehicleSlot" s
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s.consolidation_group_id AND p.is_consolidation_primary
    WHERE s.consolidation_group_id IS NOT NULL AND NOT s.is_consolidation_primary
      AND p.order_id <> s.order_id
      AND EXISTS (SELECT 1 FROM f fs WHERE fs.id = s.order_id)
      AND EXISTS (SELECT 1 FROM f fp WHERE fp.id = p.order_id)
    ORDER BY s.order_id, s.created_at, s.id
  ),
  blk AS (         -- mỗi đơn thuộc ĐÚNG 1 cụm → cụm phân hoạch tập lọc, không đơn nào lọt 2 trang
    SELECT f.id, f.date, f.created_at, f.order_code, COALESCE(f.priority, false) AS pri,
           COALESCE(sec.leader_id, f.id) AS leader_id
    FROM f LEFT JOIN sec ON sec.order_id = f.id
  ),
  branked AS (     -- cụm xếp theo khóa của ĐƠN CHỦ; ưu tiên tính bool_or cả cụm (đơn gom gấp cũng kéo cụm lên)
    SELECT b.leader_id, count(*) AS n_orders,
           row_number() OVER (ORDER BY k.date, bool_or(b.pri) DESC, k.dir_rank,
                                       k.warehouse_type NULLS LAST, k.vehicle_type NULLS LAST,
                                       k.dvvt_name NULLS LAST, k.order_code NULLS LAST,
                                       k.created_at, b.leader_id) AS brank
    FROM blk b JOIN skey k ON k.id = b.leader_id
    GROUP BY b.leader_id, k.date, k.dir_rank, k.warehouse_type, k.vehicle_type, k.dvvt_name,
             k.order_code, k.created_at
  ),
  win AS (
    SELECT * FROM branked WHERE brank > GREATEST(p_offset, 0) AND brank <= GREATEST(p_offset, 0) + GREATEST(p_limit, 0)
  ),
  page_ids AS (    -- thứ tự hiển thị: cụm theo brank; trong cụm: đơn chủ trước, rồi đơn gom theo mã đơn
    SELECT b.id, w.brank, (CASE WHEN b.id = b.leader_id THEN 0 ELSE 1 END) AS inblk,
           b.order_code, b.created_at
    FROM blk b JOIN win w ON w.leader_id = b.leader_id
  )
  SELECT jsonb_build_object(
    'ids',           COALESCE((SELECT jsonb_agg(id ORDER BY brank, inblk, order_code NULLS LAST, created_at, id) FROM page_ids), '[]'::jsonb),
    'total_orders',  (SELECT count(*) FROM f),
    'total_blocks',  (SELECT count(*) FROM branked),
    'page_from',     1 + COALESCE((SELECT sum(n_orders) FROM branked WHERE brank <= GREATEST(p_offset, 0)), 0),
    'page_orders',   (SELECT count(*) FROM page_ids),
    -- STT xe của riêng các đơn trong trang; khoá = "<order_id>/<slot_id>" (slot_id rỗng = đơn chưa có xe)
    'stt',           CASE WHEN p_with_stt THEN
                       COALESCE((SELECT jsonb_object_agg(order_id::text || '/' || COALESCE(slot_id::text, ''), n)
                                 FROM stt WHERE order_id IN (SELECT id FROM page_ids)), '{}'::jsonb)
                     ELSE '{}'::jsonb END
  ) INTO result;
  RETURN result;
END $$;
