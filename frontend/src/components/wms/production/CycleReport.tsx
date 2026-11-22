// BÁO CÁO NVL THEO CHU KỲ (MES 18/11 f) — tab mặc định của trang Báo cáo NVL.
// User 18/11: "từ đây (sơ đồ bồn) đi ra được báo cáo NVL — xem real time và lấy được các báo cáo cuối" · "theo CHU KỲ, chu kỳ là lớn hơn
// ca, mẻ" · "cuối chu kỳ, nhưng tách ra ca, mẻ — từ đó ra được các chỉ số của nhân sự, số liệu".
//   • Chọn kho chế biến + chu kỳ (mới nhất trước; chu kỳ đang chạy ghi rõ). Số tự cập nhật khi có người cấp NVL / ghi phiếu / nạp bồn
//     (realtime qua chính các sổ đó — prod-cycle).
//   • TỔNG QUAN (21/11, mặc định — components/wms/production/CycleDashboard.tsx): lệch so ĐỊNH MỨC GỐC theo ca · mẻ (user: "cái người
//     ta quan tâm là định mức và sự chênh lệch của từng ca, từng mẻ"). Từ 21/11 mọi cách xem + Excel so với định mức gốc theo công thức
//     (ô std), phiếu đã sửa chỉ là MỘT phần của lệch ("Sửa phiếu"); ca = ca của một ngày ("Ca 1 · 17/11").
//   • Ba cách xem chi tiết: NVL × CA (20/11 — user: "1 ngày có tới 36 mẻ thì số cột sẽ là nhiều lắm": cột cố định = cả chu kỳ + mỗi CA một cột +
//     "Mẻ lệch"; bấm ▸ ở dòng NVL mở từng MẺ xếp dọc, tô theo luật mức lệch của phiếu mẻ — trước đó mỗi mẻ một cột) · Ca · Mẻ (mỗi mẻ
//     một dòng: tình trạng, kế hoạch / nạp bồn, dòng NVL đủ / thiếu / vượt, sai thứ tự, mốc giờ, người làm; mỗi ca một dòng chỉ số) ·
//     Nhân sự (mỗi người một dòng: đếm việc đã làm trong chu kỳ).
//   • Báo cáo cuối = Xuất Excel: NVL theo ca (giống màn hình) · NVL từng mẻ (mỗi dòng một mẻ × NVL, xếp dọc — 20/11 thay sheet "mỗi mẻ
//     một cột") · Ca · Mẻ · Nhân sự · Tiêu hao NVL (thô) — 18/11 g:
//     sheet thô đọc CÙNG khuôn cột với tab Dữ liệu thô (utils/consumptionRaw.ts — mỗi dòng một phát sinh Cấp / Huỷ cấp, đủ cột cho SAP).
// Số gốc tính ở DB (mes_cycle_report); phép gom ở utils/cycleReport.ts (có test) — bảng, dải số và Excel đọc cùng hàm.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { FileDown, LayoutGrid, ChevronDown, ChevronRight } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { useProductionWarehouses, useCycles, useCycleReport, fetchRawAll, defaultKitchen, type CycleBatch, type CycleRow, type CyclePerson } from '@/api/productionHooks'
import { StageSymbol, StageBadge, stageLabel } from './BatchStage'
import { MobileNumHead, MobileNumRow, type NumCol } from './MobileNumGrid'
import { shiftGroups, liveBatches, rowSum, cellState, cellDev, shiftKpis, minutesBetween, durLabel, isFilled, lineStats, rowBatchLines, rowDeviations,
  devAgg, devLines, devPctOf, LINE_STATE_LABEL, type ShiftKpi, type DevAgg } from '@/utils/cycleReport'
