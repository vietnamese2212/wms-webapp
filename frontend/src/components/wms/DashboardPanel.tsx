// Thẻ số dùng chung của Dashboard + Giám sát vận hành (11/2026, phong cách "trung tâm điều hành"): nhãn · số lớn · thanh % · dòng phụ.
// Khung khối dùng KpiPanel (KpiCharts.tsx). Phải nằm trong phần tử có lớp .kpi-console để nhận bộ màu --k-*.
// Thẻ MỚI ở các màn này dùng component này, không tự dựng lại.
import type { ReactNode } from 'react'

export type StatTone = 'ok' | 'warn' | 'bad'
const TONE_VAR: Record<StatTone, string> = { ok: 'var(--k-ok)', warn: 'var(--k-warn)', bad: 'var(--k-bad)' }

/** Số 8+ chữ số không được cắt (đọc SAI cấp nghìn/triệu) ⇒ co cỡ chữ theo độ dài. */
const valueSize = (s: string) => (s.length >= 10 ? 'text-lg' : s.length >= 8 ? 'text-[22px]' : 'text-[28px]')

export function StatCard({ label, value, unit, sub, pct, tone, title, twoLines, className = '' }: {
  label: ReactNode; value: string; unit?: ReactNode; sub?: ReactNode; pct?: number | null; tone?: StatTone; title?: string
  /** Hàng thẻ hẹp: giữ sẵn chỗ 2 dòng cho nhãn + dòng phụ từ 1280 trở lên, để chiều cao hàng không đổi theo cỡ màn. */
  twoLines?: boolean; className?: string
}) {
  const color = tone ? TONE_VAR[tone] : undefined
  return (
    <div className={`k-card flex flex-col gap-1.5 px-4 pb-3 pt-3.5 ${className}`} title={title}>
      <div className={`text-[13px] font-semibold leading-snug ${twoLines ? 'xl:min-h-[2.75em]' : ''}`}>{label}</div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className={`${valueSize(value)} font-semibold leading-none tabular-nums tracking-tight`} style={{ color }}>{value}</span>
        {unit && <span className="text-xs text-[var(--k-muted)]">{unit}</span>}
      </div>
      {pct != null && (
        <div className="h-1.5 rounded-full bg-[var(--k-line)]">
          <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color ?? 'var(--k-data)' }} />
        </div>
      )}
      {sub && <div className={`text-xs leading-snug text-[var(--k-muted)] ${twoLines ? 'xl:min-h-[2.75em]' : ''}`}>{sub}</div>}
    </div>
  )
}

/** Nền skeleton dùng chung (sáng/tối). */
export const DASH_SK = 'bg-slate-200 dark:bg-slate-700/50'
