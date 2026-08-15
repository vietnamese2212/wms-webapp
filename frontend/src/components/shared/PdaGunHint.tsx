import { Smartphone } from 'lucide-react'

// Symbol hình PDA đặt CẠNH nút quét → user nhìn ra "bóp súng PDA thì kích hoạt tại đây".
// Chỉ là chỉ báo (icon + tooltip), không bấm được.
export function PdaGunHint({ className = '' }: { className?: string }) {
  return (
    <span
      title="Quét bằng súng PDA được ở đây"
      aria-label="Quét bằng súng PDA được ở đây"
      className={`inline-flex items-center justify-center text-sky-500 shrink-0 ${className}`}
    >
      <Smartphone className="h-4 w-4" />
    </span>
  )
}
