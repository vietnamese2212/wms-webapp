import { AlertTriangle } from 'lucide-react'
import type { AxiosError } from 'axios'

/**
 * Banner đỏ inline cho lỗi TẢI DANH SÁCH của list page.
 *
 * Sinh ra từ luật "chặn + hướng dẫn thu hẹp, KHÔNG cắt âm thầm": BE trả 400 `RANGE_TOO_WIDE`
 * khi khoảng ngày quá rộng (vượt trần dòng). Không có banner này thì user chỉ thấy BẢNG RỖNG
 * mà không biết vì sao — tệ hơn cả việc để nó chậm.
 */
export function ListErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  const ax = error as AxiosError<{ error?: { code?: string; message?: string } }>
  const code = ax.response?.data?.error?.code
  const msg = ax.response?.data?.error?.message
    ?? (ax.message === 'Network Error' ? 'Mất kết nối máy chủ. Kiểm tra mạng rồi thử lại.' : null)
    ?? 'Không tải được danh sách. Vui lòng thử lại.'
  const wide = code === 'RANGE_TOO_WIDE'
  return (
    <div className={`mx-3 mb-2 flex items-start gap-2 rounded border px-3 py-2 text-xs ${
      wide ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-600'}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{msg}</span>
    </div>
  )
}
