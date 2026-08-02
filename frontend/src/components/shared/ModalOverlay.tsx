// Khung modal dùng chung (tách khỏi Outbound.tsx 02/08 khi 2 luồng upload chuyển sang Dữ liệu bên ngoài).
// Mobile: full màn hình (không lề); ≥sm: canh giữa có lề.
export function ModalOverlay({ children, onClose, className }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 bg-white shadow-2xl flex flex-col w-full h-full max-h-full rounded-none sm:h-auto sm:rounded-xl ${className ?? 'sm:w-[80vw] sm:max-w-[80vw] sm:max-h-[90vh]'}`}>
        {children}
      </div>
    </div>
  )
}
