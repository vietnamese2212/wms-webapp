// Đăng ký/hủy Web Push cho THIẾT BỊ này (Đợt 1 roadmap 06/08).
// Ghi chú nền tảng: iPhone/iPad chỉ nhận push khi app đã "Thêm vào MH chính" (iOS 16.4+);
// trình duyệt thường (Chrome/Edge/Android) dùng được ngay. Private key không bao giờ rời server.
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/api/client'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'loading'

export function usePushNotifications() {
  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [state, setState] = useState<PushState>(supported ? 'loading' : 'unsupported')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Trạng thái ban đầu: đã có subscription trên thiết bị này chưa
  useEffect(() => {
    if (!supported) return
    let alive = true
    ;(async () => {
      try {
        if (Notification.permission === 'denied') { if (alive) setState('denied'); return }
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (alive) setState(sub ? 'on' : 'off')
      } catch { if (alive) setState('off') }
    })()
    return () => { alive = false }
  }, [supported])

  const enable = useCallback(async () => {
    if (!supported || busy) return
    setBusy(true); setError('')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return }
      const reg = await navigator.serviceWorker.ready
      const { data } = await apiClient.get('/notify/vapid-key')
      const key = (data?.data as { key?: string })?.key
      if (!key) throw new Error('Không lấy được khóa thông báo từ server')
      // subscribe idempotent: đã có thì trả subscription hiện tại
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      })
      const json = sub.toJSON()
      await apiClient.post('/notify/subscriptions', {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      })
      setState('on')
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: { message?: string } } }; message?: string })
        ?.response?.data?.error?.message ?? (e as Error)?.message ?? 'Không bật được thông báo')
    } finally { setBusy(false) }
  }, [supported, busy])

  const disable = useCallback(async () => {
    if (!supported || busy) return
    setBusy(true); setError('')
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) {
        // Báo server trước (còn endpoint để khớp dòng), rồi mới unsubscribe phía trình duyệt
        await apiClient.delete('/notify/subscriptions', { data: { endpoint: sub.endpoint } }).catch(() => undefined)
        await sub.unsubscribe()
      }
      setState('off')
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Không tắt được thông báo')
    } finally { setBusy(false) }
  }, [supported, busy])

  const sendTest = useCallback(async () => {
    setBusy(true); setError('')
    try {
      await apiClient.post('/notify/test')
      return true
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Không gửi được thông báo thử')
      return false
    } finally { setBusy(false) }
  }, [])

  return { supported, state, busy, error, enable, disable, sendTest }
}
