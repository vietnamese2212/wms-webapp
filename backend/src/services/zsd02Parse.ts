// zsd02Parse — bộ đọc báo cáo SAP ZSD02 (mức dòng SO/OD, 79 cột) thành 2 SỔ: sổ OD (`erp_outbound_orders`,
// cùng khoá + cùng nghĩa số lượng với VL06O) và sổ SO (`erp_so_lines`, dòng CHƯA có OD). Hàm THUẦN — không DB,
// không Express — để test chạy trên chính file mẫu (tests/unit/zsd02Parse.test.ts). Plan: docs/plans/TMS_DISPATCH_PLAN.md.
//
// LUẬT SỐ LƯỢNG (user nhấn 22/09 — "đặc biệt chú ý số lượng và đơn vị, có OD và chưa OD là khác nhau"):
//   • Dòng CÓ OD: qty_base = "OD Qty (Base Unit)" — số DUY NHẤT để tính, y hệt "Actual delivery qty" của VL06O.
//     "OD Qty" + "Sales unit" chỉ để kiểm chéo hệ số (cảnh báo theo mã như VL06O đang làm).
//   • Dòng CHƯA OD: SAP để "OD Qty (Base Unit)" = 0 ở 100 % dòng ⇒ KHÔNG BAO GIỜ vào sổ OD (0 sẽ bị reconcile
//     hiểu là "SAP nói 0" và hạ cartons_ordered). Base của nó là số DẪN XUẤT theo 3 bậc: đơn vị bán = base
//     (Hộp/Cái/kg) → chính số SO · Thùng → hệ số quan sát từ dòng CÓ OD cùng mã trong file → units_per_carton
//     của master · hết → NULL + cờ qty_unresolved (KHÔNG đoán). Cờ qty_base_derived/derive_source đi kèm.
//   • Sales unit ghi CHỮ (Thùng/Hộp/Cái/kg) → quy nhãn qua utils/sapUnits TRƯỚC khi so với Material master.
//   • Gross Weight = GRAM → kg. SAP pallet/m3 chỉ tham chiếu; tải thật tính bằng utils/loadCalc từ master.
import type { FieldDef } from '../utils/excelHeader'
import { cellStr, cellNum, parseExcelDate } from '../utils/excelCells'
import { normSalesUnit, normBaseUnit, sapCodeOf, normDvvt, gramsToKg, normDispatchStatus } from '../utils/sapUnits'
import { hasEntry } from '../utils/qtyUnits'
import { loadOf, type LoadMat } from '../utils/loadCalc'
import type { Database, Json } from '../types/database'

export const FLOWS = ['SALE', 'STO', 'INTERNAL', 'RETURN', 'DISCOUNT', 'PALLET', 'UNKNOWN'] as const
export type Flow = typeof FLOWS[number]
/** flow được LÊN XE (Kế hoạch xuất / engine ghép). RETURN = chiều về, DISCOUNT = tải 0, UNKNOWN = chưa khai map. */
export const LOADABLE_FLOWS: ReadonlySet<string> = new Set<Flow>(['SALE', 'STO', 'INTERNAL', 'PALLET'])
export const isFlow = (v: unknown): v is Flow => (FLOWS as readonly string[]).includes(String(v))

