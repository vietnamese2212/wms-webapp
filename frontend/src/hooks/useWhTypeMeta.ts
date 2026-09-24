import { useMemo } from 'react'
import { useWarehouseTypes, useWhTypeConfigs, useWhTypeFlagOverrides } from '@/api/hooks'
import { isNccCategory, type WhTypeMeta, type WhTypeMetaMap } from '@/utils/cargoCategory'

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

/**
 * "Loại này là HÀNG NCC tại kho nào?" — tra theo kho của TỪNG DÒNG.
 * Dùng khi một màn hiển thị dữ liệu của NHIỀU kho cùng lúc nên không có "kho đang chọn" duy nhất
 * (In tem: một lệnh in gộp tem của nhiều kho ⇒ đoạn 4 trên tem là NCC hay Máy phải theo kho của
 * chính tem đó). Kho một-tại-một-lúc thì dùng `useWhTypeMetaMapFor` cho gọn.
 * Không có khai riêng (mặc định hôm nay) → rơi về danh mục chung, kết quả y như trước.
 */
export function useIsNccAt(): (warehouseId: string | null | undefined, category: string | null | undefined) => boolean {
  const base = useWhTypeMetaMap()
  const { data: ovr } = useWhTypeFlagOverrides()
  return useMemo(() => {
    const map = new Map<string, boolean>()
    for (const o of ovr ?? []) {
      if (typeof o.is_ncc_goods === 'boolean') map.set(`${o.warehouse_id}|${o.type_code}`, o.is_ncc_goods)
    }
    return (warehouseId, category) => {
      if (!category) return false
      const own = warehouseId ? map.get(`${warehouseId}|${category}`) : undefined
      return own ?? isNccCategory(category, base)
    }
  }, [base, ovr])
}
