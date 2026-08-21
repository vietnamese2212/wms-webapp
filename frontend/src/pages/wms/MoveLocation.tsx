// Chuyển vị trí bằng quét QR (user chốt 20/08) — workflow PALLET-FIRST:
// quét tem pallet → hiện TỒN TRÊN PALLET (thùng + hộp, để đối chiếu) + vị trí hiện tại →
// "Chọn vị trí" mở picker ĐỒNG BỘ với màn quét Nhập (tìm server + ★/nhãn chặn theo Cài đặt WMS
// + LocationContents cho biết ô đó ĐANG CHỨA GÌ) → Chuyển. MỖI LẦN CHUYỂN = 1 LƯỢT KIỂM KÊ
// (BE ghi StocktakeLog + stocktake_at qua cờ count_as_stocktake). Tab Lịch sử = các lượt chuyển
// (StocktakeLog có location_changed_to — gồm cả kiểm-kê-đổi-vị-trí), đủ kho/loại/người/từ ô→đến ô.
// KHO của danh sách vị trí = KHO CỦA PALLET vừa quét (không theo bối cảnh Header — pallet là vật lý).
import { useEffect, useRef, useState } from 'react'
import { QRScanner } from '@/components/shared/QRScanner'
import { useLocationsReal, useBulkTransferLocation, useMoveLog, useWarehouses, type MoveLogRow } from '@/api/hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArrowRight, CheckCircle2, ClipboardCheck, Clock, History, Move, QrCode, UserRound } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { apiClient } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { LocationScanButton } from '@/components/wms/LocationScanButton'
import { PdaGunHint } from '@/components/shared/PdaGunHint'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { PutawayOption, type PutawayLocRow } from '@/components/wms/PutawayOption'
import { usePutawayGate } from '@/components/wms/PutawayGate'
import { LocationContents } from '@/components/wms/LocationContents'
import type { PutawayHint } from '@/utils/putaway'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'

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
  material:          { material_code: string; short_name: string | null; category?: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
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
  const [tab, setTab] = useState<'scan' | 'history'>('scan')
  return (
    <div className="flex flex-col h-full sm:p-3">
      {/* 2 tab pill — cùng khuôn StocktakeTabs (tab nội bộ, không đổi route) */}
      <div className="flex gap-1 px-3 pt-2 pb-2 sm:px-0 sm:pt-0 shrink-0">
        <TabBtn active={tab === 'scan'} onClick={() => setTab('scan')} icon={<Move className="h-3.5 w-3.5" />} label="Chuyển vị trí" />
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<History className="h-3.5 w-3.5" />} label="Lịch sử" />
      </div>
      {tab === 'scan' ? <ScanTab /> : <HistoryTab />}
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-8 sm:h-7 rounded-md text-xs font-medium transition-colors ${
        active ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
      {icon}{label}
    </button>
  )
}

// ─── Tab QUÉT CHUYỂN ─────────────────────────────────────────────────────────

