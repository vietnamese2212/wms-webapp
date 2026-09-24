// Khối card của Dashboard (console kiểu Manhattan) — MỘT nguồn cho mọi tab.
// Trước 27/08 khối này khai trong Dashboard.tsx, tab Năng suất tự dựng lại header na ná nhưng
// thiếu icon ⇒ hai tab cạnh nhau trông khác nhau. Tab mới thêm PHẢI dùng component này.
import type { Package } from 'lucide-react'

export function DashPanel({ title, icon: Icon, extra, children, className = '' }: {
  title: string; icon: typeof Package; extra?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700 shrink-0 flex-wrap">
        <span className="w-1 h-3.5 rounded bg-sky-500 shrink-0" />
        <Icon className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</span>
        {extra}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

/** Ô KPI — cùng khuôn với các ô số của tab Tổng quan. */
export function DashTile({ icon: Icon, tone, label, value, sub, danger }: {
  icon: typeof Package; tone: string; label: string; value: string; sub?: string; danger?: boolean
}) {
  return (
    <div className="rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1">
        <Icon className={`h-3 w-3 ${tone}`} /> {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums leading-tight ${danger ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-slate-500">{sub}</div>}
    </div>
  )
}

/** Nền skeleton dùng chung (sáng/tối). */
export const DASH_SK = 'bg-slate-200 dark:bg-slate-700/50'
