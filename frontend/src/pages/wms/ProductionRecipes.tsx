// TRANG "ĐỊNH MỨC" (MES 14/11/2026): mỗi mã BÁN THÀNH PHẨM một định mức — danh sách nguyên liệu + số lượng cho MỘT cỡ mẻ chuẩn.
// Mở mẻ ⇒ app chép định mức × (lượng kế hoạch / cỡ mẻ chuẩn) thành YÊU CẦU nguyên liệu trên bàn làm việc của mẻ (sửa được theo mẻ).
// Cấu hình: vài chục – vài trăm mã ⇒ một danh sách không phân trang.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { Plus } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { MatLinesEditor, toMatLine, matLineError, matLinesPayload, type MatLine } from '@/components/wms/production/MatLinesEditor'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useMaterialsByIds } from '@/api/hooks'
import { useRecipes, useRecipe, useSaveRecipe, useSemiFinishedSearch, SEMI_FINISHED_PLACEHOLDER, type RecipeRow } from '@/api/productionHooks'
import { NoSemiFinishedHint } from '@/components/wms/production/NoSemiFinishedHint'
import { unitLabel } from '@/utils/qtyUnits'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'
import { formatDateTime } from '@/utils/formatters'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const COLS: RtColDef[] = [
  { id: 'code', label: 'Mã bán thành phẩm', w: 150 }, { id: 'name', label: 'Tên', w: 240 }, { id: 'base', label: 'Cỡ mẻ chuẩn', w: 120, align: 'right' },
  { id: 'st', label: 'Trạng thái', w: 100 }, { id: 'note', label: 'Ghi chú', w: 220 }, { id: 'upd', label: 'Sửa lần cuối', w: 170 },
]
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })

