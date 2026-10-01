// Leaflet + Vite: icon mặc định tự tìm ảnh theo đường dẫn tương đối của CSS nên bị vỡ sau khi bundle — trỏ tay vào asset.
// Nền bản đồ = OpenStreetMap (miễn phí, không khoá, không phụ thuộc nhà cung cấp định vị). Import một lần ở mọi màn có bản đồ.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

// Nền CARTO Voyager (dữ liệu OpenStreetMap, máy chủ tile CARTO cho phép ứng dụng dùng miễn phí ở mức vừa; máy chủ
// tile.openstreetmap.org tự nhận "không dành cho ứng dụng" và đo 01/10 có lúc reset kết nối). Đổi nền = đổi hai dòng này.
export const OSM_TILE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
export const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
export const OSM_SUBDOMAINS = 'abcd'
/** Tâm Việt Nam khi chưa có ghim nào */
export const VN_CENTER: [number, number] = [16.2, 107.6]
export const VN_ZOOM = 5

/** Ghim tròn tô màu (một màu mỗi xe trên bàn điều vận) — không dùng ảnh nên đổi màu tự do */
export function dotIcon(color: string, size = 14, label?: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)${label ? ';display:flex;align-items:center;justify-content:center;color:#fff;font:600 9px/1 system-ui' : ''}">${label ?? ''}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  })
}

export { L }
