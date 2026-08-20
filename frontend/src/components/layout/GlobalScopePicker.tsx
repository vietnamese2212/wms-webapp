// Nút "Bối cảnh Kho / Loại kho" trên Header (kiểu Infor CloudSuite) — user chốt 19/08.
// Option kho/loại lấy từ 2 hook scoped (tự validate theo phân quyền), luôn có "Tất cả".
// Chọn xong quét ngay vào filter toàn app (sweepGlobalScope) — form tạo mới cũng ăn theo.
// Panel tự render list (KHÔNG lồng dropdown-portal trong popover — né bẫy outside-click).
// 20/08 (user chốt): 2 danh sách dạng CHECKBOX, mục ĐANG TÍCH ghim lên đầu (snapshot lúc MỞ
// panel — tick/bỏ tick không nhảy hàng) để mở ra là thấy ngay bối cảnh hiện tại. Vẫn chọn-1
// (tick mục khác thay thế, tick lại = bỏ) vì ~23 slice filter + form chỉ nhận 1 kho.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, MapPinned, X } from 'lucide-react'
import { useScopedWarehouses, useScopedWhTypes } from '@/hooks/useUserScope'
import { useGlobalScopeStore, sweepGlobalScope } from '@/stores/globalScopeStore'

interface WhRow { id: string; code?: string; name: string }