// Map theo TÊN cột (parseSheetByHeader chuẩn hoá bỏ dấu/ký tự lạ) — chịu đảo cột, đổi nhãn nhẹ.
// `required` = thiếu là CHẶN cả file. "Outbound Delivery" KHÔNG bắt buộc (dòng chưa OD để trống).
export const ZSD02_FIELDS: FieldDef[] = [
  { key: 'so_number',     label: 'SO/ PO SAP',                         aliases: ['SO PO SAP', 'Sales Order', 'SO'], required: true },
  { key: 'od_number',     label: 'Outbound Delivery',                  aliases: ['OD', 'Delivery'] },
  { key: 'item',          label: 'Item',                               aliases: ['SO Item', 'Item No'], required: true },
  { key: 'material',      label: 'Material',                           aliases: ['Mã hàng', 'Material Code'], required: true },
  { key: 'material_name', label: 'Material Description',               aliases: ['Tên hàng', 'Item Description'] },
  { key: 'plant',         label: 'Plant',                              aliases: ['Nhà máy'], required: true },
  { key: 'sloc',          label: 'Sloc',                               aliases: ['Storage Location'] },
  { key: 'sales_unit',    label: 'Sales unit',                         aliases: ['Sales Unit', 'Đơn vị bán'], required: true },
  { key: 'so_qty',        label: 'SO Qty/ SL SO',                      aliases: ['SO Qty', 'SL SO'], required: true },
  { key: 'so_qty_car',    label: 'SO Qty CAR/ SL SO THÙNG',            aliases: ['SO Qty CAR', 'SL SO THÙNG'] },
  { key: 'od_qty',        label: 'OD Qty',                             aliases: ['Delivery Quantity'] },
  { key: 'od_qty_car',    label: 'OD Qty CAR/ SL THÙNG đã điều phối',  aliases: ['OD Qty CAR'] },
  { key: 'od_qty_base',   label: 'OD Qty (Base Unit)',                 aliases: ['Actual delivery qty', 'OD Qty Base Unit'], required: true },
  { key: 'so_qty_base',   label: 'SO Qty (Base Unit)',                 aliases: ['SO Qty Base Unit'] },   // cột SAP CHƯA có — parser ưu tiên khi xuất hiện
  { key: 'base_unit',     label: 'Base Unit',                          aliases: ['Base Unit of Measure', 'Đơn vị gốc'], required: true },
  { key: 'issued_qty',    label: 'Số lượng đã xuất / nhập',            aliases: ['Số lượng đã xuất', 'Issued Qty'] },
  { key: 'undisp_qty',    label: 'Số lượng còn lại chưa điều phối',    aliases: ['Chưa điều phối'] },
  { key: 'delivery_date', label: 'Delivery date',                      aliases: ['Ngày giao', 'Ngày giao hàng'], required: true },
  { key: 'so_type',       label: 'SO/ PO type',                        aliases: ['SO Type', 'Loại SO'], required: true },
  { key: 'item_category', label: 'Item Category',                      aliases: ['Item Cat'] },
  { key: 'ship_to_code',  label: 'Ship to code',                       aliases: ['Ship-to Party', 'Ship to'], required: true },
  { key: 'ship_to_name',  label: 'Ship to name',                       aliases: ['Name ship-to party', 'Tên ship-to'] },
  { key: 'sold_to_code',  label: 'Sold to code',                       aliases: ['Sold-to Party'] },
  { key: 'search_term',   label: 'Search Term 1',                      aliases: ['Search Term'] },
  { key: 'address',       label: 'Địa chỉ giao hàng',                  aliases: ['Address', 'Địa chỉ'] },
  { key: 'ward',          label: 'Tên Phường',                         aliases: ['Phường', 'Ward'] },
  { key: 'region',        label: 'Region/ Tỉnh.TP',                    aliases: ['Region', 'Tỉnh TP'] },
  { key: 'route_name',    label: 'Route/ Tuyến giao hàng',             aliases: ['Route', 'Tuyến giao hàng'] },
  { key: 'route_code',    label: 'Mã Route',                           aliases: ['Route Code'] },
  { key: 'sales_district',label: 'Sales District/ Khu vực bán hàng',   aliases: ['Sales District', 'Khu vực bán hàng'] },
  { key: 'sales_office',  label: 'Sales Office',                       aliases: [] },
  { key: 'sales_org',     label: 'Sales Organization',                 aliases: ['Sales Org'] },
  { key: 'dist_channel',  label: 'Distribution Channel',               aliases: ['Channel'] },
  { key: 'driver',        label: 'Tên tài xế',                         aliases: ['Tài xế', 'Driver'] },
  { key: 'plate',         label: 'Biển số xe',                         aliases: ['Biển số', 'License Plate'] },
  { key: 'dispatch',      label: 'Trạng thái điều phối xe',            aliases: ['Trạng thái điều phối', 'Dispatch Status'] },
  { key: 'dvvt',          label: 'Đơn vị vận chuyển',                  aliases: ['ĐVVT', 'DVVT', 'Carrier'] },
  { key: 'so_batch',      label: 'SO -Batch',                          aliases: ['SO Batch', 'Batch SO'] },
  { key: 'note_delivery', label: 'Ghi chú giao hàng',                  aliases: ['Delivery Note'] },
  { key: 'note_invoice',  label: 'Ghi chú hóa đơn',                    aliases: ['Ghi chú hoá đơn', 'Invoice Note'] },
  { key: 'customer_ref',  label: 'Customer Reference',                 aliases: ['PO khách'] },
  { key: 'billing',       label: 'Billing',                            aliases: ['Billing Doc'] },
  { key: 'mat_doc',       label: 'Mat Doc',                            aliases: ['Material Document'] },
  { key: 'cancel_status', label: 'Trạng thái hủy đơn',                 aliases: ['Trạng thái huỷ đơn', 'Cancel Status'] },
  { key: 'approval',      label: 'Trạng thái duyệt đơn',               aliases: ['Approval Status'] },
  { key: 'so_created',    label: 'Thời gian tạo SO',                   aliases: ['SO Created'] },
  { key: 'od_created',    label: 'Thời gian tạo OD',                   aliases: ['OD Created'] },
  { key: 'so_pallets',    label: 'SL SO PALLET',                       aliases: ['SO Pallet'] },
  { key: 'od_pallets',    label: 'SL PALLET đã điều phối',             aliases: ['OD Pallet'] },
  { key: 'so_m3',         label: 'SL SO M3',                           aliases: ['SO M3'] },
  { key: 'od_m3',         label: 'SL M3 đã điều phối',                 aliases: ['OD M3'] },
  { key: 'gross_weight',  label: 'Gross Weight',                       aliases: ['Trọng lượng', 'Weight'] },
  { key: 'date_pct',      label: 'Date (%)',                           aliases: ['Date pct', '%Date'] },
  { key: 'date_days',     label: 'Date (Ngày)',                        aliases: ['Date days'] },
  // ── 26 cột KHÔNG có cột riêng trong sổ — chỉ sống trong `raw` (panel chi tiết dòng đọc từ đó). Khai để
  // `parseSheetByHeader` giữ lại: bộ đọc chỉ dựng object từ cột ĐÃ MAP, cột không khai là mất hẳn khỏi `raw`
  // (đo 24/09: 54/79 header được khai, "Số lượng còn lại chưa xuất / nhập"… rơi mất dù plan hứa "nằm trong raw").
  { key: 'division',      label: 'Division',                           aliases: [] },
  { key: 'order_system',  label: 'Hệ thống đặt hàng',                  aliases: ['Order System'] },
  { key: 'customer_ref_date', label: 'Customer Reference date',        aliases: [] },
  { key: 'plant_name',    label: 'Plant Description',                  aliases: ['Tên nhà máy'] },
  { key: 'sloc_name',     label: 'Sloc Description',                   aliases: [] },
  { key: 'issued_car',    label: 'SL THÙNG đã xuất / nhập',            aliases: [] },
  { key: 'remain_qty',    label: 'Số lượng còn lại chưa xuất / nhập',  aliases: [] },
  { key: 'remain_car',    label: 'Số lượng THÙNG còn lại chưa xuất / nhập', aliases: [] },
  { key: 'delivery_method', label: 'Phương thức giao hàng',            aliases: ['Shipping Condition'] },
  { key: 'invoice_no',    label: 'Số hóa đơn',                         aliases: ['Số hoá đơn', 'Invoice No'] },
  { key: 'billing_date',  label: 'Billing date',                       aliases: [] },
  { key: 'order_reason',  label: 'Order reason/Lý do đơn',             aliases: ['Order reason', 'Lý do đơn'] },
  { key: 'created_by',    label: 'Created by',                         aliases: [] },
  { key: 'created_on',    label: 'Created on',                         aliases: [] },
  { key: 'approved_at',   label: 'Thời gian duyệt đơn',                aliases: [] },
  { key: 'billing_created', label: 'Thời gian tạo Billing',            aliases: [] },
  { key: 'issued_pallets', label: 'SL PALLET đã xuất / nhập',          aliases: [] },
  { key: 'remain_pallets', label: 'Số lượng PALLET còn lại chưa xuất / nhập', aliases: [] },
  { key: 'issued_m3',     label: 'SL M3 đã xuất / nhập',               aliases: [] },
  { key: 'remain_m3',     label: 'Số lượng M3 còn lại chưa xuất / nhập', aliases: [] },
  { key: 'revenue_gross', label: 'Doanh số Gross',                     aliases: [] },
  { key: 'revenue_net',   label: 'Doanh số NET',                       aliases: [] },
  { key: 'io_no',         label: 'Số IO',                              aliases: [] },
  { key: 'cont_seal',     label: 'Số Cont/ Số Seal',                   aliases: ['Số Cont', 'Số Seal'] },
  { key: 'approver',      label: 'Người duyệt đơn hàng',               aliases: ['Người duyệt'] },
  { key: 'sales_group',   label: 'Sales Group',                        aliases: [] },
]
export const ZSD02_REQUIRED_LABELS = ZSD02_FIELDS.filter(f => f.required).map(f => f.label)
/** Cột NGÀY trong `raw` — Excel cho serial (45912) nên chuẩn về 'YYYY-MM-DD' trước khi lưu, panel chi tiết in thẳng được. */
export const ZSD02_RAW_DATE_KEYS = ['delivery_date', 'so_created', 'od_created', 'customer_ref_date', 'billing_date', 'created_on', 'approved_at', 'billing_created'] as const

