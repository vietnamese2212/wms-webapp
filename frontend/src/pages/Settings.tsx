import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Moon, Sun, Monitor, Bell, Shield, Globe, Save, User, KeyRound } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/use-toast'
import { apiClient } from '@/api/client'
import { usePushNotifications } from '@/hooks/usePushNotifications'

type Theme = 'light' | 'dark' | 'system'

const themeOptions: { value: Theme; label: string; icon: React.ElementType }[] = [
  { value: 'light', label: 'Sáng', icon: Sun },
  { value: 'dark', label: 'Tối', icon: Moon },
  { value: 'system', label: 'Hệ thống', icon: Monitor },
]

export default function Settings() {
  const { theme, setTheme } = useUIStore()
  const { user, updateUser } = useAuthStore()

  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')

  const [oldPwd,  setOldPwd]  = useState('')
  const [newPwd,  setNewPwd]  = useState('')
  const [confPwd, setConfPwd] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdError,  setPwdError]  = useState('')
  const [pwdOk,     setPwdOk]    = useState(false)

  async function handleChangePwd() {
    setPwdError('')
    setPwdOk(false)
    if (newPwd.length < 6)  { setPwdError('Mật khẩu mới phải có ít nhất 6 ký tự'); return }
    if (newPwd !== confPwd) { setPwdError('Xác nhận mật khẩu không khớp'); return }
    setPwdSaving(true)
    try {
      await apiClient.post('/auth/change-password', { old_password: oldPwd, new_password: newPwd })
      setOldPwd(''); setNewPwd(''); setConfPwd('')
      setPwdOk(true)
      toast({ title: 'Đổi mật khẩu thành công', variant: 'success' })
    } catch (err) {
      const msg = (err as AxiosError<{ error: { message: string } }>)
        ?.response?.data?.error?.message ?? 'Lỗi đổi mật khẩu'
      setPwdError(msg)
    } finally {
      setPwdSaving(false)
    }
  }

  // Web Push — điều khiển THẬT per thiết bị (thay 5 switch mock cũ không nối gì)
  const push = usePushNotifications()

  const initials = user?.name.split(' ').slice(-2).map((n) => n[0]).join('').toUpperCase() ?? 'U'

  function handleSaveProfile() {
    updateUser({ name, email })
    toast({ title: 'Đã lưu', description: 'Thông tin tài khoản đã được cập nhật.', variant: 'success' })
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Cài đặt" description="Quản lý tài khoản và tuỳ chỉnh hệ thống" />

      {/* Cuộn BÊN TRONG (fit màn hình như các module chuẩn); max-w-2xl = form hẹp chủ ý */}
      <div className="flex-1 min-h-0 overflow-auto p-6 space-y-6 max-w-2xl">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Thông tin tài khoản
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 text-lg">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{user?.name}</p>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Họ và tên</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phòng ban</Label>
                <Input value={user?.department ?? ''} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Chức danh</Label>
                <Input value={user?.job_title_name ?? ''} disabled className="bg-muted" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveProfile}>
                <Save className="h-4 w-4 mr-2" />
                Lưu thay đổi
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              Đổi mật khẩu
            </CardTitle>
            <CardDescription>Nhập mật khẩu hiện tại và mật khẩu mới để cập nhật</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pwdError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{pwdError}</div>
            )}
            {pwdOk && (
              <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">Đổi mật khẩu thành công!</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Mật khẩu hiện tại</Label>
                <Input type="password" value={oldPwd} onChange={e => { setOldPwd(e.target.value); setPwdError(''); setPwdOk(false) }}
                  placeholder="••••••••" autoComplete="current-password" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mật khẩu mới</Label>
                <Input type="password" value={newPwd} onChange={e => { setNewPwd(e.target.value); setPwdError(''); setPwdOk(false) }}
                  placeholder="Tối thiểu 6 ký tự" autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Xác nhận mật khẩu mới</Label>
                <Input type="password" value={confPwd} onChange={e => { setConfPwd(e.target.value); setPwdError(''); setPwdOk(false) }}
                  placeholder="Nhập lại mật khẩu mới" autoComplete="new-password" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleChangePwd}
                disabled={pwdSaving || !oldPwd || !newPwd || !confPwd}>
                {pwdSaving ? 'Đang lưu…' : 'Đổi mật khẩu'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="h-4 w-4" />
              Giao diện
            </CardTitle>
            <CardDescription>Chọn chủ đề màu sắc cho ứng dụng</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-all hover:bg-accent',
                    theme === value && 'border-primary bg-primary/10 text-primary'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Notifications — Web Push thật (Đợt 1 roadmap 06/08) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" />
              Thông báo đẩy
            </CardTitle>
            <CardDescription>
              Nhận thông báo trên thiết bị này kể cả khi không mở app: được giao lệnh fill,
              việc &quot;Cần xử lý&quot; khi SAP đổi dữ liệu…
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!push.supported ? (
              <p className="text-sm text-muted-foreground">
                Trình duyệt này không hỗ trợ thông báo đẩy.
              </p>
            ) : push.state === 'denied' ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Bạn đã CHẶN thông báo cho trang này — mở cài đặt trình duyệt (biểu tượng ổ khóa
                cạnh địa chỉ) → Thông báo → Cho phép, rồi quay lại đây bật.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Bật trên thiết bị này</p>
                    <p className="text-xs text-muted-foreground">
                      {push.state === 'on' ? 'Đang bật — thiết bị này sẽ nhận thông báo' : 'Đang tắt'}
                    </p>
                  </div>
                  <Switch
                    checked={push.state === 'on'}
                    disabled={push.busy || push.state === 'loading'}
                    onCheckedChange={(v) => (v ? push.enable() : push.disable())}
                  />
                </div>
                {push.state === 'on' && (
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">
                      Kiểm tra chuông: gửi một thông báo thử tới mọi thiết bị đã bật của bạn.
                    </p>
                    <Button size="sm" variant="outline" disabled={push.busy}
                      onClick={async () => {
                        const okSent = await push.sendTest()
                        if (okSent) toast({ title: 'Đã gửi thông báo thử', description: 'Chờ 1-2 giây — thông báo sẽ hiện trên thiết bị.', variant: 'success' })
                      }}>
                      Gửi thử
                    </Button>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  iPhone/iPad: cần &quot;Thêm vào MH chính&quot; (iOS 16.4 trở lên) rồi mở app từ màn hình
                  chính mới bật được. Mỗi thiết bị/trình duyệt bật riêng.
                </p>
                {push.error && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{push.error}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* System */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" />
              Hệ thống
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Ngôn ngữ</p>
                <p className="text-xs text-muted-foreground">Tiếng Việt (mặc định)</p>
              </div>
              <Badge variant="outline">VI</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Múi giờ</p>
                <p className="text-xs text-muted-foreground">Asia/Ho_Chi_Minh (UTC+7)</p>
              </div>
              <Badge variant="outline">UTC+7</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Phiên bản</p>
                <p className="text-xs text-muted-foreground">MAL SC v0.1.0</p>
              </div>
              <Badge variant="secondary">Beta</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Shield className="h-4 w-4" />
              Vùng nguy hiểm
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Đăng xuất tất cả thiết bị</p>
                <p className="text-xs text-muted-foreground">Huỷ tất cả phiên đăng nhập hiện tại</p>
              </div>
              <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
                Đăng xuất
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
