// CẤU HÌNH BỀ MẶT ĐIỆN THOẠI — superadmin chọn TRANG / TAB nào hiện trên điện thoại và 6 ô thanh dưới
// (user chốt 21/09/2026: "module nào — kể cả tab nhỏ — hiện trên điện thoại do superadmin config";
// ẨN chứ không chặn route; toàn đơn vị). Registry: config/mobileSurface.ts · cờ: SystemSetting
// `mobile_surface` (BE gác superadmin).
//
// HÌNH THỨC = CÂY CHECKBOX CHA–CON (user chốt 21/09 vòng 2: "cho tôi dạng checkbox hết đi — dạng cha con
// module-tab"; bản đầu dùng Switch + chip bị bác "xấu quá"): mỗi TRANG một dòng có ô tick (tick dở khi
// một phần tab tắt), TAB là dòng con thụt vào cũng ô tick; cột phải "Thanh dưới" cũng là ô tick kèm số
// thứ tự — tick theo thứ tự nào thì ô đứng theo thứ tự đó, ↑↓ để đổi chỗ.
//
// LƯU ĐI CHUNG THANH "LƯU THAY ĐỔI" CỦA TAB HỆ THỐNG (user hỏi 21/09 vòng 3: "cái này có cần lưu không?"):
// bản đầu khối này có nút Lưu RIÊNG nằm cuối khối, bị thanh Lưu dính đáy của tab che mất, trong khi thanh
// đó vẫn in "Đã lưu" — hai nút Lưu trên một màn thì người dùng tin cái đang nhìn thấy. Nay component là
// CONTROLLED: nháp + dirty + lưu do SystemTab (WMSSettings.tsx) cầm, cùng một nút với mọi cờ khác.
import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Smartphone } from 'lucide-react'
import { SettingsGroup } from '@/components/shared/SettingRow'
import {
  MOBILE_PAGES, BOTTOM_NAV_DEFAULT, BOTTOM_NAV_MAX, BOTTOM_NAV_SHORT_LABEL,
  tabKey, type MobilePageDef, type MobileSurface,
} from '@/config/mobileSurface'

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Nháp trên màn — `hidden` = khoá trang/tab đang tắt, `bottom` = thứ tự ô thanh dưới (có thể chứa trang đã tắt, lọc khi dùng). */
export interface MobileSurfaceDraft { hidden: string[]; bottom: string[] }

export const msfDraftOf = (srv: MobileSurface): MobileSurfaceDraft => ({ hidden: [...srv.hidden], bottom: [...(srv.bottom_nav ?? BOTTOM_NAV_DEFAULT)] })
// KHÔNG cắt `slice(0, MAX)` ở đây: BOTTOM_NAV_DEFAULT cố ý dài hơn MAX (ô dự phòng khi người dùng thiếu quyền một
// ô) — cắt trước khi so với mặc định là "dirty" ngay lúc mở trang (đo Preview 21/09: thanh đáy báo chưa lưu khi chưa đụng gì).
const shownBottom = (d: MobileSurfaceDraft) => d.bottom.filter(to => !d.hidden.includes(to))
export const msfDirty = (d: MobileSurfaceDraft, srv: MobileSurface) =>
  !sameList([...d.hidden].sort(), [...srv.hidden].sort()) || !sameList(shownBottom(d), srv.bottom_nav ?? BOTTOM_NAV_DEFAULT)
/** Giá trị gửi lên cờ — thanh dưới trùng mặc định thì ghi null để đơn vị khác đổi mặc định vẫn hưởng. */
export const msfValueOf = (d: MobileSurfaceDraft): MobileSurface => {
  const shown = shownBottom(d)
  return { hidden: [...d.hidden], bottom_nav: sameList(shown, BOTTOM_NAV_DEFAULT) ? null : shown.slice(0, BOTTOM_NAV_MAX) }
}

