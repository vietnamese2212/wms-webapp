// Chi phí kho — hai góc nhìn trên CÙNG một dữ liệu (user chốt 27/08 vòng 2):
//
//  · PHIẾU  (mặc định) — "tháng 8 sẽ có 1 kỳ… 1 kho sẽ có chi phí của 1 Phiếu": mỗi dòng ở đây là
//    một PHIẾU = (Kho × Kỳ tháng). Bấm vào phiếu là mở ra xem/sửa hết các khoản trong đó.
//  · DÒNG CHI PHÍ — "khi cần xem 1 loại chi phí thì có thể xem được hết tất cả các tháng với
//    filter": bảng phẳng, lọc theo Khoản mục trên một KHOẢNG KỲ.
//
// Không có bảng "phiếu" trong DB: phiếu là NHÓM của các dòng cùng (kho, kỳ) — hai góc nhìn đọc
// chung một nguồn nên không bao giờ lệch nhau.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Copy, Upload, FilePlus2, Lock, Unlock, Tags, Check, Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
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
  useCostBook, useCostVouchers, useSaveCostItem, useDeleteCostItem,
  useCopyPrevCosts, useLockCostPeriod, useUploadCosts, type CostItem, type CostVoucher,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { SHARED_KEY, monthOpts, monthAdd, money, voucherPath } from './costShared'

const DEFAULT_BACK = 14    // 15 kỳ tính cả tháng này
const DEFAULT_AHEAD = 3    // khai trước kỳ tới

function apiErr(e: unknown): string {
  const m = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return m ?? 'Có lỗi xảy ra — thử lại.'
}

