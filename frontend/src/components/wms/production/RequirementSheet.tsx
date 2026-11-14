// SỬA YÊU CẦU NGUYÊN LIỆU CỦA MỘT MẺ (bàn làm việc của mẻ — MES 14/11). Yêu cầu chép từ ĐỊNH MỨC lúc mở mẻ; ở đây sửa cho riêng
// mẻ này: đổi số, thêm / bỏ nguyên liệu, hoặc chép lại định mức. Bỏ một dòng KHÔNG đụng phần đã cấp (dòng đó hiện "ngoài yêu cầu").
import { useEffect, useState } from 'react'
import type { AxiosError } from 'axios'
import { RotateCcw } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { MatLinesEditor, toMatLine, matLineError, matLinesPayload, type MatLine } from './MatLinesEditor'
import { useSetRequirements, useApplyRecipe, type BatchDetail } from '@/api/productionHooks'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'

export function RequirementSheet({ open, onClose, batch }: { open: boolean; onClose: () => void; batch: BatchDetail }) {
  const [lines, setLines] = useState<MatLine[]>([])
  const [err, setErr] = useState('')
  const save = useSetRequirements()
  const apply = useApplyRecipe()
  const [ask, confirmNode] = useConfirmDialog()
  const required = batch.board.filter(r => r.required != null)
  const stamp = required.map(r => `${r.material_id}:${r.required}`).join('|')
  useEffect(() => { if (open) { setLines(required.map(r => toMatLine(r, r.required))); setErr('') } }, [open, stamp]) // eslint-disable-line react-hooks/exhaustive-deps

  const bad = lines.some(l => matLineError(l))
  const busy = save.isPending || apply.isPending
  async function doSave() {
    setErr('')
    try { await save.mutateAsync({ batchId: batch.id, items: matLinesPayload(lines) }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  async function doApply() {
    const ok = await ask({ title: 'Chép lại định mức vào mẻ?', body: 'Danh sách yêu cầu hiện tại bị thay bằng định mức của mã bán thành phẩm × lượng kế hoạch của mẻ. Phần đã cấp giữ nguyên.' })
    if (ok === null) return
    setErr('')
    try { await apply.mutateAsync({ batchId: batch.id, replace: true }) }
    catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-xl" title={`Yêu cầu nguyên liệu — mẻ ${batch.batch_code}`}
      description="Số lượng theo đơn vị gốc của từng nguyên liệu. Sửa ở đây chỉ áp cho mẻ này, không đổi định mức."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={bad || busy} onClick={() => void doSave()}>{save.isPending ? 'Đang lưu…' : 'Lưu yêu cầu'}</Button>
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <MatLinesEditor lines={lines} onChange={setLines} excludeId={batch.material_id}
          emptyText="Mẻ chưa có yêu cầu nào — thêm nguyên liệu bên dưới, hoặc chép định mức." />
        <button type="button" disabled={busy} onClick={() => void doApply()}
          className="touch-target inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline disabled:opacity-50">
          <RotateCcw className="h-3 w-3" />Chép lại theo định mức của {batch.material?.material_code}
        </button>
      </div>
      {confirmNode}
    </FormSheet>
  )
}
