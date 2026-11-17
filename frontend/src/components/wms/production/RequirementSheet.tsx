// SỬA ĐỊNH MỨC TRÊN PHIẾU CỦA MẺ (MES 14/11 → 17/11). Phiếu chép từ CÔNG THỨC lúc mở mẻ; ở đây người có quyền "Sửa định mức của mẻ"
// (trưởng ca) sửa cho riêng mẻ này: sửa số · thêm · bỏ · đổi mã · đổi sang công thức khác. Có thay đổi thì BẮT BUỘC lý do;
// định mức GỐC của từng dòng luôn được giữ (dòng của công thức bị bỏ vẫn hiện "đã bỏ" trên bàn). Phần đã cấp không bị đụng.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { RotateCcw, Undo2 } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { MatLinesEditor, toMatLine, matLineError, matLinesPayload, type MatLine } from './MatLinesEditor'
import { useSetRequirements, useApplyRecipe, useRecipes, type BatchDetail } from '@/api/productionHooks'
import { unitCode } from '@/utils/unitCode'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })

export function RequirementSheet({ open, onClose, batch }: { open: boolean; onClose: () => void; batch: BatchDetail }) {
  const [lines, setLines] = useState<MatLine[]>([])
  const [reason, setReason] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [err, setErr] = useState('')
  const save = useSetRequirements()
  const apply = useApplyRecipe()
  const [ask, confirmNode] = useConfirmDialog()
  const { data: recipes = [] } = useRecipes(batch.material_id, true, open)
  const current = batch.board.filter(r => !r.removed && r.required != null)
  const removed = batch.board.filter(r => r.removed)
  const stamp = batch.board.map(r => `${r.material_id}:${r.required}:${r.removed}`).join('|')
  const initial = useMemo(() => current.map(r => toMatLine(r, r.required, { standard: r.standard, replacesCode: r.replaces_code ?? undefined })),
    [stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    setLines(initial); setErr(''); setReason('')
    setRecipeId(batch.recipe_id ?? recipes.find(r => r.is_default)?.id ?? '')
  }, [open, stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !recipeId && recipes.length) setRecipeId(batch.recipe_id ?? recipes.find(r => r.is_default)?.id ?? recipes[0].id) }, [open, recipes]) // eslint-disable-line react-hooks/exhaustive-deps

  const bad = lines.some(l => matLineError(l))
  const dirty = JSON.stringify(matLinesPayload(lines)) !== JSON.stringify(matLinesPayload(initial))
  const needReason = dirty && !reason.trim()
  const busy = save.isPending || apply.isPending
  async function doSave() {
    setErr('')
    try { await save.mutateAsync({ batchId: batch.id, items: matLinesPayload(lines), reason: reason.trim() || undefined }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  async function doApply() {
    const r = recipes.find(x => x.id === recipeId)
    if (!r) return
    const same = r.id === batch.recipe_id
    const ok = await ask({
      title: same ? `Chép lại công thức "${r.name}"?` : `Đổi sang công thức "${r.name}"?`,
      body: `Phiếu hiện tại (kể cả các dòng đã sửa) bị thay bằng công thức "${r.name}" × lượng kế hoạch của mẻ. Phần đã cấp giữ nguyên.`,
    })
    if (ok === null) return
    setErr('')
    try { await apply.mutateAsync({ batchId: batch.id, replace: true, recipe_id: r.id }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  const restore = (r: (typeof removed)[number]) =>
    setLines(ls => ls.some(l => l.material_id === r.material_id) ? ls : [...ls, toMatLine(r, r.standard, { standard: r.standard })])

  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-3xl" title={`Sửa định mức — mẻ ${batch.batch_code}`}
      description={`Chỉ áp cho mẻ này, không đổi công thức. Định mức gốc theo công thức${batch.recipe ? ` "${batch.recipe.name}"` : ''} luôn được giữ để đối chiếu.`}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={bad || busy || !dirty || needReason} onClick={() => void doSave()}>{save.isPending ? 'Đang lưu…' : 'Lưu định mức'}</Button>
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <MatLinesEditor lines={lines} onChange={setLines} excludeId={batch.material_id} allowSwap
          emptyText="Phiếu chưa có nguyên liệu nào — thêm bên dưới, hoặc chép công thức." />
        {removed.length > 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5">
            <p className="text-[11px] text-slate-500 mb-1">Đã bỏ khỏi phiếu (gốc theo công thức):</p>
            <div className="flex flex-wrap gap-1.5">
              {removed.map(r => (
                <button key={r.material_id} type="button" onClick={() => restore(r)} disabled={lines.some(l => l.material_id === r.material_id)}
                  className="touch-target inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-white disabled:opacity-40"
                  title={r.change_reason ? `Lý do bỏ: ${r.change_reason}` : undefined}>
                  <Undo2 className="h-3 w-3" /><span className="font-mono">{r.material_code}</span> {r.standard != null ? `${nf(r.standard)} ${unitCode(r.base_unit)}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <Label className="text-xs">Lý do sửa {dirty && <span className="text-red-500">*</span>}</Label>
          <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="VD: Đường ẩm, bù thêm · hết SMP-MH, đổi sang SMP-LH"
            className={`h-9 sm:h-8 text-xs mt-0.5 ${needReason ? 'border-red-300' : ''}`} />
          {needReason && <p className="text-[11px] text-red-600 mt-0.5">Có thay đổi so với phiếu hiện tại — nhập lý do để lưu.</p>}
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2 space-y-1.5">
          <Label className="text-xs">Công thức của mẻ</Label>
          {recipes.length ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <SingleSelect value={recipeId} onChange={setRecipeId} searchable={recipes.length > 6} triggerClassName="h-9 sm:h-8 text-xs"
                  options={recipes.map(r => ({ value: r.id, label: r.name, sub: `cỡ ${nf(r.base_qty)} ${unitCode(r.material?.base_unit)}${r.is_default ? ' · mặc định' : ''}${r.id === batch.recipe_id ? ' · đang dùng' : ''}` }))} />
              </div>
              <button type="button" disabled={busy || !recipeId} onClick={() => void doApply()}
                className="touch-target shrink-0 inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                <RotateCcw className="h-3 w-3" />{recipeId === batch.recipe_id ? 'Chép lại' : 'Đổi công thức'}
              </button>
            </div>
          ) : <p className="text-[11px] text-slate-500">Mã {batch.material?.material_code} chưa có công thức đang dùng — khai ở Sản xuất (MES) → Định mức.</p>}
        </div>
      </div>
      {confirmNode}
    </FormSheet>
  )
}
