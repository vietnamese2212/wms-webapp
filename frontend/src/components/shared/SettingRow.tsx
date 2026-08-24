import React from 'react'
import { InfoTip } from '@/components/shared/InfoTip'

/**
 * Khuôn trình bày SETTING chuẩn AppSheet (user chốt 24/08 — "mô phỏng cách trình bày AppSheet"):
 * - `SettingsGroup` = 1 NHÓM: band tiêu đề (vạch accent + IN HOA đậm màu) + các row ngăn vạch mảnh.
 * - `SettingRow`    = 1 SETTING: tên ĐẬM + diễn giải xám NHÌN THẤY NGAY (không giấu hết vào ⓘ —
 *   ⓘ chỉ dành cho chi tiết dài); control GỌN (toggle/chip/ô số) đứng bên PHẢI cùng hàng tên,
 *   control RỘNG (select/input dài) đứng DƯỚI diễn giải full-width. Nhiều dòng được, miễn đúng
 *   phong cách: mọi row cùng mép trái, không px lệch.
 * Áp cho MỌI form cấu hình (form Kho, tab Loại kho, Hệ thống, Kết nối ERP…) — đừng tự chế khung.
 */
export function SettingsGroup({ title, tip, children, className }: {
  title: React.ReactNode
  tip?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-md border border-slate-200 bg-white ${className ?? ''}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-md">
        <span className="h-3 w-1 rounded-full bg-sky-500 shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-sky-900 flex items-center gap-1 min-w-0">{title}</span>
        {tip ? <InfoTip tip={tip} /> : null}
      </div>
      <div className="px-2.5 divide-y divide-slate-100">{children}</div>
    </div>
  )
}

export function SettingRow({ label, desc, tip, control, children, htmlFor }: {
  label: React.ReactNode
  /** Diễn giải ngắn hiện NGAY dưới tên (xám nhỏ). Chi tiết dài để vào `tip`. */
  desc?: React.ReactNode
  tip?: React.ReactNode
  /** Control GỌN bên phải cùng hàng tên (Switch / chip / ô số hẹp). */
  control?: React.ReactNode
  /** Control RỘNG dưới diễn giải, full-width (select / input dài / khối con). */
  children?: React.ReactNode
  /** Có → tên thành <label> bấm được (toggle/checkbox). */
  htmlFor?: string
}) {
  const head = (
    <>
      <span className="flex items-center gap-1 text-xs font-semibold text-slate-800">{label}{tip ? <InfoTip tip={tip} /> : null}</span>
      {desc ? <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{desc}</p> : null}
    </>
  )
  return (
    <div className="py-2">
      <div className="flex items-start gap-3">
        {htmlFor
          ? <label htmlFor={htmlFor} className="flex-1 min-w-0 cursor-pointer">{head}</label>
          : <div className="flex-1 min-w-0">{head}</div>}
        {control ? <div className="shrink-0 flex items-center gap-1.5 pt-0.5">{control}</div> : null}
      </div>
      {children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  )
}
