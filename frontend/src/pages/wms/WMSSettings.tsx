import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, Trash2, Warehouse, Tag, Settings2 } from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useWarehouses, useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse,
  useWarehouseTypes, useAddWarehouseType, useDeleteWarehouseType,
} from '@/api/hooks'
import { can, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ─── Warehouse Dialog ─────────────────────────────────────────────────────────

interface WhRow { id: string; code: string; name: string; address: string | null; is_active: boolean }

function WarehouseDialog({ wh, open, onClose }: { wh: WhRow | null; open: boolean; onClose: () => void }) {
  const isEdit = !!wh
  const [code,     setCode]     = useState(wh?.code ?? '')
  const [name,     setName]     = useState(wh?.name ?? '')
  const [address,  setAddress]  = useState(wh?.address ?? '')
  const [isActive, setIsActive] = useState(wh?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateWarehouse()
  const { mutate: update, isPending: updating } = useUpdateWarehouse()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('Mã và tên kho là bắt buộc'); return }
    if (isEdit) {
      update(
        { id: wh.id, code: code.trim(), name: name.trim(), address: address.trim() || null, is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { code: code.trim(), name: name.trim(), address: address.trim() || null },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa kho' : 'Thêm kho'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Mã kho *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BV, BB, HN…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tên kho *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Kho Ba Vì, Kho Bàu Bàng…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Địa chỉ</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="wh-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="wh-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WMSSettings() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canManage = can(perms, 'wms_settings', 'manage')

  // Kho
  const { data: allWh = [], isLoading: loadingWh } = useWarehouses(false)
  const { mutate: deleteWh, isPending: deletingWh } = useDeleteWarehouse()
  const [editingWh, setEditingWh] = useState<WhRow | null>(null)
  const [showWhDlg, setShowWhDlg] = useState(false)

  // Loại kho
  const { data: warehouseTypes = [], isLoading: loadingTypes } = useWarehouseTypes()
  const { mutate: addType,    isPending: addingType }    = useAddWarehouseType()
  const { mutate: deleteType, isPending: deletingType }  = useDeleteWarehouseType()
  const [newTypeName, setNewTypeName] = useState('')
  const [typeErr,     setTypeErr]     = useState('')

  function handleAddType() {
    setTypeErr('')
    const val = newTypeName.trim()
    if (!val) return
    addType(val, {
      onSuccess: () => setNewTypeName(''),
      onError:   e  => setTypeErr(apiMsg(e)),
    })
  }

  function handleDeleteWh(wh: WhRow) {
    if (!confirm(`Xóa kho "${wh.name}"?\nChỉ xóa được kho chưa có vị trí nào.`)) return
    deleteWh(wh.id, { onError: e => alert(apiMsg(e)) })
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-slate-500" />
          Cài đặt WMS
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Kho, loại kho — master data dùng chung cho toàn hệ thống</p>
      </div>

      <Tabs defaultValue="warehouses">
        <TabsList className="mb-2">
          <TabsTrigger value="warehouses" className="gap-1.5"><Warehouse className="h-3.5 w-3.5" /> Kho</TabsTrigger>
          <TabsTrigger value="types"      className="gap-1.5"><Tag      className="h-3.5 w-3.5" /> Loại kho</TabsTrigger>
        </TabsList>

        {/* ── Tab: Kho ── */}
        <TabsContent value="warehouses" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{(allWh as WhRow[]).length} kho</p>
            {canManage && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingWh(null); setShowWhDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm kho
              </Button>
            )}
          </div>
          <Card>
            {loadingWh ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-xs">Mã</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Tên kho</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Địa chỉ</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      {canManage && <TableHead className="px-3 py-2 w-16" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(allWh as WhRow[]).map(wh => (
                      <TableRow key={wh.id} className={`text-sm ${!wh.is_active ? 'opacity-50' : ''}`}>
                        <TableCell className="px-3 py-2 font-mono font-semibold text-[11px] text-slate-600">{wh.code}</TableCell>
                        <TableCell className="px-3 py-2 font-medium text-slate-800">{wh.name}</TableCell>
                        <TableCell className="px-3 py-2 text-slate-500 text-xs">{wh.address ?? '—'}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={wh.is_active ? 'default' : 'secondary'} className="text-xs">
                            {wh.is_active ? 'Hoạt động' : 'Tạm dừng'}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="px-2 py-2">
                            <div className="flex items-center gap-0.5">
                              <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                onClick={() => { setEditingWh(wh); setShowWhDlg(true) }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                disabled={deletingWh}
                                onClick={() => handleDeleteWh(wh)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Tab: Loại kho ── */}
        <TabsContent value="types" className="space-y-3">
          <p className="text-xs text-slate-500">
            Danh sách loại kho — dùng cho phân loại vị trí, mã hàng, phân quyền nhân viên và đăng ký vận chuyển TMS.
          </p>

          {canManage && (
            <div className="flex gap-2 items-start">
              <div className="flex-1 max-w-xs space-y-1">
                {typeErr && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{typeErr}</p>}
                <Input
                  value={newTypeName}
                  onChange={e => setNewTypeName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddType() }}
                  placeholder="Tên loại kho mới…"
                  className="h-8 text-sm"
                />
              </div>
              <Button size="sm" className="gap-1.5 shrink-0" onClick={handleAddType}
                disabled={addingType || !newTypeName.trim()}>
                <Plus className="h-4 w-4" /> Thêm
              </Button>
            </div>
          )}

          <Card>
            {loadingTypes ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
              warehouseTypes.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Tag className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Chưa có loại kho nào</p>
                  {canManage && <p className="text-xs">Nhập tên và nhấn "Thêm" để tạo loại kho đầu tiên</p>}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-3 py-2 text-xs">Tên loại kho</TableHead>
                        {canManage && <TableHead className="px-3 py-2 w-12" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {warehouseTypes.map(t => (
                        <TableRow key={t.id} className="text-sm">
                          <TableCell className="px-3 py-2 font-medium text-slate-800">{t.value}</TableCell>
                          {canManage && (
                            <TableCell className="px-2 py-2">
                              <button
                                className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                disabled={deletingType}
                                onClick={() => { if (confirm(`Xóa loại kho "${t.value}"?`)) deleteType(t.id) }}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            }
          </Card>
        </TabsContent>
      </Tabs>

      {showWhDlg && (
        <WarehouseDialog wh={editingWh} open={showWhDlg} onClose={() => setShowWhDlg(false)} />
      )}
    </div>
  )
}
