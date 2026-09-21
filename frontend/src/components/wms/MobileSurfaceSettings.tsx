// CẤU HÌNH BỀ MẶT ĐIỆN THOẠI — superadmin chọn TRANG / TAB nào hiện trên điện thoại và 6 ô thanh dưới
// (user chốt 21/09/2026: "module nào — kể cả tab nhỏ — hiện trên điện thoại do superadmin config";
// ẨN chứ không chặn route; toàn đơn vị). Registry: config/mobileSurface.ts · cờ: SystemSetting
// `mobile_surface` (BE gác superadmin).
//
// HÌNH THỨC (user chốt 21/09 vòng 4, theo màn "Views" của AppSheet — sau khi bác Switch+chip "xấu quá" rồi
// hỏi "Hiện · Thanh dưới là gì?" ở bảng tick):
//   · THANH DƯỚI (primary navigation) = danh sách CÓ THỨ TỰ tối đa 6 ô — kéo thả / ↑↓ đổi chỗ, [+] thêm,
//     ✕ bỏ; kèm bản xem trước đúng hình thanh đáy điện thoại để người cấu hình thấy ngay mình đang xếp gì.
//   · MENU ☰ = CÂY TICK CHA–CON trang → tab như bản trước (user: "menu thì như thế kia là được"): tick = hiện,
//     tick dở = một phần tab đang ẩn; nút nhỏ "đưa lên thanh dưới" ở dòng trang chưa lên thanh.
//
// LƯU ĐI CHUNG THANH "LƯU THAY ĐỔI" CỦA TAB HỆ THỐNG: component CONTROLLED, nháp + dirty + lưu do SystemTab
// (WMSSettings.tsx) cầm — một tab một nút Lưu (bản đầu có nút Lưu riêng bị thanh đáy che, user tưởng đã lưu).
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, GripVertical, PanelBottom, Plus, Smartphone, X } from 'lucide-react'
import { SettingsGroup } from '@/components/shared/SettingRow'
import { SingleSelect } from '@/components/shared/SingleSelect'
import {
  MOBILE_PAGES, MOBILE_PAGE_BY_TO, BOTTOM_NAV_DEFAULT, BOTTOM_NAV_MAX, BOTTOM_NAV_SHORT_LABEL,
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

const shortOf = (p: MobilePageDef) => BOTTOM_NAV_SHORT_LABEL[p.to] ?? p.label

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

/** Nút icon nhỏ dùng chung trong hai danh sách */
function IconBtn({ onClick, title, disabled, danger, children }: {
  onClick: () => void; title: string; disabled?: boolean; danger?: boolean; children: ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className={`h-6 w-6 inline-flex items-center justify-center rounded ${danger ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-sky-700 hover:bg-sky-50'} disabled:opacity-25 disabled:hover:bg-transparent`}>
      {children}
    </button>
  )
}

export function MobileSurfaceSettings({ canEdit, value, onChange }: {
  canEdit: boolean
  value: MobileSurfaceDraft
  onChange: (next: MobileSurfaceDraft) => void
}) {
  const hidden = useMemo(() => new Set(value.hidden), [value.hidden])
  const bar = shownBottom(value)                       // đủ dài (kể cả ô dự phòng thứ 7 của mặc định)
  const barPages = bar.map(to => MOBILE_PAGE_BY_TO.get(to)).filter((p): p is MobilePageDef => !!p)
  const barFull = bar.length >= BOTTOM_NAV_MAX

  const [adding, setAdding] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  const setHidden = (next: Set<string>) => onChange({ ...value, hidden: [...next] })
  const setBar = (next: string[]) => onChange({ ...value, bottom: next })
  const toggleKey = (k: string, show: boolean) => { const n = new Set(hidden); if (show) n.delete(k); else n.add(k); setHidden(n) }

  const hidePage = (to: string) => onChange({ hidden: [...value.hidden, to], bottom: value.bottom.filter(x => x !== to) })
  // Ô tick CHA ba trạng thái: tắt → hiện trang (tab giữ nguyên) · tick dở (một phần tab ẩn) → hiện lại MỌI tab · đủ → ẩn trang (+ rời thanh dưới)
  const togglePage = (p: MobilePageDef) => {
    const pageOn = !hidden.has(p.to)
    const offTabs = p.tabs.filter(t => hidden.has(tabKey(p.to, t.key)))
    if (!pageOn) { toggleKey(p.to, true); return }
    if (offTabs.length) { const n = new Set(hidden); for (const t of offTabs) n.delete(tabKey(p.to, t.key)); setHidden(n); return }
    hidePage(p.to)
  }
  const addToBar = (to: string) => { if (!barFull && !bar.includes(to)) setBar([...bar, to]) }
  const removeFromBar = (to: string) => setBar(bar.filter(x => x !== to))
  const moveBar = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= bar.length || to >= bar.length) return
    const n = [...bar]; const [it] = n.splice(from, 1); n.splice(to, 0, it); setBar(n)
  }
  const groups = useMemo(() => {
    const m = new Map<string, MobilePageDef[]>()
    for (const p of MOBILE_PAGES) { const arr = m.get(p.group) ?? []; arr.push(p); m.set(p.group, arr) }
    return [...m.entries()]
  }, [])
  const hiddenPages = MOBILE_PAGES.filter(p => hidden.has(p.to))
  const hiddenTabs = MOBILE_PAGES.reduce((n, p) => n + (hidden.has(p.to) ? 0 : p.tabs.filter(t => hidden.has(tabKey(p.to, t.key))).length), 0)
  const addable = MOBILE_PAGES.filter(p => !hidden.has(p.to) && !bar.includes(p.to))

  return (
    <SettingsGroup
      title={<span className="flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Điện thoại — điều hướng & trang hiển thị</span>}
      tip={<>Chỉ áp cho màn nhỏ hơn 1024 px (điện thoại / PDA), máy tính không đổi. <b>Thanh dưới</b> = dải tối đa {BOTTOM_NAV_MAX} ô icon sát đáy màn điện thoại, bấm một nhát không cần mở menu. <b>Menu ☰</b> = cây tick mọi trang và tab: bỏ tick = ẩn khỏi điện thoại nhưng <b>không chặn</b> — người có quyền vẫn mở được qua link từ thông báo. Muốn cấm hẳn thì dùng phân quyền. Mỗi người chỉ thấy ô mình có quyền. Áp cho <b>cả đơn vị</b>, chỉ superadmin sửa; lưu bằng nút <b>Lưu thay đổi</b> ở đáy tab.</>}
      className="sm:col-span-2 xl:col-span-3">
      <div className="py-2 grid gap-4 md:grid-cols-[minmax(280px,340px)_1fr]">

        {/* ── THANH DƯỚI (primary navigation) ─────────────────────────────────────────────── */}
        <section className="rounded-md border border-slate-200 bg-white overflow-hidden self-start">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 border-b border-slate-200">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-800">Thanh dưới</span>
            <span className={`text-[10px] tabular-nums ${barFull ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>{Math.min(bar.length, BOTTOM_NAV_MAX)}/{BOTTOM_NAV_MAX} ô</span>
            {canEdit && (
              <button type="button" onClick={() => setAdding(a => !a)} disabled={barFull || !addable.length}
                title={barFull ? `Đã đủ ${BOTTOM_NAV_MAX} ô — bỏ một ô trước` : 'Thêm trang vào thanh dưới'}
                className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-sky-700 hover:bg-sky-50 disabled:opacity-30">
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Xem trước đúng hình thanh đáy điện thoại */}
          <div className="px-3 pt-3 pb-2">
            <div className="mx-auto max-w-[300px] rounded-xl border border-slate-300 bg-slate-50 px-1 py-1.5 flex items-center justify-around shadow-inner">
              {barPages.slice(0, BOTTOM_NAV_MAX).map((p, i) => {
                const Icon = p.icon
                return (
                  <div key={p.to} className={`flex flex-col items-center gap-0.5 w-[46px] ${i === 0 ? 'text-sky-700' : 'text-slate-600'}`} title={p.label}>
                    <Icon className="h-4 w-4" />
                    <span className="text-[8px] leading-none whitespace-nowrap truncate max-w-full">{shortOf(p)}</span>
                  </div>
                )
              })}
              {barPages.length === 0 && <span className="text-[10px] text-slate-400 py-1">Thanh dưới trống</span>}
            </div>
            <p className="mt-1 text-center text-[9px] text-slate-400">Xem trước — thứ tự trái → phải như danh sách dưới</p>
          </div>

          {adding && canEdit && (
            <div className="px-2 pb-2">
              <SingleSelect
                options={addable.map(p => ({ value: p.to, label: `${p.label} · ${p.group}` }))}
                value=""
                placeholder="Chọn trang thêm vào thanh dưới…"
                onChange={v => { if (v) addToBar(v); setAdding(false) }}
                triggerClassName="w-full" />
            </div>
          )}

          <ol className="divide-y divide-slate-100 border-t border-slate-100">
            {barPages.map((p, i) => {
              const Icon = p.icon
              const spare = i >= BOTTOM_NAV_MAX
              return (
                <li key={p.to}
                  draggable={canEdit}
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={e => { if (dragIdx !== null) { e.preventDefault(); setOverIdx(i) } }}
                  onDragLeave={() => setOverIdx(null)}
                  onDrop={e => { e.preventDefault(); if (dragIdx !== null) moveBar(dragIdx, i); setDragIdx(null); setOverIdx(null) }}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                  className={`flex items-center gap-1.5 px-2 py-1 ${spare ? 'opacity-50' : ''} ${overIdx === i && dragIdx !== i ? 'bg-sky-50 border-t-2 border-t-sky-400' : ''} ${dragIdx === i ? 'opacity-40' : ''}`}>
                  {canEdit ? <GripVertical className="h-3.5 w-3.5 text-slate-300 cursor-grab shrink-0" /> : <span className="w-3.5" />}
                  <span className="w-4 text-center text-[10px] tabular-nums font-semibold text-sky-700">{spare ? '·' : i + 1}</span>
                  <Icon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span className="text-xs text-slate-800 truncate min-w-0 flex-1">
                    {p.label}
                    {shortOf(p) !== p.label && <span className="ml-1 text-[10px] text-slate-400">({shortOf(p)})</span>}
                    {spare && <span className="ml-1 text-[10px] text-amber-600" title={`Ô thứ ${i + 1} — chỉ hiện khi người dùng thiếu quyền một ô phía trên`}>dự phòng</span>}
                  </span>
                  {canEdit && (
                    <>
                      <IconBtn onClick={() => moveBar(i, i - 1)} disabled={i === 0} title="Lên"><ArrowUp className="h-3 w-3" /></IconBtn>
                      <IconBtn onClick={() => moveBar(i, i + 1)} disabled={i === barPages.length - 1} title="Xuống"><ArrowDown className="h-3 w-3" /></IconBtn>
                      <IconBtn onClick={() => removeFromBar(p.to)} title="Bỏ khỏi thanh dưới (trang vẫn còn trong menu ☰)" danger><X className="h-3.5 w-3.5" /></IconBtn>
                    </>
                  )}
                </li>
              )
            })}
          </ol>
          {canEdit && <p className="px-2 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">Kéo thả hoặc ↑↓ để đổi chỗ · ✕ chỉ bỏ khỏi thanh dưới, không ẩn trang.</p>}
        </section>

        {/* ── MENU ☰ = CÂY TICK CHA–CON trang → tab (user 21/09 vòng 4: "menu thì như thế kia là được") ── */}
        <section className="rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 border-b border-slate-200">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-800">Menu ☰ trên điện thoại</span>
            <span className="text-[10px] text-slate-400 tabular-nums">
              tick = hiện · {MOBILE_PAGES.length - hiddenPages.length}/{MOBILE_PAGES.length} trang{hiddenTabs ? ` · ${hiddenTabs} tab đang ẩn` : ''}
            </span>
          </div>
          <div className="grid gap-x-4 lg:grid-cols-2 xl:grid-cols-3 px-2 py-1">
            {groups.map(([group, pages]) => (
              <div key={group} className="py-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 px-1 py-1">{group}</div>
                <div className="divide-y divide-slate-100">
                  {pages.map(p => {
                    const Icon = p.icon
                    const pageOn = !hidden.has(p.to)
                    const offTabs = p.tabs.filter(t => hidden.has(tabKey(p.to, t.key))).length
                    const barPos = bar.indexOf(p.to)
                    return (
                      <div key={p.to} className="px-1 py-1">
                        {/* Dòng CHA = trang */}
                        <div className="flex items-center gap-2 min-h-6">
                          <label className={`flex items-center gap-2 min-w-0 flex-1 ${canEdit ? 'cursor-pointer' : ''}`}>
                            <Tick checked={pageOn && offTabs === 0} indeterminate={pageOn && offTabs > 0} disabled={!canEdit}
                              title={pageOn && offTabs > 0 ? `${offTabs} tab đang ẩn — bấm để hiện lại hết` : pageOn ? 'Ẩn trang khỏi điện thoại (menu ☰ và thanh dưới)' : 'Hiện lại trang'}
                              onChange={() => togglePage(p)} />
                            <Icon className={`h-3.5 w-3.5 shrink-0 ${pageOn ? 'text-slate-500' : 'text-slate-300'}`} />
                            <span className={`text-xs truncate ${pageOn ? 'text-slate-800 font-medium' : 'text-slate-400 line-through'}`}>{p.label}</span>
                          </label>
                          {pageOn && barPos >= 0 && barPos < BOTTOM_NAV_MAX && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-semibold tabular-nums whitespace-nowrap" title="Đang ở thanh dưới">ô {barPos + 1}</span>
                          )}
                          {canEdit && pageOn && barPos < 0 && (
                            <IconBtn onClick={() => addToBar(p.to)} disabled={barFull} title={barFull ? `Thanh dưới đã đủ ${BOTTOM_NAV_MAX} ô` : 'Đưa lên thanh dưới'}>
                              <PanelBottom className="h-3.5 w-3.5" />
                            </IconBtn>
                          )}
                        </div>
                        {/* Dòng CON = tab (thụt vào; trang tắt thì mờ và khoá) */}
                        {p.tabs.length > 0 && (
                          <div className={`ml-6 mt-0.5 ${pageOn ? '' : 'opacity-40'}`}>
                            {p.tabs.map(t => {
                              const k = tabKey(p.to, t.key); const on = !hidden.has(k)
                              return (
                                <label key={k} className={`flex items-center gap-2 py-0.5 ${canEdit && pageOn ? 'cursor-pointer' : ''}`}>
                                  <Tick checked={on} disabled={!canEdit || !pageOn} onChange={v => toggleKey(k, v)} />
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
        </section>
      </div>
      {!canEdit && <p className="pb-2 text-[11px] text-slate-400">Chỉ superadmin sửa được phần này.</p>}
    </SettingsGroup>
  )
}
