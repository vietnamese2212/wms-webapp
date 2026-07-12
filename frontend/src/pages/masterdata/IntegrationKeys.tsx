import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { KeyRound, Plus, Ban, Copy, Check, ShieldAlert } from 'lucide-react'
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
  id: string; name: string; key_prefix: string | null; scopes: string[]
  is_active: boolean; last_used_at: string | null; created_at: string | null; created_by: string | null
}

// Scope đọc theo từng nhóm dữ liệu — khớp requireApiKey ở backend.
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

export default function IntegrationKeys() {
  const user = useAuthStore(s => s.user)
  const admin = isAdmin(user?.name)
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(ALL_SCOPES)
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const { data: keys = [], isLoading } = useQuery<ApiKeyRow[]>({
    queryKey: ['integration-keys'],
    queryFn: () => apiClient.get('/wms/integration-keys').then(r => r.data.data),
    enabled: admin,
  })

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/wms/integration-keys', { name: name.trim(), scopes }).then(r => r.data.data as { name: string; key: string }),
    onSuccess: (data) => {
      setCreatedKey({ name: data.name, key: data.key }); setCopied(false)
      setShowForm(false); setName(''); setScopes(ALL_SCOPES); setErr(null)
      qc.invalidateQueries({ queryKey: ['integration-keys'] })
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/wms/integration-keys/${id}/revoke`).then(r => r.data.data),
    onSuccess: () => { setRevokeTarget(null); qc.invalidateQueries({ queryKey: ['integration-keys'] }) },
    onError: (e) => setErr(errMsg(e)),
  })

  const toggleScope = (k: string) =>
    setScopes(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])

  const copyKey = async () => {
    if (!createdKey) return
    try { await navigator.clipboard.writeText(createdKey.key); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard bị chặn */ }
  }

  if (!admin) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-slate-500">
        <div className="text-center"><ShieldAlert className="mx-auto h-8 w-8 text-slate-300 mb-2" />Chỉ Admin được quản lý API key tích hợp.</div>
      </div>
    )
  }

  const baseUrl = `${window.location.origin}/api/integration/v1`

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

        {/* Banner: key vừa tạo — hiện 1 lần */}
        {createdKey && (
          <div className="border-b bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
            <div className="font-semibold flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" /> Key "{createdKey.name}" — LƯU NGAY, hệ thống KHÔNG hiện lại</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-white border border-amber-200 px-2 py-1 font-mono text-[12px]">{createdKey.key}</code>
              <Button size="sm" variant="outline" className="shrink-0" onClick={copyKey}>
                {copied ? <><Check className="h-3.5 w-3.5 mr-1 text-green-600" />Đã chép</> : <><Copy className="h-3.5 w-3.5 mr-1" />Chép</>}
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
                {['Tên', 'Mã key', 'Phạm vi', 'Trạng thái', 'Lần dùng cuối', 'Ngày tạo', 'Người tạo', ''].map((h, i) => (
                  <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap bg-slate-50">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="px-2 py-6 text-center text-slate-400 text-xs">Đang tải…</TableCell></TableRow>
              ) : keys.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="px-2 py-6 text-center text-slate-400 text-xs">Chưa có API key nào. Bấm "Tạo key" để cấp cho ERP.</TableCell></TableRow>
              ) : keys.map(k => (
                <TableRow key={k.id} className={k.is_active ? '' : 'text-slate-400 line-through'}>
                  <TableCell className="px-2 py-1 text-[11px] whitespace-nowrap font-medium">{k.name}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">{k.key_prefix ?? '—'}…</TableCell>
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
                    {k.is_active && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 no-underline" onClick={() => { setErr(null); setRevokeTarget(k) }}>
                        <Ban className="h-3.5 w-3.5 mr-1" /> Thu hồi
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-400 shrink-0">{keys.length} key</div>
      </div>

      {/* Form tạo key */}
      <FormSheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Tạo API key cho ERP"
        description="Key thô hiện 1 lần duy nhất sau khi tạo. Mỗi ERP nên 1 key riêng để thu hồi độc lập."
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

      {/* Xác nhận thu hồi */}
      <Dialog open={!!revokeTarget} onOpenChange={v => { if (!v) setRevokeTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Thu hồi API key?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Thu hồi key <span className="font-semibold">"{revokeTarget?.name}"</span> — mọi ERP đang dùng key này sẽ <span className="font-semibold text-red-600">mất kết nối ngay</span>. Không hoàn tác được.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={revokeMut.isPending}>Huỷ</Button>
            <Button className="bg-red-600 hover:bg-red-700" disabled={revokeMut.isPending}
              onClick={() => revokeTarget && revokeMut.mutate(revokeTarget.id)}>{revokeMut.isPending ? 'Đang thu hồi…' : 'Thu hồi'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
