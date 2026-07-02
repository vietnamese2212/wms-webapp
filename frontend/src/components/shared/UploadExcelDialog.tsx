import { useRef, useState } from 'react'
import { Upload, Download, CheckCircle2, AlertTriangle, Info, Loader2 } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { UploadResult } from '@/api/hooks'

/**
 * Dialog upload Excel dùng chung (Mã hàng / Tồn kho): nút Tải mẫu + Chọn file + hiển thị kết quả.
 * onUpload trả UploadResult { inserted, updated?, skipped?, errors[] }:
 *   - inserted/updated > 0 → banner xanh tóm tắt.
 *   - errors[] có phần tử → banner vàng liệt kê (all-or-nothing: inserted=0 nghĩa là chưa nhập gì).
 */
export function UploadExcelDialog({ title, hint, onClose, onDownloadTemplate, onUpload }: {
  title: string
  hint?: string
  onClose: () => void
  onDownloadTemplate: () => void
  onUpload: (file: File) => Promise<UploadResult>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setErr(null); setResult(null)
    try {
      setResult(await onUpload(file))
    } catch (ex) {
      const ax = ex as AxiosError<{ error?: { message?: string } }>
      setErr(ax?.response?.data?.error?.message ?? 'Lỗi upload file')
    } finally {
      setBusy(false)
    }
  }

  const okParts = result
    ? [
        result.inserted > 0 && `Thêm ${result.inserted}`,
        (result.updated ?? 0) > 0 && `Cập nhật ${result.updated}`,
        (result.skipped ?? 0) > 0 && `Bỏ qua ${result.skipped}`,
      ].filter(Boolean).join(' · ')
    : ''
  const hasErrors = (result?.errors?.length ?? 0) > 0

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onDownloadTemplate} className="h-8 text-xs gap-1">
              <Download className="h-3.5 w-3.5" />Tải mẫu
            </Button>
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()} className="h-8 text-xs gap-1">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {busy ? 'Đang xử lý…' : 'Chọn file Excel'}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </div>
          {hint && <p className="text-[11px] text-slate-500">{hint}</p>}

          {result && okParts && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{okParts}
            </div>
          )}
          {result && !okParts && !hasErrors && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-600 flex items-center gap-2">
              <Info className="h-4 w-4 shrink-0" />Không có dòng nào được nhập.
            </div>
          )}
          {hasErrors && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <Info className="h-4 w-4 shrink-0" />
                {result!.inserted === 0
                  ? `${result!.errors.length} dòng lỗi — CHƯA NHẬP GÌ, sửa rồi upload lại:`
                  : `${result!.errors.length} dòng lỗi (đã nhập các dòng hợp lệ):`}
              </div>
              <pre className="whitespace-pre-wrap font-sans max-h-60 overflow-auto">
                {result!.errors.map(e => `• ${e}`).join('\n')}
              </pre>
            </div>
          )}
          {err && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-sans">{err}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
