// Tab CHẤT LƯỢNG PHỤC VỤ của Dashboard (28/08) — giao ĐỦ, giao ĐÚNG HẠN, và sao do kho nhận chấm.
//
// Vì sao có tab này: app đang đo rất kỹ sản lượng, năng suất, chi phí — toàn chỉ số NỘI BỘ — mà
// không đo cái KHÁCH HÀNG nhìn thấy. Fill rate / OTIF là chỉ số số 1 của một chuỗi cung ứng.
//
// ⚠️ Điều PHẢI nói thẳng trên màn hình: nhu cầu gốc được dựng lại từ sổ sự kiện "hạ số lượng"
// (trigger bật 28/08). Chuyến TRƯỚC mốc đó không có vết nên luôn hiện giao đủ 100% — không phải
// vì kho hoàn hảo, mà vì hồi đó dữ liệu bị xoá dấu. Giấu điều này đi là để người đọc tin nhầm.
//
// 11/2026 — phong cách "trung tâm điều hành": biểu đồ đọc đúng payload /wms/service-level đã có, không thêm request.
import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard, DASH_SK } from '@/components/wms/DashboardPanel'
import { HeroPanel, HeroStat, KpiPanel, RankBars, RingMeter } from '@/components/wms/KpiCharts'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { useServiceLevel } from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatDate } from '@/utils/formatters'

const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const MONTH_START = () => `${TODAY().slice(0, 7)}-01`
/** Ngày bật ghi vết hạ số lượng — trước mốc này số "giao đủ" không có ý nghĩa. */
const TRACKING_SINCE = '2026-08-28'

