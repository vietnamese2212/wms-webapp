import { queryClient } from './queryClient'

let es: EventSource | null = null

export function connectRealtimeEvents(): void {
  // SSE only works on Railway (persistent server). Skip if no VITE_API_URL.
  const baseUrl = import.meta.env.VITE_API_URL
  if (!baseUrl || es) return

  es = new EventSource(`${baseUrl}/api/wms/events`)

  es.onmessage = () => {
    queryClient.invalidateQueries({ queryKey: ['inbound-orders'] })
    queryClient.invalidateQueries({ queryKey: ['inbound-order'] })
  }

  es.onerror = () => {
    // EventSource auto-reconnects on error; just log
    console.warn('[realtime] SSE reconnecting...')
  }
}

export function disconnectRealtimeEvents(): void {
  es?.close()
  es = null
}
