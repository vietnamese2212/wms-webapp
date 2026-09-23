// TAB "MÃ DÒNG XE" — dòng xe CON mang mã SAP, Cài đặt TMS (user chốt 23/09: "cho dòng xe con mở 1 tab là Mã dòng xe").
//
// "Các dòng xe hiện tại trở thành CHA, dưới cha có nhiều dòng CON — ở đó mới có mã SAP, tên dòng xe. Kho chỉ quan
//  tâm dòng cha để booking, đăng ký xe; điều vận mới quan tâm dòng con để làm shipment, ghép chuyến."
// Chuẩn list page (skill table-format): toolbar + FilterBar + SummaryBand + bảng cột kéo giãn, cột đầu ghim, footer đếm.
// Cha do migration 20260923b GỢI Ý theo tên (user: "tự gán đi, sai tôi vào sửa") — tick nhiều → "Gán cha" để sửa hàng loạt.
import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { FloatingActionBar, FLOATING_BTN } from '@/components/shared/FloatingActionBar'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { toast } from '@/components/ui/use-toast'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatTimestampDate } from '@/utils/formatters'
import {
  useVehicleTypes, useVehicleModels, useCreateVehicleModel, useUpdateVehicleModel, useAssignVehicleModelParent, useDeleteVehicleModel,
  type VehicleModel, type VehicleModelPatch, type VehicleModelTemp,
} from '@/api/hooks'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được'
const nf = (n: number) => n.toLocaleString('vi-VN')
const TEMP_LABEL: Record<VehicleModelTemp, string> = { HOT: 'Nóng', COLD: 'Lạnh', MIXED: 'Kết hợp', DRY: 'Khô' }
const NONE = '__none__'
const TH = 'text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

// Cột: NGHIỆP VỤ đứng trước, cột phụ (điểm giao, sửa) ra sau — phone thấy phần chính không phải kéo ngang
const COLS = [
  { id: 'pick',   label: '',                 w: 36 },
  { id: 'sap',    label: 'Mã SAP',           w: 100 },
  { id: 'name',   label: 'Tên dòng xe',      w: 230 },
  { id: 'parent', label: 'Dòng xe cha',      w: 190 },
  { id: 'temp',   label: 'Nhiệt',            w: 80 },
  { id: 'cap',    label: 'Sức chứa',         w: 130 },
  { id: 'unit',   label: 'Tính cước',        w: 150 },
  { id: 'under',  label: 'Non tải <',        w: 78 },
  { id: 'mix',    label: 'Trộn kênh',        w: 80 },
  { id: 'drops',  label: 'Điểm giao tối đa', w: 110 },
  { id: 'act',    label: 'Trạng thái',       w: 90 },
  { id: 'upd',    label: 'Sửa',              w: 110 },
  { id: 'ops',    label: '',                 w: 64 },
]

const capText = (m: VehicleModel) => {
  const parts: string[] = []
  if (m.max_pallets) parts.push(`${m.max_pallets} pallet`)
  if (m.max_tons) parts.push(`${Number(m.max_tons).toLocaleString('vi-VN')} tấn`)
  if (m.max_m3) parts.push(`${Number(m.max_m3).toLocaleString('vi-VN')} m³`)
  return parts.length ? parts.join(' · ') : null
}

