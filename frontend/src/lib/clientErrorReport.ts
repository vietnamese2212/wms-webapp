// TAI MẮT PRODUCTION (29/07) — lỗi JS runtime của user thật được app TỰ BÁO về
// POST /api/telemetry/client-error (bảng error_logs), thay vì chỉ lộ khi có người ngồi kiểm.
// Kỷ luật gửi: dedupe theo message + tối đa 5 lỗi/phiên + bỏ qua nhiễu đã biết là vô hại.
// KHÔNG gửi stack (message + url đủ để khoanh vùng; stack minified không đọc được, còn phình payload).

const seen = new Set<string>()
let budget = 5

const IGNORE = [
  /ResizeObserver loop/i,                    // nhiễu trình duyệt kinh điển, không phải lỗi app
  /^Script error\.?$/i,                      // lỗi script cross-origin bị trình duyệt che — không hành động được
  /Failed to fetch|NetworkError|Load failed/i, // offline/mất mạng — PWA đã có hàng đợi riêng, đừng spam
]

function report(message: string) {
  const msg = String(message ?? '').trim()
  if (!msg || budget <= 0 || seen.has(msg) || IGNORE.some(re => re.test(msg))) return
  seen.add(msg); budget--
  try {
    // keepalive: gửi được cả khi trang đang unload
    void fetch('/api/telemetry/client-error', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg.slice(0, 400), url: location.pathname, ua: navigator.userAgent.slice(0, 120) }),
    }).catch(() => {})
  } catch { /* telemetry không bao giờ được phá app */ }
}

export function installClientErrorReport() {
  window.addEventListener('error', e => report(e.message))
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason
    report(r instanceof Error ? `${r.name}: ${r.message}` : String(r))
  })
}
