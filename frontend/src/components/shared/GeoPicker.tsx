// Ô ĐỊNH VỊ ĐIỂM GIAO (01/10, điều vận trên bản đồ — đợt 1): một ô dữ liệu, ba cách ghi —
//   chấm trên bản đồ (MANUAL) · lấy GPS điện thoại tại chỗ (GPS) · máy định vị từ địa chỉ (GOONG, chạy ở trang danh sách).
// Nguồn do NGƯỜI thắng máy. Lưu bằng cửa riêng (customers.locate) — không đi chung nút Lưu hồ sơ, vì người điều vận / tài xế
// dời ghim mà không được sửa hồ sơ khách. Dùng trong FormSheet (inline, không portal ⇒ kéo thả bình thường).
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import type { Marker as LMarker } from 'leaflet'
import { Crosshair, MapPin, Trash2, LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OSM_TILE, OSM_ATTR, OSM_SUBDOMAINS, VN_CENTER, VN_ZOOM } from './leafletSetup'
import { GEO_SOURCE_VI, type CustomerGeoSource } from '@/api/hooks'
import { formatDateTime } from '@/utils/formatters'

export interface GeoValue { lat: number; lng: number }
export interface GeoMeta { source: CustomerGeoSource | null; accuracy_m: number | null; at: string | null; by: string | null }
type Draft = GeoValue & { source: 'MANUAL' | 'GPS'; accuracy_m: number | null }

const PIN_ZOOM = 16

/** Bản đồ nằm trong panel trượt: lúc mount khung còn 0 px ⇒ phải invalidateSize sau khi panel mở; ghim đổi thì bay tới ghim. */
function Viewport({ at }: { at: GeoValue | null }) {
  const map = useMap()
  useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 80); return () => clearTimeout(t) }, [map])
  useEffect(() => { if (at) map.setView([at.lat, at.lng], Math.max(map.getZoom(), PIN_ZOOM)) }, [at, map])
  return null
}
function ClickToPin({ enabled, onPick }: { enabled: boolean; onPick: (p: GeoValue) => void }) {
  useMapEvents({ click: e => { if (enabled) onPick({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) }) } })
  return null
}
const round6 = (n: number) => Number(n.toFixed(6))

export function GeoPicker({ value, meta, address, canEdit, saving, onSave }: {
  value: GeoValue | null
  meta: GeoMeta
  address?: string | null
  canEdit: boolean
  saving: boolean
  onSave: (p: Draft | null) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [gpsErr, setGpsErr] = useState('')
  const [locating, setLocating] = useState(false)
  useEffect(() => { setDraft(null) }, [value?.lat, value?.lng])
  const shown: GeoValue | null = draft ?? value
  const dirty = !!draft && (!value || draft.lat !== value.lat || draft.lng !== value.lng)

  const useGps = () => {
    setGpsErr('')
    if (!('geolocation' in navigator)) { setGpsErr('Trình duyệt này không có định vị'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setLocating(false); setDraft({ lat: round6(pos.coords.latitude), lng: round6(pos.coords.longitude), source: 'GPS', accuracy_m: pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null }) },
      e => { setLocating(false); setGpsErr(e.code === 1 ? 'Điện thoại chưa cho phép lấy vị trí — bật quyền Vị trí cho trình duyệt rồi bấm lại' : 'Không lấy được vị trí (mất GPS / hết giờ) — ra chỗ thoáng rồi bấm lại') },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="h-56 sm:h-64 w-full overflow-hidden rounded-md border border-slate-200">
        <MapContainer center={shown ? [shown.lat, shown.lng] : VN_CENTER} zoom={shown ? PIN_ZOOM : VN_ZOOM} scrollWheelZoom className="h-full w-full">
          <TileLayer url={OSM_TILE} attribution={OSM_ATTR} subdomains={OSM_SUBDOMAINS} />
          <Viewport at={shown} />
          <ClickToPin enabled={canEdit && !saving} onPick={p => setDraft({ ...p, source: 'MANUAL', accuracy_m: null })} />
          {shown && (
            <Marker position={[shown.lat, shown.lng]} draggable={canEdit && !saving}
              eventHandlers={{ dragend: e => { const ll = (e.target as LMarker).getLatLng(); setDraft({ lat: round6(ll.lat), lng: round6(ll.lng), source: 'MANUAL', accuracy_m: null }) } }} />
          )}
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
        {shown ? (
          <>
            <span className="font-mono text-slate-700">{shown.lat.toFixed(6)}, {shown.lng.toFixed(6)}</span>
            {dirty
              ? <span className="text-amber-700">chưa lưu · {draft!.source === 'GPS' ? `GPS tại chỗ${draft!.accuracy_m != null ? ` ±${draft!.accuracy_m} m` : ''}` : 'chấm tay'}</span>
              : meta.source && <span>{GEO_SOURCE_VI[meta.source]}{meta.accuracy_m != null ? ` ±${Math.round(meta.accuracy_m)} m` : ''}{meta.by ? ` · ${meta.by}` : ''}{meta.at ? ` · ${formatDateTime(meta.at)}` : ''}</span>}
          </>
        ) : (
          <span className="text-amber-700 flex items-center gap-1"><MapPin className="h-3 w-3" /> Chưa định vị{canEdit ? ' — bấm vào bản đồ để chấm, hoặc lấy GPS điện thoại khi đứng tại điểm giao' : ''}</span>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-9 sm:h-8" onClick={useGps} disabled={saving || locating}>
            <LocateFixed className="h-3.5 w-3.5 mr-1" />{locating ? 'Đang lấy GPS…' : 'Lấy vị trí điện thoại'}
          </Button>
          {dirty && (
            <Button type="button" size="sm" className="h-9 sm:h-8" disabled={saving} onClick={() => void onSave(draft)}>
              <Crosshair className="h-3.5 w-3.5 mr-1" />{saving ? 'Đang lưu…' : 'Lưu vị trí'}
            </Button>
          )}
          {dirty && <Button type="button" size="sm" variant="ghost" className="h-9 sm:h-8" disabled={saving} onClick={() => setDraft(null)}>Bỏ</Button>}
          {!dirty && value && (
            <Button type="button" size="sm" variant="ghost" className="h-9 sm:h-8 text-red-600" disabled={saving} onClick={() => void onSave(null)}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />Xoá ghim
            </Button>
          )}
        </div>
      )}
      {gpsErr && <p className="text-[11px] text-red-600">{gpsErr}</p>}
      {address && <p className="text-[11px] text-slate-400 truncate" title={address}>Địa chỉ SAP: {address}</p>}
    </div>
  )
}