// variant 'inline' = nút gọn trên app bar (desktop) · 'bar' = thanh FULL-WIDTH riêng 1 hàng
// dưới app bar (mobile — user 19/08: "trên điện thoại phải nhìn ra ngay đang chọn Kho/Loại nào")
export function GlobalScopePicker({ variant = 'inline' }: { variant?: 'inline' | 'bar' }) {
  const { data: warehousesRaw = [] } = useScopedWarehouses(true)
  const { data: whTypes = [] } = useScopedWhTypes()
  const warehouses = warehousesRaw as WhRow[]

  const warehouseId = useGlobalScopeStore(s => s.warehouseId)
  const whType      = useGlobalScopeStore(s => s.whType)
  const setScope    = useGlobalScopeStore(s => s.setScope)

  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Ghim mục đang tích lên đầu — chốt thứ tự lúc MỞ panel để tick/bỏ tick không nhảy hàng
  const openSelRef = useRef<{ wh: string; wt: string }>({ wh: '', wt: '' })

  const current = warehouses.find(w => w.id === warehouseId)

  // Giá trị đã lưu rơi khỏi scope (bị thu quyền kho / loại) → tự về "Tất cả".
  // Chỉ sửa store, KHÔNG quét — tránh xoá filter các trang lúc mở app.
  useEffect(() => {
    const badWh = warehouseId !== '' && warehouses.length > 0 && !warehouses.some(w => w.id === warehouseId)
    const badWt = whType !== '' && whTypes.length > 0 && !whTypes.some(t => t.value === whType)
    if (badWh || badWt) {
      setScope({
        warehouseId: badWh ? '' : warehouseId,
        warehouseCode: badWh ? '' : (current?.code ?? ''),
        whType: badWt ? '' : whType,
      })
    }
  }, [warehouseId, whType, warehouses, whTypes, current?.code, setScope])

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      const width = 288
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) })
    }
    place()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('resize', place)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const apply = (wid: string, wt: string) => {
    const w = warehouses.find(x => x.id === wid)
    const next = { warehouseId: wid, warehouseCode: w?.code ?? '', whType: wt }
    setScope(next)
    sweepGlobalScope(next, { force: true })
  }

  const toggleOpen = () => {
    setOpen(o => {
      if (!o) openSelRef.current = { wh: warehouseId, wt: whType }
      return !o
    })
  }

  // Kho đang tích (snapshot lúc mở) LUÔN hiện trên đầu — kể cả khi không khớp từ khóa tìm
  const pinnedWh = warehouses.find(w => w.id === openSelRef.current.wh)
  const filteredWhs = useMemo(() => {
    const q = term.trim().toLowerCase()
    const pin = openSelRef.current.wh
    const rest = warehouses.filter(w => w.id !== pin)
    if (!q) return rest
    return rest.filter(w => w.name.toLowerCase().includes(q) || (w.code ?? '').toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses, term, open])

  const orderedWts = useMemo(() => {
    const pin = openSelRef.current.wt
    if (!pin) return whTypes
    return [...whTypes.filter(t => t.value === pin), ...whTypes.filter(t => t.value !== pin)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whTypes, open])

  const active = warehouseId !== '' || whType !== ''
  const khoLabel = current?.name ?? 'Tất cả kho'
  const label = khoLabel + (whType ? ` · ${whType}` : '')

  return (
    <>
      {variant === 'inline' ? (
        <button
          ref={btnRef}
          type="button"
          onClick={toggleOpen}
          title="Bối cảnh Kho / Loại kho — áp cho bộ lọc & form toàn app"
          className={`hidden lg:flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors min-w-0 max-w-xs ${
            active ? 'bg-sky-500/20 text-sky-100 ring-1 ring-sky-400/40 hover:bg-sky-500/30'
                   : 'bg-white/10 text-slate-200 hover:bg-white/15'
          }`}
        >
          <MapPinned className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      ) : (
        /* Thanh bối cảnh mobile: full-width, luôn nêu RÕ cả Kho lẫn Loại (kể cả "Tất cả").
           Nền ĐẶC slate-800 — bar nằm trên trang trắng, nền bán trong suốt làm chữ tàng hình. */
        <button
          ref={btnRef}
          type="button"
          onClick={toggleOpen}
          title="Bối cảnh Kho / Loại kho — áp cho bộ lọc & form toàn app"
          className={`lg:hidden w-full flex items-center gap-1.5 h-8 px-3 text-xs font-medium border-t border-white/10 bg-slate-800 transition-colors ${
            active ? 'text-sky-200' : 'text-slate-200'
          }`}
        >
          <MapPinned className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-sky-400' : 'text-slate-400'}`} />
          <span className="truncate">
            {khoLabel}
            <span className={active && whType ? '' : 'text-slate-400'}> · {whType || 'Tất cả loại'}</span>
          </span>
          <ChevronDown className="h-3 w-3 ml-auto shrink-0 opacity-70" />
        </button>
      )}

      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 288 }}
          className="z-[150] rounded-lg border border-slate-200 bg-white shadow-xl text-slate-700"
        >
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-xs font-semibold text-slate-800">Bối cảnh làm việc</span>
            <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-400">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="px-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-1">Kho</div>
            {warehouses.length > 8 && (
              <input
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="Tìm tên hoặc mã kho…"
                className="w-full mb-1.5 h-7 px-2 text-xs border border-slate-200 rounded-md outline-none focus:border-sky-400"
              />
            )}
            <div className="max-h-52 overflow-auto -mx-1">
              {/* Kho đang tích ghim đầu danh sách (mở panel là thấy ngay bối cảnh hiện tại) */}
              {pinnedWh && <WhCheckRow w={pinnedWh} on={pinnedWh.id === warehouseId} onClick={() => apply(pinnedWh.id === warehouseId ? '' : pinnedWh.id, whType)} />}
              <button
                type="button"
                onClick={() => apply('', whType)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-slate-50 ${warehouseId === '' ? 'font-semibold text-sky-700' : ''}`}
              >
                <ScopeCheckbox on={warehouseId === ''} />
                <span className="flex-1 text-left">Tất cả kho</span>
              </button>
              {filteredWhs.map(w => (
                <WhCheckRow key={w.id} w={w} on={w.id === warehouseId} onClick={() => apply(w.id === warehouseId ? '' : w.id, whType)} />
              ))}
              {!pinnedWh && filteredWhs.length === 0 && (
                <div className="px-2 py-2 text-xs text-slate-400">Không có kho khớp</div>
              )}
            </div>
          </div>

          <div className="px-3 pt-2 pb-2.5 border-t border-slate-100 mt-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-1">Loại kho</div>
            <div className="max-h-40 overflow-auto -mx-1">
              {/* Loại đang tích ghim đầu (orderedWts đã sort theo snapshot lúc mở) */}
              {orderedWts.filter(t => t.value === openSelRef.current.wt).map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => apply(warehouseId, whType === t.value ? '' : t.value)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-slate-50 ${whType === t.value ? 'font-semibold text-sky-700' : ''}`}
                >
                  <ScopeCheckbox on={whType === t.value} />
                  <span className="flex-1 text-left truncate">{t.value}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => apply(warehouseId, '')}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-slate-50 ${whType === '' ? 'font-semibold text-sky-700' : ''}`}
              >
                <ScopeCheckbox on={whType === ''} />
                <span className="flex-1 text-left">Tất cả loại</span>
              </button>
              {orderedWts.filter(t => t.value !== openSelRef.current.wt).map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => apply(warehouseId, whType === t.value ? '' : t.value)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-slate-50 ${whType === t.value ? 'font-semibold text-sky-700' : ''}`}
                >
                  <ScopeCheckbox on={whType === t.value} />
                  <span className="flex-1 text-left truncate">{t.value}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-slate-400 leading-snug">
              Áp cho bộ lọc &amp; giá trị mặc định trong form của toàn app. Vẫn chỉnh lẻ được ở từng trang.
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// Ô checkbox vuông (style khớp MSCheckbox của MultiSelectFilter)
function ScopeCheckbox({ on }: { on: boolean }) {
  return (
    <span
      className={`h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center transition-colors ${
        on ? 'bg-sky-600 border-sky-600' : 'bg-white border-slate-300'
      }`}
    >
      {on && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
    </span>
  )
}

function WhCheckRow({ w, on, onClick }: { w: WhRow; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-slate-50 ${on ? 'font-semibold text-sky-700' : ''}`}
    >
      <ScopeCheckbox on={on} />
      <span className="truncate flex-1 text-left">{w.name}</span>
      {w.code && <span className="font-mono text-[10px] text-slate-400 shrink-0">{w.code}</span>}
    </button>
  )
}
