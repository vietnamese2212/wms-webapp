// Dashboard Tổng quan — bố cục console (20/08), tông SÁNG đồng bộ app + biến thể `dark:` theo chế độ tối toàn app (25/08)
// + TAB CHỦ ĐỀ Tổng quan / Nhập / Xuất / Tồn kho (user chốt 24/08).
// 11/2026 — phong cách "trung tâm điều hành" (mẫu Du lieu mau/ui kpi, user đòi đồng bộ cả module): khung .kpi-console, thẻ số StatCard,
// khối nổi bật xanh đậm, treemap tồn theo loại, xếp hạng kho, đồng hồ sức chứa.
// LOGIC SỐ LIỆU GIỮ NGUYÊN 100% (RPC dashboard_stats, gộp kho×loại, sức chứa xếp % cao nhất
// lên đầu, cap 12 kho) — tab chỉ lọc HIỂN THỊ trên cùng một lần lấy số liệu.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, PackagePlus, PackageMinus, Truck, LayoutDashboard } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardStats, type DashboardStats } from '@/api/hooks'
import { formatTimestampTime } from '@/utils/formatters'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useMobileTabs } from '@/hooks/useMobileSurface'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { DashboardProductivity } from '@/components/wms/DashboardProductivity'
import { DashboardService } from '@/components/wms/DashboardService'
import { DashboardKpi } from '@/components/wms/DashboardKpi'
import { StatCard } from '@/components/wms/DashboardPanel'
import { HeroPanel, HeroStat, KpiPanel, RankBars, RingMeter, TickGauge, Treemap } from '@/components/wms/KpiCharts'
import { QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP, unitLabel } from '@/utils/qtyUnits'
import { useCanSeePath } from '@/hooks/useCanSeePath'

type ZoneCap = NonNullable<DashboardStats['zones']>[number]

const nf = (n: number) => Number(n ?? 0).toLocaleString('vi-VN')
// Ô số: bỏ thập phân cho gọn (card hẹp trên phone) — chi tiết đủ số lẻ nằm ở bảng dưới
const nf0 = (n: number) => Math.round(Number(n ?? 0)).toLocaleString('vi-VN')

const MODE_BADGE: Record<string, string> = {
  QR:       'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  QTY:      'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  QTY_DATE: 'bg-indigo-500/20 text-indigo-400',
  NONE:     'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
}

// Chưa đầy thật thì không làm tròn lên "100%" (99.6% → 99%)
const pctText = (pct: number) => (pct >= 100 ? Math.round(pct) : pct >= 10 ? Math.min(99, Math.round(pct)) : Math.round(pct * 10) / 10)

