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
  accent?: boolean   // tô số bằng màu nổi (amber — vd tổng quan trọng)
  danger?: boolean   // tô số đỏ (cảnh báo, vd thiếu dữ liệu)
  tip?: string       // giải thích ý nghĩa con số khi nhãn ngắn dễ hiểu sai (vd "thùng quy đổi")
}

export function SummaryBand({ tiles, className, compact }: { tiles: BandTile[]; className?: string; compact?: boolean }) {
  return (
    // Mobile (đợt UI 24/08): LƯỚI 3 CỘT — mọi ô hiện đủ trong 1-2 hàng, KHÔNG cuộn ngang, hết
    // cảnh nhãn cắt cụt "SL (QUY Đ…". Desktop giữ flex 1 hàng chia vạch như cũ.
    <div className={`grid grid-cols-3 sm:flex sm:divide-x sm:divide-white/15 bg-sky-800 text-white sm:overflow-x-auto no-scrollbar shrink-0 ${className ?? ''}`}>
      {tiles.map((t, i) => (
        // Màn nhỏ (PDA/phone) tự COMPACT để nhường chỗ cho bảng; desktop giữ cỡ đầy. compact=true ép nhỏ mọi cỡ.
        // title fallback = label: nhãn dài hiếm hoi vẫn truncate → đọc được khi giữ tay/hover
        <div key={i} title={t.tip ?? t.label}
          className={`sm:flex-1 min-w-0 sm:min-w-[84px] text-center border-white/10 border-b [&:nth-child(3n)]:border-r-0 border-r sm:border-0 ${compact ? 'px-2 py-0.5 sm:px-3' : 'px-2 py-1 sm:px-3 sm:py-1.5'}`}>
          <div className="text-[9px] font-medium uppercase tracking-wider text-sky-200/90 truncate">{t.label}</div>
          <div className={`font-semibold leading-tight tabular-nums whitespace-nowrap ${compact ? 'text-xs' : 'text-xs sm:text-base'} ${t.danger ? 'text-red-300' : t.accent ? 'text-amber-300' : 'text-white'}`}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  )
}
