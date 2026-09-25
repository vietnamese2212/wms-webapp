// HỘP THOẠI XÁC NHẬN DÙNG CHUNG — thay cho window.confirm / window.prompt / window.alert (25/09).
//
// Vì sao: hộp thoại của trình duyệt là khung xám không theo giao diện app, không xuống dòng được
// cho có hệ thống, trên PWA điện thoại hiện kèm tên miền, và một số trình duyệt cho người dùng
// tích "chặn hộp thoại của trang này" — từ đó mọi confirm() trả false âm thầm, nút bấm không làm
// gì cả. Màn Điều vận (24/09) dùng 6 cái cho đúng những bước không quay lại được (Xác nhận kế hoạch,
// ghi ĐVVT từ chối kèm lý do). Ratchet `native_dialog_call` gác không cho tăng.
//
// Dùng:
//   const [ask, confirmNode] = useConfirmDialog()
//   if (await ask({ title: 'Xoá dòng cước?', danger: true }) === null) return
//   const reason = await ask({ title: '…', input: { label: 'Lý do' } })   // null = huỷ, chuỗi = đã bấm OK
//   await ask({ title: 'Không xác nhận được', body: '…', cancelLabel: null })  // chỉ thông báo
//   … và render {confirmNode} một lần trong component.
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  /** null = không có nút Huỷ (hộp thoại chỉ để thông báo) */
  cancelLabel?: string | null
  /** Hành động phá huỷ / không quay lại được ⇒ nút đỏ */
  danger?: boolean
  /** Có ô nhập (thay window.prompt) — giá trị trả về là nội dung ô */
  input?: { label: string; placeholder?: string; required?: boolean }
}

export function useConfirmDialog() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [text, setText] = useState('')
  const resolver = useRef<((v: string | null) => void) | null>(null)

  const ask = useCallback((o: ConfirmOptions) => new Promise<string | null>(resolve => {
    resolver.current?.(null)          // hộp thoại cũ còn treo thì coi như huỷ
    resolver.current = resolve
    setText('')
    setOpts(o)
  }), [])
  const close = (v: string | null) => { resolver.current?.(v); resolver.current = null; setOpts(null) }

  const blocked = !!opts?.input?.required && !text.trim()
  const node = (
    <Dialog open={!!opts} onOpenChange={o => { if (!o) close(null) }}>
      <DialogContent className="sm:max-w-md">
        {opts && (<>
          <DialogHeader>
            <DialogTitle className="text-sm flex items-start gap-2">
              {opts.danger && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}
              <span>{opts.title}</span>
            </DialogTitle>
          </DialogHeader>
          {opts.body && <div className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{opts.body}</div>}
          {opts.input && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">{opts.input.label}</span>
              <textarea autoFocus rows={3} value={text} placeholder={opts.input.placeholder} onChange={e => setText(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
          )}
          <DialogFooter className="gap-2">
            {opts.cancelLabel !== null && <Button variant="outline" size="sm" className="h-8" onClick={() => close(null)}>{opts.cancelLabel ?? 'Huỷ'}</Button>}
            <Button size="sm" disabled={blocked} onClick={() => close(opts.input ? text.trim() : '')}
              className={`h-8 ${opts.danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {opts.confirmLabel ?? (opts.cancelLabel === null ? 'Đã hiểu' : 'Đồng ý')}
            </Button>
          </DialogFooter>
        </>)}
      </DialogContent>
    </Dialog>
  )
  return [ask, node] as const
}
