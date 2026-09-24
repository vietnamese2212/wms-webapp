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
import { useUploadVl06o, useUploadKhvc, useUploadZsd02, UPLOAD_TOO_LARGE_MSG, type UploadPreflight, type Zsd02UploadResult } from '@/api/hooks'
import { useScopedWhTypes } from '@/hooks/useUserScope'

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

export function VcUploadDialog({ mode, onClose }: { mode: VcUploadMode; onClose: () => void }) {
  const isVl = mode === 'vl06o', isZs = mode === 'zsd02'
  const { mutate: uploadVl06o, isPending: vlBusy } = useUploadVl06o()
  const { mutate: uploadKhvc,  isPending: khBusy } = useUploadKhvc()
  const { mutate: uploadZsd02, isPending: zsBusy } = useUploadZsd02()
  const busy = isVl ? vlBusy : isZs ? zsBusy : khBusy
  const { data: whTypes = [] } = useScopedWhTypes()   // giá trị mẫu cột "Loại kho booking" của mẫu KH điều vận
  const fileRef = useRef<HTMLInputElement>(null)
  const [okMsg, setOkMsg]   = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [unitErrs, setUnitErrs] = useState<UnitErr[] | null>(null)
  // Lỗi theo TỪNG Số xe → hiện BẢNG (user 03/08: một khối chữ gộp hết vấn đề thì không đọc được)
  const [gcErrs, setGcErrs] = useState<{ group_code: string; msg: string }[] | null>(null)
  const [pf, setPf] = useState<{ file: File; report: UploadPreflight } | null>(null)

  const fileLabel = isVl ? 'VL06O' : isZs ? 'ZSD02' : 'KH điều vận'
  const onErr = (fallback: string) => (err: unknown) => {
    const ax = err as AxiosError<{ error?: { message?: string; code?: string }; unit_errors?: UnitErr[]; validation_errors?: { group_code: string; errors: string[] }[] }>
    const data = ax?.response?.data
    if (data?.unit_errors?.length) setUnitErrs(data.unit_errors)
    const ve = data?.validation_errors
    if (ve?.length) setGcErrs(ve.flatMap(v => v.errors.map(msg => ({ group_code: v.group_code, msg }))))
    setErrMsg(data?.error?.message ?? (ax?.response?.status === 413 ? UPLOAD_TOO_LARGE_MSG : fallback))
  }

  // PHA 1 — LUÔN kiểm trước (không ghi gì) → báo cáo chờ Xác nhận
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    setOkMsg(null); setErrMsg(null); setUnitErrs(null); setGcErrs(null); setPf(null)
    const opts = { onSuccess: (r: UploadPreflight) => setPf({ file, report: r }), onError: onErr(`Lỗi kiểm file ${fileLabel}`) }
    if (isVl) uploadVl06o({ file, preflight: true }, opts)
    else if (isZs) uploadZsd02({ file, preflight: true }, opts)
    else uploadKhvc({ file, preflight: true }, opts)
  }

  // PHA 2 — ghi thật sau khi user Xác nhận trên báo cáo
  function doUpload(file: File) {
    setOkMsg(null); setErrMsg(null); setUnitErrs(null); setGcErrs(null)
    if (isVl) {
      uploadVl06o({ file }, {
        onSuccess: (r: { rows: number; deliveries: number; skipped_no_key: number; warning_count: number; warnings: string[] }) => {
          setPf(null)
          const parts = [`Lưu ${r.rows} dòng · ${r.deliveries} DO`]
          if (r.skipped_no_key) parts.push(`bỏ ${r.skipped_no_key} dòng thiếu Delivery/Item`)
          let msg = parts.join(' · ')
          if (r.warning_count) msg += `\n⚠ ${r.warning_count} cảnh báo:\n` + r.warnings.map(w => `  • ${w}`).join('\n')
          setOkMsg(msg)
        },
        onError: onErr('Lỗi upload VL06O'),
      })
    } else if (isZs) {
      uploadZsd02({ file }, {
        onSuccess: (r: Zsd02UploadResult) => {
          setPf(null)
          // Hai sổ nói riêng — người nạp phải thấy dòng CHƯA OD đi đâu, không thì tưởng "mất dòng"
          const lines = [
            `Sổ OD: ${nf(r.od.rows)} dòng · ${nf(r.od.deliveries)} OD — thêm ${nf(r.od.inserted)} · sửa ${nf(r.od.updated)} · giữ nguyên ${nf(r.od.noop)}${r.od.obsoleted ? ` · SAP đã bỏ ${nf(r.od.obsoleted)}` : ''}`,
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
          setPf(null)
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
