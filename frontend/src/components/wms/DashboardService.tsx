// Tab CHẤT LƯỢNG PHỤC VỤ của Dashboard (28/08) — giao ĐỦ, giao ĐÚNG HẠN, và sao do kho nhận chấm.
//
// Vì sao có tab này: app đang đo rất kỹ sản lượng, năng suất, chi phí — toàn chỉ số NỘI BỘ — mà
// không đo cái KHÁCH HÀNG nhìn thấy. Fill rate / OTIF là chỉ số số 1 của một chuỗi cung ứng.
//
// ⚠️ Điều PHẢI nói thẳng trên màn hình: nhu cầu gốc được dựng lại từ sổ sự kiện "hạ số lượng"
// (trigger bật 28/08). Chuyến TRƯỚC mốc đó không có vết nên luôn hiện giao đủ 100% — không phải
// vì kho hoàn hảo, mà vì hồi đó dữ liệu bị xoá dấu. Giấu điều này đi là để người đọc tin nhầm.
import { useMemo } from 'react'
import { Truck, PackageCheck, Timer, Star, AlertTriangle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DashPanel, DashTile, DASH_SK } from '@/components/wms/DashboardPanel'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { useServiceLevel } from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'

const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const MONTH_START = () => `${TODAY().slice(0, 7)}-01`
/** Ngày bật ghi vết hạ số lượng — trước mốc này số "giao đủ" không có ý nghĩa. */
const TRACKING_SINCE = '2026-08-28'

const nf = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('vi-VN')
const pct = (n: number | null | undefined) => n == null ? '—' : `${Number(n).toFixed(1)}%`

export function DashboardService() {
  const f = useWmsFilterStore(s => s.dashboard)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  const from = f.svcFrom || MONTH_START()
  const to = f.svcTo || TODAY()
  const q = useServiceLevel({ from, to })
  const s = q.data?.summary

  const defs: FilterDef[] = useMemo(() => [
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', pinned: true,
      from: f.svcFrom, to: f.svcTo,
      onChange: (a, b) => setDashboard({ svcFrom: a, svcTo: b }) },
  ], [f.svcFrom, f.svcTo, setDashboard])

  const beforeTracking = from < TRACKING_SINCE

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterSheetButton defs={defs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={defs} /></div>
        <span className="text-[11px] text-slate-500">{from} → {to}</span>
      </div>

      {beforeTracking && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          Chỉ số <b>giao đủ</b> chỉ có nghĩa từ <b>{TRACKING_SINCE}</b> — mốc app bắt đầu ghi vết mỗi
          lần hạ số lượng đơn. Chuyến trước mốc đó luôn hiện 100% vì số kế hoạch đã bị sửa xuống bằng
          thực xuất, không còn dấu để so. Chỉ số <b>đúng hạn</b> và <b>sao</b> không bị ảnh hưởng.
        </div>
      )}

      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-2">
        {q.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className={`h-[84px] rounded-lg ${DASH_SK}`} />) : (
          <>
            <DashTile icon={PackageCheck} tone="text-sky-500" label="Giao đủ (fill rate)" value={pct(s?.fill_rate)}
              sub={`${nf(s?.shipped)} / ${nf(s?.demand)} theo yêu cầu`} />
            <DashTile icon={Timer} tone="text-green-500" label="Giao đúng hạn" value={pct(s?.on_time_pct)}
              sub={`${nf(s?.trips)} chuyến trong kỳ`} />
            <DashTile icon={Truck} tone="text-blue-500" label="OTIF (đúng hạn + đủ)" value={pct(s?.otif_pct)}
              sub={`${nf(s?.lines_short)} dòng giao thiếu`} />
            <DashTile icon={Star} tone="text-amber-500" label="Sao kho nhận chấm"
              value={s?.avg_stars != null ? `${Number(s.avg_stars).toFixed(2)} ★` : '—'}
              sub={s?.rated_trips ? `${nf(s.rated_trips)} chuyến đã chấm` : 'chưa có đánh giá nào'} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DashPanel title="Theo kho xuất" icon={Truck}>
          <TableLike
            loading={q.isLoading}
            head={['Kho', 'Chuyến', 'Đúng hạn', 'Đủ hàng', 'Fill rate']}
            rows={(q.data?.by_warehouse ?? []).map(r => [
              r.warehouse_name, nf(r.trips), pct(r.on_time_pct), pct(r.in_full_pct), pct(r.fill_rate),
            ])}
            empty="Chưa có chuyến hoàn thành trong khoảng này." />
        </DashPanel>

        <DashPanel title="Mã hàng giao thiếu nhiều nhất" icon={AlertTriangle}>
          <TableLike
            loading={q.isLoading}
            head={['Mã hàng', 'Số dòng', 'Thiếu', 'Yêu cầu']}
            rows={(q.data?.top_short ?? []).map(r => [
              r.material_code ?? '—', nf(r.lines), nf(r.missing), nf(r.demand),
            ])}
            empty="Không có dòng nào giao thiếu — hoặc chưa có vết nào được ghi." />
        </DashPanel>
      </div>
    </div>
  )
}

function TableLike({ head, rows, loading, empty }: {
  head: string[]; rows: (string | number)[][]; loading?: boolean; empty: string
}) {
  if (loading) return <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={`h-5 w-full ${DASH_SK}`} />)}</div>
  if (!rows.length) return <div className="px-3 py-4 text-[11px] text-slate-400">{empty}</div>
  return (
    <div className="overflow-auto">
      <table className="min-w-full">
        <thead>
          <tr>{head.map(h => (
            <th key={h} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-left">{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-700/60">
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1 text-[10px] whitespace-nowrap ${j === 0 ? '' : 'tabular-nums font-semibold'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
