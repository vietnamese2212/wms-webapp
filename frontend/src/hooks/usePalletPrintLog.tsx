// GHI LỊCH SỬ IN TEM PALLET + MỞ HỘP IN — MỘT CHỖ cho mọi cửa in tem pallet (In tem pallet: sinh mới / in lại · Dồn / Tách:
// tem con). C127 (19/11, user duyệt "làm theo đề xuất"): trước đây bấm In là ghi sổ, bấm Huỷ trong hộp in vẫn tính là
// "đã in" (Truy cứu báo in 2 lần, cảnh báo tem trùng oan), và ghi sổ lỗi thì im lặng.
//   • Ghi sổ TRƯỚC khi mở hộp in — không lần in thật nào lọt sổ.
//   • Hộp in đóng ⇒ hỏi "Tem đã in ra giấy chưa?" — "Chưa in" gỡ đúng lần ghi này (BE chỉ cho gỡ lần in của chính mình, ≤ 30 phút);
//     đóng hộp / "Đã in" ⇒ giữ nguyên (mặc định an toàn).
//   • Ghi / gỡ lỗi ⇒ băng đỏ trong màn.
// Dùng: const pp = usePalletPrintLog(); setPrintLabels(items); pp.logAndPrint('GENERATE', logRows, items.length); … render {pp.node}
import { useState, type ReactNode } from 'react'
import type { AxiosError } from 'axios'
import { useLogPalletPrints, useCancelPalletPrintBatch } from '@/api/hooks'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { printWhenReady } from '@/components/shared/PrintArea'

const apiErr = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>).response?.data?.error?.message ?? 'lỗi kết nối'

export function usePalletPrintLog(): {
  logAndPrint: (mode: 'GENERATE' | 'REPRINT', logRows: Record<string, unknown>[], count: number) => void
  node: ReactNode
} {
  const logPrints = useLogPalletPrints()
  const cancelBatch = useCancelPalletPrintBatch()
  const [error, setError] = useState<string | null>(null)
  const [ask, askNode] = useConfirmDialog()

  function logAndPrint(mode: 'GENERATE' | 'REPRINT', logRows: Record<string, unknown>[], count: number) {
    if (!count) return
    setError(null)
    const logged = logPrints.mutateAsync({ mode, labels: logRows }).catch((e: unknown) => {
      setError(`Chưa ghi được Lịch sử in: ${apiErr(e)} — tem vẫn in, báo quản lý để ghi bù.`)
      return null
    })
    // chờ ảnh QR trong vùng in vẽ xong (canh giờ cố định là cuộc đua — nhiều tem thì in ra ô trống)
    printWhenReady(count, '.pl-print-area', async () => {
      const notPrinted = await ask({
        title: 'Tem đã in ra giấy chưa?',
        body: `Hộp in vừa đóng (${count} tem). Nếu bạn đã bấm Huỷ trong hộp in hoặc máy in không ra tem, chọn "Chưa in" để lần này không tính vào Lịch sử in.`,
        confirmLabel: 'Chưa in — bỏ khỏi lịch sử', cancelLabel: 'Đã in',
      })
      if (notPrinted === null) return
      const d = await logged
      if (!d?.batch_id) return
      cancelBatch.mutate(d.batch_id, { onError: (e: unknown) => setError(`Chưa gỡ được lần in khỏi lịch sử: ${apiErr(e)}`) })
    })
  }

  const node = (
    <>
      {error && <div data-testid="print-log-error" className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>}
      {askNode}
    </>
  )
  return { logAndPrint, node }
}
