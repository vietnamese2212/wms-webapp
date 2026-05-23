import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, Trash2, Warehouse, Tag, Settings2, MapPin } from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useWarehouses, useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse,
  useWarehouseTypes, useAddWarehouseType, useUpdateWarehouseType, useDeleteWarehouseType,
  useWarehouseZones, useCreateWarehouseZone, useUpdateWarehouseZone, useDeleteWarehouseZone,
  type WarehouseZone,
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
        { id: wh.id, name: name.trim(), address: address.trim() || undefined, is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { code: code.trim(), name: name.trim(), address: address.trim() || undefined },
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
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BV, BB, HN…" disabled={isEdit} />
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

// ─── Zone Dialog ──────────────────────────────────────────────────────────────

function ZoneDialog({ zone, warehouseId, warehouses, open, onClose }: {
  zone: WarehouseZone | null; warehouseId: string; warehouses: WhRow[]; open: boolean; onClose: () => void
}) {
  const isEdit = !!zone
  const [selectedWhId, setSelectedWhId] = useState(zone?.warehouse_id ?? warehouseId)
  const [code, setCode] = useState(zone?.code ?? '')
  const [name, setName] = useState(zone?.name ?? '')
  const [isActive, setIsActive] = useState(zone?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateWarehouseZone()
  const { mutate: update, isPending: updating } = useUpdateWarehouseZone()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!isEdit && !selectedWhId) { setErr('Chọn kho là bắt buộc'); return }
    if (!code.trim() || !name.trim()) { setErr('Mã và tên khu vực là bắt buộc'); return }
    if (isEdit) {
      update(
        { id: zone.id, name: name.trim(), is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { warehouse_id: selectedWhId, code: code.trim(), name: name.trim() },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa khu vực' : 'Thêm khu vực kho'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          {isEdit ? (
            <div className="space-y-1">
              <Label className="text-xs">Kho</Label>
              <p className="text-sm font-medium text-slate-700">
                {warehouses.find(w => w.id === zone.warehouse_id)?.name ?? '—'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Kho *</Label>
              <Select value={selectedWhId || '__none__'} onValueChange={v => setSelectedWhId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Chọn kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Chọn kho</SelectItem>
                  {warehouses.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Mã khu vực *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="TP, NL, POSM…" disabled={isEdit} />
            {!isEdit && <p className="text-[10px] text-slate-400">Mã ngắn, không dấu. VD: TP, NVL, POSM, BB</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tên khu vực *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Thành phẩm, NVL, POSM, Bao bì…" />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="zone-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="zone-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim() || (!isEdit && !selectedWhId)}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Type Dialog ─────────────────────────────────────────────────────────────

function TypeDialog({ type, open, onClose }: {
  type: { id: string; value: string } | null; open: boolean; onClose: () => void
}) {
  const isEdit = !!type
  const [value, setValue] = useState(type?.value ?? '')
  const [err, setErr] = useState('')

  const { mutate: add,    isPending: adding    } = useAddWarehouseType()
  const { mutate: update, isPending: updating  } = useUpdateWarehouseType()
  const isPending = adding || updating

  function handleSubmit() {
    setErr('')
    if (!value.trim()) { setErr('Tên loại kho là bắt buộc'); return }
    if (isEdit) {
      update({ id: type.id, value: value.trim() }, { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      add(value.trim(), { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa loại kho' : 'Thêm loại kho'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Tên loại kho *</Label>
            <Input value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="Thành phẩm, NVL, POSM…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !value.trim()}>
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
  const { mutate: deleteType, isPending: deletingType }  = useDeleteWarehouseType()
  const [editingType, setEditingType] = useState<{ id: string; value: string } | null>(null)
  const [showTypeDlg, setShowTypeDlg] = useState(false)

  // Khu vực kho
  const activeWh = (allWh as WhRow[]).filter(w => w.is_active)
  const [selectedWhId, setSelectedWhId] = useState('')
  const effectiveWhId = selectedWhId || activeWh[0]?.id || ''
  const { data: zones = [], isLoading: loadingZones } = useWarehouseZones(effectiveWhId || undefined)
  const { mutate: deleteZone, isPending: deletingZone } = useDeleteWarehouseZone()
  const [editingZone, setEditingZone] = useState<WarehouseZone | null>(null)
  const [showZoneDlg, setShowZoneDlg] = useState(false)

  function handleDeleteWh(wh: WhRow) {
    if (!confirm(`Xóa kho "${wh.name}"?\nChỉ xóa được kho chưa có vị trí nào.`)) return
    deleteWh(wh.id, { onError: e => alert(apiMsg(e)) })
  }

  function handleDeleteZone(z: WarehouseZone) {
    if (!confirm(`Xóa khu vực "${z.code} – ${z.name}"?`)) return
    deleteZone(z.id, { onError: e => alert(apiMsg(e)) })
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-slate-500" />
          Cài đặt WMS
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Kho, loại kho, khu vực kho — master data dùng chung cho toàn hệ thống</p>
      </div>

      <Tabs defaultValue="warehouses">
        <TabsList className="mb-2">
          <TabsTrigger value="warehouses" className="gap-1.5"><Warehouse className="h-3.5 w-3.5" /> Kho</TabsTrigger>
          <TabsTrigger value="types"      className="gap-1.5"><Tag      className="h-3.5 w-3.5" /> Loại kho</TabsTrigger>
          <TabsTrigger value="zones"      className="gap-1.5"><MapPin   className="h-3.5 w-3.5" /> Khu vực kho</TabsTrigger>
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
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Danh sách loại kho — dùng cho phân loại vị trí, mã hàng, phân quyền nhân viên và đăng ký vận chuyển TMS.
            </p>
            {canManage && (
              <Button size="sm" className="gap-1.5 shrink-0" onClick={() => { setEditingType(null); setShowTypeDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm loại kho
              </Button>
            )}
          </div>

          <Card>
            {loadingTypes ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
              warehouseTypes.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Tag className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Chưa có loại kho nào</p>
                  {canManage && <p className="text-xs">Nhấn "Thêm loại kho" để tạo loại kho đầu tiên</p>}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-3 py-2 text-xs">Tên loại kho</TableHead>
                        {canManage && <TableHead className="px-3 py-2 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {warehouseTypes.map(t => (
                        <TableRow key={t.id} className="text-sm">
                          <TableCell className="px-3 py-2 font-medium text-slate-800">{t.value}</TableCell>
                          {canManage && (
                            <TableCell className="px-2 py-2">
                              <div className="flex items-center gap-0.5">
                                <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                  onClick={() => { setEditingType(t); setShowTypeDlg(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                  disabled={deletingType}
                                  onClick={() => { if (confirm(`Xóa loại kho "${t.value}"?`)) deleteType(t.id) }}>
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
              )
            }
          </Card>
        </TabsContent>

        {/* ── Tab: Khu vực kho ── */}
        <TabsContent value="zones" className="space-y-3">
          <p className="text-xs text-slate-500">
            Khu vực kho phân chia vị trí vật lý trong từng kho — VD: Kho BV có khu TP (Thành phẩm), NVL, POSM.
          </p>

          {/* Chọn kho */}
          <div className="flex items-center gap-2">
            <Label className="text-xs shrink-0 text-slate-500">Kho:</Label>
            <Select value={effectiveWhId} onValueChange={setSelectedWhId}>
              <SelectTrigger className="h-8 text-sm w-48">
                <SelectValue placeholder="Chọn kho" />
              </SelectTrigger>
              <SelectContent>
                {activeWh.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManage && (
              <Button size="sm" className="gap-1.5 ml-auto" onClick={() => { setEditingZone(null); setShowZoneDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm khu vực
              </Button>
            )}
          </div>

          <Card>
            {!effectiveWhId ? (
              <div className="p-8 text-center text-sm text-slate-400">Chọn kho để xem khu vực</div>
            ) : loadingZones ? (
              <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
            ) : zones.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <MapPin className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm">Kho này chưa có khu vực nào</p>
                {canManage && <p className="text-xs">Nhấn "Thêm khu vực" để tạo khu vực đầu tiên</p>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-xs">Mã khu vực</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Tên khu vực</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      {canManage && <TableHead className="px-3 py-2 w-16" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zones.map(z => (
                      <TableRow key={z.id} className={`text-sm ${!z.is_active ? 'opacity-50' : ''}`}>
                        <TableCell className="px-3 py-2 font-mono font-semibold text-[11px] text-slate-600">{z.code}</TableCell>
                        <TableCell className="px-3 py-2 font-medium text-slate-800">{z.name}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={z.is_active ? 'default' : 'secondary'} className="text-xs">
                            {z.is_active ? 'Hoạt động' : 'Tạm dừng'}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="px-2 py-2">
                            <div className="flex items-center gap-0.5">
                              <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                onClick={() => { setEditingZone(z); setShowZoneDlg(true) }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                disabled={deletingZone}
                                onClick={() => handleDeleteZone(z)}>
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
      </Tabs>

      {showWhDlg && (
        <WarehouseDialog wh={editingWh} open={showWhDlg} onClose={() => setShowWhDlg(false)} />
      )}
      {showTypeDlg && (
        <TypeDialog type={editingType} open={showTypeDlg} onClose={() => setShowTypeDlg(false)} />
      )}
      {showZoneDlg && (
        <ZoneDialog zone={editingZone} warehouseId={effectiveWhId} warehouses={activeWh} open={showZoneDlg} onClose={() => setShowZoneDlg(false)} />
      )}
    </div>
  )
}
