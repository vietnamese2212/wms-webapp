// TAB BẢN ĐỒ của Điều vận (01/10, đợt 1 "điều vận trên bản đồ" — CHỈ XEM): ghim mỗi khách của kế hoạch, tô màu theo xe đang chở,
// khách ở khung chờ màu xám; bấm ghim → xe nào chở, mở panel xe. Khách chưa có toạ độ liệt kê ở cột bên để đi định vị.
// Toạ độ đọc từ Customer.geo_* (của mình) — không gọi dịch vụ ngoài lúc xem. Đợt 2: đường đi, km, gộp theo đường vòng.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { MapPin, ExternalLink, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { OSM_TILE, OSM_ATTR, OSM_SUBDOMAINS, VN_CENTER, VN_ZOOM, dotIcon, L } from '@/components/shared/leafletSetup'
import { useDispatchPlanGeo, useMeasurePlanGeo, GEO_SOURCE_VI, type DispatchPlan, type DispatchTrip, type GeoDist } from '@/api/hooks'

/** Ghim KHO: ô vuông tối chữ K — khác hẳn ghim tròn của khách */
const depotIcon = L.divIcon({ className: '', html: '<div style="width:22px;height:22px;border-radius:4px;background:#0f172a;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);color:#fff;font:700 11px/18px system-ui;text-align:center">K</div>', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -11] })
const kmText = (d: GeoDist | null | undefined) => d ? `${d.km.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km${d.source === 'HAVERSINE' ? ' (ước lượng)' : d.minutes != null ? ` · ${Math.round(d.minutes)} phút` : ''}` : ''
const apiMsg = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Lỗi không rõ'

const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#be123c', '#854d0e', '#1d4ed8']
const POOL = '#64748b'
const nf = (n: number | string | null | undefined, d = 1) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: d })
const tripLabel = (t: DispatchTrip) => `#${t.seq} · ${t.detail.vehicle_model?.name ?? 'chưa chọn xe'}`

/** Khung bản đồ mở trong tab ẩn ⇒ phải invalidateSize; có ghim thì vừa khung theo mọi ghim (một lần khi số ghim đổi). */
function FitPins({ points }: { points: [number, number][] }) {
  const map = useMap()
  const n = points.length
  useEffect(() => {
    const t = setTimeout(() => { map.invalidateSize(); if (n) map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 13 }) }, 80)
    return () => clearTimeout(t)
  }, [map, n]) // eslint-disable-line react-hooks/exhaustive-deps — chỉ vừa khung lại khi SỐ ghim đổi, không mỗi lần render
  return null
}
function FlyTo({ to }: { to: [number, number] | null }) {
  const map = useMap()
  useEffect(() => { if (to) map.flyTo(to, Math.max(map.getZoom(), 14)) }, [to, map])
  return null
}

