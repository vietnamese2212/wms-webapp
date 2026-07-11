import { get, set, del } from 'idb-keyval'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import type { Query } from '@tanstack/react-query'
import { queryClient } from '@/api/queryClient'

// Persist CHỌN LỌC cache React Query xuống IndexedDB → offline vẫn xem lại được
// dữ liệu đã tải (tồn kho, phiếu nhập, chuyến xuất...). KHÔNG persist tất cả:
// dữ liệu triệu dòng không thể "tải hết về máy" — chỉ giữ đúng cái user đã mở.
const PERSIST_KEYS = new Set([
  // Tồn kho
  'inventory-entries', 'inventory-summary', 'inventory-facets',
  // Nhập kho
  'inbound-orders', 'inbound-order',
  // Xuất kho + nhặt lẻ
  'gdos', 'gdo', 'item-inventory', 'inventory-by-material', 'loosepicking',
  // Masterdata cần để render các trang trên
  'materials', 'warehouses', 'locations-real', 'lookup', 'material-categories',
  'qa-statuses', 'system-settings', 'warehouse-zones', 'manufacturers', 'import-shifts',
  'dashboard',
])

const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key: string) => get(key).then(v => (v as string | undefined) ?? null),
    setItem: (key: string, value: string) => set(key, value),
    removeItem: (key: string) => del(key),
  },
  key: 'wms-query-cache',
  throttleTime: 2000,   // ghi IndexedDB tối đa 1 lần/2s (cache đổi liên tục khi dùng)
})

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: 24 * 60 * 60 * 1000,   // offline chập chờn vài phút–vài chục phút → 24h là dư
  buster: __BUILD_ID__,          // deploy mới → bỏ cache cũ (tránh lệch shape dữ liệu)
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === 'success' && PERSIST_KEYS.has(String(query.queryKey[0])),
  },
}

// Dọn SẠCH dữ liệu client khi ĐĂNG XUẤT / phiên hết hạn (401) — chống rò rỉ trên
// MÁY DÙNG CHUNG: xóa cache React Query (tồn kho/phiếu/mã hàng) + hàng đợi quét offline
// khỏi IndexedDB. Nếu không, user kế tiếp mở app vẫn đọc được dữ liệu kho của người trước.
export async function clearOfflineData(): Promise<void> {
  try { queryClient.clear() } catch { /* ignore */ }
  await Promise.allSettled([
    del('wms-query-cache'),      // cache React Query persist (persist.ts key)
    del('wms-scan-queue-v1'),    // hàng đợi quét offline (scanQueue.ts key)
  ])
}

export { queryClient }
