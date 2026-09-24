// SỔ CHUYỂN VỊ TRÍ — MỘT sổ cho MỌI cửa đổi ô của pallet (17/09).
//
// Vì sao có file này: user 17/09 hỏi về nút "✓ Xong" của Việc cần làm — *"bấm Xong nghĩa là gì, là
// chuyển vị trí luôn đúng không, vậy có lịch sử nào xem được việc chuyển vị trí này không — phòng
// tình huống bấm Xong lung tung rồi hàng hoá chạy loạn hết"*. Soi code cùng ngày: app ĐÃ CÓ đúng
// sổ đó — tab **Lịch sử** của màn Chuyển vị trí (`GET /wms/inventory/move-log` đọc `StocktakeLog`
// nơi `location_changed_to IS NOT NULL`: từ ô nào → tới ô nào, pallet nào, ai, lúc nào). Nhưng chỉ
// 2/5 cửa ghi vào sổ ấy. Ba cửa còn lại đổi `InventoryEntry.location_id` mà KHÔNG để lại dòng nào
// người xem được:
//   · ✓ Xong việc NHẶT LẺ ở Việc cần làm (`services/directedTasks.confirmTasks`)
//   · Quét chuyển vị trí của Tối ưu vị trí (`slottingController.scanMovePlanPallet`)
//   · Chuyển vị trí HÀNG LOẠT ở trang Tồn kho (cờ `count_as_stocktake` mặc định tắt)
// Đúng lớp lỗi "hai cửa cùng một sổ mà khác luật" — nay mọi cửa gọi CHUNG hàm này.
//
// RANH GIỚI PHẢI GIỮ: **ghi SỔ ≠ tính là ĐÃ KIỂM KÊ**. Chỉ lượt người thật sự QUÉT TEM mới đặt
// `stocktake_at` (`mark_stocktake`), vì đó là lúc có người nhìn thấy pallet bằng mắt. Xe nâng bấm
// nút ✓ Xong không quét gì ⇒ vẫn vào sổ chuyển vị trí, nhưng KHÔNG được tính vào "đã kiểm" của tab
// Luân phiên ABC — nếu không, một cú bấm nút sẽ xoá hạn kiểm kê của pallet.
//
// Sổ là việc NỀN: hỏng thì ghi `error_logs` rồi thôi, KHÔNG được làm hỏng lượt chuyển hàng đã commit.
import { randomUUID } from 'crypto'
import { db } from '../lib/supabase'          // client CÓ KIỂU: tên bảng/cột sai = lỗi biên dịch
import { recordBackgroundFailure } from '../utils/response'

/** Một pallet vừa đổi ô. `from_location_*` phải là ô NGUỒN — chụp TRƯỚC khi chuyển. */
export interface MovedPallet {
  entry_id: string
  from_location_id: string | null
  from_location_code?: string | null
  // Các cột mô tả để sổ đọc được cả khi pallet sau này đã xuất/đã xoá. Thiếu thì hàm tự tra.
  pallet_code?: string | null
  material_id?: string | null
  material_code?: string | null
  short_name?: string | null
  base_unit?: string | null
  entry_unit?: string | null
  units_per_carton?: number | null
  app_qty?: number | null
}

type EntrySnap = {
  id: string; pallet_code: string | null; material_id: string | null; cartons_remaining: number | null
  material?: { material_code?: string | null; short_name?: string | null; base_unit?: string | null
    entry_unit?: string | null; units_per_carton?: number | null } | null
}

/**
 * Ghi một dòng sổ cho mỗi pallet vừa chuyển ô. Trả về số dòng đã ghi (0 = không có gì để kể, hoặc
 * ghi hỏng — hỏng đã vào `error_logs`).
 */
