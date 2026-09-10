// CHỐT %DATE CHO DÒNG ĐƠN — bước của THỦ KHO trước khi xuất / nhặt lẻ (user chốt 10/09 vòng 3–4).
//
// VÌ SAO CÓ MÀN NÀY: kho KHÔNG chạy FEFO toàn bộ. NPP đi ≥ 60 % nếu CS không ghi chú; CS ghi chú
// bằng CHỮ và mỗi lần một kiểu — dữ liệu thật trên hệ thống: "XX GIAO DATE 50%-70%", "Giao date
// >75%" nằm lẫn với "Trả pallet", "kho thạch hà". Không parser nào bền ⇒ MÁY KHÔNG ĐỌC ghi chú;
// thủ kho đọc rồi chốt thành SỐ. Và FEFO cũng phải BẤM XÁC NHẬN — dòng chưa chốt thì không sinh
// việc, để không ai "tưởng mặc định rồi đi làm, sau mới update = làm sai".
//
// Ba thứ user đòi có mặt trong màn này: (1) chốt được NHIỀU DÒNG một lần; (2) thấy GHI CHÚ CS
// nguyên văn để khỏi thao tác nhầm; (3) xem được TỒN KHO của mã đó ngay tại chỗ để quyết định.
import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Boxes, AlertTriangle } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSetItemsDateRule, useInventoryByMaterial } from '@/api/hooks'
import type { DateRule, DateRuleKind } from '@/types'

export interface DateRuleTarget {
  item_id: string
  material_id: string | null
  material_code: string | null
  material_name?: string | null
  trip_label?: string | null
  remaining: number
  note?: string | null          // ghi chú CS (header_text) — hiện NGUYÊN VĂN
  current?: DateRule | null
}

const nf = (n: number) => n.toLocaleString('vi-VN')

/** Nhãn ngắn của quy tắc — dùng chung cho badge trên bảng dòng hàng. */
export function dateRuleLabel(r: DateRule | null | undefined): { text: string; cls: string } {
  if (!r) return { text: 'Chưa chốt', cls: 'bg-amber-100 text-amber-800' }
  if (r.kind === 'FEFO') return { text: 'FEFO', cls: 'bg-slate-100 text-slate-600' }
  if (r.kind === 'MIN_PCT') return { text: `≥ ${Number(r.value ?? 0)} %`, cls: 'bg-sky-100 text-sky-700' }
  return { text: `Chỉ định ${String(r.value ?? '')}`, cls: 'bg-purple-100 text-purple-700' }
}

