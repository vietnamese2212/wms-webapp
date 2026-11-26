// TÌNH TRẠNG MẺ (MES) — các khoá do hàm DB `mes_batch_stage` trả (danh sách mẻ · ô tổng · lọc · trang mẻ).
// MỘT bản ở BE (bộ kiểm lọc `?stage=` của GET /production/batches). FE `BATCH_STAGES` (components/wms/production/BatchStage.tsx)
// và hàm DB phải cùng tập — test backend/tests/mirror/mesStage.mirror.test.ts gác (26/11: thêm 'closing' mà bộ kiểm BE còn
// danh sách cũ ⇒ ô lọc "Chờ đóng phiếu" trả 400, C142).
export const MES_BATCH_STAGES = ['new', 'wait_lead', 'wait_qa', 'working', 'filled', 'closing', 'released', 'rejected', 'cancelled'] as const
export type MesBatchStage = typeof MES_BATCH_STAGES[number]
