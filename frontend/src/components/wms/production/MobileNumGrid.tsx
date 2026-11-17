// LƯỚI SỐ cho danh sách ĐIỆN THOẠI của các màn MES (user 17/11: "hạn chế dùng văn viết").
// Thay câu "Cần 50 kilogram · đã cấp 0 kilogram / Thiếu 50 kilogram kho còn 150 kilogram" bằng bảng thu nhỏ: nhãn cột in MỘT lần
// ở đầu danh sách (dính đầu khi cuộn), mỗi dòng: dòng trên là mã + tên + ĐVT, dòng dưới chỉ CON SỐ, thẳng cột với nhãn.
// `asideClass` = bề rộng cột bên phải (nút Cấp / ô nhập) — truyền cùng một giá trị cho đầu và cho từng dòng để số thẳng cột.
// `template` (18/11) = khuôn cột riêng (CSS grid-template-columns) khi một cột cần rộng hơn — vd cột "Cần" của bàn mẻ mang thêm
// "gốc …" cùng hàng (user: "các số cùng 1 hàng, gốc không cho xuống hàng"). Truyền CÙNG giá trị cho đầu và từng dòng.
import type { ReactNode } from 'react'

export interface NumCol { label: string; title?: string }

const gridStyle = (n: number, template?: string) => ({ gridTemplateColumns: template ?? `repeat(${n}, minmax(0, 1fr))` })

export function MobileNumHead({ cols, asideClass, asideLabel, template }: { cols: NumCol[]; asideClass?: string; asideLabel?: string; template?: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-end gap-2 px-3 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-medium text-slate-500">
      <div className="flex-1 min-w-0 grid gap-x-1.5" style={gridStyle(cols.length, template)}>
        {cols.map(c => <span key={c.label} className="text-right truncate" title={c.title}>{c.label}</span>)}
      </div>
      {asideClass && <div className={`shrink-0 text-right ${asideClass}`}>{asideLabel}</div>}
    </div>
  )
}

/** Một dòng: `head` (mã · tên · ĐVT · nhãn ngắn) ở trên, các ô số thẳng cột với MobileNumHead ở dưới, `aside` (nút / ô nhập) bên phải */
export function MobileNumRow({ head, cells, aside, asideClass, className, template }: {
  head: ReactNode; cells: ReactNode[]; aside?: ReactNode; asideClass?: string; className?: string; template?: string
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 ${className ?? ''}`}>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 min-w-0 text-xs">{head}</div>
        {/* ô số KHÔNG nhận sàn chạm 44 px (.touch-target trên máy cảm ứng): nút trong ô (vd số Tồn kho bấm xem tồn) cao 44 px ⇒ cả
            hàng cao ra và số đó tụt xuống dưới các số khác (user 18/11 "cho các số cùng 1 hàng") — gỡ ở đây cho mọi màn dùng lưới này */}
        <div data-numrow className="grid gap-x-1.5 text-xs font-semibold tabular-nums [&_.touch-target]:!min-h-0 [&_.touch-target]:!min-w-0" style={gridStyle(cells.length, template)}>
          {cells.map((c, i) => <div key={i} className="text-right min-w-0 truncate">{c}</div>)}
        </div>
      </div>
      {asideClass && <div className={`shrink-0 flex justify-end ${asideClass}`}>{aside}</div>}
    </div>
  )
}
