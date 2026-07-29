import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { saveWorkbook } from '@/utils/saveExcel'
import type { UploadPreflight } from '@/api/hooks'

/**
 * BÁO CÁO "KIỂM TRƯỚC KHI GHI" — khuôn DÙNG CHUNG cho MỌI upload Excel (user chốt 29/07:
 * "upload xong file thì hiện lên các vấn đề của file đó với view 80% màn hình, và cho nút xác nhận
 * trước khi upload dữ liệu lên").
 *
 * Chỉ hiện DÒNG CÓ VẤN ĐỀ dạng bảng + số đếm cho phần hợp lệ (user chốt): payload nhẹ, file 8.600
 * dòng vẫn không chạm trần 4,5MB của Vercel.
 *
 * Đặt trong component cha có bố cục 80% màn hình (UploadExcelDialog / modal Xuất kho) — panel này
 * tự cuộn phần bảng, header số đếm + footer nút luôn thấy.
 */
export function UploadPreflightPanel({ report, fileName, busy, onCancel, onConfirm }: {
  report: UploadPreflight
  fileName?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [tab, setTab] = useState<'all' | 'err' | 'warn'>('all')
  const nErr = report.errors_total, nWarn = report.warnings_total
  const blocked = report.will_write === 0
  const allOrNothing = report.mode === 'all_or_nothing'

  // Dòng vấn đề: BE trả chuỗi "<khoá> — <lý do>" ở mọi controller (vd "dòng dữ liệu #14 — thiếu: kho").
  // Tách ở dấu " — " ĐẦU TIÊN để ra 2 cột; không khớp thì để nguyên 1 cột (không bao giờ mất chữ).
  const split = (s: string): [string, string] => {
    const i = s.indexOf(' — ')
    return i > 0 ? [s.slice(0, i), s.slice(i + 3)] : ['', s]
  }
  const issues: { kind: 'err' | 'warn'; at: string; msg: string }[] = [
    ...report.errors.map(e => { const [at, msg] = split(e); return { kind: 'err' as const, at, msg } }),
    ...report.warnings.map(w => { const [at, msg] = split(w); return { kind: 'warn' as const, at, msg } }),
  ]
  const shown = issues.filter(i => tab === 'all' || (tab === 'err' ? i.kind === 'err' : i.kind === 'warn'))

  async function downloadIssues() {
    const rows = issues.map(i => ({ 'Loại': i.kind === 'err' ? 'LỖI' : 'Cảnh báo', 'Ở đâu': i.at, 'Vấn đề': i.msg }))
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Loi upload')
    await saveWorkbook(wb, `loi_upload_${(fileName ?? 'file').replace(/\.[^.]+$/, '')}.xlsx`)
  }

  const Tile = ({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'err' | 'warn' }) => (
    <div className="px-3 py-1.5 rounded-md bg-white/10">
      <div className="text-[9px] uppercase tracking-wide text-sky-100/80 whitespace-nowrap">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${tone === 'err' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-green-300' : 'text-white'}`}>
        {typeof value === 'number' ? value.toLocaleString('vi-VN') : value}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col min-h-0 flex-1 gap-2">
      {/* Dải số đếm — đọc là biết file có gì và sẽ ghi gì */}
      <div className="bg-sky-800 rounded-lg px-2.5 py-2 flex flex-wrap gap-1.5 shrink-0">
        <Tile label={`Tổng ${report.unit}`} value={report.total} />
        <Tile label="Sẽ thêm" value={report.to_insert} tone="ok" />
        <Tile label="Sẽ cập nhật" value={report.to_update} tone="ok" />
        {report.skipped > 0 && <Tile label="Bỏ qua" value={report.skipped} tone="warn" />}
        <Tile label="Lỗi" value={nErr} tone={nErr ? 'err' : undefined} />
        {nWarn > 0 && <Tile label="Cảnh báo" value={nWarn} tone="warn" />}
        {report.extra.map(x => <Tile key={x.label} label={x.label} value={x.value} tone={x.warn ? 'warn' : undefined} />)}
      </div>

      {/* Kết luận: bấm Xác nhận thì ĐIỀU GÌ xảy ra */}
      {blocked ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex gap-2 shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {nErr > 0 && allOrNothing
              ? <><b>Kiểu nhập: TẤT CẢ HOẶC KHÔNG GÌ.</b> File còn {nErr.toLocaleString('vi-VN')} lỗi nên sẽ KHÔNG ghi {report.unit} nào — sửa file rồi kiểm lại.</>
              : nErr > 0
                ? <>File còn {nErr.toLocaleString('vi-VN')} lỗi và không có {report.unit} nào ghi được.</>
                : <>Không có {report.unit} nào để ghi (file không tạo ra thay đổi nào).</>}
          </span>
        </div>
      ) : (
        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex gap-2 shrink-0">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Bấm <b>Xác nhận</b> sẽ ghi <b>{report.will_write.toLocaleString('vi-VN')} {report.unit}</b>
            {report.to_update > 0 && <> (trong đó {report.to_update.toLocaleString('vi-VN')} {report.unit} ĐÃ CÓ sẽ bị cập nhật/ghi đè)</>}
            {report.skipped > 0 && <> · bỏ qua {report.skipped.toLocaleString('vi-VN')}</>}
            {nWarn > 0 && <> · {nWarn.toLocaleString('vi-VN')} cảnh báo bên dưới không chặn ghi</>}
            . Chưa có gì được ghi cho tới khi bạn bấm.
          </span>
        </div>
      )}

      {/* Chip lọc + bảng vấn đề */}
      {issues.length > 0 ? (
        <>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {([['all', `Tất cả vấn đề ${issues.length}`], ['err', `Lỗi ${nErr}`], ['warn', `Cảnh báo ${nWarn}`]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`h-6 px-2 rounded-full text-[10px] font-medium border ${tab === k
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {lbl}
              </button>
            ))}
            <Button size="sm" variant="outline" onClick={downloadIssues} className="h-6 px-2 text-[10px] gap-1 ml-auto">
              <Download className="h-3 w-3" />Tải danh sách lỗi
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto border rounded-lg">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 sticky top-0">
                  <th className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 uppercase w-20 whitespace-nowrap">Loại</th>
                  <th className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 uppercase w-48 whitespace-nowrap">Ở đâu</th>
                  <th className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 uppercase">Vấn đề</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i, k) => (
                  <tr key={k} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${i.kind === 'err' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {i.kind === 'err' ? 'LỖI' : 'Cảnh báo'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-[10px] font-mono text-slate-600">{i.at || <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1 text-[10px] text-slate-700">{i.msg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(nErr > report.errors.length || nWarn > report.warnings.length) && (
            <p className="text-[10px] text-slate-500 shrink-0">
              Hiện {report.errors.length + report.warnings.length} vấn đề đầu trong {(nErr + nWarn).toLocaleString('vi-VN')} — sửa lượt này rồi kiểm lại để thấy phần còn lại.
            </p>
          )}
        </>
      ) : (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-4 text-xs text-slate-600 flex items-center gap-2 shrink-0">
          <Info className="h-4 w-4 shrink-0" />File không có lỗi hay cảnh báo nào.
        </div>
      )}

      {/* Footer nút — luôn thấy */}
      <div className="flex items-center gap-2 shrink-0 pt-1 border-t">
        <span className="text-[10px] text-slate-400 truncate">{fileName}</span>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy} className="h-8 text-xs ml-auto">Huỷ</Button>
        <Button size="sm" onClick={onConfirm} disabled={busy || blocked} className="h-8 text-xs gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? 'Đang ghi…' : blocked ? 'Không thể nhập' : `Xác nhận nhập ${report.will_write.toLocaleString('vi-VN')} ${report.unit}`}
        </Button>
      </div>
    </div>
  )
}
