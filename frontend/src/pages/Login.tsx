import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, BarChart3, Loader2 } from 'lucide-react'
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
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const { login } = useAuthStore()
  const navigate  = useNavigate()
  // Con mắt "Hiển thị" CHỈ được lộ ký tự do CHÍNH người đang ngồi gõ/dán vào (user phát hiện 07/09: trên PC
  // dùng chung ở kho, Edge tự điền mật khẩu người đăng nhập trước, bấm con mắt là đọc được — không cần
  // PIN như khi mở kho mật khẩu của Edge). App vốn không lưu mật khẩu ở đâu; nguồn là autofill, cửa lộ là nút.
  //
  // Bản vá đầu (xoá qua setPassword khi chưa gõ) KHÔNG đủ — kiểm thật trên Edge vẫn lộ: trình duyệt điền
  // vào DOM mà React không hay (state vẫn ''), hoặc điền SAU cú bấm; xoá state rỗng thì DOM giữ nguyên mật
  // khẩu và bị chuyển sang chữ. Nên luật chặt hơn:
  //   · chưa gõ/dán gì → con mắt KHÔNG chuyển sang chữ, chỉ xoá thẳng DOM (autofill điền lại sau cũng vẫn là dấu chấm);
  //   · phím/dán ĐẦU TIÊN vào ô đang có giá trị (= tự điền) → xoá giá trị đó trước, ô chỉ còn ký tự người này;
  //   · người tự điền rồi bấm "Đăng nhập" không bị ảnh hưởng (không gõ = không xoá).
  const pwdRef = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState(false)
  function clearPwdField() {
    if (pwdRef.current) pwdRef.current.value = ''   // xoá DOM thật, không tin state
    setPassword('')
  }
  function markTyped() {
    if (typed) return
    if (pwdRef.current?.value) clearPwdField()
    setTyped(true)
  }
  function toggleShowPwd() {
    if (!typed) { clearPwdField(); return }
    setShowPwd((v) => !v)
  }

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
                <div className="relative">
                  <Input
                    id="password"
                    ref={pwdRef}
                    type={showPwd && typed ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={markTyped}
                    onPaste={markTyped}
                    required
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={toggleShowPwd}
                    aria-label={showPwd && typed ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                    title={typed ? undefined : 'Chỉ hiển thị được mật khẩu bạn tự gõ'}
                    tabIndex={-1}
                  >
                    {showPwd && typed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
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
            bản dựng {__BUILD_SHA__}
          </p>
        </div>
      </div>
    </div>
  )
}
