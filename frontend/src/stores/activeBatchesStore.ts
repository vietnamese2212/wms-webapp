import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { BATCH_STAGE, stageOf } from '@/components/wms/production/BatchStage'

// MẺ ĐANG LÀM (18/11 — user: "giống như xuất, cho lựa chọn tab để làm nhiều mẻ 1 lúc"): cùng khuôn activeVehiclesStore của Xuất kho —
// 🔖 ở danh sách mẻ / trang mẻ ⇒ mẻ hiện thành tab trong dải "Đang làm:" (components/shared/PinnedTabs) trên trang mẻ để chuyển qua lại.
// Lưu theo TAB TRÌNH DUYỆT (sessionStorage) như Xuất kho. Mã lô đổi khi đổi bồn / chu kỳ / số mẻ ⇒ trang mẻ ghi lại mã + tình trạng mới.
// stage = tình trạng mẻ (mes_batch_stage — 18/11) ⇒ màu chấm của tab cùng bảng màu với danh sách / trang mẻ.
export interface ActiveBatch {
  id: string
  code: string
  stage: string
}

interface ActiveBatchesState {
  batches:  ActiveBatch[]
  pin:      (b: ActiveBatch) => void
  unpin:    (id: string) => void
  isPinned: (id: string) => boolean
}

export const useActiveBatchesStore = create<ActiveBatchesState>()(
  persist(
    (set, get) => ({
      batches: [],
      pin: (b) => set(s => ({
        batches: s.batches.some(x => x.id === b.id)
          ? s.batches.map(x => x.id === b.id ? b : x)
          : [...s.batches, b],
      })),
      unpin:    (id) => set(s => ({ batches: s.batches.filter(x => x.id !== id) })),
      isPinned: (id) => get().batches.some(x => x.id === id),
    }),
    { name: 'wms-active-batches', storage: createJSONStorage(() => sessionStorage) }
  )
)

/** chấm tình trạng của tab — cùng màu nhãn tình trạng (components/wms/production/BatchStage) */
export const batchTabDot = (stage: string | null | undefined): string => BATCH_STAGE[stageOf(stage)].dot
