import { useState } from 'react'
import { Search, X, QrCode } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { QRScanner } from './QRScanner'

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
      <div className={`relative ${className ?? ''}`}>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <Input
          className="pl-8 pr-7 h-8 text-sm"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
            title="Xóa"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition-colors"
            title="Quét mã QR"
          >
            <QrCode className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Dialog open={scanOpen} onOpenChange={open => { if (!open) setScanOpen(false) }}>
        <DialogContent className="max-w-sm p-4">
          <QRScanner onScan={handleScan} onClose={() => setScanOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