function ModelForm({ row, parents, onClose }: { row: VehicleModel | null; parents: { value: string; label: string }[]; onClose: () => void }) {
  const create = useCreateVehicleModel(), update = useUpdateVehicleModel()
  const [sap, setSap] = useState(row?.sap_code ?? '')
  const [name, setName] = useState(row?.name ?? '')
  const [parent, setParent] = useState(row?.parent_type_id ?? '')
  const [temp, setTemp] = useState<VehicleModelTemp | ''>(row?.temp_mode ?? '')
  const [capMode, setCapMode] = useState<'PALLET' | 'TON'>(row?.capacity_mode ?? 'TON')
  const [pallets, setPallets] = useState(row?.max_pallets == null ? '' : String(row.max_pallets))
  const [tons, setTons] = useState(row?.max_tons == null ? '' : String(row.max_tons))
  const [m3, setM3] = useState(row?.max_m3 == null ? '' : String(row.max_m3))
  const [drops, setDrops] = useState(row?.max_drops == null ? '' : String(row.max_drops))
  const [mix, setMix] = useState(row?.allow_mix_channels ?? true)
  const [unit, setUnit] = useState<'PER_PALLET' | 'PER_TRIP'>(row?.tariff_unit ?? 'PER_TRIP')
  const [under, setUnder] = useState(String(row?.underload_pct ?? 70))
  const [active, setActive] = useState(row?.is_active ?? true)
  const [err, setErr] = useState('')
  const pending = create.isPending || update.isPending
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))
  const submit = async () => {
    setErr('')
    const body: VehicleModelPatch = {
      name: name.trim(), parent_type_id: parent || null, temp_mode: temp || null, capacity_mode: capMode,
      max_pallets: numOrNull(pallets), max_tons: numOrNull(tons), max_m3: numOrNull(m3), max_drops: numOrNull(drops),
      allow_mix_channels: mix, tariff_unit: unit, underload_pct: Number(under) || 0, is_active: active,
    }
    try {
      if (row) await update.mutateAsync({ id: row.id, ...body })
      else await create.mutateAsync({ ...body, sap_code: sap.trim(), name: name.trim() })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open onClose={onClose} title={row ? `Sửa dòng xe · ${row.sap_code}` : 'Thêm dòng xe con'}
      description="Dòng xe con mang mã SAP; sức chứa và cách tính cước dùng cho điều vận. Kho vẫn booking theo dòng xe cha."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>Huỷ</Button>
        <Button size="sm" onClick={submit} disabled={pending || !name.trim() || (!row && !sap.trim())}>{pending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Mã SAP *</Label><Input value={sap} disabled={!!row} onChange={e => setSap(e.target.value)} placeholder="910000030" className="h-9 font-mono" /></div>
          <div><Label className="text-xs">Dòng xe cha</Label><SingleSelect options={[{ value: '', label: '— Chưa gán —' }, ...parents]} value={parent} onChange={setParent} placeholder="Chưa gán" /></div>
        </div>
        <div><Label className="text-xs">Tên *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Xe 16 Pallet" className="h-9" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Nhiệt độ</Label>
            <SingleSelect searchable={false} value={temp} onChange={v => setTemp(v as VehicleModelTemp | '')}
              options={[{ value: '', label: '—' }, ...(Object.keys(TEMP_LABEL) as VehicleModelTemp[]).map(k => ({ value: k, label: TEMP_LABEL[k] }))]} /></div>
          <div><Label className="text-xs">Đo tải bằng</Label>
            <SingleSelect searchable={false} value={capMode} onChange={v => { const cm = v as 'PALLET' | 'TON'; setCapMode(cm); setUnit(cm === 'PALLET' ? 'PER_PALLET' : 'PER_TRIP') }}
              options={[{ value: 'PALLET', label: 'Pallet (xe pallet)' }, { value: 'TON', label: 'Tấn (xe xá / cont)' }]} /></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div><Label className="text-xs">Pallet tối đa</Label><Input type="number" min={1} value={pallets} onChange={e => setPallets(e.target.value)} className="h-9 tabular-nums" /></div>
          <div><Label className="text-xs">Tấn tối đa</Label><Input type="number" min={0.1} step={0.1} value={tons} onChange={e => setTons(e.target.value)} className="h-9 tabular-nums" /></div>
          <div><Label className="text-xs">m³ tối đa</Label><Input type="number" min={0.1} step={0.1} value={m3} onChange={e => setM3(e.target.value)} className="h-9 tabular-nums" /></div>
          <div><Label className="text-xs">Điểm giao tối đa</Label><Input type="number" min={1} value={drops} onChange={e => setDrops(e.target.value)} className="h-9 tabular-nums" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Tính cước</Label>
            <SingleSelect searchable={false} value={unit} onChange={v => setUnit(v as 'PER_PALLET' | 'PER_TRIP')}
              options={[{ value: 'PER_PALLET', label: 'Theo pallet (làm tròn lên)' }, { value: 'PER_TRIP', label: 'Trọn chuyến' }]} /></div>
          <div><Label className="text-xs">Non tải dưới (%)</Label><Input type="number" min={0} max={100} value={under} onChange={e => setUnder(e.target.value)} className="h-9 tabular-nums" /></div>
        </div>
        <div className="flex items-center gap-2"><Switch id="vm-mix" checked={mix} onCheckedChange={setMix} /><Label htmlFor="vm-mix" className="text-sm cursor-pointer">Cho trộn kênh (NPP + BHX cùng xe)</Label></div>
        {row && <div className="flex items-center gap-2"><Switch id="vm-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="vm-active" className="text-sm cursor-pointer">Đang hoạt động</Label></div>}
      </div>
    </FormSheet>
  )
}

export function VehicleModelsPanel({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const { data: parentsRaw = [] } = useVehicleTypes()
  const parents = useMemo(() => parentsRaw.filter(p => p.is_active).map(p => ({ value: p.id, label: p.name })), [parentsRaw])
  const parentOpts = useMemo(() => [{ value: NONE, label: 'Chưa gán cha' }, ...parentsRaw.map(p => ({ value: p.id, label: p.name }))], [parentsRaw])
  const { data, isLoading } = useVehicleModels()
  const items = data?.items ?? []
  const assign = useAssignVehicleModelParent(), del = useDeleteVehicleModel()
  const f = useWmsFilterStore(s => s.vehicleModels)
  const setF = useWmsFilterStore(s => s.setVehicleModels)
  const { widths: colW, startResize, totalWidth } = useColumnResize('vehicle_models_col_widths', COLS.map(c => c.w))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<{ row: VehicleModel | null } | null>(null)
  const [assignDlg, setAssignDlg] = useState(false)
  const [assignTo, setAssignTo] = useState('')

  // Lọc client (danh mục 60 dòng, cố định) — chưa gán cha lên đầu (việc phải làm), rồi theo cha, rồi thứ tự seed
  const rows = useMemo(() => {
    const q = f.search.trim().toLowerCase()
    const list = items.filter(m =>
      (!q || m.sap_code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      && (!f.parents.length || f.parents.includes(m.parent_type_id ?? NONE))
      && (!f.temps.length || f.temps.includes(m.temp_mode ?? NONE))
      && (!f.status || (f.status === 'active') === m.is_active)
      && (!f.capMode || m.capacity_mode === f.capMode))
    return [...list].sort((a, b) => Number(!!a.parent_type_id) - Number(!!b.parent_type_id) || (a.parent?.code ?? '').localeCompare(b.parent?.code ?? '') || a.sort_order - b.sort_order)
  }, [items, f])
  const filtering = !!(f.search || f.parents.length || f.temps.length || f.status || f.capMode)
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id))
  const doAssign = async () => {
    try {
      const r = await assign.mutateAsync({ ids: [...picked], parent_type_id: assignTo || null })
      toast({ title: assignTo ? `Đã gán cha cho ${r.updated} dòng xe` : `Đã gỡ cha khỏi ${r.updated} dòng xe` })
      setPicked(new Set()); setAssignDlg(false); setAssignTo('')
    } catch (e) { toast({ variant: 'destructive', title: 'Không gán được', description: apiMsg(e) }) }
  }

  const filterDefs: FilterDef[] = [
    { key: 'parent', label: 'Dòng xe cha', type: 'multi', selected: f.parents, onChange: v => setF({ parents: v }), options: parentOpts },
    { key: 'temp', label: 'Nhiệt', type: 'multi', selected: f.temps, onChange: v => setF({ temps: v }), searchable: false,
      options: [...(Object.keys(TEMP_LABEL) as VehicleModelTemp[]).map(k => ({ value: k, label: TEMP_LABEL[k] })), { value: NONE, label: 'Chưa khai' }] },
    { key: 'cap', label: 'Đo tải', type: 'single', value: f.capMode, onChange: v => setF({ capMode: v }), options: [{ value: 'PALLET', label: 'Pallet' }, { value: 'TON', label: 'Tấn' }] },
    { key: 'status', label: 'Trạng thái', type: 'single', value: f.status, onChange: v => setF({ status: v }), options: [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Tạm dừng' }] },
  ]
  const unassigned = items.filter(m => !m.parent_type_id && m.is_active).length
  const tiles = [
    { label: 'Dòng xe con', value: filtering ? `${nf(rows.length)} / ${nf(items.length)}` : nf(items.length) },
    { label: 'Chưa gán cha', value: nf(unassigned), danger: unassigned > 0, tip: 'Dòng chưa gán cha thì điều vận không ghép chuyến vào — kho không biết booking khung giờ loại nào' },
    { label: 'Xe pallet', value: nf(items.filter(m => m.capacity_mode === 'PALLET' && m.is_active).length), tip: 'Đo tải bằng pallet, cước theo pallet làm tròn lên' },
    { label: 'Xe tấn / cont', value: nf(items.filter(m => m.capacity_mode === 'TON' && m.is_active).length), tip: 'Đo tải bằng tấn, cước trọn chuyến' },
    { label: 'Tạm dừng', value: nf(items.filter(m => !m.is_active).length) },
  ]
  const actions: ActionItem[] = canCreate
    ? [{ key: 'add', icon: Plus, label: 'Thêm dòng con', tip: 'Thêm dòng xe con mang mã SAP', primary: true, variant: 'default', onClick: () => setForm({ row: null }) }]
    : []

  const cell = (m: VehicleModel, id: string) => {
    switch (id) {
      case 'pick':   return canEdit ? <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} className="h-3.5 w-3.5 accent-sky-600" /> : null
      case 'sap':    return <span className="font-mono font-semibold">{m.sap_code}</span>
      case 'name':   return <span className="font-medium">{m.name}</span>
      // Chỉ TÊN cha (mã để tooltip) — in cả "CONTSCA XE CONTAINER SCA" là lặp một ý hai lần (user 23/09: "kỳ cục quá")
      case 'parent': return m.parent ? <span title={m.parent.code}>{m.parent.name}</span> : <StatusBadge tone="amber">Chưa gán</StatusBadge>
      case 'temp':   return m.temp_mode ? TEMP_LABEL[m.temp_mode] : <span className="text-slate-300">—</span>
      case 'cap':    return capText(m) ?? <span className="text-slate-300">—</span>
      case 'unit':   return m.tariff_unit === 'PER_PALLET' ? 'Pallet (làm tròn lên)' : 'Trọn chuyến'
      case 'under':  return <span className="tabular-nums">{m.underload_pct} %</span>
      case 'mix':    return m.allow_mix_channels ? 'Có' : 'Không'
      case 'drops':  return m.max_drops ?? <span className="text-slate-300">—</span>
      case 'act':    return <StatusBadge tone={m.is_active ? 'green' : 'slate'}>{m.is_active ? 'Hoạt động' : 'Tạm dừng'}</StatusBadge>
      case 'upd':    return <div className="leading-tight"><div className="text-slate-600 truncate max-w-[100px]">{m.updated_by ?? <span className="text-slate-300">—</span>}</div><div className="text-[9px] text-slate-400">{formatTimestampDate(m.updated_at, true)}</div></div>
      case 'ops':    return (canEdit || canDelete) ? (
        <div className="flex items-center gap-0.5">
          {canEdit && <button className="text-slate-400 hover:text-blue-500 p-1" title="Sửa" onClick={e => { e.stopPropagation(); setForm({ row: m }) }}><Pencil className="h-3.5 w-3.5" /></button>}
          {canDelete && <button className="text-slate-400 hover:text-red-500 p-1" title="Xoá" onClick={e => { e.stopPropagation(); if (confirm(`Xoá dòng xe "${m.sap_code} · ${m.name}"?`)) del.mutate(m.id, { onError: er => toast({ variant: 'destructive', title: 'Không xoá được', description: apiMsg(er) }) }) }}><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>) : null
      default: return null
    }
  }
  // Cột ghim trái: tick + Mã SAP (giữ ngữ cảnh khi cuộn ngang trên phone)
  const stickyLeft = (i: number) => (i === 0 ? 'sticky left-0 z-10' : i === 1 ? `sticky z-10` : '')
  const stickyStyle = (i: number) => (i === 1 ? { left: colW[0] } : undefined)

  return (
    <>
      <div className="border-b px-3 py-1.5 space-y-1 sm:space-y-1.5 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm mã SAP, tên dòng xe…" className="flex-1 min-w-[160px]" />
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <FilterSheetButton defs={filterDefs} className="sm:hidden" />
            <ActionCluster items={actions} mobileInline />
          </div>
        </div>
        <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
      </div>
      <SummaryBand tiles={tiles} />
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{COLS.map((c, i) => <col key={c.id} style={{ width: colW[i] }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {COLS.map((c, i) => (
                <TableHead key={c.id} className={`${TH} ${stickyLeft(i)} bg-slate-50 ${i <= 1 ? 'z-20' : ''}`} style={stickyStyle(i)}>
                  {c.id === 'pick'
                    ? (canEdit && <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.id)))} className="h-3.5 w-3.5 accent-sky-600" />)
                    : c.label}
                  <span onPointerDown={e => startResize(i, e)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
            {!isLoading && !rows.length && (
              <TableEmptyRow colSpan={COLS.length}>{filtering ? 'Không có dòng xe khớp bộ lọc.' : 'Chưa có dòng xe con nào.'}</TableEmptyRow>
            )}
            {rows.map(m => (
              <TableRow key={m.id} className={`${m.is_active ? '' : 'text-slate-400 line-through'} ${picked.has(m.id) ? 'bg-sky-50' : ''}`}>
                {COLS.map((c, i) => (
                  <TableCell key={c.id} className={`${TD} ${stickyLeft(i)} ${i <= 1 ? (picked.has(m.id) ? 'bg-sky-50' : 'bg-white') : ''}`} style={stickyStyle(i)}>
                    {cell(m, c.id)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0 flex items-center gap-2 flex-wrap">
        <span className="whitespace-nowrap">1–{rows.length} / {items.length} dòng xe con</span>
        <span className="flex-1 min-w-0 truncate text-slate-400">Cha do máy gợi ý theo tên (cont → Xe container / container SCA · ≤ 6 pallet → Xe 4 pallet · pallet → Xe pallet · lạnh, kết hợp → Xe SCA · còn lại → Xe xá) — tick dòng sai rồi bấm Gán cha</span>
      </div>

      {canEdit && picked.size > 0 && (
        <FloatingActionBar count={picked.size} unit="dòng xe">
          <Button size="sm" variant="outline" className={`${FLOATING_BTN} gap-1`} onClick={() => setAssignDlg(true)}><Link2 className="h-3.5 w-3.5" />Gán cha</Button>
          <Button size="sm" variant="outline" className={FLOATING_BTN} onClick={() => setPicked(new Set())}>Bỏ chọn</Button>
        </FloatingActionBar>
      )}
      {assignDlg && (
        <Dialog open onOpenChange={v => { if (!v) setAssignDlg(false) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-base">Gán dòng xe cha cho {picked.size} dòng con</DialogTitle></DialogHeader>
            <SingleSelect options={[{ value: '', label: '— Gỡ cha (chưa gán) —' }, ...parents]} value={assignTo} onChange={setAssignTo} placeholder="Chọn dòng xe cha…" searchable={false} />
            <p className="text-[11px] text-slate-500">Kho sẽ booking khung giờ / đăng ký cổng theo dòng cha này khi điều vận chọn dòng con.</p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setAssignDlg(false)} disabled={assign.isPending}>Huỷ</Button>
              <Button size="sm" onClick={doAssign} disabled={assign.isPending}>{assign.isPending ? 'Đang gán…' : 'Gán'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {form && <ModelForm row={form.row} parents={parents} onClose={() => setForm(null)} />}
    </>
  )
}
