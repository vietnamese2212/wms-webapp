/**
 * ÁP QUY ĐỊNH DATE THEO MASTER CHO ĐƠN ĐANG MỞ — một thân duy nhất cho BA cửa gọi:
 *   • nút "Áp lại theo master" ở trang Quy định date (có pha kiểm-trước)
 *   • đổi `Warehouse.date_rule_policy` ở form Kho
 *   • lưu bộ mức của Khách / Kênh, hoặc đổi kênh của một khách
 *
 * Vì sao tách khỏi controller: hai cửa sau nằm bên masterdata. Controller gọi controller là đường
 * ngắn nhất tới hai bản luật lệch nhau — đúng khuôn lỗi "4 bản chép tay" của luật luân chuyển 14/08.
 *
 * User chốt 12/09: **đổi cấu hình thì phải áp NGAY**, không bắt đi bấm thêm một nút nữa. Bản 11/09
 * ngại "sửa một ô làm nghìn dòng đổi âm thầm" nên khoá lại; đo bằng người dùng thật thì cái giá của
 * việc IM LẶNG đắt hơn: bật công tắc xong màn hình y nguyên, người khai tưởng mình khai sai.
 * Ba lớp giữ cho nó không âm thầm — (1) dòng CHỐT TAY không bao giờ bị đụng (`resolveDateRule` chặn
 * ở bậc 1, kể cả với `overwriteAuto`); (2) mỗi dòng đổi ghi một sự kiện vào sổ chuyến; (3) hàm trả
 * về SỐ DÒNG đã đổi để màn hình nói ra ngay.
 */
import { db } from '../lib/supabase'
import {
  loadPolicyCtx, resolveDateRule, flagNoStock, type AutoApplied,
} from './dateRulePolicy'
import {
  dateRuleOf, describeDateRule, planGdoTasks, resetUntouchedTasksOfItems, type DateRule,
} from './directedTasks'
import { logOutboundEvents, type OutboundEventInput } from './outboundEvents'
import type { Json } from '../types/database'

const now = () => new Date().toISOString()

export const APPLY_MASTER_CAP = 5_000
// Cửa sổ của lần áp TỰ ĐỘNG: lùi 7 ngày để bắt cả chuyến cũ còn dở, tới 30 ngày cho kế hoạch đã nạp.
export const AUTO_BACK_DAYS = 7
export const AUTO_FWD_DAYS = 30
// Trần THẤP HƠN cho đường tự động: nó chạy TRONG lượt lưu cấu hình, không được biến một cú bấm Lưu
// thành 60 giây rồi 504. Quá trần thì KHÔNG ghi gì và báo `capped` để màn hình chỉ sang nút áp tay.
export const AUTO_APPLY_CAP = 2_000

export interface ApplyMasterOpts {
  from: string; to: string
  warehouseId?: string | null
  scopeWh?: string[] | null           // null = mọi kho (đường hệ thống / người phạm vi toàn quốc)
  categories?: string[] | null
  actor: string | null
  dryRun?: boolean                    // chỉ đếm, không ghi (pha kiểm-trước của nút áp tay)
  cap?: number
}
export interface ApplyMasterOutcome {
  scanned: number; applied: number; cleared: number; kept_manual: number
  updated: number; trips_replanned: number; capped: boolean
}
type LineRow = {
  item_id: string; gdo_id: string; group_code: string | null; delivery_code: string | null
  warehouse_id: string | null; shipto_party: string | null; material_id: string | null
  material_code: string | null; header_text: string | null; date_required: number | null
  date_rule: unknown; gdo_status: string
  material_category: string | null; shelf_life_days: number | null
}

const EMPTY: ApplyMasterOutcome = {
  scanned: 0, applied: 0, cleared: 0, kept_manual: 0, updated: 0, trips_replanned: 0, capped: false,
}

/**
 * Kho ĐANG BẬT áp tự động — dùng để thu hẹp phạm vi khi đổi mức của Khách/Kênh: mức chỉ có nghĩa ở
 * kho bật cờ, quét cả 153 kho rồi bỏ qua gần hết là đốt lượt truy vấn vô ích.
 */
export async function warehousesWithPolicyOn(): Promise<string[]> {
  const { data } = await db.from('Warehouse').select('id').neq('date_rule_policy', 'OFF').limit(1000)
  return ((data ?? []) as { id: string }[]).map(w => w.id)
}