export async function logPalletMoves(p: {
  moved: MovedPallet[]
  to_location_id: string
  actor_id: string | null          // UUID Employee (cột có khoá ngoại) — không phải tên
  actor_name: string | null
  note: string                     // CỬA NÀO ghi dòng này, viết cho người đọc sổ
  where: string                    // route/đường gọi, để error_logs lần ra chỗ hỏng
  mark_stocktake?: boolean         // chỉ TRUE khi người thật sự quét tem (xem RANH GIỚI ở đầu file)
  at?: string
}): Promise<number> {
  // Pallet đứng yên thì không có gì để kể (đích trùng nguồn — vd bấm lại lần hai).
  const moved = p.moved.filter(m => m.entry_id && m.from_location_id !== p.to_location_id)
  if (!moved.length) return 0
  const at = p.at ?? new Date().toISOString()
  try {
    // Bổ sung phần mô tả còn thiếu — một câu cho cả lô, không N+1.
    const need = moved.filter(m => !m.pallet_code).map(m => m.entry_id)
    const snap = new Map<string, EntrySnap>()
    for (let i = 0; i < need.length; i += 300) {
      const { data } = await db.from('InventoryEntry')
        .select(`id, pallet_code, material_id, cartons_remaining,
                 material:Material!material_id(material_code, short_name, base_unit, entry_unit, units_per_carton)`)
        .in('id', need.slice(i, i + 300))
      for (const e of ((data ?? []) as unknown as EntrySnap[])) snap.set(e.id, e)
    }
    // Ô ĐÍCH: mã + kho + loại kho (sổ cắt scope theo `warehouse_id` + `categories`, thiếu là dòng
    // này biến mất khỏi màn của chính người vừa làm).
    const { data: destRaw } = await db.from('Location')
      .select('location_code, warehouse_id, categories').eq('id', p.to_location_id).maybeSingle()
    const dest = destRaw as { location_code?: string | null; warehouse_id?: string | null; categories?: string[] | null } | null

    // Mã ô nguồn còn thiếu (caller chỉ có id)
    const fromNeed = [...new Set(moved.filter(m => m.from_location_id && !m.from_location_code)
      .map(m => m.from_location_id as string))]
    const fromCode = new Map<string, string | null>()
    for (let i = 0; i < fromNeed.length; i += 300) {
      const { data } = await db.from('Location')
        .select('id, location_code').in('id', fromNeed.slice(i, i + 300))
      for (const l of ((data ?? []) as { id: string; location_code: string | null }[])) fromCode.set(l.id, l.location_code)
    }

    const rows = moved.map(m => {
      const e = snap.get(m.entry_id)
      return {
        id: randomUUID(),
        entry_id: m.entry_id,
        pallet_code: m.pallet_code ?? e?.pallet_code ?? m.entry_id,   // NOT NULL
        location_id: p.to_location_id,                                // ô pallet ĐANG đứng sau khi chuyển
        location_code: dest?.location_code ?? null,
        warehouse_id: dest?.warehouse_id ?? null,
        categories: dest?.categories ?? null,
        material_id: m.material_id ?? e?.material_id ?? null,
        material_code: m.material_code ?? e?.material?.material_code ?? null,
        short_name: m.short_name ?? e?.material?.short_name ?? null,
        base_unit: m.base_unit ?? e?.material?.base_unit ?? null,
        entry_unit: m.entry_unit ?? e?.material?.entry_unit ?? null,
        units_per_carton: m.units_per_carton ?? e?.material?.units_per_carton ?? null,
        app_qty: Number(m.app_qty ?? e?.cartons_remaining ?? 0),
        physical_qty: null,     // không đếm số lượng — đây là vết ĐỔI CHỖ, không phải lượt đếm
        diff: null,
        is_flagged: false,
        note: p.note,
        location_changed_to: p.to_location_id,   // khoá của tab Lịch sử chuyển vị trí
        location_from_id: m.from_location_id ?? null,
        location_from_code: m.from_location_code ?? (m.from_location_id ? fromCode.get(m.from_location_id) ?? null : null),
        counted_by: p.actor_id,
        counted_by_name: p.actor_name,
        counted_at: at, created_at: at, updated_at: at,
      }
    })
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('StocktakeLog').insert(rows.slice(i, i + 500))
      if (error) throw new Error(error.message)
    }
    if (p.mark_stocktake) {
      const patch = { stocktake_at: at, updated_at: at, ...(p.actor_id ? { stocktake_by: p.actor_id } : {}) }
      const ids = moved.map(m => m.entry_id)
      for (let i = 0; i < ids.length; i += 300)
        await db.from('InventoryEntry').update(patch).in('id', ids.slice(i, i + 300))
    }
    return rows.length
  } catch (e) {
    recordBackgroundFailure(`Ghi sổ chuyển vị trí hỏng (${p.note})`, 'MOVE_LOG_FAILED', p.where, e)
    return 0
  }
}
