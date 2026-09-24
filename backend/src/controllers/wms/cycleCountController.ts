// CYCLE COUNTING THEO ABC (Đợt 3 roadmap 06/08) — kiểm kê LUÂN PHIÊN thay kiểm full:
// mã hạng A (nhặt nhiều — sai lệch gây hại nhất) kiểm 7 ngày/lần, B 30 ngày, C 90 ngày.
//
// Nguồn dữ liệu GHÉP, không tính lại:
//   · Hạng ABC = RPC slotting_stats (công thức 80/95% lượt nhặt lũy kế — MỘT nguồn, không chép);
//   · Lần kiểm gần nhất per mã + vị trí đang chứa mã = RPC cycle_count_info (StocktakeLog append-only).
// Màn này CHỈ ĐỌC + nút "Kiểm" prefill bộ lọc Tổng hợp KK phía FE (không API write mới)
// → dùng quyền stocktake.view, KHÔNG cần permission mới.
import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { maskServerMessage } from '../../utils/response'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { parseListParam } from '../../utils/httpQuery'
import { safeFilterValue } from '../../utils/search'
import { getCycleCountCfg } from '../../utils/settings'

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status, res) } })
}

// Chu kỳ kiểm theo hạng + cửa sổ phân hạng = cờ `cycle_count` (mặc định A7/B30/C90, cửa sổ 30
// ngày — Cài đặt WMS › Hệ thống, đợt 2 chống hardcode 13/08).

function guardWarehouse(req: Request, res: Response, warehouseId: string): boolean {
  if (req.user?.warehouse_scope === 'ASSIGNED' && !(req.user.warehouse_ids ?? []).includes(warehouseId)) {
    fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền')
    return false
  }
  return true
}

interface StatsMaterial {
  material_id: string; code: string; name: string | null; category: string | null
  picks: number; stock_pallets: number; stock_cartons: number; abc: 'A' | 'B' | 'C'
}

// GET /wms/stocktake/cycle?warehouse_id=&categories=
export async function getCycleCount(req: Request, res: Response) {
  try {
    const warehouseId = String(req.query.warehouse_id ?? '')
    if (!warehouseId) return fail(res, 400, 'INVALID_INPUT', 'Thiếu warehouse_id')
    if (!guardWarehouse(req, res, warehouseId)) return
    const scopeCats = scopeCategoriesOf(req)
    // safeFilterValue: ký tự điều khiển (%00…) xuống Postgres text[] là 22021 → 500 (QA 21 bắt 06/08)
    const reqCats = (parseListParam(req.query.categories) ?? []).map(c => safeFilterValue(c)).filter(Boolean)
    const effCats = scopeCats
      ? (reqCats.length > 0 ? reqCats.filter(c => scopeCats.includes(c)) : scopeCats)
      : reqCats
    if (reqCats.length > 0 && effCats.length === 0)
      return fail(res, 403, 'FORBIDDEN', 'Loại kho chọn ngoài phạm vi được phân quyền')

    const cfg = await getCycleCountCfg()
    const [statsR, infoR] = await Promise.all([
      supabase.rpc('slotting_stats', {
        p_warehouse_id: warehouseId,
        p_categories: effCats.length > 0 ? effCats : null,
        p_days: cfg.window_days,
      }),
      supabase.rpc('cycle_count_info', { p_warehouse_id: warehouseId }),
    ])
    if (statsR.error) {
      if (statsR.error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration slotting (RPC slotting_stats)')
      return fail(res, 500, 'DB_ERROR', statsR.error.message)
    }
    if (infoR.error) {
      if (infoR.error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260806c_cycle_count (RPC cycle_count_info)')
      return fail(res, 500, 'DB_ERROR', infoR.error.message)
    }

    const materials = ((statsR.data as { materials?: StatsMaterial[] } | null)?.materials ?? [])
    const info = infoR.data as {
      last_counted: { material_id: string; last_at: string }[]
      material_locs: { material_id: string; loc_ids: string[] | null; loc_codes: string[] | null }[]
    }
    const lastByMat = new Map(info.last_counted.map(r => [r.material_id, r.last_at]))
    const locsByMat = new Map(info.material_locs.map(r => [r.material_id, r]))

    const nowMs = Date.now()
    // Chỉ mã ĐANG CÓ TỒN mới cần kiểm (kiểm kê là đếm tồn thật — mã 0 tồn không có gì để đếm)
    const rows = materials.filter(m => Number(m.stock_pallets) > 0).map(m => {
      const lastAt = lastByMat.get(m.material_id) ?? null
      const cycle = cfg[m.abc]
      // KHÔNG thể "kiểm ở tương lai": lệch đồng hồ vài giây giữa máy ghi và server làm hiệu ÂM,
      // Math.floor(-0.001) = -1 ⇒ mã vừa kiểm xong hiện "kiểm 1 ngày trước" và due_in lệch 1 ngày
      // (check-app 06/08 bắt). Kẹp sàn 0.
      const daysSince = lastAt ? Math.max(0, Math.floor((nowMs - new Date(lastAt).getTime()) / 86400_000)) : null
      // due_in: âm = quá hạn N ngày; null last = chưa kiểm bao giờ → coi như quá hạn từ lâu
      const dueIn = daysSince == null ? -9999 : cycle - daysSince
      const locs = locsByMat.get(m.material_id)
      return {
        material_id: m.material_id, material_code: m.code, short_name: m.name, category: m.category,
        abc: m.abc, picks: m.picks, stock_pallets: m.stock_pallets, stock_cartons: m.stock_cartons,
        cycle_days: cycle, last_counted_at: lastAt, days_since: daysSince, due_in: dueIn,
        never_counted: daysSince == null,
        loc_ids: locs?.loc_ids ?? [], loc_codes: locs?.loc_codes ?? [],
      }
    })
    // Quá hạn nặng nhất lên đầu (chưa kiểm bao giờ = trên cùng), trong cùng mức thì hạng A trước
    rows.sort((a, b) => (a.due_in - b.due_in) || a.abc.localeCompare(b.abc) || a.material_code.localeCompare(b.material_code))

    const dueRows = rows.filter(r => r.due_in <= 0)
    return ok(res, {
      rows,
      summary: {
        total: rows.length,
        due: dueRows.length,
        due_a: dueRows.filter(r => r.abc === 'A').length,
        due_b: dueRows.filter(r => r.abc === 'B').length,
        due_c: dueRows.filter(r => r.abc === 'C').length,
        never: rows.filter(r => r.never_counted).length,
      },
      cycle_days: { A: cfg.A, B: cfg.B, C: cfg.C },
      window_days: cfg.window_days,
    })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}