export function SetDateRuleSheet(p: {
  open: boolean
  onClose: () => void
  targets: DateRuleTarget[]
  warehouseId: string | null
}) {
  const save = useSetItemsDateRule()
  // Mỗi dòng một quy tắc riêng; nút "Áp cho tất cả" chỉ là cách điền nhanh rồi sửa lẻ
  const [rules, setRules] = useState<Record<string, DateRule | null>>({})
  const [bulkKind, setBulkKind] = useState<DateRuleKind>('MIN_PCT')
  const [bulkVal, setBulkVal] = useState('60')
  const [openStock, setOpenStock] = useState<string | null>(null)   // material_id đang xem tồn

  useEffect(() => {
    if (!p.open) return
    setRules(Object.fromEntries(p.targets.map(t => [t.item_id, t.current ?? null])))
    setOpenStock(null)
  }, [p.open, p.targets])

  const nDone = useMemo(() => Object.values(rules).filter(Boolean).length, [rules])
  const setOne = (id: string, r: DateRule | null) => setRules(s => ({ ...s, [id]: r }))

  function applyAll() {
    const r: DateRule | null = bulkKind === 'FEFO'
      ? { kind: 'FEFO' }
      : bulkKind === 'MIN_PCT'
        ? (Number.isFinite(Number(bulkVal)) ? { kind: 'MIN_PCT', value: Math.round(Number(bulkVal)) } : null)
        : (bulkVal.trim() ? { kind: 'EXACT', value: bulkVal.trim() } : null)
    if (!r) return
    setRules(Object.fromEntries(p.targets.map(t => [t.item_id, r])))
  }

  async function submit() {
    // Gộp theo quy tắc GIỐNG NHAU → mỗi nhóm một lời gọi (thường chỉ 1–2 nhóm)
    const groups = new Map<string, string[]>()
    for (const t of p.targets) {
      const r = rules[t.item_id]
      if (!r) continue
      const k = JSON.stringify({ kind: r.kind, value: r.value ?? null })
      groups.set(k, [...(groups.get(k) ?? []), t.item_id])
    }
    for (const [k, ids] of groups) await save.mutateAsync({ item_ids: ids, rule: JSON.parse(k) as DateRule })
    p.onClose()
  }

  const errMsg = (save.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message

  return (
    <FormSheet
      open={p.open}
      onClose={p.onClose}
      widthClass="sm:max-w-3xl"
      title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-sky-600" />Chốt %Date lấy hàng</span>}
      description={
        <span className="text-[11px] text-slate-500">
          Hệ thống chỉ chia hàng cho dòng ĐÃ CHỐT. Bỏ trống thì dòng đó không lên “Việc cần làm”.
          Chọn <b>FEFO</b> nghĩa là xác nhận “đi theo hạn dùng ngắn nhất”.
        </span>
      }
      footer={
        <div className="flex items-center gap-2 w-full">
          <span className="text-[11px] text-slate-500">Đã chốt {nDone}/{p.targets.length} dòng</span>
          {errMsg && <span className="text-[11px] text-red-600 flex-1 truncate">{errMsg}</span>}
          <Button variant="outline" size="sm" className="ml-auto h-9 sm:h-8" onClick={p.onClose} disabled={save.isPending}>Huỷ</Button>
          <Button size="sm" className="h-9 sm:h-8" onClick={submit} disabled={save.isPending || nDone === 0}>
            {save.isPending ? 'Đang lưu…' : `Lưu ${nDone} dòng`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Điền nhanh — kho thường chốt cùng một mức cho cả chuyến, sửa lẻ vài dòng có ghi chú */}
        <div className="rounded-lg border bg-slate-50 p-2 flex flex-wrap items-end gap-2">
          <div className="text-[11px] font-medium text-slate-600 w-full sm:w-auto">Áp cho tất cả dòng:</div>
          <select value={bulkKind} onChange={e => setBulkKind(e.target.value as DateRuleKind)}
            className="h-9 sm:h-8 rounded-md border border-slate-300 bg-white px-2 text-[12px]">
            <option value="MIN_PCT">%Date tối thiểu</option>
            <option value="FEFO">FEFO — hạn ngắn nhất trước</option>
            <option value="EXACT">Chỉ định NSX / HSD / lô / tem</option>
          </select>
          {bulkKind !== 'FEFO' && (
            <Input value={bulkVal} onChange={e => setBulkVal(e.target.value)}
              placeholder={bulkKind === 'MIN_PCT' ? '60' : 'YYYY-MM-DD hoặc mã lô / tem'}
              className="h-9 sm:h-8 w-44 text-[12px]" />
          )}
          <Button size="sm" variant="outline" className="h-9 sm:h-8" onClick={applyAll}>Áp</Button>
        </div>

        {/* Bảng dòng — mỗi dòng: mã · chuyến · SL · GHI CHÚ CS nguyên văn · ô chốt */}
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b">
                {['Mã hàng', 'Chuyến', 'Còn lấy', 'Ghi chú của CS', 'Quy tắc lấy hàng'].map(h => (
                  <th key={h} className="text-left text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.targets.map(t => {
                const r = rules[t.item_id] ?? null
                return (
                  <>
                    <tr key={t.item_id} className="border-b last:border-0 align-top">
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap">
                        <button className="font-mono font-semibold text-sky-700 hover:underline flex items-center gap-1"
                          title="Xem tồn kho của mã này để quyết định"
                          onClick={() => setOpenStock(openStock === t.material_id ? null : (t.material_id ?? null))}>
                          <Boxes className="h-3 w-3" />{t.material_code ?? '—'}
                        </button>
                        {t.material_name && <div className="text-[9px] text-slate-400 max-w-[160px] truncate">{t.material_name}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-slate-600">{t.trip_label ?? '—'}</td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-right font-semibold tabular-nums">{nf(t.remaining)}</td>
                      <td className="px-2 py-1.5 text-[11px]">
                        {t.note
                          ? <span className="text-red-600 whitespace-pre-wrap break-words flex items-start gap-1">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{t.note}
                            </span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <RuleCell value={r} onChange={v => setOne(t.item_id, v)} />
                      </td>
                    </tr>
                    {openStock && openStock === t.material_id && (
                      <tr key={`${t.item_id}-stock`} className="bg-sky-50/50 border-b">
                        <td colSpan={5} className="px-2 py-2">
                          <StockPanel materialId={t.material_id} warehouseId={p.warehouseId} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </FormSheet>
  )
}

/** Ô chốt của MỘT dòng: loại quy tắc + giá trị. */
function RuleCell({ value, onChange }: { value: DateRule | null; onChange: (r: DateRule | null) => void }) {
  const kind = value?.kind ?? ''
  return (
    <div className="flex items-center gap-1">
      <select value={kind} onChange={e => {
        const k = e.target.value as DateRuleKind | ''
        if (!k) return onChange(null)
        if (k === 'FEFO') return onChange({ kind: 'FEFO' })
        onChange({ kind: k, value: k === 'MIN_PCT' ? 60 : '' })
      }} className="h-8 rounded-md border border-slate-300 bg-white px-1.5 text-[11px]">
        <option value="">— chưa chốt —</option>
        <option value="FEFO">FEFO</option>
        <option value="MIN_PCT">≥ %Date</option>
        <option value="EXACT">Chỉ định</option>
      </select>
      {value && value.kind !== 'FEFO' && (
        <Input value={String(value.value ?? '')} onChange={e => onChange({ ...value, value: value.kind === 'MIN_PCT' ? e.target.value : e.target.value })}
          placeholder={value.kind === 'MIN_PCT' ? '60' : 'YYYY-MM-DD / lô / tem'}
          className="h-8 w-32 text-[11px]" />
      )}
    </div>
  )
}

/** Tồn của mã tại kho — người chốt nhìn NSX/%Date/số pallet rồi mới gõ số. */
function StockPanel({ materialId, warehouseId }: { materialId: string | null; warehouseId: string | null }) {
  const { data, isLoading } = useInventoryByMaterial(materialId, warehouseId ?? undefined)
  if (!materialId) return <div className="text-[11px] text-slate-400">Mã chưa khớp danh mục — không tra được tồn</div>
  if (isLoading) return <div className="text-[11px] text-slate-400">Đang tra tồn…</div>
  const rows = (data ?? []) as Array<{ pallet_code?: string; location_code?: string; production_date?: string | null; pct_date?: number | null; cartons_remaining?: number }>
  if (!rows.length) return <div className="text-[11px] text-slate-400">Không còn tồn mã này trong kho</div>
  // Gom theo NSX: người chốt quyết theo NGÀY, không theo từng tem
  const byDate = new Map<string, { pallets: number; qty: number; pct: number | null }>()
  for (const e of rows) {
    const d = (e.production_date ?? '').slice(0, 10) || '(không rõ NSX)'
    const cur = byDate.get(d) ?? { pallets: 0, qty: 0, pct: e.pct_date ?? null }
    cur.pallets++; cur.qty += Number(e.cartons_remaining ?? 0)
    byDate.set(d, cur)
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => (
        <span key={d} className="rounded-md border border-sky-200 bg-white px-1.5 py-1 text-[10px] whitespace-nowrap">
          <b className="font-mono">{d}</b>
          {v.pct != null && <span className="text-slate-500"> · {Math.round(v.pct)} %</span>}
          <span className="text-slate-500"> · {nf(v.pallets)} pallet</span>
        </span>
      ))}
    </div>
  )
}
