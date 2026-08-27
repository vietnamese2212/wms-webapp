// PHIẾU CHI PHÍ của một kho trong một kỳ tháng (user chốt 27/08 vòng 2:
// "mở nó ra thì có thể add, edit các khoản chi phí — áp dụng tương tự form xuất nhập, bao gồm cả
//  việc copy paste…").
//
// DÁN LÀM ĐÚNG KIỂU FORM PHIẾU XUẤT (user bác bản đầu 27/08: "cái tôi yêu cầu là tính năng tương tự
// như Mở phiếu xuất, nơi có thể copy paste giá trị mã hàng, số lượng cơ mà"): dán THẲNG VÀO Ô của
// lưới, không qua hộp thoại riêng —
//   · dán vào ô **Khoản mục**: mỗi dòng Excel = 1 dòng phiếu, cột `Khoản mục ⇥ Số tiền ⇥ Ghi chú`,
//     tự thêm dòng cho đủ (khớp `handlePasteRowAt` của `Outbound.tsx`);
//   · dán vào ô **Số tiền** / **Ghi chú**: điền lần lượt XUỐNG DƯỚI từ ô đang dán (khớp
//     `handlePasteCartonsAt` / `handlePasteNoteAt`).
// Vì thế ô Khoản mục là Ô NHẬP có gợi ý (kiểu `MatPicker`), KHÔNG phải dropdown — dropdown thì
// không dán vào được, đó chính là chỗ bản đầu làm sai.
//
// Vì sao sửa TẠI CHỖ cả bảng rồi bấm Lưu MỘT lần: kế toán kê một phiếu là điền cả cụm, thường dán
// thẳng từ file Excel đang mở. Mỗi dòng một lượt gọi API vừa chậm vừa để lại phiếu ghi DỞ khi mạng
// rớt giữa chừng — ở đây một lần bấm là một lượt ghi (BE xoá/thêm/sửa theo lô trong `saveVoucher`).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Wallet, Plus, Trash2, Save, Lock, Unlock, RotateCcw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { formatTimestampDate } from '@/utils/formatters'
import { useCostVoucher, useSaveCostVoucher, useLockCostPeriod, type CostItem } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { money, parseMoney, warehouseKeyOf, SHARED_KEY } from './costShared'

/** `raw` = chữ đang hiện trong ô Khoản mục; `cost_item` rỗng = chưa khớp danh mục (dòng đỏ). */
type Row = { key: string; id?: string; cost_item: string; raw: string; amount: number; note: string }
let seq = 0
const newKey = () => `n${++seq}`
const blankRow = (): Row => ({ key: newKey(), cost_item: '', raw: '', amount: 0, note: '' })

function apiErr(e: unknown): string {
  const m = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return m ?? 'Có lỗi xảy ra — thử lại.'
}
/** So khớp tên khoản mục khi dán/gõ: bỏ dấu, bỏ hoa/thường, gộp khoảng trắng. */
const normItem = (s: string) => s.trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ')

