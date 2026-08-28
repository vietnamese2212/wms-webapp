-- ĐÁNH GIÁ SAO CHUYẾN GIAO — kho nhận chấm khi xác nhận đơn (28/08, user chốt)
--
-- Vì sao cần: fill rate đo được "giao đủ hay thiếu" nhưng KHÔNG đo được "giao có tử tế không" —
-- hàng móp, chứng từ thiếu, xe tới trễ, xếp hàng lộn xộn. Người duy nhất biết những thứ đó là
-- NGƯỜI NHẬN, và họ chỉ nói ra nếu việc chấm nằm ngay trong luồng họ đang làm (lúc xác nhận đơn).
--
-- Phạm vi: chỉ những chuyến mà kho nhận THỰC SỰ vào xác nhận (chuyển kho, kho nhận chế độ QR/QTY).
-- Chuyến giao khách ngoài hoặc kho nhận NONE (tài xế tự hoàn thành) không có ai để chấm.
--
-- 1 chuyến = 1 đánh giá (unique gdo_id): chấm lại là SỬA, không đẻ dòng mới — nếu không, trung
-- bình sao sẽ bị người bấm nhiều lần kéo lệch.
--
-- LÝ DO theo DANH SÁCH CỐ ĐỊNH, không gõ tự do — cùng bài học với lý do vượt luân chuyển (14/08):
-- gõ tự do thì mỗi người viết một kiểu, cuối quý không gom nhóm được nguyên nhân nào ra nguyên
-- nhân nào. Ghi chú tự do vẫn có, nhưng nằm ở cột riêng.

CREATE TABLE IF NOT EXISTS public.receipt_ratings (
  id                text PRIMARY KEY,
  gdo_id            text NOT NULL,
  tms_order_id      text,
  from_warehouse_id text,                    -- kho gửi (bị chấm)
  to_warehouse_id   text,                    -- kho nhận (người chấm)
  stars             int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  reason_code       text CHECK (reason_code IS NULL OR reason_code IN
                      ('SHORT', 'WRONG', 'DAMAGED', 'LATE', 'DOC', 'OTHER')),
  note              text,
  rated_by          text,
  rated_by_name     text,
  rated_at          timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Chấm thấp thì PHẢI nêu lý do — chấm 2 sao mà không nói vì sao thì kho gửi không sửa được gì.
  CONSTRAINT receipt_rating_reason_when_low CHECK (stars >= 4 OR reason_code IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_rating_gdo ON public.receipt_ratings (gdo_id);
CREATE INDEX IF NOT EXISTS idx_receipt_rating_from ON public.receipt_ratings (from_warehouse_id, rated_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_rating_to   ON public.receipt_ratings (to_warehouse_id, rated_at DESC);

-- Realtime: bảng mới phải vào publication, nếu không màn hình người khác không tự cập nhật
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'receipt_ratings') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.receipt_ratings';
  END IF;
END $$;

-- RLS: đóng anon như mọi bảng nghiệp vụ; backend đi bằng service_role nên không cần policy ghi.
-- Nhưng PHẢI có policy SELECT cho authenticated, nếu không realtime chết câm (bài học 06/08).
ALTER TABLE public.receipt_ratings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'receipt_ratings' AND policyname = 'receipt_ratings_read') THEN
    EXECUTE 'CREATE POLICY receipt_ratings_read ON public.receipt_ratings FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;
