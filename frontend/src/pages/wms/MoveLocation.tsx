// Chuyển vị trí bằng quét QR (user chốt 20/08) — workflow PALLET-FIRST:
// quét tem pallet → hiện tồn + vị trí hiện tại → chọn "Vị trí mới" (gợi ý ★ + luật CẤT hàng
// từ Cài đặt WMS, BE chấm — FE không tự tính) → Chuyển. MỖI LẦN CHUYỂN = 1 LƯỢT KIỂM KÊ
// của pallet đó (BE ghi StocktakeLog + stocktake_at qua cờ count_as_stocktake).
// Khác trang Kiểm kê (vị-trí-first: chọn ô rồi quét pallet vào ô) — đây là pallet-first.
import { useRef, useState } from 'react'
import { QRScanner } from '@/components/shared/QRScanner'
import { useLocationsReal, useBulkTransferLocation } from '@/api/hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArrowRight, CheckCircle2, ClipboardCheck, Clock, MapPin, Move, QrCode, Search, UserRound } from 'lucide-react'
import { apiClient } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { qtyEntryText, qtyUnitLabel } from '@/utils/qtyUnits'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { PdaGunHint } from '@/components/shared/PdaGunHint'
import { PutawayOption, type PutawayLocRow } from '@/components/wms/PutawayOption'
import { usePutawayGate } from '@/components/wms/PutawayGate'
import type { PutawayHint } from '@/utils/putaway'

interface MoveEntryData {
  id:                string
  pallet_code:       string
  cartons_remaining: number
  location_id:       string | null
  warehouse_id:      string | null
  material_id:       string | null
  status:            string
  stocktake_at:      string | null
  location:          { id: string; location_code: string; warehouse?: { id: string; name: string } | null } | null
  material:          { material_code: string; short_name: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
  qa_status:         { id: string; code: string; name: string } | null
  stocktake_by_emp:  { id: string; name: string } | null
}

type ResultState =
  | { mode: 'none' }
  | { mode: 'result'; entry: MoveEntryData }
  | { mode: 'success'; from: string; to: string }
  | { mode: 'error'; message: string }

interface MovedRow { pallet: string; from: string; to: string; at: string }

export default function MoveLocation() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const qc    = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [resultState, setResultState] = useState<ResultState>({ mode: 'none' })
  const [scannerOpen, setScannerOpen] = useState(false)
  const [gunMode,     setGunMode]     = useState(false)   // súng PDA: 1 phát wedge → tắt camera
  const [inputVal,    setInputVal]    = useState('')
  const [searching,   setSearching]   = useState(false)
  const [saveErr,     setSaveErr]     = useState('')      // lỗi lúc Chuyển — giữ nguyên tem, chọn lại ô
  const [moved,       setMoved]       = useState<MovedRow[]>([])   // lịch sử PHIÊN này (bản lưu = StocktakeLog)

  // Vị trí mới — tìm trên server, BE trả khối `putaway` từng dòng (★ / nhãn chặn theo Cài đặt WMS)
  const [newLocId,  setNewLocId]  = useState<string | null>(null)
  const [newLocRow, setNewLocRow] = useState<PutawayLocRow | null>(null)
  const [locHint,   setLocHint]   = useState<PutawayHint | null>(null)
  const [term,      setTerm]      = useState('')
  const search = useDebouncedValue(term, 250)

  const entry = resultState.mode === 'result' ? resultState.entry : null
  const putGate = usePutawayGate(locHint)
  const move = useBulkTransferLocation()

  const { data: locs = [], isFetching } = useLocationsReal(
    entry ? {
      warehouse_id: entry.warehouse_id ?? undefined,
      material_id:  entry.material_id ?? undefined,
      search: search || undefined,
      limit: 30,
      putaway: 1,
    } : undefined,
    !!entry,
  )

