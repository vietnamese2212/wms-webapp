// Quét QR cấp ĐƠN (user 19/07): nút "Quét QR" trên header trang chuyến Xuất / Nhặt lẻ —
// quét tem pallet BẤT KỲ thuộc đơn, tự nhận MÃ HÀNG từ QR (materialCodeOf, đúng cả 2 format)
// → hiện header text / điều kiện Batch/%Date của mã đó rồi check + lưu bằng ĐÚNG endpoint
// quét theo mã hàng — MỌI rule chặn giữ nguyên (BE kiểm theo item): sai mã, QA giữ, %Date,
// trùng pallet, vượt kế hoạch, nhặt lẻ không vượt số lẻ…
// mode='outbound' (quét xuất — có hàng đợi offline + tem thùng) | mode='loose' (nhặt lẻ).
// pdaMode (user 19/07): mở bằng CÒ SÚNG ngay trên trang đơn → KHÔNG bật camera (panel tối
// "bóp cò để quét"), initialScan = tem vừa bắn được xử lý luôn; bắn lại đúng tem = Lưu.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AxiosError } from 'axios'
import { AlertTriangle, CheckCircle2, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QRScanner, type QRScannerHandle } from '@/components/shared/QRScanner'
import { CartonScanSheet, type CartonScan } from '@/components/wms/CartonScanSheet'
import { toast } from '@/components/ui/use-toast'
import {
  useCheckOutboundScan, useScanOutboundItem, useScanLoosePickingItem, useAttachCartonScans,
  type CheckOutboundScanResult,
} from '@/api/hooks'
import { materialCodeOf, normalizeQR } from '@/utils/qr'
import { formatTimestampDate } from '@/utils/formatters'
import { playBeep } from '@/utils/audio'
import { enqueueScan, isConnectivityError, useScanQueue } from '@/offline/scanQueue'
import { isOffline } from '@/offline/useOnline'
import { OfflineError } from '@/api/client'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { useAuthStore } from '@/stores/authStore'
import type { GDO, OutboundItem } from '@/types'

type FeedbackState = { type: 'success' | 'error' | 'queued'; msg: string } | null
type ItemWithDO = OutboundItem & { distributor_name?: string | null; delivery_code?: string | null }

function apiMsg(err: unknown): string {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
}

// Số thùng lẻ CÒN cần chuẩn bị của 1 mã — cùng công thức LoosePickingItemDetail (effective trừ phần đã quét chẵn vượt)
function looseRemainingOf(item: OutboundItem): number {
  const looseScanned = (item.scan_entries ?? []).filter(s => s.is_loose_picking)
    .reduce((sum, s) => sum + Number(s.cartons_scanned), 0)
  const ov = Math.max(0, (item.cartons_scanned - looseScanned) - (item.cartons_ordered - item.loose_picking))
  const effective = Math.max(0, item.loose_picking - ov)
  return Math.max(0, effective - Math.min(looseScanned, effective))
}

