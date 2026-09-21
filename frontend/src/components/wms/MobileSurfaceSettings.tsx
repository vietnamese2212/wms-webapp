// CẤU HÌNH BỀ MẶT ĐIỆN THOẠI — superadmin chọn TRANG / TAB nào hiện trên điện thoại và 6 ô thanh dưới
// (user chốt 21/09/2026: "module nào — kể cả tab nhỏ — hiện trên điện thoại do superadmin config";
// ẨN chứ không chặn route; toàn đơn vị). Registry: config/mobileSurface.ts · cờ: SystemSetting
// `mobile_surface` (BE gác superadmin). Tự lưu riêng (không đi chung thanh Lưu của tab Hệ thống) vì
// cờ này chỉ superadmin ghi — người có manage_system nhìn thấy nhưng không sửa được.
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Smartphone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsGroup, SettingRow } from '@/components/shared/SettingRow'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useSystemSettings, useUpdateSystemSetting } from '@/api/hooks'
import { toast } from '@/components/ui/use-toast'
import {
  MOBILE_PAGES, BOTTOM_NAV_DEFAULT, BOTTOM_NAV_MAX, BOTTOM_NAV_SHORT_LABEL,
  parseMobileSurface, tabKey, type MobileSurface,
} from '@/config/mobileSurface'

