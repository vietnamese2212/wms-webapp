-- QUY TẮC CẤT HÀNG — tách "bắt buộc" theo TỪNG LUẬT (user chốt 16/08).
--
-- VÌ SAO: `putaway_required` là MỘT công tắc chung cho cả 7 luật ⇒ không diễn đạt được ý định
-- thật của người dùng. Đo trên Ba Vì 15/08:
--   · "Cấm đưa hàng vào" (ngoài đường, mặt đất) — user muốn CHỈ cấm GỢI Ý và cấm LÊN KẾ HOẠCH,
--     còn thực tế hết chỗ thì vẫn để ở đó. Bật công tắc chung là biến khu đang chứa 70 pallet
--     thành khu NGOẠI LỆ: mỗi lượt để hàng phải có người cầm quyền duyệt bấm chọn lý do, làm vài
--     chục lần/ngày thì người ta bấm "Khu đúng đã hết chỗ" theo phản xạ ⇒ được vỏ thủ tục, mất ruột.
--   · Luật trộn date thì NGƯỢC LẠI — chôn hàng phải lấy trước là lỗi thật, đáng chặn cứng
--     (chạy ngược 60 ngày: 1.724/5.542 lượt cất ở Ba Vì đang chôn hàng cần lấy trước = 31,1%).
-- Một công tắc không phục vụ được hai ý định trái chiều đó cùng lúc.
--
-- MÔ HÌNH MỚI: mỗi luật có 3 mức
--   Tắt      = giữ nguyên cách khai cũ (bỏ tick / để trống / date_mix='ANY') — luật không chấm
--   Cảnh báo = có chấm: loại khỏi gợi ý, loại khỏi kế hoạch Slotting, cất vẫn được + ghi vết
--   Bắt buộc = chặn thật (422), muốn qua phải có quyền `inbound.putaway_override` + chọn lý do
-- Mức Bắt buộc khai bằng MẢNG MÃ LUẬT `putaway_enforced`; rỗng = không luật nào chặn cứng.
--
-- BACKFILL GIỮ NGUYÊN HÀNH VI: kho đang bật công tắc chung → ép TẤT CẢ mã luật; kho tắt → mảng rỗng.
-- Sau backfill `putaway_required` hết ý nghĩa (đặt về false, giữ cột để không mất dữ liệu lịch sử).

BEGIN;

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS putaway_enforced text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_enforced_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_enforced_chk
      CHECK (putaway_enforced <@ ARRAY['NO_IN','FULL','PICK_FACE','QA_HOLD','MAX_MATERIALS','NCC_MIX','DATE_MIX']::text[]);
  END IF;
END $$;

UPDATE public."Warehouse"
   SET putaway_enforced = ARRAY['NO_IN','FULL','PICK_FACE','QA_HOLD','MAX_MATERIALS','NCC_MIX','DATE_MIX']::text[],
       putaway_required = false,
       updated_at       = now()
 WHERE putaway_required IS TRUE;

-- Gác: sau migration không kho nào được còn dựa vào công tắc cũ (nếu còn = backfill trượt,
-- và trượt kiểu này thì kho đang "bắt buộc" tự nhiên thành "chỉ cảnh báo" mà KHÔNG AI BIẾT).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."Warehouse" WHERE putaway_required IS TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION 'Còn % kho giữ putaway_required=true — backfill chưa chuyển hết sang putaway_enforced', n;
  END IF;
END $$;

COMMENT ON COLUMN public."Warehouse".putaway_enforced IS
  'Mã luật cất hàng bị CHẶN CỨNG (422, cần quyền inbound.putaway_override + lý do). Luật có chấm nhưng KHÔNG nằm trong mảng = chỉ cảnh báo + loại khỏi gợi ý. Mã: NO_IN/FULL/PICK_FACE/QA_HOLD/MAX_MATERIALS/NCC_MIX/DATE_MIX (utils/putaway.ts)';
COMMENT ON COLUMN public."Warehouse".putaway_required IS
  'ĐÃ THAY THẾ bởi putaway_enforced (16/08) — giữ lại để không mất dữ liệu lịch sử, KHÔNG đọc nữa';

COMMIT;
