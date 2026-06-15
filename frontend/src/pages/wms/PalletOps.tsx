import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, Scissors, QrCode, Search, X, Plus, Trash2, AlertTriangle, CheckCircle2, History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QRScanner } from '@/components/shared/QRScanner'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { PalletPrintArea, PALLET_PRINT_CSS, qrToLabel, type LabelData } from '@/components/shared/palletLabel'
import {
  useInventoryEntries, useMergePallets, useUngroupPallets, useSplitPallet, useLogPalletPrints,
  usePalletOps, useUndoPalletOp, type PalletOpRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

type Tab = 'merge' | 'split' | 'history'

export default function PalletOps() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canMerge   = can(perms, 'pallet_ops', 'merge')
  const canUngroup = can(perms, 'pallet_ops', 'ungroup')
  const canSplit   = can(perms, 'pallet_ops', 'split')

  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) === 'split' ? 'split' : 'merge')
  const [scanFor, setScanFor] = useState<null | 'target' | 'child' | 'source'>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Dồn ──
  const [mergeTarget, setMergeTarget] = useState(params.get('target') ?? '')
  const [childInput, setChildInput]   = useState('')
  const [mergeChildren, setMergeChildren] = useState<string[]>(() => (params.get('children') ?? '').split(',').map(c => c.trim()).filter(Boolean))
  const merge = useMergePallets()
  const ungroup = useUngroupPallets()
  function addChild(code: string) {
    const c = code.trim()
    if (!c || c === mergeTarget || mergeChildren.includes(c)) return
    setMergeChildren(p => [...p, c]); setChildInput('')
  }
  async function doMerge() {
    setMsg(null)
    try {
      const r = await merge.mutateAsync({ target_pallet_code: mergeTarget.trim(), child_pallet_codes: mergeChildren })
      setMsg({ ok: true, text: `Đã dồn ${r.merged} pallet vào ${r.target}` })
      setMergeChildren([])
    } catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Lỗi dồn pallet' }) }
  }

  // ── Tách ──
  const [splitSrc, setSplitSrc] = useState(params.get('source') ?? '')
  const [splitQtys, setSplitQtys] = useState<string[]>([''])
  const srcQ = splitSrc.trim()
  const { data: srcData } = useInventoryEntries({ search: srcQ.length >= 3 ? srcQ : undefined, status: '', page: 1, limit: 5 })
  const srcEntry = useMemo(() => (srcData?.entries ?? []).find(e => e.pallet_code === srcQ) as any, [srcData, srcQ])
  const remaining = Number(srcEntry?.cartons_remaining ?? 0)
  const reserved  = Number(srcEntry?.cartons_reserved ?? 0)
  const free = remaining - reserved
  const totalSplit = splitQtys.reduce((s, q) => s + (Math.floor(Number(q) || 0)), 0)
  const keepLeft = remaining - totalSplit
  const split = useSplitPallet()
  const logPrints = useLogPalletPrints()
  const [printLabels, setPrintLabels] = useState<LabelData[]>([])

  // ── Lịch sử dồn/tách + tìm kiếm + hoàn tác ──
  const [hSearch, setHSearch] = useState('')
  const [hType, setHType]     = useState('')   // '' | MERGE | SPLIT | UNGROUP
  const [hFrom, setHFrom]     = useState('')
  const [hTo, setHTo]         = useState('')
  const { data: ops = [] } = usePalletOps(
    { search: hSearch.trim() || undefined, type: hType || undefined, date_from: hFrom || undefined, date_to: hTo || undefined },
    tab === 'history',
  )
  const undo = useUndoPalletOp()
  const opCols = useColumnResize('palletOps_col_widths', [150, 84, 200, 200, 100, 110, 90])
  const opLabel = (t: string) => t === 'MERGE' ? 'Dồn' : t === 'SPLIT' ? 'Tách' : t === 'UNGROUP' ? 'Gỡ nhóm' : t
  const canUndo = canMerge || canUngroup || canSplit
  async function doUndo(o: PalletOpRow) {
    setMsg(null)
    try { await undo.mutateAsync(o.id); setMsg({ ok: true, text: `Đã hoàn tác thao tác ${opLabel(o.type)}` }) }
    catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Không hoàn tác được' }) }
  }

  async function doSplit() {
    setMsg(null)
    const children = splitQtys.map(q => Math.floor(Number(q) || 0)).filter(q => q > 0).map(qty => ({ qty }))
    try {
      const res = await split.mutateAsync({ source_pallet_code: srcQ, children })
      const labels = res.children.map((c: any) => qrToLabel(c.pallet_code, srcEntry?.material, c.cartons_remaining))
      // Ghi log in (tem mới) — không chặn nếu lỗi quyền
      logPrints.mutate({
        mode: 'GENERATE',
        labels: labels.map(l => ({ qr_code: l.qr, material_code: l.materialCode, material_id: l.materialId ?? null, category: l.category, cycle: l.cycle, machine: l.machine, seq: l.seq, nmsx: l.nmsx, qty: l.qty === '' ? null : l.qty })),
      })
      setPrintLabels(labels)
      setTimeout(() => window.print(), 150)
      setMsg({ ok: true, text: `Đã tách ${labels.length} pallet con (gốc còn ${res.source_remaining} thùng) — đang in tem` })
      setSplitQtys([''])
    } catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Lỗi tách pallet' }) }
  }

  function handleScanned(code: string) {
    const c = code.trim()
    if (scanFor === 'target') setMergeTarget(c)
    else if (scanFor === 'child') addChild(c)
    else if (scanFor === 'source') setSplitSrc(c)
    setScanFor(null)
  }

  const mergeReady = !!(mergeTarget.trim() && mergeChildren.length)
  const splitReady = !!(srcEntry && totalSplit > 0 && totalSplit <= free)

  return (
    <div className="flex flex-col h-full sm:p-3">
      <style>{PALLET_PRINT_CSS}</style>

      <Dialog open={scanFor !== null} onOpenChange={o => { if (!o) setScanFor(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><QrCode className="h-4 w-4" />Quét QR pallet</DialogTitle></DialogHeader>
          {scanFor !== null && <QRScanner onScan={handleScanned} onClose={() => setScanFor(null)} />}
        </DialogContent>
      </Dialog>

      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5"><Layers className="h-4 w-4 text-slate-500" />Dồn / Tách pallet</span>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
              <button onClick={() => { setTab('merge'); setMsg(null) }}
                className={`px-3 py-1 inline-flex items-center gap-1 transition-colors ${tab === 'merge' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Layers className="h-3 w-3" />Dồn (gom nhóm)</button>
              <button onClick={() => { setTab('split'); setMsg(null) }}
                className={`px-3 py-1 border-l border-slate-200 inline-flex items-center gap-1 transition-colors ${tab === 'split' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Scissors className="h-3 w-3" />Tách số lượng</button>
              <button onClick={() => { setTab('history'); setMsg(null) }}
                className={`px-3 py-1 border-l border-slate-200 inline-flex items-center gap-1 transition-colors ${tab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><History className="h-3 w-3" />Lịch sử</button>
            </div>
          </div>
        </div>

        <SummaryBand tiles={tab === 'merge'
          ? [{ label: 'Pallet đích', value: mergeTarget ? 1 : 0 }, { label: 'Pallet con', value: mergeChildren.length, accent: mergeChildren.length > 0 }, { label: 'Thao tác', value: 'Gom nhóm' }, { label: 'Số lượng', value: 'Giữ nguyên' }]
          : tab === 'split'
          ? [{ label: 'Tồn gốc', value: srcEntry ? remaining : '—' }, { label: 'Tách ra', value: totalSplit, accent: totalSplit > 0 }, { label: 'Giữ lại', value: srcEntry ? keepLeft : '—' }, { label: 'Pallet con', value: splitQtys.filter(q => Number(q) > 0).length }]
          : [{ label: 'Số thao tác', value: ops.length, accent: ops.length > 0 }, { label: 'Dồn', value: ops.filter(o => o.type === 'MERGE').length }, { label: 'Tách', value: ops.filter(o => o.type === 'SPLIT').length }, { label: 'Đã hoàn tác', value: ops.filter(o => o.undone_at).length }]} />

        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
         {tab === 'history' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {msg && (
              <div className={`mx-3 mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
                {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}<span>{msg.text}</span>
              </div>
            )}
            {/* Bộ lọc lịch sử */}
            <div className="flex flex-wrap items-end gap-2 px-3 py-2 border-b border-slate-200">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input className="pl-7 h-8 text-sm w-56" placeholder="Tìm mã pallet (nguồn/đích)" value={hSearch} onChange={e => setHSearch(e.target.value)} />
              </div>
              <Select value={hType || '__all__'} onValueChange={v => setHType(v === '__all__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả loại</SelectItem>
                  <SelectItem value="MERGE">Dồn</SelectItem>
                  <SelectItem value="SPLIT">Tách</SelectItem>
                  <SelectItem value="UNGROUP">Gỡ nhóm</SelectItem>
                </SelectContent>
              </Select>
              <div><Label className="text-[10px] text-slate-500 block">Từ ngày</Label><Input type="date" className="h-8 text-sm" value={hFrom} max={hTo || undefined} onChange={e => setHFrom(e.target.value)} /></div>
              <div><Label className="text-[10px] text-slate-500 block">Đến ngày</Label><Input type="date" className="h-8 text-sm" value={hTo} min={hFrom || undefined} onChange={e => setHTo(e.target.value)} /></div>
              {(hSearch || hType || hFrom || hTo) && <button onClick={() => { setHSearch(''); setHType(''); setHFrom(''); setHTo('') }} className="text-[11px] text-red-500 hover:text-red-700 h-8">Xóa lọc</button>}
            </div>
            {/* Bảng lịch sử */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="text-[10px] border-collapse table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: opCols.totalWidth, minWidth: '100%' }}>
                <colgroup>{opCols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <thead>
                  <tr className="text-left text-[9px] font-medium text-slate-500">
                    {['Thời gian', 'Loại', 'Pallet nguồn', 'Pallet đích', 'Người làm', 'Trạng thái', 'Hoàn tác'].map((h, i) => (
                      <th key={i} className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 whitespace-nowrap relative">{h}
                        <span onPointerDown={e => opCols.startResize(i, e)} className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ops.length === 0 ? (
                    <tr><td colSpan={7} className="px-2 py-10 text-center text-slate-400">Chưa có thao tác dồn/tách nào{(hSearch || hType || hFrom || hTo) ? ' khớp bộ lọc' : ''}</td></tr>
                  ) : ops.map(o => (
                    <tr key={o.id} className={`border-b border-slate-100 ${o.undone_at ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-1 tabular-nums whitespace-nowrap">{formatTimestampDate(o.created_at, true)} {formatTimestampTime(o.created_at)}</td>
                      <td className="px-2 py-1 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[9px] ${o.type === 'SPLIT' ? 'bg-violet-100 text-violet-700' : o.type === 'MERGE' ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-600'}`}>{opLabel(o.type)}</span></td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap" title={o.source_codes?.join(', ')}>{o.source_codes?.join(', ') || '—'}</td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap" title={o.target_codes?.join(', ')}>{o.target_codes?.join(', ') || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{o.operated_by_name ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{o.undone_at ? <span className="text-amber-600">Đã hoàn tác</span> : <span className="text-green-600">Hiệu lực</span>}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {!o.undone_at && canUndo && (
                          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" disabled={undo.isPending} onClick={() => doUndo(o)}><RotateCcw className="h-3 w-3" />Hoàn tác</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
         ) : (
          <div className="p-4">
          <div className="mx-auto max-w-xl space-y-4">
            {msg && (
              <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
                {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>{msg.text}</span>
              </div>
            )}

            {tab === 'merge' ? (
              <>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet đích (giữ lại làm đại diện)</Label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/nhập mã pallet đích" value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} />
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 px-2.5 shrink-0" onClick={() => setScanFor('target')}><QrCode className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet con (xếp chung lên đích)</Label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/gõ mã rồi Enter" value={childInput}
                        onChange={e => setChildInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addChild(childInput) }} />
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 px-2.5 shrink-0" onClick={() => setScanFor('child')}><QrCode className="h-4 w-4" /></Button>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {mergeChildren.map(c => (
                      <div key={c} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5">
                        <span className="font-mono text-xs font-semibold truncate flex-1">{c}</span>
                        <button onClick={() => setMergeChildren(p => p.filter(x => x !== c))} className="text-slate-400 hover:text-red-500 shrink-0"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    {mergeChildren.length === 0 && <p className="text-xs text-slate-400">Chưa có pallet con.</p>}
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">Dồn = xếp hàng nhiều tem lên 1 pallet vật lý. <b>Không đổi số lượng, không in tem mới</b> — mỗi tem giữ truy vết riêng.</p>

                {canMerge ? (
                  <Button className="w-full gap-1.5" disabled={!mergeReady || merge.isPending} onClick={doMerge}>
                    <Layers className="h-4 w-4" />{merge.isPending ? 'Đang dồn…' : `Dồn ${mergeChildren.length || ''} pallet vào đích`}
                  </Button>
                ) : <p className="text-xs text-amber-600">Bạn không có quyền dồn pallet.</p>}

                {canUngroup && (
                  <Button variant="outline" className="w-full gap-1.5" disabled={!mergeChildren.length || ungroup.isPending}
                    onClick={async () => { setMsg(null); try { const r = await ungroup.mutateAsync({ pallet_codes: mergeChildren }); setMsg({ ok: true, text: `Đã gỡ nhóm ${r.ungrouped} pallet` }); setMergeChildren([]) } catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Lỗi gỡ nhóm' }) } }}>
                    <Trash2 className="h-4 w-4" />Gỡ nhóm các pallet con đã nhập
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet gốc cần tách</Label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/nhập mã pallet gốc" value={splitSrc} onChange={e => setSplitSrc(e.target.value)} />
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 px-2.5 shrink-0" onClick={() => setScanFor('source')}><QrCode className="h-4 w-4" /></Button>
                  </div>
                  {srcQ.length >= 3 && !srcEntry && <p className="text-xs text-amber-600">Không tìm thấy pallet này đang tồn kho.</p>}
                  {srcEntry && (
                    <div className="rounded bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 space-y-0.5">
                      <div><span className="text-slate-400">Hàng:</span> <b>{srcEntry.material?.material_code}</b> — {srcEntry.material?.short_name ?? '—'}</div>
                      <div className="tabular-nums"><span className="text-slate-400">Tồn:</span> <b>{remaining}</b> thùng{reserved > 0 && <span className="text-amber-600"> · giữ chỗ {reserved} (không tách được)</span>}</div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Số thùng mỗi pallet con tách ra</Label>
                  {splitQtys.map((q, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 w-12">Con {i + 1}</span>
                      <Input type="number" min={1} className="h-9 text-sm flex-1" placeholder="Số thùng" value={q}
                        onChange={e => setSplitQtys(p => p.map((x, j) => j === i ? e.target.value : x))} />
                      {splitQtys.length > 1 && <button onClick={() => setSplitQtys(p => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>}
                    </div>
                  ))}
                  <button onClick={() => setSplitQtys(p => [...p, ''])} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5"><Plus className="h-3 w-3" />Thêm pallet con</button>
                  {srcEntry && (
                    <div className={`text-xs tabular-nums ${keepLeft < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                      Tách <b>{totalSplit}</b> thùng → gốc giữ lại <b>{keepLeft}</b> thùng {keepLeft < 0 && '(vượt tồn!)'} {totalSplit > free && free >= 0 && <span className="text-red-600">· vượt số khả dụng {free}</span>}
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-slate-500">Tách = chia số lượng thật. Gốc giảm tồn, sinh pallet con mới (seq <code>x.1</code>) và <b>in tem ngay</b>. Không ảnh hưởng báo cáo nhập.</p>

                {canSplit ? (
                  <Button className="w-full gap-1.5" disabled={!splitReady || split.isPending} onClick={doSplit}>
                    <Scissors className="h-4 w-4" />{split.isPending ? 'Đang tách…' : 'Tách & in tem'}
                  </Button>
                ) : <p className="text-xs text-amber-600">Bạn không có quyền tách pallet.</p>}
              </>
            )}
          </div>
          </div>
         )}
        </div>
      </div>

      <PalletPrintArea labels={printLabels} />
    </div>
  )
}
