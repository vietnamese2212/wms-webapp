import { QrCode, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { QRScanner } from './QRScanner'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'

interface QRScanDialogProps {
  open: boolean
  onClose: () => void
  onScan: (text: string) => void
  title?: string
  // Kho của nghiệp vụ (nếu biết) → quyết loại mã camera giải; không truyền thì theo bối cảnh Kho toàn cục
  warehouseId?: string | null
}

// Dialog quét QR 1-phát (ô search / điền mã vào form) — dùng chung mọi module.
// Khung camera CAO ~62% màn hình (gần bằng sheet quét đơn, thay hộp 4:3 bé max-w-sm cũ khó canh tem)
// + nút X 36px dễ bấm (X mặc định của DialogContent quá nhỏ → ẩn bằng [&>button]:hidden, X đó là
// button con trực tiếp duy nhất của DialogContent — các nút khác đều nằm trong div nên không bị ẩn).
// Nhãn mặc định nói CẢ HAI loại mã (từ 21/08 camera đọc luôn mã vạch 1D) — người quét cần biết là
// đưa barcode vào cũng được; chỗ nào chỉ nhận tem pallet thì truyền `title` riêng.
export function QRScanDialog({ open, onClose, onScan, title = 'Quét mã QR / mã vạch', warehouseId }: QRScanDialogProps) {
  const codeTypes = useScanCodeTypes(warehouseId)
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="w-[calc(100vw-0.75rem)] max-w-md p-2 gap-2 [&>button]:hidden">
        <div className="flex items-center justify-between pl-1">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <QrCode className="h-4 w-4" />{title}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            title="Đóng"
            className="h-9 w-9 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="h-[62dvh]">
          <QRScanner onScan={onScan} onClose={onClose} fill codeTypes={codeTypes} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
