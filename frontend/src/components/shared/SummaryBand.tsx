import React from 'react'

/**
 * SummaryBand — dải tile tổng hợp kiểu Manhattan SCALE Insight
 * (vd: "Items 261 | Locations 3.7k | License plates 163 | Lots 84").
 * Dải xanh full-width, mỗi tile = nhãn nhỏ in hoa + số lớn, ngăn nhau bằng vạch mảnh.
 * Responsive: cuộn ngang trên màn hẹp (min-w mỗi tile).
 */
export interface BandTile {
  label: string
  value: React.ReactNode
  accent?: boolean   // tô số bằng màu nổi (vd tổng quan trọng)
}

export function SummaryBand({ tiles, className, compact }: { tiles: BandTile[]; className?: string; compact?: boolean }) {
  return (
    <div className={`flex divide-x divide-white/15 bg-sky-800 text-white overflow-x-auto no-scrollbar shrink-0 ${className ?? ''}`}>
      {tiles.map((t, i) => (
        <div key={i} className={`flex-1 min-w-[84px] text-center ${compact ? 'px-3 py-0.5' : 'px-3 py-1.5'}`}>
          <div className="text-[9px] font-medium uppercase tracking-wider text-sky-200/90 truncate">{t.label}</div>
          <div className={`font-semibold leading-tight tabular-nums ${compact ? 'text-xs' : 'text-base'} ${t.accent ? 'text-amber-300' : 'text-white'}`}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  )
}
