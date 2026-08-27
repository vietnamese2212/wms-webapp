// Chi phí kho — kê khai theo (Kho × Tháng × Khoản mục). Nguồn nuôi ô "chi phí/tấn" ở tab Năng suất.
//
// Vì sao là LƯỚI chứ không phải form từng dòng: kế toán khai một lượt cho cả tháng, mở form 1.071
// lần (153 kho × 7 khoản mục) thì không ai dùng. Kèm 2 lối tắt cho đúng cách họ đang làm việc:
// "Chép tháng trước" (thuê kho/lương gần như không đổi) và Upload Excel 2 pha (xem trước rồi mới ghi).
import { useEffect, useMemo, useState } from 'react'
import { Wallet, Copy, Upload, Save, Lock, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { UploadExcelDialog } from '@/components/shared/UploadExcelDialog'
import { saveWorkbook } from '@/utils/saveExcel'
import {
  useCostGrid, useSaveCostGrid, useCopyPrevCosts, useLockCostPeriod, useUploadCosts,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const THIS_MONTH = () => TODAY().slice(0, 7)
const SHARED = '__shared__'   // khoá dòng "Chi phí chung" trong lưới (warehouse_id = null)

const money = (n: number) => (n > 0 ? n.toLocaleString('vi-VN') : '')
const parseMoney = (s: string): number => {
  const t = s.replace(/[^\d]/g, '')   // ô nhập chỉ nhận số nguyên đồng — bỏ dấu chấm phân cách
  return t ? Number(t) : 0
}

export default function WarehouseCosts() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEdit = can(perms, 'warehouse_cost', 'edit')
  const canLock = can(perms, 'warehouse_cost', 'lock')

  const [period, setPeriod] = useState(THIS_MONTH())
  const { data, isLoading, isError } = useCostGrid(period)
  const save = useSaveCostGrid()
  const copyPrev = useCopyPrevCosts()
  const lock = useLockCostPeriod()
  const uploadMut = useUploadCosts()

  const [edits, setEdits] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  // Đổi tháng = bỏ mọi ô đang gõ dở (số của tháng khác ghi nhầm sang tháng này là hỏng chứng từ)
  useEffect(() => { setEdits({}); setErr(null); setMsg(null) }, [period])

  const lockedOf = useMemo(() => {
    const s = new Set<string>()
    for (const l of data?.locks ?? []) s.add(l.warehouse_id ?? SHARED)
    return s
  }, [data])

  const cellMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of data?.cells ?? []) m.set(`${c.warehouse_id ?? SHARED}|${c.cost_item}`, Number(c.amount) || 0)
    return m
  }, [data])

  // Đơn vị có HÀNG TRĂM kho NPP — không có ô tìm thì kế toán cuộn mòn chuột mới tới kho của mình
  const [q, setQ] = useState('')
  const [onlyFilled, setOnlyFilled] = useState(false)
  const rows = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    const kw = norm(q.trim())
    const hasCell = (id: string) => (data?.cells ?? []).some(c => c.warehouse_id === id && Number(c.amount) > 0)
    const list = (data?.warehouses ?? [])
      .filter(w => (!kw || norm(w.name).includes(kw)) && (!onlyFilled || hasCell(w.id)))
      .map(w => ({ key: w.id, id: w.id as string | null, name: w.name }))
    // Dòng CHUNG đứng đầu, chỉ hiện với người không bị giới hạn kho (BE cũng chặn ghi)
    return data?.can_edit_shared && !kw
      ? [{ key: SHARED, id: null as string | null, name: 'Chi phí chung (toàn công ty)' }, ...list]
      : list
  }, [data, q, onlyFilled])

  const valueOf = (rowKey: string, item: string): string => {
    const k = `${rowKey}|${item}`
    if (k in edits) return edits[k]
    const v = cellMap.get(k)
    return v ? money(v) : ''
  }
  const numOf = (rowKey: string, item: string): number => {
    const k = `${rowKey}|${item}`
    return k in edits ? parseMoney(edits[k]) : cellMap.get(k) ?? 0
  }
  const rowTotal = (rowKey: string) => (data?.items ?? []).reduce((s, it) => s + numOf(rowKey, it.code), 0)
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r.key), 0)
  const dirtyCount = Object.keys(edits).length

  async function onSave() {
    setErr(null); setMsg(null)
    const cells = Object.entries(edits).map(([k, v]) => {
      const [rowKey, cost_item] = k.split('|')
      return { warehouse_id: rowKey === SHARED ? null : rowKey, cost_item, amount: parseMoney(v) }
    })
    if (!cells.length) return
    try {
      const r = await save.mutateAsync({ period, cells })
      setEdits({}); setMsg(`Đã lưu ${r.saved} ô của kỳ ${period}.`)
    } catch (e) { setErr(apiErr(e)) }
  }

  async function onCopyPrev() {
    setErr(null); setMsg(null)
    try {
      const r = await copyPrev.mutateAsync(period)
      setMsg(r.copied > 0
        ? `Đã chép ${r.copied} ô từ kỳ ${String(r.from).slice(0, 7)}${r.skipped_existing ? ` · giữ nguyên ${r.skipped_existing} ô đã có số` : ''}${r.skipped_locked ? ` · bỏ qua ${r.skipped_locked} ô của kho đã chốt` : ''}.`
        : `Kỳ ${String(r.from).slice(0, 7)} chưa có số nào để chép.`)
    } catch (e) { setErr(apiErr(e)) }
  }

  async function onLock(rowKey: string, locked: boolean) {
    setErr(null); setMsg(null)
    try {
      await lock.mutateAsync({ period, warehouse_id: rowKey === SHARED ? null : rowKey, locked })
      setMsg(locked ? 'Đã chốt kỳ — muốn sửa phải mở lại.' : 'Đã mở lại kỳ.')
    } catch (e) { setErr(apiErr(e)) }
  }

  /** Mẫu Excel: đúng các cột màn hình đang có (kho + từng khoản mục) + sẵn dòng cho từng kho. */
  async function onDownloadTemplate() {
    const XLSX = await import('xlsx')
    const header = ['Kho', ...(data?.items ?? []).map(i => i.label), 'Ghi chú']
    const body = rows.map(r => [r.key === SHARED ? 'CHUNG' : r.name, ...(data?.items ?? []).map(() => ''), ''])
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ChiPhiKho')
    await saveWorkbook(wb, `Mau-chi-phi-kho-${period}.xlsx`)
  }

  const busy = save.isPending || copyPrev.isPending || lock.isPending || uploadMut.isPending

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-800/60 sm:rounded-xl sm:border sm:border-slate-200 dark:sm:border-slate-700 sm:shadow-sm">
        <div className="border-b border-slate-200 dark:border-slate-700 px-3 py-2 shrink-0 sm:rounded-t-xl space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 uppercase tracking-wide">
              <Wallet className="h-4 w-4 text-sky-600 dark:text-sky-400" /> Chi phí kho
            </span>
            <input type="month" value={period} onChange={e => setPeriod(e.target.value || THIS_MONTH())}
              className="h-9 sm:h-7 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200" />
            <span className="flex-1" />
            {canEdit && (
              <>
                <Button variant="outline" size="sm" className="h-9 sm:h-7 text-xs" disabled={busy}
                  onClick={onCopyPrev} title="Đắp số của tháng trước vào các ô CÒN TRỐNG (không đè số đã khai)">
                  <Copy className="h-3.5 w-3.5 mr-1" /> Chép tháng trước
                </Button>
                <Button variant="outline" size="sm" className="h-9 sm:h-7 text-xs" disabled={busy}
                  onClick={() => setShowUpload(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Upload Excel
                </Button>
                <Button size="sm" className="h-9 sm:h-7 text-xs" disabled={busy || dirtyCount === 0} onClick={onSave}>
                  <Save className="h-3.5 w-3.5 mr-1" /> {save.isPending ? 'Đang lưu…' : `Lưu${dirtyCount ? ` (${dirtyCount})` : ''}`}
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm kho…"
              className="h-9 sm:h-7 px-2 w-44 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200" />
            <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={onlyFilled} onChange={e => setOnlyFilled(e.target.checked)} className="h-3.5 w-3.5" />
              Chỉ kho đã khai
            </label>
            <span className="text-[10px] text-slate-400">{rows.length} dòng</span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Đơn vị: <b>đồng</b> · một dòng = một kho, một cột = một khoản mục. Khai lại là ĐÈ số cũ của đúng ô đó.
            {' '}Kỳ đã <b>chốt</b> thì khoá sửa — mở lại mới ghi được.
          </p>
        </div>

        {err && (
          <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{err}</div>
        )}
        {msg && (
          <div className="mx-3 mt-2 rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">{msg}</div>
        )}
        {isError && (
          <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            Không tải được số liệu chi phí.
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <table className="min-w-full text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Kho</th>
                {(data?.items ?? []).map(it => (
                  <th key={it.code} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">
                    {it.label}{it.is_labor && <span className="ml-1 text-emerald-600" title="Khoản NHÂN CÔNG — dùng cho chỉ số chi phí nhân công/tấn">◆</span>}
                  </th>
                ))}
                <th className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">Tổng</th>
                <th className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">Kỳ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={99} className="px-2 py-1"><Skeleton className="h-6 rounded bg-slate-200 dark:bg-slate-700/50" /></td></tr>
              ))}
              {!isLoading && rows.map(r => {
                const isLocked = lockedOf.has(r.key)
                const total = rowTotal(r.key)
                return (
                  <tr key={r.key} className="border-t border-slate-100 dark:border-slate-700/60">
                    <td className={`sticky left-0 z-10 px-2 py-1 text-[10px] whitespace-nowrap font-medium ${r.key === SHARED
                      ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-800 dark:text-sky-300'
                      : 'bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200'}`}>
                      {r.name}
                    </td>
                    {(data?.items ?? []).map(it => (
                      <td key={it.code} className="px-1 py-0.5 whitespace-nowrap text-right">
                        <input
                          value={valueOf(r.key, it.code)}
                          disabled={!canEdit || isLocked}
                          inputMode="numeric"
                          onChange={e => setEdits(s => ({ ...s, [`${r.key}|${it.code}`]: money(parseMoney(e.target.value)) }))}
                          className={`w-24 h-6 px-1 text-[10px] text-right tabular-nums rounded border bg-white dark:bg-slate-800 disabled:bg-slate-100 dark:disabled:bg-slate-900/40 disabled:text-slate-400 ${
                            `${r.key}|${it.code}` in edits
                              ? 'border-sky-400 ring-1 ring-sky-200'
                              : 'border-slate-200 dark:border-slate-700'} text-slate-700 dark:text-slate-200`}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                      {total > 0 ? total.toLocaleString('vi-VN') : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-right">
                      {canLock ? (
                        <button type="button" disabled={busy} onClick={() => onLock(r.key, !isLocked)}
                          title={isLocked ? 'Kỳ đã chốt — bấm để mở lại' : 'Chốt kỳ: khoá không cho sửa nữa'}
                          className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] ${isLocked
                            ? 'text-amber-700 bg-amber-500/15 hover:bg-amber-500/25'
                            : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'}`}>
                          {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                          {isLocked ? 'Đã chốt' : 'Chốt'}
                        </button>
                      ) : (
                        <span className={`text-[10px] ${isLocked ? 'text-amber-600' : 'text-slate-300'}`}>{isLocked ? 'Đã chốt' : '—'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={99} className="px-2 py-6 text-center text-[11px] text-slate-400">Không có kho nào trong phạm vi được gán.</td></tr>
              )}
            </tbody>
            {!isLoading && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
                  <td className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-200">TỔNG KỲ {period}</td>
                  {(data?.items ?? []).map(it => (
                    <td key={it.code} className="px-2 py-1.5 text-[10px] text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {rows.reduce((s, r) => s + numOf(r.key, it.code), 0).toLocaleString('vi-VN')}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-[11px] text-right tabular-nums font-bold text-slate-900 dark:text-white">{grandTotal.toLocaleString('vi-VN')}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Upload Excel — dialog CHUẨN 2 pha dùng chung (kiểm trước → xác nhận mới ghi) */}
      {showUpload && (
        <UploadExcelDialog
          title={`Upload chi phí kho — kỳ ${period}`}
          hint="Cột đầu là KHO (mã hoặc tên; ghi CHUNG = chi phí toàn công ty), mỗi khoản mục một cột. Ô đã có số sẽ bị ĐÈ theo file."
          onClose={() => setShowUpload(false)}
          onDownloadTemplate={onDownloadTemplate}
          onUpload={(file, preflight) => uploadMut.mutateAsync({ period, file, preflight })}
        />
      )}
    </div>
  )
}

function apiErr(e: unknown): string {
  const m = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return m ?? 'Có lỗi xảy ra — thử lại.'
}
