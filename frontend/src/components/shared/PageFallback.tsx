import { Skeleton } from '@/components/ui/skeleton'
import { TableSkeleton } from './TableSkeleton'

// Skeleton toàn trang dùng khi route lazy đang tải chunk (code-splitting).
// Giữ khung quen thuộc (tiêu đề + toolbar + bảng) để cảm giác tức thì kiểu Fiori,
// không phải spinner/màn trắng.
export function PageFallback() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Tiêu đề trang */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      {/* Toolbar (search + filter + nút) */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-28" />
      </div>
      {/* Bảng */}
      <div className="rounded-xl border bg-white">
        <TableSkeleton rows={8} cols={6} />
      </div>
    </div>
  )
}
