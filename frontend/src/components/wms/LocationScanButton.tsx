// QUÉT TEM VỊ TRÍ — component DÙNG CHUNG cho MỌI chỗ chọn vị trí trong app (user chốt 21/08).
//
// Vì sao 1 component: 13 chỗ chọn vị trí đang có 4 hình dạng khác nhau (SingleSelect serverSearch,
// pill có ô tìm, ô "hàng dư" khi xuất, bộ lọc list). Nếu mỗi chỗ tự dựng camera + tự tra mã thì
// cùng một tem sẽ ra kết quả khác nhau tuỳ màn — đúng lớp lỗi "luật chép tay nhiều bản" đã trả giá
// ở %Date và ở luật luân chuyển. Ở đây: 1 cửa tra (BE resolve), 1 bộ nhãn (PutawayOption), 1 luật
// chặn (putawayFull).
//
// Nguyên tắc:
//  · KHÔNG tự quyết định thay người quét. Quét ra ô nào thì ĐIỀN vào ô chọn, người bấm xác nhận
//    (user chốt 21/08 — quét nhầm tem kệ bên cạnh vẫn kịp sửa). Riêng ô ĐẦY thì chặn tại đây kèm
//    lý do, vì chọn xong cũng ăn 422 ở BE.
//  · Nhãn hiển thị lấy y nguyên khối `putaway` do BE chấm — FE KHÔNG tự tính lại (utils/putaway.ts).
//  · Loại mã camera giải theo cấu hình KHO của nghiệp vụ (`useScanCodeTypes`), không phải kho của
//    người đăng nhập.
//  · Súng PDA: chỉ nhận phát bắn khi `armWedge` (màn đang chờ ĐÚNG một tem vị trí) hoặc khi overlay
//    đang mở. Không bao giờ tự đoán "tem này là pallet hay vị trí" theo nội dung.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, X, ScanLine } from 'lucide-react'
import type { AxiosError } from 'axios'
import { QRScanner, type QRScannerHandle } from '@/components/shared/QRScanner'
import { PutawayOption, putawayFull, type PutawayLocRow } from '@/components/wms/PutawayOption'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { resolveLocationByCode, type LocationLite } from '@/api/hooks'
import { normalizeLocScan } from '@/utils/locationScan'
import { playBeep, unlockAudio } from '@/utils/audio'

export type ScannedLocation = LocationLite

interface Props {
  /** Kho của NGHIỆP VỤ đang làm (phiếu/chuyến/pallet) — quyết cả cửa tra lẫn loại mã camera giải */
  warehouseId: string | null | undefined
  /** Mã hàng sắp cất (nếu biết) → BE chấm ★ / lý do chặn theo quy tắc cất của kho */
  materialId?: string | null
  nccId?: string | null
  /** Vị trí quét ra hợp lệ → cha tự điền vào ô chọn của mình (KHÔNG tự lưu, không tự gọi API ghi) */
  onPicked: (loc: ScannedLocation) => void
  /**
   * Nhận phát SÚNG PDA khi overlay CHƯA mở. Chỉ bật ở trạng thái mà tem vị trí là thứ DUY NHẤT màn
   * đang chờ (vd: Chuyển vị trí đã tra được pallet nhưng chưa chọn ô đích). Bật lúc màn còn chờ tem
   * pallet là hai handler cùng ăn một phát bắn.
   */
  armWedge?: boolean
  /**
   * Luật RIÊNG của màn gọi (vd Fill chỉ nhận ô NHẶT LẺ). Trả chuỗi = từ chối kèm lý do hiện ngay
   * trên màn quét; trả null = nhận. Có prop này vì "quét ra rồi mới bị cửa ghi từ chối" là bắt
   * người quét đi tới ô đó xong mới biết sai.
   */
  validate?: (loc: ScannedLocation) => string | null
  disabled?: boolean
  /** 'icon' = nút vuông cạnh ô chọn · 'pill' = nút chữ nhỏ (dùng cạnh nhãn/pill có sẵn) */
  variant?: 'icon' | 'pill'
  label?: string
  className?: string
}

