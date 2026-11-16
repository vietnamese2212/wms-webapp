// TRANG "CÀI ĐẶT MES" (14/11/2026 tối — user: "setting nào liên quan thì chuyển sang Cài đặt MES").
// Gom mọi cấu hình của Sản xuất về MỘT trang, MỘT nút Lưu:
//   • Đóng gói rút bán thành phẩm khỏi bồn còn lô CHỜ QA — 2 tầng Kho chế biến + Loại kho (trước ở Cài đặt WMS).
//     Lô QA LOẠI luôn chặn — không có công tắc.
//   • Hạn lưu bồn (giờ) theo mã bán thành phẩm (trước ở form Mã hàng) — áp cho mọi kho.
//   • Tab "Mẫu phiếu theo dõi" (14/11 khuya): ô · đơn vị · ngưỡng · bảng theo dõi của các phiếu theo dõi mẻ — một nút Lưu riêng của tab.
// Danh mục bồn vẫn ở trang Bồn (đó là danh mục, không phải cấu hình).
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { Save, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { SettingsGroup, SettingRow } from '@/components/shared/SettingRow'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useMaterials } from '@/api/hooks'
import { useProductionWarehouses, useProductionSettings, useSaveProductionSettings, defaultKitchen, type ProductionSettings as Settings } from '@/api/productionHooks'
import { useMobileTabs } from '@/hooks/useMobileSurface'
import { ProcessFormSettings } from '@/components/wms/production/ProcessFormSettings'
import { unitLabel } from '@/utils/qtyUnits'

const GATE_OPTS = [
  { value: 'WARN',  label: 'Cảnh báo',   sub: 'cho rót, báo người đóng trang — ghi vào sổ bồn' },
  { value: 'BLOCK', label: 'Chặn',       sub: 'không rút được tới khi QA thả' },
  { value: 'OFF',   label: 'Không kiểm', sub: 'xưởng không giữ QA bán thành phẩm' },
] as const
const gateLabel = (v: string | null | undefined) => GATE_OPTS.find(o => o.value === v)?.label ?? '—'
const INHERIT = '__inherit__'
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được — thử lại'
type HoldRow = Settings['hold_hours'][number]
const TABS = [{ key: 'general' as const, label: 'Chung' }, { key: 'forms' as const, label: 'Mẫu phiếu theo dõi' }]

