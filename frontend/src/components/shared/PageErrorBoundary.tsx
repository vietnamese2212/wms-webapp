import { Component, type ReactNode } from 'react'

// Lưới an toàn cuối cho vùng nội dung trang: lỗi render/chunk lọt qua lazyRetry
// sẽ hiện thông báo + nút Tải lại thay vì MÀN HÌNH TRẮNG (app không có boundary nào trước đây).
// Reset theo `resetKey` (pathname) — lỗi ở trang này không kẹt sang trang khác.
interface Props { children: ReactNode; resetKey: string }
interface State { hasError: boolean }

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })   // đổi route → thử render lại
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-medium text-slate-700">Không tải được trang này.</p>
          <p className="text-xs text-slate-500">Thường do app vừa được cập nhật phiên bản mới hoặc mạng chập chờn.</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
          >
            Tải lại trang
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