export default function Dashboard() {
  const { data: scopedWhs = [] } = useScopedWarehouses(true)
  const whId = useWmsFilterStore(s => s.dashboard.warehouseId)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  // Kho đã chọn không còn trong scope (đổi phân quyền) → coi như "Tất cả kho"
  const effWhId = scopedWhs.length > 0 && whId && !scopedWhs.some(w => w.id === whId) ? '' : whId
  const { data: stats, isLoading, isError } = useDashboardStats(effWhId)
  // lối tắt chỉ hiện khi người xem mở được trang đích — cùng luật với menu (08/10)
  const canOpen = useCanSeePath()
  const today =new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })

  // Gộp theo kho (RPC trả dòng kho×loại) + tổng toàn scope
  const { byWarehouse, totals, byCategory } = useMemo(() => {
    const rows = stats?.inventory ?? []
    const map = new Map<string, {
      warehouse_id: string; warehouse_name: string; inventory_mode: string | null
      pallets: number; cartons: number
      cats: { category: string; pallets: number; cartons: number; materials: number }[]
    }>()
    const catMap = new Map<string, number>()
    let pallets = 0, cartons = 0
    for (const r of rows) {
      let w = map.get(r.warehouse_id)
      if (!w) {
        w = { warehouse_id: r.warehouse_id, warehouse_name: r.warehouse_name, inventory_mode: r.inventory_mode, pallets: 0, cartons: 0, cats: [] }
        map.set(r.warehouse_id, w)
      }
      w.pallets += Number(r.pallets); w.cartons += Number(r.cartons)
      w.cats.push({ category: r.category, pallets: Number(r.pallets), cartons: Number(r.cartons), materials: Number(r.materials) })
      pallets += Number(r.pallets); cartons += Number(r.cartons)
      const c = r.category || 'Chưa phân loại'
      catMap.set(c, (catMap.get(c) ?? 0) + Number(r.pallets))
    }
    // Pallet chủ đạo (30/07) → bảng kho xếp theo pallet, không theo số quy đổi trộn đơn vị
    const list = [...map.values()].sort((a, b) => b.pallets - a.pallets)
    return {
      byWarehouse: list,
      totals: { pallets, cartons, warehouses: list.length },
      byCategory: [...catMap.entries()].map(([k, value]) => ({ key: k, label: k, value })),
    }
  }, [stats])

  const t = stats?.today

  // Sức chứa khu vực: gom theo kho, kèm TỔNG kho + xếp % dùng CAO NHẤT lên đầu
  const zonesByWh = useMemo(() => {
    const map = new Map<string, { warehouse_name: string; zones: ZoneCap[]; used: number; cap: number }>()
    for (const z of stats?.zones ?? []) {
      let g = map.get(z.warehouse_id)
      if (!g) { g = { warehouse_name: z.warehouse_name, zones: [], used: 0, cap: 0 }; map.set(z.warehouse_id, g) }
      g.zones.push(z); g.used += z.used; g.cap += z.capacity
    }
    const pctOf = (g: { used: number; cap: number }) => (g.cap > 0 ? g.used / g.cap : g.used > 0 ? -1 : -2)
    return [...map.values()].sort((a, b) => pctOf(b) - pctOf(a))
  }, [stats])
  // Đồng hồ tổng: chỉ tính khu ĐÃ KHAI sức chứa — khu chưa khai mà cộng vào tử số thì % bị thổi
  const capTotal = useMemo(() => {
    const zs = (stats?.zones ?? []).filter(z => z.capacity > 0)
    const used = zs.reduce((s, z) => s + z.used, 0), cap = zs.reduce((s, z) => s + z.capacity, 0)
    return { used, cap, pct: cap > 0 ? (used / cap) * 100 : null, undeclared: (stats?.zones?.length ?? 0) - zs.length }
  }, [stats])
  // Nhiều kho (trăm kho NPP): mặc định chỉ hiện 12 kho căng nhất, còn lại sau nút "Hiện tất cả"
  const [showAllWh, setShowAllWh] = useState(false)
  const WH_SHOW_CAP = 12
  const visibleWhGroups = showAllWh ? zonesByWh : zonesByWh.slice(0, WH_SHOW_CAP)

  const sk = 'bg-slate-200 dark:bg-slate-700/50'
  const outPct = t && t.outbound_planned > 0 ? Math.min(100, Math.round((t.outbound_scanned / t.outbound_planned) * 100)) : null

  // TAB CHỦ ĐỀ (user chốt 24/08 "Dashboard có lựa để nói riêng về Nhập / Xuất / Tồn kho").
  // Chỉ LỌC HIỂN THỊ trên đúng object `stats` đã có — KHÔNG thêm hook, KHÔNG thêm request
  // (số liệu tổng hợp toàn công ty đi qua cache dashboard_all_cached; đẻ thêm lời gọi ở đây là
  // đúng cái đã làm p50 28,3s hồi 21/08). Trạng thái để local: đây là góc NHÌN, không phải bộ lọc
  // dữ liệu — filter list page mới bắt buộc vào wmsFilterStore.
  // Tab "Năng suất" (27/08) là NGOẠI LỆ: nó theo KHOẢNG NGÀY tự chọn nên có lời gọi riêng và
  // chỉ chạy khi người dùng bấm vào (component chỉ mount ở tab đó) — các tab kia vẫn dùng chung
  // một lần lấy số liệu đã cache như cũ.
  const TABS = useMemo(() => [
    { key: 'all',   label: 'Tổng quan' },
    { key: 'in',    label: 'Nhập' },
    { key: 'out',   label: 'Xuất' },
    { key: 'stock', label: 'Tồn kho' },
    { key: 'prod',  label: 'Năng suất' },
    { key: 'svc',   label: 'Dịch vụ' },
    { key: 'kpi',   label: 'KPI' },
  ] as const, [])
  type TabKey = typeof TABS[number]['key']
  const [tab, setTab] = useState<TabKey>('all')
  // Lớp thứ hai sau quyền: superadmin ẩn tab khỏi điện thoại (cờ mobile_surface, 21/09)
  const tabs = useMobileTabs('/', TABS, tab, setTab)
  // Ba tab BÁO CÁO (Năng suất, Dịch vụ, KPI) chạy theo khoảng ngày riêng và thay CẢ trang — các
  // khối "ảnh chụp hôm nay" bên dưới không hiện ở đó.
  const isReport = tab === 'prod' || tab === 'svc' || tab === 'kpi'
  const show = (k: Exclude<TabKey, 'all' | 'prod' | 'svc' | 'kpi'>) => !isReport && (tab === 'all' || tab === k)

  const remaining = Math.max(0, (t?.outbound_planned ?? 0) - (t?.outbound_scanned ?? 0))
  const outHero = (
    <HeroPanel title="Tiến độ xuất hôm nay" hint={<span title={QTY_CONVERTED_TIP}>{QTY_CONVERTED_LABEL}</span>}
      top={
        <div className="mt-3 flex items-center gap-4">
          <RingMeter pct={outPct} size={92} stroke={10} color="#fff" track="rgba(255,255,255,.22)" label={`Tiến độ xuất ${outPct ?? 0}%`} />
          <div className="min-w-0 text-sm leading-snug">
            {t?.outbound_planned
              ? <><b className="text-xl font-semibold tabular-nums">{nf0(t.outbound_scanned)}</b><span className="text-white/80"> / {nf0(t.outbound_planned)} kế hoạch</span></>
              : <span className="text-white/85">Chưa có kế hoạch xuất hôm nay</span>}
          </div>
        </div>
      }>
      <HeroStat label="Còn phải xuất" value={nf0(remaining)} title={QTY_CONVERTED_TIP} />
      <HeroStat label="Chuyến xuất" value={nf(t?.outbound_gdos ?? 0)} />
    </HeroPanel>
  )
  const quickPanel = (
    <KpiPanel title="Thao tác nhanh">
      <div className="p-3 sm:px-4 space-y-2">
        {[
          { to: '/wms/inbound', icon: PackagePlus, label: 'Nhập kho' },
          { to: '/wms/outbound', icon: PackageMinus, label: 'Xuất kho' },
          { to: '/wms/inventory', icon: Package, label: 'Xem tồn kho' },
          { to: '/tms/bookings', icon: Truck, label: 'Kế hoạch vận chuyển' },
        ].filter(q => canOpen(q.to)).map(({ to, icon: Icon, label }) => (
          <Link key={to} to={to}
            className="flex items-center gap-2 w-full h-10 px-3 rounded-[10px] border border-[var(--k-line)] text-xs font-semibold hover:bg-[var(--k-surface-2)] transition-colors">
            <Icon className="h-4 w-4 text-[var(--k-data)]" />
            {label}
          </Link>
        ))}
      </div>
    </KpiPanel>
  )

  return (
    <div className="kpi-console flex flex-col h-full bg-slate-100 dark:bg-slate-900">
      {/* Header console */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap xl:flex-nowrap">
          <span className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 shrink-0">
            <LayoutDashboard className="h-4 w-4 text-[var(--k-data)]" /> Tổng quan hệ thống
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 sm:border-l sm:border-slate-200 sm:dark:border-slate-700 sm:pl-2">{today}</span>
          {/* số liệu tổng công ty nhớ 30 phút (11/10) — nói tuổi số liệu như Giám sát vận hành, không để người xem tưởng là sống */}
          {stats?.computed_at && <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">· Số liệu lúc {formatTimestampTime(stats.computed_at)}</span>}
          <span className="flex-1" />
          <WarehouseSingleSelect
            warehouses={scopedWhs as { id: string; code?: string; name: string }[]}
            value={effWhId}
            onChange={id => setDashboard({ warehouseId: id })}
            allLabel="Tất cả kho"
            triggerClassName="w-40 sm:w-48 h-8"
          />
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <div className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Dữ liệu thời gian thực</span>
          </div>
        </div>
        {/* Chọn CHỦ ĐỀ — cùng một lần lấy số liệu, chỉ đổi phần đang xem.
            ĐIỆN THOẠI: 7 tab cần ~428 px mà chỗ chỉ có 336 px, dải liền mạch ép nhãn XUỐNG DÒNG
            ("Tổng/quan", "Năng/suất" — đo 12/09). Cắt cho cuộn ngang thì lại giấu mất tab. ⇒ mobile
            tách thành CHIP rời tự xuống hàng, mọi tab thấy đủ và nhãn giữ một dòng; desktop giữ
            nguyên dải liền. */}
        <div className="mt-1.5 flex flex-wrap gap-1 text-xs font-semibold sm:w-fit sm:flex-nowrap sm:gap-0 sm:rounded-[10px] sm:border sm:border-slate-200 sm:dark:border-slate-700 sm:overflow-hidden">
          {tabs.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`whitespace-nowrap rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 transition-colors sm:rounded-none sm:border-0 sm:border-l sm:first:border-l-0 ${
                tab === key
                  ? 'bg-[var(--k-brand)] text-white'
                  : 'bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4 pb-20 lg:pb-4 space-y-3 sm:space-y-4">
        {isError && !isReport && (
          <div className="rounded-[14px] border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
            Không tải được số liệu dashboard — thử tải lại trang.
          </div>
        )}

        {tab === 'prod' && <DashboardProductivity warehouseId={effWhId} />}
        {tab === 'svc'  && <DashboardService warehouseId={effWhId} />}
        {tab === 'kpi'  && <DashboardKpi warehouseId={effWhId} />}

        {/* Thẻ số — mọi số của "hôm nay" và tồn */}
        {!isReport && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className={`h-[104px] rounded-[14px] ${sk}`} />)
            ) : (
              <>
                {show('stock') && <>
                  {/* PALLET = số CHỦ ĐẠO (user chốt 30/07): đơn vị vật lý duy nhất so được giữa mọi loại hàng */}
                  <StatCard label="Pallet tồn" value={nf0(totals.pallets)} sub={`${totals.warehouses} kho có tồn`} />
                  <StatCard label="Kho có tồn" value={String(totals.warehouses)} />
                  {/* Tồn TÁCH THEO ĐƠN VỊ — RPC cũ chưa có by_unit → fallback ô quy đổi */}
                  {(stats?.by_unit?.length ?? 0) > 0 ? (
                    <div className="k-card col-span-2 lg:col-span-1 px-4 pb-3 pt-3.5">
                      <div className="text-[13px] font-semibold leading-snug mb-1.5">Tồn theo đơn vị</div>
                      <div className="space-y-0.5">
                        {stats!.by_unit!.map(u => (
                          <div key={u.unit} className="flex items-baseline justify-between gap-1.5 min-w-0" title={`${nf(u.qty)} ${unitLabel(u.unit)} · ${nf(u.pallets)} pallet · ${nf(u.materials)} mã`}>
                            <span className="text-[11px] text-[var(--k-muted)] truncate">{unitLabel(u.unit)}</span>
                            <span className="text-xs font-semibold tabular-nums">{nf0(u.qty)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <StatCard label="Tồn (quy đổi)" value={nf0(totals.cartons)} className="col-span-2 lg:col-span-1" />
                  )}
                </>}
                {show('out') && (
                  <StatCard label="Xuất hôm nay" value={nf0(t?.outbound_scanned ?? 0)}
                    unit={t?.outbound_planned ? `/ ${nf0(t.outbound_planned)} KH` : 'SL quy đổi'}
                    pct={outPct} tone={outPct != null && outPct >= 100 ? 'ok' : undefined} />
                )}
                {show('in') && <>
                  <StatCard label="Phiếu nhập hôm nay" value={nf(t?.inbound_orders ?? 0)} />
                  <StatCard label="SL nhập (quy đổi)" value={nf(t?.inbound_cartons ?? 0)} title={QTY_CONVERTED_TIP} />
                </>}
                {show('out') && <>
                  <StatCard label="Chuyến xuất hôm nay" value={nf(t?.outbound_gdos ?? 0)} />
                  <StatCard label="SL KH xuất (quy đổi)" value={nf(t?.outbound_planned ?? 0)} title={QTY_CONVERTED_TIP} />
                </>}
              </>
            )}
          </div>
        )}

        {/* Hàng biểu đồ: tiến độ xuất · tồn theo loại · pallet theo kho */}
        {!isReport && !isLoading && (show('out') || show('stock')) && (
          <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${tab === 'all'
            ? 'lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]'
            : tab === 'stock' ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}>
            {show('out') && outHero}
            {show('stock') && (
              <KpiPanel title="Tồn theo loại hàng" hint={`${nf0(totals.pallets)} pallet`}>
                <Treemap items={byCategory} unit="pallet" />
              </KpiPanel>
            )}
            {show('stock') && (
              <KpiPanel title="Pallet theo kho" hint={`${totals.warehouses} kho`} className={tab === 'all' ? 'lg:col-span-2 xl:col-span-1' : ''}>
                <RankBars empty="Chưa có tồn kho trong phạm vi của bạn."
                  rows={byWarehouse.map(w => ({ key: w.warehouse_id, label: w.warehouse_name, value: w.pallets, text: nf(w.pallets),
                    title: `${w.warehouse_name}: ${nf(w.pallets)} pallet — ${w.cats.map(c => `${c.category} ${nf(c.pallets)}`).join(' · ')}` }))} />
              </KpiPanel>
            )}
            {tab === 'out' && quickPanel}
          </div>
        )}

        {/* Sức chứa khu vực kho: pallet đang chiếm chỗ / pallet tối đa (Σ max_pallets vị trí) */}
        {show('stock') && (isLoading || zonesByWh.length > 0) && (
          <KpiPanel title="Sức chứa khu vực kho" hint="pallet tồn / pallet tối đa">
            {isLoading ? (
              <div className="p-4 space-y-1.5">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className={`h-6 rounded ${sk}`} />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)]">
                <div className="flex flex-col justify-center gap-1 border-b border-[var(--k-line)] px-4 py-3 xl:border-b-0 xl:border-r">
                  <TickGauge value={capTotal.pct} marks={[80]}
                    label={capTotal.pct == null ? '—' : `${pctText(capTotal.pct)}%`}
                    sub={capTotal.cap > 0 ? `${nf(capTotal.used)} / ${nf(capTotal.cap)} pallet` : 'chưa khai sức chứa'} />
                  <p className="text-center text-[11px] leading-snug text-[var(--k-muted)]">
                    Vạch đậm: mốc 80%{capTotal.undeclared > 0 ? ` · ${capTotal.undeclared} khu chưa khai nên không tính` : ''}
                  </p>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3">
                    {visibleWhGroups.map(g => {
                      const tUsed = g.used, tCap = g.cap
                      return (
                        <div key={g.warehouse_name} className="self-start min-w-0">
                          <div className="flex items-baseline justify-between gap-2 border-b border-[var(--k-line)] pb-1">
                            <p className="text-xs font-semibold truncate">{g.warehouse_name}</p>
                            <p className="shrink-0 text-[11px] tabular-nums text-[var(--k-muted)]">
                              {nf(tUsed)} / {tCap > 0 ? nf(tCap) : '—'}
                            </p>
                          </div>
                          {g.zones.map(z => {
                            const pct = z.capacity > 0 ? (z.used / z.capacity) * 100 : null
                            const barColor = pct == null ? 'var(--k-none)'
                              : pct >= 100 ? 'var(--k-bad)'
                              : pct >= 80 ? 'var(--k-warn)'
                              : 'var(--k-data)'
                            const pctTxt = pct == null ? null : pctText(pct)
                            return (
                              <div key={z.zone_id} className="flex items-center gap-2 py-1 border-b border-[var(--k-line)] last:border-0"
                                title={`${z.name} (${z.code})${z.category ? ` · ${z.category}` : ''} — ${pct == null
                                  ? 'chưa khai pallet tối đa'
                                  : `${pctTxt}% đã dùng · còn ${nf(Math.max(0, z.capacity - z.used))} chỗ`}`}>
                                <p className="flex-1 min-w-0 truncate text-[11px]">
                                  {z.name}<span className="ml-1 text-[10px] text-[var(--k-muted)]">{z.code}</span>
                                </p>
                                {/* Mobile ẩn bar — nhường chỗ cho TÊN khu (360px tên bị cắt) */}
                                <div className="hidden sm:block w-14 shrink-0 h-1.5 overflow-hidden rounded-full bg-[var(--k-line)]">
                                  <div className="h-full rounded-full" style={{ width: `${pct == null ? 0 : Math.min(100, pct)}%`, background: barColor }} />
                                </div>
                                <p className="w-[104px] shrink-0 whitespace-nowrap text-right text-[11px] font-medium tabular-nums">
                                  {nf(z.used)}<span className="font-normal text-[var(--k-muted)]"> / {z.capacity > 0 ? nf(z.capacity) : '—'}</span>
                                </p>
                                <p className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums"
                                  style={{ color: pct == null ? 'var(--k-muted)' : pct >= 100 ? 'var(--k-bad)' : pct >= 80 ? 'var(--k-warn)' : 'var(--k-muted)' }}>
                                  {pct == null ? '—' : `${pctTxt}%`}
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                  {zonesByWh.length > WH_SHOW_CAP && (
                    <button type="button" onClick={() => setShowAllWh(v => !v)}
                      className="mt-2 w-full rounded-[10px] border border-[var(--k-line)] py-1.5 text-[11px] font-medium text-[var(--k-muted)] hover:bg-[var(--k-surface-2)]">
                      {showAllWh ? 'Thu gọn' : `Hiện tất cả ${zonesByWh.length} kho (đang hiện ${WH_SHOW_CAP} kho căng chỗ nhất)`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </KpiPanel>
        )}

        {!isReport && tab !== 'out' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            {/* Bảng tồn theo kho — chỉ thuộc chủ đề TỒN KHO; "Thao tác nhanh" luôn hiện (điều hướng) */}
            <div className={show('stock') ? 'lg:col-span-2 min-w-0' : 'hidden'}>
              <KpiPanel title="Tồn kho theo kho"
                right={canOpen('/wms/inventory') ? <Link to="/wms/inventory" className="text-[11px] font-medium text-[var(--k-data)] hover:underline">Xem chi tiết →</Link> : undefined}>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={`h-9 ${sk}`} />)}
                  </div>
                ) : byWarehouse.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-[var(--k-muted)]">Chưa có tồn kho trong phạm vi của bạn</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px]">
                      <thead>
                        <tr className="border-b border-[var(--k-line)]">
                          <th className="px-3 py-2 text-left text-[11px] font-medium text-[var(--k-muted)] whitespace-nowrap">Kho</th>
                          <th className="px-3 py-2 text-left text-[11px] font-medium text-[var(--k-muted)] whitespace-nowrap">Loại hàng</th>
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-[var(--k-muted)] whitespace-nowrap">Pallet</th>
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-[var(--k-muted)] whitespace-nowrap" title={QTY_CONVERTED_TIP}>{QTY_CONVERTED_LABEL}</th>
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-[var(--k-muted)] whitespace-nowrap">Mã hàng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byWarehouse.map(w => (
                          w.cats.map((c, ci) => (
                            <tr key={`${w.warehouse_id}-${c.category}`} className={`border-b border-[var(--k-line)] hover:bg-[var(--k-surface-2)] ${ci === 0 ? '[&_td]:border-t [&_td]:border-t-[var(--k-none)]' : ''}`}>
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                {ci === 0 && (
                                  <span className="flex items-center gap-1.5">
                                    <span className="max-w-[200px] truncate text-xs font-semibold" title={w.warehouse_name}>{w.warehouse_name}</span>
                                    {w.inventory_mode && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${MODE_BADGE[w.inventory_mode] ?? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>{w.inventory_mode}</span>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-[11px] text-[var(--k-muted)] whitespace-nowrap">{c.category}</td>
                              <td className="px-3 py-1.5 text-[11px] text-right font-semibold tabular-nums whitespace-nowrap">{nf(c.pallets)}</td>
                              <td className="px-3 py-1.5 text-[11px] text-right font-semibold tabular-nums whitespace-nowrap">{nf(c.cartons)}</td>
                              <td className="px-3 py-1.5 text-[11px] text-right tabular-nums text-[var(--k-muted)] whitespace-nowrap">{nf(c.materials)}</td>
                            </tr>
                          ))
                        ))}
                        <tr className="bg-[var(--k-surface-2)] font-semibold">
                          <td className="px-3 py-2 text-xs" colSpan={2}>Tổng ({totals.warehouses} kho)</td>
                          <td className="px-3 py-2 text-xs text-right tabular-nums">{nf(totals.pallets)}</td>
                          <td className="px-3 py-2 text-xs text-right tabular-nums">{nf(totals.cartons)}</td>
                          <td className="px-3 py-2" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </KpiPanel>
            </div>

            {/* Thao tác nhanh — ẩn ở các tab báo cáo; tab Xuất đặt cạnh tiến độ ở hàng biểu đồ */}
            <div className="min-w-0">{quickPanel}</div>
          </div>
        )}
      </div>
    </div>
  )
}