export default function ProductionSettings() {
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canConfigure = can(perms, 'production', 'configure')
  const { data: { kitchens } } = useProductionWarehouses()
  const [whPick, setWhPick] = useState(() => useGlobalScopeStore.getState().warehouseId ?? '')
  const wh = kitchens.some(k => k.id === whPick) ? whPick : defaultKitchen(kitchens, whPick)
  const q = useProductionSettings(wh || undefined)
  const save = useSaveProductionSettings()
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'general' | 'forms'>('general')
  const tabs = useMobileTabs('/wms/production/settings', TABS, tab, setTab)

  // BẢN NHÁP — một nút Lưu cho cả trang
  const [gate, setGate] = useState('WARN')
  const [typeGate, setTypeGate] = useState<Record<string, string | null>>({})
  const [hours, setHours] = useState<Record<string, string>>({})   // material_id → giờ ('' = gỡ hạn)
  const [added, setAdded] = useState<HoldRow[]>([])                // mã thêm mới, chưa lưu
  const server = q.data
  const stamp = server ? JSON.stringify(server) : ''
  useEffect(() => {
    if (!server) return
    setGate(server.production_qa_gate)
    setTypeGate(Object.fromEntries(server.types.map(t => [t.type_code, t.production_qa_gate])))
    setHours(Object.fromEntries(server.hold_hours.map(m => [m.id, String(m.tank_hold_hours ?? '')])))
    setAdded([]); setErr('')
  }, [stamp])   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => [...(server?.hold_hours ?? []), ...added], [server, added])
  const hoursErr = (v: string) => (v.trim() === '' ? '' : /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 8760 ? '' : 'Số giờ nguyên từ 1 tới 8.760')
  const changes = useMemo(() => {
    if (!server) return null
    const types = server.types.filter(t => (typeGate[t.type_code] ?? null) !== t.production_qa_gate)
      .map(t => ({ type_code: t.type_code, production_qa_gate: typeGate[t.type_code] ?? null }))
    const hold = rows.map(m => ({ m, v: (hours[m.id] ?? '').trim() }))
      .filter(({ m, v }) => v !== String(m.tank_hold_hours ?? ''))
      .map(({ m, v }) => ({ material_id: m.id, tank_hold_hours: v === '' ? null : Number(v) }))
    return { gate: gate !== server.production_qa_gate ? gate : undefined, types, hold }
  }, [server, gate, typeGate, hours, rows])
  const dirty = !!changes && (changes.gate !== undefined || changes.types.length > 0 || changes.hold.length > 0)
  const invalid = rows.some(m => hoursErr(hours[m.id] ?? ''))

  function onSave() {
    if (!changes || !wh) return
    setErr('')
    save.mutate({ warehouse_id: wh, production_qa_gate: changes.gate, types: changes.types.length ? changes.types : undefined, hold_hours: changes.hold.length ? changes.hold : undefined },
      { onError: e => setErr(apiMsg(e)) })
  }

  // thêm mã bán thành phẩm vào bảng hạn lưu — tìm trên server
  const [matTerm, setMatTerm] = useState('')
  const [matPick, setMatPick] = useState('')
  const { data: found = [], isFetching } = useMaterials({ search: matTerm || undefined, limit: 50 }, canConfigure)
  const have = new Set(rows.map(r => r.id))
  const matOpts = found.filter(m => ['L', 'KG'].includes(String(m.base_unit ?? '').toUpperCase()) && !have.has(m.id))
    .map(m => ({ value: m.id, label: m.material_code, sub: `${m.short_name ?? m.material_description ?? ''} · ${unitLabel(m.base_unit)}` }))
  function addMat(id: string) {
    const m = found.find(x => x.id === id)
    if (!m) return
    setAdded(a => [...a, { id: m.id, material_code: m.material_code, short_name: m.short_name ?? null, category: m.category ?? null, base_unit: m.base_unit ?? null, tank_hold_hours: null }])
    setHours(h => ({ ...h, [m.id]: '' }))
    setMatPick('')
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-700 shrink-0">Cài đặt MES</span>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium shrink-0">
              {tabs.map((t, i) => (
                <button key={t.key} type="button" onClick={() => setTab(t.key)}
                  className={`h-9 sm:h-7 px-3 whitespace-nowrap ${i > 0 ? 'border-l border-slate-200 ' : ''}${tab === t.key ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t.label}</button>
              ))}
            </div>
            {tab === 'general' && kitchens.length > 1 && (
              <div className="flex-1 min-w-0 max-w-56">
                <SingleSelect value={wh} onChange={setWhPick} triggerClassName="h-9 sm:h-7" placeholder="Chọn kho chế biến"
                  options={kitchens.map(k => ({ value: k.id, label: k.name, sub: k.parent_name ? `thuộc ${k.parent_name}` : undefined }))} />
              </div>
            )}
            {tab === 'general' && kitchens.length === 1 && <span className="text-xs text-slate-500 truncate min-w-0" title={kitchens[0].name}>{kitchens[0].name}</span>}
            {tab === 'general' && canConfigure && (
              <Button className="ml-auto h-9 sm:h-7 text-xs shrink-0" disabled={!dirty || invalid || save.isPending} onClick={onSave}>
                <Save className="h-3.5 w-3.5 mr-1" />{save.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-3 pb-20 lg:pb-4">
          {tab === 'forms' ? <div className="max-w-6xl"><ProcessFormSettings canConfigure={canConfigure} /></div> : <div className="max-w-3xl space-y-3">
            {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
            {q.isError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{apiMsg(q.error)}</div>}
            {!kitchens.length && <p className="text-xs text-amber-700">Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho → "Trực thuộc kho".</p>}
            {!canConfigure && !!kitchens.length && <p className="text-[11px] text-slate-500">Bạn chỉ có quyền xem — sửa cần quyền "Cài đặt MES".</p>}
            {q.isLoading && !!wh && <p className="text-xs text-slate-400">Đang tải…</p>}

            {server && (
              <SettingsGroup title="Đóng gói rút bán thành phẩm khỏi bồn"
                tip={<>Áp khi một trang Sổ đóng gói khai lượng rút từ bồn của kho chế biến này (lúc bấm Giờ kết thúc, và lúc sửa lượng rút sau đó).
                  Loại kho = loại của mã bán thành phẩm trong bồn. Cảnh báo được ghi vào sổ bồn.</>}>
                <SettingRow label="Bồn còn lô CHỜ QA"
                  desc={<>Bồn còn lô bán thành phẩm QA chưa kết luận mà trang sổ vẫn rút: <b>Cảnh báo</b> = cho rót, báo người đóng trang · <b>Chặn</b> = không rút được tới khi QA thả.</>}>
                  <SingleSelect value={gate} onChange={setGate} disabled={!canConfigure} triggerClassName="h-8" searchable={false} options={[...GATE_OPTS]} />
                </SettingRow>
                {server.types.map(t => {
                  const v = typeGate[t.type_code] ?? null
                  return (
                    <SettingRow key={t.type_code}
                      label={<>Riêng Loại kho <span className="font-mono">{t.type_code}</span>{v !== null && <span className="ml-1 rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700">riêng</span>}</>}
                      control={<div className="w-44 sm:w-56">
                        <SingleSelect value={v ?? INHERIT} onChange={x => setTypeGate(s => ({ ...s, [t.type_code]: x === INHERIT ? null : x }))}
                          disabled={!canConfigure} triggerClassName="h-8" searchable={false}
                          options={[{ value: INHERIT, label: `Theo kho (${gateLabel(gate)})` }, ...GATE_OPTS]} />
                      </div>} />
                  )
                })}
                <SettingRow label="Bồn có lô QA LOẠI"
                  desc={<>Luôn <b>chặn</b> rút cho đóng gói và chặn nạp thêm — không có công tắc. Muốn dùng lại lô (kể cả hạ cấp) thì QA phải đổi kết luận ở trang mẻ; không dùng được thì xả bỏ ở trang Bồn.</>} />
              </SettingsGroup>
            )}

            {server && (
              <SettingsGroup title="Hạn lưu bồn theo mã bán thành phẩm"
                tip={<>Số giờ một mẻ được nằm trong bồn kể từ lúc nạp. Quá hạn <b>chỉ cảnh báo</b> khi rút cho đóng gói và tô đỏ ở trang Bồn — không chặn.
                  Áp cho mọi kho. Mã không có trong bảng = không giới hạn.</>}>
                {!rows.length && <p className="py-2 text-[11px] text-slate-400">Chưa mã nào khai hạn lưu bồn — mọi mã đang không giới hạn.</p>}
                {rows.map(m => {
                  const v = hours[m.id] ?? ''
                  const e = hoursErr(v)
                  return (
                    <SettingRow key={m.id}
                      label={<><span className="font-mono">{m.material_code}</span> <span className="font-normal text-slate-600 truncate">{m.short_name ?? ''}</span></>}
                      desc={e ? <span className="text-red-600">{e}</span> : v.trim() === '' ? <span className="text-amber-700">Để trống = không giới hạn{m.tank_hold_hours != null ? ' (sẽ gỡ hạn khi Lưu)' : ''}</span> : undefined}
                      control={<>
                        <Input value={v} onChange={ev => setHours(h => ({ ...h, [m.id]: ev.target.value }))} disabled={!canConfigure}
                          inputMode="numeric" placeholder="∞" className="h-8 w-20 text-xs text-right tabular-nums" aria-label={`Hạn lưu bồn của ${m.material_code} (giờ)`} />
                        <span className="text-[11px] text-slate-500">giờ</span>
                        {canConfigure && (
                          <button type="button" className="touch-target inline-flex items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                            title="Gỡ hạn lưu của mã này" onClick={() => setHours(h => ({ ...h, [m.id]: '' }))}><X className="h-3.5 w-3.5" /></button>
                        )}
                      </>} />
                  )
                })}
                {canConfigure && (
                  <SettingRow label={<><Plus className="h-3.5 w-3.5 text-slate-400" />Thêm mã bán thành phẩm</>}>
                    <SingleSelect value={matPick} onChange={addMat} serverSearch onSearchChange={setMatTerm} loading={isFetching} selectedLabel={undefined}
                      triggerClassName="h-8" placeholder="Tìm mã hoặc tên (chỉ mã tính L / KG)" options={matOpts} />
                  </SettingRow>
                )}
              </SettingsGroup>
            )}
          </div>}
        </div>
      </div>
    </div>
  )
}
