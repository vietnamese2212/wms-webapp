import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { usePopoverAnchor } from './usePopoverAnchor'

export interface SingleSelectOption {
  value: string
  label: string            // hiển thị ở trigger khi được chọn + để search
  sub?: string             // mã phụ (hiện bên phải, mờ)
  node?: ReactNode         // render tuỳ biến cho dòng option (vd ★ + màu); fallback = label + sub
  disabled?: boolean
}

interface SingleSelectProps {
  options: SingleSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  searchable?: boolean      // default true; tắt cho danh sách ngắn nếu muốn
  disabled?: boolean
  dropUp?: boolean          // giữ prop cho tương thích — vị trí thực do usePopoverAnchor tự tính
  triggerClassName?: string
  /**
   * Danh mục LỚN (mã hàng, vị trí, biển số): `options` do SERVER trả theo từ khóa.
   * Bật cờ này thì KHÔNG lọc lại ở client (server đã lọc + cắt) và mỗi lần gõ sẽ gọi
   * `onSearchChange` sau 250ms. Cha tự quản query (`useMaterials({ search, limit: 50 })`).
   */
  serverSearch?: boolean
  onSearchChange?: (term: string) => void
  loading?: boolean
  /** Nhãn của giá trị đang chọn khi nó KHÔNG nằm trong `options` hiện tại (server-search). */
  selectedLabel?: string
}

/**
 * Dropdown chọn-1 dùng chung — ĐỒNG NHẤT look/behavior với WarehouseSingleSelect ("Kho").
 * Menu render qua PORTAL (position:fixed neo theo nút) nên KHÔNG bị `overflow` của
 * Dialog/Sheet cắt mất. Hỗ trợ `node` cho option render giàu (★/màu).
 */
export function SingleSelect({
  options, value, onChange,
  placeholder = 'Chọn…', searchPlaceholder = 'Tìm…',
  searchable = true, disabled, triggerClassName = '',
  serverSearch = false, onSearchChange, loading = false, selectedLabel,
}: SingleSelectProps) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const anchor = usePopoverAnchor(triggerRef, open)

  // Server-search: báo từ khóa lên cha sau 250ms (gõ nhanh không bắn mỗi phím 1 request)
  useEffect(() => {
    if (!serverSearch || !onSearchChange) return
    const t = setTimeout(() => onSearchChange(search), 250)
    return () => clearTimeout(t)
  }, [search, serverSearch, onSearchChange])

  const filtered = search && !serverSearch
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()) || (o.sub ?? '').toLowerCase().includes(search.toLowerCase()))
    : options

  const selected     = options.find(o => o.value === value)
  const displayLabel = selected?.label ?? (value ? selectedLabel ?? value : placeholder)

  function close() { setOpen(false); setSearch(''); onSearchChange?.('') }

  return (
    <div className={triggerClassName}>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          className={`flex items-center justify-between gap-1.5 border border-slate-200 rounded-md px-2.5 text-xs w-full h-full
            bg-white hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            ${!value ? 'text-slate-400' : 'text-slate-700'}`}
          style={{ minHeight: '28px' }}
        >
          <span className="truncate" title={selected?.label ?? undefined}>{displayLabel}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && anchor && createPortal(
          <>
            <div className="fixed inset-0 z-[190] pointer-events-auto" onClick={close} />
            <div
              className="z-[200] pointer-events-auto min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
              style={anchor.style}
            >
              {searchable && (
                <div className="p-2 border-b border-slate-100">
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
                    autoFocus
                  />
                </div>
              )}
              <div className="max-h-48 overflow-y-auto">
                {loading ? (
                  <p className="text-[11px] text-slate-400 text-center py-3">Đang tìm…</p>
                ) : filtered.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center py-3">
                    {serverSearch && !search ? 'Gõ để tìm…' : 'Không tìm thấy'}
                  </p>
                ) : filtered.map(o => (
                  <label key={o.value}
                    className={`flex items-center gap-2 px-3 py-1.5 ${o.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={o.value === value}
                      disabled={o.disabled}
                      onChange={() => { if (!o.disabled) { onChange(o.value); close() } }}
                      className="h-3.5 w-3.5 rounded accent-blue-600 shrink-0"
                    />
                    {o.node ?? (
                      <>
                        <span className="text-[11px] text-slate-700 flex-1 truncate" title={o.label}>{o.label}</span>
                        {o.sub && <span className="text-[10px] text-slate-400 font-mono shrink-0">{o.sub}</span>}
                      </>
                    )}
                  </label>
                ))}
              </div>
            </div>
          </>,
          anchor.target,
        )}
      </div>
    </div>
  )
}