export type Zsd02Mat = LoadMat & { material_code: string; short_name?: string | null }
export interface Zsd02Ctx {
  mats: Map<string, Zsd02Mat>                    // material_code → master (chỉ mã có trong file)
  flowMap: Map<string, Flow>                     // mã SAP (item_category / so_type) → flow — từ LookupValue sap_flow_map
  dvvtResolve: (norm: string) => string | null   // normDvvt(tên/mã trong file) → TransportCompany.code
  actor: string | null
  now: string                                    // ISO
}

type OdInsert = Database['public']['Tables']['erp_outbound_orders']['Insert']
type SoInsert = Database['public']['Tables']['erp_so_lines']['Insert']
export type OdRecord = Omit<OdInsert, 'id'>
export type SoRecord = Omit<SoInsert, 'id'>

export interface UnitErr { material_code: string; material_name: string; kind: string; file_value: string; system_value: string }
export interface RouteRef { route_code: string; route_name: string; plant: string | null; ward_code: string | null }
export interface CustomerGeo {
  ship_to_code: string; name: string | null; ward_code: string | null; region_code: string | null; region_name: string | null
  sales_district: string | null; sales_office: string | null; address: string | null; sold_to_code: string | null; search_term: string | null
}

export interface Zsd02Parsed {
  od: OdRecord[]
  so: SoRecord[]
  routes: Map<string, RouteRef>
  customers: Map<string, CustomerGeo>
  unitErrs: Map<string, UnitErr>
  warnings: string[]
  stats: {
    rows: number; od_rows: number; so_rows: number; skipped: number; cancelled: number
    so_unresolved: number; so_derived_file: number; so_derived_master: number
    flows: Record<string, number>; not_loadable: number
    unknown_flow_codes: string[]; unknown_dvvt: string[]; weight_mismatch_mats: string[]
    od_numbers: number; so_numbers: number
  }
}