const apiMsg = (e: unknown) => {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message ?? err?.message ?? 'Lỗi không xác định'
}
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

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

  const dirty = !sameList([...hidden].sort(), [...srv.hidden].sort()) || !sameList(bottom, srv.bottom_nav ?? BOTTOM_NAV_DEFAULT)
  const toggle = (k: string, show: boolean) => setHidden(prev => { const n = new Set(prev); if (show) n.delete(k); else n.add(k); return n })

  // Thanh dưới: chỉ trang ĐANG HIỆN mới chọn được; trang bị ẩn tự rời thanh
  const bottomShown = bottom.filter(to => !hidden.has(to))
  const bottomOpts = MOBILE_PAGES.filter(p => !hidden.has(p.to) && !bottomShown.includes(p.to))
    .map(p => ({ value: p.to, label: `${p.group} · ${p.label}` }))
  const move = (i: number, d: -1 | 1) => setBottom(prev => {
    const list = prev.filter(to => !hidden.has(to)); const j = i + d
    if (j < 0 || j >= list.length) return prev
    const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n
  })

  const apply = async () => {
    setErr('')
    const bottom_nav = bottomShown.slice(0, BOTTOM_NAV_MAX)
    const value: MobileSurface = {
      hidden: [...hidden],
      bottom_nav: sameList(bottom_nav, BOTTOM_NAV_DEFAULT) ? null : bottom_nav,
    }
    try { await save({ key: 'mobile_surface', value }); toast({ title: 'Đã lưu bố cục điện thoại — áp cho mọi người khi tải lại app' }) }
    catch (e) { setErr(apiMsg(e)) }
  }
  const reset = () => { setHidden(new Set(srv.hidden)); setBottom(srv.bottom_nav ?? BOTTOM_NAV_DEFAULT); setErr('') }

  const hiddenPages = MOBILE_PAGES.filter(p => hidden.has(p.to)).length
  const hiddenTabs = MOBILE_PAGES.reduce((n, p) => n + p.tabs.filter(t => hidden.has(tabKey(p.to, t.key))).length, 0)

  return (
    <SettingsGroup
      title={<span className="flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Điện thoại — trang & tab hiển thị</span>}
      tip={<>Chỉ áp cho màn nhỏ hơn 1024 px (điện thoại / PDA). Trang bị tắt <b>biến mất khỏi menu ☰ và thanh dưới</b>, tab bị tắt biến mất khỏi dải tab của trang đó — nhưng <b>không chặn</b>: người có quyền vẫn mở được qua link từ thông báo hay "Về Việc cần làm". Muốn cấm thì dùng phân quyền. Cấu hình áp cho <b>cả đơn vị</b>, chỉ superadmin sửa.</>}
      className="sm:col-span-2 xl:col-span-3">
      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 my-2">{err}</p>}

      <SettingRow label="Thanh dưới (bottom-nav)"
        desc={`Tối đa ${BOTTOM_NAV_MAX} ô, thứ tự từ trái sang phải. Mỗi người chỉ thấy ô mình có quyền — ô thiếu quyền tự bỏ, không để trống.`}>
        <div className="space-y-1">
          {bottomShown.map((to, i) => {
            const p = MOBILE_PAGES.find(x => x.to === to)
            const Icon = p?.icon
            return (
              <div key={to} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1">
                <span className="text-[10px] text-slate-400 w-4 tabular-nums">{i + 1}</span>
                {Icon && <Icon className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                <span className="text-xs font-medium text-slate-800 truncate flex-1 min-w-0">
                  {BOTTOM_NAV_SHORT_LABEL[to] ?? p?.label ?? to}
                  <span className="text-slate-400 font-normal"> · {p?.group} › {p?.label}</span>
                </span>
                {canEdit && (
                  <>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Lên"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === bottomShown.length - 1} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30" aria-label="Xuống"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setBottom(bottomShown.filter(x => x !== to))} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600" aria-label="Bỏ khỏi thanh"><X className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
            )
          })}
          {canEdit && bottomShown.length < BOTTOM_NAV_MAX && bottomOpts.length > 0 && (
            <SingleSelect options={bottomOpts} value="" placeholder="+ Thêm ô vào thanh dưới…"
              onChange={v => { if (v) setBottom([...bottomShown, v]) }} triggerClassName="w-full" />
          )}
          {bottomShown.length >= BOTTOM_NAV_MAX && <p className="text-[10px] text-slate-400">Đã đủ {BOTTOM_NAV_MAX} ô (vừa màn 360 px) — bỏ một ô để thêm ô khác.</p>}
        </div>
      </SettingRow>

      <SettingRow label="Trang & tab trên điện thoại"
        desc={hiddenPages || hiddenTabs
          ? `Đang tắt ${hiddenPages} trang · ${hiddenTabs} tab. Trang tắt thì mọi tab của nó tắt theo.`
          : 'Mặc định mọi trang/tab người dùng có quyền đều hiện. Tắt thứ người trong kho không dùng trên điện thoại để menu ngắn lại.'}>
        <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(MOBILE_PAGES.reduce<Record<string, typeof MOBILE_PAGES>>((acc, p) => { (acc[p.group] ??= []).push(p); return acc }, {}))
            .map(([group, pages]) => (
              <div key={group} className="rounded-md border border-slate-200 overflow-hidden">
                <div className="px-2 py-1 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group}</div>
                <div className="divide-y divide-slate-100">
                  {pages.map(p => {
                    const Icon = p.icon
                    const pageOn = !hidden.has(p.to)
                    return (
                      <div key={p.to} className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span className={`text-xs flex-1 min-w-0 truncate ${pageOn ? 'text-slate-800 font-medium' : 'text-slate-400 line-through'}`}>{p.label}</span>
                          <Switch checked={pageOn} disabled={!canEdit} onCheckedChange={v => toggle(p.to, v)} className="scale-90" />
                        </div>
                        {p.tabs.length > 0 && pageOn && (
                          <div className="mt-1 ml-5 flex flex-wrap gap-1">
                            {p.tabs.map(t => {
                              const k = tabKey(p.to, t.key); const on = !hidden.has(k)
                              return (
                                <button key={k} type="button" disabled={!canEdit} onClick={() => toggle(k, !on)}
                                  title={on ? 'Đang hiện — bấm để tắt trên điện thoại' : 'Đang tắt trên điện thoại — bấm để hiện'}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] leading-4 transition-colors ${
                                    on ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-400 line-through'} ${canEdit ? 'hover:border-sky-400' : 'cursor-default'}`}>
                                  {t.label}
                                </button>
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
      </SettingRow>

      {canEdit && (
        <div className="py-2 flex items-center justify-end gap-2">
          {dirty && <span className="text-[11px] text-amber-600 mr-auto">Có thay đổi chưa lưu</span>}
          <Button size="sm" variant="outline" className="h-8" disabled={!dirty || isPending} onClick={reset}>Hoàn lại</Button>
          <Button size="sm" className="h-8" disabled={!dirty || isPending} onClick={apply}>{isPending ? 'Đang lưu…' : 'Lưu bố cục điện thoại'}</Button>
        </div>
      )}
      {!canEdit && <p className="py-2 text-[11px] text-slate-400">Chỉ superadmin sửa được phần này.</p>}
    </SettingsGroup>
  )
}
