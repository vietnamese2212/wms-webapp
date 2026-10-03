// Upload dữ liệu nguồn của luồng xuất — ĐẶT TẠI "Dữ liệu bên ngoài" (user chốt 02/08).
// Trước đây 2 luồng này nằm trong 1 modal "Up kế hoạch VC" ở trang Xuất kho; nhưng Xuất là KẾT QUẢ
// DẪN XUẤT, còn VL06O/ZSD02/KH điều vận là NGUỒN — nạp nguồn phải ở đúng trang nguồn (mỗi tab nạp đúng
// bảng nó đang hiển thị). Giữ NGUYÊN chuẩn 2 pha: kiểm trước (preflight) → xem báo cáo → Xác nhận mới ghi.
// 22/09: thêm nguồn ZSD02 (báo cáo SAP mức dòng SO/OD) — thay VL06O theo công tắc `sap_do_source`.
import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import type { AxiosError } from 'axios'
import { Upload, Download, X, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalOverlay } from '@/components/shared/ModalOverlay'
import { UploadPreflightPanel } from '@/components/shared/UploadPreflightPanel'
import { saveWorkbook } from '@/utils/saveExcel'
import { useUploadVl06o, useUploadKhvc, useUploadZsd02, useZsd02Coverage, UPLOAD_TOO_LARGE_MSG, type UploadPreflight, type Zsd02UploadResult, type Zsd02UploadFields, type Zsd02Coverage } from '@/api/hooks'
import { useScopedWhTypes, useScopedWarehouses } from '@/hooks/useUserScope'
import { InfoTip } from '@/components/shared/InfoTip'

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** NGÀY TẠO CẦN PHỦ của một plant (03/10 tối — user: "khi mở giao diện upload, app yêu cầu nên upload dữ liệu của ngày tạo của những
 *  dữ liệu cũ còn treo"). Đọc từ GET /external/do-sap/coverage; người đổ SAP theo đúng khoảng này. */
function CoverageNeed({ plant, onSuggest }: { plant: string; onSuggest: (from: string) => void }) {
  const q = useZsd02Coverage(plant)
  const c = q.data
  if (!c) return <div className="text-[11px] text-slate-400">Plant {plant}: đang tính ngày cần phủ…</div>
  if (!c.pending_ods) return <div className="text-[11px] text-green-700">Plant {plant}: không còn đơn chưa đi nào cần phủ.</div>
  const span = c.od_span
  const soSpan = c.so_span
  return (
    <div className="text-[11px] text-slate-700 space-y-0.5">
      <div>
        <b>Plant {plant}</b>: {c.pending_ods.toLocaleString('vi-VN')} đơn chưa đi{c.sap_posted_ods ? <> (trong đó {c.sap_posted_ods.toLocaleString('vi-VN')} SAP đã post — đánh dấu Ngoài app ở Điều vận thì không phải phủ nữa)</> : null}.
      </div>
      {span && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{c.mode === 'REQUIRE' ? 'Bắt buộc' : 'Nên'} đổ <b>Ngày tạo OD</b> từ <b>{dmy(span.from)}</b> đến <b>{dmy(span.to)}</b> ({c.by_od_created.length} ngày tạo)</span>
          <button type="button" className="text-sky-700 hover:underline" onClick={() => onSuggest(span.from)}>Điền vào ô khoảng ngày</button>
          <InfoTip tip={<div className="space-y-1 text-xs">
            <div>Từng ngày tạo có đơn chưa đi: {c.by_od_created.slice(0, 20).map(d => `${dmy(d.date)} (${d.ods})`).join(' · ')}{c.by_od_created.length > 20 ? ' …' : ''}</div>
            {soSpan && <div>Nếu SAP lọc theo <b>Ngày tạo SO</b> thì khoảng là {dmy(soSpan.from)} → {dmy(soSpan.to)}.</div>}
            {c.no_created_date > 0 && <div>{c.no_created_date} đơn không có ngày tạo (nhập tay / VL06O) — không kiểm phủ.</div>}
            <div className="text-slate-500">Khoảng do đơn CŨ NHẤT chưa đi quyết định — đơn chỉ rời khoảng khi ĐÃ ĐI (chuyến Xuất kho hoàn thành) hoặc mang dấu Ngoài app; đơn Không điều / đã điều chưa đi vẫn phải phủ.</div>
          </div>} />
        </div>
      )}
    </div>
  )
}

