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
import { MapPin } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { ScanOverlay } from '@/components/shared/ScanOverlay'
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
   * Phát bắn lúc ARM (overlay CHƯA mở) mà không chọn được ô. `message === null` = mã KHÔNG PHẢI vị
   * trí (BE trả 404) → màn cha tự xử lượt bắn đó (vd Chuyển vị trí: coi như tem PALLET, tra lại).
   * Có `message` = ô tra ra được nhưng bị chặn (đầy / ngưng dùng / luật riêng của màn) → cha phải
   * HIỆN lý do, vì khối lỗi của component này chỉ vẽ bên trong overlay.
   * Nhờ nó mà ARM không lấy mất việc "bắn tem pallet khác" — phân loại dựa vào CÂU TRẢ LỜI CỦA BE,
   * không đoán theo hình dạng chuỗi (luật: một cửa tra, không tự chế bộ nhận dạng tem).
   */
  onArmedMiss?: (raw: string, message: string | null) => void
  /**
   * Luật RIÊNG của màn gọi (vd Fill chỉ nhận ô NHẶT LẺ). Trả chuỗi = từ chối kèm lý do hiện ngay
   * trên màn quét; trả null = nhận. Có prop này vì "quét ra rồi mới bị cửa ghi từ chối" là bắt
   * người quét đi tới ô đó xong mới biết sai.
   */
  validate?: (loc: ScannedLocation) => string | null
  /**
   * Màn này quét ô để LÀM GÌ (chốt 22/08 — trước đó mọi chỗ đều bị chặn theo luật CẤT hàng):
   *  · `putaway` (mặc định) = sắp ĐƯA HÀNG VÀO ô → chặn ô ngưng dùng / ô đã đầy ngay tại đây, vì
   *    chọn xong cũng ăn 422 ở cửa ghi (đừng bắt người quét đẩy xe tới nơi rồi mới biết).
   *  · `lookup` = chỉ TRỎ TỚI ô có sẵn (bộ lọc danh sách, chọn ô để KIỂM KÊ) → KHÔNG chặn: ô đầy
   *    mới đúng là ô cần đếm, và lọc danh sách theo một ô đầy là việc hoàn toàn bình thường.
   */
  purpose?: 'putaway' | 'lookup'
  disabled?: boolean
  /** 'icon' = nút vuông cạnh ô chọn · 'pill' = nút chữ nhỏ (dùng cạnh nhãn/pill có sẵn) */
  variant?: 'icon' | 'pill'
  label?: string
  className?: string
}

export function LocationScanButton({
  warehouseId, materialId, nccId, onPicked, armWedge = false, onArmedMiss, validate,
  purpose = 'putaway', disabled,
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
    // Bắn lúc ARM thì khối lỗi/cảnh báo của overlay không hiển thị → đẩy lý do về cho màn cha.
    const armedSilent = !open
    const miss = (message: string | null) => {
      if (armedSilent && onArmedMiss) { onArmedMiss(raw, message); return true }
      return false
    }
    setBusy(true); setErr(null); setLast(null)
    try {
      const loc = await resolveLocationByCode({
        code, warehouse_id: warehouseId, material_id: materialId, ncc_id: nccId, putaway: 1,
      })
      // Ô ngưng sử dụng / đã đầy: BÁO RÕ ngay tại đây thay vì để người quét chọn rồi ăn 422 ở
      // bước Lưu — lúc đó họ đã đẩy xe nâng tới ô đó rồi.
      if (purpose === 'putaway') {
        if (loc.is_active === false) {
          const m = `Ô ${loc.location_code} đã NGƯNG sử dụng — chọn ô khác`
          if (miss(m)) return
          setLast(loc as unknown as ScannedLocation); setErr(m)
          return
        }
        if (putawayFull(loc as unknown as PutawayLocRow)) {
          const m = `Ô ${loc.location_code} đã ĐẦY (${loc.used_slots ?? 0}/${loc.max_pallets}) — chọn ô khác`
          if (miss(m)) return
          setLast(loc as unknown as ScannedLocation); setErr(m)
          return
        }
      }
      const bad = validate?.(loc)
      if (bad) { if (miss(bad)) return; setLast(loc as unknown as ScannedLocation); setErr(bad); return }
      playBeep()
      onPicked(loc)
      setOpen(false)
    } catch (e) {
      const ax = e as AxiosError<{ error?: { message?: string } }>
      const m = ax.response?.data?.error?.message ?? 'Không tra được vị trí — thử lại'
      // 404 = mã này KHÔNG PHẢI vị trí → trả lượt bắn về cho màn cha (message null).
      // Lỗi khác (mơ hồ 2 kho, mạng, 5xx) vẫn phải NÓI RÕ, đừng để cha hiểu nhầm là tem pallet.
      if (miss(ax.response?.status === 404 ? null : m)) return
      setErr(m)
    } finally {
      setBusy(false)
    }
  }, [busy, open, onArmedMiss, warehouseId, materialId, nccId, onPicked, validate, purpose])

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
      <ScanIcon className="h-3 w-3" /> Quét
    </button>
  ) : (
    <button
      type="button" disabled={disabled} onClick={openScan} title={label}
      className={`h-9 sm:h-7 w-9 sm:w-7 shrink-0 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-sky-50 hover:border-sky-400 hover:text-sky-700 disabled:opacity-40 ${className ?? ''}`}
    >
      <ScanIcon className="h-4 w-4" />
    </button>
  )

  return (
    <>
      {btn}
      {/* Overlay portal ra body + pointer-events-auto: component này còn được dùng TRONG FormSheet /
          Dialog của Radix (modal set pointer-events:none lên body) — không có 2 thứ đó thì camera
          hiện ra mà bấm không được (bẫy đã ghi ở skill table-format §17). */}
      {open && (
        <ScanOverlay
          title="Quét tem vị trí"
          icon={<MapPin className="h-4 w-4 text-sky-400 shrink-0" />}
          onClose={() => setOpen(false)}
          footer={<>
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
          </>}
        >
          <QRScanner ref={scannerRef} onScan={handleCode} onClose={() => setOpen(false)} fill codeTypes={codeTypes} />
        </ScanOverlay>
      )}
    </>
  )
}
