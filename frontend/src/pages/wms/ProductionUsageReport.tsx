// TRANG "BÁO CÁO SỬ DỤNG NVL" (MES 14/11/2026) — thay biểu mẫu giấy NB-QA-BM-CB.01 (user: "mục tiêu là bỏ các tờ giấy này đi").
// Một báo cáo = MỘT CA của một kho chế biến. Mọi con số tự ra từ các lần cấp nguyên liệu cho mẻ; người chỉ nhập TỒN CUỐI THỰC TẾ rồi CHỐT ca.
// Cột đúng thứ tự tờ giấy: Tồn đầu thực tế · Nhập · dùng theo TỪNG MẺ (BTP / chu kỳ / mẻ) · Tổng sử dụng · Tồn cuối thực tế · Tồn cuối sổ sách · Chênh lệch.
// Máy tính = bảng; điện thoại = danh sách mỗi nguyên liệu một dòng có ô nhập số đếm.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { Plus, FileDown, Save, CheckCheck } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { FormSheet } from '@/components/shared/FormSheet'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useProductionWarehouses, useShiftReports, useShiftReport, useOpenShift, useSaveShift, useShiftNames, defaultKitchen, type ShiftRow } from '@/api/productionHooks'
import { qtyLabel, unitLabel } from '@/utils/qtyUnits'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'
import { formatDate, formatDateTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeAoa } from '@/utils/excelSafe'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const r3 = (n: number) => Math.round(n * 1000) / 1000
const dash = <span className="text-slate-300 font-normal">—</span>

