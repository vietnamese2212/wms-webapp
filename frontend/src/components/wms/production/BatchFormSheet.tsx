// Form MỞ / SỬA MẺ chế biến. 17/11 (user chốt): CHU KỲ · SỐ MẺ (4 số) · BỒN bắt buộc ngay lúc tạo; mã lô KHÔNG gõ tay — app ghép
// <chữ nhà máy><chu kỳ><số mẻ><mã bồn> (vd B300001BD62). Đổi bồn trước khi nạp ⇒ mã lô đổi theo, tem đã in phải in lại.
// Mẻ chỉ mở ở KHO CHẾ BIẾN (kho phụ nội bộ). Mã bán thành phẩm phải tính theo L hoặc KG (vào bồn).
// 27/11 — kho chạy KHÔNG ĐỊNH MỨC (Cài đặt MES): QA "Lập mẻ" theo phiếu chế biến giấy — lượng mẻ bắt buộc, danh sách mã của công thức
// hiện sẵn để QA đối chiếu với phiếu (bỏ / thêm cho khớp), không số lượng, không hai bước duyệt. Ai thấy kho nào: kho không định mức =
// quyền QA duyệt phiếu, kho có định mức = quyền Mở mẻ (server chốt cùng luật).
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
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { MatLinesEditor, toMatLine, type MatLine } from './MatLinesEditor'
import { defaultExtraForms } from '@/config/processForms'
import { useProductionTanks, useProductionWarehouses, useNextBatchCode, useCreateBatch, useUpdateBatch, useProcessForms, useShiftNames, defaultKitchen, useSemiFinishedSearch, useRecipes, useRecipe, SEMI_FINISHED_PLACEHOLDER, type BatchDetail } from '@/api/productionHooks'
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
  template?: { warehouse_id: string; material_id: string; machine_code: string | null; shift: string | null; cycle?: string | null; tank_id?: string | null; planned_qty: number | null; recipe_id?: string | null } | null
  onSaved?: (id: string) => void
}) {
  const editing = !!batch
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const { data: { kitchens: allKitchens } } = useProductionWarehouses()
  // lập mẻ MỚI: kho không định mức chỉ cho QA (approve_qa), kho có định mức cho người có quyền Mở mẻ — cùng luật server
  const kitchens = useMemo(() => (editing ? allKitchens
    : allKitchens.filter(k => (k.mes_no_norm ? can(perms, 'production', 'approve_qa') : can(perms, 'production', 'open_batch')))), [allKitchens, editing, perms])
  const [wh, setWh] = useState('')
  const [mat, setMat] = useState('')
  const [matTerm, setMatTerm] = useState('')
  const [date, setDate] = useState(todayVN())
  const [machine, setMachine] = useState('')
  const [shift, setShift] = useState('')
  const [cycle, setCycle] = useState('')
  const [planned, setPlanned] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [noTouched, setNoTouched] = useState(false)
  const [tank, setTank] = useState('')
  const [note, setNote] = useState('')
  // CÔNG THỨC (17/11): một mã có nhiều công thức — chọn sẵn công thức mặc định (Mở mẻ giống: công thức của mẻ gốc)
  const [recipeId, setRecipeId] = useState('')
  // PHIẾU BỔ SUNG (17/11): tick sẵn theo mã BTP (Cài đặt MES → Mẫu phiếu), người mở chỉnh được; phiếu đã ghi không bỏ được
  const { data: processForms = [] } = useProcessForms()
  const [extras, setExtras] = useState<string[]>([])
  const [extrasTouched, setExtrasTouched] = useState(false)
  // 27/11 KHÔNG ĐỊNH MỨC: danh sách mã QA đối chiếu với phiếu chế biến (chép từ công thức, sửa được) — chỉ khi lập mẻ mới
  const [codes, setCodes] = useState<MatLine[]>([])
  const [codesFor, setCodesFor] = useState('')
  const [err, setErr] = useState('')
  const create = useCreateBatch()
  const shiftNames = useShiftNames(shift || null)
  const update = useUpdateBatch()

  useEffect(() => {
    if (!open) return
    setErr(''); setNoTouched(editing); setExtrasTouched(false); setCodes([]); setCodesFor('')
    setExtras(batch?.extra_forms ?? [])
    if (batch) {
      setWh(batch.warehouse_id); setMat(batch.material_id); setDate(batch.prod_date); setMachine(batch.machine_code ?? '')
      setShift(batch.shift ?? ''); setCycle(batch.cycle ?? ''); setPlanned(vnNumberInput(batch.planned_qty)); setBatchNo(batch.batch_no ? String(batch.batch_no) : ''); setTank(batch.tank_id ?? ''); setNote(batch.note ?? '')
    } else if (template) {
      setWh(template.warehouse_id); setMat(template.material_id); setDate(todayVN()); setMachine(template.machine_code ?? '')
      setShift(template.shift ?? ''); setCycle(template.cycle ?? ''); setPlanned(vnNumberInput(template.planned_qty)); setBatchNo(''); setTank(template.tank_id ?? ''); setNote('')
      setRecipeId(template.recipe_id ?? '')
    } else {
      // bối cảnh Kho toàn cục: là kho chế biến thì lấy luôn; là kho nhà máy có đúng MỘT kho chế biến thì lấy kho đó
      setWh(defaultKitchen(kitchens, useGlobalScopeStore.getState().warehouseId, true))
      setMat(''); setDate(todayVN()); setMachine(''); setShift(''); setCycle(''); setPlanned(''); setBatchNo(''); setTank(''); setNote(''); setRecipeId('')
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
  const noNorm = editing ? !!batch?.no_norm : !!allKitchens.find(k => k.id === wh)?.mes_no_norm
  // kho CÓ định mức + công thức chỉ danh sách mã ⇒ không lập được (user chốt 27/11: chặn — điền số lượng ở Định mức trước)
  const recipeNoQty = !editing && !noNorm && !!selRecipe && selRecipe.base_qty == null
  // kho không định mức: chép danh sách mã của công thức đang chọn vào ô đối chiếu (đổi công thức ⇒ chép lại)
  const rd = useRecipe(open && !editing && noNorm && recipeId ? recipeId : undefined)
  useEffect(() => {
    if (!noNorm || editing) return
    const key = `${mat}|${recipeId}`
    if (codesFor === key) return
    if (!recipeId) { if (!recipesLoading && mat) { setCodes([]); setCodesFor(key) } return }
    if (!rd.data || rd.data.id !== recipeId) return
    setCodes(rd.data.lines.map(l => toMatLine({ material_id: l.material_id, material_code: l.material?.material_code ?? '', material_name: l.material?.short_name ?? null, base_unit: l.material?.base_unit ?? null }, null)))
    setCodesFor(key)
  }, [noNorm, editing, mat, recipeId, rd.data, recipesLoading]) // eslint-disable-line react-hooks/exhaustive-deps
  const logged = useMemo(() => (batch?.process_logs ?? []).map(l => l.form), [batch?.process_logs])
  const optForms = processForms.filter(f => f.optional && (f.is_active || extras.includes(f.code)))
  // đổi mã BTP (chưa tự tick tay) ⇒ phiếu bổ sung theo mã mới; giữ phiếu đã ghi
  useEffect(() => {
    if (!open || extrasTouched || !mat || !processForms.length) return
    if (editing && mat === batch?.material_id) return
    setExtras([...new Set([...defaultExtraForms(processForms, mat), ...logged.filter(c => processForms.some(f => f.code === c && f.optional))])])
  }, [mat, processForms, open]) // eslint-disable-line react-hooks/exhaustive-deps
  const baseForms = processForms.filter(f => f.is_active && !f.optional).map(f => f.short).join(', ')
  const toggleExtra = (code: string) => { setExtrasTouched(true); setExtras(x => x.includes(code) ? x.filter(c => c !== code) : [...x, code]) }
  const { data: machines = [] } = useMachines(wh || undefined)
  const activeMachines = machines.filter(m => m.is_active !== false)
  // BỒN của kho chế biến: chỉ bồn cùng đơn vị với mã BTP; chỗ trống = sức chứa − đang chứa − phần mẻ KHÁC đã đặt
  const { data: tanks = [] } = useProductionTanks(wh || undefined, false, open && !!wh)
  const matUnit = unitCode(selMat?.base_unit)
  const tankOpts = useMemo(() => tanks.filter(t => t.warehouse_id === wh && (!matUnit || t.unit === matUnit)).map(t => {
    const otherRes = t.incoming.filter(x => x.batch_id !== batch?.id).reduce((a, x) => a + x.qty, 0)
    const free = Math.max(t.capacity - t.content - otherRes, 0)
    const holds = t.lots[0]?.batch?.material?.material_code ?? t.incoming.find(x => x.batch_id !== batch?.id)?.material_code
    return { value: t.id, label: t.code, free, sub: `còn chỗ ${free.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} ${t.unit}${holds ? ` · ${t.content > 0 ? 'đang chứa' : 'đã đặt cho'} ${holds}` : ' · trống'}` }
  }), [tanks, wh, matUnit, batch?.id])
  const selTank = tankOpts.find(t => t.value === tank)
  const cycleNorm = cycle.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const noNum = /^\d{1,4}$/.test(batchNo.trim()) ? Number(batchNo) : null
  // đã nạp bồn ⇒ mã lô đứng yên: chu kỳ / số mẻ / bồn khoá (đưa sang bồn khác = Chuyển bồn ở trang Bồn)
  const filled = !!batch?.movements.length
  // 25/11 (cải tiến rà soát MES): khoá sẵn ô mà server sẽ từ chối — đỡ bấm Lưu rồi mới nhận 409
  const approved = !!batch?.qa_ok_at
  const matLocked = !!batch && (filled || approved || (batch.consumption ?? []).some(c => !c.reversed_at))
  const next = useNextBatchCode({ warehouse_id: wh || undefined, cycle: cycleNorm || undefined, tank_id: tank || undefined, batch_no: noNum ?? undefined }, open)
  useEffect(() => { if (!editing && !noTouched && next.data?.next_no) setBatchNo(String(next.data.next_no)) }, [next.data?.next_no, editing, noTouched])
  const codePreview = filled ? batch?.batch_code : next.data?.code
  const codeChanges = editing && !filled && !!codePreview && codePreview !== batch?.batch_code

  const saving = create.isPending || update.isPending
  const plannedNum = planned.trim() ? parseVnNumber(planned) : null
  const plannedBad = !planned.trim() || plannedNum == null || plannedNum <= 0
  const overRoom = !!selTank && plannedNum != null && plannedNum > selTank.free + 0.0005 && !filled
  const codesOk = editing || !noNorm || codes.length > 0
  const canSave = !!wh && !!mat && !!date && !!shift && !plannedBad && !!cycleNorm && cycleNorm.length <= 6 && !!noNum && noNum >= 1 && !!tank && !saving && codesOk && !recipeNoQty

  async function save() {
    setErr('')
    try {
      if (batch) {
        const same = (a: string[], b: string[]) => a.length === b.length && a.every(c => b.includes(c))
        const formsChanged = batch.status === 'OPEN' && (mat !== batch.material_id || !same(extras, batch.extra_forms ?? []))
        // MỘT lệnh sửa (25/11 F9): phiếu bổ sung đi cùng, server ghi tất cả trong một giao dịch — lỗi thì không ghi gì
        const r = await update.mutateAsync({ id: batch.id, prod_date: date, machine_code: machine || null, shift,
          planned_qty: plannedNum, note: note || null,
          ...(filled ? {} : { ...(cycleNorm !== batch.cycle ? { cycle: cycleNorm } : {}), ...(noNum !== batch.batch_no ? { batch_no: noNum ?? undefined } : {}), ...(tank !== batch.tank_id ? { tank_id: tank } : {}) }),
          ...(mat !== batch.material_id ? { material_id: mat } : {}),
          ...(formsChanged ? { extra_forms: extras } : {}) })
        onSaved?.(r.id); onClose()
      } else {
        const r = await create.mutateAsync({ warehouse_id: wh, material_id: mat, prod_date: date, cycle: cycleNorm, batch_no: noNum ?? undefined, tank_id: tank,
          machine_code: machine || undefined, shift, planned_qty: plannedNum, note: note || undefined,
          recipe_id: recipeId || undefined, extra_forms: extras, ...(noNorm ? { items: codes.map(c => ({ material_id: c.material_id })) } : {}) })
        onSaved?.(r.id); onClose()
      }
    } catch (e) { setErr(apiMsg(e)) }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={editing ? `Sửa mẻ ${batch?.batch_code}` : noNorm ? 'Lập mẻ chế biến (không định mức)' : 'Mở mẻ chế biến'}
      description={noNorm && !editing ? 'Theo phiếu chế biến giấy của trưởng ca: lượng mẻ + danh sách mã nguyên liệu (không số lượng). QA lập mẻ là đã duyệt — không qua bước duyệt.'
        : 'Chu kỳ, số mẻ, bồn và ca bắt buộc. Mã lô tự ghép: chữ nhà máy + chu kỳ + số mẻ + mã bồn.'}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={!canSave} onClick={() => void save()}>{saving ? 'Đang lưu…' : editing ? 'Lưu' : noNorm ? 'Lập mẻ' : 'Mở mẻ'}</Button>
      </>}>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Kho chế biến <span className="text-red-500">*</span></Label>
          <SingleSelect value={wh} onChange={v => { setWh(v); setMachine(''); setTank(''); setNoTouched(false) }} disabled={editing}
            placeholder={kitchens.length ? 'Chọn kho chế biến' : 'Chưa có kho chế biến trong phạm vi'}
            options={kitchens.map(k => ({ value: k.id, label: k.name, sub: `${k.parent_name ? `thuộc ${k.parent_name}` : k.code}${k.mes_no_norm ? ' · không định mức' : ''}` }))} />
          {!kitchens.length && <p className="text-[11px] text-amber-700 mt-1">Khai kho chế biến là kho phụ nội bộ: Cài đặt WMS → Kho → "Trực thuộc kho".</p>}
        </div>
        <div>
          <Label className="text-xs">Mã bán thành phẩm <span className="text-red-500">*</span></Label>
          <SingleSelect value={mat} onChange={setMat} serverSearch onSearchChange={setMatTerm} loading={isFetching} disabled={matLocked}
            selectedLabel={selMat ? selMat.material_code : (batch?.material_id === mat ? batch?.material?.material_code : undefined)} placeholder={SEMI_FINISHED_PLACEHOLDER} options={matOpts} />
          {matLocked && <p className="text-[11px] text-slate-500 mt-0.5">{approved ? 'QA đã duyệt phiếu — QA bỏ duyệt rồi mới đổi mã' : 'Mẻ đã cấp NVL / đã nạp bồn — không đổi mã bán thành phẩm'}</p>}
          {noBtp && !mat && <NoSemiFinishedHint />}
        </div>
        {!editing && !!mat && (
          <div>
            <Label className="text-xs">Công thức</Label>
            {recipes.length ? (
              <SingleSelect value={recipeId} onChange={setRecipeId} searchable={recipes.length > 6} triggerClassName="h-8 text-xs mt-0.5"
                options={recipes.map(r => ({ value: r.id, label: r.name, sub: `${r.base_qty == null ? 'chỉ danh sách mã' : `cỡ chuẩn ${Number(r.base_qty).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} ${unitCode(r.material?.base_unit)}`}${r.is_default ? ' · mặc định' : ''}` }))} />
            ) : (
              <p className="text-[11px] text-amber-700 mt-0.5">{recipesLoading ? 'Đang tải công thức…' : noNorm ? 'Mã này chưa có công thức đang dùng — thêm các mã của phiếu chế biến vào danh sách bên dưới.' : 'Mã này chưa có công thức đang dùng — phiếu của mẻ sẽ trống (khai ở Sản xuất (MES) → Định mức, hoặc thêm tay trên mẻ).'}</p>
            )}
            {selRecipe && !noNorm && !recipeNoQty && <p className="text-[11px] text-slate-500 mt-0.5">{selRecipe.line_count ?? 0} nguyên liệu · nhân theo lượng kế hoạch / cỡ chuẩn{selRecipe.note ? ` · ${selRecipe.note}` : ''}</p>}
            {recipeNoQty && <p className="text-[11px] text-red-600 mt-0.5" data-testid="recipe-no-qty">Công thức "{selRecipe?.name}" chỉ có danh sách mã, chưa có số lượng — kho này chạy có định mức: điền số lượng ở Sản xuất (MES) → Định mức rồi mở mẻ.</p>}
          </div>
        )}
        {!editing && noNorm && !!mat && (
          <div data-testid="batch-codes">
            <Label className="text-xs">Danh sách nguyên liệu theo phiếu chế biến <span className="text-red-500">*</span></Label>
            <p className="text-[11px] text-slate-500">Đối chiếu từng mã với phiếu giấy, bỏ / thêm cho khớp. Không số lượng — lúc cấp, app chỉ chặn mã ngoài danh sách; đủ / thiếu so tay với phiếu.</p>
            <div className="mt-1"><MatLinesEditor lines={codes} onChange={setCodes} excludeId={mat} codesOnly emptyText="Chưa có mã nào — thêm các mã có trên phiếu chế biến." /></div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Chu kỳ <span className="text-red-500">*</span></Label>
            <Input value={cycle} onChange={e => { setCycle(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setNoTouched(false) }} maxLength={6} disabled={filled}
              placeholder="vd 30" className="h-9 sm:h-8 text-xs mt-0.5 font-mono" aria-label="Chu kỳ" />
          </div>
          <div>
            <Label className="text-xs">Số mẻ <span className="text-red-500">*</span></Label>
            <Input value={batchNo} onChange={e => { setBatchNo(e.target.value.replace(/\D/g, '').slice(0, 4)); setNoTouched(true) }} disabled={filled}
              inputMode="numeric" placeholder={next.isFetching ? '…' : 'Số kế tiếp'} className="h-9 sm:h-8 text-xs mt-0.5 font-mono" aria-label="Số mẻ" />
          </div>
          <div>
            <Label className="text-xs">Bồn <span className="text-red-500">*</span></Label>
            <SingleSelect value={tank} onChange={setTank} disabled={filled || !wh} searchable={tankOpts.length > 8} triggerClassName="h-9 sm:h-8 text-xs mt-0.5"
              placeholder={!wh ? 'Chọn kho trước' : tankOpts.length ? 'Chọn bồn' : 'Chưa có bồn'} options={tankOpts} />
          </div>
        </div>
        {filled && <p className="text-[11px] text-slate-500 -mt-1.5">Mẻ đã nạp bồn — chu kỳ, số mẻ, bồn không đổi được nữa. Đưa sang bồn khác: trang Bồn → Chuyển.</p>}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">Mã lô</span>
          <span className={`font-mono text-sm font-semibold tracking-wide ${codePreview ? 'text-slate-900' : 'text-slate-300'}`} data-testid="batch-code-preview">{codePreview ?? '—'}</span>
        </div>
        {open && !!wh && next.data && !next.data.plant && <p className="text-[11px] text-amber-700 -mt-1.5">Kho chưa khai "Mã NMSX" (chữ nhà máy trong mã lô) — khai ở Cài đặt WMS → Kho.</p>}
        {codeChanges && <p className="text-[11px] text-amber-700 -mt-1.5">Mã lô sẽ đổi từ {batch?.batch_code}.{batch?.label_at ? ' Tem pallet đã in mất hiệu lực — in lại sau khi lưu.' : ''}</p>}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">{noNorm ? 'Lượng mẻ (theo phiếu)' : 'Lượng kế hoạch'}{selMat ? ` (${unitCode(selMat.base_unit)})` : ''} <span className="text-red-500">*</span></Label>
            <Input value={planned} onChange={e => setPlanned(e.target.value)} inputMode="decimal" aria-label="Lượng kế hoạch" disabled={approved} title={approved ? 'QA đã duyệt phiếu — QA bỏ duyệt rồi mới sửa kế hoạch' : undefined} className={`h-9 sm:h-8 text-xs mt-0.5 ${(planned.trim() && plannedBad) || overRoom ? 'border-red-400' : ''}`} />
            {overRoom && <p className="text-[11px] text-red-600 mt-0.5">Bồn {selTank?.label} chỉ còn chỗ {selTank?.free.toLocaleString('vi-VN', { maximumFractionDigits: 3 })}</p>}
          </div>
          <div>
            <Label className="text-xs">Ngày sản xuất <span className="text-red-500">*</span></Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 sm:h-8 text-xs mt-0.5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Ca <span className="text-red-500">*</span></Label>
            {/* cùng danh mục ca với báo cáo ca + Sổ đóng gói — một ca một nhãn. BẮT BUỘC (21/11): Báo cáo NVL chia lệch định mức theo ca */}
            <SingleSelect value={shift} onChange={setShift} searchable={false} placeholder="Chọn ca" triggerClassName="h-9 sm:h-8 text-xs mt-0.5"
              options={shiftNames.map(s => ({ value: s, label: s }))} />
          </div>
          <div>
            <Label className="text-xs">Máy / thiết bị trộn</Label>
            {activeMachines.length
              ? <SingleSelect value={machine} onChange={setMachine} placeholder="Chọn máy" triggerClassName="h-9 sm:h-8 text-xs mt-0.5" options={activeMachines.map(m => ({ value: m.code, label: m.code, sub: m.note ?? undefined }))} />
              : <Input value={machine} onChange={e => setMachine(e.target.value.toUpperCase())} maxLength={20} placeholder="Tuỳ chọn" className="h-9 sm:h-8 text-xs mt-0.5" />}
          </div>
        </div>
        {optForms.length > 0 && (!editing || batch?.status === 'OPEN') && (
          <div>
            <Label className="text-xs">Phiếu theo dõi bổ sung</Label>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid="batch-extra-forms">
              {optForms.map(f => {
                const on = extras.includes(f.code)
                const locked = logged.includes(f.code)
                return (
                  <button key={f.code} type="button" disabled={locked} onClick={() => toggleExtra(f.code)} aria-pressed={on} data-form={f.code}
                    title={locked ? 'Phiếu đã ghi — không bỏ khỏi mẻ được' : f.title}
                    className={`touch-target inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${on ? 'border-sky-400 bg-sky-50 text-sky-900 font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} disabled:opacity-70`}>
                    <span className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center text-[10px] leading-none ${on ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300'}`}>{on ? '✓' : ''}</span>
                    {f.short}{locked ? ' · đã ghi' : ''}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Tick sẵn theo mã bán thành phẩm.{baseForms ? ` Mẻ nào cũng có: ${baseForms}.` : ''}</p>
          </div>
        )}
        <div>
          <Label className="text-xs">Ghi chú</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Tuỳ chọn" className="h-8 text-xs mt-0.5" />
        </div>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
      </div>
    </FormSheet>
  )
}