const asJson = (v: unknown): Json => v as unknown as Json
/** Phiên bản hình dạng `raw` — dòng NO-OP mà `raw._v` cũ hơn thì cửa nạp ghi lại RIÊNG `raw` (giữ updated_at),
 *  để sổ đã nạp trước bản vá cũng có đủ 79 cột cho panel chi tiết. Tăng khi đổi cách dựng raw. */
export const RAW_VERSION = 2
/** `raw` lưu trọn dòng theo key field; ô ngày về 'YYYY-MM-DD', ô trống bỏ (không lưu 26 chuỗi rỗng mỗi dòng). */
function rawOf(r: Record<string, unknown>): Json {
  const out: Record<string, unknown> = { _v: RAW_VERSION }
  for (const [k, v] of Object.entries(r)) {
    if (v === '' || v == null) continue
    out[k] = (ZSD02_RAW_DATE_KEYS as readonly string[]).includes(k) ? (parseExcelDate(v) ?? v) : v
  }
  return asJson(out)
}
const upper = (s: string | null) => (s ? s.toUpperCase() : null)
const round3 = (x: number) => Math.round(x * 1000) / 1000

/** "100-Thành phố Hà Nội" → { code:'100', name:'Thành phố Hà Nội' }; không có '-' → cả chuỗi là name. */
export function splitCodeName(v: unknown): { code: string | null; name: string | null } {
  const s = cellStr(v)
  if (!s) return { code: null, name: null }
  const i = s.indexOf('-')
  if (i <= 0) return { code: null, name: s }
  return { code: s.slice(0, i).trim() || null, name: s.slice(i + 1).trim() || null }
}

