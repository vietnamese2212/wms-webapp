// sapFlow — nạp bảng ánh xạ mã SAP → flow (LookupValue type=sap_flow_map, seed migration 20260922) và bộ tra ĐVVT
// theo TransportCompany (code / alias_codes / tên). Là DỮ LIỆU: thêm mã SAP mới = thêm dòng danh mục, không sửa code.
import { db } from '../lib/supabase'
import { normDvvt } from '../utils/sapUnits'
import { isFlow, LOADABLE_FLOWS, type Flow } from './zsd02Parse'

const TTL_MS = 30_000
let flowCache: { at: number; map: Map<string, Flow> } | null = null

export async function loadSapFlowMap(): Promise<Map<string, Flow>> {
  if (flowCache && Date.now() - flowCache.at < TTL_MS) return flowCache.map
  const map = new Map<string, Flow>()
  const { data, error } = await db.from('LookupValue').select('value, meta').eq('type', 'sap_flow_map')
  if (error) throw new Error(error.message)
  for (const row of data ?? []) {
    const meta = (row.meta ?? {}) as { flow?: unknown }
    if (isFlow(meta.flow)) map.set(String(row.value).trim().toUpperCase(), meta.flow)
  }
  flowCache = { at: Date.now(), map }
  return map
}
export function invalidateSapFlowCache(): void { flowCache = null }

/** DO có dòng ACTIVE mang flow KHÔNG lên xe (RETURN · DISCOUNT · UNKNOWN) → Map do → flow. Dòng VL06O (flow NULL) coi là
 *  lên xe được (không có thông tin để cấm). Kế hoạch xuất (upload + thêm dòng) gọi để TỪ CHỐI DO đó kèm lý do. */
export async function notLoadableDos(dos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const uniq = [...new Set(dos.map(d => String(d ?? '').trim()).filter(Boolean))]
  for (let i = 0; i < uniq.length; i += 300) {
    const { data, error } = await db.from('erp_outbound_orders').select('od_number, flow')
      .in('od_number', uniq.slice(i, i + 300)).eq('sync_status', 'ACTIVE').not('flow', 'is', null)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const f = String(r.flow ?? '')
      // một DO có MỌI dòng đều không lên xe mới bị chặn — DO trộn (pallet Loscam + hàng bán) vẫn đi bình thường
      if (!LOADABLE_FLOWS.has(f)) { if (!out.has(r.od_number)) out.set(r.od_number, f) }
      else out.set(r.od_number, '')
    }
  }
  for (const [k, v] of [...out]) if (!v) out.delete(k)
  return out
}
export const FLOW_LABEL: Record<string, string> = {
  SALE: 'bán hàng', STO: 'chuyển kho', INTERNAL: 'nội bộ', RETURN: 'TRẢ VỀ (chiều nhập)', DISCOUNT: 'CHIẾT KHẤU (không có hàng)', PALLET: 'pallet đi cùng', UNKNOWN: 'CHƯA PHÂN LOẠI (khai ở Cài đặt WMS → Hệ thống)',
}

/** normDvvt(chuỗi trong file) → TransportCompany.code. Khớp code, alias_codes, và cả TÊN đã bỏ dấu
 *  ("Đông Á"/"ĐÔNG Á" → DA · "HAI AN"/"Hải An" → HA). Không khớp → null (cửa nạp cảnh báo "ĐVVT lạ"). */
export async function makeDvvtResolver(): Promise<(norm: string) => string | null> {
  const { data, error } = await db.from('TransportCompany').select('code, name, alias_codes, type').eq('is_active', true)
  if (error) throw new Error(error.message)
  const byKey = new Map<string, string>()
  const put = (k: string | null, code: string) => { if (k && !byKey.has(k)) byKey.set(k, code) }
  // code trước, alias sau, tên cuối — để tên trùng mã của đơn vị khác không đè
  for (const c of data ?? []) put(normDvvt(c.code), c.code)
  for (const c of data ?? []) for (const a of (c.alias_codes ?? [])) put(normDvvt(a), c.code)
  for (const c of data ?? []) put(normDvvt(c.name), c.code)
  return (norm: string) => byKey.get(norm) ?? null
}