export type VcUploadMode = 'vl06o' | 'khvc' | 'zsd02'

type UnitErr = { material_code: string; material_name: string; kind: string; file_value: string; system_value: string }

const TITLE: Record<VcUploadMode, string> = { vl06o: 'VL06O', khvc: 'KHVC', zsd02: 'ZSD02' }

function downloadVl06oTemplate() {
  const headers = ['Delivery', 'Item', 'Ship-to Party', 'Material', 'Item Description',
    'Delivery Quantity', 'Sales Unit', 'Actual delivery qty', 'Base Unit of Measure',
    'Name ship-to party', 'Batch', 'Date (%)', 'Ghi chú giao hàng', 'Ghi chú hoá đơn']
  const ex = ['3000384084', '10', '30000325', '510000306', 'BAVI SCA Có đường 100grx48',
    40, 'CAR', 1920, 'HOP', 'NPPTRANGHOANG', '', '', '', '']
  const ws = XLSX.utils.aoa_to_sheet([headers, ex])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  saveWorkbook(wb, 'mau_vl06o.xlsx')
}
// Mẫu ZSD02 = ĐÚNG tiêu đề SAP xuất ra (map theo tên cột nên đảo cột không sao). Dấu * ở cột BẮT BUỘC —
// "Outbound Delivery" KHÔNG bắt buộc: dòng SO chưa có OD để trống, đi vào sổ SO (tab "Chưa có OD").
function downloadZsd02Template() {
  const headers = ['SO/ PO SAP *', 'Outbound Delivery', 'Item *', 'Material *', 'Material Description', 'Plant *', 'Sloc',
    'Sales unit *', 'SO Qty/ SL SO *', 'SO Qty CAR/ SL SO THÙNG', 'OD Qty', 'OD Qty CAR/ SL THÙNG đã điều phối', 'OD Qty (Base Unit) *', 'Base Unit *',
    'Số lượng đã xuất / nhập', 'Delivery date *', 'SO/ PO type *', 'Item Category', 'Ship to code *', 'Ship to name', 'Sold to code',
    'Địa chỉ giao hàng', 'Tên Phường', 'Region/ Tỉnh.TP', 'Route/ Tuyến giao hàng', 'Mã Route', 'Sales District/ Khu vực bán hàng',
    'Tên tài xế', 'Biển số xe', 'Trạng thái điều phối xe', 'Đơn vị vận chuyển', 'Ghi chú giao hàng', 'Trạng thái hủy đơn',
    'SL SO PALLET', 'SL PALLET đã điều phối', 'SL SO M3', 'SL M3 đã điều phối', 'Gross Weight', 'Mat Doc', 'Billing']
  // Sloc để trống trong mẫu: mã kho SAP là danh mục của từng đơn vị, không viết cứng vào code
  const ex1 = ['2000276760', '3000494901', '10', '510000219', 'LOF Sữa Bắp Non Canxi hộp 180mlx24', '1102', '',
    'Thùng', 60, 60, 60, 60, 1440, 'HOP', 0, '07/09/2026', 'ZOR1-SO Standard', 'ZTA1-IC Sales Standard', '10005947', 'Tmart Phan Trọng Tuệ', '10005947',
    'Phường Phú Lương, Hà Đông, Hà Nội', 'HN-Phú Lương', '100-Thành phố Hà Nội', 'BV-HN-Phú Lương', 'BV0059', '10401-MB',
    '', '29H94850', 'Đã điều phối', 'HN', 'date>60%', '', 0.316, 0.316, 0.439, 0.439, 298199.52, '', '']
  const ex2 = ['2000276761', '', '10', '510000219', 'LOF Sữa Bắp Non Canxi hộp 180mlx24', '1102', '',
    'Thùng', 20, 20, 0, 0, 0, 'HOP', 0, '08/09/2026', 'ZOR1-SO Standard', 'ZTA1-IC Sales Standard', '10005947', 'Tmart Phan Trọng Tuệ', '10005947',
    'Phường Phú Lương, Hà Đông, Hà Nội', 'HN-Phú Lương', '100-Thành phố Hà Nội', 'BV-HN-Phú Lương', 'BV0059', '10401-MB',
    '', '', 'Chưa điều phối', '', '', '', 0.105, 0, 0.146, 0, 99399.84, '', '']
  const ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  saveWorkbook(wb, 'mau_zsd02.xlsx')
}
// `sampleCategory` = 1 giá trị Loại kho LẤY TỪ DANH MỤC của chính đơn vị này — KHÔNG viết cứng.
// Mỗi đơn vị một taxonomy riêng (mã SAP 'FG01…' hay tên tiếng Việt 'Thành phẩm…'), mà cột
// "Loại kho booking" sai giá trị là TỪ CHỐI CẢ FILE ⇒ ví dụ cứng sẽ dạy người dùng gõ sai.
function downloadKhvcTemplate(sampleCategory: string) {
  const d = new Date(); d.setDate(d.getDate() + 1)
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear()
  const ddmmyy = `${dd}${mm}${String(yyyy).slice(2)}`
  // "Loại kho booking" = CỬA xe đậu để đặt khung giờ — BẮT BUỘC, và 1 Số xe chỉ được 1 giá trị
  // (xe chở lẫn nhiều loại vẫn chỉ đậu 1 cửa; khai lệch nhau trong cùng Số xe → từ chối cả file).
  // "Mã xe SAP" (23/09) = dòng xe CON 9100000xx — TÙY CHỌN, dùng để tính cước/tải; để trống thì giữ lựa chọn tay ở tab Kế hoạch xuất
  const headers = ['Ngày xuất', 'Số xe', 'DO', 'Tên NPP', 'Loại kho booking', 'Loại xe', 'Mã xe SAP', 'DVVT', 'Ưu tiên', 'CS phụ trách', 'Note']
  const ex = [`${dd}/${mm}/${yyyy}`, `20000016_X_${ddmmyy}_01`, '3000384084', 'NPPTRANGHOANG', sampleCategory, 'Xe Pallet', '910000030', 'DA', '1', 'Nguyễn Văn A', 'Giao gấp trước 10h']
  const ws = XLSX.utils.aoa_to_sheet([headers, ex])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ke hoach dieu van')
  saveWorkbook(wb, 'mau_khvc.xlsx')
}

