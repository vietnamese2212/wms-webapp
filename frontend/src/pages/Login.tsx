import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/authStore'
import { DevCredit } from '@/components/shared/DevCredit'
import type { AxiosError } from 'axios'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const { login } = useAuthStore()
  const navigate  = useNavigate()
  // KHÔNG có nút "Hiển thị mật khẩu" (user chốt 07/09). Lịch sử: trên PC dùng chung ở kho, Edge tự điền mật
  // khẩu người đăng nhập trước và con mắt của app làm lộ nó không cần PIN. Đã thử hai lớp gác (chỉ lộ ký tự
  // người đang gõ; tắt con mắt riêng của Edge bằng CSS) — người dùng thật vẫn thấy mật khẩu qua giao diện
  // gợi ý của trình duyệt. Trang đăng nhập máy dùng chung không cần nút xem mật khẩu: không có nút = app
  // không còn gì để lộ, hết phải đoán hành vi từng trình duyệt. App vốn không lưu mật khẩu ở đâu.

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      const msg = (err as AxiosError<{ error: { message: string } }>)
        ?.response?.data?.error?.message ?? 'Đăng nhập thất bại. Kiểm tra lại email và mật khẩu.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    // min-h theo dvh (không phải 100vh) + khoảng cách vừa đủ: trên màn thấp/zoom 110% bản cũ cao hơn
    // khung nhìn ⇒ dòng ghi công tác giả bị đẩy xuống dưới, phải cuộn mới thấy (user 02/09)
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 px-4 py-3">
      <div className="w-full max-w-sm space-y-4">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <BarChart3 className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">Mal SupplyC</h1>
            <p className="text-sm text-muted-foreground">Supply Chain Management</p>
          </div>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Đăng nhập</CardTitle>
            <CardDescription>Nhập thông tin tài khoản để tiếp tục</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Tên đăng nhập</Label>
                <Input
                  id="email"
                  type="text"
                  placeholder="Email hoặc tên đăng nhập"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Mật khẩu</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
              )}
              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Đăng nhập
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-1">
          <p className="text-center text-xs text-muted-foreground">
            Tài khoản do quản trị viên cấp. Liên hệ admin nếu quên mật khẩu.
          </p>
          <DevCredit />
          {/* Số hiệu bản dựng — app là PWA nên máy người dùng có thể đang chạy bản CŨ dù server đã lên bản mới
              (07/09: sửa nút Hiển thị mật khẩu 2 lần mà không ai biết chắc Edge đang chạy bản nào). Một dòng
              này trả lời "anh đang ở bản nào" trong 1 giây thay vì đoán. */}
          <p className="text-center text-[10px] text-muted-foreground/70 font-mono" title="Số hiệu bản dựng đang chạy trên máy này">
            Version {__BUILD_SHA__}
          </p>
        </div>
      </div>
    </div>
  )
}
