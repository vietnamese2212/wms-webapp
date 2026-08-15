// Một dòng vị trí trong picker CẤT HÀNG — dùng CHUNG cho cả 3 màn (form Nhập kho, màn quét PDA,
// đổi vị trí ở chi tiết phiếu). Trước 15/08 mỗi màn tự vẽ một kiểu và màn PDA thì không vẽ gì,
// nên người đứng cất hàng không biết vì sao dòng đó nằm trên đầu.
import { blockShort, type PutawayHint } from '@/utils/putaway'
import { PUTAWAY_REASON_LABEL } from '@/utils/putaway'

export interface PutawayLocRow {
  id: string
  location_code: string
  max_pallets: number
  used_slots?: number | null
  putaway?: PutawayHint | null
}

export function putawayBlocked(l: PutawayLocRow): boolean {
  return !!l.putaway?.blocked
}

export function PutawayOption({ loc }: { loc: PutawayLocRow }) {
  const used = loc.used_slots ?? 0
  const hint = loc.putaway ?? null
  const blocked = hint?.blocked ?? null
  const reason = hint?.reason ?? null
  const isFull = loc.max_pallets > 0 && used >= loc.max_pallets

  return (
    <span className="flex-1 min-w-0 flex items-center gap-1 text-[11px]">
      {reason && <span className="text-amber-500 font-bold shrink-0">★</span>}
      <span className={`font-mono truncate ${
        blocked ? 'text-slate-400 line-through' : isFull ? 'text-blue-700 font-semibold' : used > 0 ? 'text-amber-600' : 'text-slate-700'
      }`}>{loc.location_code}</span>
      <span className="ml-auto shrink-0 text-[10px] text-slate-400">{used}/{loc.max_pallets}</span>
      {blocked
        ? <span className="shrink-0 text-[10px] px-1 rounded bg-red-50 text-red-600 border border-red-200">{blockShort(blocked)}</span>
        : reason
        ? <span className="shrink-0 text-[10px] text-amber-600">{PUTAWAY_REASON_LABEL[reason]}</span>
        : null}
    </span>
  )
}
