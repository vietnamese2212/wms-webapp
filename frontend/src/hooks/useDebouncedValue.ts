import { useEffect, useState } from 'react'

/**
 * Hoãn giá trị `ms` mili-giây — dùng cho ô tìm gọi API (typeahead) để gõ nhanh
 * không bắn mỗi phím 1 request. Danh mục lớn (mã hàng/vị trí/biển số) bắt buộc dùng.
 */
export function useDebouncedValue<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