export function GdoScanSheet({ gdo, mode, onClose, pdaMode = false, initialScan }: {
  gdo: GDO; mode: 'outbound' | 'loose'; onClose: () => void
  pdaMode?: boolean          // mở bằng cò súng → KHÔNG bật camera
  initialScan?: string       // tem đã bắn ngay trước khi mở — xử lý luôn khi mount
}) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const user = useAuthStore(s => s.user)
  const [feedback,       setFeedback]       = useState<FeedbackState>(null)
  const [checkResult,    setCheckResult]    = useState<CheckOutboundScanResult | null>(null)
  const [pendingCartons, setPendingCartons] = useState('')
  const [activeItemId,   setActiveItemId]   = useState<string | null>(null)   // mã hàng vừa nhận từ QR
  const [count,          setCount]          = useState(0)                      // pallet lưu OK trong phiên
  const [cartonFor,      setCartonFor]      = useState<{ scanId: string; palletCode: string } | null>(null)
  const { mutate: checkScan,     isPending: checking }       = useCheckOutboundScan()
  const { mutate: scanOutbound,  isPending: savingOutbound } = useScanOutboundItem()
  const { mutate: scanLoose,     isPending: savingLoose }    = useScanLoosePickingItem()
  const { mutate: attachCartons, isPending: attaching }      = useAttachCartonScans()
  const saving = mode === 'outbound' ? savingOutbound : savingLoose

  // Số lượt quét của ĐƠN này đang chờ mạng (hàng đợi offline — chỉ luồng xuất)
  const queuedThisGdo = useScanQueue(s =>
    s.items.filter(i => i.status === 'pending' && i.orderId === gdo.id).length)

  // Dòng hàng của đơn (kèm NPP/DO) — luôn tươi theo react-query vì gdo prop re-render
  const items: ItemWithDO[] = useMemo(() => (gdo.delivery_orders ?? []).flatMap(d =>
    (mode === 'loose' ? d.items.filter(i => i.loose_picking > 0) : d.items)
      .map(i => ({ ...i, distributor_name: d.distributor_name, delivery_code: d.delivery_code }))
  ), [gdo, mode])

  const remainingOf = (i: OutboundItem) =>
    mode === 'loose' ? looseRemainingOf(i) : Math.max(0, i.cartons_ordered - i.cartons_scanned)

  const activeItem = activeItemId ? items.find(i => i.id === activeItemId) ?? null : null
  const activeRemaining = activeItem ? remainingOf(activeItem) : 0
  const activeMatCode = activeItem ? (activeItem.material?.material_code ?? activeItem.material_code_raw ?? '—') : ''
  const activeMatName = activeItem ? (activeItem.material?.short_name ?? activeItem.material_code_raw ?? '—') : ''

  // Khớp mã hàng bóc từ QR với dòng đơn (so cả material_code lẫn code_raw — như expectedMaterialCode ở trang mã)
  function matchItems(code: string): ItemWithDO[] {
    return items.filter(i => {
      const cands = [i.material?.material_code, i.material_code_raw, materialCodeOf(i.material_code_raw)]
      return cands.some(c => (c ?? '').trim() !== '' && (c ?? '').trim() === code)
    })
  }

  function queueScanOffline(target: ItemWithDO, qr_code: string, cartonsOverride: number | undefined, uncertain: boolean) {
    const norm = normalizeQR(qr_code)
    const { queued, duplicate } = enqueueScan({
      kind: 'outbound',
      url: `/wms/outbound/${gdo.id}/items/${target.id}/scan`,
      body: { qr_code, employee_id: user?.id ?? undefined, cartons_override: cartonsOverride },
      pallet_code: norm,
      label: `${target.material?.material_code ?? target.material_code_raw ?? ''} · ${target.material?.short_name ?? target.material_code_raw ?? ''}`,
      orderId: gdo.id,
      itemId: target.id,
      uncertain,
    })
    setFeedback({
      type: 'queued',
      msg: duplicate
        ? `⏸ Pallet này ĐÃ trong hàng đợi chờ mạng (${queued} chờ)`
        : `⏸ Mất mạng — đã xếp hàng chờ (${queued} chờ) · ${norm}${cartonsOverride ? ` · ${cartonsOverride} thùng` : ' · SL chốt khi có mạng'}`,
    })
    setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 2000)
  }

  function handleScan(qr_code: string, src: 'camera' | 'wedge' = 'camera') {
    // Guard chung camera + súng quét: đang check/lưu/quét thùng → bỏ qua lượt mới
    // (camera tự pause sau scan nên trước đây không cần; có súng quét bắn bất kỳ lúc nào thì cần)
    if (checking || saving || cartonFor) return
    if (checkResult) {
      // PDA: đang chờ xác nhận mà BẮN LẠI đúng tem đó = bấm Lưu (không cần chạm màn hình).
      // Chỉ áp cho SÚNG — camera đứng yên vẫn nhìn tem, không được tự lưu.
      if (src === 'wedge' && normalizeQR(qr_code) === checkResult.pallet_code) { playBeep(); handleSave() }
      return
    }
    playBeep()
    setCheckResult(null)
    setFeedback(null)
    const code = materialCodeOf(normalizeQR(qr_code))
    const matched = code ? matchItems(code) : []
    if (matched.length === 0) {
      setActiveItemId(null)
      setFeedback({
        type: 'error',
        msg: code
          ? (mode === 'loose'
            ? `Mã hàng "${code}" không có trong danh sách nhặt lẻ của đơn này`
            : `Mã hàng "${code}" không có trong đơn này`)
          : 'Không đọc được mã hàng từ tem — kiểm tra lại tem pallet',
      })
      return
    }
    const scannable = matched.filter(i => i.material?.no_qr_tracking !== true)
    if (scannable.length === 0) {
      setActiveItemId(matched[0].id)
      setFeedback({ type: 'error', msg: `Mã "${code}" là hàng không tem — dùng "Lưu thủ công" trong mã hàng` })
      return
    }
    // Cùng mã ở nhiều NPP → nhận vào dòng CÒN THIẾU đầu tiên theo thứ tự bảng
    const target = scannable.find(i => remainingOf(i) > 0)
    if (!target) {
      setActiveItemId(scannable[0].id)
      setFeedback({
        type: 'error',
        msg: mode === 'loose' ? `Mã "${code}" đã chuẩn bị đủ số nhặt lẻ` : `Mã "${code}" đã xuất đủ số lượng`,
      })
      return
    }
    setActiveItemId(target.id)
    if (mode === 'outbound' && isOffline()) { queueScanOffline(target, qr_code, undefined, false); return }
    checkScan(
      { gdoId: gdo.id, itemId: target.id, qr_code },
      {
        onSuccess: (data) => {
          setCheckResult(data)
          const rem = remainingOf(target)
          setPendingCartons(String(data.suggested_cartons > 0
            ? (mode === 'loose' ? Math.min(data.suggested_cartons, rem) : data.suggested_cartons)
            : 1))
        },
        onError: (err) => {
          if (mode === 'outbound' && isConnectivityError(err)) { queueScanOffline(target, qr_code, undefined, false); return }
          setFeedback({ type: 'error', msg: apiMsg(err) })
        },
      }
    )
  }

  function afterSaveSuccess(data: { scan_entry: { id: string; pallet_code: string; cartons_scanned: number } }, target: ItemWithDO) {
    setCheckResult(null)
    setCount(c => c + 1)
    // Kho/Loại kho bật quét-thùng (chỉ luồng xuất) → mở panel multiscan thùng neo vào pallet vừa quét
    if (mode === 'outbound' && gdo.carton_scan_enabled) {
      setFeedback(null)
      setCartonFor({ scanId: data.scan_entry.id, palletCode: data.scan_entry.pallet_code })
      return
    }
    setFeedback({
      type: 'success',
      msg: `✓ ${data.scan_entry.pallet_code} · ${Number(data.scan_entry.cartons_scanned)} thùng — ${target.material?.material_code ?? target.material_code_raw ?? ''}`,
    })
    setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 1500)
  }

  function handleSave() {
    if (!checkResult || saving || !activeItem) return
    const target = activeItem
    const cartons = Math.max(1, parseInt(pendingCartons) || 1)
    if (mode === 'loose') {
      scanLoose(
        { gdoId: gdo.id, itemId: target.id, qr_code: checkResult.pallet_code, cartons_override: cartons },
        {
          onSuccess: (data) => afterSaveSuccess(data as { scan_entry: { id: string; pallet_code: string; cartons_scanned: number } }, target),
          onError: (err) => { setCheckResult(null); setFeedback({ type: 'error', msg: apiMsg(err) }) },
        }
      )
      return
    }
    scanOutbound(
      { gdoId: gdo.id, itemId: target.id, qr_code: checkResult.pallet_code, cartons_override: cartons, employee_id: user?.id ?? undefined },
      {
        onSuccess: (data) => afterSaveSuccess(data as { scan_entry: { id: string; pallet_code: string; cartons_scanned: number } }, target),
        onError: (err) => {
          const qr = checkResult.pallet_code
          setCheckResult(null)
          // Mạng rớt đúng lúc bấm Lưu → xếp hàng với SL đã xác nhận; lỗi SAU khi gửi → uncertain
          if (isConnectivityError(err)) { queueScanOffline(target, qr, cartons, !(err instanceof OfflineError)); return }
          setFeedback({ type: 'error', msg: apiMsg(err) })
        },
      }
    )
  }

  function handleRetry() {
    setFeedback(null)
    setCheckResult(null)
    scannerRef.current?.resume()
  }

  // Đóng panel thùng rồi quét tiếp (phiên cấp đơn không tự đóng khi 1 mã đủ)
  function finishCarton() {
    setCartonFor(null)
    setFeedback(null)
    scannerRef.current?.resume()
  }
  function saveCarton(list: CartonScan[]) {
    if (!cartonFor) return
    attachCartons({ gdoId: gdo.id, scanId: cartonFor.scanId, cartons: list }, {
      onSuccess: finishCarton,
      onError: (err) => toast({ variant: 'destructive', title: 'Lưu mã thùng lỗi', description: apiMsg(err) }),
    })
  }

  // Súng quét PDA (keyboard-wedge) — chạy song song camera, chống double-read trong hook
  useWedgeScanner(code => handleScan(code, 'wedge'), true)

  // Mở bằng cò súng: xử lý ngay tem vừa bắn (1 lần khi mount)
  useEffect(() => {
    if (initialScan) handleScan(initialScan, 'wedge')
  }, []) // eslint-disable-line

  const isSubOptimal = !!(checkResult?.production_date && checkResult?.best_available_date &&
    checkResult.production_date > checkResult.best_available_date)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col pointer-events-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl h-[92dvh] flex flex-col overflow-hidden">
        <div className="p-4 flex-1 flex flex-col gap-2.5 min-h-0">
          <div>
            <p className="font-semibold text-lg text-slate-800">
              {mode === 'loose' ? 'Quét nhặt lẻ' : 'Quét xuất hàng'} — <span className="font-mono">{gdo.group_code}</span>
            </p>
            <p className="text-sm text-slate-500">
              Quét tem pallet bất kỳ thuộc đơn — tự nhận mã hàng · hỗ trợ súng quét · phiên này: <strong>{count}</strong> pallet
            </p>
          </div>

          {/* Ngữ cảnh MÃ HÀNG vừa nhận từ QR: tên + còn thiếu + NPP + header text + điều kiện Batch/%Date */}
          {activeItem && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-sm font-semibold text-slate-800">{activeMatCode}</span>
                <span className="text-sm font-medium text-slate-700">{activeMatName}</span>
                <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">
                  còn <strong>{activeRemaining}</strong> thùng {mode === 'loose' ? 'nhặt lẻ' : 'cần xuất'}
                </span>
              </div>
              {activeItem.distributor_name && (
                <p className="text-[11px] text-slate-500">NPP: <span className="font-medium text-slate-600">{activeItem.distributor_name}</span></p>
              )}
              {(activeItem.batch_required || (activeItem.date_required != null && activeItem.date_required > 0)) && (
                <div className="flex flex-wrap gap-1.5">
                  {activeItem.batch_required && (
                    <span className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 rounded px-1.5 py-0.5">Batch: {activeItem.batch_required}</span>
                  )}
                  {activeItem.date_required != null && activeItem.date_required > 0 && (
                    <span className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 rounded px-1.5 py-0.5">%Date ≥ {activeItem.date_required}%</span>
                  )}
                </div>
              )}
              {activeItem.header_text && (
                <p className="text-xs font-semibold text-red-600 leading-snug break-words border border-red-300 bg-red-50 rounded px-2 py-1">
                  {activeItem.header_text}
                </p>
              )}
            </div>
          )}

          <div className="relative flex-1 min-h-0">
            {pdaMode ? (
              <div className="h-full w-full rounded-lg bg-slate-900 flex flex-col items-center justify-center gap-2 px-4">
                <QrCode className="h-12 w-12 text-sky-400/70" />
                <p className="text-sm font-medium text-slate-200">Chế độ súng quét — bóp cò để quét tem</p>
                <p className="text-[11px] text-slate-400 text-center">Camera tắt · bắn lại đúng tem đang chờ xác nhận = Lưu</p>
              </div>
            ) : (
              <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} fill />
            )}

            {checking && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                             bg-white/90 rounded-full px-4 py-2 text-sm text-slate-600 shadow-lg">
                Đang kiểm tra…
              </div>
            )}

            {feedback !== null && (
              <button
                className="absolute left-1/2 top-[8%] -translate-x-1/2 -translate-y-1/2 z-10
                           bg-white/90 hover:bg-white text-slate-700 border border-slate-300
                           rounded-full px-4 py-1.5 text-sm font-medium shadow-lg transition-all"
                onClick={handleRetry}
              >
                Quét tiếp
              </button>
            )}

            {checkResult && !saving && (
              <button
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                           bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white
                           rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl transition-all"
                onClick={handleSave}
              >
                Lưu {Math.max(1, parseInt(pendingCartons) || 1)} thùng
              </button>
            )}
            {saving && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                             bg-blue-500 text-white rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl opacity-70">
                …
              </div>
            )}
          </div>

          {checkResult && !feedback && (
            <div className="space-y-2">
              <div className={`rounded-lg border px-3 py-2.5 flex items-start gap-2 ${isSubOptimal ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${isSubOptimal ? 'text-orange-500' : 'text-green-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold font-mono ${isSubOptimal ? 'text-red-600' : 'text-green-800'}`}>
                    {checkResult.pallet_code}
                  </p>
                  {checkResult.production_date && (
                    <p className="text-[10px] text-slate-500 mt-0.5">NSX: {formatTimestampDate(checkResult.production_date)}</p>
                  )}
                  {isSubOptimal && checkResult.best_available_date && (
                    <p className="text-[10px] text-orange-600 font-medium mt-0.5">
                      ⚠ Trong kho còn NSX {formatTimestampDate(checkResult.best_available_date)} (cũ hơn — nên ưu tiên lấy trước)
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 shrink-0">Số thùng:</label>
                <Input
                  type="number"
                  min={1}
                  value={pendingCartons}
                  onChange={e => setPendingCartons(e.target.value)}
                  className="h-11 text-center font-semibold text-lg w-28"
                />
                <span className="text-sm text-slate-400">/ {activeRemaining} {mode === 'loose' ? 'cần chuẩn bị' : 'cần xuất'}</span>
              </div>
              <p className="text-[10px] text-slate-400">Súng quét: bắn lại đúng tem này = Lưu</p>
            </div>
          )}

          {feedback?.type === 'error' && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{feedback.msg}
            </div>
          )}
          {feedback?.type === 'success' && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-sm text-green-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{feedback.msg}
            </div>
          )}
          {feedback?.type === 'queued' && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-2.5 text-sm text-amber-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{feedback.msg}
            </div>
          )}
          {mode === 'outbound' && queuedThisGdo > 0 && !feedback && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">
              ⏸ {queuedThisGdo} lượt quét đang chờ mạng (chưa tính vào số đã xuất)
            </div>
          )}
          {!activeItem && !feedback && !checkResult && (
            <p className="text-[11px] text-slate-400 text-center">
              Hệ thống tự nhận mã hàng từ tem và hiện điều kiện xuất của mã đó
            </p>
          )}

          <Button variant="outline" className="w-full" onClick={onClose} disabled={saving}>Đóng</Button>
        </div>
      </div>

      {cartonFor && activeItem && (
        <CartonScanSheet
          open
          palletCode={cartonFor.palletCode}
          expectedMaterialCode={activeItem.material?.material_code ?? materialCodeOf(activeItem.material_code_raw) ?? ''}
          saving={attaching}
          onSave={saveCarton}
          onSkip={finishCarton}
        />
      )}
    </div>,
    document.body
  )
}
