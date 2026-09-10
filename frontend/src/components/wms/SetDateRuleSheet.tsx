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
//
// CHIA NHIỀU MỨC DATE = SỬA SỐ LƯỢNG, KHÔNG PHẢI "thêm phần" (user chốt 10/09 vòng 9):
//   "mặc định là 280 thùng date này, nhưng nếu sửa 250 thì khả dụng còn 30 thùng phải khai là
//    date nào". Nên mỗi dòng luôn mở ra với ĐÚNG MỘT phần ôm trọn số còn lấy; hạ số của phần đó
//   xuống thì phần dư TỰ HIỆN RA chờ khai. Bản trước bắt chọn "Chia phần theo SL" rồi bấm
//   "+ Thêm phần" — hai dòng ô nhập bung ra cùng lúc, người chốt không hiểu ô nào là gì.
// Và MỌI số lượng trên màn này hiển thị theo THÙNG (+ lẻ), không đổ số base thô như bản đầu —
// 13.440 hộp là con số không ai trong kho dùng để nói chuyện.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Boxes, AlertTriangle, Wand2 } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSetItemsDateRule, useInventoryByMaterial, useCheckDateRule, type DateRuleStock } from '@/api/hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { qtyLabel, qtyEntryDecimal, qtyEntryText, qtyFromEntryBase, qtyUnitLabel, type MatUnits } from '@/utils/qtyUnits'
import type { DateRule, DateRuleKind, SimpleRuleKind } from '@/types'

export interface DateRuleTarget {
  item_id: string
  material_id: string | null
  material_code: string | null
  material_name?: string | null
  trip_label?: string | null
  remaining: number             // SỐ BASE (hộp/chai/kg) — màn hình luôn quy về Thùng + lẻ để hiện
  units?: MatUnits | null       // quy cách của mã (base/entry/units_per_carton) để đổi Thùng ↔ base
  note?: string | null          // ghi chú CS (header_text) — hiện NGUYÊN VĂN
  current?: DateRule | null
}

/** Một PHẦN của dòng: bao nhiêu hàng đi theo mức date nào. `kind: ''` = phần dư chưa khai. */
type Part = { qty_base: number; kind: SimpleRuleKind | ''; value: string | number | null }

const MAX_PARTS = 10   // khớp CHECK `date_rule_valid()` ở DB

const nf = (n: number) => n.toLocaleString('vi-VN')

const simpleText = (k: SimpleRuleKind, v: unknown): string =>
  k === 'FEFO' ? 'FEFO' : k === 'MIN_PCT' ? `≥ ${Number(v ?? 0)} %` : `Chỉ định ${String(v ?? '')}`

/**
 * Nhãn ngắn của quy tắc — dùng chung cho badge trên bảng dòng hàng. SL trong badge theo THÙNG.
 * `dateRequired` = cột "Date (%)" của VL06O: chưa ai chốt tay nhưng hệ thống ĐÃ coi là mức phải theo
 * (`dateRuleOf` đọc tương thích, và bộ sinh việc chia hàng theo mức đó). Trước 10/09 badge vẫn ghi
 * "Chưa chốt" cho những dòng này trong khi bộ lọc/ô tổng đếm chúng là ĐÃ CHỐT — một màn hình kể hai
 * câu chuyện trái ngược nhau.
 */
export function dateRuleLabel(
  r: DateRule | null | undefined, units?: MatUnits | null, dateRequired?: number | null,
): { text: string; cls: string } {
  if (!r && Number(dateRequired) > 0)
    return { text: `≥ ${Number(dateRequired)} % (SAP)`, cls: 'bg-sky-50 text-sky-700 border border-sky-200' }
  if (!r) return { text: 'Chưa chốt', cls: 'bg-amber-100 text-amber-800' }
  if (r.kind === 'SPLIT')
    return {
      text: (r.parts ?? []).map(p => `${qtyEntryText(Number(p.qty_base), units)} ${simpleText(p.kind, p.value)}`).join(' · ') || 'Chia phần',
      cls: 'bg-indigo-100 text-indigo-700',
    }
  if (r.kind === 'FEFO') return { text: 'FEFO', cls: 'bg-slate-100 text-slate-600' }
  if (r.kind === 'MIN_PCT') return { text: `≥ ${Number(r.value ?? 0)} %`, cls: 'bg-sky-100 text-sky-700' }
  return { text: `Chỉ định ${String(r.value ?? '')}`, cls: 'bg-purple-100 text-purple-700' }
}

