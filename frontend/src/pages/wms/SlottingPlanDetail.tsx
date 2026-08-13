// Chi tiáº¿t káº¿ hoáº¡ch sáº¯p xáº¿p kho (Slotting v2) â€” dÃ²ng GOM theo (MÃ£ + Date): "N pallet:
// vá»‹ trÃ­ 1 â†’ vá»‹ trÃ­ 2". Tiáº¿n Ä‘á»™ x/N SUY Sá»NG tá»« vá»‹ trÃ­ hiá»‡n táº¡i cá»§a cÃ¡c pallet trong dÃ²ng
// (cÃ´ng nhÃ¢n chuyá»ƒn báº±ng "Chuyá»ƒn vá»‹ trÃ­" á»Ÿ Tá»“n kho â€” trang nÃ y tá»± nháº£y tick realtime).
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ArrowLeft, Boxes, CheckCircle2, ChevronDown, ChevronRight, QrCode, RotateCcw, Trash2, XCircle, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { SearchInput } from '@/components/shared/SearchInput'
import { useSlottingPlan, useUpdateSlottingPlan, useDeleteSlottingPlan, type SlottingPlanLineRow } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatDateTime } from '@/utils/formatters'
import { printSlottingPlan, computeFreesSet } from './printSlottingPlan'
import { PlanScanOverlay } from './PlanScanOverlay'
import { unlockAudio } from '@/utils/audio'

const nf = new Intl.NumberFormat('vi-VN')

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