/** flow của một dòng: hàng phi tồn (chiết khấu) luôn DISCOUNT; rồi item_category → so_type → UNKNOWN. */
export function resolveFlow(flowMap: Map<string, Flow>, itemCategoryCode: string | null, soTypeCode: string | null, isNonStock?: boolean | null): Flow {
  if (isNonStock) return 'DISCOUNT'
  return (itemCategoryCode && flowMap.get(itemCategoryCode)) || (soTypeCode && flowMap.get(soTypeCode)) || 'UNKNOWN'
}

export function parseZsd02(rows: Record<string, unknown>[], ctx: Zsd02Ctx): Zsd02Parsed {
  const t = ctx.now
  const od: OdRecord[] = []
  const so: SoRecord[] = []
  const routes = new Map<string, RouteRef>()
  const customers = new Map<string, CustomerGeo>()
  const unitErrs = new Map<string, UnitErr>()
  const warnings: string[] = []
  const flows: Record<string, number> = {}
  const unknownFlow = new Set<string>(), unknownDvvt = new Set<string>(), weightMismatch = new Set<string>()
  const odKeys = new Set<string>(), soKeys = new Set<string>(), odNumbers = new Set<string>(), soNumbers = new Set<string>()
  let skipped = 0, cancelled = 0, soUnresolved = 0, soFile = 0, soMaster = 0, notLoadable = 0

  // Bậc 2 của suy hệ số cho dòng chưa OD: hệ số base/sales quan sát từ dòng CÓ OD cùng (mã, đơn vị bán) trong file.
  // Đo file mẫu: 0 mã có 2 hệ số, giải được 1.120/1.135 dòng chưa OD.
  const factorInFile = new Map<string, number>()
  for (const r of rows) {
    if (!cellStr(r.od_number)) continue
    const mc = cellStr(r.material), su = normSalesUnit(r.sales_unit)
    const q = cellNum(r.od_qty), b = cellNum(r.od_qty_base)
    if (mc && su && q != null && b != null && q > 0 && b > 0) factorInFile.set(`${mc}|${su}`, b / q)
  }

  for (const r of rows) {
    const soNo = cellStr(r.so_number), item = cellStr(r.item)
    if (!soNo || !item) { skipped++; continue }
    const odNo = cellStr(r.od_number)
    const mc = cellStr(r.material)
    const mat = mc ? ctx.mats.get(mc) : undefined
    const matName = mat?.short_name ?? cellStr(r.material_name) ?? ''

    // ── Đơn vị: quy nhãn rồi mới so master ──
    const suRaw = cellStr(r.sales_unit)
    const su = normSalesUnit(suRaw)
    if (suRaw && !su) unitErrs.set(`${mc ?? '?'}|label`, { material_code: mc ?? '', material_name: matName, kind: 'Đơn vị bán (nhãn lạ)', file_value: suRaw, system_value: 'Thùng · Hộp · Cái · kg (utils/sapUnits)' })
    const bu = normBaseUnit(r.base_unit)
    if (mat && bu && mat.base_unit && bu !== String(mat.base_unit).toUpperCase())
      unitErrs.set(`${mc}|base`, { material_code: mc!, material_name: matName, kind: 'Đơn vị gốc', file_value: bu, system_value: String(mat.base_unit) })
    if (mat && su) {
      const allowed = [mat.entry_unit, mat.base_unit].filter(Boolean).map(x => String(x).toUpperCase())
      if (allowed.length && !allowed.includes(su))
        unitErrs.set(`${mc}|sales`, { material_code: mc!, material_name: matName, kind: 'Đơn vị bán', file_value: `${suRaw} → ${su}`, system_value: allowed.join(' / ') })
    }

    // ── Phân loại dòng ──
    const icCode = sapCodeOf(r.item_category), soTypeCode = sapCodeOf(r.so_type)
    const flow = resolveFlow(ctx.flowMap, icCode, soTypeCode, mat?.is_non_stock)
    if (flow === 'UNKNOWN') unknownFlow.add(`${icCode ?? '?'} / ${soTypeCode ?? '?'}`)
    flows[flow] = (flows[flow] ?? 0) + 1
    if (!LOADABLE_FLOWS.has(flow)) notLoadable++

    const dvvtRaw = cellStr(r.dvvt)
    const dvvtNorm = normDvvt(dvvtRaw)
    const dvvtCode = dvvtNorm ? ctx.dvvtResolve(dvvtNorm) : null
    if (dvvtNorm && !dvvtCode) unknownDvvt.add(dvvtRaw!)

    const deliveryDate = parseExcelDate(r.delivery_date)
    const region = splitCodeName(r.region)
    const ward = cellStr(r.ward), routeCode = cellStr(r.route_code), routeName = cellStr(r.route_name)
    const plant = cellStr(r.plant), sloc = cellStr(r.sloc)
    const shipTo = cellStr(r.ship_to_code), shipToName = cellStr(r.ship_to_name)
    const gwKg = gramsToKg(r.gross_weight)
    const cancel = cellStr(r.cancel_status)
    if (cancel) cancelled++
    const upc = Number(mat?.units_per_carton) || 0

    if (shipTo && !customers.has(shipTo)) customers.set(shipTo, {
      ship_to_code: shipTo, name: shipToName, ward_code: ward, region_code: region.code, region_name: region.name,
      sales_district: cellStr(r.sales_district), sales_office: cellStr(r.sales_office), address: cellStr(r.address),
      sold_to_code: cellStr(r.sold_to_code), search_term: cellStr(r.search_term),
    })
    if (routeCode && routeName && !routes.has(routeCode)) routes.set(routeCode, { route_code: routeCode, route_name: routeName, plant, ward_code: ward })

    // ── Dòng CÓ OD → sổ OD (số base = SAP) ──
    if (odNo) {
      const key = `${odNo}__${item}`
      if (odKeys.has(key)) { warnings.push(`Trùng (OD ${odNo}, Item ${item}) trong file — giữ dòng đầu`) }
      else {
        odKeys.add(key); odNumbers.add(odNo)
        const odq = cellNum(r.od_qty), odBase = cellNum(r.od_qty_base)
        // Kiểm chéo hệ số y như VL06O: bán theo GỐC → base == sales; bán theo THÙNG → × upc.
        if (mat && odq != null && odBase != null && su && bu) {
          if (su === bu) { if (Math.round(odq) !== Math.round(odBase)) warnings.push(`OD ${odNo}/${item} mã ${mc}: bán theo ${suRaw} nhưng Base ${odBase} ≠ SL ${odq}`) }
          else if (upc > 0 && Math.round(odq * upc) !== Math.round(odBase)) warnings.push(`OD ${odNo}/${item} mã ${mc}: ${odq} ${suRaw} × ${upc} ≠ ${odBase} ${bu} (Base)`)
        }
        const factor = odq != null && odq > 0 && odBase != null ? odBase / odq : (su === 'CAR' ? upc : 1)
        const issued = cellNum(r.issued_qty)
        const issuedBase = issued != null && factor > 0 ? Math.round(issued * factor) : null
        // Lệch khối lượng master ↔ SAP > 5 % → gom theo mã (đo: 510000219 master 4,965 vs SAP 4,97 = 0,1 %)
        if (mat && odBase != null && odBase > 0 && gwKg != null && gwKg > 0) {
          const l = loadOf(odBase, mat, null)
          if (l.kg != null && l.kg > 0 && Math.abs(l.kg - gwKg) / gwKg > 0.05) weightMismatch.add(mc!)
        }
        od.push({
          od_number: odNo, od_item: item, so_number: soNo, so_item: item,
          material_code: mc, material_name: cellStr(r.material_name),
          qty_sales: odq, sales_unit: su ?? upper(suRaw), qty_base: odBase, base_unit: bu,
          ship_to_code: shipTo, ship_to_name: shipToName, plant, storage_location: sloc,
          batch: null, batch_so: cellStr(r.so_batch),
          date_req: cellNum(r.date_days), pct_date_req: cellNum(r.date_pct),
          note_delivery: cellStr(r.note_delivery), note_invoice: cellStr(r.note_invoice),
          shipping_point: null, license_plate: cellStr(r.plate),   // biển GIỮ NGUYÊN VĂN (luật ngoại lệ erp_outbound_orders.license_plate)
          so_type: cellStr(r.so_type), item_category: cellStr(r.item_category), flow,
          delivery_date: deliveryDate, sales_org: cellStr(r.sales_org), dist_channel: cellStr(r.dist_channel),
          sold_to_code: cellStr(r.sold_to_code), ward_code: ward, region_code: region.code, sales_district: cellStr(r.sales_district),
          route_code: routeCode, route_name: routeName, dvvt_code: dvvtCode, dvvt_raw: dvvtRaw, driver_name: cellStr(r.driver),
          sap_dispatch_status: normDispatchStatus(r.dispatch),
          qty_so_sales: cellNum(r.so_qty), qty_issued_base: issuedBase,
          gross_weight_kg: gwKg, sap_pallets: cellNum(r.od_pallets), sap_m3: cellNum(r.od_m3),
          mat_doc: cellStr(r.mat_doc), billing_no: cellStr(r.billing),
          so_created_at: parseExcelDate(r.so_created), od_created_at: parseExcelDate(r.od_created),
          approval_status: cellStr(r.approval), customer_ref: cellStr(r.customer_ref),
          source: 'ZSD02', raw: rawOf(r), uploaded_by: ctx.actor, sync_status: 'ACTIVE', last_synced_at: t, updated_at: t,
        })
      }
    }

    // ── MỌI dòng → sổ SO (hạt SO item); dòng chưa OD chỉ sống ở đây ──
    const soKey = `${soNo}__${item}`
    if (soKeys.has(soKey)) {
      // 3 SO item tách 2 OD trong file mẫu: giữ dòng đầu, chỉ cần biết đã có OD
      continue
    }
    soKeys.add(soKey); soNumbers.add(soNo)
    const soq = cellNum(r.so_qty)
    const soBaseSap = cellNum(r.so_qty_base)
    let soBase: number | null = null, derived = true, deriveSource: string | null = null, unresolved = false
    if (soBaseSap != null) { soBase = soBaseSap; derived = false; deriveSource = 'SAP' }
    else if (soq == null || !su) { unresolved = true }
    else if (su !== 'CAR') { soBase = soq; derived = false; deriveSource = 'SAP' }           // Hộp/Cái/kg: số SO đã là base
    else {
      const f = mc ? factorInFile.get(`${mc}|CAR`) : undefined
      if (f && f > 0) { soBase = Math.round(soq * f * 1000) / 1000; deriveSource = 'FILE'; soFile++ }
      else if (mat && hasEntry(mat)) { soBase = round3(soq * upc); deriveSource = 'MASTER'; soMaster++ }
      else unresolved = true
    }
    if (unresolved) soUnresolved++
    so.push({
      so_number: soNo, so_item: item, od_number: odNo,
      material_code: mc, material_name: cellStr(r.material_name),
      qty_so_sales: soq, sales_unit: su ?? upper(suRaw), qty_so_cartons: cellNum(r.so_qty_car),
      qty_so_base: soBase, qty_base_derived: derived, derive_source: deriveSource, qty_unresolved: unresolved,
      base_unit: bu, ship_to_code: shipTo, ship_to_name: shipToName, sold_to_code: cellStr(r.sold_to_code),
      plant, storage_location: sloc, delivery_date: deliveryDate, flow,
      so_type: cellStr(r.so_type), item_category: cellStr(r.item_category),
      status: cancel ? 'CANCELLED' : odNo ? 'HAS_OD' : 'OPEN', cancel_reason: cancel, approval_status: cellStr(r.approval),
      ward_code: ward, region_code: region.code, route_code: routeCode, route_name: routeName,
      sap_pallets: cellNum(r.so_pallets), sap_m3: cellNum(r.so_m3), gross_weight_kg: gwKg,
      note_delivery: cellStr(r.note_delivery),
      sync_status: 'ACTIVE', source: 'ZSD02', raw: rawOf(r), uploaded_by: ctx.actor, updated_at: t,
    })
  }

  return {
    od, so, routes, customers, unitErrs, warnings,
    stats: {
      rows: rows.length, od_rows: od.length, so_rows: so.length, skipped, cancelled,
      so_unresolved: soUnresolved, so_derived_file: soFile, so_derived_master: soMaster,
      flows, not_loadable: notLoadable,
      unknown_flow_codes: [...unknownFlow].sort(), unknown_dvvt: [...unknownDvvt].sort(), weight_mismatch_mats: [...weightMismatch].sort(),
      od_numbers: odNumbers.size, so_numbers: soNumbers.size,
    },
  }
}