  function clearResult() {
    setResultState({ mode: 'none' })
    setInputVal('')
    setSaveErr('')
    setNewLocId(null); setNewLocRow(null); setLocHint(null); setTerm('')
    putGate.reset()
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleSearch(code: string) {
    const palletCode = code.trim()
    if (!palletCode) return
    setSearching(true)
    setScannerOpen(false)
    setSaveErr('')
    setNewLocId(null); setNewLocRow(null); setLocHint(null); setTerm('')
    putGate.reset()
    setResultState({ mode: 'none' })
    try {
      const { data } = await apiClient.post('/wms/inventory/stocktake-check', { qr_code: palletCode })
      setResultState({ mode: 'result', entry: data.data.entry as MoveEntryData })
    } catch (e: any) {
      setResultState({ mode: 'error', message: e?.response?.data?.error?.message ?? 'Không tìm thấy pallet' })
      setTimeout(() => inputRef.current?.focus(), 50)
    } finally {
      setSearching(false)
    }
  }

  function handleQRScan(code: string) {
    setInputVal(code)
    handleSearch(code)
  }

  function pickLoc(l: PutawayLocRow) {
    setNewLocId(l.id)
    setNewLocRow(l)
    setLocHint(l.putaway ?? null)
    putGate.reset()
    setSaveErr('')
  }

  async function handleMove() {
    if (!entry || !newLocId || move.isPending) return
    setSaveErr('')
    try {
      const r = await move.mutateAsync({
        ids: [entry.id],
        location_id: newLocId,
        employee_id: user?.id,
        count_as_stocktake: true,
        ...putGate.arg,
      })
      qc.invalidateQueries({ queryKey: ['stocktake-entries'] })
      qc.invalidateQueries({ queryKey: ['stocktake-log'] })
      const from = entry.location?.location_code ?? '—'
      const to   = r.location_code || newLocRow?.location_code || ''
      setMoved(m => [{ pallet: entry.pallet_code, from, to, at: new Date().toISOString() }, ...m].slice(0, 30))
      setResultState({ mode: 'success', from, to })
      setTimeout(clearResult, 1500)
    } catch (e: any) {
      // LOCATION_FULL / PUTAWAY_* / 4xx: giữ nguyên tem + kết quả, chỉ báo đỏ để chọn ô khác
      setSaveErr(e?.response?.data?.error?.message ?? 'Lỗi khi chuyển vị trí')
    }
  }

  // Súng PDA: bắn 1 phát → tắt camera, tra pallet ngay
  useWedgeScanner(code => {
    if (move.isPending || searching) return
    if (!gunMode) setGunMode(true)
    setScannerOpen(false)
    handleQRScan(code)
  }, true)

  const sameLoc = !!entry && !!newLocId && newLocId === entry.location_id
  const canMove = can(perms, 'inventory', 'move_location')
  const saving  = move.isPending

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Move className="h-4 w-4 text-slate-500 shrink-0" />
          <p className="text-sm font-semibold text-slate-700">Chuyển vị trí</p>
          {gunMode && (
            <span className="ml-1 rounded-full bg-sky-100 border border-sky-300 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
              Súng · camera tắt
            </span>
          )}
          <span className="hidden sm:flex items-center gap-1 ml-auto text-[10px] text-slate-400">
            <ClipboardCheck className="h-3 w-3" /> Mỗi lần chuyển được ghi 1 lượt kiểm kê của pallet
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4 px-3 py-3 space-y-3">
        {/* Input + scan */}
        <form onSubmit={e => { e.preventDefault(); handleSearch(inputVal) }}>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              placeholder="Quét hoặc nhập mã pallet…"
              className="font-mono text-sm h-9"
              disabled={searching || saving}
            />
            <Button
              type="button"
              variant={scannerOpen ? 'default' : 'outline'}
              size="sm"
              className="h-9 px-3 shrink-0"
              onClick={() => setScannerOpen(o => !o)}
              disabled={searching || saving}
            >
              <QrCode className="h-4 w-4" />
            </Button>
            <PdaGunHint className="h-9 w-9" />
          </div>
        </form>

        {scannerOpen && (
          <QRScanner onScan={handleQRScan} onClose={() => setScannerOpen(false)} />
        )}

        {/* Success */}
        {resultState.mode === 'success' && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 flex items-center gap-2 flex-wrap">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-sm font-medium text-green-700 flex items-center gap-1.5 flex-wrap">
              Đã chuyển <span className="font-mono">{resultState.from}</span>
              <ArrowRight className="h-3.5 w-3.5" />
              <span className="font-mono">{resultState.to}</span> · đã ghi 1 lượt kiểm kê
            </p>
          </div>
        )}

