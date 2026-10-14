import React from 'react'
import { InfoTip } from './InfoTip'

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

export function SummaryBand({ tiles, className, compact, inline }: { tiles: BandTile[]; className?: string; compact?: boolean; inline?: boolean }) {
  // INLINE (14/10, bàn ghép xe): dải đứng CHUNG HÀNG với cụm nút đầu trang — một hàng ở MỌI cỡ màn (không lưới điện thoại), bo góc.
  // Máy tính: các ô CHIA ĐỀU bề rộng được cấp (màn 24" ô rộng, 1280 ô hẹp) — cùng một bố cục ở mọi màn (user 14/10: "màn 24 inch hiển
  // thị khác, phải đồng bộ với các loại màn hình"); chật thì chỉ NHÃN bị cắt "…" (rê chuột xem đủ), CON SỐ không bao giờ cắt — nhãn
  // `sm:w-0 sm:min-w-full` không góp bề rộng tối thiểu của ô, nên ô co tới đúng bề rộng con số. Điện thoại: ô rộng theo nhãn, khung ngoài
  // cuộn ngang. ⓘ chỉ trên màn cảm ứng (dưới sm) — máy tính rê chuột đọc `title`.
  if (inline) return (
    <div className={`flex divide-x divide-white/15 bg-sky-800 text-white rounded-md ${className ?? ''}`}>
      {tiles.map((t, i) => (
        // chia bề rộng THEO ĐỘ DÀI NHÃN (không chia đều): đo 1280 chia đều thì "Vượt tải" / "Khung chờ" / "OD trên xe" bị cắt trong khi ô
        // "Tấn" thừa chỗ — theo độ dài nhãn thì 1280 có sidebar đọc đủ cả 10 nhãn; con số rộng (Σ cước kèm Δ) tự giữ bề rộng tối thiểu
        <div key={i} title={t.tip ? `${t.label} — ${t.tip}` : t.label} style={{ flexGrow: Math.max(3, t.label.length), flexBasis: 0 }}
          className="flex flex-col justify-between text-center px-1.5 py-0.5">
          <div className="sm:w-0 sm:min-w-full text-[9px] font-medium uppercase tracking-wider text-sky-200/90 leading-tight flex items-center justify-center gap-0.5 whitespace-nowrap">
            <span className="min-w-0 truncate">{t.label}</span>
            {t.tip && (
              <span className="sm:hidden shrink-0 [&_button]:text-sky-200/70 [&_button:hover]:text-white [&_svg]:h-3 [&_svg]:w-3" onClick={e => e.stopPropagation()}>
                <InfoTip tip={t.tip} />
              </span>
            )}
          </div>
          <div className={`text-xs font-semibold leading-tight tabular-nums whitespace-nowrap ${t.danger ? 'text-red-300' : t.accent ? 'text-amber-300' : 'text-white'}`}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  )
  // Mobile (đợt UI 24/08): LƯỚI kín hàng theo SỐ Ô — 1 ô = full, 2/4 ô = 2 cột, còn lại 3 cột —
  // mọi ô hiện đủ, KHÔNG cuộn ngang, KHÔNG ô trống, hết cảnh nhãn cắt cụt "SL (QUY Đ…".
  // Desktop giữ flex 1 hàng chia vạch như cũ.
  const cols = tiles.length === 1 ? 1 : (tiles.length === 2 || tiles.length === 4) ? 2 : 3
  const mCols = cols === 1 ? 'grid-cols-1'
    : cols === 2 ? 'grid-cols-2 [&>div:nth-child(2n)]:border-r-0'
    : 'grid-cols-3 [&>div:nth-child(3n)]:border-r-0'
  // Ô LẺ Ở HÀNG CUỐI (rà điện thoại 12/09): 5 ô / 7 ô / 8 ô chia 3 cột thì hàng cuối hở 1–2 ô
  // xanh trống trơn — trông như dải bị cắt dở. Ô cuối GIÃN RA lấp nốt phần thừa.
  const rem = tiles.length % cols
  const lastSpan = rem === 0 ? 0 : cols - rem + 1
  // Từ 3 hàng trở lên (7–9 ô) dải ăn hơn 100 px của màn điện thoại — bóp đệm dọc lại để bảng còn
  // chỗ thở (Nhập kho 7 ô: dòng dữ liệu đầu tiên từ y=382 xuống còn ~343).
  const tight = tiles.length > cols * 2
  return (
    <div className={`grid ${mCols} [&>div:last-child]:border-r-0 sm:flex sm:divide-x sm:divide-white/15 bg-sky-800 text-white sm:overflow-x-auto no-scrollbar shrink-0 ${className ?? ''}`}>
      {tiles.map((t, i) => (
        // Màn nhỏ (PDA/phone) tự COMPACT để nhường chỗ cho bảng; desktop giữ cỡ đầy. compact=true ép nhỏ mọi cỡ.
        // flex-col + justify-between: nhãn dài XUỐNG DÒNG trên điện thoại (không cắt cụt) mà các CON SỐ
        // trong cùng một hàng vẫn thẳng đáy với nhau. Desktop vẫn truncate 1 dòng như cũ.
        <div key={i} title={t.tip ?? t.label}
          style={lastSpan && i === tiles.length - 1 ? { gridColumn: `span ${lastSpan}` } : undefined}
          className={`sm:flex-1 min-w-0 sm:min-w-[84px] flex flex-col justify-between text-center border-white/10 border-b border-r sm:!border-0 ${compact ? 'px-2 py-0.5 sm:px-3' : `px-2 ${tight ? 'py-0.5' : 'py-1'} sm:px-3 sm:py-1.5`}`}>
          {/* Diễn giải = ⓘ bấm được (rà 21/09): `title=` chỉ hiện khi rê chuột, điện thoại không có chuột nên
              "SL (quy đổi)" đứng đó không ai giải nghĩa được; InfoTip dưới sm mở tấm trượt đáy. Vẫn giữ title cho desktop. */}
          <div className="text-[9px] font-medium uppercase tracking-wider text-sky-200/90 leading-tight flex items-center justify-center gap-0.5 min-w-0">
            <span className="sm:truncate min-w-0">{t.label}</span>
            {t.tip && (
              <span className="shrink-0 [&_button]:text-sky-200/70 [&_button:hover]:text-white [&_svg]:h-3 [&_svg]:w-3" onClick={e => e.stopPropagation()}>
                <InfoTip tip={t.tip} />
              </span>
            )}
          </div>
          <div className={`font-semibold leading-tight tabular-nums whitespace-nowrap ${compact ? 'text-xs' : 'text-xs sm:text-base'} ${t.danger ? 'text-red-300' : t.accent ? 'text-amber-300' : 'text-white'}`}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  )
}