export default function WarehouseCostVoucher() {
  const nav = useNavigate()
  const { whKey, period = '' } = useParams<{ whKey: string; period: string }>()
  const warehouseKey = warehouseKeyOf(whKey)
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEdit = can(perms, 'warehouse_cost', 'edit')
  const canLock = can(perms, 'warehouse_cost', 'lock')

  const { data, isLoading, isError, error } = useCostVoucher(warehouseKey, period)
  const save = useSaveCostVoucher()
  const lock = useLockCostPeriod()

  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const items = useMemo(() => data?.items ?? [], [data])
  const itemBy = useMemo(() => new Map(items.map(i => [i.code, i])), [items])
  /** nhãn/mã (đã chuẩn hoá) → khoản mục, dùng khi dán và khi gõ tay. */
  const itemByName = useMemo(() => {
    const m = new Map<string, CostItem>()
    for (const i of items) { m.set(normItem(i.label), i); m.set(normItem(i.code), i) }
    return m
  }, [items])

  const fromServer = (): Row[] => (data?.rows ?? []).map(r => ({
    key: r.id, id: r.id, cost_item: r.cost_item, raw: r.item_label, amount: r.amount, note: r.note ?? '',
  }))
  // Nạp lại lưới mỗi khi dữ liệu server đổi (mở phiếu, lưu xong, người khác vừa sửa)
  const serverStamp = useMemo(
    () => (data?.rows ?? []).map(r => `${r.id}:${r.cost_item}:${r.amount}:${r.note ?? ''}`).join('|'),
    [data])
  useEffect(() => { setRows(fromServer()) }, [serverStamp])

  const locked = data?.locked === true
  const readOnly = locked || !canEdit

  const dirty = useMemo(() => {
    const a = rows.filter(r => r.cost_item).map(r => `${r.cost_item}:${Math.round(r.amount)}:${r.note.trim()}`).sort().join('|')
    const b = (data?.rows ?? []).map(r => `${r.cost_item}:${Math.round(r.amount)}:${(r.note ?? '').trim()}`).sort().join('|')
    return a !== b
  }, [rows, data])

  const total = rows.reduce((s, r) => s + (r.cost_item ? r.amount : 0), 0)
  const labor = rows.reduce((s, r) => s + (r.cost_item && itemBy.get(r.cost_item)?.is_labor ? r.amount : 0), 0)
  const filled = rows.filter(r => r.cost_item).length

  // Dòng hỏng: tên chưa có trong danh mục, hoặc khoản mục bị khai 2 lần trong cùng phiếu
  const unknownNames = rows.filter(r => !r.cost_item && r.raw.trim()).map(r => r.raw.trim())
  const dupCodes = useMemo(() => {
    const seen = new Set<string>(), dup = new Set<string>()
    for (const r of rows) if (r.cost_item) (seen.has(r.cost_item) ? dup : seen).add(r.cost_item)
    return dup
  }, [rows])
  const blocked = unknownNames.length > 0 || dupCodes.size > 0

  function patch(key: string, p: Partial<Row>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)))
  }
  function addRow() { setRows(rs => [...rs, blankRow()]) }
  /** Điền lần lượt xuống dưới từ dòng `startIdx`, tự thêm dòng cho đủ (kiểu form phiếu xuất). */
  function fillDown(startIdx: number, values: string[], apply: (val: string, row: Row) => Partial<Row>) {
    setRows(prev => {
      const next = [...prev]
      while (next.length < startIdx + values.length) next.push(blankRow())
      values.forEach((v, off) => { next[startIdx + off] = { ...next[startIdx + off], ...apply(v.trim(), next[startIdx + off]) } })
      return next
    })
  }

  /** Dán vào ô KHOẢN MỤC: 1 dòng Excel = 1 dòng phiếu (Khoản mục ⇥ Số tiền ⇥ Ghi chú). */
  function handlePasteItemAt(startIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\t') && !text.includes('\n')) return   // dán 1 ô chữ → để trình duyệt dán bình thường
    e.preventDefault()
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
    setRows(prev => {
      const next = [...prev]
      while (next.length < startIdx + lines.length) next.push(blankRow())
      lines.forEach((line, off) => {
        const cols = line.split('\t')
        const name = (cols[0] ?? '').trim()
        if (!name || /^(khoản mục|khoan muc|item)$/i.test(name)) return   // bỏ dòng tiêu đề copy kèm
        const it = itemByName.get(normItem(name))
        const row = next[startIdx + off]
        next[startIdx + off] = {
          ...row,
          cost_item: it?.code ?? '',      // không khớp danh mục → giữ nguyên chữ, dòng hiện ĐỎ
          raw: it?.label ?? name,
          ...(cols[1] != null && cols[1].trim() ? { amount: parseMoney(cols[1]) } : {}),
          ...(cols[2] != null && cols[2].trim() ? { note: cols[2].trim() } : {}),
        }
      })
      return next
    })
  }

  async function onSave() {
    setErr(null); setMsg(null)
    const payload = rows.filter(r => r.cost_item)
      .map(r => ({ id: r.id, cost_item: r.cost_item, amount: Math.round(r.amount), note: r.note.trim() || null }))
    try {
      const r = await save.mutateAsync({ period, warehouse_id: warehouseKey === SHARED_KEY ? null : warehouseKey, lines: payload })
      setMsg(`Đã lưu phiếu: ${r.saved} khoản mục${r.deleted ? ` · xoá ${r.deleted} dòng` : ''} · tổng ${money(r.amount)} đ.`)
    } catch (e) { setErr(apiErr(e)) }
  }

  const actions: ActionItem[] = [
    ...(readOnly ? [] : [
      { key: 'save', icon: Save, label: 'Lưu phiếu', tip: blocked ? 'Còn dòng chưa hợp lệ — xem dòng tô đỏ' : 'Ghi toàn bộ thay đổi của phiếu trong một lần',
        primary: true, onClick: onSave, busy: save.isPending, disabled: !dirty || blocked || save.isPending },
      { key: 'add', icon: Plus, label: 'Thêm dòng', tip: 'Thêm một khoản mục vào phiếu', onClick: addRow },
      { key: 'reset', icon: RotateCcw, label: 'Bỏ thay đổi', tip: 'Trở lại đúng số đang lưu trên hệ thống',
        onClick: () => setRows(fromServer()), disabled: !dirty },
    ] satisfies ActionItem[]),
    ...(canLock && data ? [{
      key: 'lock', icon: locked ? Unlock : Lock, label: locked ? 'Mở lại kỳ' : 'Chốt kỳ',
      tip: locked ? 'Mở lại kỳ để sửa tiếp' : 'Chốt kỳ — sau đó mọi đường ghi của kho này trong kỳ đều bị chặn',
      busy: lock.isPending,
      onClick: async () => {
        if (dirty && !confirm('Phiếu đang có thay đổi CHƯA LƯU — chốt kỳ bây giờ sẽ mất phần chưa lưu. Tiếp tục?')) return
        setErr(null); setMsg(null)
        try { await lock.mutateAsync({ period, warehouse_id: data.warehouse_id, locked: !locked }); setMsg(locked ? 'Đã mở lại kỳ.' : 'Đã chốt kỳ.') }
        catch (e) { setErr(apiErr(e)) }
      },
    } satisfies ActionItem] : []),
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => { if (!dirty || confirm('Phiếu có thay đổi chưa lưu — rời trang?')) nav('/wms/warehouse-costs') }}
              className="px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100" title="Về danh sách phiếu">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 uppercase tracking-wide shrink-0">
              <Wallet className="h-4 w-4 text-sky-600" /> Phiếu chi phí
            </span>
            <span className="text-[11px] text-slate-500">
              kỳ <b className="text-slate-700">{period}</b> · {isLoading ? '…' : data?.warehouse_name}
            </span>
            {locked && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700">Đã chốt</span>}
            {dirty && !readOnly && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-700">Chưa lưu</span>}
            <span className="flex-1" />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <ActionCluster items={actions} mobileInline />
            </div>
          </div>
        </div>

        <SummaryBand tiles={[
          { label: 'Tổng chi phí phiếu', value: money(total), accent: true },
          { label: 'Trong đó nhân công', value: money(labor) },
          { label: 'Số khoản mục', value: String(filled) },
          { label: 'Cập nhật cuối', value: data?.rows?.length ? formatTimestampDate(
            data.rows.reduce((a, b) => ((b.updated_at ?? '') > (a.updated_at ?? '') ? b : a)).updated_at as string, true) : '—' },
        ]} />

        {err && <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}
        {msg && <div className="mx-3 mt-2 rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-700">{msg}</div>}
        {isError && <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
          Không mở được phiếu — {apiErr(error)}
        </div>}
        {locked && <div className="mx-3 mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Kỳ này của kho đã <b>CHỐT</b> — phiếu chỉ xem. {canLock ? 'Bấm "Mở lại kỳ" nếu cần sửa.' : 'Nhờ người có quyền chốt kỳ mở lại nếu cần sửa.'}
        </div>}
        {blocked && (
          <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 flex gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>
              {unknownNames.length > 0 && <>Khoản mục chưa có trong danh mục: <b>{[...new Set(unknownNames)].join(', ')}</b> — thêm ở nút <b>Khoản mục</b> (trang danh sách phiếu) rồi chọn lại. </>}
              {dupCodes.size > 0 && <>Có khoản mục bị khai <b>2 dòng</b> trong cùng phiếu — gộp lại thành một dòng. </>}
              Lưu phiếu đang tạm khoá.
            </span>
          </div>
        )}

        {!readOnly && (
          <div className="mx-3 mt-2 text-[11px] text-slate-500">
            Dán từ Excel: copy vùng <b>Khoản mục ⇥ Số tiền ⇥ Ghi chú</b> rồi dán vào ô <b>Khoản mục</b> —
            các dòng tự điền xuống dưới. Dán một cột số vào ô <b>Số tiền</b> cũng được.
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <table className="min-w-full text-left">
            <thead>
              <tr className="bg-slate-50">
                {['', 'Khoản mục', 'Số tiền (đồng)', 'Ghi chú', 'Cập nhật'].map((h, i) => (
                  <th key={h + i} className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${
                    i === 0 ? 'sticky left-0 z-20 bg-slate-50 w-10' : i === 2 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-2 py-1"><Skeleton className="h-7 rounded bg-slate-200" /></td></tr>
              ))}
              {!isLoading && rows.map((r, idx) => {
                const srv = data?.rows.find(x => x.id === r.id)
                const bad = (!r.cost_item && !!r.raw.trim()) || (r.cost_item && dupCodes.has(r.cost_item))
                return (
                  <tr key={r.key} className={`border-t border-slate-100 ${bad ? 'bg-red-50/60' : ''}`}>
                    <td className={`sticky left-0 z-10 px-1.5 py-1 whitespace-nowrap ${bad ? 'bg-red-50' : 'bg-white'}`}>
                      {readOnly ? <span className="text-slate-300">—</span> : (
                        <button type="button" title="Xoá dòng khỏi phiếu" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}
                          className="px-1.5 py-1 rounded text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {readOnly
                        ? <span className="text-[10px] text-slate-700">{srv?.item_label ?? r.raw}{srv?.is_labor && <span className="ml-1 text-emerald-600">◆</span>}</span>
                        : <ItemPicker
                            row={r} items={items} itemByName={itemByName}
                            usedCodes={rows.filter(x => x.key !== r.key).map(x => x.cost_item)}
                            invalid={!!bad}
                            onChange={p => patch(r.key, p)}
                            onPaste={e => handlePasteItemAt(idx, e)}
                          />}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-right">
                      {readOnly
                        ? <span className="text-[10px] tabular-nums font-semibold text-slate-800">{money(r.amount)}</span>
                        : <input value={r.amount ? money(r.amount) : ''} inputMode="numeric" placeholder="0"
                            onChange={e => patch(r.key, { amount: parseMoney(e.target.value) })}
                            onPaste={e => {
                              const text = e.clipboardData.getData('text')
                              if (!text.includes('\n')) return          // dán 1 số → để bình thường
                              e.preventDefault()
                              fillDown(idx, text.trim().split(/\r?\n/).filter(v => v.trim()), v => ({ amount: parseMoney(v) }))
                            }}
                            className="w-28 sm:w-36 h-8 px-2 rounded border border-slate-200 text-[11px] text-right tabular-nums outline-none focus:border-blue-400" />}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {readOnly
                        ? <span className="text-[10px] text-slate-500">{r.note || <span className="text-slate-300">—</span>}</span>
                        : <input value={r.note} onChange={e => patch(r.key, { note: e.target.value })} placeholder="Số hợp đồng, diễn giải…"
                            onPaste={e => {
                              const text = e.clipboardData.getData('text')
                              if (!text.includes('\n')) return
                              e.preventDefault()
                              fillDown(idx, text.trim().split(/\r?\n/).filter(v => v.trim()), v => ({ note: v }))
                            }}
                            className="w-40 sm:w-64 h-8 px-2 rounded border border-slate-200 text-[11px] outline-none focus:border-blue-400" />}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {srv?.updated_at ? (
                        <div className="leading-tight">
                          <div className="text-[10px] text-slate-600">{srv.updated_by ?? '—'}</div>
                          <div className="text-[9px] text-slate-400">{formatTimestampDate(srv.updated_at, true)}</div>
                        </div>
                      ) : <span className="text-[9px] text-sky-600">dòng mới</span>}
                    </td>
                  </tr>
                )
              })}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-8 text-center text-[11px] text-slate-400">
                  Phiếu chưa có khoản chi phí nào.
                  {!readOnly && <> Bấm <b>Thêm dòng</b> rồi gõ, hoặc dán thẳng bảng Excel vào ô <b>Khoản mục</b>.
                    {/* Phiếu là NHÓM của các dòng — chưa lưu dòng nào thì nó chưa tồn tại, nói rõ
                        kẻo người dùng tạo phiếu xong rời trang rồi đi tìm nó trong danh sách */}
                    <div className="mt-1 text-slate-400">Phiếu chỉ xuất hiện ở danh sách sau khi <b>Lưu</b> ít nhất một khoản mục.</div></>}
                </td></tr>
              )}
              {!isLoading && !readOnly && (
                <tr className="border-t border-slate-100">
                  <td colSpan={5} className="px-2 py-1.5">
                    <button type="button" onClick={addRow}
                      className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-700">
                      <Plus className="h-3.5 w-3.5" /> Thêm dòng
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t px-3 py-1.5 flex items-center gap-2 text-[10px] text-slate-500 shrink-0 flex-wrap">
          <span>{filled} khoản mục · tổng <b className="text-slate-700 tabular-nums">{money(total)}</b> đ</span>
          <span className="flex-1" />
          {!readOnly && (
            <Button size="sm" className="h-7 text-[11px]" onClick={onSave} disabled={!dirty || blocked || save.isPending}>
              {save.isPending ? 'Đang lưu…' : 'Lưu phiếu'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Ô KHOẢN MỤC: ô nhập có gợi ý (khuôn `MatPicker` của form phiếu xuất) ──────────────────────
// Là <input> chứ không phải dropdown vì phải DÁN ĐƯỢC vào đây; danh mục khoản mục nhỏ (vài chục
// dòng) nên lọc ngay tại client, không cần gọi API tìm kiếm như mã hàng.
function ItemPicker({ row, items, itemByName, usedCodes, invalid, onChange, onPaste }: {
  row: Row
  items: CostItem[]
  itemByName: Map<string, CostItem>
  usedCodes: string[]
  invalid: boolean
  onChange: (p: Partial<Row>) => void
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const used = new Set(usedCodes.filter(Boolean))
  const kw = normItem(row.raw)
  const list = items.filter(i => !used.has(i.code) && (!kw || normItem(i.label).includes(kw) || normItem(i.code).includes(kw)))

  function place() {
    setOpen(true)
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Panel bám theo ô bằng position:fixed → không bị vùng cuộn của bảng cắt mất
    setStyle({ position: 'fixed', top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 240), zIndex: 9999 })
  }

  return (
    <div className="w-40 sm:w-56">
      <input
        ref={inputRef}
        value={row.raw}
        placeholder="Gõ hoặc dán khoản mục…"
        onChange={e => {
          const v = e.target.value
          // Gõ đúng tên thì khớp luôn; chưa khớp thì để trống mã (dòng đỏ nhắc chọn lại)
          onChange({ raw: v, cost_item: itemByName.get(normItem(v))?.code ?? '' })
          place()
        }}
        onFocus={place}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onPaste={onPaste}
        className={`w-full h-8 px-2 rounded border text-[11px] outline-none focus:border-blue-400 ${
          invalid ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200'}`}
      />
      {open && list.length > 0 && (
        <div style={style} className="bg-white border border-slate-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {list.map(i => (
            <button key={i.code} type="button"
              className="w-full text-left px-3 py-1.5 text-[11px] text-slate-700 hover:bg-blue-50 border-b border-slate-50 last:border-0"
              onMouseDown={() => { onChange({ cost_item: i.code, raw: i.label }); setOpen(false) }}>
              {i.label}{i.is_labor && <span className="ml-1 text-emerald-600" title="Chi phí nhân công">◆</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