export function LocationScanButton({
  warehouseId, materialId, nccId, onPicked, armWedge = false, validate, disabled,
  variant = 'icon', label = 'Quét vị trí', className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [last, setLast] = useState<ScannedLocation | null>(null)   // ô vừa quét bị chặn — hiện để đọc
  const scannerRef = useRef<QRScannerHandle>(null)
  const codeTypes = useScanCodeTypes(warehouseId)

  const handleCode = useCallback(async (raw: string) => {
    const code = normalizeLocScan(raw)
    if (!code || busy) return
    setBusy(true); setErr(null); setLast(null)
    try {
      const loc = await resolveLocationByCode({
        code, warehouse_id: warehouseId, material_id: materialId, ncc_id: nccId, putaway: 1,
      })
      // Ô ngưng sử dụng / đã đầy: BÁO RÕ ngay tại đây thay vì để người quét chọn rồi ăn 422 ở
      // bước Lưu — lúc đó họ đã đẩy xe nâng tới ô đó rồi.
      if (loc.is_active === false) {
        setLast(loc as unknown as ScannedLocation)
        setErr(`Ô ${loc.location_code} đã NGƯNG sử dụng — chọn ô khác`)
        return
      }
      if (putawayFull(loc as unknown as PutawayLocRow)) {
        setLast(loc as unknown as ScannedLocation)
        setErr(`Ô ${loc.location_code} đã ĐẦY (${loc.used_slots ?? 0}/${loc.max_pallets}) — chọn ô khác`)
        return
      }
      const bad = validate?.(loc)
      if (bad) { setLast(loc as unknown as ScannedLocation); setErr(bad); return }
      playBeep()
      onPicked(loc)
      setOpen(false)
    } catch (e) {
      const ax = e as AxiosError<{ error?: { message?: string } }>
      setErr(ax.response?.data?.error?.message ?? 'Không tra được vị trí — thử lại')
    } finally {
      setBusy(false)
    }
  }, [busy, warehouseId, materialId, nccId, onPicked, validate])

  // Sau mỗi lượt quét lỗi: camera đang tạm dừng (QRScanner tự pause) → cho quét tiếp ngay.
  useEffect(() => { if (open && err) scannerRef.current?.resume() }, [open, err])

  // exclusive: giành quyền phát bắn (xem useWedgeScanner) — màn nào cũng có thể còn cò súng tra tem
  // pallet đang bật, hai bên cùng ăn một phát là pallet vừa nhảy ô vừa bị tra lại.
  useWedgeScanner(
    code => { unlockAudio(); void handleCode(code) },
    (armWedge || open) && !disabled,
    { exclusive: true },
  )

  const openScan = () => { unlockAudio(); setErr(null); setLast(null); setOpen(true) }

  const btn = variant === 'pill' ? (
    <button
      type="button" disabled={disabled} onClick={openScan} title={label}
      className={`h-6 inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 text-[10px] font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-40 ${className ?? ''}`}
    >
      <ScanLine className="h-3 w-3" /> Quét
    </button>
  ) : (
    <button
      type="button" disabled={disabled} onClick={openScan} title={label}
      className={`h-9 sm:h-7 w-9 sm:w-7 shrink-0 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-sky-50 hover:border-sky-400 hover:text-sky-700 disabled:opacity-40 ${className ?? ''}`}
    >
      <ScanLine className="h-4 w-4" />
    </button>
  )

  return (
    <>
      {btn}
      {/* Overlay portal ra body + pointer-events-auto: component này còn được dùng TRONG FormSheet /
          Dialog của Radix (modal set pointer-events:none lên body) — không có 2 thứ đó thì camera
          hiện ra mà bấm không được (bẫy đã ghi ở skill table-format §17). */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[300] pointer-events-auto bg-black/80 flex flex-col"
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 text-white shrink-0">
            <MapPin className="h-4 w-4 text-sky-400 shrink-0" />
            <p className="text-sm font-semibold">Quét tem vị trí</p>
            <button type="button" onClick={() => setOpen(false)}
              className="ml-auto h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative">
            <QRScanner ref={scannerRef} onScan={handleCode} onClose={() => setOpen(false)} fill codeTypes={codeTypes} />
          </div>

          <div className="shrink-0 px-3 py-2 bg-slate-900 space-y-1.5">
            {busy && <p className="text-xs text-sky-300">Đang tra vị trí…</p>}
            {err && (
              <div className="rounded-lg border border-red-400 bg-red-950/60 px-2.5 py-2">
                <p className="text-xs font-medium text-red-200">{err}</p>
                {last && (
                  <div className="mt-1 rounded bg-white/95 px-2 py-1 flex">
                    <PutawayOption loc={last as unknown as PutawayLocRow} />
                  </div>
                )}
              </div>
            )}
            {!err && !busy && (
              <p className="text-[11px] text-slate-400">
                Đưa camera vào tem của ô/kệ. Súng PDA bắn được luôn, không cần chạm màn hình.
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
