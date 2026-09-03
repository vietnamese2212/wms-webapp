// NÚT CHUÔNG = TRUNG TÂM THÔNG BÁO (user chốt 06/08 "sao không kết hợp vào nút chuông"):
// 3 tab — Cá nhân (feed việc đích danh: được giao lệnh fill…) · Chung (cảnh báo vận hành, nêu
// rõ KHO — cần quyền alerts.view) · Cài đặt (trường hợp nào mới ĐỔ CHUÔNG per user; tắt chỉ tắt
// chuông, danh sách vẫn đủ). Badge = chưa đọc cá nhân + cảnh báo chung đang mở.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Settings2, CheckCheck, ExternalLink } from 'lucide-react'
// Panel = DropdownMenu Radix (tự portal, không thêm dep Popover); phần thân là div thường
// (không DropdownMenuItem) nên bấm switch/tab KHÔNG tự đóng menu.
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  useNotifyFeed, useMarkFeedRead, useNotifyPrefs, useUpdateNotifyPrefs, useAlerts, useScanAlerts,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

const PREF_LABEL: { key: string; label: string; desc: string }[] = [
  { key: 'assign',     label: 'Được giao việc',      desc: 'Giao lệnh fill / giao lại dòng cho bạn' },
  { key: 'reconcile',  label: 'Cần xử lý SAP',       desc: 'SAP đổi dữ liệu sinh việc chờ xử (cần quyền reconcile)' },
  { key: 'EXPIRY',     label: 'Tồn cận date',        desc: 'Mã có lô %Date dưới ngưỡng trong kho của bạn' },
  // Không ghi số ngưỡng cứng ở đây — ngưỡng chỉnh được ở tab "Cài đặt ngưỡng" trang Thông báo
  { key: 'GATE_DWELL', label: 'Xe trong cổng lâu',   desc: 'Xe vào cổng quá ngưỡng thời gian chưa ra' },
  { key: 'TRIP_LATE',  label: 'Chuyến trễ / kẹt',    desc: 'Chuyến trễ ngày xuất hoặc bắt đầu quá lâu chưa xong' },
  { key: 'WEIGH_DIFF', label: 'Lệch cân',            desc: 'Phiếu cân lệch KL tính vượt ngưỡng' },
  { key: 'BE_ERRORS',  label: 'Lỗi hệ thống',        desc: 'Backend có lỗi 5xx trong 24h' },
  { key: 'PACKING_UNRECEIVED', label: 'Sổ đóng gói — kho chưa nhận', desc: 'Pallet SX ghi sổ quá ngưỡng giờ mà kho chưa quét nhập' },
  { key: 'AUTH_LOCKOUT', label: 'Bảo mật — nhiều tài khoản bị khoá', desc: 'Từ 3 tài khoản khác nhau bị khoá đăng nhập trong 1 giờ (dấu hiệu dò mật khẩu)' },
  { key: 'ADMIN_NEW_IP', label: 'Bảo mật — admin đăng nhập IP mới', desc: 'Tài khoản quản trị đăng nhập từ địa chỉ IP chưa thấy trong 30 ngày' },
]
const SEV_DOT: Record<string, string> = { CRITICAL: 'bg-red-500', WARNING: 'bg-amber-500' }

