import { useMemo } from 'react'
import { useWarehouseTypes, useWhTypeConfigs } from '@/api/hooks'
import type { WhTypeMeta, WhTypeMetaMap } from '@/utils/cargoCategory'

/** Map tên Loại kho → cờ hành vi (LookupValue.meta). Truyền vào các helper trong utils/cargoCategory. */
export function useWhTypeMetaMap(): WhTypeMetaMap {
  const { data } = useWarehouseTypes()
  return useMemo(
    () => new Map((data ?? []).map(t => [t.value, (t.meta ?? {}) as WhTypeMeta])),
    [data],
  )
}

/**
 * Cờ hành vi HIỆU LỰC TẠI MỘT KHO (21/08) = danh mục chung + phần kho đó khai riêng.
 * 3 cờ khai riêng được: is_ncc_goods · requires_ncc · batch_char (đều đọc khi đang làm việc tại kho).
 * `Bắt buộc HSD` / `Bắt buộc Pallet/EA` KHÔNG nằm ở đây — chúng ràng buộc hồ sơ mã hàng (dùng chung).
 * Không truyền kho → trả nguyên danh mục chung (mirror BE `getWhTypeMetaMapFor`).
 */
export function useWhTypeMetaMapFor(warehouseId: string | null | undefined): WhTypeMetaMap {
  const base = useWhTypeMetaMap()
  const { data: cfgs } = useWhTypeConfigs(warehouseId)
  return useMemo(() => {
    if (!warehouseId || !cfgs?.length) return base
    const map = new Map(base)
    for (const c of cfgs) {
      const cur: WhTypeMeta = { ...(map.get(c.type_code) ?? {}) }
      if (typeof c.is_ncc_goods === 'boolean') cur.is_ncc_goods = c.is_ncc_goods
      if (typeof c.requires_ncc === 'boolean') cur.requires_ncc = c.requires_ncc
      if (c.batch_char) cur.batch_char = c.batch_char
      map.set(c.type_code, cur)
    }
    return map
  }, [base, cfgs, warehouseId])
}
