import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { KeyRound, Plus, Ban, Copy, Check, ShieldAlert, Eye, EyeOff, Trash2, BookOpen, Sparkles } from 'lucide-react'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { isAdmin } from '@/config/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FormSheet } from '@/components/shared/FormSheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/utils/formatters'

interface ApiKeyRow {
  id: string; name: string; key: string | null; key_prefix: string | null; scopes: string[]
  is_active: boolean; last_used_at: string | null; created_at: string | null; created_by: string | null
}

const SCOPE_OPTS: { key: string; label: string }[] = [
  { key: 'materials:read', label: 'MÃ£ hÃ ng' },
  { key: 'inventory:read', label: 'Tá»“n kho' },
  { key: 'inbound:read',   label: 'Phiáº¿u nháº­p' },
  { key: 'outbound:read',  label: 'Phiáº¿u xuáº¥t' },
  { key: 'scans:read',     label: 'Lá»‹ch sá»­ quÃ©t' },
  { key: 'weigh:write',    label: 'Tráº¡m cÃ¢n (Ä‘áº©y phiáº¿u cÃ¢n vÃ o)' },
]
const ALL_SCOPES = SCOPE_OPTS.map(s => s.key)

// TÃ i liá»‡u 5 endpoint (khá»›p backend/src/routes/integration.ts + exportController.ts).
const ENDPOINT_DOCS: { path: string; scope: string; label: string; fields: string }[] = [
  { path: '/materials',        scope: 'materials:read', label: 'MÃ£ hÃ ng',      fields: 'material_code, material_description, short_name, category, product_type, unit, cartons_per_pallet, units_per_carton, shelf_life_days, batch_prefix, is_active' },
  { path: '/inventory',        scope: 'inventory:read', label: 'Tá»“n kho',      fields: 'pallet_code, batch (mÃ£ lÃ´), expiry_date (HSD), production_date, material_code, warehouse_id, location_id, cartons_imported, cartons_remaining, cartons_reserved, status, ncc_id, import_date' },
  { path: '/inbound-receipts', scope: 'inbound:read',   label: 'Phiáº¿u nháº­p',   fields: 'import_code, material_code, warehouse_id, warehouse_type, planned_cartons, planned_pallets, status, source_type, ncc_id, import_date' },
  { path: '/outbound-orders',  scope: 'outbound:read',  label: 'Phiáº¿u xuáº¥t',   fields: 'group_code, planned_date, delivery_date, warehouse_id, warehouse_type, dvvt, shipto_party, license_plate, status, transfer_status, completed_at' },
  { path: '/scan-entries',     scope: 'scans:read',     label: 'Lá»‹ch sá»­ quÃ©t', fields: 'item_id, inventory_entry_id, pallet_code, cartons_scanned, production_date, pct_date, is_loose_picking, scanned_at, scanned_by' },
  { path: '/weigh/tickets (POST)', scope: 'weigh:write', label: 'Phiáº¿u cÃ¢n (agent tráº¡m cÃ¢n Äáº¨Y VÃ€O)', fields: 'station_code + tickets[] (cá»™t gá»‘c WeightForm cá»§a PM cÃ¢n: id, OrderNum, GDate, TruckNum, Tare/Gross/NetWeight, TareTime/GrossTime, ImExTypeâ€¦)' },
]
const errMsg = (e: unknown) =>
  (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'CÃ³ lá»—i xáº£y ra, thá»­ láº¡i'

// â”€â”€â”€ AI Vision (Sá»• Ä‘Ã³ng gÃ³i) â€” key Gemini Ä‘áº·t á»ž ÄÃ‚Y Ä‘á»ƒ "háº¿t háº¡n thÃ¬ thay" (user chá»‘t 12/08) â”€â”€
interface VisionCfg { configured: boolean; provider: string; model: string; key_tail: string | null }
function VisionConfigCard() {
  const qc = useQueryClient()
  const [keyInput, setKeyInput] = useState('')
  const [model, setModel] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const { data: cfg } = useQuery<VisionCfg>({
    queryKey: ['vision-config'],
    queryFn: () => apiClient.get('/wms/vision-config').then(r => r.data.data),
  })

  const saveMut = useMutation({
    mutationFn: (body: { api_key?: string | null; model?: string }) =>
      apiClient.put('/wms/vision-config', body).then(r => r.data.data as { configured: boolean }),
    onSuccess: (d) => {
      setKeyInput(''); setMsg({ kind: 'ok', text: d.configured ? 'ÄÃ£ lÆ°u â€” báº¥m "Kiá»ƒm tra" Ä‘á»ƒ thá»­ key' : 'ÄÃ£ gá»¡ key â€” app quay vá» OCR thÆ°á»ng' })
      qc.invalidateQueries({ queryKey: ['vision-config'] })
    },
    onError: (e) => setMsg({ kind: 'err', text: errMsg(e) }),
  })
  const testMut = useMutation({
    mutationFn: () => apiClient.post('/wms/vision-config/test').then(r => r.data.data as { model: string; latency_ms: number }),
    onSuccess: (d) => setMsg({ kind: 'ok', text: `Key hoáº¡t Ä‘á»™ng â€” ${d.model} pháº£n há»“i ${d.latency_ms}ms` }),
    onError: (e) => setMsg({ kind: 'err', text: errMsg(e) }),
  })

  const busy = saveMut.isPending || testMut.isPending
  return (
    <div className="shrink-0 mt-3 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm border-t sm:border-t-slate-200">
      <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-500" /> AI Vision â€” Ä‘á»c chá»¯ in phun (Sá»• Ä‘Ã³ng gÃ³i)
        </span>
        {cfg && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${cfg.configured ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
            {cfg.configured ? `Äang dÃ¹ng Â· ${cfg.model} Â· key ${cfg.key_tail}` : 'ChÆ°a cáº¥u hÃ¬nh â€” Ä‘ang dÃ¹ng OCR thÆ°á»ng'}
          </span>
        )}
      </div>
      <div className="px-3 py-2.5 space-y-2 text-[12px] text-slate-600">
        <p>
          áº¢nh chá»¥p date thÃ¹ng sáº½ Ä‘Æ°á»£c Ä‘á»c báº±ng <b>Google Gemini</b> (chÃ­nh xÃ¡c hÆ¡n háº³n OCR vá»›i chá»¯ nghiÃªng/nhá»).
          Key lá»—i / háº¿t quota / chÆ°a cáº¥u hÃ¬nh â†’ app <b>tá»± rÆ¡i vá» OCR thÆ°á»ng</b>, cÃ´ng nhÃ¢n khÃ´ng bá»‹ cháº·n.
          Táº¡o key <b>miá»…n phÃ­</b> táº¡i <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">aistudio.google.com/apikey</a> (Google
          AI Studio â€” báº­c free ~1.000 áº£nh/ngÃ y, khÃ´ng cáº§n tháº»; sáº£n lÆ°á»£ng lá»›n thÃ¬ gáº¯n billing vÃ o project lÃ  háº¿t tráº§n, ~4â€“5Ä‘/áº£nh). Háº¿t háº¡n/bá»‹ khÃ³a â†’ dÃ¡n key má»›i vÃ o Ä‘Ã¢y lÃ  xong.
          Model máº·c Ä‘á»‹nh <code className="font-mono text-[11px]">gemini-flash-lite-latest</code> tá»± trá» báº£n má»›i nháº¥t; model nghá»‰ hÆ°u â†’ há»‡ thá»‘ng <b>tá»± dÃ² model sá»‘ng</b> vÃ  lÆ°u láº¡i.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label className="text-[11px]">API key (Gemini)</Label>
            <Input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
              placeholder={cfg?.configured ? `Äang dÃ¹ng key ${cfg.key_tail} â€” dÃ¡n key má»›i Ä‘á»ƒ thay` : 'DÃ¡n key AIzaâ€¦ vÃ o Ä‘Ã¢y'}
              className="h-8 w-72 text-[12px] font-mono" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Model</Label>
            <Input value={model || (cfg?.model ?? '')} onChange={e => setModel(e.target.value)}
              placeholder="gemini-flash-lite-latest" className="h-8 w-52 text-[12px] font-mono" />
          </div>
          <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700" disabled={busy || (!keyInput.trim() && !model.trim())}
            onClick={() => { setMsg(null); saveMut.mutate({ ...(keyInput.trim() ? { api_key: keyInput.trim() } : {}), ...(model.trim() ? { model: model.trim() } : {}) }) }}>
            {saveMut.isPending ? 'Äang lÆ°uâ€¦' : 'LÆ°u'}
          </Button>
          <Button size="sm" variant="outline" className="h-8" disabled={busy || !cfg?.configured}
            onClick={() => { setMsg(null); testMut.mutate() }}>
            {testMut.isPending ? 'Äang thá»­â€¦' : 'Kiá»ƒm tra'}
          </Button>
          {cfg?.configured && (
            <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50" disabled={busy}
              onClick={() => { setMsg(null); saveMut.mutate({ api_key: null }) }}>
              Gá»¡ key
            </Button>
          )}
        </div>
        {msg && (
          <div className={`rounded px-2 py-1.5 text-[12px] ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>
        )}
      </div>
    </div>
  )
}

type Confirm = { action: 'revoke' | 'delete'; ids: string[] }

export default function IntegrationKeys() {
  const user = useAuthStore(s => s.user)
  const admin = isAdmin(user)
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(ALL_SCOPES)
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: keys = [], isLoading } = useQuery<ApiKeyRow[]>({
    queryKey: ['integration-keys'],
    queryFn: () => apiClient.get('/wms/integration-keys').then(r => r.data.data),
    enabled: admin,
  })

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/wms/integration-keys', { name: name.trim(), scopes }).then(r => r.data.data as { name: string; key: string }),
    onSuccess: (data) => {
      setCreatedKey({ name: data.name, key: data.key })
      setShowForm(false); setName(''); setScopes(ALL_SCOPES); setErr(null)
      qc.invalidateQueries({ queryKey: ['integration-keys'] })
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const toggleScope = (k: string) => setScopes(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])
  const toggleReveal = (id: string) => setRevealed(p => ({ ...p, [id]: !p[id] }))
  const toggleSelect = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = keys.length > 0 && keys.every(k => selected.has(k.id))
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(keys.map(k => k.id)))

  async function copyText(text: string | null, id: string) {
    if (!text) return
    try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(c => c === id ? null : c), 1800) } catch { /* clipboard bá»‹ cháº·n */ }
  }

  // Thu há»“i / XÃ³a â€” cháº¡y song song cho nhiá»u id (bulk) hoáº·c 1 id.
  async function runConfirm() {
    if (!confirm) return
    setBusy(true); setErr(null)
    try {
      await Promise.all(confirm.ids.map(id =>
        confirm.action === 'revoke'
          ? apiClient.patch(`/wms/integration-keys/${id}/revoke`)
          : apiClient.delete(`/wms/integration-keys/${id}`)
      ))
      setSelected(new Set()); setConfirm(null)
      qc.invalidateQueries({ queryKey: ['integration-keys'] })
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  if (!admin) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-slate-500">
        <div className="text-center"><ShieldAlert className="mx-auto h-8 w-8 text-slate-300 mb-2" />Chá»‰ Admin Ä‘Æ°á»£c quáº£n lÃ½ API key tÃ­ch há»£p.</div>
      </div>
    )
  }

  const baseUrl = `${window.location.origin}/api/integration/v1`
  const selArr = keys.filter(k => selected.has(k.id))
  const selActive = selArr.filter(k => k.is_active)
  const selRevoked = selArr.filter(k => !k.is_active)
  const confirmActive = confirm?.action === 'revoke'

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <KeyRound className="h-4 w-4 text-slate-500" /> Káº¿t ná»‘i ERP â€” API Key
          </span>
          <span className="hidden md:inline text-[11px] text-slate-400">ERP gá»i <code className="text-slate-500">{baseUrl}/â€¦</code> kÃ¨m header <code className="text-slate-500">X-API-Key</code></span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setShowHelp(true)}>
            <BookOpen className="h-4 w-4 mr-1" /> HÆ°á»›ng dáº«n API
          </Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { setErr(null); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Táº¡o key
          </Button>
        </div>

        {/* Thanh bulk khi chá»n nhiá»u */}
        {selected.size > 0 && (
          <div className="border-b bg-sky-50 px-3 py-2 flex items-center gap-2 flex-wrap text-[12px]">
            <span className="font-medium text-sky-800">ÄÃ£ chá»n {selected.size}</span>
            <Button size="sm" variant="outline" className="text-amber-700 border-amber-300" disabled={selActive.length === 0}
              onClick={() => setConfirm({ action: 'revoke', ids: selActive.map(k => k.id) })}>
              <Ban className="h-3.5 w-3.5 mr-1" /> Thu há»“i ({selActive.length} Ä‘ang dÃ¹ng)
            </Button>
            <Button size="sm" variant="outline" className="text-red-700 border-red-300" disabled={selRevoked.length === 0}
              onClick={() => setConfirm({ action: 'delete', ids: selRevoked.map(k => k.id) })}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> XÃ³a ({selRevoked.length} Ä‘Ã£ thu há»“i)
            </Button>
            <button className="text-slate-500 hover:underline ml-1" onClick={() => setSelected(new Set())}>Bá» chá»n</button>
          </div>
        )}

        {/* Banner: key vá»«a táº¡o â€” hiá»‡n Ä‘áº§y Ä‘á»§, cÃ³ ChÃ©p */}
        {createdKey && (
          <div className="border-b bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
            <div className="font-semibold flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" /> Key "{createdKey.name}" vá»«a táº¡o â€” chÃ©p ngay Ä‘á»ƒ gá»­i ERP</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-white border border-amber-200 px-2 py-1 font-mono text-[12px]">{createdKey.key}</code>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => copyText(createdKey.key, 'banner')}>
                {copiedId === 'banner' ? <><Check className="h-3.5 w-3.5 mr-1 text-green-600" />ÄÃ£ chÃ©p</> : <><Copy className="h-3.5 w-3.5 mr-1" />ChÃ©p</>}
              </Button>
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setCreatedKey(null)}>áº¨n</Button>
            </div>
          </div>
        )}

        {err && <div className="border-b bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</div>}

        {/* Báº£ng */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 px-2 py-1.5 bg-slate-50">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600 align-middle" checked={allSelected} onChange={toggleSelectAll} aria-label="Chá»n táº¥t cáº£" />
                </TableHead>
                {['TÃªn', 'Key', 'Pháº¡m vi', 'Tráº¡ng thÃ¡i', 'Láº§n dÃ¹ng cuá»‘i', 'NgÃ y táº¡o', 'NgÆ°á»i táº¡o', ''].map((h, i) => (
                  <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap bg-slate-50">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="px-2 py-6 text-center text-slate-400 text-xs">Äang táº£iâ€¦</TableCell></TableRow>
              ) : keys.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="px-2 py-6 text-center text-slate-400 text-xs">ChÆ°a cÃ³ API key nÃ o. Báº¥m "Táº¡o key" Ä‘á»ƒ cáº¥p cho ERP.</TableCell></TableRow>
              ) : keys.map(k => {
                const isRev = !!revealed[k.id]
                return (
                  <TableRow key={k.id} className={`${selected.has(k.id) ? 'bg-sky-50' : ''} ${k.is_active ? '' : 'text-slate-400'}`}>
                    <TableCell className="px-2 py-1 align-top">
                      <input type="checkbox" className="h-4 w-4 accent-blue-600 align-middle" checked={selected.has(k.id)} onChange={() => toggleSelect(k.id)} aria-label={`Chá»n ${k.name}`} />
                    </TableCell>
                    <TableCell className={`px-2 py-1 text-[11px] whitespace-nowrap font-medium ${k.is_active ? '' : 'line-through'}`}>{k.name}</TableCell>
                    {/* Key: máº·c Ä‘á»‹nh che, nÃºt máº¯t reveal + nÃºt chÃ©p; reveal hiá»‡n FULL khÃ´ng bá»‹ cáº¯t */}
                    <TableCell className="px-2 py-1 align-top">
                      {k.key ? (
                        <div className="flex items-start gap-1">
                          <code className={`font-mono text-[11px] ${isRev ? 'break-all whitespace-normal max-w-[260px]' : 'whitespace-nowrap'}`}>
                            {isRev ? k.key : `${k.key_prefix ?? 'wms_'}â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢`}
                          </code>
                          <button className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100" title={isRev ? 'áº¨n' : 'Hiá»‡n key'} onClick={() => toggleReveal(k.id)}>
                            {isRev ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="ChÃ©p key" onClick={() => copyText(k.key, k.id)}>
                            {copiedId === k.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">{k.key_prefix ?? 'â€”'}â€¦ <span className="italic">(key cÅ©, khÃ´ng xem láº¡i Ä‘Æ°á»£c)</span></span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{(k.scopes ?? []).join(', ') || 'â€”'}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${k.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                        {k.is_active ? 'Äang dÃ¹ng' : 'ÄÃ£ thu há»“i'}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{k.last_used_at ? formatDateTime(k.last_used_at) : <span className="text-slate-300">chÆ°a dÃ¹ng</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{k.created_at ? formatDateTime(k.created_at) : 'â€”'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{k.created_by ?? 'â€”'}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {k.is_active ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-amber-700 hover:text-amber-800 hover:bg-amber-50" onClick={() => { setErr(null); setConfirm({ action: 'revoke', ids: [k.id] }) }}>
                          <Ban className="h-3.5 w-3.5 mr-1" /> Thu há»“i
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => { setErr(null); setConfirm({ action: 'delete', ids: [k.id] }) }}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> XÃ³a
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-400 shrink-0">{keys.length} key{selected.size > 0 ? ` Â· Ä‘Ã£ chá»n ${selected.size}` : ''}</div>
      </div>

      {/* AI Vision â€” key Gemini cho Sá»• Ä‘Ã³ng gÃ³i (Ä‘áº·t cÃ¹ng trang káº¿t ná»‘i Ä‘á»ƒ Admin thay khi háº¿t háº¡n) */}
      <VisionConfigCard />

      {/* Form táº¡o key */}
      <FormSheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Táº¡o API key cho ERP"
        description="Má»—i ERP nÃªn 1 key riÃªng Ä‘á»ƒ thu há»“i Ä‘á»™c láº­p. Key xem/chÃ©p láº¡i Ä‘Æ°á»£c á»Ÿ cá»™t Key (chá»‰ Admin)."
        footer={<>
          <Button variant="outline" onClick={() => setShowForm(false)} disabled={createMut.isPending}>Huá»·</Button>
          <Button className="bg-blue-600 hover:bg-blue-700" disabled={createMut.isPending || !name.trim() || scopes.length === 0}
            onClick={() => createMut.mutate()}>{createMut.isPending ? 'Äang táº¡oâ€¦' : 'Táº¡o key'}</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>TÃªn key <span className="text-red-500">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="VD: SAP-production, FAST-test" />
            <p className="text-[11px] text-slate-400">NhÃ£n Ä‘á»ƒ nháº­n diá»‡n â€” nÃªn ghi rÃµ ERP + mÃ´i trÆ°á»ng.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Pháº¡m vi Ä‘á»c <span className="text-red-500">*</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {SCOPE_OPTS.map(s => (
                <label key={s.key} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px] cursor-pointer ${scopes.includes(s.key) ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={scopes.includes(s.key)} onChange={() => toggleScope(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
            <div className="flex gap-3 text-[11px]">
              <button type="button" className="text-blue-600 hover:underline" onClick={() => setScopes(ALL_SCOPES)}>Chá»n táº¥t cáº£</button>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => setScopes([])}>Bá» chá»n</button>
            </div>
            <p className="text-[11px] text-slate-400">Key chá»‰ Ä‘á»c Ä‘Æ°á»£c nhÃ³m dá»¯ liá»‡u Ä‘Ã£ tick. Äá»c-only, KHÃ”NG ghi ngÆ°á»£c vÃ o WMS.</p>
          </div>
          {createMut.isError && <div className="rounded bg-red-50 px-2 py-1.5 text-[12px] text-red-700">{errMsg(createMut.error)}</div>}
        </div>
      </FormSheet>

      {/* XÃ¡c nháº­n thu há»“i / xÃ³a (1 hoáº·c nhiá»u) */}
      <Dialog open={!!confirm} onOpenChange={v => { if (!v && !busy) setConfirm(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{confirmActive ? 'Thu há»“i API key?' : 'XÃ³a háº³n API key?'}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            {confirmActive
              ? <>Thu há»“i <span className="font-semibold">{confirm?.ids.length} key</span> â€” ERP Ä‘ang dÃ¹ng sáº½ <span className="font-semibold text-red-600">máº¥t káº¿t ná»‘i ngay</span>.</>
              : <>XÃ³a háº³n <span className="font-semibold">{confirm?.ids.length} key</span> Ä‘Ã£ thu há»“i khá»i há»‡ thá»‘ng. <span className="font-semibold text-red-600">KhÃ´ng hoÃ n tÃ¡c Ä‘Æ°á»£c.</span></>}
          </p>
          {err && <div className="rounded bg-red-50 px-2 py-1.5 text-[12px] text-red-700">{err}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Huá»·</Button>
            <Button className={confirmActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'} disabled={busy} onClick={runConfirm}>
              {busy ? 'Äang xá»­ lÃ½â€¦' : (confirmActive ? 'Thu há»“i' : 'XÃ³a háº³n')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HÆ°á»›ng dáº«n API â€” tÃ i liá»‡u tÃ­ch há»£p ERP */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-600" /> HÆ°á»›ng dáº«n káº¿t ná»‘i ERP (pull API)</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 text-[13px] text-slate-700 leading-relaxed">
            {/* 1. Tá»•ng quan */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">API nÃ y Ä‘á»ƒ lÃ m gÃ¬?</h3>
              <p>
                Cá»•ng <b>chá»‰-Ä‘á»c (read-only)</b> Ä‘á»ƒ ERP bÃªn ngoÃ i (SAP, FASTâ€¦) <b>tá»± gá»i vÃ o</b> láº¥y dá»¯ liá»‡u WMS vá»:
                mÃ£ hÃ ng, tá»“n kho (kÃ¨m mÃ£ lÃ´ + HSD), phiáº¿u nháº­p, phiáº¿u xuáº¥t, lá»‹ch sá»­ quÃ©t. WMS <b>khÃ´ng</b> ghi ngÆ°á»£c sang ERP â€”
                ERP chá»§ Ä‘á»™ng Ä‘á»“ng bá»™ theo lá»‹ch cá»§a há». Má»—i Ä‘Æ¡n vá»‹ cÃ³ <b>URL + key riÃªng</b> (dá»¯ liá»‡u cÃ¡ch ly tuyá»‡t Ä‘á»‘i).
              </p>
            </section>

            {/* 2. Base URL + xÃ¡c thá»±c */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">1 Â· Äá»‹a chá»‰ &amp; xÃ¡c thá»±c</h3>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 break-all rounded bg-slate-900 text-slate-100 px-2 py-1.5 font-mono text-[12px]">{baseUrl}</code>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => copyText(baseUrl, 'doc-url')}>
                  {copiedId === 'doc-url' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p>Má»i request gáº¯n header <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">X-API-Key: &lt;key&gt;</code> (key táº¡o á»Ÿ nÃºt "Táº¡o key"). Sai/thu há»“i key â†’ <code className="font-mono">401</code>; thiáº¿u pháº¡m vi â†’ <code className="font-mono">403</code>.</p>
            </section>

            {/* 3. Endpoints */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">2 Â· CÃ¡c endpoint (Ä‘á»u lÃ  <code className="font-mono text-[12px]">GET</code>)</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">ÄÆ°á»ng dáº«n</th>
                      <th className="px-2 py-1.5 text-left font-medium">Dá»¯ liá»‡u</th>
                      <th className="px-2 py-1.5 text-left font-medium">Pháº¡m vi (scope)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ENDPOINT_DOCS.map(e => (
                      <tr key={e.path} className="border-t align-top">
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap text-slate-700">{e.path}</td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium text-slate-700">{e.label}</div>
                          <div className="text-[11px] text-slate-400">{e.fields}</div>
                        </td>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap text-slate-500">{e.scope}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. Tham sá»‘ */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">3 Â· Tham sá»‘ truy váº¥n (query)</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="font-mono text-[12px]">updated_since</code> â€” ISO 8601 (vd <code className="font-mono">2026-01-01T00:00:00Z</code>). Chá»‰ láº¥y báº£n ghi thay Ä‘á»•i tá»« má»‘c nÃ y (Ä‘á»“ng bá»™ <b>delta</b>). Bá» trá»‘ng = láº¥y tá»« Ä‘áº§u.</li>
                <li><code className="font-mono text-[12px]">limit</code> â€” sá»‘ dÃ²ng/trang, máº·c Ä‘á»‹nh <b>500</b>, tá»‘i Ä‘a <b>1000</b>.</li>
                <li><code className="font-mono text-[12px]">cursor</code> â€” con trá» trang káº¿ (láº¥y tá»« <code className="font-mono">next_cursor</code> cá»§a pháº£n há»“i trÆ°á»›c). ÄÃ£ tá»± nhá»› cáº£ má»‘c <code className="font-mono">updated_since</code> nÃªn cÃ¡c trang sau <b>chá»‰ cáº§n truyá»n cursor</b>.</li>
              </ul>
            </section>

            {/* 5. Pháº£n há»“i + phÃ¢n trang */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">4 Â· Pháº£n há»“i &amp; phÃ¢n trang</h3>
              <pre className="overflow-x-auto rounded bg-slate-900 text-slate-100 px-3 py-2 font-mono text-[11px] leading-snug">{`{
  "success": true,
  "data": [ { ... }, { ... } ],
  "paging": { "count": 500, "has_more": true, "next_cursor": "eyJ..." }
}`}</pre>
              <p>Láº·p: gá»i endpoint â†’ xá»­ lÃ½ <code className="font-mono">data</code> â†’ náº¿u <code className="font-mono">next_cursor</code> khÃ¡c <code className="font-mono">null</code> thÃ¬ gá»i láº¡i kÃ¨m <code className="font-mono">?cursor=&lt;next_cursor&gt;</code>, tá»›i khi <code className="font-mono">next_cursor = null</code>. Láº§n sync sau Ä‘áº·t <code className="font-mono">updated_since</code> = <code className="font-mono">updated_at</code> lá»›n nháº¥t Ä‘Ã£ nháº­n.</p>
            </section>

            {/* 6. VÃ­ dá»¥ */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">5 Â· VÃ­ dá»¥ (curl)</h3>
              <div className="flex items-start gap-2">
                <pre className="flex-1 min-w-0 overflow-x-auto rounded bg-slate-900 text-slate-100 px-3 py-2 font-mono text-[11px] leading-snug">{`curl -H "X-API-Key: <KEY>" \\
  "${baseUrl}/inventory?updated_since=2026-01-01T00:00:00Z&limit=500"`}</pre>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => copyText(`curl -H "X-API-Key: <KEY>" "${baseUrl}/inventory?updated_since=2026-01-01T00:00:00Z&limit=500"`, 'doc-curl')}>
                  {copiedId === 'doc-curl' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHelp(false)}>ÄÃ³ng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