        {/* Lỗi tra pallet — cho quét tiếp ngay */}
        {resultState.mode === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 flex items-center justify-between gap-2">
            <p className="text-xs text-red-700">{resultState.message}</p>
            <Button type="button" size="sm" variant="outline"
              className="h-7 px-2.5 text-xs shrink-0 border-red-300 text-red-700 hover:bg-red-100"
              onClick={() => { setResultState({ mode: 'none' }); setInputVal(''); setScannerOpen(true) }}>
              Quét tiếp
            </Button>
          </div>
        )}

        {/* Result card */}
        {entry && (
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            {/* Pallet + hàng */}
            <div className="px-3 py-2 bg-slate-50 border-b">
              <p className="text-[10px] font-mono font-semibold text-slate-700 break-all">{entry.pallet_code}</p>
              <p className="text-xs text-slate-600 mt-0.5">
                {entry.material?.short_name ?? entry.material?.material_code ?? '—'}
              </p>
            </div>

            {/* Tồn + vị trí hiện tại */}
            <div className="px-3 py-2.5 border-b flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-slate-400 mb-0.5">Tồn kho</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold tabular-nums text-slate-800">
                    {qtyEntryText(entry.cartons_remaining, entry.material)}
                  </span>
                  <span className="text-xs text-slate-400">{qtyUnitLabel(entry.material)}</span>
                </div>
              </div>
              <div className="text-right min-w-0">
                <p className="text-[10px] text-slate-400 mb-0.5">Vị trí hiện tại</p>
                <p className="font-mono text-lg font-semibold text-slate-800 truncate">
                  {entry.location?.location_code ?? '—'}
                </p>
                {entry.location?.warehouse?.name && (
                  <p className="text-[10px] text-slate-400 truncate">{entry.location.warehouse.name}</p>
                )}
              </div>
            </div>

            {/* Lần kiểm gần nhất */}
            {(entry.stocktake_at || entry.stocktake_by_emp) && (
              <div className="px-3 py-2 border-b bg-slate-50/50 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-[10px] text-slate-400">Kiểm gần nhất:</span>
                {entry.stocktake_at && (
                  <span className="flex items-center gap-1 text-[10px] text-slate-500">
                    <Clock className="h-3 w-3 shrink-0" />
                    {formatTimestampDate(entry.stocktake_at, true)} {formatTimestampTime(entry.stocktake_at)}
                  </span>
                )}
                {entry.stocktake_by_emp && (
                  <span className="flex items-center gap-1 text-[10px] text-slate-500">
                    <UserRound className="h-3 w-3 shrink-0" />
                    {entry.stocktake_by_emp.name}
                  </span>
                )}
              </div>
            )}

            {/* Chọn vị trí mới */}
            <div className="px-3 py-2.5 space-y-2 border-b">
              <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> Vị trí mới
                {newLocRow && (
                  <span className="ml-1 font-mono text-xs font-semibold text-blue-700">{newLocRow.location_code}</span>
                )}
              </p>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={term}
                  onChange={e => setTerm(e.target.value)}
                  placeholder="Tìm mã vị trí… (★ = đang để dở cùng mã)"
                  className="w-full h-9 pl-7 pr-2 text-sm border border-slate-300 rounded-md"
                  disabled={saving}
                />
              </div>
              <div className="max-h-44 overflow-auto rounded-md border border-slate-200 divide-y divide-slate-100">
                {isFetching && <p className="px-2 py-2 text-xs text-slate-400">Đang tìm…</p>}
                {!isFetching && (locs as PutawayLocRow[]).length === 0 && (
                  <p className="px-2 py-2 text-xs text-slate-400">Không có vị trí khớp</p>
                )}
                {(locs as PutawayLocRow[]).map(l => {
                  // Ô đầy vẫn HIỆN nhưng chặn chọn — RPC khóa dòng ở BE mới là trọng tài cuối.
                  // Ô vi phạm luật cất vẫn chọn được (kho có thể chỉ cảnh báo) — PutawayGate xử tiếp.
                  const full = (l.max_pallets ?? 0) > 0 && (l.used_slots ?? 0) >= (l.max_pallets ?? 0)
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={full || saving}
                      onClick={() => pickLoc(l)}
                      className={`w-full text-left px-2 py-2 flex items-center gap-2 ${
                        full ? 'text-slate-300 cursor-not-allowed'
                          : l.id === newLocId ? 'bg-sky-50' : 'hover:bg-sky-50'}`}
                    >
                      <PutawayOption loc={l} />
                    </button>
                  )
                })}
              </div>

              {putGate.box}
              {sameLoc && (
                <p className="text-[11px] text-amber-600">Pallet đang ở đúng vị trí này — chọn vị trí khác.</p>
              )}
              {saveErr && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-xs text-red-700">{saveErr}</p>
                </div>
              )}
              <p className="text-[10px] text-slate-400 flex items-center gap-1 sm:hidden">
                <ClipboardCheck className="h-3 w-3 shrink-0" /> Mỗi lần chuyển được ghi 1 lượt kiểm kê của pallet
              </p>
            </div>

            {/* Actions */}
            <div className="px-3 py-2 flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={clearResult} disabled={saving}>
                Bỏ qua
              </Button>
              {canMove && (
                <Button size="sm" className="flex-1 text-xs bg-blue-600 hover:bg-blue-700"
                  disabled={saving || !newLocId || sameLoc || !putGate.ok}
                  onClick={handleMove}>
                  {saving ? 'Đang chuyển…' : 'Chuyển vị trí'}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Lịch sử phiên này (bản lưu lâu dài nằm ở Kiểm kê → Lịch sử kiểm) */}
        {moved.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-3 py-1.5 bg-slate-50 border-b flex items-center justify-between">
              <p className="text-[11px] font-medium text-slate-500">Đã chuyển trong phiên này ({moved.length})</p>
              <p className="text-[10px] text-slate-400">Lưu tại Kiểm kê → Lịch sử kiểm</p>
            </div>
            <div className="divide-y divide-slate-100">
              {moved.map((m, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-slate-700 truncate flex-1 min-w-0">{m.pallet}</span>
                  <span className="font-mono text-slate-500 shrink-0">{m.from}</span>
                  <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                  <span className="font-mono font-semibold text-slate-700 shrink-0">{m.to}</span>
                  <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{formatTimestampTime(m.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
     </div>
    </div>
  )
}