function ScanTab() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const qc    = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  // BẮT BUỘC chọn KHO trước khi quét (user chốt 20/08): 1 mã pallet có thể tồn ở NHIỀU kho —
  // không khoanh kho là tra ra pallet kho khác. Field dùng chung slice moveLog (bối cảnh Header
  // sweep vào, nhớ theo user); mặc định = kho đầu tiên của user như trang Kiểm kê.
  const { warehouseId } = useWmsFilterStore(s => s.moveLog)
  const codeTypes = useScanCodeTypes(warehouseId)   // kho đang chọn ở màn Chuyển vị trí
  const setMoveF = useWmsFilterStore(s => s.setMoveLog)
  const { data: warehouses = [] } = useWarehouses(true)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null
  useEffect(() => {
    if (!warehouseId) {
      const def = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (def) setMoveF({ warehouseId: def })
    }
  }, [warehouseId, user, setMoveF])

  const [resultState, setResultState] = useState<ResultState>({ mode: 'none' })
  const [scannerOpen, setScannerOpen] = useState(false)
  const [gunMode,     setGunMode]     = useState(false)   // súng PDA: 1 phát wedge → tắt camera
  const [inputVal,    setInputVal]    = useState('')
  const [searching,   setSearching]   = useState(false)
  const [saveErr,     setSaveErr]     = useState('')      // lỗi lúc Chuyển — giữ nguyên tem, chọn lại ô
  const [moved,       setMoved]       = useState<MovedRow[]>([])   // phiên này (bản lưu = tab Lịch sử)

  // Vị trí mới — dropdown Y HỆT form Nhập SX: SingleSelect serverSearch, ★/nhãn chặn do BE chấm
  const [newLocId,  setNewLocId]  = useState<string | null>(null)
  const [newLocRow, setNewLocRow] = useState<PutawayLocRow | null>(null)
  const [locHint,   setLocHint]   = useState<PutawayHint | null>(null)
  const [term,      setTerm]      = useState('')
  const search = useDebouncedValue(term, 250)

  const entry = resultState.mode === 'result' ? resultState.entry : null
  const putGate = usePutawayGate(locHint)
  const move = useBulkTransferLocation()

  // KHO = kho của pallet vừa quét · Loại = loại hàng của mã trên pallet (ô nhận đúng loại/chưa gán)
  // 300 dòng: kho cỡ thường thấy TRỌN danh sách — ★ trên đầu, ô chặn cuối (BE sort, như màn Nhập)
  const { data: locs = [], isFetching } = useLocationsReal(
    entry ? {
      warehouse_id: entry.warehouse_id ?? undefined,
      category:     entry.material?.category ?? undefined,
      material_id:  entry.material_id ?? undefined,
      search: search || undefined,
      limit: 300,
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
    if (!palletCode || !warehouseId) return
    setSearching(true)
    setScannerOpen(false)
    setSaveErr('')
    setNewLocId(null); setNewLocRow(null); setLocHint(null); setTerm('')
    putGate.reset()
    setResultState({ mode: 'none' })
    try {
      const { data } = await apiClient.post('/wms/inventory/stocktake-check',
        { qr_code: palletCode, warehouse_id: warehouseId })   // khoanh ĐÚNG kho đã chọn
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

  function pickLoc(l: PutawayLocRow | null, id: string) {
    setNewLocId(id || null)
    setNewLocRow(l)
    setLocHint(l?.putaway ?? null)
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
      qc.invalidateQueries({ queryKey: ['move-log'] })
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

  // Súng PDA: bắn 1 phát → tắt camera, tra pallet ngay (chỉ khi ĐÃ chọn kho).
  // ⚠️ GIỮ NGUYÊN điều kiện cũ (user chốt 21/08: "chỉ bổ sung scanner thôi"). Đã thử cho phát bắn
  // kế tiếp tự chuyển sang TEM VỊ TRÍ khi đang chờ ô đích — nhanh hơn nhưng LẤY MẤT một việc đang
  // có: bắn tem pallet KHÁC để tra lại. Quét tem ô ở đây đi qua nút quét (một chạm), và chỉ trong
  // lúc màn quét đó mở thì cò súng mới nhường.
  useWedgeScanner(code => {
    if (move.isPending || searching) return
    if (!gunMode) setGunMode(true)
    setScannerOpen(false)
    handleQRScan(code)
  }, !!warehouseId)

  const sameLoc = !!entry && !!newLocId && newLocId === entry.location_id
  const canMove = can(perms, 'inventory', 'move_location')
  const saving  = move.isPending

  return (
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Header — ô Kho BẮT BUỘC (khuôn WarehouseSingleSelect như trang Kiểm kê) */}
      <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl space-y-1.5">
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <WarehouseSingleSelect
            warehouses={(warehouses as { id: string; code?: string; name: string }[]).filter(w => !allowedWhIds || allowedWhIds.has(w.id))}
            value={warehouseId || ''}
            onChange={v => { setMoveF({ warehouseId: v, page: 1 }); clearResult() }}
            placeholder="Chọn kho…"
            triggerClassName="h-9 sm:h-7 w-[160px]"
          />
          <span className="text-[10px] text-slate-400">1 mã pallet có thể tồn ở nhiều kho — chỉ tra trong kho đã chọn</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4 px-3 py-3 space-y-3">
        {!warehouseId && (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400">
            <Move className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">Chọn kho để bắt đầu chuyển vị trí</p>
          </div>
        )}
        {warehouseId && (<>
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
          <QRScanner onScan={handleQRScan} onClose={() => setScannerOpen(false)} codeTypes={codeTypes} />
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

            {/* Tồn TRÊN PALLET (thùng + hộp — số đối chiếu khi bốc) + vị trí hiện tại */}
            <div className="px-3 py-2.5 border-b flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] text-slate-400 mb-0.5">Tồn trên pallet (đối chiếu)</p>
                <p className="text-xl font-bold tabular-nums text-slate-800 leading-tight">
                  {qtyLabel(entry.cartons_remaining, entry.material as MatUnits | null)}
                </p>
              </div>
              <div className="text-right min-w-0 shrink-0">
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

            {/* Vị trí mới — Y HỆT ô "Vị trí nhập" của form Nhập SX (Inbound.tsx): SingleSelect
                serverSearch + option render PutawayOption (★/nhãn chặn) + LocationContents bên dưới */}
            <div className="px-3 py-2.5 space-y-2 border-b">
              <Label className="text-xs">Vị trí mới <span className="text-red-500">*</span>
                <span className="ml-2 text-[10px] font-normal text-slate-400">★ = vị trí nên cất theo quy tắc của kho</span>
              </Label>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <SingleSelect
                    value={newLocId ?? ''}
                    onChange={v => pickLoc((locs as PutawayLocRow[]).find(x => x.id === v) ?? null, v)}
                    disabled={saving}
                    serverSearch
                    onSearchChange={setTerm}
                    loading={isFetching}
                    selectedLabel={newLocRow?.location_code}
                    searchPlaceholder="Tìm vị trí…"
                    placeholder="Chọn vị trí"
                    triggerClassName="h-8"
                    options={(locs as PutawayLocRow[]).map(l => ({
                      value: l.id,
                      label: l.location_code,
                      node: <PutawayOption loc={l} />,
                    }))}
                  />
                </div>
                {/* Quét tem ô đích — THÊM cạnh ô chọn tay, ô chọn giữ nguyên. KHÔNG armWedge: màn
                    này cò súng vẫn đang dành cho tem PALLET (xem useWedgeScanner ở trên). */}
                <LocationScanButton
                  warehouseId={entry.warehouse_id ?? warehouseId}
                  materialId={entry.material_id}
                  disabled={saving}
                  onPicked={loc => pickLoc(loc as unknown as PutawayLocRow, loc.id)}
                />
              </div>
              {/* Chọn xong thì thấy NGAY ô đó đang chứa gì — mã trên pallet tô xanh + ghim đầu (như Nhập) */}
              <LocationContents locationId={newLocId} highlightMaterialId={entry.material_id} />

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

        {/* Phiên này (bản lưu lâu dài = tab Lịch sử) */}
        {moved.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-3 py-1.5 bg-slate-50 border-b flex items-center justify-between">
              <p className="text-[11px] font-medium text-slate-500">Đã chuyển trong phiên này ({moved.length})</p>
              <p className="text-[10px] text-slate-400">Bản lưu: tab Lịch sử</p>
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
        </>)}
      </div>
     </div>
  )
}

// ─── Tab LỊCH SỬ ─────────────────────────────────────────────────────────────

const MOVE_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'at',     label: 'Thời gian',   w: 140 },
  { id: 'pallet', label: 'Mã pallet',   w: 170 },
  { id: 'from',   label: 'Từ ô',        w: 110 },
  { id: 'to',     label: 'Đến ô',       w: 110 },
  { id: 'mat',    label: 'Tên hàng',    w: 170 },
  { id: 'qty',    label: 'SL trên pallet', w: 130, align: 'right' },
  { id: 'wh',     label: 'Kho',         w: 120 },
  { id: 'cat',    label: 'Loại kho',    w: 90 },
  { id: 'by',     label: 'Người thực hiện', w: 130 },
]
const MOVE_COL_DEFAULTS = MOVE_COLS.map(c => c.w)
const muOf = (r: MoveLogRow): MatUnits => ({ base_unit: r.base_unit, entry_unit: r.entry_unit, units_per_carton: r.units_per_carton })

function HistoryTab() {
  const user = useAuthStore(s => s.user)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  const { warehouseId, category, dateFrom, dateTo, search, page, pageSize } = useWmsFilterStore(s => s.moveLog)
  const setF = useWmsFilterStore(s => s.setMoveLog)
  const { widths: colW, startResize, totalWidth } = useColumnResize('move_log_col_widths', MOVE_COL_DEFAULTS)

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes    = [] } = useScopedWhTypes()
  const whName = new Map((warehouses as { id: string; name: string }[]).map(w => [w.id, w.name]))

  const { data, isFetching } = useMoveLog({
    warehouse_id: warehouseId || undefined,
    category: category || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    search: search || undefined,
    page, page_size: pageSize,
  })
  const rows  = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const defs: FilterDef[] = [
    { key: 'daterange', label: 'Ngày chuyển', type: 'daterange', pinned: true, from: dateFrom, to: dateTo,
      onChange: (from, to) => setF({ dateFrom: from, dateTo: to, page: 1 }) },
    { key: 'warehouse', label: 'Kho', type: 'single', value: warehouseId, allLabel: 'Tất cả kho',
      onChange: v => setF({ warehouseId: v, page: 1 }),
      options: (warehouses as { id: string; name: string }[]).filter(w => !allowedWhIds || allowedWhIds.has(w.id)).map(w => ({ value: w.id, label: w.name })) },
    { key: 'category', label: 'Loại kho', type: 'single', value: category, allLabel: 'Tất cả loại',
      onChange: v => setF({ category: v, page: 1 }),
      options: whTypes.map(t => ({ value: t.value, label: t.value })) },
  ]

  return (
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 shrink-0">
            <History className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-xs font-semibold text-slate-700">Lịch sử chuyển vị trí</span>
          </div>
          <SearchInput value={search} onChange={v => setF({ search: v, page: 1 })}
            placeholder="Tìm pallet / mã hàng / vị trí…" className="flex-1 min-w-[130px]" />
          <FilterSheetButton defs={defs} className="sm:hidden" />
          <FilterBar defs={defs} className="hidden sm:flex" />
        </div>
      </div>

      <SummaryBand tiles={[{ label: 'Lượt chuyển', value: total }]} />

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:!py-1.5"
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow className="bg-slate-50">
              {MOVE_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                  {c.label}
                  {i > 0 && (
                    <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                      className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isFetching && rows.length === 0 ? (
              <TableRow><TableCell colSpan={MOVE_COLS.length} className="text-center text-xs text-slate-400 py-8 whitespace-nowrap">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={MOVE_COLS.length} className="text-center text-xs text-slate-400 py-8 whitespace-nowrap">Chưa có lượt chuyển nào trong khoảng ngày này</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white">
                  <span className="text-[10px] text-slate-500">{formatTimestampDate(r.counted_at, true)} {formatTimestampTime(r.counted_at)}</span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className="font-mono text-[10px] font-semibold block truncate" title={r.pallet_code}>{r.pallet_code}</span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  {/* Dòng cũ trước 20/08 chưa snapshot ô nguồn → "—" */}
                  <span className="font-mono text-[10px] block truncate" title={r.location_from_code ?? ''}>
                    {r.location_from_code ?? <span className="text-slate-300">—</span>}
                  </span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className="font-mono text-[10px] font-semibold block truncate" title={r.location_code ?? ''}>
                    {r.location_code ?? <span className="text-slate-300">—</span>}
                  </span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className="text-[10px] block truncate" title={r.short_name ?? r.material_code ?? ''}>{r.short_name ?? r.material_code ?? '—'}</span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                  <span className="text-[10px] tabular-nums">{qtyLabel(Number(r.app_qty ?? 0), muOf(r))}</span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className="text-[10px] block truncate">{r.warehouse_id ? (whName.get(r.warehouse_id) ?? r.warehouse_id) : <span className="text-slate-300">—</span>}</span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className="text-[10px]">{r.categories?.length ? r.categories.join('+') : <span className="text-slate-300">—</span>}</span>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className="text-[10px] text-slate-500">{r.counted_by_name ?? '—'}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PagerNav page={page} totalPages={totalPages} onPage={p => setF({ page: p })} />
      </div>

      <ListFooter page={page} pageSize={pageSize} total={total} unit="lượt chuyển"
        onPageSize={n => setF({ pageSize: n, page: 1 })} />
     </div>
  )
}
