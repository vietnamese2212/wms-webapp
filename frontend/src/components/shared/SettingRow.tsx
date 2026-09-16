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
/**
 * KHU VỰC của một nhóm cấu hình (user chốt 16/09: "đưa các hạng mục setting giống nhau về 1 khu vực —
 * rule phải là theo khu vực kể cả khi xoá, thêm mới"). Nhóm nào thuộc khu vực nào khai bằng `area`,
 * nhãn tiền tố ("XUẤT — ") in TỪ ĐÂY chứ không gõ tay trong `title` — một chỗ đổi chữ, và cổng tĩnh
 * `settings_area_interleaved` đọc đúng thuộc tính này để bắt nhóm XUẤT lạc xuống giữa/sau nhóm NHẬP
 * (đo 16/09: "Quy định date theo khách hàng" của XUẤT nằm cuối form Kho, sau hai nhóm NHẬP).
 * Thứ tự khu vực trong MỌI form: XUẤT rồi NHẬP.
 */
export type SettingsArea = 'XUẤT' | 'NHẬP'
export const SETTINGS_AREA_ORDER: readonly SettingsArea[] = ['XUẤT', 'NHẬP']

export function SettingsGroup({ title, tip, children, className, area }: {
  title: React.ReactNode
  tip?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Khu vực nghiệp vụ — in tiền tố "XUẤT — " / "NHẬP — " và là khoá để cổng tĩnh giữ các nhóm cùng khu đứng liền nhau */
  area?: SettingsArea
}) {
  return (
    <div className={`rounded-md border border-slate-200 bg-white ${className ?? ''}`} data-settings-area={area}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-md">
        <span className="h-3 w-1 rounded-full bg-sky-500 shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-sky-900 flex items-center gap-1 min-w-0">
          {area ? <>{area} — </> : null}{title}
        </span>
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
