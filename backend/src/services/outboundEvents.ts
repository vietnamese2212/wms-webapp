// SỔ SỰ KIỆN CHUYẾN XUẤT (user chốt 03/08): "DO trên chuyến phải tracking được — thay đổi thế nào,
// bởi ai, lúc nào, nguồn nào". Mọi nơi làm đổi kế hoạch/đơn xuất gọi logOutboundEvents tại CHÍNH chỗ
// biết được thay đổi (tầng nào biết thì tầng đó ghi) — đừng cố suy lại ở nơi khác, sẽ mất "ai" và "vì sao".
//
// Ghi sổ là AUGMENT: hỏng sổ KHÔNG được làm hỏng nghiệp vụ (bọc try/catch, chỉ log lỗi).
import { randomUUID } from 'crypto'
import type { Request } from 'express'
import { supabase } from '../lib/supabase'

export type EventSource = 'PLAN' | 'SAP' | 'USER' | 'SYSTEM'
export type OutboundEventInput = {
  group_code: string
  gdo_id?: string | null
  event_type: string
  source: EventSource
  actor?: string | null
  do_number?: string | null
  material_code?: string | null
  old_value?: string | number | null
  new_value?: string | number | null
  detail: string
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : String(v))

export async function logOutboundEvents(events: OutboundEventInput[]): Promise<void> {
  if (!events.length) return
  const t = new Date().toISOString()
  const rows = events.map(e => ({
    id: randomUUID(),
    gdo_id: e.gdo_id ?? null,
    group_code: e.group_code,
    event_type: e.event_type,
    source: e.source,
    actor: e.actor ?? null,
    do_number: e.do_number ?? null,
    material_code: e.material_code ?? null,
    old_value: str(e.old_value),
    new_value: str(e.new_value),
    detail: e.detail,
    created_at: t, updated_at: t,
  }))
  // Chunk 500 như mọi ghi hàng loạt (upload đè cả nghìn xe = cả nghìn sự kiện)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('outbound_events').insert(rows.slice(i, i + 500))
    if (error) { console.error('[outbound_events]', error.message); return }
  }
}

// Người thao tác: tên user đăng nhập; nguồn tự động thì truyền nhãn (vd 'SAP-UPLOAD').
export const actorOf = (req: Request, fallback = 'Hệ thống'): string => req.user?.name || fallback
