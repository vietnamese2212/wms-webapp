import { useEffect, useRef, useState } from 'react'
import { QRScanner } from '@/components/shared/QRScanner'
import { useWarehouses, useLocationsReal, useLocationsByFlag, useLocationsByIds, type LocationLite } from '@/api/hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MapPin, AlertTriangle, CheckCircle2, Flag, QrCode, Clock, UserRound } from 'lucide-react'
import { apiClient } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { qtyEntryText, qtyUnitLabel, qtyLabel } from '@/utils/qtyUnits'
import { QtyInput } from '@/components/shared/QtyInput'
import { StocktakeTabs } from '@/components/wms/StocktakeTabs'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { LocationScanButton } from '@/components/wms/LocationScanButton'
import { PdaGunHint } from '@/components/shared/PdaGunHint'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'

interface StocktakeEntryData {
  id:                string
  pallet_code:       string
  cartons_remaining: number
  location_id:       string
  status:            string
  stocktake_flagged: boolean
  stocktake_at:      string | null
  location:          { id: string; location_code: string } | null
  material:          { material_code: string; short_name: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
  qa_status:         { id: string; code: string; name: string } | null
  stocktake_by_emp:  { id: string; name: string } | null
}

type ResultState =
  | { mode: 'none' }
  | { mode: 'result'; entry: StocktakeEntryData }
  | { mode: 'success' }
  | { mode: 'error'; message: string }

function qaColor(code: string | undefined): string {
  if (!code) return 'bg-slate-100 text-slate-600'
  const c = code.toUpperCase()
  if (c.includes('OK') || c === 'PASS') return 'bg-green-100 text-green-700'
  if (c.includes('HOLD'))               return 'bg-amber-100 text-amber-700'
  if (c.includes('REJ') || c === 'NG') return 'bg-red-100 text-red-700'
  return 'bg-blue-100 text-blue-700'
}

export default function Stocktake() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const qc    = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const allowedStockWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  const { warehouseId, category, locationId, requiresOnly } = useWmsFilterStore(s => s.stocktake)
  const codeTypes = useScanCodeTypes(warehouseId)
  const setStocktake = useWmsFilterStore(s => s.setStocktake)

  const [resultState,  setResultState]  = useState<ResultState>({ mode: 'none' })
  const [scannerOpen,  setScannerOpen]  = useState(false)
  const [gunMode,      setGunMode]      = useState(false)   // súng PDA: 1 phát 'wedge' → tắt camera
  const [updateLoc,    setUpdateLoc]    = useState(false)
  const [showQty,      setShowQty]      = useState(false)
  const [physCount,    setPhysCount]    = useState('')
  const [saving,       setSaving]       = useState(false)
  const [inputVal,     setInputVal]     = useState('')
  const [searching,    setSearching]    = useState(false)

  // Mặc định kho = kho đầu tiên của user nếu store chưa có (giữ UX tự chọn cũ)
  useEffect(() => {
    if (!warehouseId) {
      const def = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (def) setStocktake({ warehouseId: def })
    }
  }, [warehouseId, user, setStocktake])

