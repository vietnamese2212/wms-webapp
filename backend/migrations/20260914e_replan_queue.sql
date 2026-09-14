-- ============================================================================
-- 20260914e — HÀNG ĐỢI SẮP LẠI THEO TỒN: kế hoạch lấy hàng phải theo tồn HIỆN TẠI (user chốt 14/09)
-- ============================================================================
-- User: "khi lái xe nâng hạ hàng, tại thời điểm hạ họ check được tồn mới nhất; hệ thống chỉ đặt việc lúc
-- Bắt đầu thì không realtime bằng trước — bước lùi." Đúng. Kế hoạch chụp lúc Bắt đầu sống mãi dù hàng
-- date ngắn hơn vừa về, pallet ghim vừa bị chuyển chỗ / QA giữ / xuất cho chuyến khác.
--
-- Cách làm: TRIGGER trên InventoryEntry ghi (kho, mã) vào hàng đợi khi mã đó ĐANG có việc treo chưa ai
-- đụng; máy chủ XẢ hàng đợi mỗi lần bảng Việc cần làm tải (PDA tự tải lại theo tín hiệu realtime) —
-- chạy thử kế hoạch, khác bộ pallet mới bỏ việc chưa ai đụng và ghim lại (`services/directedTasks.ts`
-- `drainReplanQueue`). Vì sao không sắp lại trong trigger: luật chọn pallet (luân chuyển · %Date · BFS)
-- nằm ở Node, chép xuống SQL là đúng khuôn "4 bản chép tay". Vì sao không xả trong đường ghi tồn: đường
-- ghi tồn có ~10 cửa (quét nhập · chuyển vị trí · QA · dồn/tách · upload · quét xuất…), gắn từng cửa là
-- sót; trigger ở DB bắt MỌI đường ghi kể cả script. Chi phí trigger: một EXISTS trên index riêng phần +
-- một upsert — không đụng độ trễ quét.
--
-- Bảng nội bộ: KHÔNG policy cho authenticated/anon (mặc định đã đóng), KHÔNG bắn realtime (bỏ trigger
-- wms_notify mà event trigger tự gắn lúc CREATE TABLE).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wms_replan_queue (
  warehouse_id uuid        NOT NULL,
  material_id  uuid        NOT NULL,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, material_id)
);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.wms_replan_queue;
ALTER TABLE public.wms_replan_queue ENABLE ROW LEVEL SECURITY;

-- Trigger hỏi "mã này đang có việc treo chưa ai đụng không?" — index riêng phần để câu đó rẻ
CREATE INDEX IF NOT EXISTS idx_wms_tasks_pending_wh_mat
  ON public.wms_tasks (warehouse_id, material_id)
  WHERE status = 'PENDING' AND lowered_at IS NULL AND moved_at IS NULL;

CREATE OR REPLACE FUNCTION public.wms_replan_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  r := COALESCE(NEW, OLD);
  IF r.warehouse_id IS NULL OR r.material_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.wms_tasks t
    WHERE t.warehouse_id = r.warehouse_id AND t.material_id = r.material_id
      AND t.status = 'PENDING' AND t.lowered_at IS NULL AND t.moved_at IS NULL
    LIMIT 1
  ) THEN
    INSERT INTO public.wms_replan_queue (warehouse_id, material_id, queued_at)
    VALUES (r.warehouse_id, r.material_id, now())
    ON CONFLICT (warehouse_id, material_id) DO UPDATE SET queued_at = EXCLUDED.queued_at;
  END IF;
  -- Pallet CHUYỂN KHO: kho cũ cũng mất một pallet
  IF TG_OP = 'UPDATE' AND OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id AND OLD.warehouse_id IS NOT NULL THEN
    INSERT INTO public.wms_replan_queue (warehouse_id, material_id, queued_at)
    SELECT OLD.warehouse_id, OLD.material_id, now()
    WHERE EXISTS (SELECT 1 FROM public.wms_tasks t WHERE t.warehouse_id = OLD.warehouse_id AND t.material_id = OLD.material_id
                    AND t.status = 'PENDING' AND t.lowered_at IS NULL AND t.moved_at IS NULL LIMIT 1)
    ON CONFLICT (warehouse_id, material_id) DO UPDATE SET queued_at = EXCLUDED.queued_at;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- hàng đợi hỏng không được làm hỏng giao dịch tồn kho
END $$;

DROP TRIGGER IF EXISTS trg_wms_replan_enqueue ON public."InventoryEntry";
CREATE TRIGGER trg_wms_replan_enqueue
  AFTER INSERT OR DELETE OR UPDATE OF status, cartons_remaining, cartons_reserved, location_id, qa_status_id,
    production_date, expiry_date, warehouse_id, material_id
  ON public."InventoryEntry"
  FOR EACH ROW EXECUTE FUNCTION public.wms_replan_enqueue();
