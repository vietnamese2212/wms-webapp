// Tab "Dữ liệu OD" của Điều vận (25/09, user: "rawdata nằm ở 1 tab") — MỌI OD máy đã nhìn thấy cho kho × ngày này, mỗi OD
// một dòng kèm CHỖ nó đang nằm: trên xe nào · khung chờ · không lên xe (vì sao) · đã bỏ ra khỏi đợt ghép (vì sao — lũy tiến).
// Đây là chỗ trả lời "OD X đâu rồi?" mà không phải lật từng thẻ xe.
import { useMemo } from 'react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ListFooter } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import type { DispatchPlan, DispatchOdFlag } from '@/api/hooks'
import { FLAG_VI } from './dispatchIssues'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const COLS: RtColDef[] = [
  { id: 'od', label: 'OD', w: 110 },
  { id: 'where', label: 'Đang ở', w: 150 },
  { id: 'cust', label: 'Khách', w: 200 },
  { id: 'ward', label: 'Phường', w: 130 },
  { id: 'region', label: 'Vùng', w: 80 },
  { id: 'pal', label: 'Pallet', w: 70, align: 'right' },
  { id: 'ton', label: 'Tấn', w: 70, align: 'right' },
  { id: 'date', label: 'Ngày giao', w: 100 },
  { id: 'sap', label: 'Tình trạng SAP', w: 220 },
]
const EX_VI: Record<string, string> = { IN_PLAN: 'Đã có trong KH xuất', OTHER_DRAFT: 'Nằm ở nháp ngày khác', SAP_ASSIGNED: 'SAP đã điều', SHIPPED: 'Đã xuất kho' }
type Tone = 'green' | 'amber' | 'slate' | 'red' | 'blue'
type Row = { key: string; od: string; where: string; tone: Tone; cust: string; ward: string; region: string; pallets: number | null; tons: number | null; date: string; late: number; sap: string }

export function DispatchOdTable({ plan, flags, search, onSearch }: { plan: DispatchPlan; flags: Map<string, DispatchOdFlag>; search: string; onSearch: (v: string) => void }) {
  const rows = useMemo(() => {
    const out: Row[] = []
    const agg = new Map<string, Row>()
    const add = (key: string, r: Omit<Row, 'key'>) => {
      const cur = agg.get(key)
      if (cur) { cur.pallets = (cur.pallets ?? 0) + (r.pallets ?? 0); cur.tons = (cur.tons ?? 0) + (r.tons ?? 0); return }
      const row = { key, ...r }; agg.set(key, row); out.push(row)
    }
    for (const t of plan.trips) for (const o of t.ods) {
      const fl = flags.get(o.od_number)
      add(`${o.od_number}|${t.id}`, { od: o.od_number, where: `Xe #${t.seq}`, tone: t.status === 'CONFIRMED' ? 'green' : 'blue', cust: o.ship_to_name ?? o.ship_to_code ?? '', ward: o.ward_code ?? '', region: o.region_code ?? '',
        pallets: o.pallets == null ? null : Number(o.pallets), tons: o.tons == null ? null : Number(o.tons), date: o.delivery_date ?? '', late: o.late_days ?? 0, sap: fl ? `${FLAG_VI[fl.kind]}${fl.info ? ` — ${fl.info}` : ''}` : '' })
    }
    for (const o of plan.pool ?? []) {
      const fl = flags.get(o.od_number)
      add(`${o.od_number}|pool`, { od: o.od_number, where: 'Khung chờ', tone: 'amber', cust: o.ship_to_name ?? o.ship_to_code ?? '', ward: o.ward_code ?? '', region: o.region_code ?? '',
        pallets: o.pallets == null ? null : Number(o.pallets), tons: o.tons == null ? null : Number(o.tons), date: o.delivery_date ?? '', late: o.late_days ?? 0, sap: fl ? `${FLAG_VI[fl.kind]}${fl.info ? ` — ${fl.info}` : ''}` : '' })
    }
    for (const u of plan.unplanned) add(`${u.od_number}|un`, { od: u.od_number, where: 'Không lên xe', tone: 'red', cust: u.ship_to_code ?? '', ward: '', region: '', pallets: null, tons: null, date: '', late: 0, sap: u.reason })
    for (const x of plan.params.excluded ?? []) add(`${x.od_number}|ex`, { od: x.od_number, where: EX_VI[x.kind] ?? x.kind, tone: 'slate', cust: '', ward: '', region: '', pallets: null, tons: null, date: '', late: 0, sap: x.info ?? '' })
    const q = search.trim().toLowerCase()
    return q ? out.filter(r => [r.od, r.cust, r.ward, r.region, r.where, r.sap].some(v => v.toLowerCase().includes(q))) : out
  }, [plan, flags, search])

  return (
    <>
      <div className="px-3 py-1.5 border-b bg-white sticky left-0"><SearchInput value={search} onChange={onSearch} placeholder="Tìm OD, khách, phường, chỗ đang ở…" className="w-full sm:max-w-sm" /></div>
      <ResizableTable storageKey="dispatch_ods_cols_v1" cols={COLS}>
        <TableBody>
          {!rows.length && <TableEmptyRow colSpan={COLS.length}>{search ? `Không OD nào khớp "${search}"` : 'Kế hoạch chưa có OD nào.'}</TableEmptyRow>}
          {rows.map(r => (
            <TableRow key={r.key}>
              <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`}>{r.od}</TableCell>
              <TableCell className={TD}><StatusBadge tone={r.tone}>{r.where}</StatusBadge></TableCell>
              <TableCell className={`${TD} truncate`} title={r.cust}>{r.cust || <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={`${TD} truncate`}>{r.ward || <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={TD}>{r.region || <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={`${TD} text-right tabular-nums`}>{nf(r.pallets, 1)}</TableCell>
              <TableCell className={`${TD} text-right tabular-nums`}>{nf(r.tons, 2)}</TableCell>
              <TableCell className={TD}>{r.date || <span className="text-slate-300">—</span>}{r.late > 0 && <span className="ml-1 text-amber-700">trễ {r.late}n</span>}</TableCell>
              <TableCell className={`${TD} truncate ${r.sap && r.tone !== 'slate' && r.tone !== 'red' ? 'text-red-600' : 'text-slate-500'}`} title={r.sap}>{r.sap || <span className="text-slate-300">—</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </ResizableTable>
      <ListFooter page={1} pageSize={Math.max(1, rows.length)} total={rows.length} unit="dòng" onPageSize={() => { }} options={[]} right="mỗi dòng = một OD tại một chỗ (OD tách hai xe hiện hai dòng)" />
    </>
  )
}
