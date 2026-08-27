// Bối cảnh Kho / Loại kho TOÀN CỤC (kiểu Infor CloudSuite — user chốt 19/08): chọn 1 lần ở
// Header → "quét" vào MỌI slice filter có Kho/Loại kho trong wmsFilterStore (đúng tên field +
// ngữ nghĩa giá trị từng trang), form tạo mới cũng lấy làm mặc định. '' = Tất cả.
// Lưu localStorage bền, scope theo user.id qua scopedPersist (như saved-views).
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useWmsFilterStore } from './wmsFilterStore'

export interface GlobalScope {
  warehouseId: string     // '' = tất cả kho trong scope
  warehouseCode: string   // mirror mã kho — slice khvc lọc theo warehouse_code, không phải uuid
  whType: string          // '' = tất cả loại kho (giá trị = LookupValue warehouse_type, vd FG01)
}

interface GlobalScopeState extends GlobalScope {
  setScope: (s: GlobalScope) => void
  reset: () => void
}

export const GLOBAL_SCOPE_BASE = 'wms-global-scope'

export const useGlobalScopeStore = create<GlobalScopeState>()(
  persist(
    (set) => ({
      warehouseId: '', warehouseCode: '', whType: '',
      setScope: (s) => set(s),
      reset: () => set({ warehouseId: '', warehouseCode: '', whType: '' }),
    }),
    { name: GLOBAL_SCOPE_BASE, storage: createJSONStorage(() => localStorage) },
  ),
)

// Quét bối cảnh vào các slice filter. `force=true` (đổi tay ở Header) ghi CẢ giá trị rỗng —
// chọn "Tất cả" nghĩa là xoá lọc Kho/Loại kho các trang; `force=false` (đăng nhập / mở app)
// chỉ áp phần ĐANG CHỌN, không xoá lựa chọn đã nhớ của trang khi bối cảnh để Tất cả.
// KHÔNG quét doSap.plant (mã plant SAP, không phải kho WMS) và tmsTransfer.khoNhan (kho nhận
// là phía đối tác — bối cảnh chỉ áp kho XUẤT).
export function sweepGlobalScope(scope: GlobalScope, opts: { force: boolean }) {
  const wid = scope.warehouseId
  const wt  = scope.whType
  const s = useWmsFilterStore.getState()
  const one = (v: string) => (v ? [v] : [])

  if (opts.force || wid !== '') {
    s.setDashboard({ warehouseId: wid })
    s.setWarehouseCost({ warehouseId: wid, page: 1 })
    s.setAssignment({ warehouseId: wid })
    s.setOutboundPrepare({ warehouseId: wid })
    s.setAlerts({ warehouseId: wid })
    s.setForklift({ warehouseId: wid })
    s.setPacking({ warehouseId: wid, page: 1, runPage: 1 })
    s.setWeighTickets({ warehouse_ids: one(wid) })
    s.setTmsTransfer({ khoXuat: one(wid) })
    s.setUserAdmin({ warehouseId: wid || '__all__', page: 1 })   // slice duy nhất sentinel '__all__'
    s.setAttendanceTeam({ warehouseId: wid, page: 1 })
    s.setLeave({ warehouseId: wid, page: 1 })
    s.setKhvc({ warehouse: scope.warehouseCode, page: 1 })
    s.setFill({ warehouseId: wid, page: 1 })
    s.setStocktakeCycle({ warehouseId: wid })
    s.setSlotting({ warehouseId: wid })
    s.setScanLog({ warehouses: one(wid) })
    s.setOutbound({ warehouseId: wid, page: 1 })
    s.setInbound({ warehouseId: wid, page: 1 })
    s.setLoosePicking({ warehouseId: wid, page: 1 })
    s.setGateRegistration({ fWarehouse: wid })
    s.setInboundReport({ warehouseId: wid })
    s.setTmsBookings({ warehouseId: wid, page: 1 })
    s.setControlTower({ warehouse_ids: one(wid) })
    // đổi Kho ⇒ lọc PHỤ THUỘC KHO (khu vực / vị trí thuộc kho cũ) phải reset kèm
    s.setLocations({ warehouseId: wid, zoneFilter: [], page: 1 })
    s.setStocktake({ warehouseId: wid, locationId: '' })
    s.setStocktakeSummary({ warehouseId: wid, locationIds: [], page: 1 })
    s.setStocktakeHistory({ warehouseId: wid, locationIds: [], page: 1 })
    s.setMoveLog({ warehouseId: wid, page: 1 })
    s.setInventory({ warehouseIds: one(wid), filterLocations: [], page: 1 })
  }
  if (opts.force || wt !== '') {
    s.setOutbound({ filterWarehouseTypes: one(wt), page: 1 })
    s.setInbound({ materialCategory: wt, page: 1 })
    s.setInventory({ materialCategories: one(wt), page: 1 })
    s.setLoosePicking({ filterWarehouseTypes: one(wt), page: 1 })
    s.setScanLog({ material_category: wt })
    s.setControlTower({ categories: one(wt) })
    s.setStocktakeCycle({ cats: one(wt) })
    s.setSlotting({ categories: one(wt) })
    s.setFill({ cats: one(wt), page: 1 })
    s.setStocktake({ category: wt })
    s.setStocktakeSummary({ category: wt, page: 1 })
    s.setStocktakeHistory({ category: wt, page: 1 })
    s.setMoveLog({ category: wt, page: 1 })
    s.setLocations({ catFilter: wt, page: 1 })
    s.setGateRegistration({ fWarehouseType: wt })
    s.setMaterials({ catFilter: one(wt), page: 1 })
    s.setInboundReport({ selCategories: one(wt) })
    s.setTmsBookings({ loaiKho: one(wt), page: 1 })
  }
}