const nf = (v: number | undefined | null) => (v ?? 0).toLocaleString('vi-VN')

/** `onUploaded` = ghi thật xong (không gọi ở pha kiểm) — trang chủ dùng để đặt bộ lọc bảng về "Ngày nạp = hôm nay" cho dữ liệu vừa nạp
 *  hiện ngay (user 29/09); ZSD02 kèm khoảng Ngày giao của file để tab "Chưa có OD" (lọc theo Ngày giao) cũng hiện ngay. */
export function VcUploadDialog({ mode, onClose, onUploaded }: { mode: VcUploadMode; onClose: () => void; onUploaded?: (r?: { delivery_range: Zsd02UploadResult['delivery_range'] }) => void }) {
  const isVl = mode === 'vl06o', isZs = mode === 'zsd02'
  const { mutate: uploadVl06o, isPending: vlBusy } = useUploadVl06o()
  const { mutate: uploadKhvc,  isPending: khBusy } = useUploadKhvc()
  const { mutate: uploadZsd02, isPending: zsBusy } = useUploadZsd02()
  const busy = isVl ? vlBusy : isZs ? zsBusy : khBusy
  const { data: whTypes = [] } = useScopedWhTypes()   // giá trị mẫu cột "Loại kho booking" của mẫu KH điều vận
  // ZSD02 (03/10 tối): plant của các kho trong phạm vi ⇒ khối "ngày tạo cần phủ" + ô khai khoảng ngày tạo của file
  const { data: whsRaw = [] } = useScopedWarehouses(true)
  const plants = isZs ? [...new Set((whsRaw as { sap_plant?: string | null }[]).map(w => w.sap_plant).filter((p): p is string => !!p))].sort() : []
  // Để trống = BE lấy đúng min/max ngày tạo OD có trong file. KHÔNG điền sẵn "hôm nay" (review 03/10): khai tới hôm nay cho một file
  // xuất từ sáng là nói dối về khoảng phủ — phép "file cũ hơn sổ" không bao giờ bật và OD tạo sau giờ xuất file bị coi là SAP đã xoá.
  const [covFrom, setCovFrom] = useState('')
  const [covTo, setCovTo] = useState('')
  const [allowOld, setAllowOld] = useState(false)
  const [confirmGone, setConfirmGone] = useState(false)
  const [lastErrCode, setLastErrCode] = useState<string | null>(null)
  const [lastFile, setLastFile] = useState<File | null>(null)
  const zsFields = (): Zsd02UploadFields | undefined => isZs ? { created_from: covFrom || undefined, created_to: covTo || undefined, allow_old: allowOld ? '1' : undefined, confirm_gone: confirmGone ? '1' : undefined } : undefined
  const fileRef = useRef<HTMLInputElement>(null)
  const [okMsg, setOkMsg]   = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [unitErrs, setUnitErrs] = useState<UnitErr[] | null>(null)
  // Lỗi theo TỪNG Số xe → hiện BẢNG (user 03/08: một khối chữ gộp hết vấn đề thì không đọc được)
  const [gcErrs, setGcErrs] = useState<{ group_code: string; msg: string }[] | null>(null)
  const [pf, setPf] = useState<{ file: File; report: UploadPreflight } | null>(null)

  const fileLabel = isVl ? 'VL06O' : isZs ? 'ZSD02' : 'KH điều vận'
  const onErr = (fallback: string) => (err: unknown) => {
    const ax = err as AxiosError<{ error?: { message?: string; code?: string }; unit_errors?: UnitErr[]; validation_errors?: { group_code: string; errors: string[] }[]; coverage?: Zsd02Coverage }>
    const data = ax?.response?.data
    setLastErrCode(data?.error?.code ?? null)
    if (data?.unit_errors?.length) setUnitErrs(data.unit_errors)
    const ve = data?.validation_errors
    if (ve?.length) setGcErrs(ve.flatMap(v => v.errors.map(msg => ({ group_code: v.group_code, msg }))))
    // 504 = Vercel cắt vì quá thời gian (text thô, không phải JSON app). Cửa nạp là idempotent (khoá OD/item, SO/item — dòng đã
    // ghi y hệt = NO-OP) nên bấm lại chỉ ghi tiếp phần còn thiếu, KHÔNG sinh trùng (user hỏi 29/09 sau khi bấm nhiều lần).
    const timedOut = ax?.response?.status === 504 || ax?.code === 'ECONNABORTED'
    setErrMsg(data?.error?.message ?? (ax?.response?.status === 413 ? UPLOAD_TOO_LARGE_MSG
      : timedOut ? 'Máy chủ chạy quá thời gian cho phép nên chưa ghi hết — bấm Xác nhận lại để ghi tiếp phần còn thiếu (dòng đã ghi không bị trùng, không bị ghi đôi).'
        : fallback))
  }

  // PHA 1 — LUÔN kiểm trước (không ghi gì) → báo cáo chờ Xác nhận
  function runPreflight(file: File) {
    setOkMsg(null); setErrMsg(null); setUnitErrs(null); setGcErrs(null); setPf(null); setLastErrCode(null)
    const opts = { onSuccess: (r: UploadPreflight) => setPf({ file, report: r }), onError: onErr(`Lỗi kiểm file ${fileLabel}`) }
    if (isVl) uploadVl06o({ file, preflight: true }, opts)
    else if (isZs) uploadZsd02({ file, preflight: true, fields: zsFields() }, opts)
    else uploadKhvc({ file, preflight: true }, opts)
  }
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    setLastFile(file)
    setAllowOld(false); setConfirmGone(false)   // xác nhận "file cũ" / "SAP đã xoá" là theo TỪNG file — không mang sang file kế
    runPreflight(file)
  }

  // PHA 2 — ghi thật sau khi user Xác nhận trên báo cáo
  function doUpload(file: File) {
    setOkMsg(null); setErrMsg(null); setUnitErrs(null); setGcErrs(null)
    if (isVl) {
      uploadVl06o({ file }, {
        onSuccess: (r: { rows: number; deliveries: number; skipped_no_key: number; warning_count: number; warnings: string[] }) => {
          setPf(null); onUploaded?.()
          const parts = [`Lưu ${r.rows} dòng · ${r.deliveries} DO`]
          if (r.skipped_no_key) parts.push(`bỏ ${r.skipped_no_key} dòng thiếu Delivery/Item`)
          let msg = parts.join(' · ')
          if (r.warning_count) msg += `\n⚠ ${r.warning_count} cảnh báo:\n` + r.warnings.map(w => `  • ${w}`).join('\n')
          setOkMsg(msg)
        },
        onError: onErr('Lỗi upload VL06O'),
      })
    } else if (isZs) {
      uploadZsd02({ file, fields: zsFields() }, {
        onSuccess: (r: Zsd02UploadResult) => {
          setPf(null); onUploaded?.({ delivery_range: r.delivery_range ?? null })
          // Hai sổ nói riêng — người nạp phải thấy dòng CHƯA OD đi đâu, không thì tưởng "mất dòng"
          const lines = [
            `Sổ OD: ${nf(r.od.rows)} dòng · ${nf(r.od.deliveries)} OD — thêm ${nf(r.od.inserted)} · sửa ${nf(r.od.updated)} · giữ nguyên ${nf(r.od.noop)}${r.od.obsoleted ? ` · SAP bỏ dòng ${nf(r.od.obsoleted)}` : ''}${r.od.gone ? ` · SAP xoá DO ${nf(r.od.gone)}` : ''}${r.od.lineage_edges ? ` · phả hệ thay/tách/gộp ${nf(r.od.lineage_edges)}` : ''}${r.od.uncertain ? ` · chưa kết luận ${nf(r.od.uncertain)} (xem Điều vận)` : ''}`,
            r.coverage?.declared ? `Khoảng ngày tạo đã khai: ${dmy(r.coverage.declared.from)} → ${dmy(r.coverage.declared.to)}${r.coverage.plants.some(p => p.missing.length) ? ` — ⚠ còn thiếu ngày của đơn chưa đi ở plant ${r.coverage.plants.filter(p => p.missing.length).map(p => p.plant).join(', ')}` : ' — phủ đủ đơn chưa đi'}` : null,
            `Sổ SO: ${nf(r.so.rows)} dòng · ${nf(r.so.orders)} SO — trong đó ${nf(r.so.without_od)} dòng CHƯA có OD (tab "Chưa có OD")${r.so.unresolved ? ` · ${nf(r.so.unresolved)} dòng không quy đổi được đơn vị` : ''}${r.so.cancelled ? ` · ${nf(r.so.cancelled)} dòng SAP đã huỷ` : ''}`,
            `Phân loại: ${Object.entries(r.flows ?? {}).map(([k, v]) => `${k} ${nf(v)}`).join(' · ')}${r.not_loadable ? ` — ${nf(r.not_loadable)} dòng KHÔNG lên xe (trả về / chiết khấu / chưa phân loại)` : ''}`,
            r.customers ? `Khách hàng: tạo ${nf(r.customers.created)} · điền địa lý ${nf(r.customers.filled)}${r.customers.conflicts ? ` · ${nf(r.customers.conflicts)} ô lệch giữ giá trị đang có` : ''} · tuyến SAP ${nf(r.routes)}` : null,
            r.skipped_no_key ? `Bỏ ${nf(r.skipped_no_key)} dòng thiếu SO/Item` : null,
          ].filter(Boolean)
          let msg = lines.join('\n')
          if (r.warning_count) msg += `\n⚠ ${r.warning_count} cảnh báo:\n` + r.warnings.map(w => `  • ${w}`).join('\n')
          setOkMsg(msg)
        },
        onError: onErr('Lỗi upload ZSD02'),
      })
    } else {
      uploadKhvc({ file }, {
        onSuccess: (result: { created?: Array<{ created?: boolean; merged?: boolean; skipped?: boolean }>
          awaiting?: { awaiting?: number; cleared?: number; reopened?: number } }) => {
          setPf(null); onUploaded?.()
          const items = result.created ?? []
          const nCreated = items.filter(r => r.created && !r.merged).length
          const nMerged  = items.filter(r => r.merged).length
          const nSkipped = items.filter(r => r.skipped).length
          // Xe thiếu dữ liệu SAP KHÔNG nằm trong `created` (chuyến chờ là VỎ, đi nhánh awaiting riêng) —
          // chỉ đếm created thì up 3 xe báo "Tạo mới 1 chuyến", điều vận tưởng MẤT 2 xe (đo UI 04/08).
          const nAwaiting = result.awaiting?.awaiting ?? 0
          setOkMsg([
            nCreated > 0 && `Tạo mới ${nCreated} chuyến`,
            nAwaiting > 0 && `${nAwaiting} chuyến CHỜ dữ liệu SAP (sẽ tự kích hoạt khi up ZSD02/VL06O)`,
            nMerged  > 0 && `Cập nhật ${nMerged} chuyến (đang tạm dừng)`,
            nSkipped > 0 && `Bỏ qua ${nSkipped} chuyến (đang xuất/đã hoàn thành)`,
          ].filter(Boolean).join(' · ') || 'Không có chuyến mới')
        },
        onError: onErr('Lỗi upload KH điều vận'),
      })
    }
  }

  const wide = (unitErrs?.length ?? 0) > 5 || (gcErrs?.length ?? 0) > 3 || (errMsg?.length ?? 0) > 600 || (okMsg?.length ?? 0) > 600
  const onTemplate = isVl ? downloadVl06oTemplate : isZs ? downloadZsd02Template : () => downloadKhvcTemplate(whTypes[0]?.value ?? '')
  return (
    <>
      <ModalOverlay onClose={onClose} className={`w-full max-h-[90vh] ${wide ? 'max-w-[95vw] sm:max-w-[80vw]' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">
            {isVl ? 'Up VL06O (dữ liệu SAP)' : isZs ? 'Up ZSD02 (dữ liệu SAP — thay VL06O)' : 'Up KH điều vận (sinh chuyến xuất)'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-auto">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onTemplate} className="h-8 text-xs gap-1">
              <Download className="h-3.5 w-3.5" /> Tải mẫu {TITLE[mode]}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()} className="h-8 text-xs gap-1">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {busy ? 'Đang xử lý…' : `Chọn file ${TITLE[mode]}`}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </div>
          {/* ZSD02 — KHOẢNG PHỦ NGÀY TẠO (03/10 tối): app nói phải đổ SAP từ ngày nào; người khai khoảng mình đã đổ; thiếu ngày của đơn chưa đi thì
              công tắc Bắt buộc từ chối nạp. Đây là cách bù cho việc SAP chỉ đổ theo ngày tạo, không có "ngày sửa cuối". */}
          {isZs && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 space-y-1.5">
              <div className="text-[11px] font-semibold text-sky-900">Khi đổ ZSD02 từ SAP, lọc Ngày tạo theo khoảng dưới đây</div>
              {plants.length ? plants.map(p => <CoverageNeed key={p} plant={p} onSuggest={from => { setCovFrom(from); setCovTo(todayVN()) }} />)
                : <div className="text-[11px] text-slate-500">Kho trong phạm vi chưa khai Plant SAP (Cài đặt WMS → Kho) nên không tính được ngày cần phủ.</div>}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-700">
                <span>File này lọc <b>Ngày tạo</b> từ</span>
                <input type="date" value={covFrom} onChange={e => setCovFrom(e.target.value)} className="h-7 rounded border border-slate-300 px-1.5 text-[11px]" />
                <span>đến</span>
                <input type="date" value={covTo} onChange={e => setCovTo(e.target.value)} className="h-7 rounded border border-slate-300 px-1.5 text-[11px]" />
                <InfoTip tip="Khai đúng khoảng bạn đã lọc ở SAP. App chỉ kết luận “SAP đã xoá / đã thay” cho DO có ngày tạo TRONG khoảng này; ngoài khoảng, vắng mặt không nói lên gì. Để trống thì app lấy khoảng ngày tạo thật có trong file." />
              </div>
              {(lastErrCode === 'COVERAGE_MISSING' || lastErrCode === 'COVERAGE_SUSPECT') && (
                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                  {/file cũ|cũ hơn sổ/i.test(errMsg ?? '') && (
                    <label className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" className="h-3.5 w-3.5 accent-sky-600" checked={allowOld} onChange={e => setAllowOld(e.target.checked)} /> Đúng là tôi muốn nạp file cũ hơn sổ</label>
                  )}
                  {lastErrCode === 'COVERAGE_SUSPECT' && (
                    <label className="inline-flex items-center gap-1 cursor-pointer text-red-700"><input type="checkbox" className="h-3.5 w-3.5 accent-red-600" checked={confirmGone} onChange={e => setConfirmGone(e.target.checked)} /> Đúng là SAP đã xoá các OD này</label>
                  )}
                  {lastFile && <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => runPreflight(lastFile)}>Kiểm lại file với khoảng / lựa chọn mới</Button>}
                </div>
              )}
            </div>
          )}
          {okMsg && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /><pre className="whitespace-pre-wrap font-sans">{okMsg}</pre>
            </div>
          )}
          {errMsg && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><pre className="whitespace-pre-wrap font-sans">{errMsg}</pre>
            </div>
          )}
          {/* Lỗi theo từng Số xe = BẢNG (đọc được ngay xe nào sai gì), không phải 1 khối chữ */}
          {gcErrs && gcErrs.length > 0 && (
            <div className="overflow-auto border rounded-lg max-h-[52vh]">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 sticky top-0">
                    <th className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 uppercase w-48 whitespace-nowrap">Số xe</th>
                    <th className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 uppercase">Vấn đề</th>
                  </tr>
                </thead>
                <tbody>
                  {gcErrs.map((e, k) => (
                    <tr key={k} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1 text-[10px] font-mono text-slate-600 whitespace-nowrap">{e.group_code}</td>
                      <td className="px-2 py-1 text-[10px] text-red-700">{e.msg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unitErrs && unitErrs.length > 0 && (
            <div className="rounded-lg border border-red-200 overflow-x-auto">
              <table className="w-full text-[11px] whitespace-nowrap">
                <thead className="bg-red-50 text-red-700">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Mã hàng</th>
                    <th className="px-2 py-1 text-left font-medium">Tên</th>
                    <th className="px-2 py-1 text-left font-medium">Lỗi</th>
                    <th className="px-2 py-1 text-left font-medium">Trong file</th>
                    <th className="px-2 py-1 text-left font-medium">Hệ thống</th>
                  </tr>
                </thead>
                <tbody>
                  {unitErrs.map((u, i) => (
                    <tr key={i} className="border-t border-red-100">
                      <td className="px-2 py-1 font-mono font-semibold">{u.material_code}</td>
                      <td className="px-2 py-1 max-w-[180px] truncate" title={u.material_name}>{u.material_name || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-1">{u.kind}</td>
                      <td className="px-2 py-1 text-red-600 font-semibold">{u.file_value}</td>
                      <td className="px-2 py-1">{u.system_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            {isVl
              ? 'VL06O = bản sao dữ liệu SAP (giữ nguyên định dạng, lưu đầy đủ). Nạp VL06O TRƯỚC, rồi mới nạp KH điều vận ở tab "Kế hoạch xuất".'
              : isZs
              ? 'ZSD02 = báo cáo SAP mức dòng SO/OD (79 cột, để nguyên tiêu đề SAP). Dòng CÓ OD vào sổ DO (số gốc lấy thẳng từ SAP); dòng CHƯA có OD chỉ vào tab "Chưa có OD" để nhìn trước tải — không lên xe được. Dòng trả pallet / chiết khấu được đánh dấu và không vào Kế hoạch xuất.'
              : 'KH điều vận = kế hoạch tự soạn (Số xe, DO, NPP…). Hệ thống ghép theo DO trong sổ DO SAP rồi tự tính Thùng + Hộp lẻ theo đơn vị gốc từng mã → sinh chuyến bên Xuất kho.'}
          </p>
        </div>
      </ModalOverlay>

      {/* Báo cáo KIỂM TRƯỚC — chưa ghi gì cho tới khi bấm Xác nhận; Huỷ = bỏ file, DB nguyên vẹn */}
      {pf && (
        <ModalOverlay onClose={() => setPf(null)} className="sm:w-[80vw] sm:max-w-[80vw] sm:!h-[80vh] sm:max-h-[80vh]">
          <div className="px-3 py-2 border-b shrink-0">
            <span className="text-sm font-semibold text-slate-700">
              Kiểm file trước khi nhập — {isVl ? 'VL06O (raw SAP)' : isZs ? 'ZSD02 (raw SAP — hai sổ OD/SO)' : 'KH điều vận (sinh chuyến)'}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden p-3 flex flex-col">
            <UploadPreflightPanel report={pf.report} fileName={pf.file.name} busy={busy}
              onCancel={() => setPf(null)} onConfirm={() => doUpload(pf.file)} />
          </div>
        </ModalOverlay>
      )}
    </>
  )
}
