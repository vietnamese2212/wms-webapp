// DÒNG XE CON (mã SAP) dưới danh mục dòng xe CHA — Cài đặt TMS → Loại xe (user chốt 23/09/2026).
//
// "Các dòng xe hiện tại trở thành CHA, dưới cha có nhiều dòng CON — ở đó mới có mã SAP, tên dòng xe. Kho chỉ quan
//  tâm dòng cha để booking, đăng ký xe; điều vận mới quan tâm dòng con để làm shipment, ghép chuyến."
// Việc thường làm nhất sau seed 60 dòng là GÁN CHA: tick nhiều dòng → một nút "Gán cha"; dòng chưa gán đứng đầu
// bảng kèm băng đếm, vì engine ghép bỏ qua dòng chưa gán (không biết kho đặt khung giờ loại nào).
import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { FloatingActionBar, FLOATING_BTN } from '@/components/shared/FloatingActionBar'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { InfoTip } from '@/components/shared/InfoTip'
import { toast } from '@/components/ui/use-toast'
import {
  useVehicleTypes, useVehicleModels, useCreateVehicleModel, useUpdateVehicleModel, useAssignVehicleModelParent, useDeleteVehicleModel,
  type VehicleModel, type VehicleModelPatch, type VehicleModelTemp,
} from '@/api/hooks'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được'
const TEMP_LABEL: Record<VehicleModelTemp, string> = { HOT: 'Nóng', COLD: 'Lạnh', MIXED: 'Kết hợp', DRY: 'Khô' }
const TH = 'px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const capText = (m: VehicleModel) => {
  const parts: string[] = []
  if (m.max_pallets) parts.push(`${m.max_pallets} pallet`)
  if (m.max_tons) parts.push(`${Number(m.max_tons).toLocaleString('vi-VN')} tấn`)
  if (m.max_m3) parts.push(`${Number(m.max_m3).toLocaleString('vi-VN')} m³`)
  return parts.length ? parts.join(' · ') : '—'
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
        <div className="grid grid-cols-4 gap-2">
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
  const parents = useMemo(() => parentsRaw.filter(p => p.is_active).map(p => ({ value: p.id, label: `${p.code} · ${p.name}` })), [parentsRaw])
  const { data, isLoading } = useVehicleModels()
  const items = data?.items ?? []
  const unassigned = data?.unassigned ?? 0
  const assign = useAssignVehicleModelParent(), del = useDeleteVehicleModel()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<{ row: VehicleModel | null } | null>(null)
  const [assignDlg, setAssignDlg] = useState(false)
  const [assignTo, setAssignTo] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)

  // Dòng chưa gán cha lên đầu (việc phải làm), rồi theo cha, rồi thứ tự seed
  const rows = useMemo(() => {
    const list = onlyUnassigned ? items.filter(m => !m.parent_type_id) : items
    return [...list].sort((a, b) => Number(!!a.parent_type_id) - Number(!!b.parent_type_id) || (a.parent?.code ?? '').localeCompare(b.parent?.code ?? '') || a.sort_order - b.sort_order)
  }, [items, onlyUnassigned])
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id))
  const doAssign = async () => {
    try {
      const r = await assign.mutateAsync({ ids: [...picked], parent_type_id: assignTo || null })
      toast({ title: assignTo ? `Đã gán cha cho ${r.updated} dòng xe` : `Đã gỡ cha khỏi ${r.updated} dòng xe` })
      setPicked(new Set()); setAssignDlg(false); setAssignTo('')
    } catch (e) { toast({ variant: 'destructive', title: 'Không gán được', description: apiMsg(e) }) }
  }

  return (
    <div className="border-t mt-2">
      <div className="flex items-center gap-2 bg-slate-100 border-b px-3 py-1.5 flex-wrap">
        <span className="h-4 w-1 rounded bg-sky-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 flex-1 min-w-0">Dòng xe con — mã SAP ({items.length})</span>
        <InfoTip tip="Dòng xe con mang mã SAP 9100000xx, sức chứa và cách tính cước — chỉ điều vận (ghép chuyến, tính cước) dùng. Kho vẫn booking khung giờ và đăng ký cổng theo dòng xe cha. Dòng chưa gán cha thì điều vận không ghép vào." />
        {unassigned > 0 && <button type="button" onClick={() => setOnlyUnassigned(v => !v)}
          className={`h-6 px-2 rounded-full text-[10px] font-medium border ${onlyUnassigned ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 text-amber-800 border-amber-300'}`}>
          {unassigned} chưa gán cha</button>}
        {canCreate && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setForm({ row: null })}><Plus className="h-3.5 w-3.5" />Thêm dòng con</Button>}
      </div>
      <Table className="min-w-full">
        <TableHeader><TableRow>
          {canEdit && <TableHead className={`${TH} w-7`}><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.id)))} className="h-3.5 w-3.5 accent-sky-600" /></TableHead>}
          {['Mã SAP', 'Tên dòng xe', 'Dòng xe cha', 'Nhiệt', 'Sức chứa', 'Tính cước', 'Non tải <', 'Trộn kênh', 'Trạng thái'].map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
          {(canEdit || canDelete) && <TableHead className={`${TH} w-16`} />}
        </TableRow></TableHeader>
        <TableBody>
          {isLoading && <TableEmptyRow colSpan={11}>Đang tải…</TableEmptyRow>}
          {!isLoading && !rows.length && <TableEmptyRow colSpan={11}>{onlyUnassigned ? 'Mọi dòng xe con đã có cha.' : 'Chưa có dòng xe con nào.'}</TableEmptyRow>}
          {rows.map(m => (
            <TableRow key={m.id} className={`${m.is_active ? '' : 'text-slate-400'} ${!m.parent_type_id && m.is_active ? 'bg-amber-50/40' : ''}`}>
              {canEdit && <TableCell className={TD}><input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} className="h-3.5 w-3.5 accent-sky-600" /></TableCell>}
              <TableCell className={`${TD} font-mono font-semibold`}>{m.sap_code}</TableCell>
              <TableCell className={`${TD} font-medium`}>{m.name}</TableCell>
              <TableCell className={TD}>{m.parent ? <><span className="font-mono">{m.parent.code}</span> <span className="text-slate-500">{m.parent.name}</span></> : <StatusBadge tone="amber">Chưa gán</StatusBadge>}</TableCell>
              <TableCell className={TD}>{m.temp_mode ? TEMP_LABEL[m.temp_mode] : <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={`${TD} tabular-nums`}>{capText(m)}</TableCell>
              <TableCell className={TD}>{m.tariff_unit === 'PER_PALLET' ? 'Pallet (làm tròn lên)' : 'Trọn chuyến'}</TableCell>
              <TableCell className={`${TD} text-right tabular-nums`}>{m.underload_pct} %</TableCell>
              <TableCell className={TD}>{m.allow_mix_channels ? 'Có' : 'Không'}</TableCell>
              <TableCell className={TD}><StatusBadge tone={m.is_active ? 'green' : 'slate'}>{m.is_active ? 'Hoạt động' : 'Tạm dừng'}</StatusBadge></TableCell>
              {(canEdit || canDelete) && (
                <TableCell className={TD}>
                  <div className="flex items-center gap-0.5">
                    {canEdit && <button className="text-slate-400 hover:text-blue-500 p-1" title="Sửa" onClick={() => setForm({ row: m })}><Pencil className="h-3.5 w-3.5" /></button>}
                    {canDelete && <button className="text-slate-400 hover:text-red-500 p-1" title="Xoá" onClick={() => { if (confirm(`Xoá dòng xe "${m.sap_code} · ${m.name}"?`)) del.mutate(m.id, { onError: e => toast({ variant: 'destructive', title: 'Không xoá được', description: apiMsg(e) }) }) }}><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
    </div>
  )
}