/** Cột nghiệp vụ dùng so NO-OP (dòng y hệt = không ghi, không đổi id/updated_at) — BIZ của VL06O + phần ZSD02. */
export const ZSD02_BIZ = [
  'material_code', 'material_name', 'qty_sales', 'sales_unit', 'qty_base', 'base_unit',
  'ship_to_code', 'ship_to_name', 'plant', 'storage_location', 'batch', 'batch_so',
  'date_req', 'pct_date_req', 'note_delivery', 'note_invoice', 'shipping_point', 'license_plate',
  'so_number', 'so_type', 'item_category', 'flow', 'delivery_date', 'ward_code', 'route_code', 'dvvt_code', 'dvvt_raw',
  'driver_name', 'sap_dispatch_status', 'qty_so_sales', 'qty_issued_base', 'gross_weight_kg', 'sap_pallets', 'sap_m3',
  'mat_doc', 'billing_no', 'approval_status', 'customer_ref',
] as const
export const SO_BIZ = [
  'od_number', 'material_code', 'material_name', 'qty_so_sales', 'sales_unit', 'qty_so_cartons', 'qty_so_base', 'qty_base_derived',
  'derive_source', 'qty_unresolved', 'base_unit', 'ship_to_code', 'ship_to_name', 'sold_to_code', 'plant', 'storage_location',
  'delivery_date', 'flow', 'so_type', 'item_category', 'status', 'cancel_reason', 'approval_status', 'ward_code', 'region_code',
  'route_code', 'route_name', 'sap_pallets', 'sap_m3', 'gross_weight_kg', 'note_delivery',
] as const
const NUMF = new Set(['qty_sales', 'qty_base', 'date_req', 'pct_date_req', 'qty_so_sales', 'qty_issued_base', 'gross_weight_kg', 'sap_pallets', 'sap_m3', 'qty_so_cartons', 'qty_so_base'])
export function bizHash(r: Record<string, unknown>, fields: readonly string[]): string {
  return JSON.stringify(fields.map(f => {
    const v = r[f]
    if (v == null || v === '') return null
    if (typeof v === 'boolean') return v
    return NUMF.has(f) ? Number(v) : String(v)
  }))
}
