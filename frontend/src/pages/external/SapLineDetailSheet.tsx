// Panel chi tiết MỘT dòng SAP (tab DO SAP · Chưa có OD) — bấm dòng là mở, trượt từ lề phải.
// User chốt 24/09: bảng chỉ giữ cột quan trọng (SO/PO · Sold-to · Ship-to · Tuyến · Ghi chú…), MỌI cột còn lại
// của ZSD02 (79 cột) đọc ở đây. Nguồn: cột riêng của sổ (so_number, route_name…) TRƯỚC, rồi tới `raw`
// (26 cột không có cột riêng: doanh số, còn lại chưa xuất, số hoá đơn, người duyệt…). Ô trống thì giấu dòng,
// không in 70 dấu "—".
import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatusBadge as ToneBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { formatDate, formatTimestampDate } from '@/utils/formatters'
import type { DoSapRow, SoLineRow } from '@/api/hooks'
import { FLOW_VI, DISPATCH_VI, SOURCE_VI, SO_STATUS_VI } from './sapLabels'

export type SapLine = DoSapRow | SoLineRow
type Rec = Record<string, unknown>

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 })

function DRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
      <span className="w-32 shrink-0 text-slate-400">{label}</span>
      <span className={`font-medium text-slate-700 break-words min-w-0 whitespace-pre-wrap ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
function Section({ title, rows }: { title: string; rows: (ReactNode | null)[] }) {
  const kept = rows.filter(Boolean)
  if (!kept.length) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{title}</p>
      <div>{kept}</div>
    </div>
  )
}

export function SapLineDetailSheet({ row, kind, onClose }: { row: SapLine | null; kind: 'od' | 'so'; onClose: () => void }) {
  const g = (row ?? {}) as Rec
  const raw = (g.raw ?? {}) as Rec
  // Cột riêng của sổ đứng trước, `raw` là dự phòng cho những gì sổ không có cột
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) { const v = g[k] ?? raw[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v }
    return null
  }
  const S = (label: string, ...keys: string[]) => { const v = pick(...keys); return v == null ? null : <DRow key={label} label={label} value={String(v)} /> }
  const M = (label: string, ...keys: string[]) => { const v = pick(...keys); return v == null ? null : <DRow key={label} label={label} value={String(v)} mono /> }
  const N = (label: string, unitKey: string | null, ...keys: string[]) => {
    const v = pick(...keys); if (v == null) return null
    const n = Number(String(v).replace(/,/g, '')); if (!Number.isFinite(n)) return <DRow key={label} label={label} value={String(v)} />
    const u = unitKey ? pick(unitKey) : null
    return <DRow key={label} label={label} value={<span className="tabular-nums">{nf.format(n)}{u ? <span className="text-slate-400 font-normal"> {String(u)}</span> : null}</span>} />
  }
  const D = (label: string, ...keys: string[]) => {
    const v = pick(...keys); if (v == null) return null
    const s = String(v)
    // ngày trong `raw` đã về 'YYYY-MM-DD' (BE), cột *_at của sổ là timestamp
    const text = /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : /^\d{4}-\d{2}-\d{2}T/.test(s) ? formatTimestampDate(s) : s
    return <DRow key={label} label={label} value={text} />
  }
  const badge = (label: string, code: unknown, map: Record<string, { label: string; tone: BadgeTone }>) => {
    if (code == null) return null
    const m = map[String(code)] ?? { label: String(code), tone: 'slate' as BadgeTone }
    return <DRow key={label} label={label} value={<ToneBadge tone={m.tone} title={String(code)}>{m.label}</ToneBadge>} />
  }

  const so = pick('so_number'), od = pick('od_number'), item = pick(kind === 'od' ? 'od_item' : 'so_item')
  const title = kind === 'od' ? `DO ${od ?? '—'} · Item ${item ?? '—'}` : `SO ${so ?? '—'} · Item ${item ?? '—'}`
  const src = String(pick('source') ?? '').toUpperCase()
  const shipToName = pick('ship_to_name'), regionName = raw.region != null ? String(raw.region) : null

  return (
    <Sheet open={!!row} onOpenChange={open => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        {row && (
          <>
            <SheetHeader className="px-4 py-3 border-b bg-slate-50 shrink-0">
              <div className="flex items-start justify-between gap-2 pr-6">
                <div className="min-w-0">
                  <SheetTitle className="text-sm font-mono break-all">{title}</SheetTitle>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{String(pick('material_code') ?? '')} {String(pick('material_name') ?? '')}</p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 bg-sky-100 text-sky-700">{SOURCE_VI[src] ?? (src || '—')}</span>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              <Section title="Đơn hàng SAP" rows={[
                M('SO/PO SAP', 'so_number'),
                S('Item SO', 'so_item'),
                M('Outbound Delivery', 'od_number'),
                kind === 'od' ? S('Item OD', 'od_item') : null,
                S('Loại SO/PO', 'so_type'),
                S('Item Category', 'item_category'),
                badge('Phân loại', pick('flow'), FLOW_VI),
                kind === 'so' ? badge('Trạng thái', pick('status'), SO_STATUS_VI) : null,
                S('Hệ thống đặt hàng', 'order_system'),
                S('Phương thức giao', 'delivery_method'),
                S('Lý do đơn', 'order_reason'),
                S('Trạng thái duyệt', 'approval_status'),
                S('Người duyệt', 'approver'),
                D('Thời gian duyệt', 'approved_at'),
                S('Trạng thái huỷ', 'cancel_reason', 'cancel_status'),
                D('Tạo SO', 'so_created_at', 'so_created'),
                D('Tạo OD', 'od_created_at', 'od_created'),
                S('Người tạo (SAP)', 'created_by'),
                D('Ngày tạo (SAP)', 'created_on'),
                D('Ngày giao', 'delivery_date'),
                M('Customer Reference', 'customer_ref'),
                D('Customer Ref. date', 'customer_ref_date'),
                M('Billing', 'billing_no', 'billing'),
                M('Số hoá đơn', 'invoice_no'),
                D('Billing date', 'billing_date'),
                D('Tạo Billing', 'billing_created'),
                M('Mat Doc', 'mat_doc'),
                M('Số IO', 'io_no'),
                M('Số Cont / Seal', 'cont_seal'),
                M('SO-Batch', 'batch_so', 'so_batch'),
              ]} />

              <Section title="Khách hàng · địa lý" rows={[
                pick('ship_to_code') != null ? <DRow key="shipto" label="Ship-to" value={<><span className="font-mono">{String(pick('ship_to_code'))}</span>{shipToName ? <span className="text-slate-500 font-normal"> — {String(shipToName)}</span> : null}</>} /> : null,
                M('Sold-to', 'sold_to_code'),
                S('Search Term', 'search_term'),
                S('Địa chỉ giao', 'address'),
                S('Phường', 'ward_code', 'ward'),
                regionName ? <DRow key="region" label="Tỉnh/TP" value={regionName} /> : S('Tỉnh/TP', 'region_code'),
                pick('route_code', 'route_name') != null ? <DRow key="route" label="Tuyến" value={<>{pick('route_code') ? <span className="font-mono">{String(pick('route_code'))}</span> : null}{pick('route_name') ? <span className="font-normal"> {pick('route_code') ? '— ' : ''}{String(pick('route_name'))}</span> : null}</>} /> : null,
                S('Khu vực bán', 'sales_district'),
                S('Sales Office', 'sales_office'),
                S('Sales Org', 'sales_org'),
                S('Kênh phân phối', 'dist_channel'),
                S('Sales Group', 'sales_group'),
                S('Division', 'division'),
              ]} />

              <Section title="Hàng · số lượng" rows={[
                M('Mã hàng', 'material_code'),
                S('Tên hàng', 'material_name'),
                pick('plant') != null ? <DRow key="plant" label="Plant" value={<>{String(pick('plant'))}{raw.plant_name ? <span className="text-slate-500 font-normal"> — {String(raw.plant_name)}</span> : null}</>} /> : null,
                pick('storage_location', 'sloc') != null ? <DRow key="sloc" label="Kho (Sloc)" value={<>{String(pick('storage_location', 'sloc'))}{raw.sloc_name ? <span className="text-slate-500 font-normal"> — {String(raw.sloc_name)}</span> : null}</>} /> : null,
                N('SL SO', 'sales_unit', 'qty_so_sales', 'so_qty'),
                N('SL SO (thùng)', null, 'qty_so_cartons', 'so_qty_car'),
                kind === 'od' ? N('SL OD', 'sales_unit', 'qty_sales', 'od_qty') : null,
                N('SL OD (thùng)', null, 'od_qty_car'),
                kind === 'od'
                  ? N('SL gốc (Base)', 'base_unit', 'qty_base')
                  : N('SL gốc (quy đổi)', 'base_unit', 'qty_so_base'),
                kind === 'od' ? N('Đã xuất (Base)', 'base_unit', 'qty_issued_base') : null,
                N('Đã xuất (ĐV bán)', 'sales_unit', 'issued_qty'),
                N('Đã xuất (thùng)', null, 'issued_car'),
                N('Còn lại chưa xuất', 'sales_unit', 'remain_qty'),
                N('Còn lại (thùng)', null, 'remain_car'),
                N('Chưa điều phối', 'sales_unit', 'undisp_qty'),
                N('Pallet SO', null, 'so_pallets'),
                N('Pallet đã ĐP', null, kind === 'od' ? 'sap_pallets' : 'od_pallets'),
                N('Pallet đã xuất', null, 'issued_pallets'),
                N('Pallet còn lại', null, 'remain_pallets'),
                N('M3 SO', null, 'so_m3'),
                N('M3 đã ĐP', null, kind === 'od' ? 'sap_m3' : 'od_m3'),
                N('M3 đã xuất', null, 'issued_m3'),
                N('M3 còn lại', null, 'remain_m3'),
                pick('gross_weight_kg') != null ? N('Khối lượng (kg)', null, 'gross_weight_kg') : null,
                N('Doanh số Gross', null, 'revenue_gross'),
                N('Doanh số NET', null, 'revenue_net'),
                pick('pct_date_req', 'date_pct') != null ? <DRow key="pct" label="Date (%)" value={`${String(pick('pct_date_req', 'date_pct'))} %`} /> : null,
                N('Date (ngày)', null, 'date_req', 'date_days'),
              ]} />

              <Section title="Vận tải (SAP điều phối)" rows={[
                pick('dvvt_code', 'dvvt_raw', 'dvvt') != null
                  ? <DRow key="dvvt" label="ĐVVT" value={<>{pick('dvvt_code') ? <span className="font-mono">{String(pick('dvvt_code'))}</span> : null}{pick('dvvt_raw', 'dvvt') ? <span className="text-slate-500 font-normal"> {pick('dvvt_code') ? '— ' : ''}{String(pick('dvvt_raw', 'dvvt'))}</span> : null}</>} />
                  : null,
                M('Biển số xe', 'license_plate', 'plate'),
                S('Tài xế', 'driver_name', 'driver'),
                badge('Điều phối xe', pick('sap_dispatch_status'), DISPATCH_VI),
              ]} />

              <Section title="Ghi chú" rows={[
                S('Giao hàng', 'note_delivery'),
                S('Hoá đơn', 'note_invoice'),
              ]} />

              <Section title="Trong app" rows={[
                kind === 'od' && g.in_plan != null ? <DRow key="plan" label="Kế hoạch xuất" value={g.in_plan ? <span className="font-mono">{String(g.plan_group_code ?? '')}{g.plan_export_date ? <span className="font-sans text-slate-500 font-normal"> · {formatDate(String(g.plan_export_date))}</span> : null}</span> : <span className="text-amber-700">Ngoài kế hoạch</span>} /> : null,
                kind === 'od' && g.used != null ? <DRow key="used" label="Chuyến Xuất" value={g.used ? 'Còn trong chuyến' : 'Không có chuyến'} /> : null,
                pick('sync_status') != null ? <DRow key="sync" label="Đồng bộ SAP" value={pick('sync_status') === 'OBSOLETE' ? <span className="text-red-600">SAP đã bỏ</span> : 'Đang có trong SAP'} /> : null,
                g.manual_edited_at ? <DRow key="man" label="Sửa tay" value={formatTimestampDate(String(g.manual_edited_at))} /> : null,
                S('Nạp bởi', 'uploaded_by'),
                D('Cập nhật', 'updated_at'),
              ]} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