export async function applyMasterToOpenOrders(o: ApplyMasterOpts): Promise<ApplyMasterOutcome> {
  const cap = o.cap ?? APPLY_MASTER_CAP
  // Phạm vi RỖNG nghĩa là "không kho nào", KHÔNG phải "mọi kho" (luật empty-scope-means-unlimited)
  if (o.scopeWh && o.scopeWh.length === 0) return { ...EMPTY }

  const rows: LineRow[] = []
  for (let page = 0; page < Math.ceil(cap / 1000); page++) {
    const { data, error } = await db.rpc('outbound_date_rule_lines', {
      p_from: o.from, p_to: o.to, p_scope_wh: o.scopeWh ?? null, p_warehouse_id: o.warehouseId ?? null,
      p_categories: o.categories && o.categories.length ? o.categories : null,
      p_state: 'ALL', p_search: null, p_limit: 1000, p_offset: page * 1000,
      // SYSTEM cũng vào tập ứng viên: mã vừa được khai hạn dùng thì dòng "không đòi mốc" do máy đặt
      // phải được áp lại theo mức thật của khách, không kẹt mãi ở mức hệ thống.
      p_source: ['CUSTOMER', 'CHANNEL', 'SYSTEM', 'UNSET'],
      p_mat_categories: null, p_kinds: null,
    })
    if (error) throw new Error(error.message)
    const got = (data ?? {}) as { rows?: LineRow[]; total?: number }
    rows.push(...(got.rows ?? []))
    if (rows.length >= Number(got.total ?? 0) || !(got.rows ?? []).length) break
  }
  if (rows.length >= cap) return { ...EMPTY, scanned: rows.length, capped: true }

  // "Giữ nguyên vì đã CHỐT TAY" phải là số THẬT để người bấm yên tâm — đếm riêng, vì tập ứng viên ở
  // trên đã LOẠI dòng MANUAL ngay trong RPC (không kéo về thứ mình không được phép đụng).
  let keptManual = 0
  {
    const { data } = await db.rpc('outbound_date_rule_lines', {
      p_from: o.from, p_to: o.to, p_scope_wh: o.scopeWh ?? null, p_warehouse_id: o.warehouseId ?? null,
      p_categories: o.categories && o.categories.length ? o.categories : null,
      p_state: 'ALL', p_search: null, p_limit: 1, p_offset: 0, p_source: ['MANUAL'],
      p_mat_categories: null, p_kinds: null,
    })
    keptManual = Number(((data ?? {}) as { total?: number }).total ?? 0)
  }

  const ctx = await loadPolicyCtx(rows.map(r => r.warehouse_id), rows.map(r => r.shipto_party))
  const actor = o.actor
  // Gom theo QUY TẮC ĐÍCH: cùng một payload thì một câu UPDATE cho cả nhóm (đừng ghi từng dòng).
  const byPayload = new Map<string, { payload: DateRule | null; rows: LineRow[] }>()
  for (const r of rows) {
    const out = resolveDateRule(ctx, {
      warehouseId: r.warehouse_id, shipto: r.shipto_party,
      headerText: r.header_text, dateRequired: r.date_required,
      category: r.material_category, shelfLifeDays: r.shelf_life_days,
      existing: r.date_rule, actor, overwriteAuto: true,
    })
    if (out.keptManual) continue      // lưới an toàn: RPC đã lọc, nhưng chốt tay không bao giờ bị đụng
    if (!out.changed) continue
    const key = JSON.stringify(out.rule ? { kind: out.rule.kind, value: out.rule.value ?? null, source: out.source } : null)
    const slot = byPayload.get(key) ?? { payload: out.rule, rows: [] }
    slot.rows.push(r); byPayload.set(key, slot)
  }
  const applied = [...byPayload.values()].filter(g => g.payload).reduce((s, g) => s + g.rows.length, 0)
  const cleared = [...byPayload.values()].filter(g => !g.payload).reduce((s, g) => s + g.rows.length, 0)
  if (o.dryRun) return { scanned: rows.length, applied, cleared, kept_manual: keptManual, updated: 0, trips_replanned: 0, capped: false }

  const t = now()
  const autoApplied: AutoApplied[] = []
  const events: OutboundEventInput[] = []
  let updated = 0
  for (const g of byPayload.values()) {
    const payload = g.payload ? { ...g.payload, set_by: actor ?? 'HỆ THỐNG', set_at: t } : null
    for (let i = 0; i < g.rows.length; i += 300) {
      const chunk = g.rows.slice(i, i + 300)
      const { error } = await db.from('OutboundItem')
        // `DateRule` là kiểu NGHIỆP VỤ, cột là jsonb — client có kiểu đòi `Json`. Ép qua `unknown`
        // (kiểu rộng vẫn bị cấm theo CLAUDE.md) chứ đừng nới kiểu DateRule ra cho vừa cột.
        .update({ date_rule: payload as unknown as Json, updated_at: t })
        .in('id', chunk.map(r => r.item_id))
      if (error) throw new Error(error.message)
      updated += chunk.length
    }
    for (const r of g.rows) {
      if (payload) autoApplied.push({ id: r.item_id, warehouse_id: r.warehouse_id, material_id: r.material_id, rule: payload })
      if (!r.group_code) continue
      events.push({
        group_code: r.group_code, gdo_id: r.gdo_id,
        event_type: payload ? 'DATE_RULE_SET' : 'DATE_RULE_CLEARED',
        source: 'SYSTEM', actor,
        do_number: r.delivery_code ?? null, material_code: r.material_code ?? null,
        old_value: describeDateRule(dateRuleOf({ date_rule: r.date_rule, date_required: r.date_required })),
        new_value: describeDateRule(payload),
        detail: payload
          ? `Áp %Date theo master (${payload.source === 'CUSTOMER' ? 'khách hàng' : 'kênh'}): ${describeDateRule(payload)}`
          : 'Áp theo master: kho không còn áp tự động cho dòng này — quay lại "chưa chốt"',
      })
    }
  }
  await logOutboundEvents(events)
  if (autoApplied.length) await flagNoStock(autoApplied)

  // Chuyến ĐANG XUẤT phải sắp lại kế hoạch ngay — bỏ việc CHƯA AI ĐỤNG trước rồi mới sắp lại, không
  // thì việc cũ (trỏ pallet theo mức date CŨ) ăn hết nhu cầu và lần áp này thành vô tác dụng.
  const live = rows.filter(r => r.gdo_status === 'IN_PROGRESS')
  const liveGdos = [...new Set(live.map(r => r.gdo_id))]
  if (liveGdos.length) {
    await resetUntouchedTasksOfItems(live.map(r => r.item_id), actor)
    for (const g of liveGdos) await planGdoTasks(g, actor)
  }
  return { scanned: rows.length, applied, cleared, kept_manual: keptManual, updated, trips_replanned: liveGdos.length, capped: false }
}