const LINE_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  PARTIAL: 'bg-amber-100 text-amber-700',
  DONE:    'bg-green-100 text-green-700',
  GONE:    'bg-slate-100 text-slate-400 line-through',
}
const LINE_LABEL: Record<string, string> = {
  PENDING: 'ChÆ°a chuyá»ƒn', PARTIAL: 'Äang chuyá»ƒn', DONE: 'Xong', GONE: 'Háº¿t tá»“n',
}
const PLAN_BADGE: Record<string, string> = {
  ACTIVE: 'bg-sky-100 text-sky-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-slate-100 text-slate-500',
}
const PLAN_LABEL: Record<string, string> = { ACTIVE: 'Äang thá»±c hiá»‡n', COMPLETED: 'HoÃ n thÃ nh', CANCELLED: 'ÄÃ£ há»§y' }
const LEVEL_LABEL: Record<string, string> = { EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard' }

type LineFilter = '' | 'PENDING' | 'PARTIAL' | 'DONE' | 'GONE'
type BracketPos = 'first' | 'mid' | 'last' | 'only'

export default function SlottingPlanDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const admin = isAdmin(user)
  // Má»—i nÃºt 1 quyá»n riÃªng (tÃ¡ch 05/08 â€” khÃ´ng gá»™p complete cho cáº£ 3 nÃºt, plan khÃ´ng kiÃªm xÃ³a)
  const canDelete   = admin || can(perms, 'slotting', 'delete')
  const canComplete = admin || can(perms, 'slotting', 'complete')
  const canCancel   = admin || can(perms, 'slotting', 'cancel')
  const canReopen   = admin || can(perms, 'slotting', 'reopen')
  // QuÃ©t thá»±c hiá»‡n lá»‡nh = thao tÃ¡c Chuyá»ƒn vá»‹ trÃ­ pallet â†’ Ä‘Ãºng quyá»n inventory.move_location (cross-module)
  const canScanMove = admin || can(perms, 'inventory', 'move_location')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanEverOpened, setScanEverOpened] = useState(false)

  const { data: plan, isLoading, error } = useSlottingPlan(id)
  const { mutate: updatePlan, isPending: updating } = useUpdateSlottingPlan()
  const { mutate: deletePlan, isPending: deleting } = useDeleteSlottingPlan()
  const [actErr, setActErr] = useState('')
  const [search, setSearch] = useState('')
  const [lineFilter, setLineFilter] = useState<LineFilter>('')
  const [impactOpen, setImpactOpen] = useState(false)   // "Káº¿t quáº£ ká»³ vá»ng" â€” thu gá»n máº·c Ä‘á»‹nh, má»Ÿ xem khi cáº§n

  // DÃ²ng nÃ o lÃ m xong TRá»NG Ä‘Æ°á»£c vá»‹ trÃ­ nguá»“n â€” tÃ­nh trÃªn TOÃ€N káº¿ hoáº¡ch (khÃ´ng theo bá»™ lá»c)
  const freesSet = useMemo(() => computeFreesSet(plan?.lines ?? []), [plan?.lines])

  // Káº¿t quáº£ ká»³ vá»ng náº¿u thá»±c hiá»‡n Äá»¦ káº¿ hoáº¡ch â€” suy tá»« dÃ²ng Ä‘Ã£ lÆ°u + freesSet (khá»›p nhÃ£n â†’trá»‘ng),
  // KHÃ”NG cáº§n lÆ°u riÃªng: vá»‹ trÃ­ giáº£i phÃ³ng = nguá»“n cá»§a cÃ¡c dÃ²ng "â†’trá»‘ng"; phÃ¢n loáº¡i viá»‡c theo `reason`.
  const impact = useMemo(() => {
    const ls = plan?.lines ?? []
    if (ls.length === 0) return null
    const freed = new Map<string, string>()   // from_location_id â†’ code (dedup)
    for (const l of ls) if (l.from_location_id && freesSet.has(l.id)) freed.set(l.from_location_id, l.from_location_code ?? '?')
    const sumR = (re: RegExp) => ls.filter(l => re.test(l.reason ?? '')).reduce((s, l) => s + l.n_pallets, 0)
    return {
      lines: ls.length,
      moved: ls.reduce((s, l) => s + l.n_pallets, 0),
      freedLocs: [...freed.values()].sort(),
      tempCleared: sumR(/táº¡m/i),           // P1 khu "khÃ´ng Ä‘Æ°a hÃ ng vÃ o"
      wrongZone: sumR(/sai loáº¡i khu/i),    // P0
      abc: sumR(/gáº§n cá»­a|khu xa|lá»‡ch khu/i), // P2 (Hard)
      dateGroup: sumR(/Dá»“n date/i),        // P3
      freeGroup: sumR(/Gom mÃ£/i),          // P4
    }
  }, [plan?.lines, freesSet])

  const lines = useMemo(() => {
    let list = plan?.lines ?? []
    if (lineFilter) list = list.filter(l => l.status === lineFilter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(l => `${l.material_code ?? ''} ${l.material_name ?? ''} ${l.date_key ?? ''} ${l.from_location_code ?? ''} ${l.to_location_code ?? ''}`.toLowerCase().includes(q))
    // Gom TRá»ŒN theo vá»‹ trÃ­ Ä‘Ã­ch (thá»© tá»± xuáº¥t hiá»‡n Ä‘áº§u) + nhÃ³m GIáº¢I PHÃ“NG vá»‹ trÃ­ nguá»“n lÃªn Ä‘áº§u
    // (user 18/07: viá»‡c dá»… + hiá»‡u quáº£ á»Ÿ trÃªn â€” chuyá»ƒn xong lÃ  cÃ³ Ã´ trá»‘ng ngay cho cÃ¡c lá»‡nh sau)
    const groups = new Map<string, SlottingPlanLineRow[]>()
    for (const l of list) {
      const g = groups.get(l.to_location_id)
      if (g) g.push(l)
      else groups.set(l.to_location_id, [l])
    }
    return [...groups.values()]
      .sort((a, b) => Number(b.some(l => freesSet.has(l.id))) - Number(a.some(l => freesSet.has(l.id))))
      .flat()
  }, [plan?.lines, search, lineFilter, freesSet])

  // Bracket ná»‘i cÃ¡c dÃ²ng LIá»€N NHAU cÃ¹ng vá»‹ trÃ­ Ä‘Ã­ch (gom Ä‘Ã­ch â€” nhÆ° báº£ng Nháº­p ná»‘i theo chuyáº¿n)
  const bracketPositions = useMemo(() => {
    const map = new Map<string, BracketPos>()
    const n = lines.length
    lines.forEach((l, i) => {
      const key = l.to_location_id
      const prevOk = i > 0 && lines[i - 1].to_location_id === key
      const nextOk = i < n - 1 && lines[i + 1].to_location_id === key
      map.set(l.id, prevOk && nextOk ? 'mid' : prevOk ? 'last' : nextOk ? 'first' : 'only')
    })
    return map
  }, [lines])

  function setStatus(status: 'COMPLETED' | 'CANCELLED' | 'ACTIVE', confirmMsg: string) {
    if (!plan) return
    if (!confirm(confirmMsg)) return
    setActErr('')
    updatePlan({ id: plan.id, status }, { onError: e => setActErr(apiMsg(e)) })
  }
  function handleDelete() {
    if (!plan) return
    if (!confirm(`XÃ³a káº¿ hoáº¡ch "${plan.name}" (${plan.n_lines} dÃ²ng)?\nChá»‰ xÃ³a báº£n káº¿ hoáº¡ch â€” pallet Ä‘Ã£ chuyá»ƒn KHÃ”NG bá»‹ hoÃ n tÃ¡c.`)) return
    deletePlan(plan.id, {
      onSuccess: () => navigate('/wms/slotting'),
      onError: e => setActErr(apiMsg(e)),
    })
  }

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div>
  if (error || !plan) return (
    <div className="p-8 text-center space-y-2">
      <p className="text-sm text-red-600">{error ? apiMsg(error) : 'KhÃ´ng tÃ¬m tháº¥y káº¿ hoáº¡ch'}</p>
      <Link to="/wms/slotting" className="text-xs text-sky-600 underline">â† Vá» Tá»‘i Æ°u vá»‹ trÃ­</Link>
    </div>
  )

  const s = plan.summary
  const pct = s.total_pallets > 0 ? Math.round(((s.done_pallets + s.gone_pallets) / s.total_pallets) * 100) : 0
  const tiles: BandTile[] = [
    { label: 'DÃ²ng chuyá»ƒn', value: nf.format(s.total_lines) },
    { label: 'Pallet pháº£i chuyá»ƒn', value: nf.format(s.total_pallets) },
    { label: 'ÄÃ£ vá» Ä‘Ãºng chá»—', value: nf.format(s.done_pallets), accent: s.done_pallets > 0 },
    { label: 'KhÃ¡c vá»‹ trÃ­ Ä‘á» xuáº¥t', value: nf.format(s.moved_other_pallets), danger: s.moved_other_pallets > 0 },
    { label: 'Háº¿t tá»“n', value: nf.format(s.gone_pallets) },
    { label: 'ChÆ°a chuyá»ƒn', value: nf.format(s.pending_pallets) },
    { label: 'Tiáº¿n Ä‘á»™', value: `${pct}%`, accent: true },
  ]

  const statusChips: { key: LineFilter; label: string; n: number }[] = [
    { key: '', label: 'Táº¥t cáº£', n: s.total_lines },
    { key: 'PENDING', label: LINE_LABEL.PENDING, n: s.pending_lines },
    { key: 'PARTIAL', label: LINE_LABEL.PARTIAL, n: s.partial_lines },
    { key: 'DONE', label: LINE_LABEL.DONE, n: s.done_lines },
  ]

  const openScan = () => { unlockAudio(); setScanEverOpened(true); setScanOpen(true) }

  return (
    <div className="flex flex-col h-full sm:p-3">
      {scanEverOpened && (
        <PlanScanOverlay plan={{ id: plan.id, name: plan.name }} open={scanOpen} onClose={() => setScanOpen(false)} />
      )}
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Header */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl space-y-1.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/wms/slotting" className="text-slate-400 hover:text-slate-600 shrink-0"><ArrowLeft className="h-4 w-4" /></Link>
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <Boxes className="h-4 w-4 text-sky-600" /> {plan.name}
            </h1>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${PLAN_BADGE[plan.status]}`}>{PLAN_LABEL[plan.status]}</span>
            {plan.level && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{LEVEL_LABEL[plan.level]} Â· {plan.principle ?? 'â€”'}</span>}
            <span className="text-[10px] text-slate-400">
              {plan.created_by ?? 'â€”'} Â· {formatDateTime(plan.created_at)}
              {plan.completed_at ? ` Â· Ä‘Ã³ng ${formatDateTime(plan.completed_at)} (${plan.completed_by ?? 'â€”'})` : ''}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[11px]"
                title="In phiáº¿u A4 gom theo vá»‹ trÃ­ Ä‘Ã­ch â€” in Ä‘Ãºng danh sÃ¡ch Ä‘ang lá»c trÃªn mÃ n"
                onClick={() => {
                  if (!printSlottingPlan(plan, lines, user?.name)) setActErr('TrÃ¬nh duyá»‡t cháº·n cá»­a sá»• in â€” cho phÃ©p popup rá»“i báº¥m In láº¡i')
                }}>
                <Printer className="h-3.5 w-3.5 mr-1" /> In
              </Button>
              {canComplete && plan.status === 'ACTIVE' && (
                <Button size="sm" className="h-7 text-[11px] bg-green-600 hover:bg-green-700" disabled={updating}
                  onClick={() => setStatus('COMPLETED', `HoÃ n thÃ nh káº¿ hoáº¡ch "${plan.name}"?\n${s.done_pallets + s.gone_pallets}/${s.total_pallets} pallet Ä‘Ã£ xá»­ lÃ½${s.pending_pallets > 0 ? ` â€” CÃ’N ${s.pending_pallets} pallet chÆ°a chuyá»ƒn` : ''}.`)}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> HoÃ n thÃ nh
                </Button>
              )}
              {canCancel && plan.status === 'ACTIVE' && (
                <Button size="sm" variant="outline" className="h-7 text-[11px] text-red-600 border-red-200 hover:bg-red-50" disabled={updating}
                  onClick={() => setStatus('CANCELLED', `Há»§y káº¿ hoáº¡ch "${plan.name}"? Pallet Ä‘Ã£ chuyá»ƒn khÃ´ng bá»‹ hoÃ n tÃ¡c.`)}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Há»§y
                </Button>
              )}
              {canReopen && plan.status !== 'ACTIVE' && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={updating}
                  onClick={() => setStatus('ACTIVE', `Má»Ÿ láº¡i káº¿ hoáº¡ch "${plan.name}"?`)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Má»Ÿ láº¡i
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="outline" className="h-7 text-[11px] text-red-600 border-red-200 hover:bg-red-50" disabled={deleting} onClick={handleDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> XÃ³a
                </Button>
              )}
            </span>
          </div>
          {actErr && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{actErr}</p>}
        </div>

        <SummaryBand tiles={tiles} />

        {/* Káº¿t quáº£ ká»³ vá»ng náº¿u thá»±c hiá»‡n Ä‘á»§ â€” thu gá»n máº·c Ä‘á»‹nh, má»Ÿ báº£ng khi cáº§n soi */}
        {impact && impact.moved > 0 && (
          <div className="border-b border-sky-200 bg-sky-50/60 shrink-0 print:hidden">
            <button
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100/60 transition-colors"
              onClick={() => setImpactOpen(o => !o)}>
              {impactOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              <span className="text-left">Káº¿t quáº£ ká»³ vá»ng náº¿u thá»±c hiá»‡n Ä‘á»§ {nf.format(impact.lines)} dÃ²ng ({nf.format(impact.moved)} pallet)</span>
              {!impactOpen && impact.freedLocs.length > 0 && (
                <span className="font-normal text-green-700 whitespace-nowrap">â€” giáº£i phÃ³ng {impact.freedLocs.length} vá»‹ trÃ­</span>
              )}
              <span className="ml-auto text-[10px] font-normal text-sky-500 whitespace-nowrap">{impactOpen ? 'Thu gá»n' : 'Má»Ÿ xem'}</span>
            </button>
            {impactOpen && (
              <div className="px-3 pb-2.5 space-y-2">
                <div className="overflow-x-auto rounded-lg border border-sky-200 bg-white">
                  <table className="min-w-full text-[11px]">
                    <tbody className="[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_tr]:border-b [&_tr]:border-sky-100 [&_tr:last-child]:border-0">
                      {impact.freedLocs.length > 0 && (
                        <tr>
                          <td className="font-medium text-sky-800 whitespace-nowrap">Giáº£i phÃ³ng hoÃ n toÃ n vá»‹ trÃ­</td>
                          <td className="text-right font-semibold tabular-nums text-green-700 whitespace-nowrap">{nf.format(impact.freedLocs.length)} vá»‹ trÃ­</td>
                          <td className="font-mono text-[10px] text-slate-600">{impact.freedLocs.join(', ')}</td>
                        </tr>
                      )}
                      {impact.tempCleared > 0 && (
                        <tr>
                          <td className="font-medium text-sky-800 whitespace-nowrap">Dá»n khá»i vá»‹ trÃ­ "khÃ´ng Ä‘Æ°a hÃ ng vÃ o"</td>
                          <td className="text-right font-semibold tabular-nums whitespace-nowrap">{nf.format(impact.tempCleared)} pallet</td>
                          <td className="text-[10px] text-slate-500">KÃ©o hÃ ng khu táº¡m vá» kho chuáº©n khi cÃ³ chá»— (khÃ´ng Ä‘Ã²i dá»n sáº¡ch)</td>
                        </tr>
                      )}
                      {impact.wrongZone > 0 && (
                        <tr>
                          <td className="font-medium text-sky-800 whitespace-nowrap">KÃ©o vá» Ä‘Ãºng loáº¡i khu</td>
                          <td className="text-right font-semibold tabular-nums whitespace-nowrap">{nf.format(impact.wrongZone)} pallet</td>
                          <td className="text-[10px] text-slate-500">Pallet náº±m sai loáº¡i khu â†’ khu Ä‘Ãºng loáº¡i</td>
                        </tr>
                      )}
                      {impact.abc > 0 && (
                        <tr>
                          <td className="font-medium text-sky-800 whitespace-nowrap">Äáº£o khu theo háº¡ng ABC</td>
                          <td className="text-right font-semibold tabular-nums whitespace-nowrap">{nf.format(impact.abc)} pallet</td>
                          <td className="text-[10px] text-slate-500">MÃ£ nháº·t nhiá»u vá» gáº§n cá»­a, nháº·t Ã­t ra xa</td>
                        </tr>
                      )}
                      {impact.dateGroup > 0 && (
                        <tr>
                          <td className="font-medium text-sky-800 whitespace-nowrap">Gom theo date ({plan.principle ?? 'FEFO'})</td>
                          <td className="text-right font-semibold tabular-nums whitespace-nowrap">{nf.format(impact.dateGroup)} pallet</td>
                          <td className="text-[10px] text-slate-500">Sau gom, má»—i vá»‹ trÃ­ chá»©a cÃ¹ng mÃ£ vá»›i dáº£i date liá»n nhau, xuáº¥t Ä‘Ãºng chiá»u {plan.principle ?? 'FEFO'}</td>
                        </tr>
                      )}
                      {impact.freeGroup > 0 && (
                        <tr>
                          <td className="font-medium text-sky-800 whitespace-nowrap">Gom mÃ£ ráº£i rÃ¡c vá» Ã­t vá»‹ trÃ­</td>
                          <td className="text-right font-semibold tabular-nums whitespace-nowrap">{nf.format(impact.freeGroup)} pallet</td>
                          <td className="text-[10px] text-slate-500">Giáº£i phÃ³ng chá»—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-sky-700 leading-relaxed">
                  <b>CÃ¡ch soi tá»«ng dÃ²ng:</b> dÃ²ng cÃ³ nhÃ£n <span className="font-semibold text-green-700">â†’trá»‘ng</span> (cá»™t "PL nÆ¡i Ä‘i") = lÃ m xong giáº£i phÃ³ng Ä‘Æ°á»£c vá»‹ trÃ­ nguá»“n â€” nÃªn lÃ m trÆ°á»›c. ÄÃ­ch há»£p lÃ½ lÃ  vá»‹ trÃ­ trá»‘ng hoáº·c Ä‘ang chá»©a CÃ™NG MÃƒ, date Ä‘Ãºng chiá»u {plan.principle === 'LIFO' ? 'LIFO (Ä‘Ã­ch chá»©a date NGáº®N hÆ¡n hÃ ng chuyá»ƒn Ä‘áº¿n)' : `${plan.principle ?? 'FEFO'} (Ä‘Ã­ch chá»©a date DÃ€I hÆ¡n hÃ ng chuyá»ƒn Ä‘áº¿n)`}.
                </p>
                <p className="text-[10px] text-sky-700 leading-relaxed">
                  Má»—i pallet chá»‰ chuyá»ƒn 1 láº§n/káº¿ hoáº¡ch â€” vÃ i pallet dáº¡ng hoÃ¡n Ä‘á»•i dÃ¢y chuyá»n (chá»— nÃ y trá»‘ng ra thÃ¬ chá»— kia má»›i dá»“n Ä‘Æ°á»£c) sáº½ hiá»‡n khi <b>Sinh gá»£i Ã½ láº§n ná»¯a SAU khi lÃ m xong</b> Ä‘á»£t nÃ y; Ä‘á»£t 2 thÆ°á»ng ráº¥t nhá» (~1â€“3%) vÃ  Ä‘á»£t 3 = 0.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Lá»c tráº¡ng thÃ¡i dÃ²ng + tÃ¬m */}
        <div className="border-b bg-slate-50 px-3 py-1.5 shrink-0 flex items-center gap-1.5 flex-wrap print:hidden">
          {statusChips.map(c => (
            <button key={c.key || 'all'}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${lineFilter === c.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              onClick={() => setLineFilter(c.key)}>
              {c.label} ({nf.format(c.n)})
            </button>
          ))}
          <SearchInput value={search} onChange={setSearch} placeholder="TÃ¬m mÃ£, date, vá»‹ trÃ­â€¦" className="flex-1 min-w-[140px] max-w-xs ml-auto" />
        </div>

        {/* Báº£ng dÃ²ng gom (MÃ£ + Date) */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {lines.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">KhÃ´ng cÃ³ dÃ²ng khá»›p bá»™ lá»c</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap sticky left-0 z-20 bg-slate-50">MÃ£ hÃ ng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn hÃ ng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Date</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Háº¡ng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tá»« vá»‹ trÃ­</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap" title="Sá»‘ pallet HIá»†N Ä‘ang náº±m á»Ÿ vá»‹ trÃ­ Ä‘i">PL nÆ¡i Ä‘i</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Äáº¿n vá»‹ trÃ­</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap" title="Sá»‘ pallet HIá»†N Ä‘ang náº±m á»Ÿ vá»‹ trÃ­ Ä‘Ã­ch">PL Ä‘Ã­ch</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tiáº¿n Ä‘á»™</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tráº¡ng thÃ¡i</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">NgÆ°á»i chuyá»ƒn cuá»‘i</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">LÃºc</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">LÃ½ do Â· HD xáº¿p</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => (
                  <LineRow key={l.id} l={l} bracketPos={bracketPositions.get(l.id) ?? 'only'} frees={freesSet.has(l.id)}
                    onScan={canScanMove && plan.status === 'ACTIVE' && (l.status === 'PENDING' || l.status === 'PARTIAL') ? openScan : undefined} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0 print:hidden">
          1â€“{lines.length} / {plan.lines.length} dÃ²ng Â· 1 dÃ²ng = 1 lá»‡nh gom (MÃ£ + Date); pallet chuyá»ƒn báº±ng nÃºt "Chuyá»ƒn vá»‹ trÃ­" á»Ÿ Tá»“n kho â€” tiáº¿n Ä‘á»™ tá»± nháº£y khi pallet vá» Ä‘Ãºng vá»‹ trÃ­ Ä‘Ã­ch
        </div>
      </div>
    </div>
  )
}

function LineRow({ l, bracketPos = 'only', frees = false, onScan }: {
  l: SlottingPlanLineRow; bracketPos?: BracketPos; frees?: boolean; onScan?: () => void
}) {
  const abcCls = l.abc === 'A' ? 'bg-sky-600 text-white' : l.abc === 'B' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
  const resolved = l.done + l.gone
  const pctLine = l.n_pallets > 0 ? Math.round((resolved / l.n_pallets) * 100) : 0
  // NhÃ³m cÃ¹ng vá»‹ trÃ­ Ä‘Ã­ch: bracket [ á»Ÿ mÃ©p trÃ¡i + Ä‘Ã³ng khung cá»¥m (nhÆ° báº£ng Nháº­p ná»‘i theo chuyáº¿n)
  const grouped = bracketPos !== 'only'
  const repeatTo = bracketPos === 'mid' || bracketPos === 'last' // Ä‘Ã­ch láº·p láº¡i trong nhÃ³m â†’ má» Ä‘i
  return (
    <TableRow className={`${l.status === 'GONE' ? 'opacity-50' : ''} ${grouped ? 'bg-slate-50' : ''} ${grouped && bracketPos === 'first' ? '[&_td]:border-t [&_td]:!border-t-slate-300' : ''} ${grouped && bracketPos === 'last' ? '[&_td]:!border-b-slate-300' : ''}`}>
      <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 ${grouped ? 'bg-slate-50 pl-4' : 'bg-white'}`}>
        {grouped && (
          <span aria-hidden className="absolute" style={{
            left: 3, width: 6,
            top: bracketPos === 'first' ? '50%' : 0,
            bottom: bracketPos === 'last' ? '50%' : 0,
            borderLeft: '2px solid #0f172a',
            ...(bracketPos === 'first' ? { borderTop: '2px solid #0f172a', borderTopLeftRadius: 3 } : {}),
            ...(bracketPos === 'last' ? { borderBottom: '2px solid #0f172a', borderBottomLeftRadius: 3 } : {}),
          }} />
        )}
        <span className="font-mono font-semibold">{l.material_code ?? 'â€”'}</span>
      </TableCell>
      {/* TÃªn hÃ ng = cá»™t RIÃŠNG sau MÃ£ hÃ ng (user 19/07): cá»™t freeze chá»‰ cÃ²n mÃ£ (háº¹p, khÃ´ng che mÃ n
          phone); tÃªn hiá»‡n Äá»¦ khÃ´ng cáº¯t â€” báº£ng cuá»™n ngang nÃªn khÃ´ng vá»¡ layout */}
      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">
        {l.material_name ?? <span className="text-slate-300">â€”</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{l.date_key ?? <span className="text-slate-300">â€”</span>}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {l.abc ? <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${abcCls}`}>{l.abc}</span> : <span className="text-slate-300">â€”</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">
        {/* flex + ml-auto: nÃºt QR GHIM mÃ©p pháº£i cá»™t â€” má»i dÃ²ng tháº³ng hÃ ng nhau (user 19/07) */}
        <span className="flex items-center gap-1.5 min-w-[150px]">
          <span>{l.from_location_code ?? <span className="text-slate-300">â€”</span>}</span>
          {onScan && (
            <button className="ml-auto shrink-0 text-sky-600 hover:text-sky-800 px-1.5 py-1 rounded !min-h-0 !min-w-0"
              title="QuÃ©t thá»±c hiá»‡n â€” quÃ©t tem pallet Ä‘ang á»Ÿ vá»‹ trÃ­ nguá»“n, tá»± chuyá»ƒn sang vá»‹ trÃ­ Ä‘Ã­ch"
              onClick={e => { e.stopPropagation(); onScan() }}>
              <QrCode className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">
        {l.from_pallets_now != null ? l.from_pallets_now : <span className="text-slate-300">â€”</span>}
        {frees && <span className="ml-1 text-[9px] font-semibold text-green-700" title="Chuyá»ƒn xong lÃ  TRá»NG Ä‘Æ°á»£c vá»‹ trÃ­ nguá»“n â€” nÃªn lÃ m trÆ°á»›c Ä‘á»ƒ cÃ³ chá»— trá»‘ng cho cÃ¡c lá»‡nh sau">â†’trá»‘ng</span>}
      </TableCell>
      <TableCell className={`px-2 py-1 text-[10px] font-mono font-semibold text-green-700 whitespace-nowrap ${repeatTo ? 'opacity-40' : ''}`}>{l.to_location_code ?? 'â€”'}</TableCell>
      <TableCell className={`px-2 py-1 text-[10px] tabular-nums whitespace-nowrap ${repeatTo ? 'opacity-40' : ''}`}>{l.to_pallets_now != null ? l.to_pallets_now : <span className="text-slate-300">â€”</span>}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="flex items-center gap-1.5">
          <span className="w-14 h-1.5 rounded bg-slate-200 overflow-hidden inline-block">
            <span className={`block h-1.5 ${resolved >= l.n_pallets ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${pctLine}%` }} />
          </span>
          <span className="text-[10px] tabular-nums font-semibold">{l.done}/{l.n_pallets}</span>
          {l.moved_other > 0 && <span className="text-[9px] text-amber-600 font-semibold" title="Pallet Ä‘Ã£ rá»i vá»‹ trÃ­ cÅ© nhÆ°ng sang chá»— khÃ¡c Ä‘á» xuáº¥t">âš {l.moved_other}</span>}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${LINE_BADGE[l.status]}`}>{LINE_LABEL[l.status]}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{l.moved_by_name ?? <span className="text-slate-300">â€”</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{l.moved_at ? formatDateTime(l.moved_at) : <span className="text-slate-300">â€”</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">
        <span className="block max-w-[280px] truncate" title={`${l.reason ?? ''}${l.flow_note ? ` Â· ${l.flow_note}` : ''}`}>{l.reason ?? 'â€”'}{l.flow_note ? ` Â· ${l.flow_note}` : ''}</span>
      </TableCell>
    </TableRow>
  )
}
