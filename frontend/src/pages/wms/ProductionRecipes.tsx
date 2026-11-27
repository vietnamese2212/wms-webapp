// TRANG "ĐỊNH MỨC" (MES 14/11 → 17/11): CÔNG THỨC của các mã BÁN THÀNH PHẨM — mỗi công thức là danh sách nguyên liệu + số lượng cho
// MỘT cỡ mẻ chuẩn, kèm mức lệch cho phép từng dòng. 17/11 (user: "ở nhiều thời điểm công thức sẽ khác nhau ⇒ tạo được nhiều để chọn"):
// một mã có NHIỀU công thức, đúng một công thức MẶC ĐỊNH (form Mở mẻ chọn sẵn). Mở mẻ ⇒ app chép công thức × (kế hoạch / cỡ chuẩn)
// thành PHIẾU của mẻ. Cấu hình: vài chục – vài trăm công thức ⇒ một danh sách không phân trang. Bảng theo chuẩn bảng của app.
// 27/11 — kho chạy KHÔNG ĐỊNH MỨC (Cài đặt MES): công thức "chỉ danh sách mã" (tắt "Có số lượng": không cỡ mẻ, không số lượng).
// Kho có định mức không lập mẻ được bằng công thức chỉ mã (server chặn — điền số lượng ở đây trước).
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Copy, FileUp } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { UploadExcelDialog } from '@/components/shared/UploadExcelDialog'
import { saveWorkbook } from '@/utils/saveExcel'
import { MatLinesEditor, toMatLine, matLineError, recipeLinesPayload, codeLinesPayload, type MatLine } from '@/components/wms/production/MatLinesEditor'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useMaterialsByIds } from '@/api/hooks'
import { useRecipes, useRecipe, useSaveRecipe, useImportRecipes, fetchRecipeImportCatalog, useSemiFinishedSearch, useProductionWarehouses, SEMI_FINISHED_PLACEHOLDER, type RecipeRow } from '@/api/productionHooks'
import { buildRecipeTemplate } from '@/components/wms/production/recipeTemplate'
import { NoSemiFinishedHint } from '@/components/wms/production/NoSemiFinishedHint'
import { unitCode } from '@/utils/unitCode'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'
import { formatDateTime } from '@/utils/formatters'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const COLS: RtColDef[] = [
  { id: 'code', label: 'Mã bán thành phẩm', w: 140 }, { id: 'name', label: 'Tên bán thành phẩm', w: 220 }, { id: 'recipe', label: 'Công thức', w: 200 },
  { id: 'base', label: 'Cỡ mẻ chuẩn', w: 110, align: 'right' }, { id: 'lines', label: 'Số NVL', w: 70, align: 'right' },
  { id: 'st', label: 'Trạng thái', w: 110 }, { id: 'note', label: 'Ghi chú', w: 220 }, { id: 'upd', label: 'Sửa lần cuối', w: 170 },
]
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })

// ─── NẠP ĐỊNH MỨC TỪ EXCEL (19/11) — file mẫu dựng ở components/wms/production/recipeTemplate.ts (20/11: có danh sách mã hợp lệ) ───
const IMPORT_HINT = 'Mỗi dòng = một nguyên liệu. Các dòng cùng Mã BTP + Tên công thức gộp thành một công thức. Công thức đã có (cùng mã + tên) sẽ được THAY TRỌN danh sách nguyên liệu; chưa có thì thêm mới. Số lượng theo đơn vị gốc của mã NVL. Kho không định mức: để trống Cỡ mẻ chuẩn và mọi Số lượng của công thức. File còn một lỗi thì không ghi gì.'
async function downloadImportTemplate() {
  const { wb, validations } = buildRecipeTemplate(await fetchRecipeImportCatalog())
  await saveWorkbook(wb, 'mau_dinh_muc.xlsx', { validations })
}