/**
 * Đường TỰ ĐỘNG chạy ngay sau khi đổi cấu hình. KHÔNG BAO GIỜ ném ra ngoài: cấu hình đã lưu xong
 * rồi, áp mức hỏng thì báo số 0 kèm lý do chứ không được làm hỏng lượt lưu.
 */
export async function autoApplyAfterConfigChange(
  opts: { warehouseId?: string | null; scopeWh?: string[] | null; actor: string | null },
): Promise<ApplyMasterOutcome & { note?: string }> {
  try {
    // Ngày VN (+7): cửa sổ tính theo ngày làm việc của kho, không theo UTC
    const d = (n: number) => new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10)
    const out = await applyMasterToOpenOrders({
      from: d(-AUTO_BACK_DAYS), to: d(AUTO_FWD_DAYS),
      warehouseId: opts.warehouseId ?? null, scopeWh: opts.scopeWh ?? null,
      actor: opts.actor, cap: AUTO_APPLY_CAP,
    })
    return out.capped
      ? { ...out, note: `Có hơn ${AUTO_APPLY_CAP.toLocaleString('vi-VN')} dòng cần xét nên chưa áp ngay — dùng nút "Áp lại theo master" ở trang Quy định date, chia nhỏ khoảng ngày.` }
      : out
  } catch (e) {
    console.error('[dateRuleApply] autoApplyAfterConfigChange:', String(e))
    return { ...EMPTY, note: 'Không áp được ngay — dùng nút "Áp lại theo master" ở trang Quy định date.' }
  }
}