export default function ProductionUsageReport() {
  const navigate = useNavigate()
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canWrite = can(perms, 'production', 'shift_report')
  const canExport = can(perms, 'production', 'export')
  const { data: { kitchens } } = useProductionWarehouses()
  const [whPick, setWhPick] = useState(() => useGlobalScopeStore.getState().warehouseId ?? '')
  const wh = kitchens.some(k => k.id === whPick) ? whPick : defaultKitchen(kitchens, whPick)
  const listQ = useShiftReports(wh || undefined)
  const reports = listQ.data ?? []
  const [pick, setPick] = useState('')
  const reportId = reports.some(r => r.id === pick) ? pick : (reports.find(r => r.status === 'OPEN') ?? reports[0])?.id ?? ''
  const q = useShiftReport(reportId || undefined)
  // chỉ dùng số của ĐÚNG báo cáo đang chọn — đổi kho / đổi ca mà còn hiện bảng cũ thì nút Chốt ca bấm vào báo cáo của kho khác
  const data = q.data && q.data.report.id === reportId ? q.data : undefined
  const rep = data?.report
  const isOpen = rep?.status === 'OPEN'
  const editable = isOpen && canWrite
  const batches = data?.batches ?? []
  const rows = data?.rows ?? []
  const openMut = useOpenShift()
  const saveMut = useSaveShift()
  const [ask, confirmNode] = useConfirmDialog()
  const [err, setErr] = useState('')
  const [openForm, setOpenForm] = useState(false)

  // BẢN NHÁP số đếm — material_id → chuỗi đang gõ
  // Tải lại (realtime, người khác lưu) chỉ ghi đè ô mà SỐ TRÊN SERVER vừa đổi — ô đang gõ dở của mình giữ nguyên.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const serverRef = useRef<{ id: string; vals: Record<string, string> }>({ id: '', vals: {} })
  const stamp = rep ? `${rep.id}|${rows.map(r => `${r.material_id}:${r.actual ?? ''}`).join(',')}` : ''
  useEffect(() => {
    const vals = Object.fromEntries(rows.map(r => [r.material_id, vnNumberInput(r.actual)]))
    const prev = serverRef.current
    if (!rep || prev.id !== rep.id) { setDraft(vals); setErr('') }
    else setDraft(d => { const next = { ...d }; for (const [k, v] of Object.entries(vals)) if (!(k in d) || prev.vals[k] !== v) next[k] = v; return next })
    serverRef.current = { id: rep?.id ?? '', vals }
  }, [stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = (id: string): number | null | undefined => {   // undefined = gõ sai
    const t = (draft[id] ?? '').trim()
    if (!t) return null
    const n = parseVnNumber(t)
    return n == null || n < 0 ? undefined : r3(n)
  }
  const actualOf = (r: ShiftRow) => (editable ? parsed(r.material_id) : r.actual)
  const diffOf = (r: ShiftRow) => { const a = actualOf(r); return a == null ? null : r3(Number(a) - Number(r.book)) }
  const changed = rows.filter(r => { const p = parsed(r.material_id); return p !== undefined && (p ?? null) !== (r.actual == null ? null : Number(r.actual)) })
  const invalid = rows.some(r => parsed(r.material_id) === undefined)
  const counted = rows.filter(r => actualOf(r) != null).length
  const off = rows.filter(r => { const d = diffOf(r); return d != null && d !== 0 }).length

  async function save(close: boolean) {
    if (!rep) return
    let note: string | null | undefined
    if (close) {
      const missing = rows.length - counted
      const ans = await ask({
        title: `Chốt ${rep.shift} ngày ${formatDate(rep.report_date)} — ${kitchens.find(k => k.id === rep.warehouse_id)?.name ?? 'kho chế biến'}?`,
        body: `${missing > 0 ? `Còn ${missing} nguyên liệu CHƯA nhập tồn cuối thực tế — vẫn chốt được, các dòng đó để trống. ` : ''}Chốt xong báo cáo không sửa được nữa; ca sau lấy số đếm này làm tồn đầu.`,
        input: { label: 'Ghi chú giao ca (tuỳ chọn)', placeholder: 'VD: nguyên liệu đã cấp cho mẻ nào, còn chờ gì…' },
      })
      if (ans === null) return
      note = ans || null
    }
    setErr('')
    try {
      await saveMut.mutateAsync({ id: rep.id, items: (close ? rows : changed).map(r => ({ material_id: r.material_id, qty_actual: parsed(r.material_id) ?? null })), ...(close ? { note, close: true } : {}) })
    } catch (e) { setErr(apiMsg(e)) }
  }

  function exportExcel() {
    if (!rep) return
    const whName = kitchens.find(k => k.id === rep.warehouse_id)?.name ?? ''
    const head = ['Nguyên liệu', 'Tên', 'Đơn vị', 'Tồn đầu thực tế', 'Nhập']
    const aoa: unknown[][] = [
      ['BÁO CÁO SỬ DỤNG NGUYÊN VẬT LIỆU'],
      [`Kho chế biến: ${whName}`, '', '', `Ngày: ${formatDate(rep.report_date)}`, `Ca: ${rep.shift}`, `Từ ${formatDateTime(rep.from_at)}${rep.to_at ? ` đến ${formatDateTime(rep.to_at)}` : ' — CHƯA CHỐT'}`],
      [...head, ...batches.map(b => `BTP: ${b.material_code}`), 'Tổng SDụng thực tế', 'Tồn cuối thực tế', 'Tồn cuối sổ sách', 'Chênh lệch NL dư'],
      ['', '', '', '', '', ...batches.map(b => `Chu kỳ: ${b.cycle ?? ''}`), '', '', '', ''],
      ['', '', '', '', '', ...batches.map(b => `Mẻ: ${b.batch_code}`), '', '', '', ''],
      ...rows.map(r => {
        const d = diffOf(r)
        return [r.material_code, r.material_name ?? '', unitLabel(r.base_unit), Number(r.opening), Number(r.received),
          ...batches.map(b => (r.by_batch[b.id] != null ? Number(r.by_batch[b.id]) : '')), Number(r.used), actualOf(r) ?? '', Number(r.book), d ?? '']
      }),
      [],
      [`Giao ca: ${rep.note ?? ''}`],
      [`Người mở: ${rep.opened_by_name ?? ''}`, '', '', `Người chốt: ${rep.closed_by_name ?? ''}`],
    ]
    const ws = XLSX.utils.aoa_to_sheet(sanitizeAoa(aoa))
    ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 9 }, { wch: 14 }, { wch: 10 }, ...batches.map(() => ({ wch: 18 })), { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BCSD NVL')
    void saveWorkbook(wb, `bao_cao_su_dung_nvl_${rep.report_date}_${rep.shift.replace(/\s+/g, '')}.xlsx`)
  }

  const cols: RtColDef[] = useMemo(() => [
    { id: 'mat', label: 'Nguyên liệu', w: 210 }, { id: 'open', label: 'Tồn đầu thực tế', w: 110, align: 'right' }, { id: 'in', label: 'Nhập', w: 90, align: 'right' },
    ...batches.map(b => ({ id: `b_${b.id}`, label: `${b.material_code}${b.cycle ? ` · CK ${b.cycle}` : ''} · ${b.batch_code}`, w: 150, align: 'right' as const })),
    { id: 'used', label: 'Tổng sử dụng', w: 110, align: 'right' }, { id: 'actual', label: 'Tồn cuối thực tế', w: 130, align: 'right' },
    { id: 'book', label: 'Tồn cuối sổ sách', w: 120, align: 'right' }, { id: 'diff', label: 'Chênh lệch', w: 110, align: 'right' },
  ], [batches])

  const hasOpen = reports.some(r => r.status === 'OPEN')
  const actions: ActionItem[] = []
  if (editable) {
    actions.push({ key: 'close', icon: CheckCheck, label: 'Chốt ca', tip: 'Chốt ca: chụp mọi con số, ca sau lấy số đếm này làm tồn đầu', primary: true, variant: 'default', onClick: () => void save(true), disabled: invalid || saveMut.isPending })
    actions.push({ key: 'draft', icon: Save, label: 'Lưu số đếm', tip: 'Lưu các ô tồn cuối thực tế vừa nhập (chưa chốt ca)', primary: true, onClick: () => void save(false), disabled: !changed.length || invalid || saveMut.isPending })
  }
  if (canWrite && !hasOpen && !!wh) actions.push({ key: 'open', icon: Plus, label: 'Mở ca', tip: 'Mở báo cáo cho ca mới — tính từ lúc chốt ca trước', primary: true, variant: 'default', onClick: () => setOpenForm(true) })
  if (canExport && rep) actions.push({ key: 'xlsx', icon: FileDown, label: 'Xuất Excel', tip: 'Xuất báo cáo ca theo mẫu NB-QA-BM-CB.01', onClick: exportExcel, mobileHidden: true })

  const diffCell = (r: ShiftRow) => {
    const d = diffOf(r)
    if (d == null) return dash
    if (d === 0) return <span className="text-green-700">khớp</span>
    return <span className={d < 0 ? 'text-red-600' : 'text-amber-700'}>{d > 0 ? '+' : '−'}{qtyLabel(Math.abs(d), r)}</span>
  }
  const input = (r: ShiftRow, cls: string) => (
    <Input value={draft[r.material_id] ?? ''} onChange={e => setDraft(s => ({ ...s, [r.material_id]: e.target.value }))} inputMode="decimal" placeholder="đếm"
      aria-label={`Tồn cuối thực tế ${r.material_code}`} className={`${cls} text-right tabular-nums ${parsed(r.material_id) === undefined ? 'border-red-400' : ''}`} />
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap xl:flex-nowrap">
            <span className="hidden sm:inline text-sm font-semibold text-slate-700 shrink-0">Báo cáo sử dụng NVL{kitchens.length === 1 ? ` · ${kitchens[0].name}` : ''}</span>
            {kitchens.length > 1 && (
              <div className="w-40 sm:w-48 min-w-0 shrink">
                <SingleSelect value={wh} onChange={v => { setWhPick(v); setPick('') }} triggerClassName="h-9 sm:h-7" placeholder="Kho chế biến" options={kitchens.map(k => ({ value: k.id, label: k.name }))} />
              </div>
            )}
            <div className="flex-1 min-w-[150px] max-w-xs">
              <SingleSelect value={reportId} onChange={setPick} triggerClassName="h-9 sm:h-7" placeholder={listQ.isLoading ? 'Đang tải…' : 'Chưa có báo cáo ca nào'} searchable={false}
                options={reports.map(r => ({ value: r.id, label: `${formatDate(r.report_date)} · ${r.shift}`, sub: r.status === 'OPEN' ? 'đang mở' : `đã chốt${r.closed_by_name ? ` · ${r.closed_by_name}` : ''}` }))} />
            </div>
            <ActionCluster mobileInline className="sm:ml-auto" items={actions} />
          </div>
          {rep && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
              <StatusBadge tone={isOpen ? 'amber' : 'green'}>{isOpen ? 'Ca đang mở' : 'Đã chốt'}</StatusBadge>
              <span>Từ <b className="tabular-nums">{formatDateTime(rep.from_at)}</b>{rep.to_at ? <> đến <b className="tabular-nums">{formatDateTime(rep.to_at)}</b></> : ' đến bây giờ'}</span>
              {rep.closed_by_name && <span>Chốt: {rep.closed_by_name}</span>}
              {rep.note && <span className="text-slate-500 truncate max-w-full" title={rep.note}>Giao ca: {rep.note}</span>}
            </div>
          )}
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{err}</div>}
          {q.isError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{apiMsg(q.error)}</div>}
        </div>
        <SummaryBand tiles={[
          { label: 'Nguyên liệu', value: rows.length.toLocaleString('vi-VN') },
          { label: 'Mẻ trong ca', value: batches.length.toLocaleString('vi-VN'), tip: 'Số mẻ có nhận nguyên liệu trong khoảng thời gian của ca' },
          { label: 'Đã đếm', value: `${counted}/${rows.length}`, accent: isOpen && counted < rows.length, tip: 'Số nguyên liệu đã nhập tồn cuối thực tế' },
          { label: 'Lệch sổ', value: off.toLocaleString('vi-VN'), danger: off > 0, tip: 'Số nguyên liệu có tồn cuối thực tế khác tồn cuối sổ sách. Báo cáo không tự sửa tồn — muốn khớp sổ thì kiểm kê / điều chỉnh tồn.' },
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {!kitchens.length && <p className="p-3 text-xs text-amber-700">Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.</p>}
          {!!kitchens.length && !listQ.isLoading && !reports.length && (
            <p className="p-3 text-xs text-slate-500">Kho này chưa có báo cáo ca nào.{canWrite ? ' Bấm "Mở ca" để bắt đầu — từ đó mọi lần cấp nguyên liệu cho mẻ tự vào báo cáo.' : ''}</p>
          )}
          {/* ĐIỆN THOẠI: mỗi nguyên liệu một dòng + ô nhập số đếm */}
          {rep && (
            <div className="sm:hidden divide-y divide-slate-100">
              {!rows.length && <p className="px-3 py-3 text-xs text-slate-400">{q.isLoading ? 'Đang tải…' : 'Ca này chưa có nguyên liệu nào (kho chế biến trống, chưa cấp gì).'}</p>}
              {rows.map(r => (
                <div key={r.material_id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate"><span className="font-mono font-semibold">{r.material_code}</span> <span className="text-slate-600">{r.material_name ?? ''}</span></p>
                    <p className="text-[11px] text-slate-500 tabular-nums">Đầu <b className="text-slate-700">{qtyLabel(Number(r.opening), r)}</b>{Number(r.received) > 0 && <> · nhập <b className="text-slate-700">{qtyLabel(Number(r.received), r)}</b></>} · dùng <b className="text-slate-700">{qtyLabel(Number(r.used), r)}</b></p>
                    <p className="text-[11px] tabular-nums text-slate-500">Sổ còn <b className="text-slate-700">{qtyLabel(Number(r.book), r)}</b> · lệch {diffCell(r)}</p>
                  </div>
                  {editable ? input(r, 'h-10 w-24 text-sm shrink-0') : <span className="shrink-0 text-xs font-semibold tabular-nums">{r.actual != null ? qtyLabel(Number(r.actual), r) : dash}</span>}
                </div>
              ))}
            </div>
          )}
          {rep && (
            <div className="hidden sm:block">
              <ResizableTable storageKey={`production_usage_cols_v1_${batches.length}`} cols={cols}>
                <TableBody>
                  {!rows.length && <TableEmptyRow colSpan={cols.length}>{q.isLoading ? 'Đang tải…' : 'Ca này chưa có nguyên liệu nào (kho chế biến trống, chưa cấp gì).'}</TableEmptyRow>}
                  {rows.map(r => (
                    <TableRow key={r.material_id}>
                      <TableCell className={`${TD} sticky left-0 z-10 bg-white truncate`} title={r.material_name ?? ''}><span className="font-mono font-semibold">{r.material_code}</span> {r.material_name ?? ''}</TableCell>
                      <TableCell className={NUM} title={r.opening_src === 'BOOK' ? 'Chưa có số đếm của ca trước — lấy theo sổ lúc mở ca' : 'Số đếm lúc chốt ca trước'}>
                        {qtyLabel(Number(r.opening), r)}{r.opening_src === 'BOOK' && <span className="ml-1 font-normal text-slate-400">(sổ)</span>}
                      </TableCell>
                      <TableCell className={NUM}>{Number(r.received) > 0 ? qtyLabel(Number(r.received), r) : dash}</TableCell>
                      {batches.map(b => (
                        <TableCell key={b.id} className={`${NUM} cursor-pointer hover:bg-sky-50`} title={`Mở mẻ ${b.batch_code}`} onClick={() => navigate(`/wms/production/${b.id}`)}>
                          {r.by_batch[b.id] != null ? qtyLabel(Number(r.by_batch[b.id]), r) : dash}
                        </TableCell>
                      ))}
                      <TableCell className={NUM}>{Number(r.used) > 0 ? qtyLabel(Number(r.used), r) : dash}</TableCell>
                      <TableCell className={`${NUM} !py-0.5`}>{editable ? input(r, 'h-7 w-full text-[11px]') : r.actual != null ? qtyLabel(Number(r.actual), r) : dash}</TableCell>
                      <TableCell className={NUM}>{qtyLabel(Number(r.book), r)}</TableCell>
                      <TableCell className={NUM}>{diffCell(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ResizableTable>
            </div>
          )}
        </div>
      </div>
      <OpenShiftSheet open={openForm} onClose={() => setOpenForm(false)} busy={openMut.isPending}
        onOpen={async (date, shift) => { const r = await openMut.mutateAsync({ warehouse_id: wh, report_date: date, shift }); setPick(r.id) }} />
      {confirmNode}
    </div>
  )
}

function OpenShiftSheet({ open, onClose, onOpen, busy }: { open: boolean; onClose: () => void; busy: boolean; onOpen: (date: string, shift: string) => Promise<void> }) {
  const [date, setDate] = useState(todayVN())
  const shifts = useShiftNames()
  const [shift, setShift] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setDate(todayVN()); setErr('') } }, [open])
  const shiftVal = shifts.includes(shift) ? shift : shifts[0] ?? ''
  async function go() {
    setErr('')
    try { await onOpen(date, shiftVal); onClose() } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} title="Mở báo cáo ca"
      description="Báo cáo tính từ lúc chốt ca trước tới lúc chốt ca này. Tồn đầu lấy theo số đếm của ca trước."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={busy || !date || !shiftVal} onClick={() => void go()}>{busy ? 'Đang mở…' : 'Mở ca'}</Button>
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <div>
          <Label className="text-xs">Ngày <span className="text-red-500">*</span></Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 sm:h-8 text-xs mt-0.5" />
        </div>
        <div>
          <Label className="text-xs">Ca <span className="text-red-500">*</span></Label>
          <SingleSelect value={shiftVal} onChange={setShift} searchable={false} options={shifts.map(s => ({ value: s, label: s }))} />
        </div>
      </div>
    </FormSheet>
  )
}
