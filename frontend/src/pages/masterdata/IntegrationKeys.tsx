import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { KeyRound, Plus, Ban, Copy, Check, ShieldAlert, Eye, EyeOff, Trash2 } from 'lucide-react'
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
]
const ALL_SCOPES = SCOPE_OPTS.map(s => s.key)
const errMsg = (e: unknown) =>
  (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Có lỗi xảy ra, thử lại'

type Confirm = { action: 'revoke' | 'delete'; ids: string[] }

export default function IntegrationKeys() {
  const user = useAuthStore(s => s.user)
  const admin = isAdmin(user?.name)
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
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
    </div>
  )
}