export default function ProductionRecipes() {
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canManage = can(perms, 'production', 'manage_recipe')
  const q = useRecipes()
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<{ open: boolean; materialId: string | null }>({ open: false, materialId: null })
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase()
    return (q.data ?? []).filter(r => !t || `${r.material?.material_code ?? ''} ${r.material?.short_name ?? ''}`.toLowerCase().includes(t))
  }, [q.data, search])
  const actions: ActionItem[] = canManage
    ? [{ key: 'new', icon: Plus, label: 'Khai định mức', tip: 'Khai định mức nguyên liệu cho một mã bán thành phẩm', primary: true, variant: 'default', onClick: () => setForm({ open: true, materialId: null }) }]
    : []

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline text-sm font-semibold text-slate-700 shrink-0">Định mức</span>
            <div className="flex-1 min-w-0"><SearchInput value={search} onChange={setSearch} placeholder="Tìm mã / tên bán thành phẩm" /></div>
            <ActionCluster className="w-auto shrink-0" items={actions} />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <ResizableTable storageKey="production_recipes_cols_v1" cols={COLS}>
            <TableBody>
              {q.isError && <TableEmptyRow colSpan={COLS.length}><span className="text-red-600">{apiMsg(q.error)}</span></TableEmptyRow>}
              {!q.isError && q.isLoading && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
              {!q.isError && !q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>{(q.data ?? []).length ? 'Không có định mức nào khớp.' : 'Chưa khai định mức nào — mẻ mở ra sẽ có bàn làm việc trống, người mở phải tự thêm nguyên liệu.'}</TableEmptyRow>}
              {rows.map(r => (
                <TableRow key={r.id} className={`cursor-pointer ${r.is_active ? '' : 'text-slate-400'}`} onClick={() => setForm({ open: true, materialId: r.material_id })}>
                  <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`}>{r.material?.material_code ?? '—'}</TableCell>
                  <TableCell className={`${TD} truncate`} title={r.material?.short_name ?? ''}>{r.material?.short_name ?? ''}</TableCell>
                  <TableCell className={`${TD} text-right font-semibold tabular-nums`}>{nf(r.base_qty)} <span className="text-slate-400 font-normal">{unitLabel(r.material?.base_unit)}</span></TableCell>
                  <TableCell className={TD}>{r.is_active ? <StatusBadge tone="green">Đang dùng</StatusBadge> : <StatusBadge tone="slate">Ngừng</StatusBadge>}</TableCell>
                  <TableCell className={`${TD} truncate`} title={r.note ?? ''}>{r.note ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} truncate`}>{r.updated_by ?? '—'} · {formatDateTime(r.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ResizableTable>
        </div>
        <ListFooter page={1} pageSize={Math.max(rows.length, 1)} total={rows.length} unit="định mức" options={[]} onPageSize={() => {}} />
      </div>
      <RecipeSheet open={form.open} materialId={form.materialId} canManage={canManage} onClose={() => setForm(f => ({ ...f, open: false }))} existing={q.data ?? []} />
    </div>
  )
}

function RecipeSheet({ open, onClose, materialId, canManage, existing }: { open: boolean; onClose: () => void; materialId: string | null; canManage: boolean; existing: RecipeRow[] }) {
  const [mat, setMat] = useState('')
  const [matTerm, setMatTerm] = useState('')
  const [base, setBase] = useState('')
  const [note, setNote] = useState('')
  const [active, setActive] = useState(true)
  const [lines, setLines] = useState<MatLine[]>([])
  const [err, setErr] = useState('')
  const save = useSaveRecipe()
  const rq = useRecipe(open ? (materialId ?? (mat || undefined)) : undefined)
  // chỉ dùng định mức của ĐÚNG mã đang chọn (đang tải mã mới thì chưa có)
  const loaded = rq.data && rq.data.material_id === mat ? rq.data : null
  // các ô đang hiện là định mức NẠP của mã nào — đổi sang mã khác thì bỏ, kẻo lưu định mức mã A dưới tên mã B
  const [loadedFor, setLoadedFor] = useState('')
  useEffect(() => { if (open) { setMat(materialId ?? ''); setBase(''); setNote(''); setActive(true); setLines([]); setErr(''); setMatTerm(''); setLoadedFor('') } }, [open, materialId])
  // mã đã có định mức ⇒ nạp lên để sửa (kể cả khi bấm "Khai định mức" rồi chọn trúng mã đã khai)
  useEffect(() => {
    if (!open || !loaded) return
    setBase(vnNumberInput(loaded.base_qty)); setNote(loaded.note ?? ''); setActive(loaded.is_active); setLoadedFor(loaded.material_id)
    setLines(loaded.lines.map(l => toMatLine({ material_id: l.material_id, material_code: l.material?.material_code ?? '', material_name: l.material?.short_name ?? null, base_unit: l.material?.base_unit ?? null }, l.qty)))
  }, [open, loaded?.id, loaded?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps

  // chỉ mã đã đánh dấu "Bán thành phẩm" ở Mã hàng (C117)
  const { found, isFetching, none: noBtp } = useSemiFinishedSearch(matTerm, open && !materialId)
  const { data: picked = [] } = useMaterialsByIds(mat ? [mat] : [], open && !!mat)
  const selMat = picked.find(m => m.id === mat) ?? found.find(m => m.id === mat)
  const has = new Set(existing.map(e => e.material_id))
  const matOpts = [...picked, ...found].filter((m, i, a) => a.findIndex(x => x.id === m.id) === i)
    .map(m => ({ value: m.id, label: m.material_code, sub: `${m.short_name ?? m.material_description ?? ''} · ${unitLabel(m.base_unit)}${has.has(m.id) ? ' · đã có định mức' : ''}` }))
  const baseN = base.trim() ? parseVnNumber(base) : null
  const baseBad = !!base.trim() && (baseN == null || baseN <= 0)
  const canSave = canManage && !!mat && baseN != null && baseN > 0 && !lines.some(l => matLineError(l)) && lines.length > 0 && !save.isPending
  async function doSave() {
    setErr('')
    try { await save.mutateAsync({ materialId: mat, base_qty: baseN as number, note: note.trim() || null, is_active: active, lines: matLinesPayload(lines) }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  const u = unitLabel(selMat?.base_unit ?? loaded?.material?.base_unit)
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-xl" title={materialId ? `Định mức ${loaded?.material?.material_code ?? ''}` : 'Khai định mức'}
      description="Số lượng từng nguyên liệu cho MỘT mẻ cỡ chuẩn. Mẻ có lượng kế hoạch khác cỡ chuẩn thì app nhân theo tỷ lệ."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>{canManage ? 'Huỷ' : 'Đóng'}</Button>
        {canManage && <Button size="sm" className="h-8" disabled={!canSave} onClick={() => void doSave()}>{save.isPending ? 'Đang lưu…' : 'Lưu định mức'}</Button>}
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <div>
          <Label className="text-xs">Mã bán thành phẩm <span className="text-red-500">*</span></Label>
          <SingleSelect value={mat} onChange={v => { setMat(v); if (loadedFor && loadedFor !== v) { setBase(''); setNote(''); setActive(true); setLines([]); setLoadedFor('') } }} disabled={!!materialId || !canManage} serverSearch onSearchChange={setMatTerm} loading={isFetching}
            selectedLabel={selMat?.material_code ?? loaded?.material?.material_code} placeholder={SEMI_FINISHED_PLACEHOLDER} options={matOpts} />
          {noBtp && !mat && <NoSemiFinishedHint />}
          {!materialId && loaded &&<p className="text-[11px] text-amber-700 mt-1">Mã này đã có định mức — đang sửa định mức đó.</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div>
            <Label className="text-xs">Cỡ mẻ chuẩn{u ? ` (${u})` : ''} <span className="text-red-500">*</span></Label>
            <Input value={base} onChange={e => setBase(e.target.value)} disabled={!canManage} inputMode="decimal" placeholder="VD 5.000" className={`h-9 sm:h-8 text-xs mt-0.5 tabular-nums ${baseBad ? 'border-red-400' : ''}`} />
          </div>
          <label htmlFor="recipe-active" className="flex items-center gap-1.5 text-xs text-slate-700 h-9 sm:h-8 cursor-pointer">
            <Switch id="recipe-active" checked={active} onCheckedChange={setActive} disabled={!canManage} />Đang dùng
          </label>
        </div>
        <div>
          <Label className="text-xs">Nguyên liệu cho một mẻ cỡ chuẩn <span className="text-red-500">*</span></Label>
          <div className="mt-0.5"><MatLinesEditor lines={lines} onChange={setLines} excludeId={mat || undefined} disabled={!canManage} /></div>
        </div>
        <div>
          <Label className="text-xs">Ghi chú</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} disabled={!canManage} maxLength={500} placeholder="Tuỳ chọn" className="h-9 sm:h-8 text-xs mt-0.5" />
        </div>
      </div>
    </FormSheet>
  )
}