export default function WarehouseCosts() {
  const nav = useNavigate()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEdit = can(perms, 'warehouse_cost', 'edit')
  const canLock = can(perms, 'warehouse_cost', 'lock')
  const canItems = can(perms, 'warehouse_cost', 'manage_item')

  const f = useWmsFilterStore(s => s.warehouseCost)
  const setF = useWmsFilterStore(s => s.setWarehouseCost)
  // MẶC ĐỊNH LÀ THẤY HẾT (user 27/08: "tại sao lại chỉ cho xem vài phiếu vậy — có rất nhiều mà??").
  // Danh sách phiếu là SỔ, mở ra phải thấy mọi phiếu đã tạo; ghim sẵn 1 tháng làm người dùng tưởng
  // phiếu bị mất. Dải mặc định = 15 tháng trước → 3 tháng tới (đúng dải ô chọn kỳ, dưới trần 24).
  const from = f.periodFrom || monthAdd(DEFAULT_BACK)
  const to = f.periodTo || (f.periodFrom ? f.periodFrom : monthAdd(-DEFAULT_AHEAD))
  const isVoucherView = f.view !== 'line'
  /** Kỳ "đang đứng" cho các thao tác gắn với MỘT kỳ (chép tháng trước, upload, chốt kỳ, tạo phiếu). */
  const focusPeriod = from === to ? to : monthAdd(0)

  const vouchers = useCostVouchers({
    periodFrom: from, periodTo: to, warehouseId: f.warehouseId || undefined,
    search: f.search || undefined, page: f.page, pageSize: f.pageSize,
  })
  const book = useCostBook({
    periodFrom: from, periodTo: to, warehouseId: f.warehouseId || undefined, items: f.items,
    search: f.search || undefined, page: f.page, pageSize: f.pageSize,
  })
  const q = isVoucherView ? vouchers : book
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
  const [showOpen, setShowOpen] = useState(false)

  const items = q.data?.items ?? []
  const t = q.data?.totals
  const busy = copyPrev.isPending || lock.isPending || uploadMut.isPending

  const whOpts = useMemo(() => [
    ...(q.data?.can_edit_shared ? [{ value: SHARED_KEY, label: 'Chi phí chung (toàn công ty)' }] : []),
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ], [warehouses, q.data?.can_edit_shared])

  // Kỳ = THÁNG. Hai ô Từ/Đến luôn hợp lệ (sửa một đầu vượt đầu kia thì kéo đầu kia theo), thêm
  // chip "Khoảng" dựng sẵn mà GIÁ TRỊ SUY NGƯỢC từ Từ/Đến — không đẻ state thứ hai để mâu thuẫn.
  const PRESETS = [
    { value: 'this', label: 'Tháng này', from: monthAdd(0), to: monthAdd(0) },
    { value: 'prev', label: 'Tháng trước', from: monthAdd(1), to: monthAdd(1) },
    { value: '3m', label: '3 tháng gần nhất', from: monthAdd(2), to: monthAdd(0) },
    { value: '12m', label: '12 tháng gần nhất', from: monthAdd(11), to: monthAdd(0) },
  ]
  // ⚠️ Chỉ coi là ĐANG LỌC khi người dùng THỰC SỰ chọn (store có giá trị). Nếu suy từ from/to
  // đã-đổ-mặc-định thì chip "Khoảng: Tháng này" hiện ngay lúc mới mở và bấm ✕ KHÔNG TẮT ĐƯỢC —
  // xoá xong lại suy ra đúng giá trị cũ (user 27/08: "Ko xóa đc Khoảng Tháng này à??").
  const presetValue = (f.periodFrom || f.periodTo)
    ? PRESETS.find(p => p.from === from && p.to === to)?.value ?? ''
    : ''

  // ⚠️ Hai ô Từ/Đến ràng buộc nhau nên PHẢI đọc state MỚI NHẤT lúc chạy, không dùng `f` chụp lại
  // lúc render: "Xóa tất cả" gọi liên tiếp clear(Từ) rồi clear(Đến) TRONG CÙNG một render, ô Đến
  // sẽ ghi lại `periodFrom` bằng giá trị CŨ ⇒ chip "Từ kỳ" xoá xong lại hiện (đo thật 27/08).
  const nowF = () => useWmsFilterStore.getState().warehouseCost
  const setFrom = (v: string) => {
    const cur = nowF()
    setF({ periodFrom: v, periodTo: v && cur.periodTo && cur.periodTo < v ? v : cur.periodTo, page: 1 })
  }
  const setTo = (v: string) => {
    const cur = nowF()
    setF({ periodTo: v, periodFrom: v && cur.periodFrom && v < cur.periodFrom ? v : cur.periodFrom, page: 1 })
  }

  const filterDefs: FilterDef[] = [
    { key: 'from', label: 'Từ kỳ', type: 'single', pinned: true, options: monthOpts(), allLabel: 'Tất cả kỳ',
      value: f.periodFrom, onChange: setFrom },
    { key: 'to', label: 'Đến kỳ', type: 'single', pinned: true, options: monthOpts(), allLabel: 'Cùng kỳ "Từ"',
      value: f.periodTo, onChange: setTo },
    { key: 'preset', label: 'Khoảng', type: 'single', options: PRESETS, allLabel: 'Về mặc định (tháng này)',
      value: presetValue,
      onChange: v => {
        const p = PRESETS.find(x => x.value === v)
        setF(p ? { periodFrom: p.from, periodTo: p.to, page: 1 } : { periodFrom: '', periodTo: '', page: 1 })
      } },
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId,
      onChange: v => setF({ warehouseId: v, page: 1 }) },
    // Lọc theo KHOẢN MỤC chỉ có nghĩa ở bảng dòng (phiếu là một nhóm nhiều khoản mục)
    ...(isVoucherView ? [] : [{
      key: 'items', label: 'Khoản mục', type: 'multi' as const, pinned: true,
      options: items.map(i => ({ value: i.code, label: i.label })),
      selected: f.items, onChange: (v: string[]) => setF({ items: v, page: 1 }),
    }]),
    { key: 'q', label: 'Tìm', type: 'text', placeholder: isVoucherView ? 'tên kho' : 'kho / khoản mục / ghi chú',
      value: f.search, onChange: v => setF({ search: v, page: 1 }) },
  ]

  async function onCopyPrev() {
    setErr(null); setMsg(null)
    try {
      const r = await copyPrev.mutateAsync(focusPeriod)
      setMsg(r.copied > 0
        ? `Đã chép ${r.copied} dòng từ kỳ ${String(r.from).slice(0, 7)} sang kỳ ${focusPeriod}${r.skipped_existing ? ` · giữ nguyên ${r.skipped_existing} dòng đã khai` : ''}${r.skipped_locked ? ` · bỏ qua ${r.skipped_locked} dòng của kho đã chốt` : ''}.`
        : `Kỳ ${String(r.from).slice(0, 7)} chưa có dòng nào để chép.`)
    } catch (e) { setErr(apiErr(e)) }
  }

  /** Mẫu Excel dạng DÒNG — đúng cột mà upload đang đọc, kèm 2 dòng ví dụ. */
  async function onDownloadTemplate() {
    const XLSX = await import('xlsx')
    const ex = items.slice(0, 2).map(i => i.label)
    const ws = XLSX.utils.aoa_to_sheet([
      ['Tháng', 'Kho', 'Khoản mục', 'Số tiền', 'Ghi chú'],
      [focusPeriod, warehouses[0]?.name ?? 'Kho Ba Vì', ex[0] ?? 'Thuê xe nâng', 45000000, 'Hợp đồng số 12/2026'],
      [focusPeriod, 'CHUNG', ex[1] ?? 'Thuê pallet', 12000000, 'Chi phí chung toàn công ty'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ChiPhiKho')
    await saveWorkbook(wb, `Mau-chi-phi-kho-${focusPeriod}.xlsx`)
  }

  const actions: ActionItem[] = [
    ...(canEdit ? [
      // Nhãn phải nói được việc TẠO MỚI — "Mở phiếu" đọc ra như chỉ mở cái đã có (user 27/08:
      // "thế tạo phiếu mở chi phí mới thì ở đâu?"). Cùng một nút: kho+kỳ chưa có phiếu thì tạo
      // mới, đã có thì mở đúng phiếu đó (phiếu là NHÓM dẫn xuất nên không đẻ bản trùng).
      // CTA xanh đặc: đứng giữa 4 nút icon trắng thì nút viền trắng KHÔNG đọc ra là hành động chính
      // (user 27/08: "tôi k thấy nút tạo phiếu đâu cả" dù nút đang hiện trên màn).
      { key: 'open', icon: FilePlus2, label: 'Tạo phiếu', tip: 'Tạo phiếu chi phí mới: chọn Kho + Kỳ tháng rồi kê khai các khoản (kho+kỳ đã có phiếu thì mở phiếu đó ra sửa)',
        primary: true, variant: 'default', onClick: () => setShowOpen(true), disabled: busy },
      { key: 'copy', icon: Copy, label: 'Chép tháng trước', tip: `Đắp các dòng CÒN THIẾU của kỳ ${focusPeriod} từ tháng liền trước (không đè số đã khai)`,
        onClick: onCopyPrev, busy: copyPrev.isPending, disabled: busy },
      { key: 'up', icon: Upload, label: 'Upload Excel', tip: 'Nạp nhiều dòng từ file Excel (xem trước rồi mới ghi)',
        onClick: () => setShowUpload(true), disabled: busy, mobileHidden: true },
    ] satisfies ActionItem[] : []),
    ...(canItems ? [{ key: 'items', icon: Tags, label: 'Khoản mục', tip: 'Danh mục khoản mục chi phí — thêm "Thuê pallet", "Thuê xe nâng"…',
      onClick: () => setShowItems(true), disabled: busy } satisfies ActionItem] : []),
    ...(canLock ? [{ key: 'lock', icon: Lock, label: 'Chốt kỳ', tip: 'Chốt/mở lại kỳ theo từng kho — kỳ đã chốt thì khoá ghi',
      onClick: () => setShowLocks(true), disabled: busy } satisfies ActionItem] : []),
  ]

  const totalPages = Math.max(1, Math.ceil((q.data?.total ?? 0) / f.pageSize))
  const rowsShown = isVoucherView ? (vouchers.data?.rows.length ?? 0) : (book.data?.rows.length ?? 0)
  const periodLabel = from === to ? `kỳ ${from}` : (!f.periodFrom && !f.periodTo ? `tất cả kỳ (${from} → ${to})` : `kỳ ${from} → ${to}`)

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 space-y-1 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 uppercase tracking-wide shrink-0">
              <Wallet className="h-4 w-4 text-sky-600" /> Chi phí kho
            </span>
            {/* Đổi GÓC NHÌN (không phải bộ lọc dữ liệu) — cùng kiểu tab chủ đề của Dashboard */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-medium shrink-0">
              {([['voucher', 'Phiếu'], ['line', 'Dòng chi phí']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setF({ view: k, page: 1 })}
                  className={`px-2.5 py-1 border-l first:border-l-0 border-slate-200 ${
                    (k === 'voucher') === isVoucherView ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-500 hidden sm:inline">{periodLabel}</span>
            <span className="flex-1" />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <FilterSheetButton defs={filterDefs} className="sm:hidden" />
              <ActionCluster items={actions} mobileInline />
            </div>
          </div>
          <FilterBar defs={filterDefs} />
        </div>

        <SummaryBand tiles={isVoucherView ? [
          { label: 'Tổng chi phí', value: money(t?.amount ?? 0), accent: true },
          { label: 'Trong đó nhân công', value: money(t?.labor ?? 0) },
          { label: 'Số phiếu', value: (t?.vouchers ?? 0).toLocaleString('vi-VN') },
          { label: 'Số dòng khai', value: (t?.lines ?? 0).toLocaleString('vi-VN') },
        ] : [
          { label: 'Tổng chi phí (đã lọc)', value: money(t?.amount ?? 0), accent: true },
          { label: 'Trong đó nhân công', value: money(t?.labor ?? 0) },
          { label: 'Số dòng khai', value: (t?.lines ?? 0).toLocaleString('vi-VN') },
          { label: 'Số phiếu liên quan', value: (t?.vouchers ?? 0).toLocaleString('vi-VN') },
        ]} />

        {err && <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}
        {msg && <div className="mx-3 mt-2 rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-700">{msg}</div>}
        {q.isError && <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
          Không tải được sổ chi phí{(() => { const m = apiErr(q.error); return m ? ` — ${m}` : '' })()}
        </div>}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {isVoucherView
            ? <VoucherTable rows={vouchers.data?.rows ?? []} loading={vouchers.isLoading}
                onOpen={v => nav(voucherPath(v.warehouse_id, v.period))} canEdit={canEdit}
                onCreate={() => setShowOpen(true)} />
            : <LineTable rows={book.data?.rows ?? []} loading={book.isLoading}
                onOpen={(wid, period) => nav(voucherPath(wid, period))} />}
        </div>

        <div className="border-t px-3 py-1.5 flex items-center gap-2 text-[10px] text-slate-500 shrink-0">
          <span>{rowsShown ? `${(f.page - 1) * f.pageSize + 1}–${(f.page - 1) * f.pageSize + rowsShown}` : 0} / {(q.data?.total ?? 0).toLocaleString('vi-VN')} {isVoucherView ? 'phiếu' : 'dòng'}</span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={f.page <= 1}
            onClick={() => setF({ page: f.page - 1 })}>Trước</Button>
          <span>trang {f.page}/{totalPages}</span>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={f.page >= totalPages}
            onClick={() => setF({ page: f.page + 1 })}>Sau</Button>
        </div>
      </div>

      {showOpen && (
        <OpenVoucherDialog whOpts={whOpts} period={focusPeriod} onClose={() => setShowOpen(false)}
          onGo={(wid, period) => {
            // Kéo bộ lọc về đúng kỳ vừa tạo — nếu không, khai xong phiếu tháng 9 rồi quay ra
            // danh sách (mặc định tháng này) sẽ KHÔNG thấy phiếu vừa làm, tưởng mất.
            setF({ periodFrom: period, periodTo: period, page: 1 })
            nav(voucherPath(wid === SHARED_KEY ? null : wid, period))
          }} />
      )}

      {showUpload && (
        <UploadExcelDialog
          title={`Upload chi phí kho — kỳ mặc định ${focusPeriod}`}
          hint="Mỗi dòng = một khoản chi phí: Tháng | Kho | Khoản mục | Số tiền | Ghi chú. Tháng để trống = kỳ đang chọn; Kho ghi CHUNG = chi phí toàn công ty. Dòng trùng (kho+tháng+khoản mục) sẽ ĐÈ số cũ."
          onClose={() => setShowUpload(false)}
          onDownloadTemplate={onDownloadTemplate}
          onUpload={(file, preflight) => uploadMut.mutateAsync({ period: focusPeriod, file, preflight })}
        />
      )}

      {showItems && <CostItemsDialog items={items} onClose={() => setShowItems(false)} />}

      {showLocks && (
        <LockDialog period={focusPeriod} vouchers={vouchers.data?.rows ?? []} busy={busy}
          onClose={() => setShowLocks(false)}
          onToggle={async (wid, locked) => {
            setErr(null); setMsg(null)
            try { await lock.mutateAsync({ period: focusPeriod, warehouse_id: wid, locked }); setMsg(locked ? 'Đã chốt kỳ.' : 'Đã mở lại kỳ.') }
            catch (e) { setErr(apiErr(e)) }
          }} />
      )}
    </div>
  )
}

// ── Bảng PHIẾU (kho × kỳ) ─────────────────────────────────────────────────────────────────────
function VoucherTable({ rows, loading, onOpen, canEdit, onCreate }: {
  rows: CostVoucher[]; loading: boolean; onOpen: (v: CostVoucher) => void; canEdit: boolean
  onCreate?: () => void
}) {
  return (
    <table className="min-w-full text-left">
      <thead>
        <tr className="bg-slate-50">
          {['', 'Kỳ', 'Kho', 'Số khoản mục', 'Tổng chi phí (đồng)', 'Trong đó nhân công', 'Trạng thái', 'Cập nhật'].map((h, i) => (
            <th key={h + i} className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${
              i === 0 ? 'sticky left-0 z-20 bg-slate-50 w-10' : i >= 3 && i <= 5 ? 'text-right' : ''}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <tr key={i}><td colSpan={8} className="px-2 py-1"><Skeleton className="h-6 rounded bg-slate-200" /></td></tr>
        ))}
        {!loading && rows.map(v => (
          <tr key={`${v.period}|${v.warehouse_id ?? '*'}`} onClick={() => onOpen(v)}
            className="border-t border-slate-100 hover:bg-sky-50/60 cursor-pointer">
            <td className="sticky left-0 z-10 bg-white px-1.5 py-1 whitespace-nowrap">
              <span className="inline-flex px-1.5 py-1 rounded text-slate-400" title="Mở phiếu">
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold text-slate-700">{v.period.slice(0, 7)}</td>
            <td className={`px-2 py-1 text-[10px] whitespace-nowrap font-medium ${v.warehouse_id ? 'text-slate-700' : 'text-sky-700'}`}>{v.warehouse_name}</td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600">{v.lines}</td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold text-slate-800">{money(v.amount)}</td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-emerald-700">{money(v.labor)}</td>
            <td className="px-2 py-1 whitespace-nowrap">
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${v.locked
                ? 'bg-amber-500/15 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                {v.locked ? 'Đã chốt' : canEdit ? 'Đang khai' : 'Mở'}
              </span>
            </td>
            <td className="px-2 py-1 whitespace-nowrap">
              {v.updated_at ? (
                <div className="leading-tight">
                  <div className="text-[10px] text-slate-600">{v.updated_by ?? '—'}</div>
                  <div className="text-[9px] text-slate-400">{formatTimestampDate(v.updated_at, true)}</div>
                </div>
              ) : <span className="text-slate-300">—</span>}
            </td>
          </tr>
        ))}
        {!loading && rows.length === 0 && (
          <tr><td colSpan={8} className="px-2 py-8 text-center">
            <div className="text-[11px] text-slate-400">Kỳ đang chọn chưa có phiếu chi phí nào.</div>
            {canEdit && onCreate && (
              // Trạng thái rỗng phải có ĐƯỜNG ĐI NGAY TẠI ĐÓ, đừng bắt người dùng đi dò nút trên toolbar
              <button type="button" onClick={onCreate}
                className="mt-2 inline-flex items-center gap-1 h-8 px-3 rounded-md bg-sky-600 text-white text-[11px] font-medium hover:bg-sky-700">
                <FilePlus2 className="h-3.5 w-3.5" /> Tạo phiếu chi phí
              </button>
            )}
          </td></tr>
        )}
      </tbody>
    </table>
  )
}

// ── Bảng DÒNG (xem 1 khoản mục qua nhiều tháng) ───────────────────────────────────────────────
function LineTable({ rows, loading, onOpen }: {
  rows: Array<{
    id: string; warehouse_id: string | null; warehouse_name: string; period: string
    item_label: string; is_labor: boolean; amount: number; note: string | null
    updated_at: string | null; updated_by: string | null; locked: boolean
  }>
  loading: boolean
  onOpen: (warehouseId: string | null, period: string) => void
}) {
  return (
    <table className="min-w-full text-left">
      <thead>
        <tr className="bg-slate-50">
          {['', 'Kỳ', 'Kho', 'Khoản mục', 'Số tiền (đồng)', 'Ghi chú', 'Cập nhật'].map((h, i) => (
            <th key={h + i} className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${
              i === 0 ? 'sticky left-0 z-20 bg-slate-50 w-10' : i === 4 ? 'text-right' : ''}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <tr key={i}><td colSpan={7} className="px-2 py-1"><Skeleton className="h-6 rounded bg-slate-200" /></td></tr>
        ))}
        {!loading && rows.map(r => (
          <tr key={r.id} onClick={() => onOpen(r.warehouse_id, r.period)}
            className="border-t border-slate-100 hover:bg-sky-50/60 cursor-pointer">
            <td className="sticky left-0 z-10 bg-white px-1.5 py-1 whitespace-nowrap">
              {r.locked ? <Lock className="h-3.5 w-3.5 text-amber-500" />
                : <span className="inline-flex px-1.5 py-1 rounded text-slate-400" title="Mở phiếu chứa dòng này"><ChevronRight className="h-3.5 w-3.5" /></span>}
            </td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap font-mono text-slate-500">{r.period.slice(0, 7)}</td>
            <td className={`px-2 py-1 text-[10px] whitespace-nowrap font-medium ${r.warehouse_id ? 'text-slate-700' : 'text-sky-700'}`}>{r.warehouse_name}</td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-700">
              {r.item_label}
              {r.is_labor && <span className="ml-1 text-emerald-600" title="Khoản NHÂN CÔNG — nuôi chỉ số chi phí nhân công/tấn">◆</span>}
            </td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold text-slate-800">{money(r.amount)}</td>
            <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500 max-w-[280px] truncate" title={r.note ?? ''}>
              {r.note || <span className="text-slate-300">—</span>}
            </td>
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
        {!loading && rows.length === 0 && (
          <tr><td colSpan={7} className="px-2 py-8 text-center text-[11px] text-slate-400">
            Không có dòng chi phí nào khớp bộ lọc.
          </td></tr>
        )}
      </tbody>
    </table>
  )
}

// ── Tạo phiếu: chọn Kho + Kỳ rồi vào thẳng trang phiếu (kể cả phiếu chưa có dòng nào) ─────────
// Dùng FormSheet (panel phải, CAO FULL MÀN) chứ KHÔNG phải Dialog giữa màn: hộp thoại nhỏ chỉ cao
// ~330px nên menu của ô chọn bị kẹp còn ~3 dòng rưỡi, dòng cuối cắt ngang mép hộp và đè luôn ô Kho
// bên dưới (user 27/08: "xem lại lỗi giao diện khi bấm nút tạo phiếu"). Đây cũng là chuẩn CLAUDE.md:
// form Thêm/Sửa dùng FormSheet, Dialog giữa màn chỉ để xác nhận/thông báo nhỏ.
function OpenVoucherDialog({ whOpts, period, onClose, onGo }: {
  whOpts: Array<{ value: string; label: string }>
  period: string
  onClose: () => void
  onGo: (warehouseKey: string, period: string) => void
}) {
  const [wh, setWh] = useState('')
  const [p, setP] = useState(period)
  return (
    <FormSheet
      open onClose={onClose}
      title="Tạo phiếu chi phí"
      description="Một phiếu = một kho trong một kỳ tháng. Mở ra rồi thêm/sửa các khoản chi phí bên trong (dán được cả bảng từ Excel). Chọn được cả kỳ tháng tới để khai trước."
      footer={<>
        <Button variant="outline" onClick={onClose}>Huỷ</Button>
        <Button disabled={!wh || !p} onClick={() => onGo(wh, p)}>Tạo / mở phiếu</Button>
      </>}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-600">Kỳ (tháng)</label>
          <SingleSelect options={monthOpts()} value={p} onChange={setP} triggerClassName="w-full" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-600">Kho</label>
          <SingleSelect options={whOpts} value={wh} onChange={setWh} placeholder="Chọn kho…" triggerClassName="w-full" />
        </div>
        <p className="text-[11px] text-slate-500">
          Kho + kỳ đã có phiếu thì nút này <b>mở đúng phiếu đó</b> ra sửa, không tạo bản trùng.
        </p>
      </div>
    </FormSheet>
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

// ── Chốt kỳ theo từng kho (danh sách lấy từ chính các phiếu đang hiện) ────────────────────────
function LockDialog({ period, vouchers, busy, onClose, onToggle }: {
  period: string
  vouchers: CostVoucher[]
  busy: boolean
  onClose: () => void
  onToggle: (warehouseId: string | null, locked: boolean) => Promise<void>
}) {
  const list = useMemo(() => vouchers
    .filter(v => v.period.slice(0, 7) === period)
    .sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name, 'vi')), [vouchers, period])

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Chốt kỳ {period}</DialogTitle></DialogHeader>
        <p className="text-[11px] text-slate-500 -mt-2">Kỳ đã chốt thì mọi đường ghi đều bị chặn (kể cả thêm dòng mới, upload, chép tháng trước) — mở lại mới sửa được.</p>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border rounded">
          {list.map(v => (
            <div key={v.warehouse_id ?? '*'} className="flex items-center gap-2 px-2 py-1.5">
              <span className="flex-1 text-xs text-slate-700">{v.warehouse_name}</span>
              <button type="button" disabled={busy}
                onClick={() => onToggle(v.warehouse_id, !v.locked)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] ${v.locked
                  ? 'text-amber-700 bg-amber-500/15 hover:bg-amber-500/25'
                  : 'text-slate-500 hover:bg-slate-100'}`}>
                {v.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                {v.locked ? 'Đã chốt' : 'Chốt'}
              </button>
            </div>
          ))}
          {list.length === 0 && <div className="px-2 py-6 text-center text-[11px] text-slate-400">
            Kỳ {period} chưa có phiếu nào (chọn đúng kỳ ở bộ lọc "Đến kỳ").
          </div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
