// AI ĐANG LÀM trên kế hoạch điều vận (16/10 tối, user: "hiện tên người đang làm ok") — Presence của Supabase Realtime trên kênh riêng tư
// `wms-dispatch-<planId>` (policy 20261016b). Mỗi bàn đang mở kế hoạch "track" { id, name, mode, at } — mode 'edit' khi bàn ở chế độ sửa
// (nháp / đã bấm Sửa), 'view' khi chỉ xem. Không ghi DB, không qua PostgREST. Trả danh sách NGƯỜI KHÁC, gộp theo người: một người có
// nhiều bản ghi (hai tab, hoặc bản của kết nối CŨ còn treo trên server vài chục giây sau khi tải lại trang — đo 16/10: > 45 s) thì lấy bản
// MỚI NHẤT theo `at`, không lấy "sửa thắng xem". Rời trang (pagehide) gỡ presence chủ động để người khác hết thấy ngay.
import { useEffect, useState } from 'react'
import { supabaseClient } from '@/lib/supabase'

export type DispatchPresence = { id: string; name: string; mode: 'edit' | 'view' }
type Tracked = { id?: string; name?: string; mode?: string; at?: number }

export function useDispatchPresence(planId: string | null, me: { id: string; name: string } | null, editing: boolean): DispatchPresence[] {
  const [others, setOthers] = useState<DispatchPresence[]>([])
  const myId = me?.id ?? '', myName = me?.name ?? ''
  useEffect(() => {
    const sb = supabaseClient
    if (!sb || !planId || !myId) { setOthers([]); return }
    const ch = sb.channel(`wms-dispatch-${planId}`, { config: { private: true, presence: { key: myId } } })
    const sync = () => {
      const state = ch.presenceState<Tracked>()
      const by = new Map<string, DispatchPresence & { at: number }>()
      for (const [key, metas] of Object.entries(state)) {
        if (key === myId) continue
        for (const m of metas) {
          const at = typeof m.at === 'number' ? m.at : 0
          const cur = by.get(key)
          if (!cur || at > cur.at) by.set(key, { id: key, name: m.name || key, mode: m.mode === 'edit' ? 'edit' : 'view', at })
        }
      }
      setOthers([...by.values()].sort((a, b) => (a.mode === b.mode ? a.name.localeCompare(b.name, 'vi') : a.mode === 'edit' ? -1 : 1)).map(({ id, name, mode }) => ({ id, name, mode })))
    }
    const leave = () => { void ch.untrack(); void sb.removeChannel(ch) }
    ch.on('presence', { event: 'sync' }, sync)
      .subscribe(status => { if (status === 'SUBSCRIBED') void ch.track({ id: myId, name: myName, mode: editing ? 'edit' : 'view', at: Date.now() }) })
    window.addEventListener('pagehide', leave)
    return () => { window.removeEventListener('pagehide', leave); setOthers([]); leave() }
    // editing đổi ⇒ track lại ở effect dưới (không mở lại kênh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, myId, myName])
  useEffect(() => {
    if (!supabaseClient || !planId || !myId) return
    const ch = supabaseClient.getChannels().find(c => c.topic === `realtime:wms-dispatch-${planId}`)
    if (ch && ch.state === 'joined') void ch.track({ id: myId, name: myName, mode: editing ? 'edit' : 'view', at: Date.now() })
  }, [planId, myId, myName, editing])
  return others
}
