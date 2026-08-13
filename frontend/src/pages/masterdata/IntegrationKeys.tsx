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
  { key: 'materials:read', label: 'Mã hàng' },
  { key: 'inventory:read', label: 'Tồn kho' },
  { key: 'inbound:read',   label: 'Phiếu nhập' },
  { key: 'outbound:read',  label: 'Phiếu xuất' },
  { key: 'scans:read',     label: 'Lịch sử quét' },
  { key: 'weigh:write',    label: 'Trạm cân (đẩy phiếu cân vào)' },
]
const ALL_SCOPES = SCOPE_OPTS.map(s => s.key)

// Tài liệu 5 endpoint (khớp backend/src/routes/integration.ts + exportController.ts).
const ENDPOINT_DOCS: { path: string; scope: string; label: string; fields: string }[] = [
  { path: '/materials',        scope: 'materials:read', label: 'Mã hàng',      fields: 'material_code, material_description, short_name, category, product_type, unit, cartons_per_pallet, units_per_carton, shelf_life_days, batch_prefix, is_active' },
  { path: '/inventory',        scope: 'inventory:read', label: 'Tồn kho',      fields: 'pallet_code, batch (mã lô), expiry_date (HSD), production_date, material_code, warehouse_id, location_id, cartons_imported, cartons_remaining, cartons_reserved, status, ncc_id, import_date' },
  { path: '/inbound-receipts', scope: 'inbound:read',   label: 'Phiếu nhập',   fields: 'import_code, material_code, warehouse_id, warehouse_type, planned_cartons, planned_pallets, status, source_type, ncc_id, import_date' },
  { path: '/outbound-orders',  scope: 'outbound:read',  label: 'Phiếu xuất',   fields: 'group_code, planned_date, delivery_date, warehouse_id, warehouse_type, dvvt, shipto_party, license_plate, status, transfer_status, completed_at' },
  { path: '/scan-entries',     scope: 'scans:read',     label: 'Lịch sử quét', fields: 'item_id, inventory_entry_id, pallet_code, cartons_scanned, production_date, pct_date, is_loose_picking, scanned_at, scanned_by' },
  { path: '/weigh/tickets (POST)', scope: 'weigh:write', label: 'Phiếu cân (agent trạm cân ĐẨY VÀO)', fields: 'station_code + tickets[] (cột gốc WeightForm của PM cân: id, OrderNum, GDate, TruckNum, Tare/Gross/NetWeight, TareTime/GrossTime, ImExType…)' },
]
const errMsg = (e: unknown) =>
  (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Có lỗi xảy ra, thử lại'

// ─── AI Vision (Sổ đóng gói) — key Gemini đặt Ở ĐÂY để "hết hạn thì thay" (user chốt 12/08) ──
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
      setKeyInput(''); setMsg({ kind: 'ok', text: d.configured ? 'Đã lưu — bấm "Kiểm tra" để thử key' : 'Đã gỡ key — app quay về OCR thường' })
      qc.invalidateQueries({ queryKey: ['vision-config'] })
    },
    onError: (e) => setMsg({ kind: 'err', text: errMsg(e) }),
  })
  const testMut = useMutation({
    mutationFn: () => apiClient.post('/wms/vision-config/test').then(r => r.data.data as { model: string; latency_ms: number }),
    onSuccess: (d) => setMsg({ kind: 'ok', text: `Key hoạt động — ${d.model} phản hồi ${d.latency_ms}ms` }),
    onError: (e) => setMsg({ kind: 'err', text: errMsg(e) }),
  })

  const busy = saveMut.isPending || testMut.isPending
  return (
    <div className="shrink-0 mt-3 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm border-t sm:border-t-slate-200">
      <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-500" /> AI Vision — đọc chữ in phun (Sổ đóng gói)
        </span>
        {cfg && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${cfg.configured ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
            {cfg.configured ? `Đang dùng · ${cfg.model} · key ${cfg.key_tail}` : 'Chưa cấu hình — đang dùng OCR thường'}
          </span>
        )}
      </div>
      <div className="px-3 py-2.5 space-y-2 text-[12px] text-slate-600">
        <p>
          Ảnh chụp date thùng sẽ được đọc bằng <b>Google Gemini</b> (chính xác hơn hẳn OCR với chữ nghiêng/nhỏ).
          Key lỗi / hết quota / chưa cấu hình → app <b>tự rơi về OCR thường</b>, công nhân không bị chặn.
          Tạo key <b>miễn phí</b> tại <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">aistudio.google.com/apikey</a> (Google
          AI Studio — bậc free ~1.000 ảnh/ngày, không cần thẻ; sản lượng lớn thì gắn billing vào project là hết trần, ~4–5đ/ảnh). Hết hạn/bị khóa → dán key mới vào đây là xong.
          Model mặc định <code className="font-mono text-[11px]">gemini-flash-lite-latest</code> tự trỏ bản mới nhất; model nghỉ hưu → hệ thống <b>tự dò model sống</b> và lưu lại.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label className="text-[11px]">API key (Gemini)</Label>
            <Input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
              placeholder={cfg?.configured ? `Đang dùng key ${cfg.key_tail} — dán key mới để thay` : 'Dán key AIza… vào đây'}
              className="h-8 w-72 text-[12px] font-mono" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Model</Label>
            <Input value={model || (cfg?.model ?? '')} onChange={e => setModel(e.target.value)}
              placeholder="gemini-flash-lite-latest" className="h-8 w-52 text-[12px] font-mono" />
          </div>
          <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700" disabled={busy || (!keyInput.trim() && !model.trim())}
            onClick={() => { setMsg(null); saveMut.mutate({ ...(keyInput.trim() ? { api_key: keyInput.trim() } : {}), ...(model.trim() ? { model: model.trim() } : {}) }) }}>
            {saveMut.isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
          <Button size="sm" variant="outline" className="h-8" disabled={busy || !cfg?.configured}
            onClick={() => { setMsg(null); testMut.mutate() }}>
            {testMut.isPending ? 'Đang thử…' : 'Kiểm tra'}
          </Button>
          {cfg?.configured && (
            <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50" disabled={busy}
              onClick={() => { setMsg(null); saveMut.mutate({ api_key: null }) }}>
              Gỡ key
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
    try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(c => c === id ? null : c), 1800) } catch { /* clipboard bị chặn */ }
  }

  // Thu hồi / Xóa — chạy song song cho nhiều id (bulk) hoặc 1 id.
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
        <div className="text-center"><ShieldAlert className="mx-auto h-8 w-8 text-slate-300 mb-2" />Chỉ Admin được quản lý API key tích hợp.</div>
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
            <KeyRound className="h-4 w-4 text-slate-500" /> Kết nối ERP — API Key
          </span>
          <span className="hidden md:inline text-[11px] text-slate-400">ERP gọi <code className="text-slate-500">{baseUrl}/…</code> kèm header <code className="text-slate-500">X-API-Key</code></span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setShowHelp(true)}>
            <BookOpen className="h-4 w-4 mr-1" /> Hướng dẫn API
          </Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { setErr(null); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Tạo key
          </Button>
        </div>

        {/* Thanh bulk khi chọn nhiều */}
        {selected.size > 0 && (
          <div className="border-b bg-sky-50 px-3 py-2 flex items-center gap-2 flex-wrap text-[12px]">
            <span className="font-medium text-sky-800">Đã chọn {selected.size}</span>
            <Button size="sm" variant="outline" className="text-amber-700 border-amber-300" disabled={selActive.length === 0}
              onClick={() => setConfirm({ action: 'revoke', ids: selActive.map(k => k.id) })}>
              <Ban className="h-3.5 w-3.5 mr-1" /> Thu hồi ({selActive.length} đang dùng)
            </Button>
            <Button size="sm" variant="outline" className="text-red-700 border-red-300" disabled={selRevoked.length === 0}
              onClick={() => setConfirm({ action: 'delete', ids: selRevoked.map(k => k.id) })}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Xóa ({selRevoked.length} đã thu hồi)
            </Button>
            <button className="text-slate-500 hover:underline ml-1" onClick={() => setSelected(new Set())}>Bỏ chọn</button>
          </div>
        )}

        {/* Banner: key vừa tạo — hiện đầy đủ, có Chép */}
        {createdKey && (
          <div className="border-b bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
            <div className="font-semibold flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" /> Key "{createdKey.name}" vừa tạo — chép ngay để gửi ERP</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-white border border-amber-200 px-2 py-1 font-mono text-[12px]">{createdKey.key}</code>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => copyText(createdKey.key, 'banner')}>
                {copiedId === 'banner' ? <><Check className="h-3.5 w-3.5 mr-1 text-green-600" />Đã chép</> : <><Copy className="h-3.5 w-3.5 mr-1" />Chép</>}
              </Button>
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setCreatedKey(null)}>Ẩn</Button>
            </div>
          </div>
        )}

        {err && <div className="border-b bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</div>}

        {/* Bảng */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 px-2 py-1.5 bg-slate-50">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600 align-middle" checked={allSelected} onChange={toggleSelectAll} aria-label="Chọn tất cả" />
                </TableHead>
                {['Tên', 'Key', 'Phạm vi', 'Trạng thái', 'Lần dùng cuối', 'Ngày tạo', 'Người tạo', ''].map((h, i) => (
                  <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap bg-slate-50">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="px-2 py-6 text-center text-slate-400 text-xs">Đang tải…</TableCell></TableRow>
              ) : keys.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="px-2 py-6 text-center text-slate-400 text-xs">Chưa có API key nào. Bấm "Tạo key" để cấp cho ERP.</TableCell></TableRow>
              ) : keys.map(k => {
                const isRev = !!revealed[k.id]
                return (
                  <TableRow key={k.id} className={`${selected.has(k.id) ? 'bg-sky-50' : ''} ${k.is_active ? '' : 'text-slate-400'}`}>
                    <TableCell className="px-2 py-1 align-top">
                      <input type="checkbox" className="h-4 w-4 accent-blue-600 align-middle" checked={selected.has(k.id)} onChange={() => toggleSelect(k.id)} aria-label={`Chọn ${k.name}`} />
                    </TableCell>
                    <TableCell className={`px-2 py-1 text-[11px] whitespace-nowrap font-medium ${k.is_active ? '' : 'line-through'}`}>{k.name}</TableCell>
                    {/* Key: mặc định che, nút mắt reveal + nút chép; reveal hiện FULL không bị cắt */}
                    <TableCell className="px-2 py-1 align-top">
                      {k.key ? (
                        <div className="flex items-start gap-1">
                          <code className={`font-mono text-[11px] ${isRev ? 'break-all whitespace-normal max-w-[260px]' : 'whitespace-nowrap'}`}>
                            {isRev ? k.key : `${k.key_prefix ?? 'wms_'}••••••••`}
                          </code>
                          <button className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100" title={isRev ? 'Ẩn' : 'Hiện key'} onClick={() => toggleReveal(k.id)}>
                            {isRev ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Chép key" onClick={() => copyText(k.key, k.id)}>
                            {copiedId === k.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">{k.key_prefix ?? '—'}… <span className="italic">(key cũ, không xem lại được)</span></span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{(k.scopes ?? []).join(', ') || '—'}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${k.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                        {k.is_active ? 'Đang dùng' : 'Đã thu hồi'}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{k.last_used_at ? formatDateTime(k.last_used_at) : <span className="text-slate-300">chưa dùng</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{k.created_at ? formatDateTime(k.created_at) : '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{k.created_by ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {k.is_active ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-amber-700 hover:text-amber-800 hover:bg-amber-50" onClick={() => { setErr(null); setConfirm({ action: 'revoke', ids: [k.id] }) }}>
                          <Ban className="h-3.5 w-3.5 mr-1" /> Thu hồi
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => { setErr(null); setConfirm({ action: 'delete', ids: [k.id] }) }}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Xóa
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-400 shrink-0">{keys.length} key{selected.size > 0 ? ` · đã chọn ${selected.size}` : ''}</div>
      </div>

      {/* AI Vision — key Gemini cho Sổ đóng gói (đặt cùng trang kết nối để Admin thay khi hết hạn) */}
      <VisionConfigCard />

      {/* Form tạo key */}
      <FormSheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Tạo API key cho ERP"
        description="Mỗi ERP nên 1 key riêng để thu hồi độc lập. Key xem/chép lại được ở cột Key (chỉ Admin)."
        footer={<>
          <Button variant="outline" onClick={() => setShowForm(false)} disabled={createMut.isPending}>Huỷ</Button>
          <Button className="bg-blue-600 hover:bg-blue-700" disabled={createMut.isPending || !name.trim() || scopes.length === 0}
            onClick={() => createMut.mutate()}>{createMut.isPending ? 'Đang tạo…' : 'Tạo key'}</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tên key <span className="text-red-500">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="VD: SAP-production, FAST-test" />
            <p className="text-[11px] text-slate-400">Nhãn để nhận diện — nên ghi rõ ERP + môi trường.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Phạm vi đọc <span className="text-red-500">*</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {SCOPE_OPTS.map(s => (
                <label key={s.key} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px] cursor-pointer ${scopes.includes(s.key) ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={scopes.includes(s.key)} onChange={() => toggleScope(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
            <div className="flex gap-3 text-[11px]">
              <button type="button" className="text-blue-600 hover:underline" onClick={() => setScopes(ALL_SCOPES)}>Chọn tất cả</button>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => setScopes([])}>Bỏ chọn</button>
            </div>
            <p className="text-[11px] text-slate-400">Key chỉ đọc được nhóm dữ liệu đã tick. Đọc-only, KHÔNG ghi ngược vào WMS.</p>
          </div>
          {createMut.isError && <div className="rounded bg-red-50 px-2 py-1.5 text-[12px] text-red-700">{errMsg(createMut.error)}</div>}
        </div>
      </FormSheet>

      {/* Xác nhận thu hồi / xóa (1 hoặc nhiều) */}
      <Dialog open={!!confirm} onOpenChange={v => { if (!v && !busy) setConfirm(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{confirmActive ? 'Thu hồi API key?' : 'Xóa hẳn API key?'}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            {confirmActive
              ? <>Thu hồi <span className="font-semibold">{confirm?.ids.length} key</span> — ERP đang dùng sẽ <span className="font-semibold text-red-600">mất kết nối ngay</span>.</>
              : <>Xóa hẳn <span className="font-semibold">{confirm?.ids.length} key</span> đã thu hồi khỏi hệ thống. <span className="font-semibold text-red-600">Không hoàn tác được.</span></>}
          </p>
          {err && <div className="rounded bg-red-50 px-2 py-1.5 text-[12px] text-red-700">{err}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Huỷ</Button>
            <Button className={confirmActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'} disabled={busy} onClick={runConfirm}>
              {busy ? 'Đang xử lý…' : (confirmActive ? 'Thu hồi' : 'Xóa hẳn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hướng dẫn API — tài liệu tích hợp ERP */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-600" /> Hướng dẫn kết nối ERP (pull API)</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 text-[13px] text-slate-700 leading-relaxed">
            {/* 1. Tổng quan */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">API này để làm gì?</h3>
              <p>
                Cổng <b>chỉ-đọc (read-only)</b> để ERP bên ngoài (SAP, FAST…) <b>tự gọi vào</b> lấy dữ liệu WMS về:
                mã hàng, tồn kho (kèm mã lô + HSD), phiếu nhập, phiếu xuất, lịch sử quét. WMS <b>không</b> ghi ngược sang ERP —
                ERP chủ động đồng bộ theo lịch của họ. Mỗi đơn vị có <b>URL + key riêng</b> (dữ liệu cách ly tuyệt đối).
              </p>
            </section>

            {/* 2. Base URL + xác thực */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">1 · Địa chỉ &amp; xác thực</h3>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 break-all rounded bg-slate-900 text-slate-100 px-2 py-1.5 font-mono text-[12px]">{baseUrl}</code>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => copyText(baseUrl, 'doc-url')}>
                  {copiedId === 'doc-url' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p>Mọi request gắn header <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">X-API-Key: &lt;key&gt;</code> (key tạo ở nút "Tạo key"). Sai/thu hồi key → <code className="font-mono">401</code>; thiếu phạm vi → <code className="font-mono">403</code>.</p>
            </section>

            {/* 3. Endpoints */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">2 · Các endpoint (đều là <code className="font-mono text-[12px]">GET</code>)</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Đường dẫn</th>
                      <th className="px-2 py-1.5 text-left font-medium">Dữ liệu</th>
                      <th className="px-2 py-1.5 text-left font-medium">Phạm vi (scope)</th>
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

            {/* 4. Tham số */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">3 · Tham số truy vấn (query)</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="font-mono text-[12px]">updated_since</code> — ISO 8601 (vd <code className="font-mono">2026-01-01T00:00:00Z</code>). Chỉ lấy bản ghi thay đổi từ mốc này (đồng bộ <b>delta</b>). Bỏ trống = lấy từ đầu.</li>
                <li><code className="font-mono text-[12px]">limit</code> — số dòng/trang, mặc định <b>500</b>, tối đa <b>1000</b>.</li>
                <li><code className="font-mono text-[12px]">cursor</code> — con trỏ trang kế (lấy từ <code className="font-mono">next_cursor</code> của phản hồi trước). Đã tự nhớ cả mốc <code className="font-mono">updated_since</code> nên các trang sau <b>chỉ cần truyền cursor</b>.</li>
              </ul>
            </section>

            {/* 5. Phản hồi + phân trang */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">4 · Phản hồi &amp; phân trang</h3>
              <pre className="overflow-x-auto rounded bg-slate-900 text-slate-100 px-3 py-2 font-mono text-[11px] leading-snug">{`{
  "success": true,
  "data": [ { ... }, { ... } ],
  "paging": { "count": 500, "has_more": true, "next_cursor": "eyJ..." }
}`}</pre>
              <p>Lặp: gọi endpoint → xử lý <code className="font-mono">data</code> → nếu <code className="font-mono">next_cursor</code> khác <code className="font-mono">null</code> thì gọi lại kèm <code className="font-mono">?cursor=&lt;next_cursor&gt;</code>, tới khi <code className="font-mono">next_cursor = null</code>. Lần sync sau đặt <code className="font-mono">updated_since</code> = <code className="font-mono">updated_at</code> lớn nhất đã nhận.</p>
            </section>

            {/* 6. Ví dụ */}
            <section className="space-y-1.5">
              <h3 className="font-semibold text-slate-800">5 · Ví dụ (curl)</h3>
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
            <Button variant="outline" onClick={() => setShowHelp(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