import { devLabel } from '@/utils/reqTolerance'
import { CycleDashboard, sgn } from './CycleDashboard'
import { qtyNum, qtyCode, matUnitCode, unitCode } from '@/utils/unitCode'
import { formatDate, formatDateTime, formatTimestampTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { RAW_EVENT_COLS, rawAoa, rawColWidths } from '@/utils/consumptionRaw'
import { sanitizeAoa } from '@/utils/excelSafe'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const dash = <span className="text-slate-300 font-normal">—</span>
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const r3 = (n: number) => Math.round(n * 1000) / 1000
const units = (xs: { unit: string; qty: number }[]) => (xs.length ? xs.map(x => `${nf(x.qty)} ${x.unit}`).join(' + ') : '')
const hm = (iso: string | null | undefined) => (iso ? formatTimestampTime(iso).slice(0, 5) : '')
const whenBy = (iso: string | null | undefined, by: string | null | undefined) => (iso ? `${formatDateTime(iso)}${by ? ` · ${by}` : ''}` : '')
const VIEWS = [{ key: 'dash', label: 'Lệch ca · mẻ' }, { key: 'nvl', label: 'NVL × ca' }, { key: 'batch', label: 'Ca · Mẻ' }, { key: 'people', label: 'Nhân sự' }] as const
const MOBILE_NVL: NumCol[] = [{ label: 'Định mức', title: 'Định mức gốc theo công thức' }, { label: 'Thực cấp' }, { label: 'Lệch', title: 'Thực cấp − định mức' }]
/** chú thích cột Nhân sự — đếm việc theo tên người làm, trong chu kỳ đang xem */
const PEOPLE_TIP: Record<string, string> = {
  batches: 'Số mẻ người này có làm ít nhất một việc', open: 'Số mẻ đã mở', lead: 'Trưởng ca duyệt phiếu (duyệt 1)', qaok: 'QA duyệt phiếu (duyệt 2)',
  rm: 'Số lần cấp NVL còn hiệu lực', rm_batches: 'Số mẻ đã cấp NVL', rm_bad: 'Lần cấp không theo thứ tự luân chuyển của kho (FEFO / FIFO) — có lý do vượt',
  rm_exp: 'Lần cấp NVL hết hạn có QA duyệt', rm_rev: 'Lần cấp sau đó phải huỷ (cấp nhầm)', log: 'Số mốc / ô đã ghi trên phiếu theo dõi',
  logok: 'Phiếu theo dõi đã xác nhận (QA)', label: 'Bộ tem pallet đã in', pour: 'Số tem quét khi Check trước khi đổ bồn', fill: 'Lần nạp BTP vào bồn',
  tankqa: 'Mẻ đã kết luận QA ở bồn', span: 'Việc đầu tiên → việc cuối cùng trong chu kỳ',
}

export function CycleReport({ tabBar }: { tabBar: ReactNode }) {
  const navigate = useNavigate()
  const canSeePath = useCanSeePath()
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canExport = can(perms, 'production', 'export')
  const f = useWmsFilterStore(s => s.productionReport)
  const setF = useWmsFilterStore(s => s.setProductionReport)
  const { data: { kitchens } } = useProductionWarehouses()
  const wh = kitchens.some(k => k.id === f.warehouseId) ? f.warehouseId : defaultKitchen(kitchens, f.warehouseId || useGlobalScopeStore.getState().warehouseId)
  const listQ = useCycles(wh || undefined)
  const cycles = listQ.data ?? []
  const cycle = f.cycle || cycles[0]?.cycle || ''
  const q = useCycleReport(wh || undefined, cycle || undefined)
  // chỉ dùng số của ĐÚNG chu kỳ + kho đang chọn (đổi chu kỳ mà bảng cũ còn hiện thì Excel xuất nhầm)
  const rep = q.data && q.data.cycle === cycle && q.data.warehouse_id === wh ? q.data : undefined
  const batches = useMemo(() => rep?.batches ?? [], [rep])
  const rows = useMemo(() => rep?.rows ?? [], [rep])
  const people = rep?.people ?? []
  const live = useMemo(() => liveBatches(batches), [batches])
  const groups = useMemo(() => shiftGroups(live), [live])
  const kpis = useMemo(() => shiftKpis(rows, batches), [rows, batches])
  const all = kpis[kpis.length - 1]
  const dev = useMemo(() => devAgg(rows, live), [rows, live])
  const liveIds = useMemo(() => live.map(b => b.id), [live])
  const filled = live.filter(isFilled).length
  const running = live.some(b => !isFilled(b))
  const cancelled = batches.length - live.length
  const bad = live.reduce((s, b) => s + Number(b.rm_bad || 0), 0)
  const exp = live.reduce((s, b) => s + Number(b.rm_exp || 0), 0)
  const rev = live.reduce((s, b) => s + Number(b.rm_rev || 0), 0)
  const whName = kitchens.find(k => k.id === wh)?.name ?? ''
  const dates = live.map(b => b.prod_date).filter((d): d is string => !!d).sort()
  const dateText = dates.length ? (dates[0] === dates[dates.length - 1] ? formatDate(dates[0]) : `${formatDate(dates[0])} → ${formatDate(dates[dates.length - 1])}`) : ''
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openMat, setOpenMat] = useState<string | null>(null)
  // máy tính: dòng NVL đang mở (▸ — từng mẻ xếp dọc); mở được nhiều dòng một lúc
  const [openNvl, setOpenNvl] = useState<Set<string>>(() => new Set())
  const toggleNvl = (id: string) => setOpenNvl(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Tổng quan → bấm một NVL lệch ⇒ sang NVL × ca, mở sẵn dòng đó (máy tính) / mở sẵn ở danh sách (điện thoại) và cuộn tới
  const [jumpMat, setJumpMat] = useState<string | null>(null)
  const openNvlFromDash = (id: string) => { setOpenNvl(new Set([id])); setOpenMat(id); setJumpMat(id); setF({ cview: 'nvl' }) }
  useEffect(() => {
    if (!jumpMat || f.cview !== 'nvl') return
    const code = rows.find(r => r.material_id === jumpMat)?.material_code
    const el = code ? [...document.querySelectorAll(`[data-mat="${code}"]`)].find(e => (e as HTMLElement).offsetParent) : null
    el?.scrollIntoView({ block: 'center' })
    setJumpMat(null)
  }, [jumpMat, f.cview, rows])

  const cycleOpts = useMemo(() => {
    const opts = cycles.map(c => ({
      value: c.cycle, label: `Chu kỳ ${c.cycle}`,
      sub: `${c.batches} mẻ · ${c.filled}/${c.batches} đã nạp bồn${c.filled < c.batches ? ' · đang chạy' : ''}${c.date_from ? ` · ${formatDate(c.date_from)}` : ''}`,
    }))
    if (cycle && !opts.some(o => o.value === cycle)) opts.unshift({ value: cycle, label: `Chu kỳ ${cycle}`, sub: '' })
    return opts
  }, [cycles, cycle])

  async function exportExcel() {
    if (!rep) return
    setErr(''); setBusy(true)
    try {
      const lines = await fetchRawAll({ warehouse_id: wh, cycle }, 'events')
      const wb = XLSX.utils.book_new()
      const head = [
        [`BÁO CÁO SỬ DỤNG NGUYÊN VẬT LIỆU — CHU KỲ ${cycle}`],
        [`Kho chế biến: ${whName}`, '', `Ngày SX: ${dateText}`, '', `${running ? 'ĐANG CHẠY' : 'ĐÃ XONG'} · ${filled}/${live.length} mẻ đã nạp bồn${cancelled ? ` · ${cancelled} mẻ huỷ` : ''}`, '', `Xuất lúc ${formatDateTime(new Date().toISOString())}`],
        [],
      ]
      // 0) LỆCH THEO CA · MẺ (21/11 — giống Tổng quan): mỗi ca một dòng tổng rồi từng mẻ, cuối là cả chu kỳ. KG = chỉ NVL tính KG, chỉ dòng
      //    đã cấp xong; số NVL lệch đếm mọi đơn vị. Cùng hàm devAgg với màn hình.
      const devRow = (ca: string, no: string | number, code: string, btp: string, st: string, a: DevAgg) => [ca, no, code, btp, st,
        a.kg.std, a.kg.sheet, a.kg.iss, a.kg.total, a.kg.pct ?? '', a.kg.edit, a.kg.exec, devLines(a), a.over, a.under, a.extra, a.pending]
      const dv: unknown[][] = [...head,
        ['KG: chỉ cộng NVL tính KG và chỉ dòng NVL đã cấp xong (đủ theo phiếu, vượt, hoặc mẻ đã nạp bồn). NVL lệch: đếm mọi đơn vị. Định mức = định mức gốc theo công thức × kế hoạch.'],
        ['Ca', 'Mẻ', 'Mã lô', 'BTP', 'Tình trạng', 'Định mức (KG)', 'Phiếu (KG)', 'Thực cấp (KG)', 'Lệch (KG)', 'Lệch %', 'Do sửa phiếu (KG)', 'Do cấp lệch (KG)',
          'NVL lệch', 'Vượt định mức', 'Dưới định mức', 'Ngoài định mức', 'Dòng chưa cấp xong'],
        ...groups.flatMap(g => [
          devRow(g.shift, `${g.batches.length} mẻ`, '', '', '', devAgg(rows, g.batches)),
          ...g.batches.map(b => devRow(g.shift, b.batch_no ?? '', b.batch_code, b.material_code, stageLabel(b.stage, b.step), devAgg(rows, [b]))),
          [],
        ]),
        devRow('Cả chu kỳ', `${live.length} mẻ`, '', '', '', dev),
      ]
      const ws0 = XLSX.utils.aoa_to_sheet(sanitizeAoa(dv))
      ws0['!cols'] = [{ wch: 14 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, ...Array.from({ length: 7 }, () => ({ wch: 12 })), ...Array.from({ length: 5 }, () => ({ wch: 10 }))]
      XLSX.utils.book_append_sheet(wb, ws0, 'Lệch theo ca · mẻ')
      // 1) NVL theo ca — cùng bố cục màn hình (20/11): cả chu kỳ (định mức gốc · phiếu · thực cấp · lệch) + mỗi CA hai cột (Định mức |
      //    Thực cấp) + Mẻ lệch. Trước 20/11 mỗi mẻ hai cột (bố cục tờ giấy) ⇒ chu kỳ 36 mẻ = hơn 70 cột; chi tiết từng mẻ ở sheet 1b xếp dọc.
      const nvl: unknown[][] = [...head,
        ['Nguyên liệu', 'Tên', 'ĐVT', 'Cả chu kỳ', '', '', '', '', ...groups.flatMap(g => [`${g.shift} (${g.batches.length} mẻ)`, '']), 'Mẻ lệch'],
        ['', '', '', 'Định mức', 'Phiếu', 'Thực cấp', 'Lệch', 'Lệch %', ...groups.flatMap(() => ['Định mức', 'Thực cấp']), ''],
        ...rows.map(r => {
          const tot = rowSum(r, liveIds)
          return [r.material_code, r.material_name ?? '', unitCode(r.base_unit), tot.std, tot.sheet, tot.iss, tot.diff, tot.devPct ?? '',
            ...groups.flatMap((g): (number | string)[] => { const s = rowSum(r, g.batches.map(b => b.id)); return s.used ? [s.std, s.iss] : ['', ''] }),
            rowDeviations(rowBatchLines(r, groups))]
        }),
      ]
      const ws1 = XLSX.utils.aoa_to_sheet(sanitizeAoa(nvl))
      ws1['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 7 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 8 }, ...groups.flatMap(() => [{ wch: 11 }, { wch: 11 }]), { wch: 8 }]
      XLSX.utils.book_append_sheet(wb, ws1, 'NVL theo ca')
      // 1b) NVL từng mẻ — mỗi dòng một mẻ × NVL (cùng hàm với ▸ trên màn hình), lọc / pivot được trong Excel
      const per: unknown[][] = [...head,
        ['Mã NVL', 'Tên NVL', 'ĐVT', 'Ca', 'Mẻ', 'Mã lô', 'BTP', 'Định mức', 'Mức lệch cho phép (%)', 'Phiếu', 'Lý do sửa phiếu', 'Thực cấp', 'Lệch', 'Lệch %',
          'Do sửa phiếu', 'Do cấp lệch', 'Tình trạng'],
        ...rows.flatMap(r => rowBatchLines(r, groups).map(l => [r.material_code, r.material_name ?? '', unitCode(r.base_unit), l.shift, l.batch.batch_no ?? '',
          l.batch.batch_code, l.batch.material_code, l.cell.std ?? 'ngoài định mức', l.cell.tol ?? '', l.cell.rm ? 'bỏ khỏi phiếu' : l.cell.req ?? 'ngoài phiếu',
          l.cell.why ?? '', l.dev.iss, l.dev.total, devPctOf(l.dev.total, l.dev.std) ?? '', l.dev.edit, l.dev.exec, l.state ? LINE_STATE_LABEL[l.state] : ''])),
      ]
      const ws1b = XLSX.utils.aoa_to_sheet(sanitizeAoa(per))
      ws1b['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 7 }, { wch: 14 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 24 },
        { wch: 11 }, { wch: 10 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, ws1b, 'NVL từng mẻ')
      // 2) Ca · Mẻ
      const kpiRow = (k: ShiftKpi) => [k.shift, `${k.batches} mẻ`, '', '', '', units(k.planned), units(k.filledQty), `${k.stats.ok}/${k.stats.lines}`, k.stats.short, k.stats.over, k.stats.extra, '', '', '', '', '', '', '', durLabel(k.avgMin)]
      const cm: unknown[][] = [...head,
        ['Ca', 'Mẻ', 'Mã lô', 'BTP', 'Bồn', 'Kế hoạch', 'Nạp bồn', 'NVL đủ', 'Thiếu', 'Vượt', 'Ngoài định mức', 'Sai thứ tự', 'Hết hạn QA duyệt', 'Cấp phải huỷ',
          'Tình trạng', 'Mở mẻ', 'Cấp NVL', 'Nạp bồn lúc', 'Mở → nạp', 'TC duyệt', 'QA duyệt', 'In tem', 'QA bồn'],
        ...groups.flatMap(g => [
          ...g.batches.map(b => {
            const st = lineStats(rows, [b])
            return [g.shift, b.batch_no ?? '', b.batch_code, b.material_code, b.tank_code ?? '', b.planned_qty != null ? `${nf(Number(b.planned_qty))} ${unitCode(b.base_unit)}` : '',
              b.filled_qty ? `${nf(Number(b.filled_qty))} ${unitCode(b.base_unit)}` : '', `${st.ok}/${st.lines}`, st.short, st.over, st.extra, b.rm_bad, b.rm_exp, b.rm_rev,
              stageLabel(b.stage, b.step), whenBy(b.created_at, b.opened_by_name), b.rm_first_at ? `${hm(b.rm_first_at)}–${hm(b.rm_last_at)}` : '', whenBy(b.filled_at, b.filled_by_name),
              durLabel(minutesBetween(b.created_at, b.filled_at)), whenBy(b.lead_ok_at, b.lead_ok_by_name), whenBy(b.qa_ok_at, b.qa_ok_by_name), whenBy(b.label_at, b.label_by_name), whenBy(b.tank_qa_at, b.tank_qa_by_name)]
          }),
          kpiRow(kpis.find(k => k.shift === g.shift)!),
          [],
        ]),
        kpiRow(all),
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(sanitizeAoa(cm))
      ws2['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 7 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 7 }, { wch: 7 }, { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 10 },
        { wch: 20 }, { wch: 26 }, { wch: 12 }, { wch: 26 }, { wch: 10 }, { wch: 26 }, { wch: 26 }, { wch: 26 }, { wch: 26 }]
      XLSX.utils.book_append_sheet(wb, ws2, 'Ca · Mẻ')
      // 3) Nhân sự
      const ppl: unknown[][] = [...head,
        ['Người', 'Ca', 'Mẻ', 'Mở mẻ', 'TC duyệt', 'QA duyệt', 'Lần cấp NVL', 'Mẻ đã cấp', 'Sai thứ tự', 'Hết hạn QA duyệt', 'Cấp phải huỷ', 'Ghi phiếu', 'Xác nhận phiếu',
          'In tem', 'Quét đổ bồn', 'Nạp bồn', 'QA bồn', 'Việc đầu', 'Việc cuối'],
        ...people.map(p => [p.name, p.shifts.join(', '), p.batches, p.open, p.lead, p.qaok, p.rm, p.rm_batches, p.rm_bad, p.rm_exp, p.rm_rev, p.log, p.logok,
          p.label, p.pour, p.fill, p.tankqa, p.first_at ? formatDateTime(p.first_at) : '', p.last_at ? formatDateTime(p.last_at) : '']),
      ]
      const ws3 = XLSX.utils.aoa_to_sheet(sanitizeAoa(ppl))
      ws3['!cols'] = [{ wch: 22 }, { wch: 14 }, ...Array.from({ length: 15 }, () => ({ wch: 10 })), { wch: 18 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, ws3, 'Nhân sự')
      // 4) Tiêu hao NVL (thô) — mỗi dòng một phát sinh Cấp (+) / Huỷ cấp (−), dòng 1 là tên cột; cùng khuôn với tab Dữ liệu thô
      const ws4 = XLSX.utils.aoa_to_sheet(sanitizeAoa(rawAoa(RAW_EVENT_COLS, lines)))
      ws4['!cols'] = rawColWidths(RAW_EVENT_COLS)
      XLSX.utils.book_append_sheet(wb, ws4, 'Tiêu hao NVL (thô)')
      await saveWorkbook(wb, `bao_cao_nvl_chu_ky_${cycle}${running ? '_dang_chay' : ''}.xlsx`)
    } catch (e) { setErr(apiMsg(e)) } finally { setBusy(false) }
  }

  const actions: ActionItem[] = []
  if (canSeePath('/wms/production/tanks')) actions.push({ key: 'map', icon: LayoutGrid, label: 'Sơ đồ bồn', tip: 'Về sơ đồ bồn — mẻ đang làm và bồn, cập nhật trực tiếp', onClick: () => navigate('/wms/production/tanks') })
  if (canExport && rep) actions.push({ key: 'xlsx', icon: FileDown, label: busy ? 'Đang xuất…' : 'Xuất Excel', tip: 'Báo cáo cuối của chu kỳ: Lệch theo ca · mẻ · NVL theo ca · NVL từng mẻ · Ca · Mẻ · Nhân sự · Tiêu hao NVL (thô — mỗi dòng một phát sinh)', onClick: () => void exportExcel(), busy, disabled: busy, primary: true, variant: 'default', mobileHidden: true })

  // ── NVL × mẻ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const nvlCols: RtColDef[] = useMemo(() => [
    { id: 'mat', label: 'Nguyên liệu', w: 230 }, { id: 'unit', label: 'ĐVT', w: 52 },
    { id: 'req', label: 'Định mức', w: 92, align: 'right', head: <span title="Định mức gốc theo công thức × kế hoạch mẻ">Định mức</span> },
    { id: 'sheet', label: 'Phiếu', w: 84, align: 'right', head: <span title="Phiếu của mẻ sau khi trưởng ca sửa — khác định mức thì tô cam">Phiếu</span> },
    { id: 'iss', label: 'Thực cấp', w: 92, align: 'right' },
    { id: 'diff', label: 'Lệch', w: 86, align: 'right' }, { id: 'pct', label: 'Lệch %', w: 64, align: 'right' },
    // mỗi CA một cột (thực cấp trên · định mức dưới) — bao nhiêu mẻ cũng không thêm cột; từng mẻ xem bằng ▸ ở dòng NVL
    ...groups.map(g => ({ id: `s_${g.shift}`, label: g.shift, w: 104, align: 'right' as const,
      head: <span className="block leading-tight text-right font-semibold text-slate-600" title={`Thực cấp (trên) / định mức (dưới) của ${g.batches.length} mẻ trong ${g.shift}`}>{g.shift}<span className="block font-normal text-slate-400">{g.batches.length} mẻ</span></span> })),
    { id: 'dev', label: 'Mẻ lệch', w: 70, align: 'right',
      head: <span title="Số mẻ cấp nguyên liệu này lệch khỏi mức cho phép của phiếu (vượt, hoặc thiếu ở mẻ đã nạp bồn) — bấm ▸ ở dòng để xem từng mẻ">Mẻ lệch</span> },
  ], [groups])
  // một ô mẻ × NVL (điện thoại, ▸): thực cấp trên · định mức gốc dưới; tô theo trạng thái so định mức (cellState)
  const cellOf = (r: CycleRow, b: CycleBatch) => {
    const c = r.cells[b.id]
    if (!c) return <span className="text-slate-200 font-normal">·</span>
    const st = cellState(c, isFilled(b))
    const d = cellDev(c)
    const pct = devPctOf(d.total, d.std)
    const cls = lineCls(st)
    const title = c.std == null ? `Ngoài định mức · thực cấp ${qtyCode(c.iss, r)}`
      : `Định mức ${qtyCode(d.std, r)}${c.tol != null ? ` (±${c.tol}%)` : ''} · phiếu ${qtyCode(d.sheet, r)}${c.why ? ` (${c.why})` : ''} · thực cấp ${qtyCode(c.iss, r)}${pct != null ? ` · lệch ${devLabel(pct)}` : ''}`
    return (
      <span className="block leading-tight" title={title} data-state={st ?? ''}>
        <span className={`block ${cls}`}>{qtyNum(c.iss, r)}</span>
        <span className="block text-[9px] font-normal text-slate-400">{c.std == null ? 'ngoài định mức' : qtyNum(d.std, r)}</span>
      </span>
    )
  }
  const lineCls = (st: string | null) => (st === 'over' || st === 'under' || st === 'extra' ? 'text-red-600' : st === 'ok' ? 'text-slate-900' : 'text-amber-600')
  const sumCell = (r: CycleRow, ids: string[]) => {
    const s = rowSum(r, ids)
    if (!s.used) return <span className="text-slate-200 font-normal">·</span>
    return (
      <span className="block leading-tight" title={`Định mức ${qtyCode(s.std, r)} · phiếu ${qtyCode(s.sheet, r)} · thực cấp ${qtyCode(s.iss, r)}`}>
        <span className="block">{qtyNum(s.iss, r)}</span><span className="block text-[9px] font-normal text-slate-400">{qtyNum(s.std, r)}</span>
      </span>
    )
  }
  const diffTone = (d: number, pct: number | null) => (d === 0 ? 'text-green-700' : pct != null && Math.abs(pct) <= 1 ? 'text-slate-700' : d < 0 ? 'text-amber-700' : 'text-red-600')

  // ── Ca · Mẻ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const BATCH_COLS: RtColDef[] = [
    { id: 'cm', label: 'Ca · Mẻ', w: 92 }, { id: 'code', label: 'Mã lô', w: 116 }, { id: 'btp', label: 'Bán thành phẩm', w: 150 }, { id: 'tank', label: 'Bồn', w: 56 },
    { id: 'st', label: 'Tình trạng', w: 140 }, { id: 'plan', label: 'Kế hoạch', w: 96, align: 'right' }, { id: 'fill', label: 'Nạp bồn', w: 96, align: 'right' },
    { id: 'ok', label: 'NVL đủ', w: 62, align: 'right' }, { id: 'short', label: 'Thiếu', w: 52, align: 'right' }, { id: 'over', label: 'Vượt', w: 52, align: 'right' },
    { id: 'extra', label: 'Ngoài định mức', w: 92, align: 'right' }, { id: 'bad', label: 'Sai thứ tự', w: 66, align: 'right' },
    { id: 'exp', label: 'Hết hạn', w: 58, align: 'right', head: <span title="Lần cấp NVL hết hạn có QA duyệt">Hết hạn</span> },
    { id: 'rev', label: 'Huỷ cấp', w: 60, align: 'right', head: <span title="Lần cấp sau đó phải huỷ (cấp nhầm)">Huỷ cấp</span> },
    { id: 'open', label: 'Mở mẻ', w: 140 }, { id: 'rm', label: 'Cấp NVL', w: 90 }, { id: 'filled', label: 'Nạp bồn lúc', w: 140 },
    { id: 'dur', label: 'Mở → nạp', w: 80, align: 'right' }, { id: 'tqa', label: 'QA bồn', w: 140 },
  ]
  const kpiLine = (k: ShiftKpi) => (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <b>{k.shift}</b><span>{k.batches} mẻ · đã nạp {k.filled}</span>
      {k.planned.length > 0 && <span>kế hoạch {units(k.planned)}</span>}
      {k.filledQty.length > 0 && <span>nạp bồn {units(k.filledQty)}</span>}
      <span>NVL đủ {k.stats.ok}/{k.stats.lines}</span>
      {k.stats.short > 0 && <span className="text-amber-700">thiếu {k.stats.short}</span>}
      {k.stats.over > 0 && <span className="text-red-600">vượt {k.stats.over}</span>}
      {k.stats.extra > 0 && <span>ngoài định mức {k.stats.extra}</span>}
      {k.avgMin != null && <span>TB mở → nạp {durLabel(k.avgMin)}</span>}
    </span>
  )

  // ── Nhân sự ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const pcol = (id: keyof CyclePerson | 'span', label: string, w: number, align?: 'right'): RtColDef =>
    ({ id, label, w, align, head: <span title={PEOPLE_TIP[id] ?? undefined}>{label}</span> })
  const PEOPLE_COLS: RtColDef[] = [
    { id: 'name', label: 'Người', w: 150 }, pcol('shifts', 'Ca', 90), pcol('batches', 'Mẻ', 46, 'right'), pcol('open', 'Mở mẻ', 58, 'right'),
    pcol('lead', 'TC duyệt', 62, 'right'), pcol('qaok', 'QA duyệt', 62, 'right'), pcol('rm', 'Lần cấp', 62, 'right'), pcol('rm_batches', 'Mẻ đã cấp', 70, 'right'),
    pcol('rm_bad', 'Sai thứ tự', 70, 'right'), pcol('rm_exp', 'Hết hạn', 60, 'right'), pcol('rm_rev', 'Cấp phải huỷ', 80, 'right'), pcol('log', 'Ghi phiếu', 64, 'right'),
    pcol('logok', 'Xác nhận phiếu', 90, 'right'), pcol('label', 'In tem', 54, 'right'), pcol('pour', 'Quét đổ bồn', 78, 'right'), pcol('fill', 'Nạp bồn', 60, 'right'),
    pcol('tankqa', 'QA bồn', 60, 'right'), pcol('span', 'Từ → đến', 200),
  ]
  const n0 = (n: number, warn = false) => (n ? <span className={warn ? 'text-red-600' : ''}>{n.toLocaleString('vi-VN')}</span> : dash)

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {tabBar}
            {kitchens.length > 1 && (
              <div className="w-40 sm:w-48 min-w-0 shrink">
                <SingleSelect value={wh} onChange={v => setF({ warehouseId: v, cycle: '' })} triggerClassName="h-9 sm:h-7" placeholder="Kho chế biến" options={kitchens.map(k => ({ value: k.id, label: k.name }))} />
              </div>
            )}
            <div className="flex-1 min-w-[150px] max-w-xs" data-testid="cycle-select">
              <SingleSelect value={cycle} onChange={v => setF({ cycle: v })} triggerClassName="h-9 sm:h-7" searchable={cycleOpts.length > 8}
                placeholder={listQ.isLoading ? 'Đang tải…' : 'Chưa có chu kỳ nào'} options={cycleOpts} />
            </div>
            <ActionCluster mobileInline className="sm:ml-auto" items={actions} />
          </div>
          {rep && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600" data-testid="cycle-head">
              <StatusBadge tone={running ? 'amber' : 'green'}>{running ? 'Đang chạy' : 'Đã xong'}</StatusBadge>
              <span><b className="tabular-nums">{filled}/{live.length}</b> mẻ đã nạp bồn{cancelled ? ` · ${cancelled} mẻ huỷ` : ''}</span>
              {dateText && <span>Ngày SX <b className="tabular-nums">{dateText}</b></span>}
              {kitchens.length === 1 && <span>{whName}</span>}
              <span className="inline-flex items-center gap-1 text-green-700" title="Số tự cập nhật khi có người cấp NVL, ghi phiếu, nạp bồn — không cần tải lại trang">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
                Trực tiếp · {q.dataUpdatedAt ? formatTimestampTime(new Date(q.dataUpdatedAt).toISOString()) : ''}
              </span>
            </div>
          )}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium w-fit" role="tablist" aria-label="Cách xem">
            {VIEWS.map((v, i) => (
              <button key={v.key} type="button" role="tab" aria-selected={f.cview === v.key} onClick={() => setF({ cview: v.key })} data-view={v.key}
                className={`h-8 sm:h-7 px-3 whitespace-nowrap ${i > 0 ? 'border-l border-slate-200 ' : ''}${f.cview === v.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{v.label}</button>
            ))}
          </div>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{err}</div>}
          {(q.isError || listQ.isError) && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{apiMsg(q.error ?? listQ.error)}</div>}
        </div>
        {/* dải số (21/11): LỆCH SO ĐỊNH MỨC GỐC của cả chu kỳ — cùng hàm devAgg với Tổng quan + Excel. Thời gian TB / BTP nạp nay ở dòng ca của "Ca · Mẻ". */}
        <SummaryBand mobilePairs tiles={[
          { label: 'Đã nạp bồn', value: `${filled}/${live.length}`, accent: running, tip: 'Số mẻ đã nạp BTP vào bồn / số mẻ của chu kỳ (không tính mẻ huỷ)' },
          { label: 'Định mức (KG)', value: dev.kg.std ? nf(dev.kg.std) : '—', tip: 'Định mức gốc theo công thức × kế hoạch — NVL tính KG, dòng đã cấp xong (đủ theo phiếu, vượt, hoặc mẻ đã nạp bồn)' },
          { label: 'Thực cấp (KG)', value: dev.kg.iss ? nf(dev.kg.iss) : '—', tip: 'Thực cấp của cùng các dòng đó' },
          { label: 'Lệch (KG)', value: dev.kg.std || dev.kg.iss ? `${sgn(dev.kg.total)}${dev.kg.pct != null ? ` · ${devLabel(dev.kg.pct)}` : ''}` : '—',
            danger: devLines(dev) > 0 && dev.kg.total > 0, accent: devLines(dev) > 0 && dev.kg.total < 0, tip: 'Thực cấp − định mức gốc = Sửa phiếu + Cấp lệch' },
          { label: 'Sửa phiếu', value: sgn(dev.kg.edit), tip: 'KG — phiếu của mẻ khác định mức gốc: trưởng ca sửa / thêm / bỏ dòng (có lý do)' },
          { label: 'Cấp lệch', value: sgn(dev.kg.exec), tip: 'KG — thực cấp khác phiếu của mẻ' },
          { label: 'NVL lệch', value: devLines(dev).toLocaleString('vi-VN'), danger: devLines(dev) > 0, tip: `Dòng NVL (mẻ × mã, mọi đơn vị) lệch định mức ngoài mức cho phép: vượt ${dev.over} · dưới định mức ${dev.under} · ngoài định mức ${dev.extra}` },
          { label: 'Chưa xong', value: dev.pending.toLocaleString('vi-VN'), tip: 'Dòng NVL đang cấp dở / chưa cấp — chưa tính vào số lệch' },
          { label: 'Sai thứ tự', value: bad.toLocaleString('vi-VN'), danger: bad > 0, tip: `Lần cấp không theo thứ tự luân chuyển của kho (FEFO / FIFO). Cùng chu kỳ: ${exp} lần cấp NVL hết hạn có QA duyệt · ${rev} lần cấp phải huỷ` },
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {!kitchens.length && <p className="p-3 text-xs text-amber-700">Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.</p>}
          {!!kitchens.length && !listQ.isLoading && !cycles.length && !cycle && (
            <p className="p-3 text-xs text-slate-500">Kho này chưa có mẻ nào ghi chu kỳ. Mở mẻ (chu kỳ · số mẻ · bồn) là báo cáo tự có.</p>
          )}
          {cycle && !rep && q.isLoading && <p className="p-3 text-xs text-slate-400">Đang tải…</p>}

          {/* NVL × MẺ — máy tính: bảng; điện thoại: mỗi NVL một dòng số, bấm mở từng mẻ */}
          {rep && f.cview === 'dash' && <CycleDashboard rows={rows} live={live} groups={groups} onOpenNvl={openNvlFromDash} />}

          {rep && f.cview === 'nvl' && <>
            <div className="sm:hidden">
              {!rows.length && <p className="px-3 py-3 text-xs text-slate-400">Chu kỳ này chưa có NVL nào trên phiếu / chưa cấp.</p>}
              {rows.length > 0 && <MobileNumHead cols={MOBILE_NVL} />}
              <div className="divide-y divide-slate-100">
                {rows.map(r => {
                  const s = rowSum(r, liveIds)
                  const open = openMat === r.material_id
                  return (
                    <div key={r.material_id} data-mat={r.material_code}>
                      <button type="button" className="w-full text-left" onClick={() => setOpenMat(open ? null : r.material_id)} aria-expanded={open}>
                        <MobileNumRow
                          head={<>
                            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                            <span className="font-mono font-semibold shrink-0">{r.material_code}</span>
                            <span className="truncate text-slate-600">{r.material_name ?? ''}</span>
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-400">{matUnitCode(r)}</span>
                          </>}
                          cells={[<span className="font-normal">{qtyNum(s.std, r)}</span>, qtyNum(s.iss, r), <span className={diffTone(s.diff, s.devPct)}>{s.diff > 0 ? '+' : s.diff < 0 ? '−' : ''}{qtyNum(Math.abs(s.diff), r)}</span>]} />
                      </button>
                      {open && (
                        <div className="bg-slate-50 px-3 py-1.5 space-y-1">
                          {groups.flatMap(g => g.batches.filter(b => r.cells[b.id]).map(b => {
                            const c = r.cells[b.id]
                            return (
                              <div key={b.id} className="flex items-center gap-1.5 text-[11px]">
                                <StageSymbol stage={b.stage} step={b.step} className="h-3 w-3" />
                                <span className="text-slate-500">{g.shift} · Mẻ {b.batch_no ?? '—'}</span>
                                <span className="ml-auto tabular-nums">{cellOf(r, b)}</span>
                                <span className="sr-only">{c.req == null ? 'ngoài phiếu' : ''}</span>
                              </div>
                            )
                          }))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="hidden sm:block">
              <ResizableTable storageKey={`production_cycle_nvl_v4_${groups.length}`} cols={nvlCols}>
                <TableBody>
                  {!rows.length && <TableEmptyRow colSpan={nvlCols.length}>Chu kỳ này chưa có NVL nào trên phiếu / chưa cấp.</TableEmptyRow>}
                  {rows.map(r => {
                    const s = rowSum(r, liveIds)
                    const lines = rowBatchLines(r, groups)
                    const dev = rowDeviations(lines)
                    const open = openNvl.has(r.material_id)
                    return (
                      <Fragment key={r.material_id}>
                        <TableRow data-mat={r.material_code} aria-expanded={open} onClick={() => toggleNvl(r.material_id)} className="cursor-pointer hover:bg-slate-50">
                          <TableCell className={`${TD} sticky left-0 z-10 bg-white truncate`} title={`${r.material_name ?? ''} — bấm để ${open ? 'thu gọn' : 'xem từng mẻ'}`}>
                            <span className="inline-flex items-center gap-1 max-w-full">
                              {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                              <span className="font-mono font-semibold">{r.material_code}</span><span className="truncate">{r.material_name ?? ''}</span>
                            </span>
                          </TableCell>
                          <TableCell className={`${TD} font-mono text-slate-500`}>{matUnitCode(r)}</TableCell>
                          <TableCell className={NUM}>{qtyNum(s.std, r)}</TableCell>
                          <TableCell className={`${NUM} ${s.sheet !== s.std ? 'text-amber-700' : 'font-normal text-slate-400'}`} title={s.sheet !== s.std ? `Phiếu khác định mức gốc ${sgn(r3(s.sheet - s.std))} ${matUnitCode(r)} — trưởng ca sửa / thêm / bỏ dòng` : 'Phiếu đúng định mức'}>{qtyNum(s.sheet, r)}</TableCell>
                          <TableCell className={NUM}>{qtyNum(s.iss, r)}</TableCell>
                          <TableCell className={`${NUM} ${diffTone(s.diff, s.devPct)}`}>{s.diff > 0 ? '+' : s.diff < 0 ? '−' : ''}{qtyNum(Math.abs(s.diff), r)}</TableCell>
                          <TableCell className={`${NUM} border-r-2 !border-r-slate-300 ${diffTone(s.diff, s.devPct)}`}>{s.devPct != null ? devLabel(s.devPct) : dash}</TableCell>
                          {groups.map(g => <TableCell key={`s_${g.shift}`} className={`${NUM} bg-slate-50/60`}>{sumCell(r, g.batches.map(b => b.id))}</TableCell>)}
                          <TableCell className={`${NUM} ${dev ? 'text-red-600' : 'text-slate-300 font-normal'}`} title={dev ? `${dev} mẻ cấp lệch khỏi mức cho phép — bấm để xem` : 'Không mẻ nào lệch'}>{dev}</TableCell>
                        </TableRow>
                        {open && lines.map(l => {
                          const pct = devPctOf(l.dev.total, l.dev.std)
                          const tone = lineCls(l.state)
                          return (
                            <TableRow key={`${r.material_id}_${l.batch.id}`} data-batch-line={l.batch.batch_code} onClick={() => navigate(`/wms/production/${l.batch.id}`)}
                              className="cursor-pointer bg-slate-50/70 hover:bg-sky-50" title={`Mở mẻ ${l.batch.batch_code}`}>
                              <TableCell colSpan={2} className={`${TD} sticky left-0 z-10 bg-slate-50 pl-7`}>
                                <span className="inline-flex items-center gap-1.5">
                                  <StageSymbol stage={l.batch.stage} step={l.batch.step} className="h-3 w-3" />
                                  <span className="text-slate-600">{l.shift} · Mẻ {l.batch.batch_no ?? '—'}</span>
                                  <span className="font-mono text-slate-500">{l.batch.batch_code}</span>
                                </span>
                              </TableCell>
                              <TableCell className={`${NUM} font-normal text-slate-600`}>{l.cell.std == null ? <span className="text-slate-400">ngoài ĐM</span> : qtyNum(l.dev.std, r)}{l.cell.tol != null && l.cell.std != null && <span className="ml-1 text-[9px] text-slate-400">±{l.cell.tol}%</span>}</TableCell>
                              <TableCell className={`${NUM} ${l.dev.edit ? 'text-amber-700' : 'font-normal text-slate-400'}`} title={l.cell.why ? `Lý do sửa: ${l.cell.why}` : undefined}>{l.cell.rm ? 'bỏ' : qtyNum(l.dev.sheet, r)}</TableCell>
                              <TableCell className={`${NUM} ${tone}`}>{qtyNum(l.dev.iss, r)}</TableCell>
                              <TableCell className={`${NUM} ${tone}`}>{sgn(l.dev.total)}</TableCell>
                              <TableCell className={`${NUM} border-r-2 !border-r-slate-300 ${tone}`}>{pct != null ? devLabel(pct) : dash}</TableCell>
                              <TableCell colSpan={groups.length + 1} className={`${TD} ${tone}`}>
                                {l.state ? LINE_STATE_LABEL[l.state] : ''}{l.dev.edit ? <span className="ml-2 text-amber-700">sửa phiếu {sgn(l.dev.edit)}{l.cell.why ? ` — ${l.cell.why}` : ''}</span> : null}
                                <span className="ml-2 text-sky-700">Mở mẻ ›</span>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </ResizableTable>
            </div>
          </>}

          {/* CA · MẺ — mỗi ca một dải chỉ số, rồi từng mẻ; cuối bảng = cả chu kỳ */}
          {rep && f.cview === 'batch' && (
            <ResizableTable storageKey="production_cycle_batch_v1" cols={BATCH_COLS}>
              <TableBody>
                {!live.length && <TableEmptyRow colSpan={BATCH_COLS.length}>Chu kỳ này chưa có mẻ.</TableEmptyRow>}
                {groups.map(g => {
                  const k = kpis.find(x => x.shift === g.shift)!
                  return [
                    <TableRow key={`h_${g.shift}`} className="bg-slate-100 hover:bg-slate-100" data-shift={g.shift}>
                      <TableCell colSpan={BATCH_COLS.length} className="px-0 py-1 text-[11px] text-slate-700 whitespace-nowrap">
                        <div className="sticky left-0 w-fit max-w-[100vw] px-2">{kpiLine(k)}</div>
                      </TableCell>
                    </TableRow>,
                    ...g.batches.map(b => {
                      const st = lineStats(rows, [b])
                      const dur = minutesBetween(b.created_at, b.filled_at)
                      return (
                        <TableRow key={b.id} className="cursor-pointer hover:bg-sky-50" onClick={() => navigate(`/wms/production/${b.id}`)} data-batch={b.batch_code}>
                          <TableCell className={`${TD} sticky left-0 z-10 bg-white`}><span className="inline-flex items-center gap-1"><StageSymbol stage={b.stage} step={b.step} />Mẻ {b.batch_no ?? '—'}</span></TableCell>
                          <TableCell className={`${TD} font-mono font-semibold`}>{b.batch_code}</TableCell>
                          <TableCell className={`${TD} truncate`} title={b.material_name ?? ''}><span className="font-mono font-semibold">{b.material_code}</span> {b.material_name ?? ''}</TableCell>
                          <TableCell className={`${TD} font-mono`}>{b.tank_code ?? dash}</TableCell>
                          <TableCell className={TD}><StageBadge stage={b.stage} step={b.step} /></TableCell>
                          <TableCell className={NUM}>{b.planned_qty != null ? <>{nf(Number(b.planned_qty))} <span className="font-normal text-slate-400">{unitCode(b.base_unit)}</span></> : dash}</TableCell>
                          <TableCell className={NUM}>{Number(b.filled_qty) ? <>{nf(Number(b.filled_qty))} <span className="font-normal text-slate-400">{unitCode(b.base_unit)}</span></> : dash}</TableCell>
                          <TableCell className={NUM}>{st.lines ? `${st.ok}/${st.lines}` : dash}</TableCell>
                          <TableCell className={`${NUM} text-amber-700`}>{n0(st.short)}</TableCell>
                          <TableCell className={NUM}>{n0(st.over, true)}</TableCell>
                          <TableCell className={NUM}>{n0(st.extra)}</TableCell>
                          <TableCell className={NUM}>{n0(Number(b.rm_bad), true)}</TableCell>
                          <TableCell className={NUM}>{n0(Number(b.rm_exp))}</TableCell>
                          <TableCell className={NUM}>{n0(Number(b.rm_rev))}</TableCell>
                          <TableCell className={`${TD} truncate`} title={whenBy(b.created_at, b.opened_by_name)}>{whenBy(b.created_at, b.opened_by_name)}</TableCell>
                          <TableCell className={`${TD} tabular-nums`}>{b.rm_first_at ? `${hm(b.rm_first_at)}–${hm(b.rm_last_at)}` : dash}</TableCell>
                          <TableCell className={`${TD} truncate`} title={whenBy(b.filled_at, b.filled_by_name)}>{b.filled_at ? whenBy(b.filled_at, b.filled_by_name) : dash}</TableCell>
                          <TableCell className={`${NUM} font-normal`}>{dur != null ? durLabel(dur) : dash}</TableCell>
                          <TableCell className={`${TD} truncate`}>{b.tank_qa_at ? whenBy(b.tank_qa_at, b.tank_qa_by_name) : dash}</TableCell>
                        </TableRow>
                      )
                    }),
                  ]
                })}
                {live.length > 0 && all && (
                  <TableRow className="bg-sky-50 hover:bg-sky-50" data-shift="__all">
                    <TableCell colSpan={BATCH_COLS.length} className="px-0 py-1.5 text-[11px] text-slate-800 whitespace-nowrap border-t-2 border-t-sky-300">
                      <div className="sticky left-0 w-fit max-w-[100vw] px-2">{kpiLine(all)}</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </ResizableTable>
          )}

          {/* NHÂN SỰ — mỗi người một dòng: đếm việc trong chu kỳ (chỉ số làm việc) */}
          {rep && f.cview === 'people' && (
            <ResizableTable storageKey="production_cycle_people_v1" cols={PEOPLE_COLS}>
              <TableBody>
                {!people.length && <TableEmptyRow colSpan={PEOPLE_COLS.length}>Chu kỳ này chưa có ai làm việc gì.</TableEmptyRow>}
                {people.map(p => (
                  <TableRow key={p.name} data-person={p.name}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white font-semibold truncate`} title={p.name}>{p.name}</TableCell>
                    <TableCell className={`${TD} truncate`}>{p.shifts.length ? p.shifts.join(', ') : dash}</TableCell>
                    <TableCell className={NUM}>{n0(p.batches)}</TableCell>
                    <TableCell className={NUM}>{n0(p.open)}</TableCell>
                    <TableCell className={NUM}>{n0(p.lead)}</TableCell>
                    <TableCell className={NUM}>{n0(p.qaok)}</TableCell>
                    <TableCell className={NUM}>{n0(p.rm)}</TableCell>
                    <TableCell className={NUM}>{n0(p.rm_batches)}</TableCell>
                    <TableCell className={NUM}>{n0(p.rm_bad, true)}</TableCell>
                    <TableCell className={NUM}>{n0(p.rm_exp)}</TableCell>
                    <TableCell className={NUM}>{n0(p.rm_rev, true)}</TableCell>
                    <TableCell className={NUM}>{n0(p.log)}</TableCell>
                    <TableCell className={NUM}>{n0(p.logok)}</TableCell>
                    <TableCell className={NUM}>{n0(p.label)}</TableCell>
                    <TableCell className={NUM}>{n0(p.pour)}</TableCell>
                    <TableCell className={NUM}>{n0(p.fill)}</TableCell>
                    <TableCell className={NUM}>{n0(p.tankqa)}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{p.first_at ? `${formatDateTime(p.first_at)} → ${formatDateTime(p.last_at ?? p.first_at)}` : dash}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ResizableTable>
          )}
        </div>
      </div>
    </div>
  )
}

