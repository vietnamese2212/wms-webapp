// Chi phí kho — SỔ KÊ KHAI: mỗi dòng = một khoản chi phí của MỘT kho trong MỘT tháng.
// Vd "Thuê xe nâng · Kho Ba Vì · tháng 8 · 45.000.000". Nuôi ô "chi phí/tấn" ở tab Năng suất.
//
// Bản đầu làm dạng LƯỚI 154 kho × 7 cột cứng — user bác đúng: mở ra là bức tường ô trống, và
// không đặt được tên khoản mục theo cách kế toán gọi. Nay: list page chuẩn (FilterBar + band +
// phân trang) · nút Thêm mở FormSheet · Upload Excel dạng DÒNG · danh mục khoản mục tự thêm.
import { useMemo, useState } from 'react'
import { Wallet, Copy, Upload, Plus, Pencil, Trash2, Lock, Unlock, Tags, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { UploadExcelDialog } from '@/components/shared/UploadExcelDialog'
import { saveWorkbook } from '@/utils/saveExcel'
import { formatTimestampDate } from '@/utils/formatters'
import {
  useCostBook, useCreateCost, useUpdateCost, useDeleteCost, useSaveCostItem, useDeleteCostItem,
  useCopyPrevCosts, useLockCostPeriod, useUploadCosts, type CostItem, type CostLine,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const THIS_MONTH = () => TODAY().slice(0, 7)
const SHARED = '__shared__'   // giá trị "Chi phí chung (toàn công ty)" — DB lưu warehouse_id = null

const money = (n: number) => n.toLocaleString('vi-VN')
const parseMoney = (s: string): number => {
  const t = s.replace(/[^\d]/g, '')   // ô nhập chỉ nhận số nguyên đồng — bỏ dấu phân cách
  return t ? Number(t) : 0
}
/** 12 tháng gần nhất cho ô chọn Kỳ (tháng tính theo ngày VN). */
const monthOpts = (n = 15) => {
  const [y, m] = THIS_MONTH().split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - i
    const mm = String((t % 12) + 1).padStart(2, '0')
    return { value: `${Math.floor(t / 12)}-${mm}`, label: `Tháng ${mm}/${Math.floor(t / 12)}` }
  })
}
function apiErr(e: unknown): string {
  const m = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return m ?? 'Có lỗi xảy ra — thử lại.'
}