/** Ô tick chuẩn của cây (native checkbox — có indeterminate, bàn phím, 16 px vừa tay). */
function Tick({ checked, indeterminate, disabled, onChange, title }: {
  checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: (v: boolean) => void; title?: string
}) {
  return (
    <input type="checkbox" checked={checked} disabled={disabled} title={title}
      ref={el => { if (el) el.indeterminate = !!indeterminate }}
      onChange={e => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 rounded border-slate-300 accent-sky-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" />
  )
}

export function MobileSurfaceSettings({ canEdit, value, onChange }: {
  canEdit: boolean
  value: MobileSurfaceDraft
  onChange: (next: MobileSurfaceDraft) => void
}) {
  const hidden = useMemo(() => new Set(value.hidden), [value.hidden])
  const bottomShown = shownBottom(value)

  const setHidden = (f: (prev: Set<string>) => Set<string>) => onChange({ ...value, hidden: [...f(new Set(value.hidden))] })
  const setBottom = (f: (prev: string[]) => string[]) => onChange({ ...value, bottom: f(value.bottom) })
  const setKey = (k: string, show: boolean) => setHidden(prev => { if (show) prev.delete(k); else prev.add(k); return prev })
  // Ô tick CHA ba trạng thái: tắt → bật trang (tab giữ nguyên) · tick dở (một phần tab tắt) → bật lại MỌI tab · đủ → tắt trang
  const togglePage = (p: MobilePageDef) => {
    const pageOn = !hidden.has(p.to)
    const offTabs = p.tabs.filter(t => hidden.has(tabKey(p.to, t.key)))
    if (!pageOn) { setKey(p.to, true); return }
    if (offTabs.length) { setHidden(prev => { for (const t of offTabs) prev.delete(tabKey(p.to, t.key)); return prev }); return }
    // tắt trang = rời luôn thanh dưới, một lần onChange cho cả hai
    onChange({ hidden: [...value.hidden, p.to], bottom: value.bottom.filter(x => x !== p.to) })
  }
  const toggleBottom = (to: string, on: boolean) => setBottom(prev => {
    const list = prev.filter(x => !hidden.has(x))
    if (on) return list.includes(to) || list.length >= BOTTOM_NAV_MAX ? list : [...list, to]
    return list.filter(x => x !== to)
  })
  const move = (to: string, d: -1 | 1) => setBottom(prev => {
    const list = prev.filter(x => !hidden.has(x)); const i = list.indexOf(to); const j = i + d
    if (i < 0 || j < 0 || j >= list.length) return prev
    const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n
  })

  const hiddenPages = MOBILE_PAGES.filter(p => hidden.has(p.to)).length
  const hiddenTabs = MOBILE_PAGES.reduce((n, p) => n + (hidden.has(p.to) ? 0 : p.tabs.filter(t => hidden.has(tabKey(p.to, t.key))).length), 0)
  const groups = useMemo(() => {
    const m = new Map<string, MobilePageDef[]>()
    for (const p of MOBILE_PAGES) { const arr = m.get(p.group) ?? []; arr.push(p); m.set(p.group, arr) }
    return [...m.entries()]
  }, [])

  return (
    <SettingsGroup
      title={<span className="flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Điện thoại — trang & tab hiển thị</span>}
      tip={<>Chỉ áp cho màn nhỏ hơn 1024 px (điện thoại / PDA). Bỏ tick một trang thì nó <b>biến mất khỏi menu ☰ và thanh dưới</b>; bỏ tick một tab thì tab đó biến mất khỏi dải tab của trang — nhưng <b>không chặn</b>: người có quyền vẫn mở được qua link từ thông báo hay "Về Việc cần làm". Muốn cấm hẳn thì dùng phân quyền. Cấu hình áp cho <b>cả đơn vị</b>, chỉ superadmin sửa. Thay đổi ở đây lưu bằng nút <b>Lưu thay đổi</b> ở đáy tab, cùng với các cờ khác.</>}
      className="sm:col-span-2 xl:col-span-3">
      <div className="py-2">
        <p className="text-[11px] text-slate-500 leading-snug">
          Ô tick <b>bên trái</b> mỗi dòng = trang / tab có bày ra trên điện thoại không (tick dở = một phần tab đang tắt).
          Cột <b>Thanh dưới</b> bên phải = trang có đứng trên thanh điều hướng đáy màn không: tối đa {BOTTOM_NAV_MAX} ô, số là thứ tự
          từ trái sang phải, tick theo thứ tự nào thì ô xếp theo thứ tự đó (↑↓ để đổi chỗ). Mỗi người chỉ thấy thứ mình có quyền.
          {(hiddenPages || hiddenTabs) ? <> · Đang tắt <b>{hiddenPages}</b> trang, <b>{hiddenTabs}</b> tab.</> : null}
          {' '}· Thanh dưới: <b>{bottomShown.length}/{BOTTOM_NAV_MAX}</b> ô.
        </p>

        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(([group, pages]) => (
            <div key={group} className="rounded-md border border-slate-200 overflow-hidden bg-white">
              <div className="grid grid-cols-[1fr_92px] items-center px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <span className="truncate">Hiện · {group}</span>
                <span className="text-right" title={`Tối đa ${BOTTOM_NAV_MAX} ô; số = thứ tự trái → phải`}>Thanh dưới</span>
              </div>
              <div className="divide-y divide-slate-100">
                {pages.map(p => {
                  const Icon = p.icon
                  const pageOn = !hidden.has(p.to)
                  const offTabs = p.tabs.filter(t => hidden.has(tabKey(p.to, t.key))).length
                  const idx = bottomShown.indexOf(p.to)
                  const onBar = idx >= 0
                  const barFull = bottomShown.length >= BOTTOM_NAV_MAX
                  return (
                    <div key={p.to} className="px-2 py-1">
                      {/* Dòng CHA = trang */}
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <label className={`flex items-center gap-2 min-w-0 ${canEdit ? 'cursor-pointer' : ''}`}>
                          <Tick checked={pageOn && offTabs === 0} indeterminate={pageOn && offTabs > 0} disabled={!canEdit}
                            title={pageOn && offTabs > 0 ? `${offTabs} tab đang tắt — bấm để bật lại hết` : undefined}
                            onChange={() => togglePage(p)} />
                          <Icon className={`h-3.5 w-3.5 shrink-0 ${pageOn ? 'text-slate-500' : 'text-slate-300'}`} />
                          <span className={`text-xs truncate ${pageOn ? 'text-slate-800 font-medium' : 'text-slate-400 line-through'}`}>{p.label}</span>
                        </label>
                        <div className="flex items-center justify-end gap-1 w-[92px]">
                          {onBar && canEdit && (
                            <>
                              <button type="button" onClick={() => move(p.to, -1)} disabled={idx === 0} className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-25" aria-label="Lên"><ArrowUp className="h-3 w-3" /></button>
                              <button type="button" onClick={() => move(p.to, 1)} disabled={idx === bottomShown.length - 1} className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-25" aria-label="Xuống"><ArrowDown className="h-3 w-3" /></button>
                            </>
                          )}
                          <span className={`w-4 text-center text-[10px] tabular-nums font-semibold ${onBar ? 'text-sky-700' : 'text-transparent'}`}>{onBar ? idx + 1 : '·'}</span>
                          <Tick checked={onBar} disabled={!canEdit || !pageOn || (!onBar && barFull)}
                            title={!pageOn ? 'Trang đang tắt' : (!onBar && barFull) ? `Đã đủ ${BOTTOM_NAV_MAX} ô — bỏ tick một ô khác trước` : `Ô "${BOTTOM_NAV_SHORT_LABEL[p.to] ?? p.label}" trên thanh dưới`}
                            onChange={v => toggleBottom(p.to, v)} />
                        </div>
                      </div>
                      {/* Dòng CON = tab (thụt vào; trang tắt thì mờ và khoá) */}
                      {p.tabs.length > 0 && (
                        <div className={`ml-6 mt-0.5 ${pageOn ? '' : 'opacity-40'}`}>
                          {p.tabs.map(t => {
                            const k = tabKey(p.to, t.key); const on = !hidden.has(k)
                            return (
                              <label key={k} className={`flex items-center gap-2 py-0.5 ${canEdit && pageOn ? 'cursor-pointer' : ''}`}>
                                <Tick checked={on} disabled={!canEdit || !pageOn} onChange={v => setKey(k, v)} />
                                <span className={`text-[11px] ${on ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{t.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {!canEdit && <p className="pb-2 text-[11px] text-slate-400">Chỉ superadmin sửa được phần này.</p>}
    </SettingsGroup>
  )
}
