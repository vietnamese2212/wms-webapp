// Form MỞ / SỬA MẺ chế biến (MES 14/11). Mã lô app GỢI Ý theo khuôn tem V2 (tiền tố + yymmdd + máy + STT), người mở sửa được
// (user chốt 14/11). Mẻ chỉ mở ở KHO CHẾ BIẾN (kho phụ nội bộ). Mã bán thành phẩm phải tính theo L hoặc KG (vào bồn).
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { useMaterialsByIds, useMachines } from '@/api/hooks'
import { useProductionWarehouses, useNextBatchCode, useCreateBatch, useUpdateBatch, useShiftNames, defaultKitchen, useSemiFinishedSearch, useRecipes, SEMI_FINISHED_PLACEHOLDER, type BatchDetail } from '@/api/productionHooks'
import { NoSemiFinishedHint } from './NoSemiFinishedHint'
import { unitCode } from '@/utils/unitCode'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

export function BatchFormSheet({ open, onClose, batch, template, onSaved }: {
  open: boolean; onClose: () => void
  /** có = sửa mẻ này; không = mở mẻ mới */
  batch?: BatchDetail | null
  /** mở mẻ MỚI điền sẵn theo một mẻ có trước (kho · mã BTP · máy · ca · kế hoạch) — ngày = hôm nay, mã lô gợi ý lại */
  template?: { warehouse_id: string; material_id: string; machine_code: string | null; shift: string | null; cycle?: string | null; planned_qty: number | null; recipe_id?: string | null } | null
  onSaved?: (id: string) => void
}) {
  const editing = !!batch
  const { data: { kitchens } } = useProductionWarehouses()
  const [wh, setWh] = useState('')
  const [mat, setMat] = useState('')
  const [matTerm, setMatTerm] = useState('')
  const [date, setDate] = useState(todayVN())
  const [machine, setMachine] = useState('')
  const [shift, setShift] = useState('')
  const [cycle, setCycle] = useState('')
  const [planned, setPlanned] = useState('')
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [note, setNote] = useState('')
  // CÔNG THỨC (17/11): một mã có nhiều công thức — chọn sẵn công thức mặc định (Mở mẻ giống: công thức của mẻ gốc)
  const [recipeId, setRecipeId] = useState('')
  const [err, setErr] = useState('')
  const create = useCreateBatch()
  const shiftNames = useShiftNames(shift || null)
  const update = useUpdateBatch()

  useEffect(() => {
    if (!open) return
    setErr(''); setCodeTouched(editing)
    if (batch) {
      setWh(batch.warehouse_id); setMat(batch.material_id); setDate(batch.prod_date); setMachine(batch.machine_code ?? '')
      setShift(batch.shift ?? ''); setCycle(batch.cycle ?? ''); setPlanned(vnNumberInput(batch.planned_qty)); setCode(batch.batch_code); setNote(batch.note ?? '')
    } else if (template) {
      setWh(template.warehouse_id); setMat(template.material_id); setDate(todayVN()); setMachine(template.machine_code ?? '')
      setShift(template.shift ?? ''); setCycle(template.cycle ?? ''); setPlanned(vnNumberInput(template.planned_qty)); setCode(''); setNote('')
      setRecipeId(template.recipe_id ?? '')
    } else {
      // bối cảnh Kho toàn cục: là kho chế biến thì lấy luôn; là kho nhà máy có đúng MỘT kho chế biến thì lấy kho đó
      setWh(defaultKitchen(kitchens, useGlobalScopeStore.getState().warehouseId, true))
      setMat(''); setDate(todayVN()); setMachine(''); setShift(''); setCycle(''); setPlanned(''); setCode(''); setNote(''); setRecipeId('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const term = useDebouncedValue(matTerm, 250)
  // chỉ mã đã đánh dấu "Bán thành phẩm" ở Mã hàng (C117) — mã đang chọn (sửa mẻ cũ) vẫn giữ nhãn qua `picked`
  const { found, isFetching, none: noBtp } = useSemiFinishedSearch(term, open, true)
  const { data: picked = [] } = useMaterialsByIds(mat ? [mat] : [], open && !!mat)
  const matOpts = useMemo(() => {
    const seen = new Set<string>()
    return [...picked, ...found].filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
      .map(m => ({ value: m.id, label: m.material_code, sub: `${m.short_name ?? m.material_description ?? ''} · ${unitCode(m.base_unit)}` }))
  }, [picked, found])
  const selMat = picked.find(m => m.id === mat) ?? found.find(m => m.id === mat)
  const { data: recipes = [], isFetching: recipesLoading } = useRecipes(mat || undefined, true, open && !editing && !!mat)
  // công thức đang chọn không thuộc mã hiện tại (vừa đổi mã) ⇒ chọn lại công thức mặc định của mã mới
  useEffect(() => {
    if (editing || !mat || recipesLoading) return
    if (!recipes.some(r => r.id === recipeId)) setRecipeId(recipes.find(r => r.is_default)?.id ?? recipes[0]?.id ?? '')
  }, [mat, recipes, recipesLoading, editing]) // eslint-disable-line react-hooks/exhaustive-deps
  const selRecipe = recipes.find(r => r.id === recipeId)
  const { data: machines = [] } = useMachines(wh || undefined)
  const activeMachines = machines.filter(m => m.is_active !== false)
  const next = useNextBatchCode({ warehouse_id: editing ? undefined : wh || undefined, material_id: mat || undefined, prod_date: date || undefined, machine_code: machine || undefined })
  useEffect(() => { if (!editing && !codeTouched && next.data?.code) setCode(next.data.code) }, [next.data?.code, editing, codeTouched])

  const saving = create.isPending || update.isPending
  const plannedNum = planned.trim() ? parseVnNumber(planned) : null
  const plannedBad = !!planned.trim() && (plannedNum == null || plannedNum <= 0)
  const canSave = !!wh && !!mat && !!date && !plannedBad && !saving

  async function save() {
    setErr('')
    try {
      if (batch) {
        const r = await update.mutateAsync({ id: batch.id, prod_date: date, machine_code: machine || null, shift: shift || null, cycle: cycle.trim() || null,
          planned_qty: plannedNum, note: note || null,
          ...(code.trim().toUpperCase() !== batch.batch_code ? { batch_code: code.trim() } : {}), ...(mat !== batch.material_id ? { material_id: mat } : {}) })
        onSaved?.(r.id); onClose()
      } else {
        const r = await create.mutateAsync({ warehouse_id: wh, material_id: mat, prod_date: date, batch_code: code.trim() || undefined,
          machine_code: machine || undefined, shift: shift || undefined, cycle: cycle.trim() || undefined, planned_qty: plannedNum, note: note || undefined,
          recipe_id: recipeId || undefined })
        onSaved?.(r.id); onClose()
      }
    } catch (e) { setErr(apiMsg(e)) }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={editing ? `Sửa mẻ ${batch?.batch_code}` : 'Mở mẻ chế biến'}
      description="Mẻ chỉ mở ở kho chế biến (kho phụ nội bộ). Mã lô app gợi ý — sửa được nếu nhà máy dùng quy tắc khác."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={!canSave} onClick={() => void save()}>{saving ? 'Đang lưu…' : editing ? 'Lưu' : 'Mở mẻ'}</Button>
      </>}>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Kho chế biến <span className="text-red-500">*</span></Label>
          <SingleSelect value={wh} onChange={v => { setWh(v); setMachine(''); setCodeTouched(false) }} disabled={editing}
            placeholder={kitchens.length ? 'Chọn kho chế biến' : 'Chưa có kho chế biến trong phạm vi'}
            options={kitchens.map(k => ({ value: k.id, label: k.name, sub: k.parent_name ? `thuộc ${k.parent_name}` : k.code }))} />
          {!kitchens.length && <p className="text-[11px] text-amber-700 mt-1">Khai kho chế biến là kho phụ nội bộ: Cài đặt WMS → Kho → "Trực thuộc kho".</p>}
        </div>
        <div>
          <Label className="text-xs">Mã bán thành phẩm <span className="text-red-500">*</span></Label>
          <SingleSelect value={mat} onChange={v => { setMat(v); setCodeTouched(false) }} serverSearch onSearchChange={setMatTerm} loading={isFetching}
            selectedLabel={selMat ? selMat.material_code : undefined} placeholder={SEMI_FINISHED_PLACEHOLDER} options={matOpts} />
          {noBtp && !mat && <NoSemiFinishedHint />}
        </div>
        {!editing && !!mat && (
          <div>
            <Label className="text-xs">Công thức</Label>
            {recipes.length ? (
              <SingleSelect value={recipeId} onChange={setRecipeId} searchable={recipes.length > 6} triggerClassName="h-8 text-xs mt-0.5"
                options={recipes.map(r => ({ value: r.id, label: r.name, sub: `cỡ chuẩn ${Number(r.base_qty).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} ${unitCode(r.material?.base_unit)}${r.is_default ? ' · mặc định' : ''}` }))} />
            ) : (
              <p className="text-[11px] text-amber-700 mt-0.5">{recipesLoading ? 'Đang tải công thức…' : 'Mã này chưa có công thức đang dùng — phiếu của mẻ sẽ trống (khai ở Sản xuất (MES) → Định mức, hoặc thêm tay trên mẻ).'}</p>
            )}
            {selRecipe && <p className="text-[11px] text-slate-500 mt-0.5">{selRecipe.line_count ?? 0} nguyên liệu · nhân theo lượng kế hoạch / cỡ chuẩn{selRecipe.note ? ` · ${selRecipe.note}` : ''}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">Ngày sản xuất <span className="text-red-500">*</span></Label>
            <Input type="date" value={date} onChange={e => { setDate(e.target.value); setCodeTouched(false) }} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <Label className="text-xs">Ca</Label>
            {/* cùng danh mục ca với báo cáo ca + Sổ đóng gói — một ca một nhãn */}
            <SingleSelect value={shift || '__none__'} onChange={v => setShift(v === '__none__' ? '' : v)} searchable={false} triggerClassName="h-8 text-xs mt-0.5"
              options={[{ value: '__none__', label: 'Không ghi' }, ...shiftNames.map(s => ({ value: s, label: s }))]} />
          </div>
          <div>
            <Label className="text-xs">Chu kỳ</Label>
            <Input value={cycle} onChange={e => setCycle(e.target.value)} maxLength={20} placeholder="Tuỳ chọn" className="h-8 text-xs mt-0.5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Máy / thiết bị trộn</Label>
            {activeMachines.length
              ? <SingleSelect value={machine} onChange={v => { setMachine(v); setCodeTouched(false) }} placeholder="Chọn máy" options={activeMachines.map(m => ({ value: m.code, label: m.code, sub: m.note ?? undefined }))} />
              : <Input value={machine} onChange={e => { setMachine(e.target.value.toUpperCase()); setCodeTouched(false) }} maxLength={20} placeholder="Tuỳ chọn" className="h-8 text-xs mt-0.5" />}
          </div>
          <div>
            <Label className="text-xs">Lượng kế hoạch{selMat ? ` (${unitCode(selMat.base_unit)})` : ''}</Label>
            <Input value={planned} onChange={e => setPlanned(e.target.value)} inputMode="decimal" placeholder="Tuỳ chọn" className={`h-8 text-xs mt-0.5 ${plannedBad ? 'border-red-400' : ''}`} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Mã lô bán thành phẩm</Label>
          <Input value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setCodeTouched(true) }} maxLength={40}
            placeholder={next.isFetching ? 'Đang gợi ý…' : 'Để trống = app tự sinh'} className="h-8 text-xs mt-0.5 font-mono" />
          {!editing && codeTouched && next.data?.code && code !== next.data.code &&
            <button type="button" className="text-[11px] text-blue-600 mt-0.5" onClick={() => { setCode(next.data!.code); setCodeTouched(false) }}>Dùng mã gợi ý {next.data.code}</button>}
        </div>
        <div>
          <Label className="text-xs">Ghi chú</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Tuỳ chọn" className="h-8 text-xs mt-0.5" />
        </div>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
      </div>
    </FormSheet>
  )
}
