// PHIẾU CHI PHÍ của một kho trong một kỳ tháng (user chốt 27/08 vòng 2:
// "mở nó ra thì có thể add, edit các khoản chi phí — áp dụng tương tự form xuất nhập, bao gồm cả
//  việc copy paste…").
//
// Vì sao sửa TẠI CHỖ cả bảng rồi bấm Lưu MỘT lần (không phải mỗi dòng một form): kế toán kê một
// phiếu là điền cả cụm khoản mục, thường dán thẳng từ file Excel đang mở. Mỗi dòng một lượt gọi
// API vừa chậm vừa để lại phiếu ghi DỞ khi mạng rớt giữa chừng — ở đây một lần bấm là một lượt ghi
// (BE xoá/thêm/sửa theo lô trong `saveVoucher`).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Wallet, Plus, Trash2, Save, ClipboardPaste, Lock, Unlock, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { formatTimestampDate } from '@/utils/formatters'
import { useCostVoucher, useSaveCostVoucher, useLockCostPeriod, type CostItem } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { money, parseMoney, warehouseKeyOf } from './costShared'

type Row = { key: string; id?: string; cost_item: string; amount: number; note: string }
let seq = 0
const newKey = () => `n${++seq}`

function apiErr(e: unknown): string {
  const m = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return m ?? 'Có lỗi xảy ra — thử lại.'
}
/** So khớp tên khoản mục khi dán: bỏ dấu, bỏ hoa/thường, bỏ khoảng trắng thừa. */
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
  const [showPaste, setShowPaste] = useState(false)

  // Nạp lại lưới mỗi khi dữ liệu server đổi (mở phiếu, lưu xong, người khác vừa sửa)
  const serverStamp = useMemo(
    () => (data?.rows ?? []).map(r => `${r.id}:${r.cost_item}:${r.amount}:${r.note ?? ''}`).join('|'),
    [data])
  useEffect(() => {
    setRows((data?.rows ?? []).map(r => ({ key: r.id, id: r.id, cost_item: r.cost_item, amount: r.amount, note: r.note ?? '' })))
  }, [serverStamp])

  const items = data?.items ?? []
  const itemBy = useMemo(() => new Map(items.map(i => [i.code, i])), [items])
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

  function patch(key: string, p: Partial<Row>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)))
  }
  function addRow() { setRows(rs => [...rs, { key: newKey(), cost_item: '', amount: 0, note: '' }]) }

  /**
   * Dán từ Excel: mỗi dòng = Khoản mục ⇥ Số tiền ⇥ Ghi chú. Khoản mục ĐÃ CÓ trong lưới thì ĐÈ số
   * (dán lại là cập nhật, không nhân đôi — cùng luật idempotent của upload). Tên lạ KHÔNG tự đẻ
   * khoản mục mới: liệt kê ra để người dùng thêm vào danh mục, tránh sinh rác do gõ sai chính tả.
   */
  function applyPaste(text: string): { added: number; updated: number; unknown: string[] } {
    const byName = new Map<string, CostItem>()
    for (const i of items) { byName.set(normItem(i.label), i); byName.set(normItem(i.code), i) }
    const unknown: string[] = []
    let added = 0, updated = 0
    const next = [...rows]
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue
      const cells = raw.split('\t').map(c => c.trim())
      const name = cells[0] ?? ''
      if (!name) continue
      if (/^(khoản mục|khoan muc|item)$/i.test(name)) continue     // dòng tiêu đề copy kèm
      const it = byName.get(normItem(name))
      if (!it) { if (!unknown.includes(name)) unknown.push(name); continue }
      const amount = parseMoney(cells[1] ?? '')
      const note = cells[2] ?? ''
      const at = next.findIndex(r => r.cost_item === it.code)
      if (at >= 0) { next[at] = { ...next[at], amount, note: note || next[at].note }; updated++ }
      else { next.push({ key: newKey(), cost_item: it.code, amount, note }); added++ }
    }
    setRows(next)
    return { added, updated, unknown }
  }

  async function onSave() {
    setErr(null); setMsg(null)
    const payload = rows.filter(r => r.cost_item)
      .map(r => ({ id: r.id, cost_item: r.cost_item, amount: Math.round(r.amount), note: r.note.trim() || null }))
    try {
      const r = await save.mutateAsync({ period, warehouse_id: warehouseKey === '__shared__' ? null : warehouseKey, lines: payload })
      setMsg(`Đã lưu phiếu: ${r.saved} khoản mục${r.deleted ? ` · xoá ${r.deleted} dòng` : ''} · tổng ${money(r.amount)} đ.`)
    } catch (e) { setErr(apiErr(e)) }
  }

  const actions: ActionItem[] = [
    ...(readOnly ? [] : [
      { key: 'save', icon: Save, label: 'Lưu phiếu', tip: 'Ghi toàn bộ thay đổi của phiếu trong một lần',
        primary: true, onClick: onSave, busy: save.isPending, disabled: !dirty || save.isPending },
      { key: 'add', icon: Plus, label: 'Thêm dòng', tip: 'Thêm một khoản mục vào phiếu', onClick: addRow },
      { key: 'paste', icon: ClipboardPaste, label: 'Dán từ Excel', tip: 'Dán cột Khoản mục / Số tiền / Ghi chú từ bảng tính',
        onClick: () => setShowPaste(true) },
      { key: 'reset', icon: RotateCcw, label: 'Bỏ thay đổi', tip: 'Trở lại đúng số đang lưu trên hệ thống',
        onClick: () => setRows((data?.rows ?? []).map(r => ({ key: r.id, id: r.id, cost_item: r.cost_item, amount: r.amount, note: r.note ?? '' }))),
        disabled: !dirty },
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

  // Mỗi khoản mục chỉ 1 dòng/phiếu → ô chọn của dòng này bỏ các khoản mục dòng khác đang dùng
  const optionsFor = (row: Row) => {
    const used = new Set(rows.filter(r => r.key !== row.key).map(r => r.cost_item))
    return items.filter(i => !used.has(i.code)).map(i => ({ value: i.code, label: i.is_labor ? `${i.label} ◆` : i.label }))
  }

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
          { label: 'Cập nhật cuối', value: data?.rows?.[0]?.updated_at ? formatTimestampDate(
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

        {/* Dán thẳng vào bảng cũng được (Ctrl+V) — không bắt buộc phải mở hộp thoại */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4"
          onPaste={readOnly ? undefined : e => {
            const text = e.clipboardData.getData('text/plain')
            if (!text.includes('\t') && !text.includes('\n')) return   // dán vào 1 ô thì để nguyên
            e.preventDefault()
            const r = applyPaste(text)
            setMsg(`Đã dán: thêm ${r.added} · cập nhật ${r.updated}${r.unknown.length ? ` · BỎ QUA ${r.unknown.length} tên lạ (${r.unknown.slice(0, 3).join(', ')}…)` : ''}. Bấm Lưu phiếu để ghi.`)
          }}>
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
              {!isLoading && rows.map(r => {
                const srv = data?.rows.find(x => x.id === r.id)
                return (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-1.5 py-1 whitespace-nowrap">
                      {readOnly ? <span className="text-slate-300">—</span> : (
                        <button type="button" title="Xoá dòng khỏi phiếu" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}
                          className="px-1.5 py-1 rounded text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {readOnly
                        ? <span className="text-[10px] text-slate-700">{srv?.item_label ?? r.cost_item}{srv?.is_labor && <span className="ml-1 text-emerald-600">◆</span>}</span>
                        : <SingleSelect options={optionsFor(r)} value={r.cost_item} onChange={v => patch(r.key, { cost_item: v })}
                            placeholder="Chọn khoản mục…" triggerClassName="w-40 sm:w-56 h-8 text-[11px]" />}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-right">
                      {readOnly
                        ? <span className="text-[10px] tabular-nums font-semibold text-slate-800">{money(r.amount)}</span>
                        : <input value={r.amount ? money(r.amount) : ''} inputMode="numeric" placeholder="0"
                            onChange={e => patch(r.key, { amount: parseMoney(e.target.value) })}
                            className="w-28 sm:w-36 h-8 px-2 rounded border border-slate-200 text-[11px] text-right tabular-nums outline-none focus:border-blue-400" />}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {readOnly
                        ? <span className="text-[10px] text-slate-500">{r.note || <span className="text-slate-300">—</span>}</span>
                        : <input value={r.note} onChange={e => patch(r.key, { note: e.target.value })} placeholder="Số hợp đồng, diễn giải…"
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
                  {!readOnly && <> Bấm <b>Thêm dòng</b>, hoặc <b>Dán từ Excel</b> (Khoản mục ⇥ Số tiền ⇥ Ghi chú).</>}
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
            <Button size="sm" className="h-7 text-[11px]" onClick={onSave} disabled={!dirty || save.isPending}>
              {save.isPending ? 'Đang lưu…' : 'Lưu phiếu'}
            </Button>
          )}
        </div>
      </div>

      {showPaste && (
        <PasteDialog onClose={() => setShowPaste(false)} onApply={text => {
          const r = applyPaste(text)
          setShowPaste(false)
          setMsg(`Đã dán: thêm ${r.added} · cập nhật ${r.updated}${r.unknown.length
            ? ` · BỎ QUA ${r.unknown.length} tên chưa có trong danh mục: ${r.unknown.join(', ')}` : ''}. Bấm Lưu phiếu để ghi.`)
        }} />
      )}
    </div>
  )
}

function PasteDialog({ onClose, onApply }: { onClose: () => void; onApply: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-base">Dán từ Excel</DialogTitle></DialogHeader>
        <p className="text-[11px] text-slate-500 -mt-2">
          Bôi đen vùng trong Excel rồi dán vào ô dưới. Thứ tự cột: <b>Khoản mục</b> ⇥ <b>Số tiền</b> ⇥ <b>Ghi chú</b>.
          Khoản mục đã có trong phiếu sẽ được <b>cập nhật số tiền</b>; tên chưa có trong danh mục bị bỏ qua và liệt kê ra.
        </p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={8} autoFocus
          placeholder={'Thuê xe nâng\t96.000.000\tHĐ 12/2026\nThuê pallet\t38.400.000'}
          className="w-full rounded border border-slate-200 p-2 text-xs font-mono outline-none focus:border-blue-400" />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button disabled={!text.trim()} onClick={() => onApply(text)}>Đưa vào phiếu</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
