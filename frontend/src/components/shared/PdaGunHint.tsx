import { ScanBarcode } from 'lucide-react'

// Chỉ báo "màn/chỗ này bắn được SÚNG PDA" — icon + tooltip (title), đặt ngay cạnh chỗ kích hoạt quét.
// Icon-only cho gọn (PDA màn nhỏ); tooltip hiện khi rê chuột (PC) / mô tả cho a11y.
export function PdaGunHint({ className = '' }: { className?: string }) {
  return (
    <span
      title="Bắn súng PDA được ở đây"
      aria-label="Bắn súng PDA được ở đây"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-600 shrink-0 ${className}`}
    >
      <ScanBarcode className="h-4 w-4" />
    </span>
  )
}