/**
 * Giữ BẤT BIẾN "tổng các phần = số còn lấy": đi từ trên xuống, phần nào vượt ngân sách thì cắt,
 * phần thừa rơi vào phần CUỐI — chưa khai thì nở ra, đã khai thì đẻ một phần mới chờ khai.
 * Nhờ vậy người dùng chỉ cần sửa MỘT ô số lượng, không phải tự cộng trừ cho khớp.
 */
function rebalance(parts: Part[], remaining: number): Part[] {
  const out: Part[] = []
  let budget = Math.max(0, remaining)
  for (const p of parts) {
    if (budget <= 0) break
    const q = Math.min(budget, Math.max(0, Number(p.qty_base) || 0))
    if (q <= 0 && out.length) continue
    out.push({ ...p, qty_base: q })
    budget -= q
  }
  if (!out.length) out.push({ qty_base: Math.max(0, remaining), kind: '', value: null })
  if (budget > 0) {
    const last = out[out.length - 1]
    if (last.kind === '' || out.length >= MAX_PARTS) last.qty_base += budget
    else out.push({ qty_base: budget, kind: '', value: null })
  }
  return out
}

/** Quy tắc đã lưu → các phần hiện trên màn (phần dư chưa khai tự hiện). */
function toParts(r: DateRule | null | undefined, remaining: number): Part[] {
  if (!r) return [{ qty_base: Math.max(0, remaining), kind: '', value: null }]
  if (r.kind !== 'SPLIT') return [{ qty_base: Math.max(0, remaining), kind: r.kind, value: r.value ?? null }]
  return rebalance((r.parts ?? []).map(p => ({ qty_base: Number(p.qty_base) || 0, kind: p.kind, value: p.value ?? null })), remaining)
}

/** Các phần ĐÃ KHAI (bỏ phần dư) — dùng để dựng quy tắc gửi đi và để dóng số thứ tự phần. */
const declaredOf = (parts: Part[]): Array<Part & { kind: SimpleRuleKind }> =>
  parts.filter((p): p is Part & { kind: SimpleRuleKind } => p.kind !== '')

/** Các phần trên màn → quy tắc gửi máy chủ. Một phần ôm trọn dòng thì gửi quy tắc ĐƠN, không SPLIT. */
function toRule(parts: Part[], remaining: number): DateRule | null {
  const decl = declaredOf(parts)
  if (!decl.length) return null
  const cap = Math.max(0, remaining)
  const simple = (p: Part & { kind: SimpleRuleKind }): DateRule => ({ kind: p.kind, value: p.value ?? null })
  if (decl.length === 1 && (cap <= 0 || decl[0].qty_base >= cap)) return simple(decl[0])
  const ps = decl.filter(p => p.qty_base > 0)
  if (!ps.length) return null
  if (ps.length === 1 && ps[0].qty_base >= cap) return simple(ps[0])
  return { kind: 'SPLIT', parts: ps.map(p => ({ qty_base: p.qty_base, kind: p.kind, value: p.value ?? null })) }
}

/** Số thứ tự DÒNG trên màn của từng phần trong `rule.parts` — để câu cảnh báo chỉ đúng ô người nhìn. */
function uiOfDeclared(parts: Part[], remaining: number): number[] {
  const rule = toRule(parts, remaining)
  if (rule?.kind !== 'SPLIT') return []
  const out: number[] = []
  parts.forEach((p, i) => { if (p.kind !== '' && p.qty_base > 0) out.push(i + 1) })
  return out
}

/**
 * Câu cảnh báo của MỘT dòng, dựng từ số máy chủ trả (không tự so date ở đây — luật khớp date nằm
 * ở `services/directedTasks.ts`). `bad` = chặn Lưu; `warn` = vẫn lưu được nhưng phải biết.
 */
