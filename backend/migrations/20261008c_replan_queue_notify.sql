-- ============================================================================
-- 20261008c — BẢNG VIỆC CẦN LÀM ĐANG MỞ TỰ LÀM MỚI KHI TỒN ĐỔI (user duyệt 08/10)
-- ============================================================================
-- Hàng đợi `wms_replan_queue` (20260914e) được trigger trên InventoryEntry ghi khi một mã ĐANG có việc treo
-- chưa ai đụng mà tồn đổi (QA nhả hàng, hàng mới nhập, pallet chuyển chỗ…), và máy chủ chỉ XẢ hàng đợi khi
-- bảng Việc cần làm TẢI. Bản 14/09 cố ý không bắn realtime cho bảng này ⇒ PDA đang mở bảng không biết có gì
-- để sắp lại, kế hoạch cũ đứng tới lần người bấm tải lại.
--
-- Nay: hàng đợi NHẬN mục ⇒ phát tín hiệu {table, op} (mức CÂU LỆNH, không mang dữ liệu) ⇒ FE làm mới
-- ['directed-board'] (gộp burst 1 s) ⇒ lượt tải đó xả hàng đợi. Chỉ AFTER INSERT: câu ghi của trigger là
-- INSERT … ON CONFLICT DO UPDATE — trigger câu lệnh INSERT luôn bắn kể cả khi mã đã trong hàng; thêm UPDATE
-- là mỗi lần ghi bắn 2 tin (đo 08/10). KHÔNG bắn khi XẢ (DELETE): xả là việc của chính lượt tải, bắn nữa là
-- mọi bảng tải thêm một vòng vô ích. Bảng vẫn nội bộ: không policy cho authenticated/anon (gói 00 mục 10b/10c gác).
DROP TRIGGER IF EXISTS trg_wms_notify ON public.wms_replan_queue;
CREATE TRIGGER trg_wms_notify AFTER INSERT ON public.wms_replan_queue
  FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change();