  useEffect(() => {
    if (locationId) setTimeout(() => inputRef.current?.focus(), 80)
  }, [locationId])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes    = [] } = useScopedWhTypes()
  const categories = whTypes.map(t => t.value)
  // Ô chọn vị trí = TÌM TRÊN SERVER (kho Bàu Bàng 1.517 vị trí = 1.030KB/2,9s nếu kéo cả kho).
  // "Chỉ vị trí cần check" thì hỏi thẳng TẬP mang cờ — BE lọc, FE không `.filter()` trên cả kho.
  const [locTerm, setLocTerm] = useState('')
  const locTermDeb = useDebouncedValue(locTerm, 250)
  const { data: locRows = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId, category: category || undefined, search: locTermDeb || undefined, limit: 50 } : undefined,
    !!warehouseId && !requiresOnly,
  )
  const { data: flagLocs = [] } = useLocationsByFlag(
    'requires_stocktake',
    { warehouse_id: warehouseId, category: category || undefined },
    !!warehouseId && requiresOnly,
  )
  // Nhãn cho vị trí ĐANG CHỌN — `locRows` chỉ có 50 dòng khớp từ khóa hiện tại, không thì ô in uuid thô
  const { data: pickedLocs = [] } = useLocationsByIds([locationId])

  // requiresOnly: tập cờ nhỏ và đã về đủ → lọc từ khóa tại chỗ (SingleSelect ở chế độ
  // serverSearch không tự lọc client). Ngược lại: 50 dòng server trả + dòng đang chọn.
  const filteredLocations: LocationLite[] = requiresOnly
    ? flagLocs.filter(l => !locTermDeb || l.location_code.toLowerCase().includes(locTermDeb.toLowerCase()))
    : [...pickedLocs, ...locRows.filter((l: LocationLite) => !pickedLocs.some(p => p.id === l.id))]

  const selectedLoc = filteredLocations.find(l => l.id === locationId) ?? pickedLocs[0]

  function clearResult() {
    setResultState({ mode: 'none' })
    setUpdateLoc(false)
    setShowQty(false)
    setPhysCount('')
    setInputVal('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleSearch(code: string) {
    const palletCode = code.trim()
    if (!palletCode) return
    setSearching(true)
    setScannerOpen(false)
    setResultState({ mode: 'none' })
    try {
      const { data } = await apiClient.post('/wms/inventory/stocktake-check', { qr_code: palletCode })
      const entry: StocktakeEntryData = data.data.entry
      setUpdateLoc(!!locationId && entry.location_id !== locationId)
      setShowQty(false)
      setPhysCount('')
      setResultState({ mode: 'result', entry })
    } catch (e: any) {
      setResultState({ mode: 'error', message: e?.response?.data?.error?.message ?? 'Không tìm thấy pallet' })
      setTimeout(() => inputRef.current?.focus(), 50)
    } finally {
      setSearching(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    handleSearch(inputVal)
  }

  function handleQRScan(code: string) {
    setInputVal(code)
    handleSearch(code)
  }

  async function handleSave() {
    if (resultState.mode !== 'result') return
    setSaving(true)
    const body: Record<string, unknown> = { employee_id: user?.id }
    if (updateLoc && locationId)     body.new_location_id = locationId
    if (showQty && physCount !== '') body.physical_count  = Number(physCount)
    try {
      await apiClient.post(`/wms/inventory/${resultState.entry.id}/stocktake`, body)
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['stocktake-entries'] })
      setResultState({ mode: 'success' })
      setTimeout(clearResult, 1500)
    } catch (e: any) {
      setResultState({ mode: 'error', message: e?.response?.data?.error?.message ?? 'Lỗi khi lưu' })
    } finally {
      setSaving(false)
    }
  }

  const entry       = resultState.mode === 'result' ? resultState.entry : null
  const locMismatch = !!entry && !!locationId && entry.location_id !== locationId

  // Súng PDA: chỉ bật khi đã chọn vị trí (giao diện kiểm) + không đang lưu/tìm. Bắn 1 phát → tắt camera.
  useWedgeScanner(code => {
    if (saving || searching) return
    if (!gunMode) setGunMode(true)
    setScannerOpen(false)
    handleQRScan(code)
  }, !!locationId)

  return (
    <div className="flex flex-col h-full sm:p-3">
     <StocktakeTabs />
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Filters */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2 sm:rounded-t-xl">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-slate-500 shrink-0" />
          <p className="text-sm font-semibold text-slate-700">Check vị trí</p>
          {gunMode && (
            <span className="ml-1 rounded-full bg-sky-100 border border-sky-300 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
              Súng · camera tắt
            </span>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <WarehouseSingleSelect
            warehouses={(warehouses as any[]).filter((w: any) => !allowedStockWhIds || allowedStockWhIds.has(w.id))}
            value={warehouseId || ''}
            onChange={v => { setStocktake({ warehouseId: v, locationId: '' }); setResultState({ mode: 'none' }); setInputVal('') }}
            placeholder="Kho…"
            triggerClassName="h-7 w-[110px]"
          />
          <Select value={category || '__all__'} onValueChange={v => {
            setStocktake({ category: v === '__all__' ? '' : v, locationId: '' })
            setResultState({ mode: 'none' })
            setInputVal('')
          }}>
            <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue placeholder="Loại…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">Tất cả</SelectItem>
              {(categories as string[]).map(c => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SingleSelect
            value={locationId || '__none__'}
            onChange={v => {
              setStocktake({ locationId: v === '__none__' ? '' : v })
              setResultState({ mode: 'none' })
              setInputVal('')
              setScannerOpen(false)
            }}
            disabled={!warehouseId}
            placeholder="Vị trí…"
            searchPlaceholder="Tìm vị trí…"
            triggerClassName="h-7 w-[130px]"
            serverSearch
            onSearchChange={setLocTerm}
            selectedLabel={locationId ? selectedLoc?.location_code : undefined}
            options={[
              { value: '__none__', label: 'Chọn vị trí…' },
              ...filteredLocations.map(l => ({
                value: l.id,
                label: `${l.location_code}${l.requires_stocktake ? ' 🚩' : ''}`,
              })),
            ]}
          />
          {/* Quét tem ô để chọn vị trí kiểm. armWedge khi CHƯA chọn vị trí: đúng lúc đó cò súng tra
              tem pallet còn tắt (enabled = !!locationId) nên phát bắn không bị hai bên cùng ăn —
              người kiểm đứng trước kệ bắn tem ô là vào việc ngay. */}
          <LocationScanButton
            warehouseId={warehouseId}
            disabled={!warehouseId}
            armWedge={!locationId}
            onPicked={loc => {
              setStocktake({ locationId: loc.id })
              setResultState({ mode: 'none' })
              setInputVal('')
              setScannerOpen(false)
            }}
          />
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={requiresOnly} onChange={e => {
              setStocktake({ requiresOnly: e.target.checked, locationId: '' })
              setResultState({ mode: 'none' })
              setInputVal('')
            }} className="h-3.5 w-3.5 cursor-pointer" />
            <span className="text-xs text-slate-600 flex items-center gap-1">
              <Flag className="h-3 w-3 text-red-500" /> Chỉ vị trí cần check
            </span>
          </label>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4 px-3 py-3 space-y-3">
        {!locationId ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400">
            <MapPin className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">Chọn vị trí để bắt đầu kiểm</p>
          </div>
        ) : (
          <>
            {/* Input + scan button */}
            <form onSubmit={handleSubmit}>
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  value={inputVal}
                  onChange={e => setInputVal(e.target.value)}
                  placeholder="Nhập mã pallet…"
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

            {/* Camera scanner */}
            {scannerOpen && (
              <QRScanner
                onScan={handleQRScan}
                onClose={() => setScannerOpen(false)}
                codeTypes={codeTypes}
              />
            )}

            {/* Success */}
            {resultState.mode === 'success' && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm font-medium text-green-700">Đã lưu — quét pallet tiếp theo…</p>
              </div>
            )}

            {/* Error — cho quét tiếp ngay, không phải mở lại camera thủ công */}
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
            {resultState.mode === 'result' && entry && (
              <div className="rounded-xl border bg-white shadow-sm overflow-hidden">

                {/* Header */}
                <div className="px-3 py-2 bg-slate-50 border-b">
                  <p className="text-[10px] font-mono font-semibold text-slate-700 break-all">{entry.pallet_code}</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {entry.material?.short_name ?? entry.material?.material_code ?? '—'}
                  </p>
                </div>

                {/* Qty + QA */}
                <div className="px-3 py-3 flex items-center justify-between border-b">
                  <div>
                    <p className="text-[10px] text-slate-400 mb-0.5">Tồn app</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold tabular-nums text-slate-800">
                        {qtyEntryText(entry.cartons_remaining, entry.material)}
                      </span>
                      <span className="text-xs text-slate-400">{qtyUnitLabel(entry.material)}</span>
                    </div>
                  </div>
                  {entry.qa_status && (
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 mb-1">QA</p>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${qaColor(entry.qa_status.code)}`}>
                        {entry.qa_status.name ?? entry.qa_status.code}
                      </span>
                    </div>
                  )}
                </div>

                {/* Location section */}
                <div className="px-3 py-2.5 space-y-2 border-b">
                  <div className="text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 shrink-0 w-20">Vị trí app:</span>
                      <span className={`font-mono font-semibold ${locMismatch ? 'text-amber-600' : 'text-green-600'}`}>
                        {entry.location?.location_code ?? '—'}
                      </span>
                      {locMismatch && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 shrink-0 w-20">Vị trí check:</span>
                      <span className="font-mono font-semibold text-blue-600">{selectedLoc?.location_code ?? '—'}</span>
                    </div>
                  </div>

                  {locMismatch && (
                    <label className="flex items-center gap-2 cursor-pointer select-none border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
                      <input type="checkbox" checked={updateLoc} onChange={e => setUpdateLoc(e.target.checked)}
                        className="h-3.5 w-3.5 cursor-pointer shrink-0" />
                      <span className="text-xs text-amber-700">
                        Cập nhật vị trí → <strong>{selectedLoc?.location_code}</strong>
                      </span>
                    </label>
                  )}
                </div>

                {/* Last stocktake info */}
                {(entry.stocktake_at || entry.stocktake_by_emp) && (
                  <div className="px-3 py-2 border-b bg-slate-50/50 flex flex-wrap gap-x-4 gap-y-1">
                    {entry.stocktake_at && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>{formatTimestampDate(entry.stocktake_at, true)} {formatTimestampTime(entry.stocktake_at)}</span>
                      </div>
                    )}
                    {entry.stocktake_by_emp && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <UserRound className="h-3 w-3 shrink-0" />
                        <span>{entry.stocktake_by_emp.name}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Qty mismatch input */}
                {showQty && (
                  <div className="px-3 py-2.5 border-b bg-red-50">
                    <p className="text-[10px] text-red-700 font-medium flex items-center gap-1 mb-2">
                      <Flag className="h-3 w-3" /> Số lượng thực tế
                    </p>
                    <div className="flex items-center gap-2">
                      <QtyInput compact autoFocus className="w-44"
                        value={Math.max(0, parseFloat(physCount) || 0)}
                        mat={entry.material}
                        onChange={b => setPhysCount(String(b))}
                      />
                      <span className="text-xs text-slate-400">{qtyUnitLabel(entry.material)} (app: {qtyEntryText(entry.cartons_remaining, entry.material)})</span>
                    </div>
                    {physCount !== '' && Number(physCount) !== entry.cartons_remaining && (
                      <p className="text-[10px] text-red-600 mt-1 font-medium">
                        Chênh: {Number(physCount) - entry.cartons_remaining > 0 ? '+' : ''}{qtyLabel(Number(physCount) - entry.cartons_remaining, entry.material)}
                      </p>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="px-3 py-2 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={clearResult} disabled={saving}>
                    Bỏ qua
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className={`flex-1 text-xs ${showQty ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'text-amber-600 border-amber-300 hover:bg-amber-50'}`}
                    onClick={() => { setShowQty(v => !v); if (showQty) setPhysCount('') }}
                    disabled={saving}
                  >
                    Không khớp
                  </Button>
                  {can(perms, 'stocktake', 'scan') && (
                    <Button size="sm" className="flex-1 text-xs bg-green-600 hover:bg-green-700"
                      disabled={saving}
                      onClick={handleSave}>
                      {saving ? '…' : (showQty && physCount !== '' ? 'Lưu & Đánh dấu' : 'Lưu')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
     </div>
    </div>
  )
}