export default function WarehouseCosts() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEdit = can(perms, 'warehouse_cost', 'edit')
  const canLock = can(perms, 'warehouse_cost', 'lock')
  const canItems = can(perms, 'warehouse_cost', 'manage_item')

  const f = useWmsFilterStore(s => s.warehouseCost)
  const setF = useWmsFilterStore(s => s.setWarehouseCost)
  const period = f.period || THIS_MONTH()   // rỗng = tháng này (không ghim tháng cứng vào store)

  const { data, isLoading, isError } = useCostBook({
    period, warehouseId: f.warehouseId || undefined, items: f.items,
    search: f.search || undefined, page: f.page, pageSize: f.pageSize,
  })
  const create = useCreateCost()
  const update = useUpdateCost()
  const del = useDeleteCost()
  const copyPrev = useCopyPrevCosts()
  const lock = useLockCostPeriod()
  const uploadMut = useUploadCosts()

  const { data: whRaw = [] } = useScopedWarehouses()
  const warehouses = whRaw as Array<{ id: string; name: string }>
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showItems, setShowItems] = useState(false)
  const [showLocks, setShowLocks] = useState(false)
  const [editing, setEditing] = useState<CostLine | 'new' | null>(null)

  const items = data?.items ?? []
  const rows = data?.rows ?? []
  const t = data?.totals
  const busy = create.isPending || update.isPending || del.isPending || copyPrev.isPending || lock.isPending || uploadMut.isPending

  const whOpts = useMemo(() => [
    ...(data?.can_edit_shared ? [{ value: SHARED, label: 'Chi phí chung (toàn công ty)' }] : []),
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ], [warehouses, data?.can_edit_shared])

  const filterDefs: FilterDef[] = [
    { key: 'period', label: 'Kỳ', type: 'single', pinned: true, options: monthOpts(), allLabel: 'Tháng này',
      value: f.period, onChange: v => setF({ period: v, page: 1 }) },
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId,
      onChange: v => setF({ warehouseId: v, page: 1 }) },
    { key: 'items', label: 'Khoản mục', type: 'multi', options: items.map(i => ({ value: i.code, label: i.label })),
      selected: f.items, onChange: v => setF({ items: v, page: 1 }) },
    { key: 'q', label: 'Tìm', type: 'text', placeholder: 'kho / khoản mục / ghi chú',
      value: f.search, onChange: v => setF({ search: v, page: 1 }) },
  ]

  async function onCopyPrev() {
    setErr(null); setMsg(null)
    try {
      const r = await copyPrev.mutateAsync(period)
      setMsg(r.copied > 0
        ? `Đã chép ${r.copied} dòng từ kỳ ${String(r.from).slice(0, 7)}${r.skipped_existing ? ` · giữ nguyên ${r.skipped_existing} dòng đã khai` : ''}${r.skipped_locked ? ` · bỏ qua ${r.skipped_locked} dòng của kho đã chốt` : ''}.`
        : `Kỳ ${String(r.from).slice(0, 7)} chưa có dòng nào để chép.`)
    } catch (e) { setErr(apiErr(e)) }
  }

  async function onDelete(row: CostLine) {
    if (!confirm(`Xoá dòng "${row.item_label}" của ${row.warehouse_name} (kỳ ${row.period.slice(0, 7)})?`)) return
    setErr(null); setMsg(null)
    try { await del.mutateAsync(row.id); setMsg('Đã xoá dòng chi phí.') }
    catch (e) { setErr(apiErr(e)) }
  }

  /** Mẫu Excel dạng DÒNG — đúng cột mà upload đang đọc, kèm 2 dòng ví dụ. */
  async function onDownloadTemplate() {
    const XLSX = await import('xlsx')
    const ex = items.slice(0, 2).map(i => i.label)
    const ws = XLSX.utils.aoa_to_sheet([
      ['Tháng', 'Kho', 'Khoản mục', 'Số tiền', 'Ghi chú'],
      [period, warehouses[0]?.name ?? 'Kho Ba Vì', ex[0] ?? 'Thuê xe nâng', 45000000, 'Hợp đồng số 12/2026'],
      [period, 'CHUNG', ex[1] ?? 'Thuê pallet', 12000000, 'Chi phí chung toàn công ty'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ChiPhiKho')
    await saveWorkbook(wb, `Mau-chi-phi-kho-${period}.xlsx`)
  }

  const actions: ActionItem[] = [
    ...(canEdit ? [
      { key: 'add', icon: Plus, label: 'Thêm chi phí', tip: 'Kê khai một khoản chi phí của kho trong kỳ', primary: true,
        onClick: () => setEditing('new'), disabled: busy },
      { key: 'copy', icon: Copy, label: 'Chép tháng trước', tip: 'Đắp các dòng CÒN THIẾU từ tháng trước (không đè số đã khai)',
        onClick: onCopyPrev, busy: copyPrev.isPending, disabled: busy },
      { key: 'up', icon: Upload, label: 'Upload Excel', tip: 'Nạp nhiều dòng từ file Excel (xem trước rồi mới ghi)',
        onClick: () => setShowUpload(true), disabled: busy, mobileHidden: true },
    ] satisfies ActionItem[] : []),
    ...(canItems ? [{ key: 'items', icon: Tags, label: 'Khoản mục', tip: 'Danh mục khoản mục chi phí — thêm "Thuê pallet", "Thuê xe nâng"…',
      onClick: () => setShowItems(true), disabled: busy } satisfies ActionItem] : []),
    ...(canLock ? [{ key: 'lock', icon: Lock, label: 'Chốt kỳ', tip: 'Chốt/mở lại kỳ theo từng kho — kỳ đã chốt thì khoá ghi',
      onClick: () => setShowLocks(true), disabled: busy } satisfies ActionItem] : []),
  ]

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / f.pageSize))

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 space-y-1 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 uppercase tracking-wide shrink-0">
              <Wallet className="h-4 w-4 text-sky-600" /> Chi phí kho
            </span>
            <span className="text-[11px] text-slate-500">kỳ {period}</span>
            <span className="flex-1" />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <FilterSheetButton defs={filterDefs} className="sm:hidden" />
              <ActionCluster items={actions} mobileInline />
            </div>
          </div>
          <FilterBar defs={filterDefs} />
        </div>

        <SummaryBand tiles={[
          { label: 'Tổng chi phí kỳ', value: money(t?.amount ?? 0), accent: true },
          { label: 'Trong đó nhân công', value: money(t?.labor ?? 0) },
          { label: 'Số dòng khai', value: (t?.lines ?? 0).toLocaleString('vi-VN') },
          { label: 'Kho đã khai', value: (t?.warehouses ?? 0).toLocaleString('vi-VN') },
        ]} />

        {err && <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}
        {msg && <div className="mx-3 mt-2 rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-700">{msg}</div>}
        {isError && <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">Không tải được sổ chi phí.</div>}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <table className="min-w-full text-left">
            <thead>
              <tr className="bg-slate-50">
                {['', 'Kho', 'Khoản mục', 'Số tiền (đồng)', 'Ghi chú', 'Kỳ', 'Cập nhật'].map((h, i) => (
                  <th key={h + i} className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${
                    i === 0 ? 'sticky left-0 z-20 bg-slate-50 w-16' : i === 3 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-2 py-1"><Skeleton className="h-6 rounded bg-slate-200" /></td></tr>
              ))}
              {!isLoading && rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  {/* Thao tác đứng ĐẦU dòng + sticky — khỏi kéo ngang mới thấy nút */}
                  <td className="sticky left-0 z-10 bg-white px-1.5 py-1 whitespace-nowrap">
                    {canEdit && !r.locked ? (
                      <span className="inline-flex gap-0.5">
                        <button type="button" title="Sửa dòng" onClick={() => setEditing(r)}
                          className="px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-sky-600">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" title="Xoá dòng" onClick={() => onDelete(r)} disabled={busy}
                          className="px-1.5 py-1 rounded text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : r.locked ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`px-2 py-1 text-[10px] whitespace-nowrap font-medium ${r.warehouse_id ? 'text-slate-700' : 'text-sky-700'}`}>{r.warehouse_name}</td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-700">
                    {r.item_label}
                    {r.is_labor && <span className="ml-1 text-emerald-600" title="Khoản NHÂN CÔNG — nuôi chỉ số chi phí nhân công/tấn">◆</span>}
                  </td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold text-slate-800">{money(r.amount)}</td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500 max-w-[280px] truncate" title={r.note ?? ''}>
                    {r.note || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{r.period.slice(0, 7)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r.updated_at ? (
                      <div className="leading-tight">
                        <div className="text-[10px] text-slate-600">{r.updated_by ?? '—'}</div>
                        <div className="text-[9px] text-slate-400">{formatTimestampDate(r.updated_at, true)}</div>
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-8 text-center text-[11px] text-slate-400">
                  Kỳ {period} chưa có khoản chi phí nào.
                  {canEdit && <> Bấm <b>Thêm chi phí</b> để kê khai, hoặc <b>Chép tháng trước</b> / <b>Upload Excel</b>.</>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t px-3 py-1.5 flex items-center gap-2 text-[10px] text-slate-500 shrink-0">
          <span>{rows.length ? `${(f.page - 1) * f.pageSize + 1}–${(f.page - 1) * f.pageSize + rows.length}` : 0} / {(data?.total ?? 0).toLocaleString('vi-VN')} dòng</span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={f.page <= 1}
            onClick={() => setF({ page: f.page - 1 })}>Trước</Button>
          <span>trang {f.page}/{totalPages}</span>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={f.page >= totalPages}
            onClick={() => setF({ page: f.page + 1 })}>Sau</Button>
        </div>
      </div>

      {editing && (
        <CostLineSheet
          line={editing === 'new' ? null : editing}
          period={period} items={items} whOpts={whOpts}
          saving={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={async body => {
            setErr(null); setMsg(null)
            try {
              if (editing === 'new') { await create.mutateAsync(body); setMsg('Đã thêm khoản chi phí.') }
              else { await update.mutateAsync({ id: editing.id, ...body }); setMsg('Đã cập nhật khoản chi phí.') }
              setEditing(null)
              return true
            } catch (e) { setErr(apiErr(e)); return false }
          }}
        />
      )}

      {showUpload && (
        <UploadExcelDialog
          title={`Upload chi phí kho — kỳ ${period}`}
          hint="Mỗi dòng = một khoản chi phí: Tháng | Kho | Khoản mục | Số tiền | Ghi chú. Tháng để trống = kỳ đang chọn; Kho ghi CHUNG = chi phí toàn công ty. Dòng trùng (kho+tháng+khoản mục) sẽ ĐÈ số cũ."
          onClose={() => setShowUpload(false)}
          onDownloadTemplate={onDownloadTemplate}
          onUpload={(file, preflight) => uploadMut.mutateAsync({ period, file, preflight })}
        />
      )}

      {showItems && <CostItemsDialog items={items} onClose={() => setShowItems(false)} />}

      {showLocks && (
        <LockDialog period={period} rows={rows} locks={data?.locks ?? []} busy={busy}
          onClose={() => setShowLocks(false)}
          onToggle={async (wid, locked) => {
            setErr(null); setMsg(null)
            try { await lock.mutateAsync({ period, warehouse_id: wid, locked }); setMsg(locked ? 'Đã chốt kỳ.' : 'Đã mở lại kỳ.') }
            catch (e) { setErr(apiErr(e)) }
          }} />
      )}
    </div>
  )
}

// ── Form thêm/sửa 1 dòng (FormSheet chuẩn: panel phải, footer dính đáy) ───────────────────────
function CostLineSheet({ line, period, items, whOpts, saving, onClose, onSubmit }: {
  line: CostLine | null
  period: string
  items: CostItem[]
  whOpts: Array<{ value: string; label: string }>
  saving: boolean
  onClose: () => void
  onSubmit: (b: { period: string; warehouse_id: string | null; cost_item: string; amount: number; note: string | null }) => Promise<boolean>
}) {
  const [wh, setWh] = useState(line ? (line.warehouse_id ?? SHARED) : '')
  const [item, setItem] = useState(line?.cost_item ?? '')
  const [amount, setAmount] = useState(line ? money(line.amount) : '')
  const [note, setNote] = useState(line?.note ?? '')
  const [p, setP] = useState(line ? line.period.slice(0, 7) : period)
  const [local, setLocal] = useState<string | null>(null)

  async function submit() {
    if (!wh) return setLocal('Chưa chọn kho')
    if (!item) return setLocal('Chưa chọn khoản mục')
    const n = parseMoney(amount)
    if (!(n > 0)) return setLocal('Số tiền phải lớn hơn 0')
    setLocal(null)
    await onSubmit({ period: p, warehouse_id: wh === SHARED ? null : wh, cost_item: item, amount: n, note: note.trim() || null })
  }

  return (
    <FormSheet
      open onClose={onClose}
      title={line ? 'Sửa khoản chi phí' : 'Thêm khoản chi phí'}
      description="Một dòng = một khoản mục của một kho trong một tháng (vd: Thuê xe nâng · Kho Ba Vì · tháng 8)."
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Huỷ</Button>
        <Button onClick={submit} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}
    >
      <div className="space-y-3">
        {local && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{local}</div>}
        <Field label="Kỳ (tháng)">
          <SingleSelect options={monthOpts()} value={p} onChange={setP} triggerClassName="w-full" />
        </Field>
        <Field label="Kho">
          <SingleSelect options={whOpts} value={wh} onChange={setWh} placeholder="Chọn kho…" triggerClassName="w-full" />
        </Field>
        <Field label="Khoản mục">
          <SingleSelect options={items.map(i => ({ value: i.code, label: i.label }))} value={item} onChange={setItem}
            placeholder="Chọn khoản mục…" triggerClassName="w-full" />
        </Field>
        <Field label="Số tiền (đồng)">
          <input value={amount} inputMode="numeric" onChange={e => setAmount(money(parseMoney(e.target.value)))}
            placeholder="45.000.000"
            className="w-full h-9 px-2 rounded border border-slate-200 text-sm text-right tabular-nums outline-none focus:border-blue-400" />
        </Field>
        <Field label="Ghi chú">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Số hợp đồng, diễn giải…"
            className="w-full h-9 px-2 rounded border border-slate-200 text-sm outline-none focus:border-blue-400" />
        </Field>
        <p className="text-[11px] text-slate-500">
          Mỗi khoản mục chỉ có <b>một dòng</b> cho mỗi kho mỗi tháng — khai lại là đè số cũ (nên upload lại file không nhân đôi).
        </p>
      </div>
    </FormSheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-slate-600">{label}</label>
      {children}
    </div>
  )
}

// ── Danh mục khoản mục — kế toán tự thêm "Thuê pallet", "Thuê xe nâng"… ───────────────────────
function CostItemsDialog({ items, onClose }: { items: CostItem[]; onClose: () => void }) {
  const save = useSaveCostItem()
  const del = useDeleteCostItem()
  const [label, setLabel] = useState('')
  const [isLabor, setIsLabor] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editCode, setEditCode] = useState<string | null>(null)

  async function add() {
    if (!label.trim()) return
    setErr(null)
    try {
      await save.mutateAsync({ code: editCode ?? undefined, label: label.trim(), is_labor: isLabor })
      setLabel(''); setIsLabor(false); setEditCode(null)
    } catch (e) { setErr(apiErr(e)) }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-base">Khoản mục chi phí</DialogTitle></DialogHeader>
        <p className="text-[11px] text-slate-500 -mt-2">
          Đặt tên theo cách kế toán gọi: "Thuê xe nâng", "Thuê pallet", "Điện nước"… Đánh dấu ◆ nếu là chi phí
          <b> nhân công</b> (dùng cho ô "chi phí nhân công / tấn").
        </p>
        {err && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}

        <div className="flex items-center gap-1.5">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Tên khoản mục mới…"
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            className="flex-1 h-9 px-2 rounded border border-slate-200 text-sm outline-none focus:border-blue-400" />
          <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={isLabor} onChange={e => setIsLabor(e.target.checked)} className="h-3.5 w-3.5" />
            Nhân công
          </label>
          <Button size="sm" className="h-9" onClick={add} disabled={save.isPending || !label.trim()}>
            {editCode ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border rounded">
          {items.map(i => (
            <div key={i.code} className="flex items-center gap-2 px-2 py-1.5">
              <span className="flex-1 text-xs text-slate-700">
                {i.label}{i.is_labor && <span className="ml-1 text-emerald-600" title="Chi phí nhân công">◆</span>}
              </span>
              <button type="button" title="Đổi tên" onClick={() => { setEditCode(i.code); setLabel(i.label); setIsLabor(i.is_labor) }}
                className="px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-sky-600"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" title="Xoá khoản mục (chỉ khi chưa dòng nào dùng)" disabled={del.isPending}
                onClick={async () => { setErr(null); try { await del.mutateAsync(i.code) } catch (e) { setErr(apiErr(e)) } }}
                className="px-1.5 py-1 rounded text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {items.length === 0 && <div className="px-2 py-6 text-center text-[11px] text-slate-400">Chưa có khoản mục nào.</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Chốt kỳ theo từng kho ─────────────────────────────────────────────────────────────────────
function LockDialog({ period, rows, locks, busy, onClose, onToggle }: {
  period: string
  rows: CostLine[]
  locks: Array<{ warehouse_id: string | null; locked_at: string; locked_by: string | null }>
  busy: boolean
  onClose: () => void
  onToggle: (warehouseId: string | null, locked: boolean) => Promise<void>
}) {
  const lockedSet = new Set(locks.map(l => l.warehouse_id ?? SHARED))
  // Kho có mặt trong kỳ (đã khai) + kho đang bị khoá (dù kỳ này chưa khai dòng nào)
  const list = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) m.set(r.warehouse_id ?? SHARED, r.warehouse_name)
    for (const l of locks) if (!m.has(l.warehouse_id ?? SHARED)) m.set(l.warehouse_id ?? SHARED, l.warehouse_id ? '(kho khác)' : 'Chi phí chung (toàn công ty)')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  }, [rows, locks])

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Chốt kỳ {period}</DialogTitle></DialogHeader>
        <p className="text-[11px] text-slate-500 -mt-2">Kỳ đã chốt thì mọi đường ghi đều bị chặn (kể cả thêm dòng mới, upload, chép tháng trước) — mở lại mới sửa được.</p>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border rounded">
          {list.map(([key, name]) => {
            const locked = lockedSet.has(key)
            return (
              <div key={key} className="flex items-center gap-2 px-2 py-1.5">
                <span className="flex-1 text-xs text-slate-700">{name}</span>
                <button type="button" disabled={busy}
                  onClick={() => onToggle(key === SHARED ? null : key, !locked)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] ${locked
                    ? 'text-amber-700 bg-amber-500/15 hover:bg-amber-500/25'
                    : 'text-slate-500 hover:bg-slate-100'}`}>
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  {locked ? 'Đã chốt' : 'Chốt'}
                </button>
              </div>
            )
          })}
          {list.length === 0 && <div className="px-2 py-6 text-center text-[11px] text-slate-400">Kỳ này chưa có kho nào khai chi phí.</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
