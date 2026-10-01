// Leaflet + Vite: icon mặc định tự tìm ảnh theo đường dẫn tương đối của CSS nên bị vỡ sau khi bundle — trỏ tay vào asset.
// Nền bản đồ = OpenStreetMap (miễn phí, không khoá, không phụ thuộc nhà cung cấp định vị). Import một lần ở mọi màn có bản đồ.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

// Nền OpenStreetMap chuẩn qua ba máy chủ con a/b/c (mặc định của Leaflet). Đo 01/10: gọi thẳng `tile.openstreetmap.org` không
// subdomain bị reset kết nối ở PC; CARTO Voyager nay đòi khoá API (ô nền in "API KEY REQUIRED"). Mức dùng của vài người điều vận
// nằm trong "light usage" của OSM. Có khoá Goong rồi có thể đổi sang tile Goong (tính vào map loads). Đổi nền = đổi ba dòng này.
export const OSM_TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
export const OSM_SUBDOMAINS = 'abc'
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