export function DispatchMap({ plan, canPlan, onOpenTrip }: { plan: DispatchPlan; canPlan: boolean; onOpenTrip: (id: string) => void }) {
  const geo = useDispatchPlanGeo(plan.id)
  const measure = useMeasurePlanGeo()
  const wh = geo.data?.warehouse ?? null
  const depot: [number, number] | null = wh?.geo_lat != null && wh.geo_lng != null ? [Number(wh.geo_lat), Number(wh.geo_lng)] : null
  const doMeasure = () => measure.mutateAsync(plan.id)
    .then(r => toast({ title: `Đã đo ${r.measured.toLocaleString('vi-VN')} cặp km đường bộ`, description: `${r.calls} lượt gọi · ${r.failed} cặp không tìm được đường${r.pending ? ` · còn ${r.pending.toLocaleString('vi-VN')} cặp — bấm Đo km lần nữa` : ' · đã đo đủ'}` }))
    .catch(e => toast({ variant: 'destructive', title: 'Không đo được km', description: apiMsg(e) }))
  const trips = useMemo(() => plan.trips.filter(t => t.status !== 'DISCARDED' && t.ods.length > 0).sort((a, b) => a.seq - b.seq), [plan])
  const colorOf = useMemo(() => new Map(trips.map((t, i) => [t.id, PALETTE[i % PALETTE.length]])), [trips])
  // khách → xe chở (một khách có thể nằm trên nhiều xe) + số OD ở khung chờ
  const byCust = useMemo(() => {
    const m = new Map<string, { trips: DispatchTrip[]; pallets: number; pool: number }>()
    const at = (k: string) => { const v = m.get(k) ?? { trips: [], pallets: 0, pool: 0 }; m.set(k, v); return v }
    for (const t of trips) for (const o of t.ods) { if (!o.ship_to_code) continue; const v = at(o.ship_to_code); if (!v.trips.includes(t)) v.trips.push(t); v.pallets += Number(o.pallets ?? 0) }
    for (const o of plan.pool ?? []) { if (!o.ship_to_code) continue; const v = at(o.ship_to_code); v.pool++; v.pallets += Number(o.pallets ?? 0) }
    return m
  }, [trips, plan.pool])
  const custs = geo.data?.customers ?? []
  const located = useMemo(() => custs.filter(c => c.geo_lat != null && c.geo_lng != null), [custs])
  const missing = useMemo(() => custs.filter(c => c.geo_lat == null).sort((a, b) => (byCust.get(b.ship_to_code)?.pallets ?? 0) - (byCust.get(a.ship_to_code)?.pallets ?? 0)), [custs, byCust])
  const [focus, setFocus] = useState<[number, number] | null>(null)
  const pinOfTrip = (t: DispatchTrip): [number, number] | null => {
    const c = located.find(x => t.ods.some(o => o.ship_to_code === x.ship_to_code))
    return c ? [c.geo_lat!, c.geo_lng!] : null
  }
  const tripsWithPin = useMemo(() => new Set(trips.filter(t => located.some(x => t.ods.some(o => o.ship_to_code === x.ship_to_code))).map(t => t.id)), [trips, located])

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0">
      <div className="relative flex-1 min-h-[55vh] lg:min-h-0">
        <MapContainer center={VN_CENTER} zoom={VN_ZOOM} scrollWheelZoom className="h-full w-full">
          <TileLayer url={OSM_TILE} attribution={OSM_ATTR} subdomains={OSM_SUBDOMAINS} />
          <FitPins points={[...(depot ? [depot] : []), ...located.map(c => [c.geo_lat!, c.geo_lng!] as [number, number])]} />
          <FlyTo to={focus} />
          {depot && wh && (
            <Marker position={depot} icon={depotIcon}>
              <Popup><div className="text-xs"><div className="font-semibold text-slate-800">{wh.name}</div><div className="text-[10px] text-slate-500">Kho xuất · {wh.code}{wh.geo_source ? ` · ${GEO_SOURCE_VI[wh.geo_source]}` : ''}</div></div></Popup>
            </Marker>
          )}
          {located.map(c => {
            const info = byCust.get(c.ship_to_code)
            const first = info?.trips[0]
            const color = first ? (colorOf.get(first.id) ?? POOL) : POOL
            return (
              <Marker key={c.ship_to_code} position={[c.geo_lat!, c.geo_lng!]} icon={dotIcon(color, 18, first ? String(first.seq) : '')}>
                <Popup>
                  <div className="text-xs space-y-1 min-w-[180px]">
                    <div className="font-semibold text-slate-800">{c.name}</div>
                    <div className="font-mono text-[10px] text-slate-500">{c.ship_to_code} · {nf(info?.pallets)} pl · {c.geo_source ? GEO_SOURCE_VI[c.geo_source] : ''}{c.geo_accuracy_m != null ? ` ±${Math.round(c.geo_accuracy_m)} m` : ''}</div>
                    {c.from_wh && <div className="text-[10px] text-slate-600">Từ kho: {kmText(c.from_wh)}</div>}
                    {(info?.trips ?? []).map(t => (
                      <button key={t.id} type="button" onClick={() => onOpenTrip(t.id)}
                        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-slate-100">
                        <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorOf.get(t.id) }} />
                        <span className="truncate">{tripLabel(t)}</span>
                        <span className="ml-auto tabular-nums text-slate-500">{nf(t.pallets)} pl</span>
                      </button>
                    ))}
                    {!!info?.pool && <div className="text-amber-700">{info.pool} OD ở khung chờ</div>}
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
        {/* lớp phủ phải đứng TRÊN các pane của Leaflet (z-index 400–700) — không thì băng báo nằm dưới ô nền, chỉ máy đọc được chữ */}
        {geo.isLoading && <div className="absolute inset-0 z-[800] flex items-center justify-center bg-white/60 text-xs text-slate-500">Đang tải toạ độ…</div>}
        {!geo.isLoading && custs.length > 0 && !located.length && (
          <div className="absolute inset-x-2 top-2 z-[800] mx-auto w-fit max-w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow">
            Chưa khách nào của kế hoạch có toạ độ — định vị ở trang Khách hàng (chấm tay, GPS, hoặc máy định vị).
          </div>
        )}
      </div>
      {/* Cột bên: xe (chú giải màu) + khách chưa định vị. Trên điện thoại nằm dưới bản đồ, cuộn chung trang. */}
      <aside className="lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l bg-white flex flex-col min-h-0 lg:overflow-y-auto">
        <div className="px-3 py-2 border-b text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
          <MapPin className="h-3.5 w-3.5 text-sky-600 shrink-0" />
          <span><b>{located.length}</b>/{custs.length} khách có ghim · <b>{trips.length}</b> xe</span>
          {/* ĐO KM đường bộ (02/10): nút nói thẳng số cặp còn thiếu + lý do chưa đo được (kho chưa ghim / chưa có khoá) */}
          {canPlan && geo.data && (
            <Button size="sm" variant="outline" className="ml-auto h-7 text-[11px]" disabled={measure.isPending || !depot || !geo.data.measure.provider.ready || !geo.data.measure.pending}
              title={!depot ? 'Kho chưa có ghim — chấm ở Cài đặt WMS → Kho' : !geo.data.measure.provider.ready ? (geo.data.measure.provider.reason ?? '') : geo.data.measure.pending ? `Đo ${geo.data.measure.pending.toLocaleString('vi-VN')} cặp kho→khách, khách↔khách (dưới 80 km) bằng Goong, ghi sổ dùng lại` : 'Mọi cặp đã có số đo'}
              onClick={() => void doMeasure()}>
              <Ruler className="h-3.5 w-3.5 mr-1" />{measure.isPending ? 'Đang đo…' : `Đo km${geo.data.measure.pending ? ` (${geo.data.measure.pending.toLocaleString('vi-VN')})` : ''}`}
            </Button>
          )}
        </div>
        {geo.data && !depot && <div className="px-3 py-1.5 border-b bg-amber-50 text-[11px] text-amber-900">{wh?.name ?? 'Kho xuất'} chưa có ghim trên bản đồ — chấm ở Cài đặt WMS → Kho để đo km từ kho.</div>}
        <div className="px-2 py-1.5 space-y-0.5">
          {trips.map(t => {
            const pin = pinOfTrip(t)
            return (
              <div key={t.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-slate-50">
                <button type="button" className="flex items-center gap-1.5 flex-1 min-w-0 text-left" disabled={!pin} onClick={() => { if (pin) setFocus([...pin]) }} title={pin ? 'Bay tới ghim của xe' : 'Khách trên xe chưa có toạ độ'}>
                  <span className="inline-block h-3 w-3 rounded-full shrink-0 border border-white shadow" style={{ background: colorOf.get(t.id) }} />
                  <span className={`truncate text-[11px] ${tripsWithPin.has(t.id) ? 'text-slate-700' : 'text-slate-400'}`}>{tripLabel(t)}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-slate-500 whitespace-nowrap">{nf(t.pallets)} pl · {t.load_pct == null ? '—' : `${nf(t.load_pct, 0)}%`}</span>
                </button>
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Mở panel xe" onClick={() => onOpenTrip(t.id)}><ExternalLink className="h-3.5 w-3.5" /></button>
              </div>
            )
          })}
          {!trips.length && <p className="px-1.5 py-3 text-[11px] text-slate-400">Chưa có xe nào — ghép xe ở tab Xem đơn trước.</p>}
        </div>
        {missing.length > 0 && (
          <div className="border-t px-3 py-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-800">
              <span>{missing.length} khách chưa định vị</span>
              <Link to="/masterdata/customers" className="text-sky-700 hover:underline font-normal">Khách hàng →</Link>
            </div>
            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
              {missing.slice(0, 50).map(c => (
                <li key={c.ship_to_code} className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-slate-400 shrink-0">{c.ship_to_code}</span>
                  <span className="truncate flex-1 min-w-0">{c.name}</span>
                  <span className="tabular-nums text-slate-400 shrink-0">{nf(byCust.get(c.ship_to_code)?.pallets)} pl</span>
                </li>
              ))}
              {missing.length > 50 && <li className="text-slate-400">… và {missing.length - 50} khách nữa</li>}
            </ul>
          </div>
        )}
      </aside>
    </div>
  )
}
