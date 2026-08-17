// Khuôn FORM CẤU HÌNH THAM SỐ (kiểu Blue Yonder — user chốt 13/08), dùng chung cho mọi trang
// cấu hình: Cài đặt WMS ▸ Hệ thống · Thông báo ▸ Cài đặt ngưỡng. Đặc điểm: cụm có band tiêu đề +
// vạch sky · NHÃN NẰM TRÊN Ô (không nhãn-trái/ô-phải — màn rộng sẽ hở cả gang tay ở giữa) ·
// DIỄN GIẢI nằm trong tooltip ⓘ cạnh nhãn, không phải đoạn văn dưới ô · chữ nhỏ, mật độ dày ·
// lưới nhiều cột (SETTINGS_GRID) để 6 cụm gói gọn 2 hàng.
//
// ⚠️ CÁC COMPONENT NÀY PHẢI Ở MODULE-LEVEL. Khai chúng trong body component cha (kiểu
// `function Tab() { const Group = (...) => (...) }`) khiến React thấy TYPE MỚI mỗi lần render →
// unmount/remount cả cụm → ô nhập MẤT FOCUS sau đúng 1 ký tự (bug thật 13/08, đo trên Preview:
// document.activeElement nhảy về BODY, ký tự thứ 2 rơi mất). Cổng tĩnh 09 gác luật này bằng
// ratchet `component_defined_inside_component`.
import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/shared/InfoTip'
import { formatDateTime } from '@/utils/formatters'

/** Lưới cụm cấu hình: 1 cột (phone) → 2 (tablet) → 3 (desktop) */
export const SETTINGS_GRID = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2'

/** Cụm cấu hình — band tiêu đề + vạch sky; `meta` in dấu vết ai sửa lần cuối (chỉ ≥lg) */
export function SettingGroup({ title, meta, readOnly, children }: {
  title: string
  meta?: { updated_by?: string | null; updated_at?: string }
  readOnly?: boolean
  children: ReactNode
}) {
  return (
    <section className="border border-slate-200 rounded-lg overflow-hidden bg-white h-full">
      <div className="flex items-center gap-1.5 bg-slate-100 border-b border-slate-200 px-2 py-1">
        <span className="w-1 h-3 bg-sky-500 rounded-sm shrink-0" />
        <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wide truncate">{title}</span>
        {meta?.updated_by && meta.updated_at && (
          <span className="ml-auto text-[9px] text-slate-400 whitespace-nowrap hidden lg:inline">
            {meta.updated_by} · {formatDateTime(meta.updated_at)}
          </span>
        )}
      </div>
      <div className={`px-2 py-2 space-y-2 ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>{children}</div>
    </section>
  )
}

/** Nhãn + ⓘ tooltip (diễn giải KHÔNG chiếm chỗ trong form) — ⓘ dùng chung `InfoTip` (mở được cả
 *  bằng chạm trên tablet/phone, xem ghi chú trong chính file đó) */
export function SettingLabel({ text, tip }: { text: string; tip?: ReactNode }) {
  return (
    <span className="flex items-center gap-1 mb-0.5">
      <span className="text-[10px] font-medium text-slate-700 truncate">{text}</span>
      {tip && <InfoTip tip={tip} className="[&>svg]:h-3 [&>svg]:w-3" />}
    </span>
  )
}

/** Một trường: nhãn (có tooltip) ở trên, control ở dưới */
export function SettingField({ label, tip, children }: { label: string; tip?: ReactNode; children: ReactNode }) {
  return <div><SettingLabel text={label} tip={tip} />{children}</div>
}

/** Ô SỐ: nhãn phụ 9px (khi xếp ngang nhiều ô), ô h-7, đơn vị bên phải */
export function SettingNum({ label, unit, value, onChange, min = 1, step }: {
  label?: string
  unit: string
  value: string
  onChange: (v: string) => void
  min?: number
  step?: number   // < 1 khi tham số nhận số lẻ (vd giờ công 7,5) — mặc định chỉ số nguyên
}) {
  return (
    <label className="block min-w-0">
      {label && <span className="block text-[9px] text-slate-500 mb-0.5 truncate">{label}</span>}
      <span className="flex items-center gap-1">
        <Input type="number" inputMode={step && step < 1 ? 'decimal' : 'numeric'} min={min} step={step} value={value}
          onChange={e => onChange(e.target.value)}
          className="h-7 w-full min-w-0 text-[11px] tabular-nums px-1.5" />
        <span className="text-[9px] text-slate-400 shrink-0">{unit}</span>
      </span>
    </label>
  )
}

/** Thanh Lưu dính đáy — stage thay đổi rồi mới áp dụng (đồng bộ mọi trang cấu hình) */
export function SettingSaveBar({ dirty, saving, onReset, onSave, extra }: {
  dirty: boolean
  saving: boolean
  onReset: () => void
  onSave: () => void
  extra?: ReactNode
}) {
  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2.5 flex items-center gap-3">
      <span className={`text-[11px] ${dirty ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
        {dirty ? '● Có thay đổi chưa lưu' : 'Đã lưu'}
      </span>
      <div className="ml-auto flex gap-2">
        {extra}
        <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={onReset}>Hoàn tác</Button>
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</Button>
      </div>
    </div>
  )
}
