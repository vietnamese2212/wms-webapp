import { useState } from 'react'
import { Search, X, QrCode } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { QRScanDialog } from './QRScanDialog'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({ value, onChange, placeholder = 'Tìm…', className }: SearchInputProps) {
  const [scanOpen, setScanOpen] = useState(false)

  function handleScan(result: string) {
    onChange(result)
    setScanOpen(false)
  }

  return (
    <>
      <div className={`flex items-center gap-1 ${className ?? ''}`}>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            className={`pl-8 ${value ? 'pr-9' : 'pr-2'} h-9 sm:h-7 text-sm`}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700 transition-colors"
              title="Xóa"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="shrink-0 h-9 w-9 sm:h-7 sm:w-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:text-blue-500 hover:border-blue-300 transition-colors"
          title="Quét mã QR"
        >
          <QrCode className="h-4 w-4" />
        </button>
      </div>

      <QRScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onScan={handleScan} />
    </>
  )
}