export default function ProductionRecipes() {
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canManage = can(perms, 'production', 'manage_recipe')
  const q = useRecipes()
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<{ open: boolean; recipeId: string | null }>({ open: false, recipeId: null })
  const [showImport, setShowImport] = useState(false)
  const importMut = useImportRecipes()
  // cùng mã đứng liền nhau: mặc định trước, rồi theo tên
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase()
    return (q.data ?? [])
      .filter(r => !t || `${r.material?.material_code ?? ''} ${r.material?.short_name ?? ''} ${r.name}`.toLowerCase().includes(t))
      .sort((a, b) => (a.material?.material_code ?? '').localeCompare(b.material?.material_code ?? '') || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name, 'vi'))
  }, [q.data, search])
  const all = q.data ?? []
  const actions: ActionItem[] = canManage
    ? [{ key: 'new', icon: Plus, label: 'Thêm công thức', tip: 'Thêm công thức cho một mã bán thành phẩm (một mã có thể có nhiều công thức)', primary: true, variant: 'default', onClick: () => setForm({ open: true, recipeId: null }) },
       { key: 'import', icon: FileUp, label: 'Nạp Excel', tip: 'Nạp nhiều công thức một lần từ file Excel (mỗi dòng một nguyên liệu) — kiểm file trước, bấm Xác nhận mới ghi', mobileHidden: true, onClick: () => setShowImport(true) }]
    : []

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline text-sm font-semibold text-slate-700 shrink-0">Định mức</span>
            <div className="flex-1 min-w-0"><SearchInput value={search} onChange={setSearch} placeholder="Tìm mã / tên bán thành phẩm / công thức" /></div>
            <ActionCluster className="w-auto shrink-0" items={actions} />
          </div>
        </div>
        <SummaryBand tiles={[
          { label: 'Mã bán thành phẩm', value: new Set(all.map(r => r.material_id)).size.toLocaleString('vi-VN'), tip: 'Số mã bán thành phẩm đã có ít nhất một công thức' },
          { label: 'Công thức đang dùng', value: all.filter(r => r.is_active).length.toLocaleString('vi-VN') },
          { label: 'Ngừng dùng', value: all.filter(r => !r.is_active).length.toLocaleString('vi-VN') },
          ...(all.some(r => r.base_qty == null) ? [{ label: 'Chỉ danh sách mã', value: all.filter(r => r.is_active && r.base_qty == null).length.toLocaleString('vi-VN'),
            tip: 'Công thức đang dùng không có số lượng (kho chạy không định mức). Kho có định mức không lập mẻ được bằng các công thức này' }] : []),
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <ResizableTable storageKey="production_recipes_cols_v2" cols={COLS}>
            <TableBody>
              {q.isError && <TableEmptyRow colSpan={COLS.length}><span className="text-red-600">{apiMsg(q.error)}</span></TableEmptyRow>}
              {!q.isError && q.isLoading && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
              {!q.isError && !q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>{all.length ? 'Không có công thức nào khớp.' : 'Chưa có công thức nào — mẻ mở ra sẽ có phiếu trống, người mở phải tự thêm nguyên liệu.'}</TableEmptyRow>}
              {rows.map(r => (
                <TableRow key={r.id} className={`cursor-pointer ${r.is_active ? '' : 'text-slate-400'}`} onClick={() => setForm({ open: true, recipeId: r.id })}>
                  <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`}>{r.material?.material_code ?? '—'}</TableCell>
                  <TableCell className={`${TD} truncate`} title={r.material?.short_name ?? ''}>{r.material?.short_name ?? ''}</TableCell>
                  <TableCell className={`${TD} truncate font-semibold`} title={r.name}>{r.name}</TableCell>
                  <TableCell className={`${TD} text-right font-semibold tabular-nums`}>{r.base_qty == null
                    ? <StatusBadge tone="slate" title="Công thức chỉ danh sách mã — không có số lượng (kho chạy không định mức)">Chỉ mã</StatusBadge>
                    : <>{nf(r.base_qty)} <span className="text-slate-400 font-normal">{unitCode(r.material?.base_unit)}</span></>}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`}>{r.line_count ?? '—'}</TableCell>
                  <TableCell className={TD}>{!r.is_active ? <StatusBadge tone="slate">Ngừng</StatusBadge> : r.is_default ? <StatusBadge tone="sky">Mặc định</StatusBadge> : <StatusBadge tone="green">Đang dùng</StatusBadge>}</TableCell>
                  <TableCell className={`${TD} truncate`} title={r.note ?? ''}>{r.note ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} truncate`}>{r.updated_by ?? '—'} · {formatDateTime(r.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ResizableTable>
        </div>
        <ListFooter page={1} pageSize={Math.max(rows.length, 1)} total={rows.length} unit="công thức" options={[]} onPageSize={() => {}} />
      </div>
      {showImport && (
        <UploadExcelDialog title="Nạp định mức từ Excel" hint={IMPORT_HINT} onClose={() => setShowImport(false)}
          onDownloadTemplate={downloadImportTemplate} onUpload={(file, preflight) => importMut.mutateAsync({ file, preflight })} />
      )}
      <RecipeSheet open={form.open} recipeId={form.recipeId} canManage={canManage} onClose={() => setForm(f => ({ ...f, open: false }))} all={all} />
    </div>
  )
}

function RecipeSheet({ open, onClose, recipeId, canManage, all }: { open: boolean; onClose: () => void; recipeId: string | null; canManage: boolean; all: RecipeRow[] }) {
  // rid = công thức đang sửa; null = tạo mới (kể cả "Chép thành công thức mới" từ công thức đang mở)
  const [rid, setRid] = useState<string | null>(null)
  const [mat, setMat] = useState('')
  const [matTerm, setMatTerm] = useState('')
  const [name, setName] = useState('')
  const [base, setBase] = useState('')
  const [note, setNote] = useState('')
  const [active, setActive] = useState(true)
  const [isDefault, setIsDefault] = useState(false)
  // 27/11: công thức CÓ số lượng (như cũ) hay CHỈ DANH SÁCH MÃ (kho chạy không định mức)
  const [withQty, setWithQty] = useState(true)
  const { data: { kitchens } } = useProductionWarehouses()
  // công thức mới: mọi kho chế biến của người dùng đều chạy không định mức ⇒ mặc định "chỉ mã"
  const allNoNorm = kitchens.length > 0 && kitchens.every(k => k.mes_no_norm)
  const [lines, setLines] = useState<MatLine[]>([])
  const [loadedFor, setLoadedFor] = useState('')
  const [err, setErr] = useState('')
  const save = useSaveRecipe()
  const rq = useRecipe(open && rid ? rid : undefined)
  useEffect(() => {
    if (!open) return
    setRid(recipeId); setMat(''); setName(''); setBase(''); setNote(''); setActive(true); setIsDefault(false); setLines([]); setErr(''); setMatTerm(''); setLoadedFor('')
    setWithQty(!allNoNorm)
  }, [open, recipeId]) // eslint-disable-line react-hooks/exhaustive-deps
  // nạp công thức đang sửa — chỉ khi dữ liệu là của ĐÚNG công thức đang mở
  const loaded = rq.data && rq.data.id === rid ? rq.data : null
  useEffect(() => {
    if (!open || !loaded || loadedFor === `${loaded.id}:${loaded.updated_at}`) return
    setMat(loaded.material_id); setName(loaded.name); setBase(vnNumberInput(loaded.base_qty)); setNote(loaded.note ?? '')
    setActive(loaded.is_active); setIsDefault(loaded.is_default); setLoadedFor(`${loaded.id}:${loaded.updated_at}`)
    setWithQty(loaded.base_qty != null)
    setLines(loaded.lines.map(l => toMatLine({ material_id: l.material_id, material_code: l.material?.material_code ?? '', material_name: l.material?.short_name ?? null, base_unit: l.material?.base_unit ?? null },
      l.qty, { tol: l.tol_pct != null ? vnNumberInput(l.tol_pct) : '' })))
  }, [open, loaded?.id, loaded?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps

  const creating = !rid
  // chỉ mã đã đánh dấu "Bán thành phẩm" ở Mã hàng (C117)
  const { found, isFetching, none: noBtp } = useSemiFinishedSearch(matTerm, open && creating && !loadedFor)
  const { data: picked = [] } = useMaterialsByIds(mat ? [mat] : [], open && !!mat)
  const selMat = picked.find(m => m.id === mat) ?? found.find(m => m.id === mat)
  const countOf = (id: string) => all.filter(r => r.material_id === id).length
  const matOpts = [...picked, ...found].filter((m, i, a) => a.findIndex(x => x.id === m.id) === i)
    .map(m => ({ value: m.id, label: m.material_code, sub: `${m.short_name ?? m.material_description ?? ''} · ${unitCode(m.base_unit)}${countOf(m.id) ? ` · đã có ${countOf(m.id)} công thức` : ''}` }))
  const siblings = all.filter(r => r.material_id === mat && r.id !== rid)
  const nameDup = !!name.trim() && siblings.some(r => r.name.trim().toLowerCase() === name.trim().toLowerCase())
  const baseN = base.trim() ? parseVnNumber(base) : null
  const baseBad = !!base.trim() && (baseN == null || baseN <= 0)
  const qtyOk = !withQty || (baseN != null && baseN > 0 && !lines.some(l => matLineError(l)))
  const canSave = canManage && !!mat && !!name.trim() && !nameDup && qtyOk && lines.length > 0 && !save.isPending
  async function doSave() {
    setErr('')
    try {
      await save.mutateAsync({ id: rid ?? undefined, material_id: mat, name: name.trim(), base_qty: withQty ? baseN as number : null, note: note.trim() || null,
        is_active: active, is_default: isDefault, lines: withQty ? recipeLinesPayload(lines) : codeLinesPayload(lines) })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  // chép công thức đang mở thành công thức MỚI của cùng mã (giữ dòng + mức lệch) — sửa vài dòng rồi lưu là có bản khác
  function copyAsNew() {
    setRid(null); setName(`${name.trim()} (bản sao)`.slice(0, 80)); setIsDefault(false); setActive(true); setErr('')
  }
  const u = unitCode(selMat?.base_unit ?? loaded?.material?.base_unit)
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-3xl"
      title={creating ? (loadedFor ? 'Công thức mới (chép)' : 'Thêm công thức') : `Công thức ${loaded?.material?.material_code ?? ''} — ${loaded?.name ?? ''}`}
      description={withQty ? 'Số lượng từng nguyên liệu cho MỘT mẻ cỡ chuẩn. Mẻ có lượng kế hoạch khác cỡ chuẩn thì app nhân theo tỷ lệ. Một mã có thể có nhiều công thức.'
        : 'Chỉ danh sách mã nguyên liệu, không số lượng — dùng cho kho chạy không định mức (QA lập mẻ theo phiếu chế biến giấy).'}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>{canManage ? 'Huỷ' : 'Đóng'}</Button>
        {canManage && !creating && <Button variant="outline" size="sm" className="h-8" onClick={copyAsNew} disabled={!loaded}><Copy className="h-3.5 w-3.5 mr-1" />Chép thành công thức mới</Button>}
        {canManage && <Button size="sm" className="h-8" disabled={!canSave} onClick={() => void doSave()}>{save.isPending ? 'Đang lưu…' : 'Lưu công thức'}</Button>}
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        {rq.isError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Không tải được công thức: {apiMsg(rq.error)}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Mã bán thành phẩm <span className="text-red-500">*</span></Label>
            <SingleSelect value={mat} onChange={setMat} disabled={!creating || !!loadedFor || !canManage} serverSearch onSearchChange={setMatTerm} loading={isFetching}
              selectedLabel={selMat?.material_code ?? loaded?.material?.material_code} placeholder={SEMI_FINISHED_PLACEHOLDER} options={matOpts} triggerClassName="h-9 sm:h-8 text-xs mt-0.5" />
            {noBtp && !mat && <NoSemiFinishedHint />}
            {mat && selMat && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{selMat.short_name ?? selMat.material_description}</p>}
          </div>
          <div>
            <Label className="text-xs">Tên công thức <span className="text-red-500">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} disabled={!canManage} maxLength={80} placeholder="VD Chuẩn · Dùng SMP-LH · Mùa hè 2026"
              className={`h-9 sm:h-8 text-xs mt-0.5 ${nameDup ? 'border-red-400' : ''}`} />
            {nameDup && <p className="text-[11px] text-red-600 mt-0.5">Mã này đã có công thức tên này.</p>}
          </div>
        </div>
        {siblings.length > 0 && (
          <p className="text-[11px] text-slate-500">Mã này còn {siblings.length} công thức khác: {siblings.map(r => `${r.name}${r.is_default ? ' (mặc định)' : ''}${r.is_active ? '' : ' (ngừng)'}`).join(' · ')}</p>
        )}
        <label htmlFor="recipe-qty" className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer" data-testid="recipe-with-qty"
          title="Tắt = công thức chỉ danh sách mã (kho chạy không định mức). Kho có định mức không lập mẻ được bằng công thức chỉ mã">
          <Switch id="recipe-qty" checked={withQty} onCheckedChange={setWithQty} disabled={!canManage} />Có số lượng
          <span className="text-[11px] text-slate-500">{withQty ? '— định mức cho một mẻ cỡ chuẩn' : '— chỉ danh sách mã (kho không định mức)'}</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-end">
          {withQty && (
          <div>
            <Label className="text-xs">Cỡ mẻ chuẩn{u ? ` (${u})` : ''} <span className="text-red-500">*</span></Label>
            <Input value={base} onChange={e => setBase(e.target.value)} disabled={!canManage} inputMode="decimal" placeholder="VD 6.000" className={`h-9 sm:h-8 text-xs mt-0.5 tabular-nums ${baseBad ? 'border-red-400' : ''}`} />
          </div>
          )}
          <label htmlFor="recipe-default" className="flex items-center gap-1.5 text-xs text-slate-700 h-9 sm:h-8 cursor-pointer" title="Form Mở mẻ chọn sẵn công thức mặc định của mã">
            <Switch id="recipe-default" checked={isDefault && active} onCheckedChange={setIsDefault} disabled={!canManage || !active} />Mặc định
          </label>
          <label htmlFor="recipe-active" className="flex items-center gap-1.5 text-xs text-slate-700 h-9 sm:h-8 cursor-pointer">
            <Switch id="recipe-active" checked={active} onCheckedChange={setActive} disabled={!canManage} />Đang dùng
          </label>
        </div>
        <div>
          <Label className="text-xs">{withQty ? 'Nguyên liệu cho một mẻ cỡ chuẩn' : 'Danh sách mã nguyên liệu'} <span className="text-red-500">*</span></Label>
          <p className="text-[11px] text-slate-500">{withQty ? 'Cột "± %" là mức lệch cho phép: cấp ngoài mức này thì dòng tô đỏ trên phiếu của mẻ (vẫn cho cấp). Để trống = không kiểm.'
            : 'Mẻ lập từ công thức này mang sẵn danh sách mã; QA đối chiếu với phiếu chế biến rồi bỏ / thêm cho khớp. Cấp mã ngoài danh sách bị chặn.'}</p>
          <div className="mt-1"><MatLinesEditor lines={lines} onChange={setLines} excludeId={mat || undefined} disabled={!canManage} withTol codesOnly={!withQty} /></div>
        </div>
        <div>
          <Label className="text-xs">Ghi chú</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} disabled={!canManage} maxLength={500} placeholder="Tuỳ chọn" className="h-9 sm:h-8 text-xs mt-0.5" />
        </div>
      </div>
    </FormSheet>
  )
}
