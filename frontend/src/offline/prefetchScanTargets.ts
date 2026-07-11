import { useEffect } from 'react'
import { queryClient } from '@/api/queryClient'
import { apiClient } from '@/api/client'

// Prefetch chi tiết các phiếu/chuyến ĐANG HOẠT ĐỘNG ngay khi có mạng → cache persist
// xuống IndexedDB → rớt mạng vẫn mở + quét offline được CẢ phiếu chưa từng bấm vào
// (người kho không biết trước sẽ rớt mạng ở phiếu nào). Chặn số lượng + staleTime 5'
// để không dội serverless mỗi lần list refetch.
const STALE = 5 * 60_000

export function usePrefetchInboundOrders(orders: Array<{ id: string; status?: string }>): void {
  const ids = orders.filter(o => o.status === 'OPEN').slice(0, 15).map(o => o.id).join(',')
  useEffect(() => {
    if (!ids || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
    for (const id of ids.split(',')) {
      void queryClient.prefetchQuery({
        queryKey: ['inbound-order', id],
        queryFn: () => apiClient.get(`/wms/inbound-orders/${id}`).then(r => r.data.data),
        staleTime: STALE,
      })
    }
  }, [ids])
}

export function usePrefetchGdos(gdos: Array<{ id: string; status?: string }>): void {
  const ids = gdos.filter(g => g.status === 'IN_PROGRESS' || g.status === 'ASSIGNED').slice(0, 10).map(g => g.id).join(',')
  useEffect(() => {
    if (!ids || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
    for (const id of ids.split(',')) {
      void queryClient.prefetchQuery({
        queryKey: ['gdo', id],
        queryFn: () => apiClient.get(`/wms/outbound/${id}`).then(r => r.data.data),
        staleTime: STALE,
      })
    }
  }, [ids])
}