const nf = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('vi-VN')
const pct = (n: number | null | undefined) => n == null ? '—' : `${Number(n).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

const WH_METRICS = [
  { key: 'on_time_pct', label: 'Đúng hạn' },
  { key: 'in_full_pct', label: 'Đủ hàng' },
  { key: 'fill_rate', label: 'Fill rate' },
] as const
type WhMetric = typeof WH_METRICS[number]['key']

/** `warehouseId` = ô chọn Kho của Dashboard (rỗng = tất cả kho trong phạm vi được phân quyền). */
export function DashboardService({ warehouseId }: { warehouseId?: string }) {
  const f = useWmsFilterStore(s => s.dashboard)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  const from = f.svcFrom || MONTH_START()
  const to = f.svcTo || TODAY()
  const q = useServiceLevel({ from, to, warehouseId })
  const s = q.data?.summary
  const [metric, setMetric] = useState<WhMetric>('on_time_pct')

  const defs: FilterDef[] = useMemo(() => [
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', pinned: true,
      from: f.svcFrom, to: f.svcTo,
      onChange: (a, b) => setDashboard({ svcFrom: a, svcTo: b }) },
  ], [f.svcFrom, f.svcTo, setDashboard])

  const beforeTracking = from < TRACKING_SINCE

  // Thấp nhất đứng đầu: câu hỏi của biểu đồ là "kho nào đang yếu"; kho chưa có số xuống cuối
  const whRows = useMemo(() => [...(q.data?.by_warehouse ?? [])]
    .sort((a, b) => (a[metric] ?? Infinity) - (b[metric] ?? Infinity))
    .map(r => ({ key: r.warehouse_id ?? r.warehouse_name, label: r.warehouse_name, value: r[metric], text: pct(r[metric]),
      title: `${r.warehouse_name}: ${nf(r.trips)} chuyến · đúng hạn ${pct(r.on_time_pct)} · đủ hàng ${pct(r.in_full_pct)} · fill rate ${pct(r.fill_rate)}` })),
  [q.data, metric])
  const shortRows = useMemo(() => [...(q.data?.top_short ?? [])]
    .sort((a, b) => b.missing - a.missing)
    .map(r => ({ key: r.material_code ?? '—', label: r.material_code ?? '—', value: r.missing, text: nf(r.missing),
      title: `${r.material_code ?? '—'}: thiếu ${nf(r.missing)} / yêu cầu ${nf(r.demand)} · ${nf(r.lines)} dòng` })),
  [q.data])

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="k-card px-3 py-2 flex flex-wrap xl:flex-nowrap items-center gap-2">
        <FilterSheetButton defs={defs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={defs} /></div>
        <span className="flex-1 min-w-2" />
        <span className="text-xs font-medium tabular-nums text-[var(--k-muted)] whitespace-nowrap">{formatDate(from)} – {formatDate(to)}</span>
      </div>

      {beforeTracking && (
        <div className="rounded-[14px] border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          Chỉ số <b>giao đủ</b> chỉ có nghĩa từ <b>{TRACKING_SINCE}</b> — mốc app bắt đầu ghi vết mỗi
          lần hạ số lượng đơn. Chuyến trước mốc đó luôn hiện 100% vì số kế hoạch đã bị sửa xuống bằng
          thực xuất, không còn dấu để so. Chỉ số <b>đúng hạn</b> và <b>sao</b> không bị ảnh hưởng.
          Ô <b>sao</b> chỉ đếm chuyến CHUYỂN KHO mà kho nhận có tích nhận — giao khách ngoài và kho
          nhận không tích nhận thì không có ai trong app để chấm.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {q.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className={`h-[104px] rounded-[14px] ${DASH_SK}`} />) : (
          <>
            <StatCard twoLines label="Giao đủ (fill rate)" value={pct(s?.fill_rate)} pct={s?.fill_rate}
              sub={`${nf(s?.shipped)} / ${nf(s?.demand)} theo yêu cầu`} />
            <StatCard twoLines label="Giao đúng hạn" value={pct(s?.on_time_pct)} pct={s?.on_time_pct}
              sub={`${nf(s?.trips)} chuyến trong kỳ`} />
            <StatCard twoLines label="Chuyến đủ hàng" value={pct(s?.in_full_pct)} pct={s?.in_full_pct}
              sub={`${nf(s?.lines_short)} dòng giao thiếu`} />
            {/* Mẫu số là chuyến THUỘC DIỆN CHẤM (chuyển kho mà kho nhận có tích nhận), KHÔNG phải
                mọi chuyến — kho nhận không tích nhận và giao khách ngoài thì không ai xem hàng
                trong app để chấm. Lấy mọi chuyến làm mẫu số là vu oan cho kho lười chấm. */}
            <StatCard twoLines label="Sao kho nhận chấm"
              value={s?.avg_stars != null ? `${Number(s.avg_stars).toFixed(2)} ★` : '—'}
              sub={!s?.ratable_trips
                ? 'không chuyến nào thuộc diện chấm'
                : `${nf(s.rated_trips)}/${nf(s.ratable_trips)} chuyến thuộc diện chấm`} />
          </>
        )}
      </div>

      {!q.isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] gap-3 sm:gap-4">
          <HeroPanel title="OTIF" hint="đúng hạn + đủ hàng"
            top={
              <div className="mt-3 flex items-center gap-4">
                <RingMeter pct={s?.otif_pct ?? null} size={104} stroke={11} color="#fff" track="rgba(255,255,255,.22)"
                  center={<span className="text-lg">{pct(s?.otif_pct)}</span>} label={`OTIF ${pct(s?.otif_pct)}`} />
                <p className="min-w-0 text-xs leading-snug text-white/85">Tỷ lệ chuyến vừa đúng hạn vừa đủ hàng trong khoảng đã chọn</p>
              </div>
            }>
            <HeroStat label="Chuyến trong kỳ" value={nf(s?.trips)} />
            <HeroStat label="Dòng giao thiếu" value={`${nf(s?.lines_short)} / ${nf(s?.lines)}`} />
          </HeroPanel>
          <KpiPanel title="So sánh kho xuất" hint="thấp nhất đứng đầu">
            <div className="px-4 sm:px-5 pt-3">
              <div className="flex w-fit rounded-[10px] border border-[var(--k-line)] overflow-hidden text-[11px] font-semibold">
                {WH_METRICS.map(m => (
                  <button key={m.key} type="button" onClick={() => setMetric(m.key)}
                    className={`px-2.5 h-7 whitespace-nowrap ${metric === m.key ? 'bg-[var(--k-brand)] text-white' : 'text-[var(--k-muted)] hover:bg-[var(--k-surface-2)]'}`}>{m.label}</button>
                ))}
              </div>
            </div>
            <RankBars rows={whRows} max={100} empty="Chưa có chuyến hoàn thành trong khoảng này." />
          </KpiPanel>
          <KpiPanel title="Mã giao thiếu nhiều nhất" hint="số lượng thiếu" className="lg:col-span-2 xl:col-span-1">
            <RankBars rows={shortRows} empty="Không có dòng nào giao thiếu — hoặc chưa có vết nào được ghi." />
          </KpiPanel>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <KpiPanel title="Theo kho xuất">
          <TableLike
            loading={q.isLoading}
            head={['Kho', 'Chuyến', 'Đúng hạn', 'Đủ hàng', 'Fill rate']}
            rows={(q.data?.by_warehouse ?? []).map(r => [
              r.warehouse_name, nf(r.trips), pct(r.on_time_pct), pct(r.in_full_pct), pct(r.fill_rate),
            ])}
            empty="Chưa có chuyến hoàn thành trong khoảng này." />
        </KpiPanel>

        <KpiPanel title="Chi tiết mã giao thiếu">
          <TableLike
            loading={q.isLoading}
            head={['Mã hàng', 'Số dòng', 'Thiếu', 'Yêu cầu']}
            rows={(q.data?.top_short ?? []).map(r => [
              r.material_code ?? '—', nf(r.lines), nf(r.missing), nf(r.demand),
            ])}
            empty="Không có dòng nào giao thiếu — hoặc chưa có vết nào được ghi." />
        </KpiPanel>
      </div>
    </div>
  )
}

function TableLike({ head, rows, loading, empty }: {
  head: string[]; rows: (string | number)[][]; loading?: boolean; empty: string
}) {
  if (loading) return <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={`h-5 w-full ${DASH_SK}`} />)}</div>
  if (!rows.length) return <div className="px-4 sm:px-5 py-4 text-xs text-[var(--k-muted)]">{empty}</div>
  return (
    <div className="overflow-auto">
      <table className="min-w-full">
        <thead>
          <tr>{head.map((h, j) => (
            <th key={h} className={`text-[11px] font-medium text-[var(--k-muted)] px-3 py-2 whitespace-nowrap ${j === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--k-line)]">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-1.5 text-[11px] whitespace-nowrap ${j === 0 ? '' : 'text-right tabular-nums font-semibold'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
