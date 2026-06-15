import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, Scissors, QrCode, Search, X, Plus, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QRScanner } from '@/components/shared/QRScanner'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { PalletPrintArea, PALLET_PRINT_CSS, qrToLabel, type LabelData } from '@/components/shared/palletLabel'
import {
  useInventoryEntries, useMergePallets, useUngroupPallets, useSplitPallet, useLogPalletPrints,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

type Tab = 'merge' | 'split'

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
            </div>
          </div>
        </div>

        <SummaryBand tiles={tab === 'merge'
          ? [{ label: 'Pallet đích', value: mergeTarget ? 1 : 0 }, { label: 'Pallet con', value: mergeChildren.length, accent: mergeChildren.length > 0 }, { label: 'Thao tác', value: 'Gom nhóm' }, { label: 'Số lượng', value: 'Giữ nguyên' }]
          : [{ label: 'Tồn gốc', value: srcEntry ? remaining : '—' }, { label: 'Tách ra', value: totalSplit, accent: totalSplit > 0 }, { label: 'Giữ lại', value: srcEntry ? keepLeft : '—' }, { label: 'Pallet con', value: splitQtys.filter(q => Number(q) > 0).length }]} />

        <div className="flex-1 min-h-0 overflow-auto p-4">
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
      </div>

      <PalletPrintArea labels={printLabels} />
    </div>
  )
}
