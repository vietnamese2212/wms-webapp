// Web Push handlers — được generateSW nạp qua workbox.importScripts (vite.config.ts).
// File này chạy TRONG service worker (không phải app), giữ tối giản + không import gì.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const title = data.title || 'WMS'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || undefined,       // cùng tag → thay thông báo cũ thay vì xếp chồng
    renotify: !!data.tag,             // thay nhưng vẫn rung/chuông cho lần mới
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        // App đang mở (kể cả PWA cài đặt) → điều hướng tab đó thay vì mở cửa sổ mới
        if ('focus' in c && 'navigate' in c) { c.navigate(url); return c.focus() }
      }
      return clients.openWindow(url)
    }),
  )
})
