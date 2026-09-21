// CẤU HÌNH BỀ MẶT ĐIỆN THOẠI — superadmin chọn TRANG / TAB nào hiện trên điện thoại và 6 ô thanh dưới
// (user chốt 21/09/2026: "module nào — kể cả tab nhỏ — hiện trên điện thoại do superadmin config";
// ẨN chứ không chặn route; toàn đơn vị). Registry: config/mobileSurface.ts · cờ: SystemSetting
// `mobile_surface` (BE gác superadmin). Tự lưu riêng (không đi chung thanh Lưu của tab Hệ thống) vì
// cờ này chỉ superadmin ghi — người có manage_system nhìn thấy nhưng không sửa được.
//
// HÌNH THỨC = CÂY CHECKBOX CHA–CON (user chốt 21/09 vòng 2: "cho tôi dạng checkbox hết đi — dạng cha con
// module-tab"; bản đầu dùng Switch + chip bị bác "xấu quá"): mỗi TRANG một dòng có ô tick (tick dở khi
// một phần tab tắt), TAB là dòng con thụt vào cũng ô tick; cột phải "Thanh dưới" cũng là ô tick kèm số
// thứ tự — tick theo thứ tự nào thì ô đứng theo thứ tự đó, ↑↓ để đổi chỗ.
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsGroup } from '@/components/shared/SettingRow'
import { useSystemSettings, useUpdateSystemSetting } from '@/api/hooks'
import { toast } from '@/components/ui/use-toast'
import {
  MOBILE_PAGES, BOTTOM_NAV_DEFAULT, BOTTOM_NAV_MAX, BOTTOM_NAV_SHORT_LABEL,
  parseMobileSurface, tabKey, type MobilePageDef, type MobileSurface,
} from '@/config/mobileSurface'

const apiMsg = (e: unknown) => {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message ?? err?.message ?? 'Lỗi không xác định'
}
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Ô tick chuẩn của cây (native checkbox — có indeterminate, bàn phím, 16 px vừa tay). */
function Tick({ checked, indeterminate, disabled, onChange, title }: {
  checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: (v: boolean) => void; title?: string
}) {
  return (
    <input type="checkbox" checked={checked} disabled={disabled} title={title}
      ref={el => { if (el) el.indeterminate = !!indeterminate && !checked }}
      onChange={e => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 rounded border-slate-300 accent-sky-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" />
  )
}

export function MobileSurfaceSettings({ canEdit }: { canEdit: boolean }) {
  const { data: settings = [] } = useSystemSettings()
  const { mutateAsync: save, isPending } = useUpdateSystemSetting()
  const row = settings.find(s => s.key === 'mobile_surface')
  const srv = useMemo(() => parseMobileSurface(row?.value), [row?.value])

  const [hidden, setHidden] = useState<Set<string>>(new Set(srv.hidden))
  const [bottom, setBottom] = useState<string[]>(srv.bottom_nav ?? BOTTOM_NAV_DEFAULT)
  const [err, setErr] = useState('')
  const srvKey = JSON.stringify(srv)
  useEffect(() => { setHidden(new Set(srv.hidden)); setBottom(srv.bottom_nav ?? BOTTOM_NAV_DEFAULT) }, [srvKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const bottomShown = bottom.filter(to => !hidden.has(to))
  const dirty = !sameList([...hidden].sort(), [...srv.hidden].sort()) || !sameList(bottomShown, srv.bottom_nav ?? BOTTOM_NAV_DEFAULT)

  const setKey = (k: string, show: boolean) => setHidden(prev => { const n = new Set(prev); if (show) n.delete(k); else n.add(k); return n })
  const togglePage = (p: MobilePageDef, show: boolean) => {
    setKey(p.to, show)
    if (!show) setBottom(prev => prev.filter(x => x !== p.to))   // trang ẩn thì không còn trên thanh dưới
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

  const apply = async () => {
    setErr('')
    const bottom_nav = bottomShown.slice(0, BOTTOM_NAV_MAX)
    const value: MobileSurface = { hidden: [...hidden], bottom_nav: sameList(bottom_nav, BOTTOM_NAV_DEFAULT) ? null : bottom_nav }
    try { await save({ key: 'mobile_surface', value }); toast({ title: 'Đã lưu bố cục điện thoại — áp cho mọi người khi tải lại app' }) }
    catch (e) { setErr(apiMsg(e)) }
  }
  const reset = () => { setHidden(new Set(srv.hidden)); setBottom(srv.bottom_nav ?? BOTTOM_NAV_DEFAULT); setErr('') }

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
      tip={<>Chỉ áp cho màn nhỏ hơn 1024 px (điện thoại / PDA). Bỏ tick một trang thì nó <b>biến mất khỏi menu ☰ và thanh dưới</b>; bỏ tick một tab thì tab đó biến mất khỏi dải tab của trang — nhưng <b>không chặn</b>: người có quyền vẫn mở được qua link từ thông báo hay "Về Việc cần làm". Muốn cấm hẳn thì dùng phân quyền. Cấu hình áp cho <b>cả đơn vị</b>, chỉ superadmin sửa.</>}
      className="sm:col-span-2 xl:col-span-3">
      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 my-2">{err}</p>}

      <div className="py-2">
        <p className="text-[11px] text-slate-500 leading-snug">
          Cột <b>Hiện</b>: trang / tab có bày ra trên điện thoại không (tick dở = một phần tab đang tắt). Cột <b>Thanh dưới</b>: tối đa {BOTTOM_NAV_MAX} ô,
          số = thứ tự từ trái sang phải, tick theo thứ tự nào thì ô xếp theo thứ tự đó (↑↓ để đổi chỗ). Mỗi người chỉ thấy thứ mình có quyền.
          {(hiddenPages || hiddenTabs) ? <> · Đang tắt <b>{hiddenPages}</b> trang, <b>{hiddenTabs}</b> tab.</> : null}
        </p>

        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(([group, pages]) => (
            <div key={group} className="rounded-md border border-slate-200 overflow-hidden bg-white">
              <div className="grid grid-cols-[1fr_auto] items-center px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <span>{group}</span>
                <span className="text-right">Hiện · Thanh dưới</span>
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
                          <Tick checked={pageOn} indeterminate={pageOn && offTabs > 0 && offTabs < p.tabs.length} disabled={!canEdit}
                            onChange={v => togglePage(p, v)} />
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

      {canEdit && (
        <div className="py-2 flex items-center justify-end gap-2">
          {dirty && <span className="text-[11px] text-amber-600 mr-auto">Có thay đổi chưa lưu · thanh dưới: {bottomShown.length}/{BOTTOM_NAV_MAX} ô</span>}
          <Button size="sm" variant="outline" className="h-8" disabled={!dirty || isPending} onClick={reset}>Hoàn lại</Button>
          <Button size="sm" className="h-8" disabled={!dirty || isPending} onClick={apply}>{isPending ? 'Đang lưu…' : 'Lưu bố cục điện thoại'}</Button>
        </div>
      )}
      {!canEdit && <p className="py-2 text-[11px] text-slate-400">Chỉ superadmin sửa được phần này.</p>}
    </SettingsGroup>
  )
}