export function NotificationBell() {
  const navigate = useNavigate()
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canAlerts = can(perms, 'alerts', 'view')

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'personal' | 'general' | 'settings'>('personal')

  const feed = useNotifyFeed(!!user)
  // Tab Chung dùng chung API trang Cảnh báo (đã cắt scope kho + loại ở BE); không quyền = tắt query
  const alerts = useAlerts({ status: 'open' }, canAlerts)
  const alertRows = canAlerts ? (alerts.data?.rows ?? []) : []
  const markRead = useMarkFeedRead()
  const prefsQ = useNotifyPrefs(open)
  const updPrefs = useUpdateNotifyPrefs()
  const push = usePushNotifications()

  // Chuông luôn mount trong Shell ⇒ đây là chỗ hợp lý nhất để KÍCH HOẠT lượt quét cảnh báo mà
  // không ai phải chờ (21/08 — trước đây GET /wms/alerts tự quét, người mở trang chịu ~1,9s).
  // Throttle thật nằm ở BE (10'/instance) nên gọi định kỳ 10' là vô hại; ở đây chỉ cần đảm bảo
  // "có người bấm cò" đều đặn. useRef chặn gọi 2 lần do StrictMode double-mount lúc dev.
  const scan = useScanAlerts()
  const scanRef = useRef(scan)
  scanRef.current = scan
  useEffect(() => {
    if (!canAlerts) return
    let armed = true
    const fire = () => { if (armed) scanRef.current.mutate(undefined) }
    fire()
    const t = setInterval(fire, 10 * 60_000)
    return () => { armed = false; clearInterval(t) }
  }, [canAlerts])

  const unread = feed.data?.unread ?? 0
  const badge = unread + (canAlerts ? alertRows.length : 0)

  function openItem(url: string | null, feedId?: string) {
    if (feedId) markRead.mutate([feedId])
    setOpen(false)
    if (url) navigate(url)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-slate-300 hover:bg-white/10 hover:text-white" title="Thông báo">
          <Bell className="h-5 w-5" />
          {badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 text-[10px] flex items-center justify-center rounded-full bg-red-500 text-white font-semibold">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[92vw] max-w-sm p-0 overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center border-b bg-slate-50">
          {([['personal', `Cá nhân${unread ? ` (${unread})` : ''}`], ['general', `Chung${canAlerts && alertRows.length ? ` (${alertRows.length})` : ''}`]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`flex-1 px-2 py-2 text-xs font-semibold border-b-2 transition-colors ${tab === k ? 'border-sky-500 text-sky-700 bg-white' : 'border-transparent text-slate-500'}`}>
              {label}
            </button>
          ))}
          <button type="button" onClick={() => setTab('settings')} title="Cài đặt chuông"
            className={`px-3 py-2 border-b-2 ${tab === 'settings' ? 'border-sky-500 text-sky-700 bg-white' : 'border-transparent text-slate-400'}`}>
            <Settings2 className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {tab === 'personal' && (
            <>
              {(feed.data?.rows ?? []).length === 0 ? (
                <p className="text-center py-8 text-xs text-slate-400">Chưa có thông báo nào cho bạn</p>
              ) : (feed.data?.rows ?? []).map(n => (
                <button key={n.id} type="button" onClick={() => openItem(n.url, n.id)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${n.read_at ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-1.5">
                    {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />}
                    <span className="text-xs font-semibold text-slate-800 truncate">{n.title}</span>
                    <span className="ml-auto text-[10px] text-slate-400 shrink-0">
                      {formatTimestampDate(n.created_at, true)} {formatTimestampTime(n.created_at).slice(0, 5)}
                    </span>
                  </div>
                  {n.body && <p className="text-[11px] text-slate-500 truncate mt-0.5">{n.body}</p>}
                </button>
              ))}
              <div className="flex items-center border-t border-slate-100">
                {(feed.data?.rows ?? []).some(n => !n.read_at) && (
                  <button type="button" onClick={() => markRead.mutate(undefined)}
                    className="flex-1 px-3 py-2 text-[11px] text-sky-600 hover:bg-slate-50 flex items-center justify-center gap-1">
                    <CheckCheck className="h-3.5 w-3.5" /> Đã đọc tất cả
                  </button>
                )}
                <button type="button" onClick={() => openItem('/wms/alerts?tab=personal')}
                  className="flex-1 px-3 py-2 text-[11px] text-sky-600 hover:bg-slate-50 flex items-center justify-center gap-1">
                  <ExternalLink className="h-3.5 w-3.5" /> Xem tất cả
                </button>
              </div>
            </>
          )}

          {tab === 'general' && (
            !canAlerts ? (
              <p className="text-center py-8 px-4 text-xs text-slate-400">
                Bạn chưa được cấp quyền xem Cảnh báo vận hành (`alerts.view`) — liên hệ quản trị.
              </p>
            ) : alertRows.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-400">Không có cảnh báo nào đang mở 🎉</p>
            ) : (
              <>
                {alertRows.slice(0, 15).map(a => (
                  <button key={a.id} type="button" onClick={() => openItem(a.object_url ?? '/wms/alerts')}
                    className="w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${SEV_DOT[a.severity]}`} />
                      <span className="text-xs font-semibold text-slate-800 truncate">{a.title}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {a.warehouse_name ?? (a.warehouse_id ? 'Kho ?' : 'Toàn hệ thống')}
                      {a.detail ? ` · ${a.detail}` : ''}
                    </p>
                  </button>
                ))}
                <button type="button" onClick={() => openItem('/wms/alerts')}
                  className="w-full px-3 py-2 text-[11px] text-sky-600 hover:bg-slate-50 flex items-center justify-center gap-1">
                  <ExternalLink className="h-3.5 w-3.5" /> Mở trang Cảnh báo{alertRows.length > 15 ? ` (+${alertRows.length - 15})` : ''}
                </button>
              </>
            )
          )}

          {tab === 'settings' && (
            <div className="px-3 py-2 space-y-2.5">
              <p className="text-[11px] text-slate-500">
                Chọn trường hợp nào mới <b>đổ chuông</b> trên thiết bị của bạn — tắt vẫn thấy đủ
                trong danh sách. {push.supported && push.state !== 'on' && (
                  <>Thiết bị này <b>chưa bật</b> thông báo đẩy — bật ở <button type="button" className="text-sky-600 underline" onClick={() => openItem('/settings')}>Cài đặt tài khoản</button>.</>
                )}
              </p>
              {PREF_LABEL.map(p => (
                <div key={p.key} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">{p.label}</p>
                    <p className="text-[10px] text-slate-400 truncate" title={p.desc}>{p.desc}</p>
                  </div>
                  <Switch
                    checked={prefsQ.data?.prefs?.[p.key] !== false}
                    disabled={prefsQ.isLoading || updPrefs.isPending}
                    onCheckedChange={v => updPrefs.mutate({ [p.key]: v })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
