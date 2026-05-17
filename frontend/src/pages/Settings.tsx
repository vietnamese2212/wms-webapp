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
import { actionLevelLabel } from '@/utils/formatters'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/use-toast'
import { apiClient } from '@/api/client'

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

  const [notifications, setNotifications] = useState({
    lowStock: true,
    inboundComplete: true,
    deliveryStatus: true,
    overtimeApproval: false,
    systemAlerts: true,
  })

  const initials = user?.name.split(' ').slice(-2).map((n) => n[0]).join('').toUpperCase() ?? 'U'

  function handleSaveProfile() {
    updateUser({ name, email })
    toast({ title: 'Đã lưu', description: 'Thông tin tài khoản đã được cập nhật.', variant: 'success' })
  }

  return (
    <div>
      <PageHeader title="Cài đặt" description="Quản lý tài khoản và tuỳ chỉnh hệ thống" />

      <div className="p-6 space-y-6 max-w-2xl">
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
                <Badge variant="info" className="mt-1">{user?.action_level ? actionLevelLabel[user.action_level] : ''}</Badge>
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
                <Label>Vai trò</Label>
                <Input value={user?.action_level ? actionLevelLabel[user.action_level] : ''} disabled className="bg-muted" />
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

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" />
              Thông báo
            </CardTitle>
            <CardDescription>Quản lý các loại thông báo bạn muốn nhận</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: 'lowStock', label: 'Cảnh báo tồn kho thấp', desc: 'Khi hàng dưới mức tối thiểu' },
              { key: 'inboundComplete', label: 'Nhập kho hoàn thành', desc: 'Khi phiếu nhập được xác nhận' },
              { key: 'deliveryStatus', label: 'Cập nhật trạng thái giao hàng', desc: 'Khi trạng thái đơn hàng thay đổi' },
              { key: 'overtimeApproval', label: 'Yêu cầu tăng ca', desc: 'Khi có yêu cầu tăng ca cần duyệt' },
              { key: 'systemAlerts', label: 'Cảnh báo hệ thống', desc: 'Lỗi kỹ thuật và cảnh báo quan trọng' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={notifications[key as keyof typeof notifications]}
                  onCheckedChange={(v) => setNotifications((prev) => ({ ...prev, [key]: v }))}
                />
              </div>
            ))}
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
                <p className="text-xs text-muted-foreground">WMS Pro v0.1.0</p>
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
