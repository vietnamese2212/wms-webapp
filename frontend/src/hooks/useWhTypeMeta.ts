import { useMemo } from 'react'
import { useWarehouseTypes } from '@/api/hooks'
import type { WhTypeMeta, WhTypeMetaMap } from '@/utils/cargoCategory'

/** Map tên Loại kho → cờ hành vi (LookupValue.meta). Truyền vào các helper trong utils/cargoCategory. */
export function useWhTypeMetaMap(): WhTypeMetaMap {
  const { data } = useWarehouseTypes()
  return useMemo(
    () => new Map((data ?? []).map(t => [t.value, (t.meta ?? {}) as WhTypeMeta])),
    [data],
  )
}