function stockWarning(
  r: DateRule | null, st: DateRuleStock | undefined, units: MatUnits | null | undefined, uiRow: number[],
): { tone: 'bad' | 'warn'; text: string } | null {
  if (!r || !st) return null
  const noStock = st.total_base <= 0
  if (!st.ok) {
    if (noStock) return { tone: 'bad', text: 'Mã này không còn tồn dùng được trong kho — không chốt được mức nào.' }
    if (r.kind === 'SPLIT') {
      const bad = (st.parts ?? []).map((x, i) => (x.ok ? 0 : (uiRow[i] ?? i + 1))).filter(i => i > 0)
      return { tone: 'bad', text: `Phần ${bad.join(', ')} không còn tồn nào đạt${st.best_pct != null ? ` — %Date cao nhất trong kho là ${Math.floor(st.best_pct)} %` : ''}.` }
    }
    return {
      tone: 'bad',
      text: r.kind === 'MIN_PCT'
        ? `Không còn tồn nào đạt ≥ ${Number(r.value ?? 0)} %${st.best_pct != null ? ` — cao nhất trong kho là ${Math.floor(st.best_pct)} %` : ''}.`
        : `Không có pallet nào khớp “${String(r.value ?? '')}”.`,
    }
  }
  if (noStock) return { tone: 'warn', text: 'Mã này chưa có tồn trong kho — chốt được nhưng chưa chia được hàng.' }
  // Mẫu số là SỐ ĐÃ KHAI, không phải cả dòng: chia 250/280 mà so với 280 thì lúc nào cũng kêu
  // "chỉ đủ" dù kho thừa hàng — phần 30 chưa khai đã có câu nhắc riêng ngay dưới ô nhập.
  const need = r.kind === 'SPLIT' ? (st.parts ?? []).reduce((s, x) => s + Number(x.qty_base || 0), 0) : st.need_base
  if (need > 0 && st.matched_base < need)
    return { tone: 'warn', text: `Chỉ đủ ${qtyLabel(st.matched_base, units)}/${qtyLabel(need, units)} (${nf(st.matched_pallets)} pallet) đạt mức này.` }
  return null
}

