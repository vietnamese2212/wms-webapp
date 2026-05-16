import { useEffect, useRef, useState } from 'react'
import { QRScanner } from '@/components/shared/QRScanner'
import { useWarehouses, useLocationsReal, useMaterialCategories } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MapPin, AlertTriangle, CheckCircle2, Flag, QrCode } from 'lucide-react'
import { apiClient } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'

interface StocktakeEntryData {
  id:                 string
  pallet_code:        string
  cartons_remaining:  number
  location_id:        string
  status:             string
  stocktake_flagged:  boolean
  location:           { id: string; location_code: string } | null
  material:           { material_code: string; short_name: string | null } | null
}

type ResultState =
  | { mode: 'none' }
  | { mode: 'result'; entry: StocktakeEntryData }
  | { mode: 'success' }
  | { mode: 'error'; message: string }

const FILTERS_KEY = 'stocktake_filters_v1'

function loadFilters(defaultWarehouseId: string) {
  try {
    const s = sessionStorage.getItem(FILTERS_KEY)
    if (s) {
      const p = JSON.parse(s) as Record<string, unknown>
      return {
        warehouseId:  typeof p.warehouseId  === 'string' ? p.warehouseId  : defaultWarehouseId,
        category:     typeof p.category     === 'string' ? p.category     : '',
        locationId:   typeof p.locationId   === 'string' ? p.locationId   : '',
        requiresOnly: Boolean(p.requiresOnly),
      }
    }
  } catch {}
  return { warehouseId: defaultWarehouseId, category: '', locationId: '', requiresOnly: false }
}

export default function Stocktake() {
  const user = useAuthStore(s => s.user)
  const qc   = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const init = loadFilters(user?.warehouse_id ?? '')
  const [warehouseId,  setWarehouseId]  = useState(init.warehouseId)
  const [category,     setCategory]     = useState(init.category)
  const [locationId,   setLocationId]   = useState(init.locationId)
  const [requiresOnly, setRequiresOnly] = useState(init.requiresOnly)

  const [resultState,  setResultState]  = useState<ResultState>({ mode: 'none' })
  const [scannerOpen,  setScannerOpen]  = useState(false)
  const [updateLoc,    setUpdateLoc]    = useState(false)
  const [showQty,      setShowQty]      = useState(false)
  const [physCount,    setPhysCount]    = useState('')
  const [saving,       setSaving]       = useState(false)
  const [inputVal,     setInputVal]     = useState('')
  const [searching,    setSearching]    = useState(false)

  useEffect(() => {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ warehouseId, category, locationId, requiresOnly }))
  }, [warehouseId, category, locationId, requiresOnly])

  useEffect(() => {
    if (locationId) setTimeout(() => inputRef.current?.focus(), 80)
  }, [locationId])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: categories = [] } = useMaterialCategories()
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId, category: category || undefined } : undefined
  )

  const filteredLocations = requiresOnly
    ? (locations as any[]).filter((l: any) => l.requires_stocktake)
    : (locations as any[])

  const selectedLoc = (locations as any[]).find((l: any) => l.id === locationId)

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
      qc.invalidateQueries({ queryKey: ['stocktake-summary'] })
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

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-blue-600 shrink-0" />
          <p className="text-sm font-semibold text-slate-700">Check vị trí</p>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <Select value={warehouseId || '__none__'} onValueChange={v => {
            setWarehouseId(v === '__none__' ? '' : v)
            setLocationId('')
            setResultState({ mode: 'none' })
            setInputVal('')
          }}>
            <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue placeholder="Kho…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Chọn kho…</SelectItem>
              {(warehouses as any[]).map((w: any) => (
                <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category || '__all__'} onValueChange={v => {
            setCategory(v === '__all__' ? '' : v)
            setLocationId('')
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
          <Select value={locationId || '__none__'} onValueChange={v => {
            setLocationId(v === '__none__' ? '' : v)
            setResultState({ mode: 'none' })
            setInputVal('')
            setScannerOpen(false)
          }} disabled={!warehouseId}>
            <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue placeholder="Vị trí…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Chọn vị trí…</SelectItem>
              {filteredLocations.map((l: any) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.location_code}{l.requires_stocktake ? ' 🚩' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={requiresOnly} onChange={e => {
              setRequiresOnly(e.target.checked)
              setLocationId('')
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
              </div>
            </form>

            {/* Camera scanner */}
            {scannerOpen && (
              <QRScanner
                onScan={handleQRScan}
                onClose={() => setScannerOpen(false)}
              />
            )}

            {/* Success */}
            {resultState.mode === 'success' && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm font-medium text-green-700">Đã lưu — quét pallet tiếp theo…</p>
              </div>
            )}

            {/* Error */}
            {resultState.mode === 'error' && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs text-red-700">{resultState.message}</p>
              </div>
            )}

            {/* Result card */}
            {resultState.mode === 'result' && entry && (
              <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b">
                  <p className="text-[10px] font-mono font-semibold text-slate-700 break-all">{entry.pallet_code}</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {entry.material?.short_name ?? entry.material?.material_code ?? '—'}
                  </p>
                </div>

                <div className="px-3 py-2.5 space-y-3">
                  <div className="text-xs text-slate-600">
                    Tồn app: <strong className="tabular-nums">{entry.cartons_remaining}</strong>
                    <span className="text-slate-400 ml-1">thùng</span>
                  </div>

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

                  {!showQty ? (
                    <button className="text-xs text-slate-500 hover:text-red-600 underline underline-offset-2"
                      onClick={() => setShowQty(true)}>
                      Không khớp tồn?
                    </button>
                  ) : (
                    <div className="border border-red-100 bg-red-50 rounded-lg p-2.5 space-y-2">
                      <p className="text-[10px] text-red-700 font-medium flex items-center gap-1">
                        <Flag className="h-3 w-3" /> Đánh dấu không khớp tồn
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number" min="0"
                          value={physCount}
                          onChange={ev => setPhysCount(ev.target.value)}
                          placeholder="Số thực tế"
                          className="h-7 text-sm w-24"
                          autoFocus
                        />
                        <span className="text-xs text-slate-400">thùng (app: {entry.cartons_remaining})</span>
                      </div>
                      <button className="text-[10px] text-slate-400 hover:text-slate-600"
                        onClick={() => { setShowQty(false); setPhysCount('') }}>
                        Huỷ
                      </button>
                    </div>
                  )}
                </div>

                <div className="px-3 py-2 border-t flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={clearResult}>
                    Bỏ qua
                  </Button>
                  <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700"
                    disabled={saving}
                    onClick={handleSave}>
                    {saving ? '…' : (showQty && physCount !== '' ? 'Lưu & Đánh dấu' : 'Xác nhận đã kiểm')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
