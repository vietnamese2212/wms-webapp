// Ô "Bồn" của form Mở / Lập mẻ (27/11 — user: "lúc ẩn lúc hiện thông tin bồn khi tạo mẻ" · "tạo bồn mới có vẻ chưa realtime").
// Lỗi C143: bồn KHÁC đơn vị với mã BTP bị LỌC BỎ âm thầm, đơn vị của mã đọc từ kết quả ô tìm (đang tải lại ⇒ trống ⇒ hiện mọi bồn) ⇒
// bồn lít BD63 lúc hiện lúc mất; bồn mới khai sai đơn vị thì "không thấy". Luật: MỌI bồn của kho đều hiện; bồn khác đơn vị KHOÁ kèm lý do
// (bồn đang chọn sẵn vẫn để chọn được, form báo đỏ). Chỗ trống = sức chứa − đang chứa − phần mẻ KHÁC đã đặt. Test: tests/unit/tankOptions.test.ts
export interface TankOptInput {
  id: string; code: string; warehouse_id: string; unit: string; capacity: number; content: number
  incoming: { batch_id: string; qty: number; material_code?: string | null }[]
  lots: { batch?: { material?: { material_code?: string | null } | null } | null }[]
}
export interface TankOpt { value: string; label: string; free: number; wrongUnit: boolean; disabled: boolean; sub: string }

export function tankOptions(tanks: TankOptInput[], wh: string, matUnit: string, currentBatchId: string | undefined, selectedTankId: string): TankOpt[] {
  return tanks.filter(t => t.warehouse_id === wh).map(t => {
    const otherRes = t.incoming.filter(x => x.batch_id !== currentBatchId).reduce((a, x) => a + Number(x.qty), 0)
    const free = Math.max(Number(t.capacity) - Number(t.content) - otherRes, 0)
    const holds = t.lots[0]?.batch?.material?.material_code ?? t.incoming.find(x => x.batch_id !== currentBatchId)?.material_code
    const wrongUnit = !!matUnit && t.unit !== matUnit
    return {
      value: t.id, label: t.code, free, wrongUnit, disabled: wrongUnit && t.id !== selectedTankId,
      sub: wrongUnit ? `bồn ${t.unit} ≠ mã ${matUnit}`   // ngắn: ô xổ hẹp cắt chữ dài — câu đầy đủ ở dòng dưới ô Bồn
        : `còn chỗ ${free.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} ${t.unit}${holds ? ` · ${Number(t.content) > 0 ? 'đang chứa' : 'đã đặt cho'} ${holds}` : ' · trống'}`,
    }
  })
}
