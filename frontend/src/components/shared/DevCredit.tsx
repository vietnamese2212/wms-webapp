// Dòng ghi công tác giả — MỘT nguồn chữ cho mọi chỗ hiển thị (màn đăng nhập, sidebar, drawer
// mobile). Sửa tên/email ở đây là đổi hết; chép chữ ra từng file thì sớm muộn cũng lệch nhau.
export const DEV_CREDIT = {
  name: 'Trần Hoàng Lãm',
  email: 'lam.tranhoang@mal.com.vn',
}

/** `tone='dark'` cho nền tối (sidebar/drawer), `'light'` cho nền sáng (màn đăng nhập). */
export function DevCredit({ tone = 'light', className = '' }: { tone?: 'light' | 'dark'; className?: string }) {
  const base = tone === 'dark' ? 'text-slate-500' : 'text-muted-foreground'
  const link = tone === 'dark' ? 'text-sky-400 hover:text-sky-300' : 'text-sky-600 hover:text-sky-700'
  return (
    <p className={`text-center text-[10px] leading-relaxed ${base} ${className}`}>
      Sản phẩm được phát triển bởi <span className="font-medium">{DEV_CREDIT.name}</span>
      <br />
      Vui lòng liên hệ để hợp tác:{' '}
      <a href={`mailto:${DEV_CREDIT.email}`} className={`${link} underline underline-offset-2 break-all`}>
        {DEV_CREDIT.email}
      </a>
    </p>
  )
}