export function SetDateRuleSheet(p: {
  open: boolean
  onClose: () => void
  targets: DateRuleTarget[]
  warehouseId: string | null
}) {
  const save = useSetItemsDateRule()
  // Mỗi dòng một DANH SÁCH PHẦN riêng (thường chỉ 1 phần); nút "Áp" chỉ là cách điền nhanh rồi sửa lẻ
  const [parts, setParts] = useState<Record<string, Part[]>>({})
  const [bulkKind, setBulkKind] = useState<DateRuleKind>('MIN_PCT')
  const [bulkVal, setBulkVal] = useState('60')
  const [openStock, setOpenStock] = useState<string | null>(null)   // material_id đang xem tồn
  // Ô TICK từng dòng (user 10/09: "checkbox tất cả và checkbox chỗ nào cần") — chỉ điều khiển nút
  // "Áp"; nút Lưu vẫn lưu MỌI dòng đã có quy tắc, để sửa lẻ xong không bị mất vì quên tick.
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!p.open) return
    setParts(Object.fromEntries(p.targets.map(t => [t.item_id, toParts(t.current, t.remaining)])))
    setOpenStock(null)
    setChecked(new Set())
  }, [p.open, p.targets])

  const allChecked = p.targets.length > 0 && checked.size === p.targets.length
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(p.targets.map(t => t.item_id)))
  const toggleOne = (id: string) => setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const partsOf = (t: DateRuleTarget): Part[] => parts[t.item_id] ?? toParts(t.current, t.remaining)
  const setOne = (t: DateRuleTarget, next: Part[]) =>
    setParts(s => ({ ...s, [t.item_id]: rebalance(next, t.remaining) }))

  // Quy tắc GỬI ĐI của từng dòng — một nguồn duy nhất cho: đếm đã chốt · hỏi tồn · lưu
  const ruleOf = useMemo(() => {
    const m = new Map<string, DateRule | null>()
    for (const t of p.targets) m.set(t.item_id, toRule(partsOf(t), t.remaining))
    return m
  }, [p.targets, parts])
  const nDone = useMemo(() => [...ruleOf.values()].filter(Boolean).length, [ruleOf])

  // CÒN HÀNG ĐỂ LẤY KHÔNG — hỏi máy chủ ngay lúc vừa gõ xong (user chốt 10/09: "yêu cầu %date mà
  // mã đó không còn thì phải cảnh báo NGAY LÚC CHỌN và không cho chọn"). Một lời gọi cho cả bảng,
  // debounce 400ms để gõ "8" rồi "5" không thành hai lượt hỏi.
  const askList = useMemo(
    () => p.targets.map(t => ({ item_id: t.item_id, rule: ruleOf.get(t.item_id) ?? null }))
      .filter((x): x is { item_id: string; rule: DateRule } => !!x.rule),
    [p.targets, ruleOf],
  )
  const asked = useDebouncedValue(askList, 400)
  const { data: stock, isFetching: checking } = useCheckDateRule(asked, p.open)
  const stockOf = useMemo(() => new Map((stock ?? []).map(s => [s.item_id, s])), [stock])
  // Chỉ chặn khi câu trả lời ỨNG với quy tắc đang hiện trên màn (người vừa sửa xong thì chờ lượt hỏi mới)
  const settled = JSON.stringify(asked) === JSON.stringify(askList)
  const blocked = useMemo(
    () => (settled ? askList.filter(a => stockOf.get(a.item_id)?.ok === false).map(a => a.item_id) : []),
    [settled, askList, stockOf],
  )

  function applyAll() {
    const k: SimpleRuleKind | null = bulkKind === 'SPLIT' ? null : bulkKind
    if (!k) return
    const val: string | number | null = k === 'FEFO'
      ? null
      : k === 'MIN_PCT'
        ? (Number.isFinite(Number(bulkVal)) && bulkVal.trim() ? Math.round(Number(bulkVal)) : null)
        : (bulkVal.trim() || null)
    if (k !== 'FEFO' && val === null) return
    setParts(s => ({
      ...s,
      ...Object.fromEntries(p.targets.filter(t => checked.has(t.item_id))
        .map(t => [t.item_id, [{ qty_base: Math.max(0, t.remaining), kind: k, value: val }] as Part[]])),
    }))
  }

  async function submit() {
    // Gộp theo quy tắc GIỐNG NHAU → mỗi nhóm một lời gọi (thường chỉ 1–2 nhóm). Khoá gộp phải mang
    // CẢ `parts`, không thì hai dòng chia phần khác nhau bị coi là một và dòng sau ăn quy tắc dòng trước.
    const groups = new Map<string, string[]>()
    for (const t of p.targets) {
      const r = ruleOf.get(t.item_id)
      if (!r) continue
      const k = JSON.stringify(r.kind === 'SPLIT'
        ? { kind: 'SPLIT', parts: (r.parts ?? []).map(x => ({ qty_base: Number(x.qty_base) || 0, kind: x.kind, value: x.value ?? null })) }
        : { kind: r.kind, value: r.value ?? null })
      groups.set(k, [...(groups.get(k) ?? []), t.item_id])
    }
    for (const [k, ids] of groups) await save.mutateAsync({ item_ids: ids, rule: JSON.parse(k) as DateRule })
    p.onClose()
  }

  const errMsg = (save.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message

  /** Một dòng hàng: ô chốt + cảnh báo tồn — dùng chung cho thẻ điện thoại và hàng bảng. */
  const renderRule = (t: DateRuleTarget) => {
    const ps = partsOf(t)
    const rule = ruleOf.get(t.item_id) ?? null
    const st = settled ? stockOf.get(t.item_id) : undefined
    const uiRow = uiOfDeclared(ps, t.remaining)
    const warn = stockWarning(rule, st, t.units, uiRow)
    const partOk = (i: number) => {
      const j = uiRow.indexOf(i + 1)
      return j < 0 ? undefined : st?.parts?.[j]?.ok
    }
    return { ps, warn, partOk }
  }

  return (
    <FormSheet
      open={p.open}
      onClose={p.onClose}
      widthClass="sm:max-w-5xl"
      title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-sky-600" />Chốt %Date lấy hàng</span>}
      description={
        <span className="text-[11px] text-slate-500">
          Hệ thống chỉ chia hàng cho dòng ĐÃ CHỐT — bỏ trống thì dòng đó không lên “Việc cần làm”.
          Mặc định cả dòng đi theo MỘT mức; muốn chia thì <b>sửa số lượng</b> của mức đó, phần còn lại
          sẽ hiện ra để khai tiếp.
        </span>
      }
      footer={
        <div className="flex items-center gap-2 w-full">
          <span className="text-[11px] text-slate-500">Đã chốt {nDone}/{p.targets.length} dòng</span>
          {blocked.length > 0 && (
            <span className="text-[11px] text-red-600 font-medium">· {blocked.length} dòng không còn hàng đạt mức đã chọn</span>
          )}
          {errMsg && <span className="text-[11px] text-red-600 flex-1 truncate">{errMsg}</span>}
          <Button variant="outline" size="sm" className="ml-auto h-9 sm:h-8" onClick={p.onClose} disabled={save.isPending}>Huỷ</Button>
          <Button size="sm" className="h-9 sm:h-8" onClick={submit}
            disabled={save.isPending || nDone === 0 || blocked.length > 0 || (checking && !settled)}>
            {save.isPending ? 'Đang lưu…' : checking && !settled ? 'Đang tra tồn…' : `Lưu ${nDone} dòng`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* ÁP NHANH — đây là HÀNH ĐỘNG lên các dòng đã tick, KHÔNG phải số liệu của đơn. Bản trước
            để ô "60" trần trên nền xám cạnh bảng nên nhìn hệt một cột số lượng (user bắt 10/09):
            nay đóng khung xanh, có tiêu đề, nút màu đặc và câu nhắc khi chưa tick dòng nào.
            "Chia theo SL" không có ở đây — số lượng mỗi dòng một khác, chỉ chia được tại dòng. */}
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
            <Wand2 className="h-3.5 w-3.5" /> Áp nhanh cho các dòng đã tick
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Điện thoại không có hàng tiêu đề bảng nên ô "chọn tất cả" ở đây; desktop dùng ô đầu bảng */}
            <label className="sm:hidden flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-sky-600" />
              Chọn tất cả {p.targets.length}
            </label>
            <select value={bulkKind} onChange={e => setBulkKind(e.target.value as DateRuleKind)}
              className="h-9 sm:h-8 rounded-md border border-slate-300 bg-white px-2 text-[12px]">
              <option value="MIN_PCT">%Date tối thiểu</option>
              <option value="FEFO">FEFO — hạn ngắn nhất trước</option>
              <option value="EXACT">Chỉ định NSX / HSD / lô / tem</option>
            </select>
            {bulkKind !== 'FEFO' && (
              <div className="relative">
                <Input value={bulkVal} onChange={e => setBulkVal(e.target.value)}
                  placeholder={bulkKind === 'MIN_PCT' ? '60' : 'YYYY-MM-DD hoặc mã lô / tem'}
                  className={`h-9 sm:h-8 text-[12px] ${bulkKind === 'MIN_PCT' ? 'w-24 pr-6 text-right' : 'w-52'}`} />
                {bulkKind === 'MIN_PCT' && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">%</span>
                )}
              </div>
            )}
            <Button size="sm" className="h-9 sm:h-8 bg-sky-600 hover:bg-sky-700 text-white"
              onClick={applyAll} disabled={checked.size === 0}>
              Áp cho {checked.size} dòng
            </Button>
            {checked.size === 0 && (
              <span className="text-[11px] text-slate-500">Tick ô vuông ở đầu dòng bên dưới để chọn</span>
            )}
          </div>
        </div>

        {/* ĐIỆN THOẠI: mỗi dòng một THẺ, không phải hàng bảng. Đo 360px: bảng rộng hơn màn nên hai
            cột phải — Ghi chú của CS và ô chốt (nơi hiện cảnh báo đỏ) — nằm ngoài khung; cuộn ngang
            thì đọc được nhưng người ta phải ĐOÁN là có thể kéo, mà đây là màn BẮT BUỘC đọc ghi chú
            rồi mới quyết. Thẻ hiện đủ mọi trường, không giấu cột nào. */}
        <div className="sm:hidden space-y-2">
          {p.targets.map(t => {
            const { ps, warn, partOk } = renderRule(t)
            return (
              <div key={t.item_id} className={`rounded-lg border p-2 space-y-1.5 ${warn?.tone === 'bad' ? 'border-red-300 bg-red-50/60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <input type="checkbox" checked={checked.has(t.item_id)} onChange={() => toggleOne(t.item_id)}
                      className="h-4 w-4 accent-sky-600 shrink-0" />
                    <button className="font-mono font-semibold text-[12px] text-sky-700 flex items-center gap-1 min-w-0"
                      onClick={() => setOpenStock(openStock === t.material_id ? null : (t.material_id ?? null))}>
                      <Boxes className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t.material_code ?? '—'}</span>
                    </button>
                  </div>
                  <span className="text-[12px] font-semibold tabular-nums shrink-0">{qtyLabel(t.remaining, t.units)}</span>
                </div>
                {t.material_name && <div className="text-[10px] text-slate-500">{t.material_name}</div>}
                <div className="text-[10px] text-slate-500">Chuyến {t.trip_label ?? '—'}</div>
                {t.note && (
                  <div className="text-[11px] text-red-600 flex items-start gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                    <span className="whitespace-pre-wrap break-words">{t.note}</span>
                  </div>
                )}
                <RuleCell parts={ps} onChange={next => setOne(t, next)} remaining={t.remaining} units={t.units} partOk={partOk} />
                {warn && (
                  <div className={`text-[11px] flex items-start gap-1 ${warn.tone === 'bad' ? 'text-red-600 font-medium' : 'text-amber-600'}`}>
                    <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                    <span className="whitespace-normal break-words">{warn.text}</span>
                  </div>
                )}
                {openStock && openStock === t.material_id && (
                  <div className="rounded-md bg-sky-50/60 p-1.5"><StockPanel materialId={t.material_id} warehouseId={p.warehouseId} /></div>
                )}
              </div>
            )
          })}
        </div>

        {/* Bảng dòng (từ sm trở lên) — mã · chuyến · SL · GHI CHÚ CS nguyên văn · ô chốt */}
        <div className="hidden sm:block rounded-lg border overflow-x-auto">
          <table className="w-full min-w-[660px]">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="w-8 px-2 py-1.5">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-sky-600"
                    title="Chọn tất cả các dòng" />
                </th>
                {['Mã hàng', 'Chuyến', 'Còn lấy', 'Ghi chú của CS', 'Quy tắc lấy hàng'].map(h => (
                  <th key={h} className="text-left text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.targets.map(t => {
                const { ps, warn, partOk } = renderRule(t)
                return (
                  <Fragment key={t.item_id}>
                    <tr className={`border-b last:border-0 align-top ${warn?.tone === 'bad' ? 'bg-red-50/60' : ''}`}>
                      <td className="px-2 py-1.5 align-top">
                        <input type="checkbox" checked={checked.has(t.item_id)} onChange={() => toggleOne(t.item_id)} className="h-4 w-4 accent-sky-600" />
                      </td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap">
                        <button className="font-mono font-semibold text-sky-700 hover:underline flex items-center gap-1"
                          title="Xem tồn kho của mã này để quyết định"
                          onClick={() => setOpenStock(openStock === t.material_id ? null : (t.material_id ?? null))}>
                          <Boxes className="h-3 w-3" />{t.material_code ?? '—'}
                        </button>
                        {t.material_name && <div className="text-[9px] text-slate-400 max-w-[160px] truncate">{t.material_name}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-slate-600">{t.trip_label ?? '—'}</td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-right font-semibold tabular-nums">
                        {qtyLabel(t.remaining, t.units)}
                      </td>
                      <td className="px-2 py-1.5 text-[11px]">
                        {t.note
                          ? <span className="text-red-600 whitespace-pre-wrap break-words flex items-start gap-1">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{t.note}
                            </span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <RuleCell parts={ps} onChange={next => setOne(t, next)} remaining={t.remaining} units={t.units} partOk={partOk} />
                        {warn && (
                          <div className={`mt-1 text-[10px] flex items-start gap-1 max-w-[280px] ${warn.tone === 'bad' ? 'text-red-600 font-medium' : 'text-amber-600'}`}>
                            <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
                            <span className="whitespace-normal break-words">{warn.text}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                    {openStock && openStock === t.material_id && (
                      <tr key={`${t.item_id}-stock`} className="bg-sky-50/50 border-b">
                        <td colSpan={6} className="px-2 py-2">
                          <StockPanel materialId={t.material_id} warehouseId={p.warehouseId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </FormSheet>
  )
}

/** Đọc số người gõ: "1.440" = 1440 (chuẩn nghìn VN), "30,5" = 30,5 — mã KG mới có phần thập phân. */
function parseQty(s: string): number {
  const n = Number(s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}
/** Số trong ô nhập phải viết theo chuẩn VN (phẩy = thập phân), nếu không `parseQty` đọc "7004.875" thành 7 triệu. */
const qtyText = (base: number, u?: MatUnits | null): string =>
  base > 0 ? String(qtyEntryDecimal(base, u)).replace('.', ',') : ''

/**
 * Ô chốt của MỘT dòng. Mỗi phần một hàng: [SL] [đơn vị] [quy tắc] [giá trị].
 * Hạ SL của một phần xuống thì phần dư TỰ HIỆN RA ở hàng dưới chờ khai (user 10/09: "mặc định là
 * 280 thùng date này nhưng nếu sửa 250 thì khả dụng còn 30 thùng phải khai là date nào").
 * SL gõ theo THÙNG (mã không quy cách thùng thì theo đơn vị gốc) — quy đổi tại rìa bằng qtyFromEntryBase.
 */
function RuleCell({ parts, onChange, remaining, units, partOk }: {
  parts: Part[]
  onChange: (next: Part[]) => void
  remaining: number
  units?: MatUnits | null
  partOk: (i: number) => boolean | undefined
}) {
  const unit = qtyUnitLabel(units)
  const patch = (i: number, up: Partial<Part>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...up } : p)))
  const tail = parts[parts.length - 1]
  const undeclared = parts.length > 1 && tail?.kind === '' ? tail.qty_base : 0

  return (
    <div className="space-y-1">
      {parts.map((p, i) => (
        <div key={i} className="flex items-center gap-1 flex-wrap">
          <Input value={qtyText(p.qty_base, units)} inputMode="decimal"
            title="Sửa số này để chia dòng thành nhiều mức date — phần còn lại sẽ hiện ra ở dưới"
            onChange={e => patch(i, { qty_base: qtyFromEntryBase(parseQty(e.target.value), 0, units) })}
            className="h-8 w-[68px] text-[11px] text-right" placeholder="SL" />
          <span className="text-[10px] text-slate-500 whitespace-nowrap">{unit}</span>
          <select value={p.kind}
            onChange={e => {
              const k = e.target.value as SimpleRuleKind | ''
              patch(i, { kind: k, value: k === 'MIN_PCT' ? 60 : k === 'EXACT' ? '' : null })
            }}
            className={`h-8 rounded-md border bg-white px-1.5 text-[11px] ${p.kind === '' ? 'border-amber-400 text-amber-700' : 'border-slate-300'}`}>
            <option value="">— chưa chốt —</option>
            <option value="FEFO">FEFO</option>
            <option value="MIN_PCT">≥ %Date</option>
            <option value="EXACT">Chỉ định</option>
          </select>
          {p.kind === 'MIN_PCT' && (
            <div className="relative">
              <Input value={String(p.value ?? '')} onChange={e => patch(i, { value: e.target.value })}
                placeholder="60" inputMode="numeric" className="h-8 w-[62px] pr-5 text-[11px] text-right" />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">%</span>
            </div>
          )}
          {p.kind === 'EXACT' && (
            <Input value={String(p.value ?? '')} onChange={e => patch(i, { value: e.target.value })}
              placeholder="NSX / lô / tem" className="h-8 w-28 text-[11px]" />
          )}
          {partOk(i) === false && <span className="text-[10px] text-red-600 font-medium">không còn hàng</span>}
          {i > 0 && (
            <button className="text-[10px] text-slate-400 hover:text-red-600 px-1" title="Bỏ phần này (số lượng dồn về phần cuối)"
              onClick={() => onChange(parts.filter((_, j) => j !== i))}>✕</button>
          )}
        </div>
      ))}
      {undeclared > 0 && (
        <div className="text-[10px] text-amber-600">
          Còn {qtyLabel(undeclared, units)} chưa khai mức date — phần này sẽ không được chia hàng.
        </div>
      )}
      {remaining > 0 && parts.length > 1 && (
        <div className="text-[10px] text-slate-400">Tổng {parts.length} phần = {qtyLabel(remaining, units)} còn lấy</div>
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
