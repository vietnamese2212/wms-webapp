// BẢN ĐỒ TUYẾN CỦA MỘT XE trong panel xe (16/10, user: "thêm bản đồ có kẻ vạch từ kho đi tới các điểm giao"): ghim kho (K) + ghim điểm giao
// đánh số theo THỨ TỰ GIAO (`detail.route.order` — kho → điểm gần trước; xe chưa đo thứ tự thì theo thứ tự khách trên xe) + vạch nối
// kho → Đ1 → Đ2… Vạch là đường THẲNG giữa các điểm (thấy hướng đi + thứ tự), km của tuyến in kèm khi đã đo. Toạ độ đọc sổ của mình
// (`useDispatchPlanGeo`, cùng nguồn tab Bản đồ) — không gọi dịch vụ ngoài lúc xem; bản đồ không cuộn theo con lăn để panel cuộn được.
import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import { OSM_TILE, OSM_ATTR, OSM_SUBDOMAINS, VN_CENTER, VN_ZOOM, dotIcon, L } from '@/components/shared/leafletSetup'
import { useDispatchPlanGeo, type DispatchTrip } from '@/api/hooks'
import { depotIcon } from './DispatchMap'

const LINE = '#0369a1'   // sky-700 — cùng màu số xe

/** Panel trượt vào (Sheet) xong mới đo được khung ⇒ đợi hết hiệu ứng rồi invalidateSize + vừa khung theo kho + các điểm */
function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap()
  const key = pts.map(p => p.join(',')).join('|')
  useEffect(() => {
    const t = setTimeout(() => { map.invalidateSize(); if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 13 }) }, 320)
    return () => clearTimeout(t)
  }, [map, key]) // eslint-disable-line react-hooks/exhaustive-deps — chỉ vừa khung lại khi tập điểm đổi
  return null
}

export function TripRouteMap({ trip, planId }: { trip: DispatchTrip; planId: string }) {
  const geo = useDispatchPlanGeo(planId)
  const wh = geo.data?.warehouse ?? null
  const depot: [number, number] | null = wh?.geo_lat != null && wh.geo_lng != null ? [Number(wh.geo_lat), Number(wh.geo_lng)] : null
  const custBy = new Map((geo.data?.customers ?? []).map(c => [c.ship_to_code, c]))
  const ordered = trip.detail.route?.order?.length ? trip.detail.route.order
    : [...new Set(trip.ods.map(o => o.ship_to_code).filter((s): s is string => !!s))]
  const stops = ordered.map((code, i) => {
    const c = custBy.get(code)
    const pos: [number, number] | null = c?.geo_lat != null && c.geo_lng != null ? [Number(c.geo_lat), Number(c.geo_lng)] : null
    return { code, no: i + 1, name: trip.ods.find(o => o.ship_to_code === code)?.ship_to_name ?? c?.name ?? code, ward: trip.ods.find(o => o.ship_to_code === code)?.ward_code ?? '', pos }
  })
  const located = stops.filter(s => s.pos)
  const line: [number, number][] = [...(depot ? [depot] : []), ...located.map(s => s.pos!)]
  const route = trip.detail.route
  return (
    <div className="space-y-1.5 py-2">
      <div className="relative h-48 overflow-hidden rounded-md border border-slate-200 sm:h-56">
        <MapContainer center={VN_CENTER} zoom={VN_ZOOM} scrollWheelZoom={false} className="h-full w-full">
          <TileLayer url={OSM_TILE} attribution={OSM_ATTR} subdomains={OSM_SUBDOMAINS} />
          <Fit pts={line} />
          {line.length > 1 && <Polyline positions={line} pathOptions={{ color: LINE, weight: 3, opacity: 0.85, dashArray: '6 5' }} />}
          {depot && wh && <Marker position={depot} icon={depotIcon}><Tooltip direction="top">{wh.name} — kho xuất</Tooltip></Marker>}
          {located.map(s => (
            <Marker key={s.code} position={s.pos!} icon={dotIcon(LINE, 20, String(s.no))}>
              <Tooltip direction="top">Đ{s.no} · {s.name}{s.ward ? ` · ${s.ward}` : ''}</Tooltip>
            </Marker>
          ))}
        </MapContainer>
        {/* lớp phủ đứng trên các pane của Leaflet (z 400–700) */}
        {geo.isLoading && <div className="absolute inset-0 z-[800] flex items-center justify-center bg-white/60 text-xs text-slate-500">Đang tải bản đồ…</div>}
        {geo.isError && <div className="absolute inset-x-2 top-2 z-[800] rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">Không tải được toạ độ khách / kho</div>}
        {geo.data && !located.length && <div className="absolute inset-x-2 top-2 z-[800] rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">Khách trên xe chưa có toạ độ — định vị ở trang Khách hàng.</div>}
      </div>
      <ol className="space-y-0.5 text-[11px] text-slate-700">
        <li className="flex items-center gap-1.5"><span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-900 text-[9px] font-bold text-white">K</span>{wh?.name ?? 'Kho xuất'}{!depot && geo.data ? <span className="text-amber-700"> · chưa có ghim (Cài đặt WMS → Kho)</span> : null}</li>
        {stops.map(s => (
          <li key={s.code} className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-700 text-[9px] font-bold text-white">{s.no}</span>
            <span className="min-w-0 flex-1 truncate" title={`${s.name}${s.ward ? ` · ${s.ward}` : ''}`}>{s.name}{s.ward ? <span className="text-slate-400"> · {s.ward}</span> : null}</span>
            {!s.pos && geo.data && <span className="shrink-0 text-[10px] text-amber-700">chưa có toạ độ</span>}
          </li>
        ))}
      </ol>
      <p className="text-[10px] text-slate-500">
        Vạch nối thẳng theo thứ tự giao (kho → điểm gần trước){route ? ` · quãng đường ~${route.km.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} km` : ' · chưa đo km (tab Bản đồ → Đo km)'}
      </p>
    </div>
  )
}
