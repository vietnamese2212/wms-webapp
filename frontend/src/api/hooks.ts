import { useQuery, useMutation, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query'
import {
  mockInventory, mockTransactions, mockVehicles,
  mockEmployees,
  mockLocations,
} from '@/utils/mockData'
import { apiClient } from './client'
import { toast } from '@/components/ui/use-toast'
import { suppressTmsOrdersRealtime } from './realtimeEvents'
import { useActiveInboundStore } from '@/stores/activeInboundStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import type { InboundOrder, PalletEntry, Department, JobTitle, EmployeeRecord, GDO, InventoryEntry, TmsVehicleType, SlotTemplate, TransportCompany, TmsVehicle } from '@/types'
import type { WhTypeMeta } from '@/utils/cargoCategory'

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms))

// ─── MASTERDATA (gọi API thật) ────────────────────────────────

export function useWarehouses(onlyActive = false) {
  return useQuery({
    queryKey: ['warehouses', onlyActive],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/warehouses', {
        params: onlyActive ? { active: 'true' } : {},
      })
      return data.data as any[]
    },
  })
}

type LocationListParams = { warehouse_id?: string; sub_code?: string; category?: string; material_id?: string; search?: string; limit?: number }

/**
 * Vị trí kho — MẶC ĐỊNH bản GỌN (`view=lite`): bỏ audit + join Kho + đếm tồn tổng.
 * Đo 27/07: 1 kho 1.517 vị trí = 938KB. Trang Vị trí kho (list + form Sửa) dùng
 * `useLocationsFull()`; ô chọn vị trí dùng `search` + `limit` (tìm trên server).
 */
export function useLocationsReal(params?: LocationListParams, enabled = true) {
  return useQuery({
    queryKey: ['locations-real', 'lite', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations', { params: { ...params, view: 'lite' } })
      return data.data as any[]
    },
  })
}

/** Bản ĐỦ CỘT (kèm Kho + audit) — trang Vị trí kho. */
export function useLocationsFull(params?: LocationListParams, enabled = true) {
  return useQuery({
    queryKey: ['locations-real', 'full', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations', { params })
      return data.data as any[]
    },
  })
}

// ─── Trang DANH MỤC Vị trí kho: phân trang SERVER ───────────────────────────────────────────────
// 1 kho có thể vài nghìn vị trí; tổng (sức chứa / đang dùng / đầy) tính bằng SQL trên toàn bộ lọc.
// flag / pick_face = BA trạng thái: undefined (không lọc) · true (có cờ) · false (chưa có cờ)
export type LocationsListParams = {
  warehouse_id?: string; category?: string; search?: string; zones?: string[]
  flag?: boolean; pick_face?: boolean; include_inactive?: boolean
}
export type LocationsSummary = { count: number; capacity: number; used: number; full: number }

// Kiểu trả `Record<keyof LocationsListParams, …>` là RÀNG BUỘC CỐ Ý: thêm field lọc mới mà quên
// ánh xạ xuống query-string = LỖI BIÊN DỊCH. (Bug 04/08: `pick_face` không có ở đây nên bị bỏ
// âm thầm — chip lọc bật, danh sách vẫn đủ 1.517 dòng, không lỗi nào để lần ra.)
// EXPORT vì mọi chỗ tự gọi GET /masterdata/locations (vd Xuất Excel) PHẢI dùng chung bản map
// này — tự dựng params bằng tay là tái diễn đúng bug trên ở một đường khác.
export function locationsQp(p: LocationsListParams): Record<keyof LocationsListParams, string | undefined> {
  const tri = (v?: boolean) => (v === undefined ? undefined : v ? '1' : '0')
  return {
    warehouse_id: p.warehouse_id || undefined, category: p.category || undefined,
    search: p.search || undefined,
    zones: p.zones?.length ? p.zones.join(',') : undefined,
    flag: tri(p.flag), pick_face: tri(p.pick_face),
    include_inactive: p.include_inactive ? '1' : undefined,
  }
}

export function useLocationsPaged(params: (LocationsListParams & { page: number; page_size: number }) | undefined) {
  const qp = params ? { ...locationsQp(params), page: params.page, page_size: params.page_size } : undefined
  return useQuery({
    queryKey: ['locations-paged', qp],
    enabled: !!params,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations', { params: qp })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data.data as { rows: any[]; total: number }
    },
  })
}

export function useLocationsSummary(params?: LocationsListParams) {
  const qp = params ? locationsQp(params) : undefined
  return useQuery({
    queryKey: ['locations-summary', qp],
    enabled: !!params,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations/summary', { params: qp })
      return data.data as LocationsSummary
    },
  })
}

// ─── Pallet label prints (truy vết in tem) ───────────────────
export type PalletPrintRow = {
  id: string; batch_id: string | null; qr_code: string; material_code: string | null; category: string | null
  cycle: string | null; machine: string | null; seq: string | null; nmsx: string | null
  qty: number | null; mode: string; printed_by_name: string | null; created_at: string
}
export function useLogPalletPrints() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { mode: 'GENERATE' | 'REPRINT'; labels: Record<string, unknown>[] }) =>
      apiClient.post('/wms/pallet-prints', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet-prints'] }),
  })
}
// Lịch sử in tem — phân trang theo PHIẾU IN. Mọi bộ lọc phải đi xuống server: lọc trên tập đã
// tải = lọc trong 1 trang (ra thiếu), còn ô chọn thì chỉ liệt kê giá trị của trang đó.
export type PalletPrintsPageParams = {
  date_from?: string; date_to?: string; search?: string
  modes?: string; material_codes?: string; cycles?: string; machines?: string; printers?: string
  page?: number; page_size?: number
}
export type PalletPrintsPage = {
  rows: PalletPrintRow[]
  total: number        // số PHIẾU IN khớp bộ lọc (đơn vị trang)
  total_rows: number   // số TEM khớp bộ lọc
  new_n: number; reprint_n: number
  page: number; page_size: number
}
export type PalletPrintFacets = {
  modes: string[]; materials: string[]; cycles: string[]
  machines: { v: string; c: string | null }[]; printers: string[]
}

export function usePalletPrintsPaged(params: PalletPrintsPageParams, enabled = true) {
  return useQuery({
    queryKey: ['pallet-prints-paged', params],
    enabled,
    queryFn: async () => {
      const q: Record<string, string> = {}
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q[k] = String(v)
      const { data } = await apiClient.get('/wms/pallet-prints', { params: q })
      return data.data as PalletPrintsPage
    },
    placeholderData: keepPreviousData,
  })
}

export function usePalletPrintFacets(params: { date_from?: string; date_to?: string; search?: string }, enabled = true) {
  return useQuery({
    queryKey: ['pallet-print-facets', params],
    enabled,
    queryFn: async () => {
      const q: Record<string, string> = {}
      for (const [k, v] of Object.entries(params)) if (v) q[k] = String(v)
      const { data } = await apiClient.get('/wms/pallet-prints/facets', { params: q })
      return data.data as PalletPrintFacets
    },
  })
}

export function usePalletPrints(params: { qr_code?: string; qr_codes?: string; search?: string; date_from?: string; date_to?: string; categories?: string; cycles?: string; machines?: string; nmsx?: string; material_codes?: string }, enabled = true) {
  return useQuery({
    queryKey: ['pallet-prints', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/pallet-prints', { params })
      return data.data as PalletPrintRow[]
    },
  })
}

// ── Dồn / Tách pallet ──
function useInvalidateInventory() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['inventory-entries'] })
    qc.invalidateQueries({ queryKey: ['inventory-facets'] })
    qc.invalidateQueries({ queryKey: ['inventory'] })
  }
}
export function useMergePallets() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { target_pallet_code: string; child_pallet_codes: string[]; warehouse_id?: string }) =>
      apiClient.post('/wms/pallet-ops/merge', body).then(r => r.data.data),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ['pallet-ops-log'] }) },
  })
}
export function useUngroupPallets() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { pallet_codes: string[]; warehouse_id?: string }) =>
      apiClient.post('/wms/pallet-ops/ungroup', body).then(r => r.data.data),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ['pallet-ops-log'] }) },
  })
}
export function useSplitPallet() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { source_pallet_code: string; children: { qty: number }[]; warehouse_id?: string; location_id?: string }) =>
      apiClient.post('/wms/pallet-ops/split', body).then(r => r.data.data as { source: string; source_remaining: number; children: InventoryEntry[] }),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ['pallet-ops-log'] }) },
  })
}

export type PalletOpRow = {
  id: string; type: string; source_codes: string[]; target_codes: string[]
  detail: any; operated_by_name: string | null; created_at: string
  undone_at: string | null; undone_by_name: string | null
}
export function usePalletOps(params: { search?: string; type?: string; warehouse_id?: string; date_from?: string; date_to?: string }, enabled = true) {
  return useQuery({
    queryKey: ['pallet-ops-log', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/pallet-ops', { params })
      return data.data as PalletOpRow[]
    },
  })
}
// Lịch sử dồn/tách — PHÂN TRANG SERVER. Đường không phân trang cắt âm thầm ở 5.000 thao tác
// (kho vài trăm lượt/ngày ⇒ chạm trần trong ~2 tuần). Lọc Loại kho cũng gửi xuống server:
// lọc ở client sau khi phân trang là lọc trên đúng 1 trang → số dòng và ô tổng đều sai.
export interface PalletOpsPage {
  items: PalletOpRow[]; total: number; merge_n: number; split_n: number; undone_n: number
  page: number; page_size: number
}
export function usePalletOpsPaged(
  params: { search?: string; type?: string; category?: string; warehouse_id?: string; date_from?: string; date_to?: string; page: number; page_size: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ['pallet-ops-paged', params],
    enabled,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/pallet-ops', { params })
      return data.data as PalletOpsPage
    },
  })
}
export function useUndoPalletOp() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/pallet-ops/${id}/undo`).then(r => r.data.data),
    onSuccess: () => {
      inv()
      qc.invalidateQueries({ queryKey: ['pallet-ops-log'] })
      qc.invalidateQueries({ queryKey: ['pallet-ops-paged'] })
    },
  })
}

export function useManufacturers() {
  return useQuery({
    queryKey: ['manufacturers'],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/manufacturers')
      return data.data as any[]
    },
  })
}

/**
 * Danh mục mã hàng — MẶC ĐỊNH bản GỌN (`view=lite`): đủ cột cho dropdown/tra cứu/tính số lượng,
 * bỏ cột chỉ trang Danh mục dùng (dims, khối lượng, ảnh, ghi chú, old_code, audit, NSX).
 * Đo 27/07: 2.740 mã = 2.566KB (full) → xem `MaterialLite` bên dưới. Trang Danh mục Mã hàng
 * gọi `useMaterialsFull()` để có đủ cột cho form Sửa.
 * `limit` = ô gõ tìm mã (typeahead) — chỉ lấy N dòng đầu, KHÔNG kéo cả danh mục.
 */
export type MaterialLite = Pick<import('@/types').Material,
  'id' | 'material_code' | 'material_description' | 'short_name' | 'product_type' | 'category'
  | 'is_active' | 'cartons_per_pallet' | 'pallet_per_ea' | 'units_per_carton' | 'base_unit'
  | 'entry_unit' | 'shelf_life_days' | 'no_qr_tracking' | 'is_non_stock' | 'is_pallet_carrier'
  | 'batch_prefix' | 'warehouse_pallet_overrides' | 'supplier_shelf_life_overrides'>

type MaterialListParams = { search?: string; manufacturer_id?: string; category?: string; limit?: number }

export function useMaterials(params?: MaterialListParams, enabled = true) {
  return useQuery({
    queryKey: ['materials', 'lite', params],
    enabled,
    // Danh mục mã hàng đổi ít → cache 5' để form Thêm/Sửa mở lại tức thì, không tải lại mỗi lần.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials', { params: { ...params, view: 'lite' } })
      return data.data as MaterialLite[]
    },
  })
}

/**
 * Tra mã hàng theo DANH SÁCH MÃ đang có trên màn (dán Excel / gõ tay) — thay cho việc nạp cả
 * danh mục để dựng map code→mã. Chunk 300 mã/lượt đúng trần URL của PostgREST.
 */
export function useMaterialsByCodes(codes: string[], enabled = true) {
  const key = [...new Set(codes.map(c => c.trim().toUpperCase()).filter(Boolean))].sort()
  return useQuery({
    queryKey: ['materials', 'by-codes', key],
    enabled: enabled && key.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out: MaterialLite[] = []
      for (let i = 0; i < key.length; i += 300) {
        const { data } = await apiClient.get('/masterdata/materials', {
          params: { codes: key.slice(i, i + 300).join(','), view: 'lite' },
        })
        out.push(...(data.data as MaterialLite[]))
      }
      return out
    },
  })
}

/**
 * Tra mã hàng theo DANH SÁCH ID — dùng cho NHÃN của filter "Tên hàng" đang được chọn.
 * Vì sao cần: ô chọn mã hàng TÌM TRÊN SERVER nên `options` chỉ chứa kết quả của từ khóa hiện tại.
 * Mã đã chọn mà không khớp từ khóa (hoặc từ khóa rỗng sau khi mở lại app — filter được NHỚ theo
 * user) sẽ không có nhãn để tra → FilterBar in giá trị thô, người dùng thấy chip là một chuỗi uuid
 * và bảng trống, tưởng mất dữ liệu. Chunk 300 đúng trần URL của PostgREST.
 */
export function useMaterialsByIds(ids: string[], enabled = true) {
  const key = [...new Set(ids.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['materials', 'by-ids', key],
    enabled: enabled && key.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out: MaterialLite[] = []
      for (let i = 0; i < key.length; i += 300) {
        const { data } = await apiClient.get('/masterdata/materials', {
          params: { ids: key.slice(i, i + 300).join(','), view: 'lite' },
        })
        out.push(...(data.data as MaterialLite[]))
      }
      return out
    },
  })
}

/**
 * Tra mã hàng theo mã, gọi TRỰC TIẾP trong handler (dán Excel): phải có kết quả TRƯỚC khi
 * điền dòng vì số lượng được quy đổi theo hệ số của mã (`qtyFromEntryBase`) — vá sau là ra số sai.
 * Dùng chung cache với `useMaterialsByCodes`.
 */
export async function fetchMaterialsByCodes(qc: QueryClient, codes: string[]): Promise<Map<string, MaterialLite>> {
  const key = [...new Set(codes.map(c => c.trim().toUpperCase()).filter(Boolean))].sort()
  if (key.length === 0) return new Map()
  const rows = await qc.fetchQuery({
    queryKey: ['materials', 'by-codes', key],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out: MaterialLite[] = []
      for (let i = 0; i < key.length; i += 300) {
        const { data } = await apiClient.get('/masterdata/materials', {
          params: { codes: key.slice(i, i + 300).join(','), view: 'lite' },
        })
        out.push(...(data.data as MaterialLite[]))
      }
      return out
    },
  })
  return new Map(rows.map(m => [String(m.material_code).trim().toUpperCase(), m]))
}

/** Bản ĐỦ CỘT — chỉ trang Danh mục Mã hàng (list + form Sửa) cần. */
export function useMaterialsFull(params?: MaterialListParams, enabled = true) {
  return useQuery({
    queryKey: ['materials', 'full', params],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials', { params })
      return data.data as import('@/types').Material[]
    },
  })
}

// ─── Trang DANH MỤC Mã hàng: phân trang SERVER ──────────────────────────────────────────────────
// Trang gốc cần đủ cột nhưng chỉ 1 trang. 2 luật "Trùng tên" / "Thiếu thông tin" tính bằng SQL
// trên TOÀN bảng (không suy được từ 200 dòng đang xem) — server gắn cờ `is_dup_name` per dòng.
export type MaterialsListParams = {
  search?: string; categories?: string[]; status?: string[]; qr?: string[]; dq?: string[]
}
export type MaterialsPage = { rows: (import('@/types').Material & { is_dup_name?: boolean })[]; total: number }
export type MaterialsSummary = { total: number; active: number; inactive: number; no_qr: number; incomplete: number; dup: number }

function materialsCsvParams(p: MaterialsListParams) {
  const j = (a?: string[]) => (a?.length ? a.join(',') : undefined)
  return { search: p.search || undefined, categories: j(p.categories), status: j(p.status), qr: j(p.qr), dq: j(p.dq) }
}

export function useMaterialsPaged(params: MaterialsListParams & { page: number; page_size: number }) {
  const qp = { ...materialsCsvParams(params), page: params.page, page_size: params.page_size }
  return useQuery({
    queryKey: ['materials-paged', qp],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials', { params: qp })
      return data.data as MaterialsPage
    },
  })
}

export function useMaterialsSummary(params: MaterialsListParams) {
  const qp = materialsCsvParams(params)
  return useQuery({
    queryKey: ['materials-summary', qp],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials/summary', { params: qp })
      return data.data as MaterialsSummary
    },
  })
}

export function useImportShifts() {
  return useQuery({
    queryKey: ['import-shifts'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/import-shifts')
      return data.data as import('@/types').ImportShift[]
    },
  })
}

export function useQAStatuses() {
  return useQuery({
    queryKey: ['qa-statuses'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/qa-statuses')
      return data.data as import('@/types').QAStatus[]
    },
  })
}

// Cờ hệ thống (SystemSetting — multi-tenant silo, cờ theo khác biệt). Đọc hở user đăng nhập; ghi = wms_settings.manage_system
export interface SystemSetting { key: string; value: unknown; updated_by: string | null; updated_at: string }
export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/settings')
      return data.data as SystemSetting[]
    },
  })
}
export function useUpdateSystemSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      apiClient.put(`/wms/settings/${key}`, { value }).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-settings'] }),
  })
}

// Ca nhập — tạo/sửa (gate wms_settings.manage_global ở BE)
export function useCreateImportShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; display_order?: number }) =>
      apiClient.post('/masterdata/import-shifts', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-shifts'] }),
  })
}
export function useUpdateImportShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; display_order?: number; is_active?: boolean }) =>
      apiClient.put(`/masterdata/import-shifts/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-shifts'] }),
  })
}

// Tình trạng QA — tạo/sửa (gate wms_settings.manage_global ở BE)
export function useCreateQAStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; display_order?: number }) =>
      apiClient.post('/masterdata/qa-statuses', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qa-statuses'] }),
  })
}
export function useUpdateQAStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; display_order?: number; is_active?: boolean }) =>
      apiClient.put(`/masterdata/qa-statuses/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qa-statuses'] }),
  })
}

// Mutations
export function useCreateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; address?: string; warehouse_type: string; inventory_mode?: string; shipto_codes?: string; nmsx_code?: string; parent_warehouse_id?: string | null; carton_scan_override?: boolean | null; carton_scan_categories?: string[] | null; carton_scan_require_full?: boolean; sap_plant?: string; sap_storage_locations?: string; require_weigh_on_start?: boolean; require_gate_on_start?: boolean }) =>
      apiClient.post('/masterdata/warehouses', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })
}

export function useUpdateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; address?: string; is_active?: boolean; warehouse_type?: string; inventory_mode?: string; shipto_codes?: string; nmsx_code?: string; parent_warehouse_id?: string | null; carton_scan_override?: boolean | null; carton_scan_categories?: string[] | null; carton_scan_require_full?: boolean; sap_plant?: string; sap_storage_locations?: string; require_weigh_on_start?: boolean; require_gate_on_start?: boolean }) =>
      apiClient.put(`/masterdata/warehouses/${id}`, body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })
}

export function useDeleteWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/masterdata/warehouses/${id}`).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })
}

export function useCreateLocation() {
  const qc = useQueryClient()
  return useMutation({
    // Loại của vị trí KẾ THỪA từ Khu vực (không gửi category — BE tự lấy từ zone)
    mutationFn: (body: { warehouse_id: string; sub_code: string; sub_name?: string; row: string; shelf?: string; max_pallets?: number }) =>
      apiClient.post('/masterdata/locations', body).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
    },
  })
}

export function useUpdateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; sub_name?: string; max_pallets?: number; is_active?: boolean; requires_stocktake?: boolean; is_pick_face?: boolean }) =>
      apiClient.put(`/masterdata/locations/${id}`, body).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['locations-paged'] })
      qc.invalidateQueries({ queryKey: ['locations-summary'] })
      qc.invalidateQueries({ queryKey: ['fill-demand'] })   // đổi cờ nhặt lẻ ⇒ đề xuất fill đổi theo
    },
  })
}

export function useDeleteLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/masterdata/locations/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
    },
  })
}

// Gắn/bỏ cờ "cần kiểm kê" hàng loạt cho nhiều vị trí (vị trí quan trọng)
export function useBulkFlagLocations() {
  const qc = useQueryClient()
  return useMutation({
    // Danh sách đã phân trang → gửi CỜ bộ lọc (`by_filter`) để BE tự resolve TOÀN BỘ vị trí khớp,
    // thay vì nhồi hàng nghìn id qua mạng. Vẫn nhận `ids` cho chỗ gọi cũ.
    // 2 cờ: requires_stocktake (cần kiểm kê) · is_pick_face (vị trí nhặt lẻ — nguồn của Fill hàng).
    // Gửi cờ nào thì BE ghi cờ đó; thiếu cả hai → 400 (không ghi mù).
    mutationFn: (body: { ids?: string[]; by_filter?: boolean; filter?: Record<string, unknown>
                         requires_stocktake?: boolean; is_pick_face?: boolean }) =>
      apiClient.patch('/masterdata/locations/bulk-flag', body).then((r) => r.data.data as { updated: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['locations-paged'] })
      qc.invalidateQueries({ queryKey: ['locations-summary'] })
      qc.invalidateQueries({ queryKey: ['fill-demand'] })   // khai vị trí nhặt lẻ ⇒ đề xuất fill đổi theo
    },
  })
}

export function useCreateMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      material_code: string; material_description: string
      custom_short_name?: string; category?: string; product_type?: string
      unit?: string; manufacturer_id?: string; notes?: string; old_code?: string
      weight_kg?: number | null; cartons_per_pallet?: number | null
      units_per_carton?: number | null; shelf_life_days?: number | null; no_qr_tracking?: boolean
      pallet_per_ea?: number | null
      warehouse_pallet_overrides?: import('@/types').WarehousePalletOverride[]
      supplier_shelf_life_overrides?: import('@/types').SupplierShelfLifeOverride[]
    }) => apiClient.post('/masterdata/materials', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  })
}

export function useUpdateMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; material_description?: string; custom_short_name?: string
      category?: string; product_type?: string; unit?: string
      manufacturer_id?: string; notes?: string; old_code?: string
      weight_kg?: number | null; cartons_per_pallet?: number | null
      units_per_carton?: number | null; shelf_life_days?: number | null
      is_active?: boolean; no_qr_tracking?: boolean; pallet_per_ea?: number | null
      carton_length_mm?: number | null; carton_width_mm?: number | null; carton_height_mm?: number | null
      max_stack_layers?: number | null; stack_on_top?: boolean
      warehouse_pallet_overrides?: import('@/types').WarehousePalletOverride[]
      supplier_shelf_life_overrides?: import('@/types').SupplierShelfLifeOverride[]
    }) => apiClient.put(`/masterdata/materials/${id}`, body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  })
}

export function useDeleteMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/masterdata/materials/${id}`).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  })
}

export function useCreateManufacturer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name?: string }) =>
      apiClient.post('/masterdata/manufacturers', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manufacturers'] }),
  })
}

// ─── WMS – Inbound Orders (API thật) ────────────────────────

// Helpers: persist query results to localStorage so data shows instantly on refresh/cold start
function lsGet<T>(key: string): T | undefined {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : undefined }
  catch { return undefined }
}
function lsSet(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
export function useInboundOrders(params?: { warehouse_id?: string; status?: string; search?: string; date?: string; date_from?: string; date_to?: string; shift_id?: string; material_category?: string; gate_registration_id?: string }) {
  return useQuery({
    queryKey: ['inbound-orders', params],
    // undefined = caller CHƯA sẵn điều kiện (quy ước cả 2 consumer) — không được fetch,
    // vì request không tham số kéo CẢ BẢNG (vượt trần 10k → 400 khi dữ liệu lớn, đo 27/07)
    enabled: params !== undefined,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders', { params })
      return data.data as InboundOrder[]
    },
  })
}

// ── Nhập kho PHÂN TRANG SERVER (27/07) — user xem CẢ THÁNG+ (~500 phiếu/ngày) nên list
// không thể trả toàn bộ. BE: RPC inbound_orders_page chọn trang id dưới DB. ──
export interface InboundListPage { items: InboundOrder[]; total: number; page: number; limit: number }
export interface InboundSummary {
  total_orders: number; sx: number; ncc: number; tf: number; completed: number
  total_pallets: number; total_cartons: number
  locations: { loc: string; pallets: number; cartons: number }[]
}
export interface InboundFacets { materials: { value: string; label: string }[]; cycles: string[]; machines: string[] }

export interface InboundListFilterParams {
  warehouse_id?: string; search?: string; date_from?: string; date_to?: string; material_category?: string
  material_ids?: string[]; cycles?: string[]; machines?: string[]; shift_ids?: string[]; source_types?: string[]
  importer?: string
}
// Mảng → CSV cho query string (BE parse lại); mảng rỗng = bỏ param
function inboundCsvParams(p: InboundListFilterParams) {
  return {
    warehouse_id: p.warehouse_id, search: p.search, date_from: p.date_from, date_to: p.date_to,
    material_category: p.material_category, importer: p.importer,
    material_ids: p.material_ids?.length ? p.material_ids.join(',') : undefined,
    cycles:       p.cycles?.length       ? p.cycles.join(',')       : undefined,
    machines:     p.machines?.length     ? p.machines.join(',')     : undefined,
    shift_ids:    p.shift_ids?.length    ? p.shift_ids.join(',')    : undefined,
    source_types: p.source_types?.length ? p.source_types.join(',') : undefined,
  }
}

// key + queryFn dùng chung cho hook của trang VÀ prefetch ở Shell — prefetch phải trúng ĐÚNG
// key trang mới có tác dụng (bản cũ prefetch key ['inbound-orders', {}] không tham số: kéo cả
// bảng rồi vứt đi vì không khớp key nào).
export function inboundPagedQueryOptions(params: InboundListFilterParams & { page: number; limit: number }) {
  const qp = { ...inboundCsvParams(params), page: params.page, limit: params.limit }
  return {
    queryKey: ['inbound-orders-paged', qp] as const,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders', { params: qp })
      return data.data as InboundListPage
    },
  }
}

// Bộ lọc trang Nhập kho → tham số API. Khai 1 CHỖ để trang và prefetch không lệch nhau.
export function inboundListParamsOf(
  f: {
    search: string; dateFrom: string; dateTo: string; warehouseId: string; materialCategory: string
    filterMaterials?: string[]; filterCycles?: string[]; filterMachines?: string[]
    filterShiftIds?: string[]; filterSourceTypes?: string[]; importerSearch?: string
  },
  userWarehouseId?: string | null,
  searchOverride?: string,
): InboundListFilterParams {
  return {
    warehouse_id:      f.warehouseId || userWarehouseId || undefined,
    search:            (searchOverride ?? f.search) || undefined,
    date_from:         f.dateFrom || undefined,
    date_to:           f.dateTo   || undefined,
    material_category: f.materialCategory || undefined,
    material_ids:      f.filterMaterials ?? [],
    cycles:            f.filterCycles    ?? [],
    machines:          f.filterMachines  ?? [],
    shift_ids:         f.filterShiftIds  ?? [],
    source_types:      f.filterSourceTypes ?? [],
    importer:          f.importerSearch || undefined,
  }
}

export function useInboundOrdersPaged(params: InboundListFilterParams & { page: number; limit: number }) {
  return useQuery({
    ...inboundPagedQueryOptions(params),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,   // lật trang giữ bảng cũ, không nháy trắng
  })
}

// Tổng SummaryBand + bảng "Vị trí hàng nhập" — SQL trên TOÀN BỘ kết quả lọc (không phải trang)
export function useInboundSummary(params: InboundListFilterParams) {
  const qp = inboundCsvParams(params)
  return useQuery({
    queryKey: ['inbound-summary', qp],
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders/summary', { params: qp })
      return data.data as InboundSummary
    },
  })
}

// Option filter Material / Chu kỳ / Máy — DISTINCT dưới DB theo filter nền (kho/loại/ngày)
export function useInboundFacets(params: { warehouse_id?: string; material_category?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['inbound-facets', params],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders/facets', { params })
      return data.data as InboundFacets
    },
  })
}

export function useInboundOrder(id?: string) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['inbound-order', id],
    enabled: !!id,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // 1) list cache (instant navigate from list), 2) localStorage (direct URL / refresh)
    placeholderData: () => {
      const caches = qc.getQueriesData<InboundOrder[]>({ queryKey: ['inbound-orders'] })
      for (const [, list] of caches) {
        const found = list?.find((o) => o.id === id)
        if (found) return found
      }
      return lsGet<InboundOrder>(`wms:io-detail:${id}`)
    },
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inbound-orders/${id}`)
      lsSet(`wms:io-detail:${id}`, data.data)
      return data.data as InboundOrder
    },
  })
}

export function useInboundLocationSuggestions(orderId?: string) {
  return useQuery({
    queryKey: ['inbound-location-suggestions', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inbound-orders/${orderId}/location-suggestions`)
      return data.data as import('@/types').LocationSuggestion[]
    },
  })
}

export function useCreateInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string
      material_id: string
      location_id?: string
      shift_id?: string
      import_date?: string
      notes?: string
      imported_by?: string
      source_type?: string
      warehouse_type?: string
      gate_registration_id?: string
      tms_order_id?: string
      planned_cartons?: number
      ncc_id?: string
    }) => apiClient.post('/wms/inbound-orders', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-orders'] }),
  })
}

export function useUpdateInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; planned_pallets?: number; planned_cartons?: number | null; shift_id?: string; import_date?: string; notes?: string }) =>
      apiClient.patch(`/wms/inbound-orders/${id}`, body).then((r) => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', v.id] })
    },
  })
}

// Đổi vị trí phiếu — endpoint riêng (gate edit_pallet/force_edit_pallet, KHÔNG dùng quyền edit).
// Optimistic: cập nhật ngay cache detail (vị trí mới hiện tức thì) + dùng order PATCH trả về để
// merge cache, KHÔNG refetch getOrder chặn UI. Realtime sẽ reconcile nền. `location_code` truyền
// từ component để hiện code mới ngay; thiếu cũng không sao (chỉ chậm hiện code tới khi PATCH về).
type InboundOrderCache = {
  location_id: string | null
  location: { id: string; location_code: string } | null
  [k: string]: unknown
}
export function useSetInboundOrderLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, location_id }: { id: string; location_id: string; location_code?: string }) =>
      apiClient.patch(`/wms/inbound-orders/${id}/location`, { location_id }).then((r) => r.data.data),
    onMutate: async ({ id, location_id, location_code }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', id] })
      const prev = qc.getQueryData<InboundOrderCache>(['inbound-order', id])
      if (prev) {
        qc.setQueryData<InboundOrderCache>(['inbound-order', id], {
          ...prev,
          location_id,
          location: location_code ? { id: location_id, location_code } : prev.location,
        })
      }
      return { prev, id }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['inbound-order', ctx.id], ctx.prev)
    },
    onSuccess: (data: Partial<InboundOrderCache>, v) => {
      // PATCH trả về order đầy đủ (ORDER_SELECT + count) → merge, GIỮ inventory_entries hiện có.
      qc.setQueryData<InboundOrderCache>(['inbound-order', v.id], (old) =>
        old ? { ...old, ...data } : old)
    },
    onSettled: () => {
      // Chỉ invalidate list ở nền (cho trang DS nếu đang mở). Detail đã cập nhật qua cache +
      // realtime tự reconcile → tránh refetch getOrder chặn.
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
    },
  })
}

export function useCompleteInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/inbound-orders/${id}/complete`).then((r) => r.data.data),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', id] })
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['transfer-goods'] })
    },
  })
}

export function useUncompleteInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/inbound-orders/${id}/uncomplete`).then((r) => r.data.data),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', id] })
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['transfer-goods'] })
    },
  })
}

export function useCancelInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/inbound-orders/${id}/cancel`).then((r) => r.data.data),
    onSuccess: (_d, id) => {
      useActiveInboundStore.getState().unpin(id)
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', id] })
      // Hủy phiếu hoàn tồn + gỡ dòng panel Nhận chuyển kho (cancel-cascade có thể đổi cả TmsOrder/GDO)
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['inbound-by-gdo'] })
      qc.invalidateQueries({ queryKey: ['transfer-goods'] })
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
    },
  })
}

// Quét/lưu tay/sửa/xóa pallet đụng cả LIST Nhập (cột Thực nhập/Tiến độ gộp từ InventoryEntry)
// + trang Tồn kho — invalidate cùng lượt cho chính user, không chờ realtime/refetchInterval
function invalidateAfterPalletMutation(qc: ReturnType<typeof useQueryClient>, orderId: string) {
  qc.invalidateQueries({ queryKey: ['inbound-order', orderId] })
  qc.invalidateQueries({ queryKey: ['inbound-orders'] })
  qc.invalidateQueries({ queryKey: ['inventory-entries'] })
  qc.invalidateQueries({ queryKey: ['inventory-summary'] })
}

export function useScanPallet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, ...body }: {
      orderId: string
      qr_code: string
      location_id: string
      stack_layer?: number
      cartons_override?: number
      qa_status_id?: string
      employee_id?: string
      ncc_id?: string
      shelf_life_days?: number
      // timeout 12s: sóng yếu → fail sớm → InboundScanSheet tự xếp vào hàng đợi offline
    }) => apiClient.post(`/wms/inbound-orders/${orderId}/scan`, body, { timeout: 12000 }).then((r) => r.data.data),

    // Optimistic: add entry to table immediately, before API responds
    onMutate: async ({ orderId, qr_code, location_id }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', orderId] })
      const previous = qc.getQueryData<InboundOrder>(['inbound-order', orderId])

      // Tem V2 (`;`) không có Chu kỳ/Máy ở vị trí 3/4 — chỉ bóc cho tem V1 (`_`)
      const isV2 = qr_code.includes(';')
      const parts = isV2 ? [] : qr_code.split('_')
      const tempEntry = {
        id: `_temp_${Date.now()}`,
        pallet_code: qr_code.trim(),   // GIỮ đệm space (tem V2) — lưu đúng như quét, khớp pallet_code server
        location: previous?.location ?? { id: location_id, location_code: '…', sub_code: '' },
        material: previous?.material ?? { id: '', material_code: '', short_name: null },
        manufacturer: null,
        cycle:              parts[2] ?? null,
        machine_code:       parts[3] ?? null,
        pallet_sequence_no: null,
        qa_status_id:       null,
        qa_status:          null,
        stack_layer:        1,
        cartons_imported:   previous?.material?.cartons_per_pallet ?? 0,
        production_date:    null,
        status:             'IN_STOCK',
        created_by_emp:     null,
        updated_by_emp:     null,
        import_date:        new Date().toISOString(),
        update_date:        new Date().toISOString(),
        created_at:         new Date().toISOString(),
        updated_at:         new Date().toISOString(),
      }

      qc.setQueryData<InboundOrder>(['inbound-order', orderId], (old) => {
        if (!old) return old
        return {
          ...old,
          inventory_entries: [...(old.inventory_entries ?? []), tempEntry],
          _count: { inventory_entries: old._count.inventory_entries + 1 },
        }
      })

      return { previous, orderId }
    },

    // Rollback on error
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['inbound-order', ctx.orderId], ctx.previous)
    },

    // Always sync real data after settle
    onSettled: (_d, _e, v) => invalidateAfterPalletMutation(qc, v.orderId),
  })
}

export function useScanManualPallet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, ...body }: {
      orderId: string
      pallet_code?: string
      cartons: number
      location_id?: string
      employee_id?: string
      production_date?: string   // kho QTY_DATE: NSX bắt buộc (pool tách theo date)
    }) => apiClient.post(`/wms/inbound-orders/${orderId}/scan-manual`, body).then((r) => r.data.data),

    onMutate: async ({ orderId, cartons }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', orderId] })
      const previous = qc.getQueryData<InboundOrder>(['inbound-order', orderId])
      const tempEntry = {
        id: `_temp_${Date.now()}`,
        pallet_code: `MNL-${Date.now()}`,
        location: { id: '', location_code: '—', sub_code: '' },
        material: previous?.material ?? null,
        manufacturer: null,
        cycle: null, machine_code: null, pallet_sequence_no: null,
        qa_status_id: null, qa_status: null, stack_layer: 1,
        cartons_imported: cartons, cartons_remaining: cartons,
        production_date: null, status: 'IN_STOCK',
        created_by_emp: null, updated_by_emp: null,
        import_date: new Date().toISOString(),
        update_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as PalletEntry
      qc.setQueryData<InboundOrder>(['inbound-order', orderId], (old) => {
        if (!old) return old
        return {
          ...old,
          inventory_entries: [...(old.inventory_entries ?? []), tempEntry],
          _count: { inventory_entries: old._count.inventory_entries + 1 },
        }
      })
      return { previous, orderId }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(['inbound-order', ctx.orderId], ctx.previous)
    },
    onSettled: (_d, _e, v) => invalidateAfterPalletMutation(qc, v.orderId),
  })
}

export function useDeletePalletEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, entryId, employeeId }: { orderId: string; entryId: string; employeeId?: string }) =>
      apiClient.delete(`/wms/inbound-orders/${orderId}/entries/${entryId}`, {
        data: { employee_id: employeeId },
      }).then((r) => r.data.data),
    onMutate: async ({ orderId, entryId }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', orderId] })
      const prev = qc.getQueryData<InboundOrder>(['inbound-order', orderId])
      qc.setQueryData<InboundOrder>(['inbound-order', orderId], (old) => {
        if (!old) return old
        return {
          ...old,
          inventory_entries: (old.inventory_entries ?? []).filter((e: PalletEntry) => e.id !== entryId),
          _count: { inventory_entries: Math.max(0, (old._count?.inventory_entries ?? 1) - 1) },
        }
      })
      return { prev, orderId }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['inbound-order', ctx.orderId], ctx.prev)
    },
    onSettled: (_d, _e, v) => invalidateAfterPalletMutation(qc, v.orderId),
  })
}

export function useDeletePalletEntries() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, entryIds, employeeId }: { orderId: string; entryIds: string[]; employeeId?: string }) =>
      apiClient.delete(`/wms/inbound-orders/${orderId}/entries`, {
        data: { entry_ids: entryIds, employee_id: employeeId },
      }).then((r) => r.data.data),
    onSuccess: (_d, v) => invalidateAfterPalletMutation(qc, v.orderId),
  })
}

export function useUpdatePalletEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, entryId, ...body }: {
      orderId: string
      entryId: string
      cartons_imported?: number
      stack_layer?: number
      employee_id?: string
    }) => apiClient.patch(`/wms/inbound-orders/${orderId}/entries/${entryId}`, body).then((r) => r.data.data),
    onSuccess: (_d, v) => invalidateAfterPalletMutation(qc, v.orderId),
  })
}

export function useMaterialCategories() {
  return useQuery({
    queryKey: ['material-categories'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials/categories')
      return data.data as string[]
    },
  })
}

export type WarehouseTypeRow = { id: string; value: string; sort_order: number; meta?: WhTypeMeta | null }

export function useWarehouseTypes() {
  return useQuery({
    queryKey: ['lookup', 'warehouse_type'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/lookup', { params: { type: 'warehouse_type' } })
      return data.data as WarehouseTypeRow[]
    },
  })
}

export function useAddWarehouseType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { value: string; meta?: WhTypeMeta }) =>
      apiClient.post('/wms/lookup', { type: 'warehouse_type', ...input }).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] }),
  })
}

export function useUpdateWarehouseType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value, meta }: { id: string; value: string; meta?: WhTypeMeta }) =>
      apiClient.put(`/wms/lookup/${id}`, { value, meta }).then(r => r.data.data as WarehouseTypeRow & { renamed?: Record<string, number> }),
    // Đổi TÊN loại kho = cascade toàn DB (Material/Location/đơn hàng/quyền…) → invalidate toàn bộ cache query
    onSuccess: data => {
      if (data?.renamed) qc.invalidateQueries()
      else qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] })
    },
  })
}

export function useDeleteWarehouseType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/lookup/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] }),
  })
}

// Kéo-thả sắp thứ tự loại kho (sort_order) — ids theo thứ tự mới
export function useReorderWarehouseTypes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.put('/wms/lookup/reorder', { type: 'warehouse_type', ids }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] }),
  })
}

// ─── Đơn vị tính (unit_of_measure) — danh mục Base/Entry Unit (tab Cài đặt WMS) ──
export type UnitRole = 'base' | 'entry' | 'both'
export type UnitRow = { id: string; value: string; sort_order: number; meta?: { role?: UnitRole; label?: string } | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }

export function useUnits() {
  return useQuery({
    queryKey: ['lookup', 'unit_of_measure'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/lookup', { params: { type: 'unit_of_measure' } })
      return data.data as UnitRow[]
    },
  })
}
export function useAddUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { value: string; meta?: { role: UnitRole; label?: string } }) =>
      apiClient.post('/wms/lookup-unit', input).then(r => r.data.data as UnitRow),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'unit_of_measure'] }),
  })
}
export function useUpdateUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value, meta }: { id: string; value: string; meta?: { role: UnitRole; label?: string } }) =>
      apiClient.put(`/wms/lookup-unit/${id}`, { value, meta }).then(r => r.data.data as UnitRow),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'unit_of_measure'] }),
  })
}
export function useDeleteUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/lookup-unit/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'unit_of_measure'] }),
  })
}
export function useReorderUnits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => apiClient.put('/wms/lookup-unit/reorder', { ids }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'unit_of_measure'] }),
  })
}

export type WarehouseZone = { id: string; warehouse_id: string; code: string; name: string; categories: string[] | null; sort_order: number; pick_rank?: number | null; flow_type?: string | null; max_pallets?: number | null; is_active: boolean; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }

export function useWarehouseZones(warehouseId?: string) {
  return useQuery({
    queryKey: ['warehouse-zones', warehouseId ?? 'all'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/zones', {
        params: warehouseId ? { warehouse_id: warehouseId } : undefined,
      })
      return data.data as WarehouseZone[]
    },
  })
}

export function useCreateWarehouseZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; name: string; categories: string[]; code?: string; max_pallets?: number | null }) =>
      apiClient.post('/wms/zones', body).then(r => r.data.data as WarehouseZone),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-zones'] }),
  })
}

export function useUpdateWarehouseZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; categories?: string[]; is_active?: boolean; max_pallets?: number | null }) =>
      apiClient.put(`/wms/zones/${id}`, body).then(r => r.data.data as WarehouseZone),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-zones'] }),
  })
}

export function useDeleteWarehouseZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/zones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-zones'] }),
  })
}

// WMS – Inventory (API thật)
export function useInventoryEntries(params?: {
  warehouse_ids?: string[]
  categories?: string[]
  filter_locations?: string[]
  filter_material_ids?: string[]
  qa_status_ids?: string[]
  status?: string
  search?: string
  page?: number
  limit?: number
  manufacturer_id?: string
  filter_cycles?: string[]
  filter_machines?: string[]
  filter_nmsx?: string[]
  ncc_ids?: string[]
  date_pct_ranges?: string[]
  import_date_from?: string   // lọc theo NGÀY NHẬP KHO (BE đã hỗ trợ sẵn ở cả list, tổng hợp, facets)
  import_date_to?: string
}, enabled = true) {
  return useQuery({
    queryKey: ['inventory-entries', params],
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData, // đổi trang/lọc: giữ dữ liệu cũ, không trắng bảng (cảm giác tức thì)
    queryFn: async () => {
      const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, filter_nmsx, ncc_ids, date_pct_ranges, ...rest } = params ?? {}
      const { data } = await apiClient.get('/wms/inventory', {
        params: {
          ...rest,
          ...(warehouse_ids?.length       ? { warehouse_ids:      warehouse_ids.join(',')       } : {}),
          ...(categories?.length          ? { categories:         categories.join(',')          } : {}),
          ...(filter_locations?.length    ? { filter_locations:   filter_locations.join(',')    } : {}),
          ...(filter_material_ids?.length ? { filter_material_ids:filter_material_ids.join(',') } : {}),
          ...(qa_status_ids?.length       ? { qa_status_ids:      qa_status_ids.join(',')       } : {}),
          ...(filter_cycles?.length       ? { filter_cycles:      filter_cycles.join(',')       } : {}),
          ...(filter_machines?.length     ? { filter_machines:    filter_machines.join(',')     } : {}),
          ...(filter_nmsx?.length         ? { filter_nmsx:        filter_nmsx.join(',')         } : {}),
          ...(ncc_ids?.length             ? { ncc_ids:            ncc_ids.join(',')             } : {}),
          ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
        },
      })
      return data.data as { entries: InventoryEntry[]; total: number; page: number; limit: number; total_cartons_remaining: number; total_pallets_in_stock?: number }
    },
  })
}

export interface InventorySummaryGroup {
  warehouse_id: string | null
  warehouse_name: string
  material_id: string
  material_code: string | null
  short_name: string | null
  category: string | null
  production_date: string | null
  date_pct: number | null
  ncc_name: string | null
  cartons_imported: number
  cartons_remaining: number
  cartons_exported: number
  pallet_count: number
  base_unit: string | null
  entry_unit: string | null
  units_per_carton: number | null
}

// View tổng hợp tồn kho theo Kho × Mã hàng × Ngày SX. Dùng CHUNG params filter với useInventoryEntries.
export function useInventorySummary(params?: Parameters<typeof useInventoryEntries>[0], enabled = true) {
  return useQuery({
    queryKey: ['inventory-summary', params],
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, filter_nmsx, ncc_ids, date_pct_ranges, ...rest } = params ?? {}
      const { data } = await apiClient.get('/wms/inventory/summary', {
        params: {
          ...rest,
          ...(warehouse_ids?.length       ? { warehouse_ids:      warehouse_ids.join(',')       } : {}),
          ...(categories?.length          ? { categories:         categories.join(',')          } : {}),
          ...(filter_locations?.length    ? { filter_locations:   filter_locations.join(',')    } : {}),
          ...(filter_material_ids?.length ? { filter_material_ids:filter_material_ids.join(',') } : {}),
          ...(qa_status_ids?.length       ? { qa_status_ids:      qa_status_ids.join(',')       } : {}),
          ...(filter_cycles?.length       ? { filter_cycles:      filter_cycles.join(',')       } : {}),
          ...(filter_machines?.length     ? { filter_machines:    filter_machines.join(',')     } : {}),
          ...(filter_nmsx?.length         ? { filter_nmsx:        filter_nmsx.join(',')         } : {}),
          ...(ncc_ids?.length             ? { ncc_ids:            ncc_ids.join(',')             } : {}),
          ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
        },
      })
      return data.data as { groups: InventorySummaryGroup[]; total: number; total_cartons_remaining: number; page: number; limit: number }
    },
  })
}

// Xuất Excel view Tổng hợp: /summary giờ trả 1 TRANG (41.107 nhóm = 18MB, vượt trần 4,5MB),
// nên phải duyệt hết trang — nếu lấy `groups` của trang đang xem thì file Excel bị CẮT âm thầm.
const SUMMARY_EXPORT_PAGE = 1000
export async function fetchAllInventorySummary(
  params?: Parameters<typeof useInventoryEntries>[0], maxPages = 50,
): Promise<InventorySummaryGroup[]> {
  const out: InventorySummaryGroup[] = []
  for (let page = 1; page <= maxPages; page++) {
    const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, filter_nmsx, ncc_ids, date_pct_ranges, ...rest } = params ?? {}
    const { data } = await apiClient.get('/wms/inventory/summary', {
      params: {
        ...rest, page, limit: SUMMARY_EXPORT_PAGE,
        ...(warehouse_ids?.length       ? { warehouse_ids:      warehouse_ids.join(',')       } : {}),
        ...(categories?.length          ? { categories:         categories.join(',')          } : {}),
        ...(filter_locations?.length    ? { filter_locations:   filter_locations.join(',')    } : {}),
        ...(filter_material_ids?.length ? { filter_material_ids:filter_material_ids.join(',') } : {}),
        ...(qa_status_ids?.length       ? { qa_status_ids:      qa_status_ids.join(',')       } : {}),
        ...(filter_cycles?.length       ? { filter_cycles:      filter_cycles.join(',')       } : {}),
        ...(filter_machines?.length     ? { filter_machines:    filter_machines.join(',')     } : {}),
        ...(filter_nmsx?.length         ? { filter_nmsx:        filter_nmsx.join(',')         } : {}),
        ...(ncc_ids?.length             ? { ncc_ids:            ncc_ids.join(',')             } : {}),
        ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
      },
    })
    const d = data.data as { groups: InventorySummaryGroup[]; total: number }
    out.push(...(d.groups ?? []))
    if (out.length >= (d.total ?? 0) || (d.groups?.length ?? 0) < SUMMARY_EXPORT_PAGE) break
  }
  return out
}

// Lấy TOÀN BỘ entry khớp filter để export Excel (BE phân trang nội bộ). On-demand, không phải useQuery.
export async function fetchInventoryExport(params?: Parameters<typeof useInventoryEntries>[0]): Promise<InventoryEntry[]> {
  const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, filter_nmsx, ncc_ids, date_pct_ranges, page, limit, ...rest } = params ?? {}
  void page; void limit
  const { data } = await apiClient.get('/wms/inventory/export', {
    params: {
      ...rest,
      ...(warehouse_ids?.length       ? { warehouse_ids:      warehouse_ids.join(',')       } : {}),
      ...(categories?.length          ? { categories:         categories.join(',')          } : {}),
      ...(filter_locations?.length    ? { filter_locations:   filter_locations.join(',')    } : {}),
      ...(filter_material_ids?.length ? { filter_material_ids:filter_material_ids.join(',') } : {}),
      ...(qa_status_ids?.length       ? { qa_status_ids:      qa_status_ids.join(',')       } : {}),
      ...(filter_cycles?.length       ? { filter_cycles:      filter_cycles.join(',')       } : {}),
      ...(filter_machines?.length     ? { filter_machines:    filter_machines.join(',')     } : {}),
      ...(filter_nmsx?.length         ? { filter_nmsx:        filter_nmsx.join(',')         } : {}),
      ...(ncc_ids?.length             ? { ncc_ids:            ncc_ids.join(',')             } : {}),
      ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
    },
  })
  return (data.data?.entries ?? []) as InventoryEntry[]
}

export function useInventoryFacets(params?: { warehouse_ids?: string[]; categories?: string[] }) {
  return useQuery({
    queryKey: ['inventory-facets', params],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { warehouse_ids, categories } = params ?? {}
      const { data } = await apiClient.get('/wms/inventory/facets', {
        params: {
          ...(warehouse_ids?.length ? { warehouse_ids: warehouse_ids.join(',') } : {}),
          ...(categories?.length    ? { categories:    categories.join(',')    } : {}),
        },
      })
      // `materials` + `locations` ĐÃ BỎ khỏi facet (2.740 mã + 1.753 vị trí ≈ 420KB/lần mở trang)
      // → 2 filter đó dùng tìm-trên-server: useMaterials/useLocationsReal với `search` + `limit`.
      return data.data as {
        cycles:    string[]
        machines:  string[]
        nccs:      { id: string; name: string }[]
      }
    },
  })
}

export interface AdjustmentLog {
  id: string
  delta: number
  cartons_before: number
  cartons_after: number
  note: string | null
  actor_name: string | null
  actor_id: string | null
  adjusted_at: string
}

interface InvListCache { entries: InventoryEntry[]; total: number; page: number; limit: number; total_cartons_remaining: number }

export function useAdjustInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, adjustment, employee_id, note, actor_name }: {
      id: string; adjustment: number; employee_id?: string; note?: string; actor_name?: string
    }) => {
      const { data } = await apiClient.patch(`/wms/inventory/${id}/adjust`, { adjustment, employee_id, note, actor_name })
      return data.data as { entry: InventoryEntry }
    },
    // Optimistic: cộng ngay delta vào dòng + ô tổng của MỌI cache inventory-entries đang giữ → user thấy
    // số mới TỨC THÌ (không chờ refetch ~1.5s). Trạng thái badge để refetch nền chỉnh (delta không đủ suy ra).
    onMutate: async ({ id, adjustment }) => {
      await qc.cancelQueries({ queryKey: ['inventory-entries'] })
      const snapshots = qc.getQueriesData<InvListCache>({ queryKey: ['inventory-entries'] })
      qc.setQueriesData<InvListCache>({ queryKey: ['inventory-entries'] }, (old) => {
        if (!old?.entries) return old
        let touched = false
        const entries = old.entries.map(e => {
          if (e.id !== id) return e
          touched = true
          return { ...e, cartons_remaining: Number(e.cartons_remaining ?? 0) + adjustment }
        })
        if (!touched) return old
        return { ...old, entries, total_cartons_remaining: Number(old.total_cartons_remaining ?? 0) + adjustment }
      })
      return { snapshots }
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['adjustment-log', vars.id] })
    },
    onSettled: () => {
      // Reconcile nền: lấy giá trị + trạng thái chuẩn từ server (không chặn UI đã cập nhật optimistic).
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
    },
  })
}

export function useAdjustmentLog(entryId: string) {
  return useQuery({
    queryKey: ['adjustment-log', entryId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inventory/${entryId}/adjustment-log`)
      return data.data as AdjustmentLog[]
    },
    enabled: !!entryId,
  })
}

export function useBulkUpdateInventoryQA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, qa_status_id, employee_id }: { ids: string[]; qa_status_id: string | null; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-qa', { ids, qa_status_id, employee_id })
      return data.data as { updated: number }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useBulkUpdateInventoryNcc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, ncc_id, shelf_life_days, employee_id }: { ids: string[]; ncc_id: string | null; shelf_life_days?: number | null; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-ncc', { ids, ncc_id, shelf_life_days, employee_id })
      return data.data as { updated: number }
    },
    // NCC đổi → %Date tính lại ở cả list & tổng hợp
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
    },
  })
}

export function useBulkTransferLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, location_id, employee_id }: { ids: string[]; location_id: string; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-location', { ids, location_id, employee_id })
      return data.data as { updated: number; location_code: string }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useBulkTransferMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, material_id, employee_id }: { ids: string[]; material_id: string; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-material', { ids, material_id, employee_id })
      return data.data as { updated: number; material_code: string }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useBulkUpdateProductionDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, production_date, employee_id }: { ids: string[]; production_date: string; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-production-date', { ids, production_date, employee_id })
      return data.data as { updated: number }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useStocktakeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; employee_id?: string; new_location_id?: string; physical_count?: number }) => {
      const { data } = await apiClient.post(`/wms/inventory/${id}/stocktake`, body)
      return data.data as { ok: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['stocktake-entries'] })
      qc.invalidateQueries({ queryKey: ['stocktake-log'] })
    },
  })
}

export function useUnflagEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.patch(`/wms/inventory/${id}/unflag`)
      return data.data as { ok: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['stocktake-entries'] })
    },
  })
}

export interface StocktakeEntryRow {
  id:                  string
  pallet_code:         string
  cartons_remaining:   number
  import_date:         string
  stocktake_flagged:   boolean
  stocktake_flag_note: string | null
  stocktake_at:        string | null
  location:            { id: string; location_code: string } | null
  material:            { material_code: string; short_name: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
  stocktake_by_emp:    { id: string; name: string } | null
}

export interface StocktakeEntriesResult {
  stats:   { total: number; checked: number; unchecked: number; flagged: number; matched: number }
  entries: StocktakeEntryRow[]
  total_filtered?: number   // tổng dòng khớp view đang chọn (toàn bộ, không chỉ trang này)
  page?: number
  page_size?: number
  date_from?: string
  date_to?:   string
}

export type StocktakeEntriesParams = {
  warehouse_id?: string; category?: string; location_ids?: string; requires_only?: string
  view?: string; date_from?: string; date_to?: string; page?: number; page_size?: number
}

// requires_only='1': lọc "chỉ vị trí cần check" bằng CỜ, để BE tự resolve vị trí — KHÔNG nhồi
// hàng nghìn id vào query string (kho 1.517 vị trí = URL 55KB → Vercel 414, trang trắng; đo 27/07:
// ngưỡng ~800 id / 32KB). Xem [[cap-1000-campaign]] họ lỗi "danh sách id trong URL".
export function useStocktakeEntries(params: StocktakeEntriesParams, enabled = true) {
  return useQuery({
    queryKey: ['stocktake-entries', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inventory/stocktake-entries', { params: stkParams(params) })
      return data.data as StocktakeEntriesResult
    },
    enabled,
    placeholderData: keepPreviousData,   // đổi trang không trắng bảng
  })
}

function stkParams(p: StocktakeEntriesParams): Record<string, string> {
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') q[k] = String(v)
  return q
}

// Xuất Excel = duyệt HẾT các trang của bộ lọc đang áp (không chỉ trang đang xem — file cụt là
// kiểu sai âm thầm: người nhận không biết thiếu). Trần 50 trang × 1000 = 50k dòng/lần xuất.
export async function fetchAllStocktakeEntries(params: StocktakeEntriesParams): Promise<StocktakeEntryRow[]> {
  const out: StocktakeEntryRow[] = []
  for (let page = 1; page <= 50; page++) {
    const { data } = await apiClient.get('/wms/inventory/stocktake-entries', {
      params: stkParams({ ...params, page, page_size: 1000 }),
    })
    const res = data.data as StocktakeEntriesResult
    out.push(...(res.entries ?? []))
    if (out.length >= (res.total_filtered ?? 0) || !res.entries?.length) break
  }
  return out
}

export interface StocktakeLogRow {
  id:               string
  pallet_code:      string
  location_code:    string | null
  warehouse_id:     string | null
  category:         string | null
  material_code:    string | null
  short_name:       string | null
  base_unit:        string | null
  entry_unit:       string | null
  units_per_carton: number | null
  app_qty:          number | null
  physical_qty:     number | null
  diff:             number | null
  is_flagged:       boolean
  note:             string | null
  location_changed_to: string | null
  counted_by_name:  string | null
  counted_at:       string
}

export interface StocktakeLogResult {
  rows: StocktakeLogRow[]
  total: number       // 3 ô dưới đây đếm trên TOÀN BỘ bộ lọc (BE), không phải trang đang xem
  counted?: number
  flagged?: number
  page?: number
  page_size?: number
  date_from?: string
  date_to?: string
}

export type StocktakeLogParams = {
  warehouse_id?: string; category?: string; location_ids?: string; requires_only?: string
  date_from?: string; date_to?: string; search?: string; page?: number; page_size?: number
}

export function useStocktakeLog(params: StocktakeLogParams, enabled = true) {
  return useQuery({
    queryKey: ['stocktake-log', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inventory/stocktake-log', { params: stkParams(params) })
      return data.data as StocktakeLogResult
    },
    enabled,
    placeholderData: keepPreviousData,
  })
}

// Xuất Excel lịch sử kiểm = duyệt hết trang của bộ lọc (xem `fetchAllStocktakeEntries`)
export async function fetchAllStocktakeLog(params: StocktakeLogParams): Promise<StocktakeLogRow[]> {
  const out: StocktakeLogRow[] = []
  for (let page = 1; page <= 50; page++) {
    const { data } = await apiClient.get('/wms/inventory/stocktake-log', {
      params: stkParams({ ...params, page, page_size: 1000 }),
    })
    const res = data.data as StocktakeLogResult
    out.push(...(res.rows ?? []))
    if (out.length >= (res.total ?? 0) || !res.rows?.length) break
  }
  return out
}

// WMS (mock — legacy, không dùng nữa)
export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: async () => { await delay(); return mockInventory },
  })
}

export function useTransactions(limit?: number) {
  return useQuery({
    queryKey: ['transactions', limit],
    queryFn: async () => {
      await delay()
      return limit ? mockTransactions.slice(0, limit) : mockTransactions
    },
  })
}

// ─── Dashboard tổng quan (data thật) ─────────────────────────
export type DashboardStats = {
  inventory: Array<{
    warehouse_id: string; warehouse_name: string; inventory_mode: string | null
    category: string; pallets: number; cartons: number; materials: number
  }>
  // Tồn tách theo ĐVT hiển thị (RPC 20260730) — qty đã quy đổi per-mã; thiếu khi BE chạy fallback JS
  by_unit?: Array<{ unit: string; pallets: number; qty: number; materials: number }>
  today: {
    inbound_orders: number; inbound_cartons: number
    outbound_gdos: number; outbound_planned: number; outbound_scanned: number
  }
  zones?: Array<{
    zone_id: string; warehouse_id: string; warehouse_name: string
    code: string; name: string; category: string | null
    capacity: number; used: number
  }>
  source?: 'rpc' | 'fallback'
}
export function useDashboardStats(warehouseId?: string) {
  return useQuery<DashboardStats>({
    queryKey: ['dashboard', warehouseId || 'all'],
    staleTime: 60_000,
    queryFn: () => apiClient.get('/wms/dashboard', {
      params: warehouseId ? { warehouse_id: warehouseId } : undefined,
    }).then(r => r.data.data),
  })
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async () => { await delay(); return mockLocations },
  })
}

// TMS
export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => { await delay(); return mockVehicles },
  })
}

// HR (mock)
export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => { await delay(); return mockEmployees },
  })
}

// ─── Permission masterdata (API thật) ────────────────────────────────────────

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/departments')
      return data.data as Department[]
    },
  })
}

export function useJobTitles(departmentId?: string) {
  return useQuery({
    queryKey: ['job-titles', departmentId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/job-titles', {
        params: departmentId ? { department_id: departmentId } : {},
      })
      return data.data as JobTitle[]
    },
  })
}

// `view: 'lite'` → chỉ id/tên/mã/chức danh/phòng ban + danh sách id kho (không kèm hồ sơ đầy đủ).
// Dùng cho Sơ đồ tổ chức và ô chọn nhân viên: hồ sơ đầy đủ ≈ 830 B/dòng ⇒ 1.539 người đã
// 1.230KB và ~5.400 người là vượt trần 4,5MB của Vercel.
export function useEmployeeRecords(params?: { department_id?: string; search?: string; is_active?: string; include_deleted?: boolean; view?: 'lite' }) {
  return useQuery({
    queryKey: ['employee-records', params],
    // Bảng Employee bị khóa khỏi realtime anon (bảo mật) → poll 60s để DS nhân viên tự cập nhật
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/employees', { params })
      return data.data as EmployeeRecord[]
    },
    staleTime: 0,
  })
}

// Quản lý người dùng — phân trang SERVER. Đo thật 28/07: trả cả bảng thì 3.000 nhân sự =
// 2.495KB/lần gọi (trần 4,5MB response của Vercel ở ~5.400 NV) và mọi bộ lọc chạy ở trình duyệt.
export type EmployeesPageParams = {
  department_id?: string; job_title_id?: string; warehouse_id?: string; search?: string
  is_active?: string; include_deleted?: boolean; status?: string
  page?: number; page_size?: number
}
export type EmployeesPage = {
  rows: EmployeeRecord[]
  total: number
  active: number; paused: number; hidden: number   // đếm trên TOÀN BỘ bộ lọc, không phải trang
  page: number; page_size: number
}

export function useEmployeesPaged(params: EmployeesPageParams) {
  return useQuery({
    queryKey: ['employee-records-paged', params],
    refetchInterval: 60_000,   // Employee khoá khỏi realtime anon → poll như hook mảng
    queryFn: async () => {
      const q: Record<string, string> = {}
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q[k] = String(v)
      const { data } = await apiClient.get('/masterdata/employees', { params: q })
      return data.data as EmployeesPage
    },
    placeholderData: keepPreviousData,
  })
}

// Bảng công ma trận — TRANG = NGƯỜI. Đo thật: 3.000 NV × 28 ngày = 44MB/18,9s nếu trả cả bảng.
// `work_dates` = ngày CẦN chấm công, FE tính (giữ bảng lễ VN + bỏ CN + chỉ ngày đã qua) rồi
// truyền xuống để server đếm "thiếu công" trên TOÀN BỘ roster, không chỉ trang đang xem.
export type AttendanceMatrixParams = {
  warehouse_id?: string; department_id?: string; job_title?: string; search?: string
  date_from: string; date_to: string; work_dates: string; status?: string
  page?: number; page_size?: number
}
export type AttendanceMatrixResult = {
  employees: { id: string; name: string; code: string; job: string | null }[]
  rows: AttendanceRow[]
  total: number; roster_total: number; missing_total: number
  work_days: number; leave_days: number; ot: number; early: number
  page: number; page_size: number
}

export function useAttendanceMatrix(params: AttendanceMatrixParams, enabled = true) {
  return useQuery({
    queryKey: ['hr-attendance-matrix', params],
    enabled,
    queryFn: async () => {
      const q: Record<string, string> = {}
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q[k] = String(v)
      const { data } = await apiClient.get('/hr/attendance/matrix', { params: q })
      return data.data as AttendanceMatrixResult
    },
    placeholderData: keepPreviousData,
  })
}

export function useEmployeeRecord(id?: string) {
  return useQuery({
    queryKey: ['employee-record', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/masterdata/employees/${id}`)
      return data.data as EmployeeRecord
    },
  })
}

export function useCreateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string; employee_code: string; email?: string; phone?: string
      department_id?: string | null; job_title_id?: string | null
      allowed_categories?: string[]; warehouse_scope?: string
      warehouse_ids?: string[]
      ncc_id?: string | null; is_driver?: boolean
    }) => apiClient.post('/masterdata/employees', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-records'] }),
  })
}

export function useUpdateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; name?: string; phone?: string; email?: string
      department_id?: string | null; job_title_id?: string | null
      allowed_categories?: string[]; warehouse_scope?: string
      is_active?: boolean; warehouse_ids?: string[]
      ncc_id?: string | null; is_driver?: boolean
    }) => apiClient.patch(`/masterdata/employees/${id}`, body).then(r => r.data.data),
    onSuccess: (updated: EmployeeRecord, v) => {
      // Cập nhật cache ngay lập tức thay vì refetch toàn bộ
      qc.setQueriesData<EmployeeRecord[]>(
        { queryKey: ['employee-records'] },
        old => old?.map(e => e.id === v.id ? updated : e)
      )
    },
  })
}

export function useSetManager() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, manager_id }: { id: string; manager_id: string | null }) =>
      apiClient.patch(`/masterdata/employees/${id}/manager`, { manager_id }).then(r => r.data.data as EmployeeRecord),
    onSuccess: (updated, v) => {
      qc.setQueriesData<EmployeeRecord[]>({ queryKey: ['employee-records'] }, old => old?.map(e => e.id === v.id ? updated : e))
    },
  })
}

export function useDeleteEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/masterdata/employees/${id}`).then(r => r.data.data as { message: string; deleted: 'hard' | 'soft' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-records'] }),
  })
}

export function useRestoreEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/masterdata/employees/${id}/restore`).then(r => r.data.data as EmployeeRecord),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-records'] }),
  })
}

export function useSetEmployeeWarehouses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, warehouse_ids }: { id: string; warehouse_ids: string[] }) =>
      apiClient.put(`/masterdata/employees/${id}/warehouses`, { warehouse_ids }).then(r => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['employee-records'] })
      qc.invalidateQueries({ queryKey: ['employee-record', v.id] })
    },
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; code: string; allowed_modules?: string[] }) =>
      apiClient.post('/masterdata/departments', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  })
}

export function useUpdateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; code?: string; is_active?: boolean }) =>
      apiClient.put(`/masterdata/departments/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  })
}

export function useCreateJobTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string; department_id: string; parent_id?: string | null; in_chart?: boolean
      allowed_categories?: string[]; warehouse_scope?: string
      module_permissions?: Record<string, string[]>
    }) => apiClient.post('/masterdata/job-titles', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

export function useSetJobTitleParent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, parent_id, in_chart }: { id: string; parent_id: string | null; in_chart?: boolean }) =>
      apiClient.patch(`/masterdata/job-titles/${id}/parent`, { parent_id, in_chart }).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

export function useUpdateJobTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; name?: string
      allowed_categories?: string[]; warehouse_scope?: string; is_active?: boolean
      module_permissions?: Record<string, string[]>
    }) => apiClient.put(`/masterdata/job-titles/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

// ─── Outbound (API thật) ─────────────────────────────────────────────────────

type GDOFormPayload = {
  delivery_date: string
  warehouse_id?: string
  warehouse_type?: string
  shipto_party?: string
  dvvt: string
  customer_name: string
  delivery_code?: string
  export_type: string
  items?: Array<{ db_id?: string; material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string; batch_required?: string; date_required?: number; cs_responsible?: string; npp?: string }>
}

export type LookupItem = { id: string; value: string }

export function useLookup(type: string) {
  return useQuery({
    queryKey: ['lookup', type],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/lookup', { params: { type } })
      return data.data as LookupItem[]
    },
  })
}

export function useAddLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ type, value }: { type: string; value: string }) => {
      const { data } = await apiClient.post('/wms/lookup', { type, value })
      return data.data as LookupItem
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['lookup', vars.type] }),
  })
}

export function useDeleteLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      await apiClient.delete(`/wms/lookup/${id}`)
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['lookup', vars.type] }),
  })
}

// ─── Loose picking (nhặt lẻ) ─────────────────────────────────

export type LoosePickingItem = {
  id: string
  do_id: string
  material_id: string | null
  material_code_raw: string | null
  // BASE UNIT: units để quy đổi thùng khi cộng loose cross-mã ở list (BE đã embed sẵn)
  material: { id: string; material_code: string; short_name: string; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
  cartons_ordered: number
  loose_picking: number
  cartons_scanned: number
  loose_scanned: number
  status: string
  header_text: string | null
  batch_required: string | null
  date_required: number | null
  gdo: {
    id: string
    group_code: string
    delivery_date: string | null
    planned_date: string | null
    status: string
    started_at: string | null
    dvvt: string | null
    warehouse_type: string | null
    export_type: string | null
    distributor_names: string[]
    warehouse: { id: string; code: string; name: string }
  } | null
}

export type LoosePickingParams = {
  warehouse_id?: string; date_from?: string; date_to?: string
  wh_types?: string; export_types?: string; dvvts?: string; npps?: string; search?: string
  page?: number; page_size?: number
}
export type LoosePickingResult = {
  items: LoosePickingItem[]
  total: number         // số CHUYẾN khớp bộ lọc (đơn vị trang)
  page: number; page_size: number
  items_n: number; pending_n: number; loose_total: number; loose_done: number
}
export type LoosePickingFacets = { dvvts: string[]; npps: string[]; wh_types: string[]; export_types: string[] }

// Trang = CHUYẾN XE; mọi bộ lọc + 4 ô tổng do server tính (lọc/đếm ở FE sau phân trang = 1 trang)
export function useLoosePickingItems(params: LoosePickingParams) {
  return useQuery({
    queryKey: ['loosepicking', params],
    queryFn: async () => {
      const q: Record<string, string> = {}
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q[k] = String(v)
      const { data } = await apiClient.get('/wms/loosepicking', { params: q })
      return data.data as LoosePickingResult
    },
    placeholderData: keepPreviousData,
  })
}

export function useLoosePickingFacets(params: { warehouse_id?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['loosepicking-facets', params],
    queryFn: async () => {
      const q: Record<string, string> = {}
      for (const [k, v] of Object.entries(params)) if (v) q[k] = String(v)
      const { data } = await apiClient.get('/wms/loosepicking/facets', { params: q })
      return data.data as LoosePickingFacets
    },
  })
}

export function useScanLoosePickingItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, ...body }: {
      gdoId: string; itemId: string; qr_code: string; cartons_override?: number
      // Nhặt lẻ luôn để lại hàng trên pallet → BẮT BUỘC khai chỗ đặt lại ('KEEP' hoặc id vị trí mới)
      leftover_location_id?: string; leftover_ui?: boolean
    }) => apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/scan`, {
      ...body, loose_picking_mode: true,
    }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loosepicking'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo'] })
      // quét nhặt lẻ reserve tồn → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

// Lưu thủ công nhặt lẻ cho hàng no-QR (POSM/Loscam) — ghi số thùng tay, reserve tồn (trừ khi Check nhặt lẻ)
export function useManualLooseItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, cartons }: { gdoId: string; itemId: string; cartons: number }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/manual-loose`, { cartons }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loosepicking'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo'] })
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export function useCreateGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: GDOFormPayload) => {
      const { data } = await apiClient.post('/wms/outbound', body)
      return data.data as GDO
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gdos'] }),
  })
}

// Tạo & Xuất luôn (hàng không tem): tạo đơn + tự Bắt đầu + ghi nhận SL + Hoàn thành trong 1 request.
// Hoàn thành có thể sinh booking chuyển kho → invalidate cả tms; trừ tồn → invalidate inventory.
export function useQuickExportGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: GDOFormPayload & { license_plate: string }) => {
      const { data } = await apiClient.post('/wms/outbound/quick-export', body)
      return data.data as GDO
    },
    onSettled: () => {   // 409 PARTIAL_EXPORT vẫn đã tạo đơn + trừ tồn một phần → invalidate cả khi lỗi
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-facets'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
    },
  })
}

// "Xuất luôn" trên GDO đã lưu (kho QTY/NONE): nhập biển số → tự Bắt đầu + ghi nhận mọi mã + Hoàn thành + trừ tồn.
export function useQuickExportExistingGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ gdoId, ...body }: { gdoId: string; license_plate: string; gate_registration_id?: string | null }) => {
      const { data } = await apiClient.post(`/wms/outbound/${gdoId}/quick-export`, body)
      return data.data as GDO
    },
    onSettled: (_d, _e, { gdoId }) => {   // 409 PARTIAL vẫn đã trừ tồn một phần → invalidate cả khi lỗi
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', gdoId] })
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-facets'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['manual-item-stock'] })
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
    },
  })
}

export function useUpdateGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: GDOFormPayload & { id: string }) =>
      apiClient.put(`/wms/outbound/${id}`, body).then(r => r.data.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}

export function useDeleteGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/outbound/${id}`).then(r => r.data.data),
    onSuccess: (_d, id) => {
      useActiveVehiclesStore.getState().unpin(id)
      qc.invalidateQueries({ queryKey: ['gdos'] })
    },
  })
}

export function useGDOs(params?: { warehouse_id?: string; status?: string; transfer_status?: string; date?: string; date_from?: string; date_to?: string; search?: string }) {
  return useQuery({
    queryKey: ['gdos', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound', { params })
      return data.data as GDO[]
    },
  })
}

// ── Xuất kho PHÂN TRANG SERVER (28/07) — cùng khuôn Nhập kho ──
export interface GdoListPage { items: GDO[]; total: number; page: number; limit: number }
// too_wide = phạm vi lọc vượt trần an toàn (số DÒNG HÀNG phải quét) → BE cố ý KHÔNG tính tổng
// (các trường số trả null) để không chiếm DB của người khác; FE hiện "—" + hướng dẫn thu hẹp.
export interface OutboundSummary {
  count: number | null; completed: number | null
  cartons: number | null; cartons_qr: number | null; cartons_noqr: number | null; pallets: number | null
  npp_breakdown: { npp: string; planned: number; scanned: number }[]
  too_wide?: boolean
}
export interface OutboundFacets {
  export_types: string[]; dvvts: string[]; warehouse_types: string[]
  npps: string[]; status_labels: string[]
  materials: { value: string; label: string }[]
}
export interface OutboundListFilterParams {
  warehouse_id?: string; search?: string; date_from?: string; date_to?: string
  warehouse_types?: string[]; export_types?: string[]; dvvts?: string[]
  npps?: string[]; material_codes?: string[]; status_labels?: string[]
}
function outboundCsvParams(p: OutboundListFilterParams) {
  const j = (a?: string[]) => (a?.length ? a.join(',') : undefined)
  return {
    warehouse_id: p.warehouse_id, search: p.search, date_from: p.date_from, date_to: p.date_to,
    warehouse_types: j(p.warehouse_types), export_types: j(p.export_types), dvvts: j(p.dvvts),
    npps: j(p.npps), material_codes: j(p.material_codes), status_labels: j(p.status_labels),
  }
}

export function useGDOsPaged(params: OutboundListFilterParams & { page: number; limit: number }) {
  const qp = { ...outboundCsvParams(params), page: params.page, limit: params.limit }
  return useQuery({
    queryKey: ['gdos-paged', qp],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound', { params: qp })
      return data.data as GdoListPage
    },
  })
}

// Tổng SummaryBand + phân bổ NPP — SQL trên TOÀN BỘ kết quả lọc (không phải trang)
export function useOutboundSummary(params: OutboundListFilterParams) {
  const qp = outboundCsvParams(params)
  return useQuery({
    queryKey: ['outbound-summary', qp],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/summary', { params: qp })
      return data.data as OutboundSummary
    },
  })
}

// Option filter — DISTINCT dưới DB theo filter nền (kho + ngày)
export function useOutboundFacets(params: { warehouse_id?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['outbound-facets', params],
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/facets', { params })
      return data.data as OutboundFacets
    },
  })
}

// Tra cứu chuyến xuất theo tem pallet (ô tìm kiếm danh sách Xuất) — chỉ chạy khi q≥2
export function useOutboundPalletLookup(q?: string) {
  const term = (q ?? '').trim()
  return useQuery({
    queryKey: ['outbound-pallet-lookup', term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/pallet-lookup', { params: { q: term } })
      return data.data as string[]
    },
  })
}

export function useGDO(id?: string) {
  return useQuery({
    queryKey: ['gdo', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/outbound/${id}`)
      return data.data as GDO
    },
  })
}

export function usePatchGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; delivery_date?: string; status?: string }) =>
      apiClient.patch(`/wms/outbound/${id}`, body).then(r => r.data.data),
    onMutate: async ({ id, status }) => {
      if (!status) return
      await qc.cancelQueries({ queryKey: ['gdo', id] })
      const prev = qc.getQueryData(['gdo', id])
      qc.setQueryData(['gdo', id], (old: any) => old ? { ...old, status } : old)
      return { prev, id }
    },
    onError: (_, __, ctx: any) => ctx && qc.setQueryData(['gdo', ctx.id], ctx.prev),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
    },
  })
}

// Vercel serverless chặn request body >4.5MB (trả 413 text thô, không phải JSON app) —
// chặn sớm ở FE với ngưỡng 4MB (chừa overhead multipart). Lỗi ném theo shape AxiosError
// để các chỗ render lỗi upload hiện đúng message mà không phải sửa handler.
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024
export const UPLOAD_TOO_LARGE_MSG = 'File quá lớn (giới hạn 4MB) — hãy tách nhỏ file rồi upload từng phần.'
function guardUploadSize(file: File) {
  if (file.size <= UPLOAD_MAX_BYTES) return
  const msg = `File ${(file.size / 1024 / 1024).toFixed(1)}MB vượt giới hạn 4MB — hãy tách nhỏ file rồi upload từng phần.`
  throw Object.assign(new Error(msg), { response: { data: { error: { message: msg } } } })
}

export function useUploadGDOExcel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, warehouse_id, preflight }: { file: File; warehouse_id?: string; preflight?: boolean }) => {
      guardUploadSize(file)
      const form = new FormData()
      form.append('file', file)
      if (warehouse_id) form.append('warehouse_id', warehouse_id)
      return apiClient.post(`/wms/outbound/upload${preflight ? '?preflight=1' : ''}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      }).then(r => r.data.data)
    },
    onSuccess: (_d, vars) => { if (!vars.preflight) qc.refetchQueries({ queryKey: ['gdos'] }) },
  })
}

// ĐỢT 3: Up VL06O (raw SAP → erp_outbound_orders). Không đụng GDO nên không invalidate.
export function useUploadVl06o() {
  return useMutation({
    mutationFn: ({ file, preflight }: { file: File; preflight?: boolean }) => {
      guardUploadSize(file)
      const form = new FormData()
      form.append('file', file)
      return apiClient.post(`/wms/outbound/upload-vl06o${preflight ? '?preflight=1' : ''}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      }).then(r => r.data.data)
    },
  })
}

// ĐỢT 3: Up KHVC (join raw theo DO → sinh GDO/DO/Item) → refetch danh sách chuyến.
// DO luôn bắt buộc: thiếu DO khớp VL06O → BE chặn toàn bộ (MISSING_DO); xuất tay không DO dùng "Tạo đơn".
export function useUploadKhvc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, preflight }: { file: File; preflight?: boolean }) => {
      guardUploadSize(file)
      const form = new FormData()
      form.append('file', file)
      return apiClient.post(`/wms/outbound/upload-khvc${preflight ? '?preflight=1' : ''}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      }).then(r => r.data.data)
    },
    onSuccess: (_d, vars) => { if (!vars.preflight) qc.refetchQueries({ queryKey: ['gdos'] }) },
  })
}

// ─── Dữ liệu bên ngoài → DO SAP (raw erp_outbound_orders) ─────────────────────
export interface DoSapRow {
  id: string; od_number: string; od_item: string
  material_code: string | null; material_name: string | null
  qty_sales: number | null; sales_unit: string | null; qty_base: number | null; base_unit: string | null
  ship_to_code: string | null; ship_to_name: string | null
  plant: string | null; storage_location: string | null
  batch: string | null; batch_so: string | null; date_req: number | null; pct_date_req: number | null
  note_delivery: string | null; note_invoice: string | null; shipping_point: string | null; license_plate: string | null
  source: string | null; uploaded_by: string | null; created_at: string; updated_at: string
  sync_status?: string | null; last_synced_at?: string | null
  manual_edited_at?: string | null   // dòng bị SỬA TAY (PUT/POST) — upload đè lại từ SAP/Excel sẽ gỡ; FE hiện ✎ sau số DO
  used?: boolean; unit_mismatch?: boolean   // enrich từ BE list (đã sinh chuyến? / lệch đơn vị vs Material)
  in_plan?: boolean; plan_group_code?: string | null; plan_group_count?: number; plan_export_date?: string | null   // kế hoạch VC gắn với DO
  mat_units?: { base_unit: string | null; entry_unit: string | null; units_per_carton: number | null } | null   // quy cách mã (Material master) — tách Thùng+Hộp khi sửa qty_base
}
export function useDoSapOrders(params: Record<string, string | number | undefined>, enabled = true) {
  return useQuery({
    queryKey: ['do-sap', params],
    queryFn: async () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== '__all__') qs.set(k, String(v))
      const r = await apiClient.get(`/external/do-sap?${qs.toString()}`)
      return r.data.data as { items: DoSapRow[]; total: number; page: number; page_size: number; plan_filter_warning?: string }
    },
    enabled,   // bắt buộc chọn ngày mới fetch (không tự kéo cả bảng)
    placeholderData: keepPreviousData,
  })
}
export function useDoSapFacets() {
  return useQuery({
    queryKey: ['do-sap-facets'],
    queryFn: async () => (await apiClient.get('/external/do-sap/facets')).data.data as { plants: string[]; sources: string[]; shiptos: { code: string; name: string }[] },
  })
}
// DO SAP mutations invalidate CHÉO: ['khvc'] (cột "Trong DO SAP") + reconcile keys + ['gdos']
// — vì sửa/xóa raw kích engine reconcileFromSap: có thể TỰ ÁP vào đơn Xuất (Z1/Z2) + sinh task "Cần xử lý".
function invalidateDoSapRelated(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [['do-sap'], ['khvc'], ['reconcile-tasks'], ['reconcile-open-count'], ['gdos']])
    qc.invalidateQueries({ queryKey: key })
}
export function useCreateDoSap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<DoSapRow>) => apiClient.post('/external/do-sap', body).then(r => r.data.data as DoSapRow),
    onSuccess: () => { invalidateDoSapRelated(qc); qc.invalidateQueries({ queryKey: ['do-sap-facets'] }) },
  })
}
export function useUpdateDoSap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<DoSapRow> & { id: string }) => apiClient.put(`/external/do-sap/${id}`, body).then(r => r.data.data as DoSapRow),
    onSuccess: () => invalidateDoSapRelated(qc),
  })
}
export function useDeleteDoSap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/external/do-sap/${id}`).then(r => r.data.data),
    onSuccess: () => invalidateDoSapRelated(qc),
  })
}
export function useBulkDeleteDoSap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => apiClient.post('/external/do-sap/bulk-delete', { ids }).then(r => r.data.data),
    onSuccess: () => invalidateDoSapRelated(qc),
  })
}

// ─── Dữ liệu bên ngoài → Kế hoạch xuất (raw khvc_lines) ──────────────────────
export interface KhvcRow {
  id: string; group_code: string; do_no: string; warehouse_code: string | null
  npp: string | null; veh_type: string | null; dvvt: string | null
  priority: string | null; cs: string | null; note: string | null
  booking_category: string | null   // CỬA đặt lịch — 1 Số xe chỉ 1 giá trị (trigger DB gác); chỉ dùng cho khung giờ
  export_date: string | null; source: string | null; sync_status: string | null
  gdo_id: string | null; uploaded_by: string | null; created_at: string; updated_at: string
  manual_edited_at?: string | null   // dòng bị SỬA TAY — upload KHVC đè lại sẽ gỡ; FE hiện ✎ sau DO
  materialized?: boolean; gdo_status?: string | null; do_ready?: boolean   // enrich từ BE list
  gdo_date?: string | null   // ngày chuyến bên Xuất (enrich) — ≠ export_date ⇒ lệch ngày (chuyến bị chuyển ngày)
}
export function useKhvcLines(params: Record<string, string | number | undefined>, enabled = true) {
  return useQuery({
    queryKey: ['khvc', params],
    queryFn: async () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== '__all__') qs.set(k, String(v))
      const r = await apiClient.get(`/external/khvc?${qs.toString()}`)
      return r.data.data as { items: KhvcRow[]; total: number; page: number; page_size: number; do_sap_filter_warning?: string; gdo_issue_warning?: string }
    },
    enabled,   // bắt buộc chọn ngày mới fetch (không tự kéo cả bảng)
    placeholderData: keepPreviousData,
  })
}
export function useKhvcFacets() {
  return useQuery({
    queryKey: ['khvc-facets'],
    queryFn: async () => (await apiClient.get('/external/khvc/facets')).data.data as { warehouses: string[]; veh_types: string[]; sources: string[]; npps: string[] },
  })
}
// KHVC mutations invalidate CHÉO cả ['do-sap'] — cột "Số xe (KH)"/"Ngày xuất (KH)" bên DO SAP
// enrich từ khvc_lines (mirror TABLE_QUERY_MAP khvc_lines→[khvc, khvc-facets, do-sap]; realtime chỉ lo cross-user).
// CRUD Kế hoạch xuất TỰ DỘI xuống chuyến (replan 02/08). Replan là AUGMENT — có thể lỗi riêng
// (validation Số xe/ĐVVT, scope loại hàng…) trong khi dòng kế hoạch ĐÃ LƯU ⇒ phải BÁO cho user
// biết "kế hoạch đã lưu nhưng chuyến CHƯA cập nhật", không để lệch âm thầm.
function warnKhvcReplan(data: unknown) {
  const d = data as { replan?: { derive?: { status?: number; error?: { message?: string } } | null }; replan_error?: string } | null
  const st = d?.replan?.derive?.status
  const msg = d?.replan_error ?? (st && st >= 400 ? (d?.replan?.derive?.error?.message ?? `lỗi ${st}`) : null)
  if (msg) toast({
    variant: 'destructive', title: 'Kế hoạch đã lưu nhưng CHUYẾN chưa cập nhật',
    description: String(msg).slice(0, 300),
  })
}
export function useCreateKhvc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<KhvcRow>) => apiClient.post('/external/khvc', body).then(r => r.data.data as KhvcRow),
    onSuccess: (data) => { warnKhvcReplan(data); qc.invalidateQueries({ queryKey: ['khvc'] }); qc.invalidateQueries({ queryKey: ['khvc-facets'] }); qc.invalidateQueries({ queryKey: ['do-sap'] }) },
  })
}
export function useUpdateKhvc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<KhvcRow> & { id: string }) => apiClient.put(`/external/khvc/${id}`, body).then(r => r.data.data as KhvcRow),
    onSuccess: (data) => { warnKhvcReplan(data); qc.invalidateQueries({ queryKey: ['khvc'] }); qc.invalidateQueries({ queryKey: ['do-sap'] }) },
  })
}
export function useDeleteKhvc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/external/khvc/${id}`).then(r => r.data.data),
    onSuccess: (data) => { warnKhvcReplan(data); qc.invalidateQueries({ queryKey: ['khvc'] }); qc.invalidateQueries({ queryKey: ['do-sap'] }) },
  })
}
export function useBulkDeleteKhvc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => apiClient.post('/external/khvc/bulk-delete', { ids }).then(r => r.data.data),
    onSuccess: (data) => { warnKhvcReplan(data); qc.invalidateQueries({ queryKey: ['khvc'] }); qc.invalidateQueries({ queryKey: ['do-sap'] }) },
  })
}
// Đổi Ngày xuất HÀNG LOẠT theo Số xe (tick dòng nào → đổi CẢ XE đó); xe có chuyến đang xuất/đã HT bị chặn per-xe
export interface BulkDateKhvcResult { updated_groups: number; updated_lines: number; blocked: { group_code: string; reason: string }[] }
export function useBulkDateKhvc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { ids: string[]; export_date: string }) =>
      apiClient.post('/external/khvc/bulk-date', body).then(r => r.data.data as BulkDateKhvcResult),
    onSuccess: (data) => { warnKhvcReplan(data); qc.invalidateQueries({ queryKey: ['khvc'] }); qc.invalidateQueries({ queryKey: ['do-sap'] }) },
  })
}

// ─── Đối chiếu SAP↔WMS → hàng chờ "Cần xử lý" (reconcile_tasks) ───────────────
export interface ReconcileTask {
  id: string; item_id: string | null; gdo_id: string | null; group_code: string | null
  material_code: string | null; material_name: string | null; od_number: string | null; od_item: string | null
  change_type: string; zone: string; action: string; status: string
  old_ordered: number | null; new_ordered: number | null; scanned: number | null
  detail: string | null; actor: string | null; resolution: string | null
  resolved_by: string | null; resolved_at: string | null; created_at: string; updated_at: string
}
export function useReconcileTasks(params: Record<string, string | number | undefined>, enabled = true) {
  return useQuery({
    queryKey: ['reconcile-tasks', params],
    queryFn: async () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== '__all__') qs.set(k, String(v))
      const r = await apiClient.get(`/wms/outbound/reconcile-tasks?${qs.toString()}`)
      return r.data.data as { items: ReconcileTask[]; total: number; page: number; page_size: number }
    },
    enabled,
    placeholderData: keepPreviousData,
  })
}
// Lịch sử thay đổi của 1 chuyến (nút "Thông tin") — chỉ tải khi mở hộp thoại
export function useOutboundEvents(gdoId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['gdo-events', gdoId],
    queryFn: async () => (await apiClient.get(`/wms/outbound/${gdoId}/events`)).data.data as
      { items: import('@/types').OutboundEvent[]; group_code: string },
    enabled: !!gdoId && enabled,
  })
}
export function useReconcileOpenCount(enabled = true) {
  return useQuery({
    queryKey: ['reconcile-open-count'],
    queryFn: async () => (await apiClient.get('/wms/outbound/reconcile-tasks/count')).data.data as { open: number },
    enabled,
  })
}
export function useResolveReconcileTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: 'apply' | 'keep' | 'manual_done' }) =>
      apiClient.post(`/wms/outbound/reconcile-tasks/${id}/resolve`, { resolution }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconcile-tasks'] })
      qc.invalidateQueries({ queryKey: ['reconcile-open-count'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })   // đơn xuất đổi số sau khi Áp SAP
    },
  })
}

export interface UploadResult { inserted: number; updated?: number; skipped?: number; errors: string[] }

// Báo cáo "KIỂM TRƯỚC KHI GHI" (?preflight=1) — khuôn CHUẨN chung mọi upload, khớp
// backend/src/utils/uploadPreflight.ts. Hiện bằng <UploadPreflightPanel/>.
export interface UploadPreflight {
  preflight: true
  unit: string
  total: number
  to_insert: number
  to_update: number
  skipped: number
  will_write: number
  mode: 'all_or_nothing' | 'per_row'
  errors: string[]
  errors_total: number
  warnings: string[]
  warnings_total: number
  extra: { label: string; value: string | number; warn?: boolean }[]
}

export function useUploadMaterialsExcel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, preflight }: { file: File; preflight?: boolean }): Promise<UploadResult & Partial<UploadPreflight>> => {
      guardUploadSize(file)
      const form = new FormData()
      form.append('file', file)
      return apiClient.post(`/masterdata/materials/upload${preflight ? '?preflight=1' : ''}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      }).then(r => r.data.data)
    },
    onSuccess: (_d, vars) => {
      if (vars.preflight) return           // chỉ KIỂM TRƯỚC, DB không đổi → khỏi refetch
      qc.invalidateQueries({ queryKey: ['materials'] })
      qc.invalidateQueries({ queryKey: ['material-categories'] })
    },
  })
}

export function useUploadLocationsExcel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, preflight }: { file: File; preflight?: boolean }): Promise<UploadResult & Partial<UploadPreflight>> => {
      guardUploadSize(file)
      const form = new FormData()
      form.append('file', file)
      return apiClient.post(`/masterdata/locations/upload${preflight ? '?preflight=1' : ''}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      }).then(r => r.data.data)
    },
    onSuccess: (_d, vars) => {
      if (vars.preflight) return           // chỉ KIỂM TRƯỚC, DB không đổi → khỏi refetch
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['locations'] })
      qc.invalidateQueries({ queryKey: ['sub-groups'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUploadInventoryExcel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, preflight }: { file: File; preflight?: boolean }): Promise<UploadResult & Partial<UploadPreflight>> => {
      guardUploadSize(file)
      const form = new FormData()
      form.append('file', file)
      return apiClient.post(`/wms/inventory/upload${preflight ? '?preflight=1' : ''}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      }).then(r => r.data.data)
    },
    onSuccess: (_d, vars) => {
      if (vars.preflight) return           // chỉ KIỂM TRƯỚC, DB không đổi → khỏi refetch
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-facets'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export function useScanOutboundItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, ...body }: {
      gdoId: string; itemId: string; qr_code: string; employee_id?: string; cartons_override?: number
      // Pallet đi không hết → vị trí cho phần dư: 'KEEP' (giữ chỗ cũ) hoặc id vị trí mới.
      // leftover_ui: bản FE này CÓ ô chọn vị trí ⇒ BE được phép siết 422 khi thiếu. Bundle cũ
      // (PWA chưa cập nhật) không gửi cờ này nên vẫn quét được như trước, không bị khoá.
      leftover_location_id?: string; leftover_ui?: boolean
      // timeout 12s: sóng yếu → fail sớm → ScanDialog tự xếp vào hàng đợi offline
    }) => apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/scan`, body, { timeout: 12000 }).then(r => r.data.data),
    onSuccess: (data: { scan_entry: { id: string; pallet_code: string; cartons_scanned: number }; item: { cartons_scanned: number; status: string } }, v) => {
      qc.setQueryData(['gdo', v.gdoId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          delivery_orders: old.delivery_orders?.map((d: any) => ({
            ...d,
            items: d.items?.map((item: any) => {
              if (item.id !== v.itemId) return item
              return {
                ...item,
                cartons_scanned: data.item.cartons_scanned,
                status:          data.item.status,
                scan_entries:    [...(item.scan_entries ?? []), {
                  ...data.scan_entry,
                  is_loose_picking: false, loose_confirmed: false, loose_confirmed_at: null,
                  scanned_by: null, scanned_at: new Date().toISOString(),
                  pct_date: null, production_date: null, best_available_date: null,
                }],
              }
            }),
          })),
        }
      })
      qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] })
      // quét xuất trừ tồn InventoryEntry → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

// Đính danh sách mã THÙNG (multiscan) vào 1 dòng scan pallet — truy vết, không đụng tồn.
export function useAttachCartonScans() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ scanId, cartons }: { gdoId: string; scanId: string; cartons: { code: string; match: boolean; at: number }[] }) =>
      apiClient.patch(`/wms/outbound/scan-entries/${scanId}/cartons`,
        { cartons: cartons.map(c => ({ code: c.code, match: c.match, at: new Date(c.at).toISOString() })) }).then(r => r.data.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] }),
  })
}

export function useManualCompleteItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, cartons, production_date }: { gdoId: string; itemId: string; cartons?: number; production_date?: string }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/manual-complete`,
        { ...(cartons != null ? { cartons } : {}), ...(production_date ? { production_date } : {}) }).then(r => r.data.data),
    onMutate: async ({ gdoId, itemId, cartons }) => {
      await qc.cancelQueries({ queryKey: ['gdo', gdoId] })
      const prev = qc.getQueryData(['gdo', gdoId])
      qc.setQueryData(['gdo', gdoId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          delivery_orders: old.delivery_orders?.map((d: any) => ({
            ...d,
            items: d.items?.map((item: any) =>
              item.id === itemId
                ? { ...item, status: 'COMPLETED', cartons_scanned: cartons ?? item.cartons_ordered }
                : item
            ),
          })),
        }
      })
      return { prev }
    },
    onError: (_e, { gdoId }, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['gdo', gdoId], ctx.prev)
    },
    onSettled: (_d, _e, { gdoId, itemId }) => {
      qc.invalidateQueries({ queryKey: ['gdo', gdoId] })
      qc.invalidateQueries({ queryKey: ['manual-item-stock', gdoId, itemId] })
      // manual-complete có thể trừ tồn → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export function useDeleteOutboundScanEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, scanId }: { gdoId: string; itemId: string; scanId: string }) =>
      apiClient.delete(`/wms/outbound/${gdoId}/items/${itemId}/scans/${scanId}`).then(r => r.data.data),
    onMutate: async ({ gdoId, itemId, scanId }) => {
      await qc.cancelQueries({ queryKey: ['gdo', gdoId] })
      const prev = qc.getQueryData(['gdo', gdoId])
      qc.setQueryData(['gdo', gdoId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          delivery_orders: old.delivery_orders?.map((d: any) => ({
            ...d,
            items: d.items?.map((item: any) => {
              if (item.id !== itemId) return item
              const entry = (item.scan_entries ?? []).find((e: any) => e.id === scanId)
              const removed = Number(entry?.cartons_scanned ?? 0)
              const newScanned = Math.max(0, Number(item.cartons_scanned) - removed)
              return {
                ...item,
                cartons_scanned: newScanned,
                status: newScanned === 0 ? 'PENDING' : newScanned < Number(item.cartons_ordered) ? 'IN_PROGRESS' : item.status,
                scan_entries: (item.scan_entries ?? []).filter((e: any) => e.id !== scanId),
              }
            }),
          })),
        }
      })
      return { prev, gdoId }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['gdo', ctx.gdoId], ctx.prev)
    },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] })
      qc.invalidateQueries({ queryKey: ['manual-item-stock', v.gdoId, v.itemId] })
      // xóa scan hoàn tồn kho lại → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export type ItemInventoryEntry = {
  id:                string
  pallet_code:       string
  cartons_remaining: number
  cartons_imported:  number
  location_code:     string | null
  production_date:   string | null
  import_date:       string | null
  pct_date:          number | null
  available:         number
  qa_status:         { id: string; code: string; name: string } | null
}

// Gợi ý vị trí lấy FEFO theo mã hàng của 1 chuyến (cột "Vị trí lấy" — thủ kho xem trên màn).
// Key prefix 'gdo' → realtime tự invalidate khi quét (reserve tồn đổi ⇒ gợi ý đổi).
// Dùng chung type PickSuggestion khai ở phần Bảng chuẩn bị hàng (bên dưới).
export function useGdoPickSuggestions(gdoId: string | undefined) {
  return useQuery({
    queryKey: ['gdo', 'pick-suggestions', gdoId],
    queryFn: () => apiClient.get(`/wms/outbound/${gdoId}/pick-suggestions`)
      .then(r => r.data.data as Record<string, PickSuggestion[]>),
    enabled: !!gdoId,
  })
}

export type CheckOutboundScanResult = {
  pallet_code:       string
  production_date:   string | null
  best_available_date: string | null
  available_cartons: number
  suggested_cartons: number
  // Vị trí phần còn lại (30/07): pallet đi không hết thì phải khai hàng dư nằm ở đâu
  inventory_entry_id?: string
  pallet_remaining?:   number
  location_id?:        string | null
  location_code?:      string | null
  warehouse_id?:       string | null
}

export function useConfirmLoosePickingItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, employee_id }: { gdoId: string; itemId: string; employee_id?: string }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/confirm-loose`, { employee_id }).then(r => r.data.data),
    onSuccess: (_d, v) => {
      // confirm-loose giảm tồn InventoryEntry → làm mới cả tồn kho & list nhặt lẻ
      qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] })
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['loosepicking'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export function useCheckOutboundScan() {
  return useMutation({
    mutationFn: ({ gdoId, itemId, qr_code, loose_picking_mode }: { gdoId: string; itemId: string; qr_code: string; loose_picking_mode?: boolean }) =>
      // timeout 12s (thay vì 30s mặc định): sóng kho chập chờn làm request treo —
      // fail sớm để flow quét chuyển sang hàng đợi offline, không bắt user đứng chờ
      // loose_picking_mode: chặn trùng CHỈ trong cùng chế độ (nhặt lẻ và Xuất quét được cùng pallet)
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/check-scan`, { qr_code, loose_picking_mode }, { timeout: 12000 }).then(r => r.data.data as CheckOutboundScanResult),
  })
}

export interface CheckScanResult {
  pallet_code: string
  production_date: string | null
  suggested_cartons: number
  outbound_cartons?: number | null
  will_merge?: boolean
  cartons_existing?: number
  existing_entry_id?: string
  merge_warning?: string
}

export function useCheckInboundScan() {
  return useMutation({
    mutationFn: ({ orderId, qr_code, location_id, stack_layer }: {
      orderId: string; qr_code: string; location_id: string; stack_layer: number
    }) =>
      // timeout 12s: sóng yếu → fail sớm, không treo camera 30s
      apiClient.post(`/wms/inbound-orders/${orderId}/check-scan`, { qr_code, location_id, stack_layer }, { timeout: 12000 })
        .then(r => r.data.data as CheckScanResult),
  })
}

export function useItemInventory(gdoId: string | undefined, itemId: string | undefined) {
  return useQuery({
    queryKey: ['item-inventory', gdoId, itemId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/outbound/${gdoId}/items/${itemId}/inventory`)
      return data.data as ItemInventoryEntry[]
    },
    enabled: !!gdoId && !!itemId,
    staleTime: 30_000,
  })
}

// Gợi ý vị trí lấy hàng FEFO (Bảng chuẩn bị hàng + cột "Vị trí lấy" trang chi tiết đơn).
export type PickSuggestion = { location_code: string | null; pct_date: number | null; available: number }

// Bảng chuẩn bị hàng — gom nhiều GDO. queryKey bắt đầu 'gdo' → OutboundItem/ScanEntry đổi
// tự invalidate (realtime trừ dần pallet cần chuẩn bị khi quét).
export type PrepareRow = {
  material_id: string | null; material_code: string; material_name: string | null
  cartons_ordered: number; cartons_scanned: number; cartons_remaining: number
  cartons_per_pallet: number; pallets_remaining: number; no_qr_tracking: boolean
  base_unit: string | null; entry_unit: string | null; units_per_carton: number | null
  suggestions: PickSuggestion[]
}
export type PrepareBoard = { rows: PrepareRow[]; total_cartons: number; total_pallets: number }

// Tồn kho theo mã hàng + kho (nút search tồn kho ở bảng chuẩn bị)
export function useInventoryByMaterial(materialId: string | null, warehouseId: string | undefined) {
  return useQuery({
    queryKey: ['inventory-by-material', materialId, warehouseId],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/inventory-by-material', {
        params: { material_id: materialId, warehouse_id: warehouseId || undefined },
      })
      return data.data as ItemInventoryEntry[]
    },
    enabled: !!materialId,
    staleTime: 15_000,
  })
}

export function usePrepareBoard(gdoIds: string[]) {
  const key = [...gdoIds].sort().join(',')
  return useQuery({
    queryKey: ['gdo', 'prepare', key],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/prepare', { params: { gdo_ids: key } })
      return data.data as PrepareBoard
    },
    enabled: gdoIds.length > 0,
    staleTime: 10_000,
  })
}

// Cảnh báo thiếu tồn theo (kho, ngày giao) — level 1: tồn thiếu nhưng tồn + KH nhập đủ
// (push hàng về đúng KH); level 2: tồn + KH nhập vẫn thiếu. Chỉ trả mã có cảnh báo.
export type OutboundShortage = { material_id: string; demand: number; available: number; planned: number; level: 1 | 2 }
export function useOutboundShortages(warehouseId: string | null | undefined, date: string | null | undefined) {
  return useQuery({
    queryKey: ['outbound-shortages', warehouseId, date],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/shortages', {
        params: { warehouse_id: warehouseId, date },
      })
      return data.data as OutboundShortage[]
    },
    enabled: !!warehouseId && !!date,
    staleTime: 15_000,
  })
}

export function useManualItemStock(gdoId: string | undefined, itemId: string | undefined) {
  return useQuery({
    queryKey: ['manual-item-stock', gdoId, itemId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/outbound/${gdoId}/items/${itemId}/manual-stock`)
      return data.data as { cartons_imported: number; cartons_remaining: number; cartons_ordered: number; cartons_scanned: number; inventory_mode: string | null; has_pool: boolean; date_pools?: { production_date: string | null; cartons_remaining: number }[] }
    },
    enabled: !!gdoId && !!itemId,
    staleTime: 0,
  })
}

export function useInventoryEntry(id?: string | null) {
  return useQuery({
    queryKey: ['inventory-entry', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inventory/${id}`)
      return data.data as InventoryEntry
    },
    staleTime: 60_000,
  })
}

export function useAssignGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, assigned_by }: { id: string; assigned_by?: string }) =>
      apiClient.post(`/wms/outbound/${id}/assign`, { assigned_by }).then(r => r.data.data),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['gdo', id] })
      const prev = qc.getQueryData(['gdo', id])
      qc.setQueryData(['gdo', id], (old: any) => old ? { ...old, assigned_at: new Date().toISOString() } : old)
      return { prev, id }
    },
    onError: (_, __, ctx: any) => ctx && qc.setQueryData(['gdo', ctx.id], ctx.prev),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}

export function useStartGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; license_plate?: string; container_number?: string
      exporter_name?: string; loader_name?: string
      forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
      // 2 rule cổng/cân per kho: KHÔNG có cờ bỏ qua nào ở đây — miễn trừ duy nhất là duyệt
      // trước trên chuyến (useWaiveWeighGDO, quyền outbound.weigh_waive)
    }) => apiClient.post(`/wms/outbound/${id}/start`, body).then(r => r.data.data),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['gdo', id] })
      const prev = qc.getQueryData(['gdo', id])
      qc.setQueryData(['gdo', id], (old: any) => old ? { ...old, started_at: new Date().toISOString(), status: 'IN_PROGRESS' } : old)
      return { prev, id }
    },
    onError: (_, __, ctx: any) => ctx && qc.setQueryData(['gdo', ctx.id], ctx.prev),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}

export function useUpdateTransport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; license_plate?: string; container_number?: string   // biển TÙY CHỌN khi chuyến đã duyệt bỏ qua cổng (giao lẻ)
      exporter_name?: string; loader_name?: string
      forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
    }) => apiClient.patch(`/wms/outbound/${id}/transport`, body).then(r => r.data.data as GDO),
    onSuccess: (data, { id }) => {
      qc.setQueryData(['gdo', id], data)
      qc.invalidateQueries({ queryKey: ['gdos'] })
    },
  })
}

function makeUndoGDOMutation(path: string, optimisticFn?: (old: any) => any, extraInvalidate?: string[][]) {
  return function() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: (id: string) => apiClient.post(`/wms/outbound/${id}/${path}`).then(r => r.data.data),
      onMutate: async (id: string) => {
        if (!optimisticFn) return
        await qc.cancelQueries({ queryKey: ['gdo', id] })
        const prev = qc.getQueryData(['gdo', id])
        qc.setQueryData(['gdo', id], (old: any) => old ? optimisticFn(old) : old)
        return { prev, id }
      },
      onError: (_, _id, ctx: any) => ctx?.prev && qc.setQueryData(['gdo', ctx.id], ctx.prev),
      onSettled: (_d, _e, id) => {
        qc.invalidateQueries({ queryKey: ['gdos'] })
        qc.invalidateQueries({ queryKey: ['gdo', id] })
        extraInvalidate?.forEach(key => qc.invalidateQueries({ queryKey: key }))
      },
    })
  }
}
// Duyệt / hủy duyệt BỎ QUA CÂN trên chuyến (quyền outbound.weigh_waive) — người duyệt có thể
// khác người bấm Bắt đầu: duyệt trước trên chuyến rồi công nhân start bình thường.
export function useWaiveWeighGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.post(`/wms/outbound/${id}/weigh-waive`, { reason }).then(r => r.data.data),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}
export function useUnwaiveWeighGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/wms/outbound/${id}/weigh-waive`).then(r => r.data.data),
    onSettled: (_, __, id) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}
// Rule 1 — đăng ký cổng (quyền outbound.gate_waive): duyệt cổng ⇒ biển số tùy chọn (giao lẻ/NV nhận)
export function useWaiveGateGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.post(`/wms/outbound/${id}/gate-waive`, { reason }).then(r => r.data.data),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}
export function useUnwaiveGateGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/wms/outbound/${id}/gate-waive`).then(r => r.data.data),
    onSettled: (_, __, id) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}

export const useUnassignGDO   = makeUndoGDOMutation('unassign',
  old => ({ ...old, assigned_at: null, assigned_by: null, status: 'PENDING' }))
export const useUnstartGDO    = makeUndoGDOMutation('unstart',
  old => ({ ...old, started_at: null, license_plate: null, container_number: null, exporter_name: null, loader_name: null, forklift_driver_id: null, forklift_driver_names: null, status: 'PENDING' }))
export const useUncompleteGDO = makeUndoGDOMutation('uncomplete',
  old => ({ ...old, status: 'IN_PROGRESS', completed_at: null, scan_completed_at: null }),
  [['tms-orders-paged'], ['tms-orders-summary'], ['tms-orders-transfer']])

export function useWarehouseEmployees(warehouse_id?: string | null) {
  return useQuery({
    queryKey: ['warehouse-employees', warehouse_id],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/employees', {
        params: warehouse_id ? { warehouse_id } : undefined,
      })
      return data.data as { id: string; name: string; employee_code: string; job_title?: string | null }[]
    },
  })
}

// ─── Outbound scan log (lịch sử quét xuất kho) ──────────────────────────────

export type OutboundScanLogEntry = {
  id: string
  pallet_code: string
  cartons_scanned: number
  production_date: string | null
  best_available_date: string | null
  scanned_at: string
  is_loose_picking: boolean
  loose_confirmed_at: string | null
  loose_confirmed_by_name: string | null
  group_code: string
  delivery_date: string | null
  license_plate: string | null
  container_number: string | null
  forklift_driver_names: string | null
  loader_name: string | null
  assigned_at: string | null
  started_at: string | null
  last_scanned_at: string | null
  completed_at: string | null
  warehouse_name: string
  delivery_code: string | null
  distributor_name: string | null
  header_text: string | null
  material_code_raw: string | null
  material_code: string | null
  material_name: string | null
  material_category: string | null
  shelf_life_days: number | null
  cycle: string | null
  machine_code: string | null
  nmsx: string | null
  import_date: string | null
  location_code: string | null
  scanner_name: string | null
  total_count: number
  // BASE UNIT (đợt 2): RPC trả kèm units để FE format "N thùng + M hộp"
  base_unit?: string | null
  entry_unit?: string | null
  units_per_carton?: number | null
  // Chỉ có ở SEARCH TỔNG (search_outbound_scan_log) — click dòng kết quả → mở đơn xuất
  gdo_id?: string | null
  item_id?: string | null
}

export type ScanLogParams = {
  from_date?: string
  to_date?: string
  warehouse_ids?: string       // comma-separated
  material_category?: string
  group_code?: string
  distributor?: string
  delivery_code?: string
  pallet_code?: string
  material?: string
  machine_codes?: string       // comma-separated
  cycles?: string              // comma-separated
  scanner_name?: string
  nmsx?: string                // comma-separated
  page?: number
  limit?: number
}

export function useOutboundScanLog(params: ScanLogParams, enabled = true) {
  return useQuery({
    queryKey: ['outbound-scan-log', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/scan-log', { params })
      return data.data as { rows: OutboundScanLogEntry[]; total: number; page: number; limit: number }
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData, // đổi trang/lọc: giữ dữ liệu cũ, không trắng bảng
  })
}

// SEARCH TỔNG lịch sử quét — 1 ô tìm mọi thứ, bypass chọn Kho/Loại kho (BE vẫn cắt scope user)
export function useScanLogSearch(q: string, page: number, enabled = true) {
  return useQuery({
    queryKey: ['outbound-scan-log-search', q, page],
    enabled: enabled && q.trim().length >= 2,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/scan-log/search', { params: { q, page, limit: 500 } })
      return data.data as { rows: OutboundScanLogEntry[]; total: number; page: number; limit: number }
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useOutboundScanLogFacets(materialCategory?: string) {
  return useQuery({
    queryKey: ['scan-log-facets', materialCategory],
    enabled: !!materialCategory,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/scan-log/facets', {
        params: { material_category: materialCategory },
      })
      return data.data as { machines: string[]; cycles: string[] }
    },
  })
}

// Export ScanLog: loop phân trang (BE cap limit=1000) gom toàn bộ dòng khớp filter đã áp.
export async function fetchScanLogExport(applied: ScanLogParams): Promise<OutboundScanLogEntry[]> {
  const LIMIT = 1000
  const all: OutboundScanLogEntry[] = []
  let page = 1
  for (;;) {
    const { data } = await apiClient.get('/wms/outbound/scan-log', { params: { ...applied, page, limit: LIMIT } })
    const d = data.data as { rows: OutboundScanLogEntry[]; total: number }
    all.push(...d.rows)
    if (d.rows.length === 0 || all.length >= d.total) break
    page++
  }
  return all
}

// ─── Phiếu cân trạm cân (WeighTicket) ────────────────────────────────────────
export interface WeighTicket {
  id: string
  station_code: string
  source_id: number
  ticket_no: string | null
  weigh_date: string | null
  license_plate: string | null      // NGUYÊN VĂN phần mềm cân in ra ("89G-00451") — giữ để đối chiếu phiếu giấy
  license_plate_norm: string | null // bỏ gạch/space + IN HOA ("89G00451") — dạng DÙNG CHUNG toàn app, ưu tiên hiển thị
  direction: string | null          // 'Cân Xuất' / 'Cân Nhập' (nguyên văn PM cân)
  goods_name: string | null
  trans_company: string | null
  tare_kg: number | null
  tare_at: string | null
  gross_kg: number | null
  gross_at: string | null
  net_kg: number | null
  in_time: string | null
  out_time: string | null
  is_complete: boolean
  gdo_id: string | null
  matched_at: string | null
  matched_by: string | null         // 'auto' hoặc tên user
  warehouse_id?: string | null      // kho của trạm cân (agent khai)
  warehouse_name?: string | null    // join tay từ BE
  gdo_group_code?: string | null    // join tay từ BE
  gdo_status?: string | null
  // Ước tính KL HÀNG của chuyến đã gắn (RPC gdo_weight_estimates) — đối chiếu với net_kg cân thực
  est_kg_planned?: number | null    // theo SL kế hoạch
  est_kg_actual?: number | null     // theo thực xuất (đã quét/ghi nhận)
  est_items_missing?: number | null // số mã thiếu KL (Material.weight_kg) — ước tính chưa trọn
  est_items_total?: number | null
}
export type WeighTicketParams = {
  from_date?: string; to_date?: string; q?: string
  direction?: string; match_state?: string; warehouse_ids?: string; page?: number; limit?: number
}
export function useWeighTickets(params: WeighTicketParams) {
  return useQuery({
    queryKey: ['weigh-tickets', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/weigh-tickets', { params })
      return data.data as { rows: WeighTicket[]; total: number; done: number; matched: number; page: number; limit: number }
    },
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  })
}
// Option filter Kho = chỉ các kho THỰC CÓ phiếu cân (BE cắt scope)
export function useWeighTicketWarehouses() {
  return useQuery({
    queryKey: ['weigh-ticket-warehouses'],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/weigh-tickets/warehouses')
      return data.data as { id: string; name: string }[]
    },
    staleTime: 5 * 60_000,
  })
}
export function useMatchWeighTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, gdo_id }: { id: string; gdo_id: string | null }) =>
      apiClient.patch(`/wms/weigh-tickets/${id}/match`, { gdo_id }).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['weigh-tickets'] }),
  })
}

// ─── Control Tower (Giám sát vận hành) ───────────────────────────────────────
export interface ControlTowerGateRow {
  plate: string | null; company: string | null; direction: string | null
  entry_at: string | null; warehouse_name: string | null; content: string | null
  warehouse_type?: string | null; vehicle_type?: string | null
}
export interface ControlTowerTrip {
  id: string; group_code: string; status: string; plate: string | null
  warehouse_name: string | null; planned: number; scanned: number; started_at: string | null
  npp: string | null; n_materials: number
  warehouse_type?: string | null; export_type?: string | null
}
export interface ControlTowerMatOut {
  code: string; name: string; category: string; ordered: number; scanned: number; loose: number
}
export interface ControlTowerMatIn {
  code: string; name: string; category: string; pallets: number; cartons: number
  // Đơn vị THẬT của `cartons`: entry_unit (mã có quy cách thùng) hoặc base_unit (EA/KG).
  // optional — RPC cũ (trước 20260729c) không trả field này.
  unit?: string | null
}
export interface ControlTowerData {
  date: string
  gate: { registered: number; called: number; inside: number; completed: number; inside_list: ControlTowerGateRow[] }
  outbound: { pending: number; in_progress: number; paused: number; completed: number; total: number
              planned: number; scanned: number; loose_planned?: number; loose_scanned?: number
              active: ControlTowerTrip[] }
  // 2 nhánh v2/v3 — optional: RPC cũ chưa re-apply thì FE vẫn chạy, khối hàng-theo-mã tự ẩn
  out_by_material?: { n_materials: number; n_done?: number; n_short?: number; list: ControlTowerMatOut[] }
  in_by_material?:  { n_materials: number; list: ControlTowerMatIn[] }
  inbound: { orders: number; pallets: number; cartons: number }
  weigh: { tickets: number; pending2: number; net_kg: number }
  hourly: { h: number; out_cartons: number; out_scans: number; in_pallets: number }[]
}
export function useControlTower(warehouseIds: string[], categories: string[] = [], materialCodes: string[] = []) {
  return useQuery({
    queryKey: ['control-tower', warehouseIds.join(','), categories.join(','), materialCodes.join(',')],
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (warehouseIds.length > 0) params.warehouse_ids = warehouseIds.join(',')
      if (categories.length > 0) params.categories = categories.join(',')
      if (materialCodes.length > 0) params.material_codes = materialCodes.join(',')
      const { data } = await apiClient.get('/wms/control-tower', { params })
      return data.data as ControlTowerData
    },
    staleTime: 20_000,
    refetchInterval: 60_000,   // lưới an toàn khi realtime im (TV treo cả ngày)
    placeholderData: keepPreviousData,
  })
}

// ─── Slotting (Tối ưu vị trí) ────────────────────────────────────────────────
export type SlottingLevel = 'EASY' | 'NORMAL' | 'HARD'
export type SlottingPrinciple = 'FIFO' | 'FEFO' | 'LIFO'
export interface SlottingZone {
  id: string; code: string; name: string; categories: string[] | null
  pick_rank: number | null; flow_type: string | null
  capacity: number; used_slots: number; band: 'A' | 'B' | 'C' | null
}
export interface SlottingMaterial {
  material_id: string; code: string; name: string | null; category: string | null
  picks: number; cartons_out: number; pallets_touched: number
  stock_pallets: number; stock_cartons: number; abc: 'A' | 'B' | 'C'; cum_share: number
  zones_current: { sub_code: string | null; pallets: number; cartons: number }[]
  suggested_zones: string[]; misplaced_pallets: number
}
// Pallet nằm ở khu có Loại KHÁC Loại của mã (vd hàng thường trong khu SCA) — chỉ cảnh báo
export interface SlottingWarning {
  type: 'WRONG_CATEGORY'
  material_code: string; material_name: string | null; material_category: string | null
  zone_code: string; zone_category: string; pallets: number
}
export interface SlottingData {
  window_days: number; total_picks: number; has_ranked_zones: boolean
  zones: SlottingZone[]; materials: SlottingMaterial[]
  // `warnings` chỉ là PHẦN ĐẦU (tối đa 50 dòng) — tổng đếm trên toàn bộ nằm ở 2 field dưới.
  // Trước đây trả cả danh sách: 3.269 dòng = 598KB chỉ để đổ vào 1 tooltip không ai đọc hết.
  warnings: SlottingWarning[]; warnings_total?: number; warnings_pallets?: number
  // `materials` chỉ là 1 TRANG (2.378 mã = 902KB; 10.000 mã ≈ 3,8MB vượt trần 4,5MB).
  // Xếp hạng A/B/C vẫn tính trên ĐỦ TẬP ở server (là % lũy kế — cắt trang trước khi xếp hạng
  // thì trang nào cũng toàn hạng A). 5 số dưới cũng đếm trên đủ tập khớp lọc.
  materials_total?: number; page?: number; page_size?: number
  n_a?: number; n_b?: number; n_c?: number
  misplaced_mats?: number; misplaced_pallets?: number
}
export function useSlotting(
  warehouseId: string, categories: string[] = [], days = 30,
  page = 1, pageSize = 200, search = '',
) {
  return useQuery({
    queryKey: ['slotting', warehouseId, categories.join(','), days, page, pageSize, search],
    enabled: !!warehouseId,
    queryFn: async () => {
      const params: Record<string, string> = {
        warehouse_id: warehouseId, days: String(days),
        page: String(page), page_size: String(pageSize),
      }
      if (categories.length > 0) params.categories = categories.join(',')
      if (search) params.search = search           // tìm mã/tên trên SERVER
      const { data } = await apiClient.get('/wms/slotting', { params })
      return data.data as SlottingData
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

// Dòng kế hoạch GOM theo (mã + date) — user chốt 17/07, không per-pallet
export interface SlottingPlanLineDraft {
  material_id: string; material_code: string | null; material_name: string | null
  date_key: string | null; n_pallets: number; entry_ids: string[]
  abc: 'A' | 'B' | 'C' | null; reason: string; flow_note: string | null
  from_location_id: string | null; from_location_code: string | null
  to_location_id: string; to_location_code: string | null
  // Phân tích kỳ vọng (chỉ có trong preview — không lưu vào plan): đích đang chứa gì / chỗ trống còn lại sau chuyển
  to_current?: string
  to_free_after?: number
}
// Kết quả kỳ vọng nếu thực hiện đủ kế hoạch (tính trên danh sách dòng preview đã cắt trần)
export interface SlottingImpact {
  lines: number; moved_pallets: number
  freed_locations: number; freed_location_codes: string[]
  wrong_zone_pallets: number; temp_cleared_pallets: number
  abc_pallets: number; date_group_pallets: number; free_group_pallets: number
}
export interface SlottingPlanRow {
  id: string; warehouse_id: string; name: string; status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  level: SlottingLevel | null; principle: SlottingPrinciple | null
  note: string | null; window_days: number | null; n_lines: number
  created_by: string | null; created_at: string; completed_at: string | null; completed_by: string | null
  progress: { done_pallets: number; total_pallets: number; done_lines: number; total_lines: number } | null
}
export interface SlottingPlanLineRow {
  id: string; material_code: string | null; material_name: string | null; date_key: string | null
  abc: string | null; reason: string | null; flow_note: string | null
  from_location_id: string | null
  from_location_code: string | null; to_location_code: string | null; to_location_id: string
  from_pallets_now?: number | null; to_pallets_now?: number | null // số pallet HIỆN có ở vị trí đi/đích
  n_pallets: number
  status: 'PENDING' | 'PARTIAL' | 'DONE' | 'GONE'
  done: number; pending: number; moved_other: number; gone: number
  moved_at: string | null; moved_by_name: string | null
}
export interface SlottingPlanDetailData extends Omit<SlottingPlanRow, 'progress'> {
  summary: {
    total_lines: number; done_lines: number; partial_lines: number; pending_lines: number
    total_pallets: number; done_pallets: number; gone_pallets: number; moved_other_pallets: number; pending_pallets: number
  }
  lines: SlottingPlanLineRow[]
}
export function useSlottingPlans(warehouseId?: string) {
  return useQuery({
    queryKey: ['slotting-plans', warehouseId ?? 'all'],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/slotting/plans', {
        params: warehouseId ? { warehouse_id: warehouseId } : undefined,
      })
      return data.data as SlottingPlanRow[]
    },
    staleTime: 20_000,
  })
}
export function useSlottingPlan(id: string | undefined) {
  return useQuery({
    queryKey: ['slotting-plan', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/slotting/plans/${id}`)
      return data.data as SlottingPlanDetailData
    },
    staleTime: 10_000,
  })
}
export function useSlottingPreview() {
  return useMutation({
    mutationFn: (body: { warehouse_id: string; level: SlottingLevel; principle: SlottingPrinciple; days: number; max_moves: number; pull_wrong_zone?: boolean; pallet_kind?: 'FULL' | 'PARTIAL' | 'ALL'; categories?: string[] }) =>
      apiClient.post('/wms/slotting/plans/preview', body).then(r => r.data.data as {
        lines: SlottingPlanLineDraft[]; impact: SlottingImpact | undefined; total_generated?: number
        skipped_no_capacity: number; warnings: SlottingWarning[]; message?: string
      }),
  })
}
export function useCreateSlottingPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; name: string; level: SlottingLevel; principle: SlottingPrinciple; window_days?: number; note?: string; lines: SlottingPlanLineDraft[] }) =>
      apiClient.post('/wms/slotting/plans', body).then(r => r.data.data as { id: string; n_lines: number }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['slotting-plans'] }),
  })
}
export function useUpdateSlottingPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'COMPLETED' | 'CANCELLED' | 'ACTIVE' }) =>
      apiClient.patch(`/wms/slotting/plans/${id}`, { status }).then(r => r.data.data),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['slotting-plans'] })
      qc.invalidateQueries({ queryKey: ['slotting-plan', v.id] })
    },
  })
}
export function useDeleteSlottingPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/slotting/plans/${id}`).then(r => r.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['slotting-plans'] }),
  })
}
// Cấu hình slotting của VỊ TRÍ (tab Cài đặt): no_in = không đưa hàng vào (kho tạm); no_out = không lấy hàng đi
export function useUpdateSlottingLocationConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; no_in_ids: string[]; no_out_ids: string[] }) =>
      apiClient.put('/wms/slotting/location-config', body).then(r => r.data.data as { no_in: number; no_out: number }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['slotting'] })
    },
  })
}
// Cấu hình slotting của KHU (tab Cài đặt trang Tối ưu vị trí — quyền slotting.configure)
export function useUpdateSlottingZoneConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; pick_rank?: number | null; flow_type?: string | null }) =>
      apiClient.patch(`/wms/slotting/zone-config/${id}`, body).then(r => r.data.data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-zones'] })
      qc.invalidateQueries({ queryKey: ['slotting'] })
    },
  })
}

// ─── FILL HÀNG phục vụ nhặt lẻ (04/08) ───────────────────────────────────────
// Mọi số lượng từ API là BASE UNIT — quy đổi "thùng" chỉ ở tầng hiển thị, và tổng cross-mã
// phải qua qtyEntryDecimal per-mã (nhãn QTY_CONVERTED_LABEL), không cộng base thô.

export interface FillSuggestion {
  entry_id: string; pallet_code: string
  from_location_id: string | null; from_location_code: string | null
  avail: number; production_date: string | null; expiry_date: string | null
}
// Pallet ứng viên cho dialog "Chọn date" (fill_candidates — FEFO, cùng điều kiện nguồn fill_demand)
export interface FillCandidate {
  entry_id: string; pallet_code: string
  from_location_id: string | null; from_location_code: string | null
  avail: number; production_date: string | null; fefo_key: string | null
}
export function useFillCandidates(params?: { warehouse_id: string; material_id: string }) {
  return useQuery({
    queryKey: ['fill-candidates', params],
    enabled: !!params?.warehouse_id && !!params?.material_id,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/fill/candidates', { params })
      return data.data as { rows: FillCandidate[] }
    },
  })
}
export interface FillDemandRow {
  material_id: string; material_code: string | null; material_name: string | null
  category: string | null
  base_unit: string | null; entry_unit: string | null; units_per_carton: number | null
  demand_base: number; pick_face_base: number; pick_face_pallets: number
  pending_base: number; pending_n: number; short_base: number
  to_location: { id: string; code: string } | null
  suggestions: FillSuggestion[]
}
export interface FillDemandData {
  rows: FillDemandRow[]; pick_face_locations: number; error?: string
}
export function useFillDemand(params?: { warehouse_id: string; date: string }) {
  return useQuery({
    queryKey: ['fill-demand', params?.warehouse_id, params?.date],
    enabled: !!params?.warehouse_id,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/fill/demand', { params })
      return data.data as FillDemandData
    },
  })
}

export type FillTaskStatus = 'PENDING' | 'DONE' | 'CANCELLED'
// DÒNG của lệnh fill (v3 05/08 — chỉ định theo DATE, không ghim pallet)
export interface FillTaskRow {
  id: string; fill_order_id: string; warehouse_id: string; target_date: string
  material_id: string; material_code: string | null; material_name: string | null
  required_date: string | null; required_expiry: string | null
  required_pallets: number; scanned_pallets: number
  qty_base: number; qty_done_base: number
  from_location_code: string | null            // gợi ý "lấy tại đâu" chụp lúc ra lệnh
  to_location_id: string; to_location_code: string | null
  status: FillTaskStatus
  assignee_id: string | null; assignee_name: string | null
  assigned_by: string | null; assigned_at: string | null
  done_by: string | null; done_by_name: string | null; done_at: string | null
  cancel_reason: string | null; created_by: string | null; created_at: string
  entry_unit: string | null; units_per_carton: number | null; base_unit: string | null
}
// LỆNH fill (gom nhiều dòng mã — một lần "Ra lệnh fill")
export interface FillOrderRow {
  id: string; order_code: string; warehouse_id: string; target_date: string
  status: FillTaskStatus; created_by: string | null; created_at: string
  lines_n: number; pending_lines: number; done_lines: number; cancelled_lines: number
  pallets_req: number; pallets_done: number
  qty_req_entry: number; qty_done_entry: number
  assignees: string | null; mat_codes: string | null; mat_names: string | null
  src_hints: string | null; dest_codes: string | null   // vị trí LẤY / VỀ của việc còn treo (card mobile)
}
export interface FillOrdersData {
  rows: FillOrderRow[]; total: number
  pending_n: number; done_n: number; cancelled_n: number; done_qty_entry: number
}
export function useFillOrders(params?: {
  warehouse_id: string; date_from?: string; date_to?: string
  status?: string; assignee_id?: string; mine?: string; search?: string
  page?: number; page_size?: number
}) {
  return useQuery({
    queryKey: ['fill-orders', params],
    enabled: !!params?.warehouse_id,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/fill/orders', { params })
      return data.data as FillOrdersData
    },
  })
}
export interface FillScanRow {
  id: string; task_id: string; entry_id: string; pallet_code: string
  qty_base: number; production_date: string | null
  from_location_code: string | null; to_location_code: string | null
  scanned_by_name: string | null; created_at: string
}
export function useFillOrder(orderId?: string) {
  return useQuery({
    queryKey: ['fill-order', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/fill/orders/${orderId}`)
      const d = data.data as {
        order: { id: string; order_code: string; warehouse_id: string; target_date: string
                 status: FillTaskStatus; created_by: string | null; created_at: string }
        lines: (FillTaskRow & { material: { entry_unit: string | null; units_per_carton: number | null; base_unit: string | null } | null })[]
        scans: FillScanRow[]
      }
      // Trải đơn vị của mã lên dòng để qtyLabel dùng thẳng
      return { ...d, lines: d.lines.map(l => ({ ...l, ...(l.material ?? {}) })) }
    },
  })
}

export interface FillReportRow {
  assignee_id: string | null; assignee_name: string
  total_n: number; done_n: number; pending_n: number
  done_qty_entry: number; total_qty_entry: number
  avg_minutes: number | null; rate: number
}
export function useFillReport(params?: { warehouse_id: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['fill-report', params],
    enabled: !!params?.warehouse_id,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/fill/report', { params })
      return data.data as { rows: FillReportRow[]; total: number; done: number; unassigned: number; qty_entry: number }
    },
  })
}

// materialId: BE lọc luôn theo LOẠI KHO của mã — đừng bày lựa chọn mà lưu sẽ bị 400
export function usePickFaceLocations(warehouseId?: string, materialId?: string) {
  return useQuery({
    queryKey: ['fill-pick-face-locations', warehouseId, materialId ?? null],
    enabled: !!warehouseId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/fill/pick-face-locations', {
        params: { warehouse_id: warehouseId, material_id: materialId || undefined },
      })
      return data.data as { id: string; location_code: string; sub_code: string | null; max_pallets: number }[]
    },
  })
}

/** Danh sách nhân sự theo kho cho ô "Giao cho" — route riêng của Fill (quyền fill.assign). */
export function useFillEmployees(warehouseId?: string) {
  return useQuery({
    queryKey: ['fill-employees', warehouseId],
    enabled: !!warehouseId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/fill/employees', { params: { warehouse_id: warehouseId } })
      return data.data as { id: string; name: string; employee_code: string; job_title?: string | null }[]
    },
  })
}

const invalidateFill = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['fill-orders'] })
  qc.invalidateQueries({ queryKey: ['fill-order'] })
  qc.invalidateQueries({ queryKey: ['fill-demand'] })   // dòng treo trừ vào phần "thiếu"
  qc.invalidateQueries({ queryKey: ['fill-report'] })
}

export interface FillOrderSkipped { material_code?: string; required_date?: string | null; reason: string }
// Đơn phát sinh: dòng trùng (mã, date) với dòng đang treo → BE CỘNG DỒN vào dòng cũ (05/08)
export interface FillOrderMerged {
  material_code: string; required_date: string | null
  added_qty: number; added_pallets: number; order_code: string | null
}
export function useCreateFillOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string; target_date?: string   // bỏ trống = BE lấy hôm nay (giờ VN)
      assignee_id?: string
      lines: {
        material_id: string; required_date?: string | null; required_expiry?: string | null
        qty_base: number; required_pallets: number; src_hint?: string; to_location_id?: string
      }[]
    }) => apiClient.post('/wms/fill/orders', body)
      .then(r => r.data.data as { created: number; skipped: FillOrderSkipped[]; merged: FillOrderMerged[]; order_id?: string; order_code?: string }),
    onSettled: () => invalidateFill(qc),
  })
}

export function useCancelFillOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.delete(`/wms/fill/orders/${id}`, { data: reason ? { reason } : undefined }).then(r => r.data.data),
    onSettled: () => invalidateFill(qc),
  })
}

export function useUpdateFillTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; assignee_id?: string | null; to_location_id?: string }) =>
      apiClient.patch(`/wms/fill/tasks/${id}`, body).then(r => r.data.data as FillTaskRow),
    onSettled: () => invalidateFill(qc),
  })
}

export function useCancelFillTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.delete(`/wms/fill/tasks/${id}`, { data: reason ? { reason } : undefined }).then(r => r.data.data),
    onSettled: () => invalidateFill(qc),
  })
}

// ─── TMS ─────────────────────────────────────────────────────────────────────

export function useVehicleTypesByWarehouse(warehouseId: string | null, cargoType?: string) {
  return useQuery<TmsVehicleType[]>({
    queryKey: ['tms-vehicle-types-by-warehouse', warehouseId, cargoType ?? null],
    enabled: !!warehouseId,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const params: Record<string, string> = { warehouse_id: warehouseId! }
      if (cargoType) params.cargo_type = cargoType
      const { data } = await apiClient.get('/tms/slot-templates/vehicle-types', { params })
      return data.data as TmsVehicleType[]
    },
  })
}

export function useVehicleTypes(onlyActive = false) {
  return useQuery({
    queryKey: ['tms-vehicle-types', onlyActive],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/vehicle-types', {
        params: onlyActive ? { is_active: 'true' } : {},
      })
      return data.data as TmsVehicleType[]
    },
  })
}

export function useCreateVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; box_length_mm?: number | null; box_width_mm?: number | null; box_height_mm?: number | null }) =>
      apiClient.post('/tms/vehicle-types', body).then(r => r.data.data as TmsVehicleType),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

// Kéo-thả sắp thứ tự loại xe (sort_order) — ids theo thứ tự mới
export function useReorderVehicleTypes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.put('/tms/vehicle-types/reorder', { ids }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

export function useUpdateVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; is_active?: boolean; box_length_mm?: number | null; box_width_mm?: number | null; box_height_mm?: number | null }) =>
      apiClient.put(`/tms/vehicle-types/${id}`, body).then(r => r.data.data as TmsVehicleType),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

export function useDeleteVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/vehicle-types/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

export function useSlotTemplates(params?: { warehouse_id?: string; vehicle_type_id?: string }) {
  return useQuery({
    queryKey: ['tms-slot-templates', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/slot-templates', { params })
      return data.data as SlotTemplate[]
    },
    enabled: !!params?.warehouse_id,
  })
}

export function useCreateSlotTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string; vehicle_type_id: string; cargo_type?: string
      days_of_week: number[]; time_from: string; time_to: string; max_vehicles: number
    }) => apiClient.post('/tms/slot-templates', body).then(r => r.data.data as SlotTemplate[]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-slot-templates'] }),
  })
}

export function useUpdateSlotTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; time_from?: string; time_to?: string; max_vehicles?: number; cargo_type?: string; is_active?: boolean }) =>
      apiClient.put(`/tms/slot-templates/${id}`, body).then(r => r.data.data as SlotTemplate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })   // reapply đổi slot ngày tương lai
    },
  })
}

export function useDeleteSlotTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/slot-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

// Lưu cả cụm khung giờ (lưới thứ × khung giờ) của 1 loại xe
export function useBatchSlotTemplates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string; vehicle_type_id: string; cargo_type: string
      days_of_week: number[]; time_slots: { time_from: string; time_to: string; max_vehicles: number }[]
    }) => apiClient.post('/tms/slot-templates/batch', body).then(r => r.data.data as { inserted: number; updated: number; removed: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicle-types-by-warehouse'] })
    },
  })
}

// Xóa cả cụm khung giờ (rule) của 1 loại xe + loại kho
export function useDeleteSlotTemplateCluster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { warehouse_id: string; vehicle_type_id: string; cargo_type: string }) =>
      apiClient.delete('/tms/slot-templates/cluster', { params }).then(r => r.data.data as { deleted: number; deactivated: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicle-types-by-warehouse'] })
    },
  })
}

export interface SlotApplyInfo {
  today: string
  applicable_from: string | null
  nearest_blocked: { date: string; booked: number } | null
}
export function useSlotApplyInfo(params: { warehouse_id?: string; vehicle_type_id?: string }) {
  return useQuery({
    queryKey: ['tms-slot-apply-info', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/slot-templates/apply-info', { params })
      return data.data as SlotApplyInfo
    },
    enabled: !!params.warehouse_id && !!params.vehicle_type_id,
  })
}

export function useTransportCompanies(onlyActive = false, type?: 'NCC' | 'ĐVVT') {
  return useQuery({
    queryKey: ['tms-transport-companies', onlyActive, type ?? ''],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/transport-companies', {
        params: { ...(onlyActive ? { is_active: 'true' } : {}), ...(type ? { type } : {}) },
      })
      return data.data as TransportCompany[]
    },
  })
}

export function useCreateTransportCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; type?: 'ĐVVT' | 'NCC'; contact_name?: string; contact_phone?: string; alias_codes?: string }) =>
      apiClient.post('/tms/transport-companies', body).then(r => r.data.data as TransportCompany),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-transport-companies'] }),
  })
}

export function useUpdateTransportCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; type?: 'ĐVVT' | 'NCC'; contact_name?: string; contact_phone?: string; is_active?: boolean; alias_codes?: string }) =>
      apiClient.put(`/tms/transport-companies/${id}`, body).then(r => r.data.data as TransportCompany),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-transport-companies'] }),
  })
}

export function useTmsVehicles(params?: { ncc_id?: string; is_active?: string; unassigned?: string; pool_branches?: string }, enabled = true) {
  return useQuery({
    queryKey: ['tms-vehicles', params],
    enabled,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/vehicles', { params })
      return data.data as TmsVehicle[]
    },
  })
}

// Danh mục XE phân trang SERVER — tab "Xe" trước đây nạp cả đội xe (4.953 xe = 2.300KB) rồi lọc
// client; biển số xe thuộc nhóm danh mục KHÔNG được nạp cả vào trình duyệt (CLAUDE.md).
export interface TmsVehiclesPage {
  items: TmsVehicle[]; total: number; active: number; inactive: number; page: number; page_size: number
}
export function useTmsVehiclesPaged(
  params: { ncc_ids?: string[]; vehicle_type_ids?: string[]; is_active?: string; search?: string; page: number; page_size: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ['tms-vehicles-paged', params],
    enabled,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { ncc_ids, vehicle_type_ids, ...rest } = params
      const { data } = await apiClient.get('/tms/vehicles', {
        params: {
          ...rest,
          ...(ncc_ids?.length          ? { ncc_ids:          ncc_ids.join(',')          } : {}),
          ...(vehicle_type_ids?.length ? { vehicle_type_ids: vehicle_type_ids.join(',') } : {}),
        },
      })
      return data.data as TmsVehiclesPage
    },
  })
}

export function useCreateTmsVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { ncc_id: string; license_plate: string; vehicle_type_id: string }) =>
      apiClient.post('/tms/vehicles', body).then(r => r.data.data as TmsVehicle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-vehicles'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicles-paged'] })
    },
  })
}

export function useUpdateTmsVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; ncc_id?: string; license_plate?: string; vehicle_type_id?: string; is_active?: boolean }) =>
      apiClient.put(`/tms/vehicles/${id}`, body).then(r => r.data.data as TmsVehicle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-vehicles'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicles-paged'] })
    },
  })
}

export function useDeleteTmsVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/vehicles/${id}`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-vehicles'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicles-paged'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
  })
}

export function useDeleteTransportCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/transport-companies/${id}`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-transport-companies'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicles'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
  })
}

// ── TMS Delivery Slots ────────────────────────────────────────────────────────

export function useDeliverySlots(params?: { date?: string; warehouse_id?: string; direction?: string }) {
  return useQuery({
    queryKey: ['tms-delivery-slots', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/slots', { params })
      return data.data as import('@/types').DeliverySlot[]
    },
    enabled: !!params?.date && !!params?.warehouse_id,
  })
}

export function useGenerateSlots() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; dates: string[] }) =>
      apiClient.post('/tms/slots/generate', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] }),
  })
}

// ── TMS Orders ───────────────────────────────────────────────────────────────

// ─── Lưới Kế hoạch vận chuyển: PHÂN TRANG SERVER ────────────────────────────────────────────────
// Đơn vị trang = CỤM xe gom (đơn chủ + đơn gom chung xe) → lưới rowspan không bị cắt ngang trang;
// vì thế số đơn mỗi trang xê dịch, `page_from`/`page_to` do SERVER trả (FE không tự nhân page*size).
export type TmsListFilterParams = {
  date_from: string; date_to: string; warehouse_id?: string
  directions?: string[]; dvvt?: string[]; wh_types?: string[]; vehicle_types?: string[]
  slot_ids?: string[]; unbooked?: boolean
  search?: string          // ô tìm nhanh — LỌC TRÊN SERVER (lưới phân trang, lọc client chỉ soi 1 trang)
}
export type TmsOrdersPage = {
  rows: import('@/types').TmsOrder[]
  total: number; total_pages: number; page_from: number; page_to: number
}
export type TmsOrdersSummary = { orders: number; vehicles: number; boxes: number; pallets: number; tons: number; done: number }
export type TmsOrdersFacets = { dvvt: { id: string; name: string }[]; wh_types: string[]; vehicle_types: string[]; npp_names: string[] }

export function tmsCsvParams(p: TmsListFilterParams) {
  const j = (a?: string[]) => (a?.length ? a.join(',') : undefined)
  return {
    date_from: p.date_from, date_to: p.date_to, warehouse_id: p.warehouse_id || undefined,
    directions: j(p.directions), dvvt: j(p.dvvt), wh_types: j(p.wh_types),
    vehicle_types: j(p.vehicle_types), slot_ids: j(p.slot_ids),
    unbooked: p.unbooked ? '1' : undefined,
    search: p.search?.trim() || undefined,
  }
}

export function useTmsOrdersPaged(params: (TmsListFilterParams & { page: number; page_size: number }) | undefined) {
  const qp = params ? { ...tmsCsvParams(params), page: params.page, page_size: params.page_size } : undefined
  return useQuery({
    queryKey: ['tms-orders-paged', qp],
    enabled: !!params,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/orders', { params: qp })
      return data.data as TmsOrdersPage
    },
  })
}

export function useTmsOrdersSummary(params?: TmsListFilterParams) {
  const qp = params ? tmsCsvParams(params) : undefined
  return useQuery({
    queryKey: ['tms-orders-summary', qp],
    enabled: !!params,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/orders/summary', { params: qp })
      return data.data as TmsOrdersSummary
    },
  })
}

export function useTmsOrdersFacets(params?: { date_from: string; date_to: string; warehouse_id?: string }) {
  return useQuery({
    queryKey: ['tms-orders-facets', params],
    enabled: !!params,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/orders/facets', { params })
      return data.data as TmsOrdersFacets
    },
  })
}

// Đơn có thể GOM CHUNG XE với đơn đang đặt lịch (cùng ngày/ĐVVT/hướng, xe chính còn PENDING).
// Hỏi server vì danh sách đã phân trang — trước đây lọc trong mảng đơn tải sẵn ở máy.
export function useConsolidatableOrders(orderId?: string) {
  return useQuery({
    queryKey: ['tms-consolidatable', orderId],
    enabled: !!orderId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/orders/consolidatable', { params: { order_id: orderId } })
      return data.data as import('@/types').TmsOrder[]
    },
  })
}

export type TransferGDO = {
  id: string; group_code: string; shipto_party: string | null; transfer_status: string | null
  status?: string   // trạng thái GDO nguồn — != COMPLETED nghĩa là kho xuất đang gỡ HT để sửa (badge "Kho đang sửa")
  delivery_date?: string | null
  dvvt?: string | null
  license_plate?: string | null
  warehouse?: { id: string; code: string; name: string } | null
  delivery_codes?: string[]
  customer_label?: string | null   // tên KH (DO đầu) — hiển thị "Kho nhận" cho lệnh OTHER không có kho đích
}
export type TransferOrder = import('@/types').TmsOrder & {
  transfer_gdo?: TransferGDO | null
  receiving_started_at?: string | null
  actual_received?: number
  delivery_mode?: string | null   // 'SELF' (kho NONE / khách ngoài: tài xế tự Hoàn thành) | 'SCAN'/null (nhận-quét)
}

// destination_warehouse_id: nếu truyền, lọc theo kho nhận (dùng ở Inbound để hiển thị đúng kho)
// Nếu không truyền: hiển thị tất cả lệnh TRANSFER (dùng ở TMS Bookings)
export function useTransferOrders(destination_warehouse_id?: string, range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['tms-orders-transfer', destination_warehouse_id ?? 'all', range?.from ?? '', range?.to ?? ''],
    queryFn: async () => {
      const params: Record<string, string> = { source_type: 'TRANSFER' }
      if (destination_warehouse_id) params.destination_warehouse_id = destination_warehouse_id
      // Lọc server-side theo ngày lệnh — lệnh chuyển kho tích lũy vô hạn, kéo ALL sẽ phình theo thời gian
      if (range?.from) params.date_from = range.from
      if (range?.to)   params.date_to = range.to
      const { data } = await apiClient.get('/tms/orders', { params })
      return data.data as TransferOrder[]
    },
  })
}

export type TransferGoodsRow = {
  material_id: string
  material_code: string | null
  material_name: string | null
  unit: string | null
  // BASE UNIT: planned_boxes/actual_boxes = BASE; units để FE quy đổi hiển thị (thùng quy đổi)
  units_per_carton?: number | null
  entry_unit?: string | null
  base_unit?: string | null
  planned_boxes: number
  actual_boxes: number
  no_qr_tracking?: boolean
  pallets: { pallet_code: string; cartons_outbound: number; cartons_inbound: number; inbound_at: string | null }[]
}

export function useTransferGoods(orderId?: string | null) {
  return useQuery({
    queryKey: ['transfer-goods', orderId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/tms/orders/${orderId}/transfer-goods`)
      return data.data as TransferGoodsRow[]
    },
    enabled: !!orderId,
    staleTime: 0,
  })
}

// Dòng hàng của lệnh XUẤT theo Số xe (Kế hoạch xuất + VL06O) — read-only cho điều vận lúc booking.
// Chuyến chờ dữ liệu SAP: lines rỗng + awaiting_dos, KHÔNG chặn thao tác booking nào.
export type PlanGoodsData = {
  gdo_status: string | null
  awaiting_sap: boolean
  awaiting_dos: string[]
  plan_dropped: boolean
  lines: {
    do_refs: string[]; npp: string | null
    material_code: string | null; material_name: string | null
    qty_base: number; scanned_base: number
    base_unit: string | null; entry_unit: string | null; units_per_carton: number | null
  }[]
}

export function usePlanGoods(orderId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['tms-plan-goods', orderId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/tms/orders/${orderId}/plan-goods`)
      return data.data as PlanGoodsData
    },
    enabled: !!orderId && enabled,
    staleTime: 0,
  })
}

export type MaterialSummaryRow = {
  material_id: string
  material_code: string
  material_name: string
  unit: string
  planned_boxes: number
  actual_boxes: number
  diff: number
}

// Tổng hợp theo mã hàng across danh sách đơn (band tra cứu). order_ids = các đơn ĐÃ lọc trên UI → band khớp list.
// Theo danh sách id — dùng cho tab Chuyển kho (danh sách nhỏ, chưa phân trang).
export function useMaterialSummary(orderIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['tms-material-summary', [...orderIds].sort().join(',')],
    queryFn: async () => {
      const { data } = await apiClient.post('/tms/orders/material-summary', { order_ids: orderIds })
      return data.data as MaterialSummaryRow[]
    },
    enabled: enabled && orderIds.length > 0,
    staleTime: 15_000,
  })
}

// Band "Tổng hợp mã hàng" của lưới Kế hoạch: gửi CỜ bộ lọc (BE tự resolve đơn NHẬP của bộ lọc) —
// danh sách đã phân trang nên client không còn đủ id, và nhồi hàng nghìn id qua mạng là sai luật.
export function useMaterialSummaryByFilter(filter?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['tms-material-summary', filter],
    enabled: !!filter,
    queryFn: async () => {
      const { data } = await apiClient.post('/tms/orders/material-summary', { by_filter: true, filter })
      return data.data as MaterialSummaryRow[]
    },
    staleTime: 15_000,
  })
}

export function useConfirmTransferReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient.post(`/tms/orders/${orderId}/confirm-receipt`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
    },
  })
}

// Booking SELF (kho nhận NONE / khách ngoài): tài xế TỰ HOÀN THÀNH — không nhận-quét, không tạo tồn.
export function useSelfCompleteTransfer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient.post(`/tms/orders/${orderId}/self-complete`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
    },
  })
}

export function useCancelTransferReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient.post(`/tms/orders/${orderId}/cancel-receipt`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-by-gdo'] })
    },
  })
}

export function useCreateOneInbound() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tmsOrderId, ...body }: { tmsOrderId: string; material_id: string; production_date?: string; planned_cartons?: number }) =>
      apiClient.post(`/tms/orders/${tmsOrderId}/create-one-inbound`, body).then(r => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['inbound-by-gdo'] })
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['transfer-goods', v.tmsOrderId] })
    },
  })
}

export function useActiveImportsByGdo(gdoId?: string | null) {
  return useQuery({
    queryKey: ['inbound-by-gdo', gdoId],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders', { params: { from_gdo_id: gdoId } })
      return data.data as {
        material_id: string; status: string; id: string; import_code: string
        planned_cartons: number | null; planned_pallets?: number | null; total_cartons?: number
        posm_entry_id?: string | null
        transfer_production_date?: string | null
        // BASE UNIT: planned_cartons/total_cartons = BASE; material.units để FE quy đổi hiển thị (giữ base cho save)
        material?: { no_qr_tracking?: boolean | null; units_per_carton?: number | null; entry_unit?: string | null; base_unit?: string | null } | null
      }[]
    },
    enabled: !!gdoId,
    staleTime: 15_000,
  })
}

type OrderWriteBody = {
  order_code?: string; date?: string; warehouse_id?: string
  ncc_id?: string | null; npp_name?: string | null
  vehicle_type?: string | null; direction?: string | null; warehouse_type?: string | null
  planned_boxes?: number | null; planned_pallets?: number | null; planned_tons?: number | null
  gdo_refs?: string | null; notes?: string | null; status?: string
  eta?: string | null
}

// ── Cache lưới Kế hoạch (đã phân trang server) ──────────────────────────────────────────────────
// Cache là { rows, total… } chứ KHÔNG còn là mảng đơn; và mỗi lần đổi dòng thì TỔNG cũng đổi.
// Gom 4 helper để mọi mutation chạm đủ cả 2 (rows + summary) — sót 1 chỗ là số liệu lệch im lặng.
type QC = ReturnType<typeof useQueryClient>
type TmsOrderT = import('@/types').TmsOrder
const tmsOrdersCancel = (qc: QC) => qc.cancelQueries({ queryKey: ['tms-orders-paged'] })
const tmsOrdersSnapshot = (qc: QC) =>
  qc.getQueriesData({ queryKey: ['tms-orders-paged'] }) as [unknown, unknown][]
function tmsOrdersPatch(qc: QC, fn: (rows: TmsOrderT[]) => TmsOrderT[]) {
  qc.setQueriesData<TmsOrdersPage>({ queryKey: ['tms-orders-paged'] },
    old => (old?.rows ? { ...old, rows: fn(old.rows) } : old))
}
function tmsOrdersInvalidate(qc: QC) {
  qc.invalidateQueries({ queryKey: ['tms-orders-paged'] })
  qc.invalidateQueries({ queryKey: ['tms-orders-summary'] })
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tmsRollback = (qc: QC) => (_e: unknown, _v: unknown, ctx: any) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx?.snapshots?.forEach(([k, d]: any) => qc.setQueryData(k, d))

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: OrderWriteBody) =>
      apiClient.post('/tms/orders', body).then(r => r.data.data as import('@/types').TmsOrder),
    onSuccess: () => { tmsOrdersInvalidate(qc); qc.invalidateQueries({ queryKey: ['tms-orders-facets'] }) },
  })
}

export function useUpdateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: OrderWriteBody & { id: string }) =>
      apiClient.patch(`/tms/orders/${id}`, body).then(r => r.data.data as import('@/types').TmsOrder),
    onSuccess: () => {
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
    },
  })
}

export function useDeleteOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/orders/${id}`).then(() => id),
    // Optimistic: gỡ đơn khỏi mọi cache lưới NGAY khi bấm (không chờ refetch — xóa lẻ lẫn hàng loạt đều mượt).
    onMutate: async (id: string) => {
      await tmsOrdersCancel(qc)
      tmsOrdersPatch(qc, rows => rows.filter(o => o.id !== id))
    },
    // Lỗi → refetch trả dòng về (rollback bằng dữ liệu thật, an toàn khi xóa song song nhiều đơn).
    onError: () => tmsOrdersInvalidate(qc),
    onSuccess: () => tmsOrdersInvalidate(qc),
  })
}

export function useBulkCreateOrders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orders: OrderWriteBody[]) =>
      apiClient.post('/tms/orders/bulk', { orders }, { timeout: 120000 }).then(r => r.data.data as { inserted: number }),
    onSuccess: () => { tmsOrdersInvalidate(qc); qc.invalidateQueries({ queryKey: ['tms-orders-facets'] }) },
  })
}

export function useBulkUpdateOrderDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, date }: { ids: string[]; date: string }) =>
      apiClient.patch('/tms/orders/bulk-date', { ids, date }).then(r => r.data.data as { updated: number }),
    onMutate: async ({ ids }) => {
      await tmsOrdersCancel(qc)
      const snapshots = tmsOrdersSnapshot(qc)
      const idSet = new Set(ids)
      tmsOrdersPatch(qc, rows => rows.filter(o => !idSet.has(o.id)))
      return { snapshots }
    },
    onError: tmsRollback(qc),
    onSettled: () => tmsOrdersInvalidate(qc),
  })
}

// ── TMS Vehicle Slots ─────────────────────────────────────────────────────────

type VehicleSlotWriteBody = {
  slot_id?: string | null; license_plate?: string | null
  driver_name?: string | null; driver_phone?: string | null; status?: string
  consolidation_order_ids?: string[]
}

export function useAddVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient.post(`/tms/orders/${orderId}/vehicle-slots`).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onMutate: async (orderId: string) => {
      await tmsOrdersCancel(qc)
      const snapshots = tmsOrdersSnapshot(qc)
      const tempSlot: import('@/types').TmsVehicleSlot = {
        id: `_temp_${Date.now()}`, order_id: orderId,
        slot_id: null, slot: null, license_plate: null,
        driver_name: null, driver_phone: null, status: 'PENDING', booked_by: null,
        consolidation_group_id: null, is_consolidation_primary: false,
        gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      tmsOrdersPatch(qc, rows => rows.map(o => o.id === orderId ? { ...o, vehicle_slots: [...o.vehicle_slots, tempSlot] } : o))
      return { snapshots }
    },
    onSuccess: (newSlot) => {
      // Thay thế temp slot bằng real UUID ngay khi server trả về — tránh action button dùng _temp_ id
      tmsOrdersPatch(qc, rows => rows.map(o => o.id === newSlot.order_id
        ? { ...o, vehicle_slots: o.vehicle_slots.map(vs => vs.id.startsWith('_temp_') && vs.order_id === newSlot.order_id ? newSlot : vs) }
        : o))
    },
    onError: tmsRollback(qc),
    onSettled: () => tmsOrdersInvalidate(qc),
  })
}

export function useUpdateVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: VehicleSlotWriteBody & { id: string }) =>
      apiClient.patch(`/tms/vehicle-slots/${id}`, body).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onSuccess: (updated) => {
      // Patch booked_count trực tiếp từ server response — không chờ Realtime/refetch
      if (updated.slot_id && updated.slot) {
        qc.setQueriesData<import('@/types').DeliverySlot[]>(
          { queryKey: ['tms-delivery-slots'] },
          old => old?.map(s => s.id === updated.slot_id ? { ...s, booked_count: (updated.slot as import('@/types').DeliverySlot).booked_count } : s)
        )
      }
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

export function useReleaseVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/tms/vehicle-slots/${id}/release`).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onMutate: async (id: string) => {
      suppressTmsOrdersRealtime(5000)
      await tmsOrdersCancel(qc)
      const snapshots = tmsOrdersSnapshot(qc)
      tmsOrdersPatch(qc, rows => rows.map(o => ({
        ...o,
        vehicle_slots: o.vehicle_slots.map(vs => vs.id === id
          ? { ...vs, slot_id: null, slot: null, license_plate: null, driver_phone: null, status: 'PENDING', consolidation_group_id: null, is_consolidation_primary: false, gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null }
          : vs
        ),
      })))
      return { snapshots }
    },
    onError: tmsRollback(qc),
    onSettled: () => {
      suppressTmsOrdersRealtime(2500)
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

export function useRevokeVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/tms/vehicle-slots/${id}/revoke`).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onMutate: async (id: string) => {
      suppressTmsOrdersRealtime(5000)
      await tmsOrdersCancel(qc)
      const snapshots = tmsOrdersSnapshot(qc)
      tmsOrdersPatch(qc, rows => rows.map(o => ({
        ...o,
        vehicle_slots: o.vehicle_slots.map(vs => vs.id === id
          ? { ...vs, slot_id: null, slot: null, license_plate: null, driver_phone: null, status: 'PENDING', consolidation_group_id: null, is_consolidation_primary: false, gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null }
          : vs
        ),
      })))
      return { snapshots }
    },
    onError: tmsRollback(qc),
    onSettled: () => {
      suppressTmsOrdersRealtime(2500)
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

// ── Gate Registrations (cho Inbound NCC picker) ──────────────────────────────

export function useActiveGateRegistrations(params?: {
  date?: string; date_from?: string; date_to?: string
  warehouse_id?: string; warehouse_type?: string; direction?: string; status?: string
}) {
  return useQuery({
    queryKey: ['gate-registrations', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/gate-registrations', { params })
      return data.data as any[]
    },
    enabled: !!((params?.date || params?.date_from) && params?.warehouse_id),
  })
}

// ── Inbound Plan Lines (kế hoạch nhập ngoài NCC) ─────────────────────────────

export function useInboundPlanLines(params?: {
  date?: string; date_from?: string; date_to?: string; warehouse_id?: string; tms_order_id?: string
}) {
  return useQuery({
    queryKey: ['inbound-plan-lines', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-plan', { params })
      return data.data as any[]
    },
    enabled: !!(params?.tms_order_id || ((params?.date || params?.date_from) && params?.warehouse_id)),
  })
}

export function useCreatePlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      date: string; warehouse_id: string; warehouse_type?: string; vehicle_type?: string
      ncc_id?: string; material_id?: string; po_number?: string
      planned_boxes?: number; planned_pallets?: number
    }) => apiClient.post('/wms/inbound-plan', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] }),
  })
}

export function useBulkCreatePlanLines() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lines: Record<string, unknown>[]) =>
      apiClient.post('/wms/inbound-plan/bulk', { lines }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      tmsOrdersInvalidate(qc)
    },
  })
}

export function useUpdatePlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string
      material_id?: string; po_number?: string; planned_boxes?: number; planned_pallets?: number
      date?: string; warehouse_type?: string | null; vehicle_type?: string | null; ncc_id?: string | null
    }) =>
      apiClient.patch(`/wms/inbound-plan/${id}`, body).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['inbound-report'] })
    },
  })
}

export function useDeletePlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/inbound-plan/${id}`).then(() => id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      tmsOrdersInvalidate(qc)
    },
  })
}

export function useCancelPlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, cancel_reason }: { id: string; cancel_reason: string }) =>
      apiClient.patch(`/wms/inbound-plan/${id}/cancel`, { cancel_reason }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      tmsOrdersInvalidate(qc)
    },
  })
}

// Fetch plan lines cho 1 TmsOrder (dùng trong booking detail)
export function usePlanLinesByOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['inbound-plan-lines-by-order', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-plan', { params: { tms_order_id: orderId } })
      return data.data as any[]
    },
  })
}

// Fetch bảng so sánh kế hoạch vs thực tế cho 1 TmsOrder
export function usePlanVsActual(orderId: string | null) {
  return useQuery({
    queryKey: ['plan-vs-actual', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/tms/orders/${orderId}/plan-vs-actual`)
      return data.data as any[]
    },
  })
}

// Upload plan lines trực tiếp vào 1 TmsOrder đã có
export function useBulkCreatePlanLinesForOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tms_order_id, lines }: { tms_order_id: string; lines: Record<string, unknown>[] }) =>
      apiClient.post('/wms/inbound-plan/bulk-for-order', { tms_order_id, lines }).then(r => r.data.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines-by-order', vars.tms_order_id] })
      qc.invalidateQueries({ queryKey: ['plan-vs-actual', vars.tms_order_id] })
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      tmsOrdersInvalidate(qc)
    },
  })
}

export function useDeleteVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/vehicle-slots/${id}`).then(() => id),
    onMutate: async (id: string) => {
      await tmsOrdersCancel(qc)
      const snapshots = tmsOrdersSnapshot(qc)
      tmsOrdersPatch(qc, rows => rows.map(o => ({ ...o, vehicle_slots: o.vehicle_slots.filter(vs => vs.id !== id) })))
      return { snapshots }
    },
    onError: tmsRollback(qc),
    onSettled: () => {
      tmsOrdersInvalidate(qc)
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

// Báo cáo nhập hàng: KH vs thực tế theo date range
export type InboundReportRow = {
  date: string; warehouse_name: string; po_number: string
  ncc_code: string; ncc_name: string
  material_code: string; material_name: string; unit: string; material_category: string
  planned_boxes: number; actual_boxes: number; pct: number | null
  plan_line_id?: string
  note?: string | null
}

export function useInboundReport(params?: { date_from: string; date_to: string; warehouse_id?: string }) {
  return useQuery({
    queryKey: ['inbound-report', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/reports/inbound', { params })
      return data.data as InboundReportRow[]
    },
    enabled: !!(params?.date_from && params?.date_to),
  })
}

// ═══ HR — Lịch làm việc & Chấm công ═══════════════════════════════════════════

export type SkillRow = {
  id: string; job_title_id: string | null; job_title: string | null
  name: string; shift_tag: string | null; sort_order: number; is_active: boolean
}

// Danh mục skill — theo chức danh (job_title_id), phòng (department_id), hoặc tất cả (all)
export function useSkills(params: { job_title_id?: string; job_title_ids?: string; department_id?: string; all?: boolean; include_inactive?: boolean; with_descendants?: boolean }, enabled = true) {
  const { all, ...rest } = params
  return useQuery({
    queryKey: ['hr-skills', params],
    enabled: enabled && !!(params.job_title_id || params.job_title_ids || params.department_id || all),
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/skills', { params: rest })
      return data.data as SkillRow[]
    },
  })
}

export function useCreateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { job_title_id: string; name: string; shift_tag?: string | null; sort_order?: number }) =>
      apiClient.post('/hr/skills', body).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-skills'] }); qc.invalidateQueries({ queryKey: ['hr-emp-skills'] }) },
  })
}
export function useUpdateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; shift_tag?: string | null; sort_order?: number; is_active?: boolean }) =>
      apiClient.put(`/hr/skills/${id}`, body).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-skills'] }); qc.invalidateQueries({ queryKey: ['hr-emp-skills'] }) },
  })
}
export function useDeleteSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/skills/${id}`).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-skills'] }); qc.invalidateQueries({ queryKey: ['hr-emp-skills'] }) },
  })
}

// Skill của 1 nhân viên (theo chức danh) + ưu tiên hiện có
export type EmpSkillsResp = {
  job_title_id: string | null
  skills: { id: string; name: string; shift_tag: string | null; sort_order: number; priority: number; job_title_id: string | null; job_title: string | null }[]
}
export function useEmployeeSkills(employeeId?: string, enabled = true) {
  return useQuery({
    queryKey: ['hr-emp-skills', employeeId],
    enabled: enabled && !!employeeId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/hr/employees/${employeeId}/skills`)
      return data.data as EmpSkillsResp
    },
  })
}
export function useSetEmployeeSkills() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ employee_id, skills }: { employee_id: string; skills: { skill_id: string; priority: number }[] }) =>
      apiClient.put(`/hr/employees/${employee_id}/skills`, { skills }).then(r => r.data.data),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ['hr-emp-skills', v.employee_id] }),
  })
}

// ── Nghỉ phép ──
export type LeaveRow = {
  id: string; employee_id: string; warehouse_id: string | null
  date_from: string; date_to: string; leave_type: string; reason: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; approved_by: string | null; approved_at: string | null
  created_at: string
  employee: { id: string; name: string; employee_code: string; department_id: string | null; job_title: string | null } | null
}
export function useLeaves(params: { warehouse_id?: string; department_id?: string; employee_id?: string; status?: string; date_from?: string; date_to?: string; to_approve?: boolean; direct?: boolean }, enabled = true) {
  return useQuery({
    queryKey: ['hr-leaves', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/leaves', { params })
      return data.data as LeaveRow[]
    },
  })
}

// Tab Nghỉ phép — PHÂN TRANG SERVER. Lọc ngày mặc định của trang là CẢ NĂM: 6.001 đơn = 3.812KB
// (đo 28/07), sát trần 4,5MB của Vercel ⇒ vượt trần ngay ở màn hình mặc định khi công ty đông.
// `jt` (chức danh) gửi xuống server — lọc client sau khi phân trang là lọc trên đúng 1 trang.
export interface LeavesPage {
  items: LeaveRow[]; total: number; pending: number; approved: number; rejected: number
  page: number; page_size: number
}
export type LeavesPageParams = {
  warehouse_id?: string; department_id?: string; employee_id?: string; jt?: string
  status?: string; date_from?: string; date_to?: string; page: number; page_size: number
}
export function useLeavesPaged(params: LeavesPageParams, enabled = true) {
  return useQuery({
    queryKey: ['hr-leaves-paged', params],
    enabled,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/leaves', { params })
      return data.data as LeavesPage
    },
  })
}

// Xuất Excel đơn nghỉ: phải duyệt HẾT trang, không thì file bị cắt âm thầm theo trang đang xem.
export async function fetchAllLeaves(params: Omit<LeavesPageParams, 'page' | 'page_size'>, maxPages = 50): Promise<LeaveRow[]> {
  const out: LeaveRow[] = []
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await apiClient.get('/hr/leaves', { params: { ...params, page, page_size: 500 } })
    const d = data.data as LeavesPage
    out.push(...(d.items ?? []))
    if (out.length >= (d.total ?? 0) || (d.items?.length ?? 0) < 500) break
  }
  return out
}
export function useCreateLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { employee_id?: string; warehouse_id?: string; date_from: string; date_to: string; leave_type?: string; reason?: string }) =>
      apiClient.post('/hr/leaves', body).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })
}
export type DecideLeaveResult = LeaveRow & { conflicts: { work_date: string; prev_kind: string }[] }
export function useDecideLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      apiClient.patch(`/hr/leaves/${id}/decide`, { status }).then(r => r.data.data as DecideLeaveResult),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['hr-leaves'] })
      qc.invalidateQueries({ queryKey: ['hr-attendance'] })
      qc.invalidateQueries({ queryKey: ['hr-att-report'] })
    },
  })
}
export function useDeleteLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/leaves/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })
}

// ── Layout (mẫu gom skill theo Kho) ──
export type LayoutRow = { id: string; warehouse_id: string; name: string; note: string | null; is_active: boolean; positions: number; people: number }
export type LayoutSkillRow = { id: string; skill_id: string; required_count: number; sort_order: number; name: string; shift_tag: string | null; job_title: string | null; note: string | null }
export type LayoutDetail = { id: string; warehouse_id: string; name: string; note: string | null; is_active: boolean; skills: LayoutSkillRow[]; job_title_ids: string[] }

export function useLayouts(warehouse_id?: string, enabled = true) {
  return useQuery({
    queryKey: ['hr-layouts', warehouse_id],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/layouts', { params: { warehouse_id } })
      return data.data as LayoutRow[]
    },
  })
}
export function useLayout(id?: string) {
  return useQuery({
    queryKey: ['hr-layout', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/hr/layouts/${id}`)
      return data.data as LayoutDetail
    },
  })
}
export function useCreateLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; name: string; note?: string }) => apiClient.post('/hr/layouts', body).then(r => r.data.data as LayoutRow),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-layouts'] }),
  })
}
export function useUpdateLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; note?: string; is_active?: boolean }) => apiClient.put(`/hr/layouts/${id}`, body).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-layouts'] }); qc.invalidateQueries({ queryKey: ['hr-layout', v.id] }) },
  })
}
export function useDeleteLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/layouts/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-layouts'] }),
  })
}
export function useSetLayoutSkills() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ layout_id, skills }: { layout_id: string; skills: { skill_id: string; required_count: number; sort_order?: number; note?: string }[] }) =>
      apiClient.put(`/hr/layouts/${layout_id}/skills`, { skills }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-layout', v.layout_id] }); qc.invalidateQueries({ queryKey: ['hr-layouts'] }) },
  })
}
export function useSetLayoutJobTitles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ layout_id, job_title_ids }: { layout_id: string; job_title_ids: string[] }) =>
      apiClient.put(`/hr/layouts/${layout_id}/job-titles`, { job_title_ids }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-layout', v.layout_id] }); qc.invalidateQueries({ queryKey: ['hr-layouts'] }) },
  })
}

// ── Phân công lịch làm việc (theo layout) ──
export type SheetRow = {
  id: string; work_date: string; warehouse_id: string; layout_id: string | null; layout_name: string | null
  warehouse_name: string | null
  status: 'DRAFT' | 'PUBLISHED'; note: string | null; published_at: string | null
  created_at: string | null; updated_at: string | null; created_by: string | null; updated_by: string | null
  total_required: number; total_assigned: number; total_on_leave: number
}
export type SheetDetail = {
  id: string; work_date: string; warehouse_id: string; layout_id: string | null; layout_name: string | null
  status: 'DRAFT' | 'PUBLISHED'; note: string | null; published_at: string | null
  created_at: string | null; updated_at: string | null; created_by: string | null; updated_by: string | null
  skills: { id: string; name: string; shift_tag: string | null; sort_order: number; job_title: string | null }[]
  demands: { id: string; skill_id: string; required_count: number; note: string | null }[]
  assignments: {
    id: string; employee_id: string; skill_id: string | null
    status: 'ASSIGNED' | 'LEAVE' | 'UNASSIGNED'; is_manual: boolean; note: string | null
    employee: { id: string; name: string; employee_code: string; job_title: string | null } | null
  }[]
}
export function useSheets(params: { warehouse_id?: string; layout_id?: string; date_from?: string; date_to?: string; status?: string }, enabled = true) {
  return useQuery({
    queryKey: ['hr-sheets', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/sheets', { params })
      return data.data as SheetRow[]
    },
  })
}
export function useSheet(id?: string) {
  return useQuery({
    queryKey: ['hr-sheet', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/hr/sheets/${id}`)
      return data.data as SheetDetail
    },
  })
}
export function useUpsertSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { layout_id: string; work_date: string; note?: string; create_only?: boolean; demands?: { skill_id: string; required_count: number; note?: string }[] }) =>
      apiClient.post('/hr/sheets', body).then(r => r.data.data as { id: string }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-sheets'] }); qc.invalidateQueries({ queryKey: ['hr-sheet'] }) },
  })
}
export function useAutoAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sheetId, demands }: { sheetId: string; demands?: { skill_id: string; required_count: number; note?: string }[] }) =>
      apiClient.post(`/hr/sheets/${sheetId}/auto-assign`, { demands }).then(r => r.data.data as { assigned: number; on_leave: number; shortfalls: { skill_id: string; required: number; short: number }[] }),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.sheetId] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
export function useAssignOne() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sheet_id, employee_id, skill_id }: { sheet_id: string; employee_id: string; skill_id: string | null }) =>
      apiClient.post(`/hr/sheets/${sheet_id}/assign-one`, { employee_id, skill_id }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.sheet_id] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
// đặt danh sách vị trí cho 1 NV (1 người làm nhiều vị trí)
export function useSetPositions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sheet_id, employee_id, skill_ids }: { sheet_id: string; employee_id: string; skill_ids: string[] }) =>
      apiClient.post(`/hr/sheets/${sheet_id}/assign-positions`, { employee_id, skill_ids }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.sheet_id] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
export function usePublishSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) =>
      apiClient.post(`/hr/sheets/${id}/publish`, { publish }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.id] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
// ── Quy tắc nghỉ giữa ca ──
export type ShiftRuleRow = { id: string; from_shift: string; to_shift: string }
export function useShiftRules(enabled = true) {
  return useQuery({
    queryKey: ['hr-shift-rules'], enabled,
    queryFn: async () => { const { data } = await apiClient.get('/hr/shift-rules'); return data.data as ShiftRuleRow[] },
  })
}
export function useCreateShiftRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { from_shift: string; to_shift: string }) => apiClient.post('/hr/shift-rules', b).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-shift-rules'] }),
  })
}
export function useDeleteShiftRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/shift-rules/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-shift-rules'] }),
  })
}

export function useDeleteSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/sheets/${id}`).then(r => r.data.data),
    // xóa lạc quan: bỏ phiếu khỏi mọi cache danh sách ngay, không chờ refetch
    onMutate: (id) => { qc.setQueriesData<SheetRow[]>({ queryKey: ['hr-sheets'] }, old => Array.isArray(old) ? old.filter(s => s.id !== id) : old) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-sheets'] }),
  })
}

// ── Chấm công ──
export type AttendanceRow = {
  id: string; employee_id: string; warehouse_id: string | null; work_date: string
  kind: 'CA1' | 'CA2' | 'CA3' | 'HC' | 'LEAVE'; ot_hours: number; early_leave_hours: number; note: string | null
  employee: { id: string; name: string; employee_code: string; department_id: string | null; job_title: string | null } | null
}
export function useAttendance(params: { warehouse_id?: string; department_id?: string; employee_id?: string; date_from?: string; date_to?: string }, enabled = true) {
  return useQuery({
    queryKey: ['hr-attendance', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/attendance', { params })
      return data.data as AttendanceRow[]
    },
  })
}
export function useUpsertAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { employee_id?: string; warehouse_id?: string; work_date: string; kind: string; ot_hours?: number; early_leave_hours?: number; note?: string }) =>
      apiClient.post('/hr/attendance', body).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-attendance'] }),
  })
}
export function useDeleteAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/attendance/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-attendance'] }),
  })
}
export type AttReportRow = {
  employee_id: string; ca1: number; ca2: number; ca3: number; hc: number; leave: number
  ot_hours: number; early_hours: number; work_days: number; total_hours: number
  employee: { id: string; name: string; employee_code: string; department_id: string | null; job_title: string | null } | null
}
export function useAttendanceReport(params: { warehouse_id?: string; department_id?: string; date_from: string; date_to: string }, enabled = true) {
  return useQuery({
    queryKey: ['hr-att-report', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/attendance/report', { params })
      return data.data as AttReportRow[]
    },
  })
}

// ─── XE NÂNG (forklift) — check list an toàn hàng ngày + giờ vận hành ────────
export type ForkliftVehicle = {
  id: string; code: string; name: string | null; warehouse_id: string; is_active: boolean
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string
  warehouse?: { id: string; code: string; name: string } | null
}
export type ForkliftItem = {
  id: string; label: string; sort_order: number; is_active: boolean
  warehouse_id: string | null   // null = hạng mục DÙNG CHUNG mọi kho
  warehouse?: { id: string; code: string; name: string } | null
}
export type ForkliftChecklistResult = { item_id: string; label: string; ok: boolean; note?: string | null }
export type ForkliftLog = {
  id: string; forklift_id: string; log_date?: string; status: 'ACTIVE' | 'IDLE'
  hour_meter: number | null; checklist: ForkliftChecklistResult[]; issue_count: number
  note: string | null; checked_by: string | null; updated_at: string
  photo_url?: string | null   // signed URL 1h (bucket riêng tư) — ảnh chụp xe lúc check
}
export type ForkliftBoardVehicle = {
  id: string; code: string; name: string | null; warehouse_id: string
  warehouse?: { id: string; code: string; name: string } | null
  log: ForkliftLog | null
  prev: { log_date: string; hour_meter: number } | null
}
export type ForkliftReportRow = {
  id: string; forklift_id: string; code: string; forklift_name: string | null; warehouse_id: string
  log_date: string; status: 'ACTIVE' | 'IDLE'; hour_meter: number | null; issue_count: number
  checked_by: string | null; note: string | null; checked_at: string
  next_meter: number | null; next_date: string | null; hours_run: number | null
}
export type ForkliftReportSummary = {
  forklift_id: string; code: string; forklift_name: string | null; warehouse_id: string
  total_hours: number; active_days: number; idle_days: number; open_days: number; issue_count: number
  last_meter: number | null; last_date: string | null
}

export function useForklifts(includeInactive = false) {
  return useQuery({
    queryKey: ['forklifts', includeInactive],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/forklifts', { params: includeInactive ? { include_inactive: '1' } : undefined })
      return data.data as ForkliftVehicle[]
    },
  })
}
export function useCreateForklift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name?: string | null; warehouse_id: string }) =>
      apiClient.post('/wms/forklifts', body).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['forklifts'] }); qc.invalidateQueries({ queryKey: ['forklift-board'] }) },
  })
}
export function useUpdateForklift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string | null; warehouse_id?: string; is_active?: boolean }) =>
      apiClient.patch(`/wms/forklifts/${id}`, body).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['forklifts'] }); qc.invalidateQueries({ queryKey: ['forklift-board'] }) },
  })
}
export function useDeleteForklift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/forklifts/${id}`).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['forklifts'] }); qc.invalidateQueries({ queryKey: ['forklift-board'] }) },
  })
}

export function useForkliftItems(opts: { includeInactive?: boolean; warehouseId?: string } = {}) {
  return useQuery({
    queryKey: ['forklift-items', opts],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/forklift-items', {
        params: {
          include_inactive: opts.includeInactive ? '1' : undefined,
          warehouse_id: opts.warehouseId || undefined,
        },
      })
      return data.data as ForkliftItem[]
    },
  })
}
export function useCreateForkliftItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { label: string; sort_order?: number; warehouse_id?: string | null }) =>
      apiClient.post('/wms/forklift-items', body).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['forklift-items'] }),
  })
}
export function useUpdateForkliftItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; sort_order?: number; is_active?: boolean; warehouse_id?: string | null }) =>
      apiClient.patch(`/wms/forklift-items/${id}`, body).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['forklift-items'] }),
  })
}
export function useDeleteForkliftItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/forklift-items/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['forklift-items'] }),
  })
}

export function useForkliftBoard(date: string) {
  return useQuery({
    queryKey: ['forklift-board', date],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/forklift-board', { params: { date } })
      return data.data as { date: string; vehicles: ForkliftBoardVehicle[] }
    },
  })
}
export function useSaveForkliftLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      forklift_id: string; log_date?: string; status: 'ACTIVE' | 'IDLE'
      hour_meter?: number | null; checklist?: ForkliftChecklistResult[]; note?: string | null
      photo_data?: string | null   // data URL đã nén — bắt buộc khi ACTIVE (trừ khi log cũ đã có ảnh)
    }) => apiClient.post('/wms/forklift-logs', body).then(r => r.data.data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['forklift-board'] })
      qc.invalidateQueries({ queryKey: ['forklift-report'] })
      qc.invalidateQueries({ queryKey: ['forklift-log'] })
      qc.invalidateQueries({ queryKey: ['forklift-logs-matrix'] })   // tab Ma trận cùng dữ liệu log
    },
  })
}
export function useDeleteForkliftLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/forklift-logs/${id}`).then(r => r.data.data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['forklift-board'] })
      qc.invalidateQueries({ queryKey: ['forklift-report'] })
      qc.invalidateQueries({ queryKey: ['forklift-log'] })           // dialog chi tiết đang mở
      qc.invalidateQueries({ queryKey: ['forklift-logs-matrix'] })
    },
  })
}
/** Ma trận check list 1 xe: log đầy đủ checklist theo từng ngày trong khoảng (≤92 ngày). */
export function useForkliftLogs(params: { forklift_id: string; from: string; to: string }, enabled = true) {
  return useQuery({
    queryKey: ['forklift-logs-matrix', params],
    enabled: enabled && !!params.forklift_id,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/forklift-logs', { params })
      return data.data as (ForkliftLog & { log_date: string })[]
    },
  })
}
export function useForkliftLog(id: string | undefined) {
  return useQuery({
    queryKey: ['forklift-log', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/forklift-logs/${id}`)
      return data.data as ForkliftLog & { log_date: string; forklift: { id: string; code: string; name: string | null } | null }
    },
  })
}
export function useForkliftReport(params: { from: string; to: string; warehouse_id?: string }, enabled = true) {
  return useQuery({
    queryKey: ['forklift-report', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/forklift-report', { params })
      return data.data as {
        from: string; to: string; rows: ForkliftReportRow[]; summary: ForkliftReportSummary[]
        issue_items: { label: string; cnt: number }[]
      }
    },
  })
}

// ─── Trung tâm cảnh báo (Đợt 2 roadmap 06/08) ─────────────────────────────────
export type AlertRule = 'EXPIRY' | 'GATE_DWELL' | 'TRIP_LATE' | 'WEIGH_DIFF' | 'BE_ERRORS'
export interface AlertRow {
  id: string; rule: AlertRule; severity: 'CRITICAL' | 'WARNING'
  warehouse_id: string | null; warehouse_name: string | null; category: string | null
  title: string; detail: string | null; object_url: string | null
  first_seen: string; last_seen: string
  ack_by: string | null; ack_at: string | null; resolved_at: string | null
}
export function useAlerts(params: { status: string; rule?: string; severity?: string; warehouse_id?: string }, enabled = true) {
  return useQuery({
    queryKey: ['alerts-list', params],
    enabled,   // chuông Header tắt query khi user không có alerts.view (khỏi 403 ồn)
    refetchInterval: 120_000,   // quét lười phía BE throttle 10' — refetch chỉ đọc bảng
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/alerts', { params })
      return data.data as { rows: AlertRow[]; total: number }
    },
  })
}
export function useAckAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ack }: { id: string; ack: boolean }) =>
      (ack ? apiClient.post(`/wms/alerts/${id}/ack`) : apiClient.delete(`/wms/alerts/${id}/ack`)).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['alerts-list'] }),
  })
}

// ─── Kiểm kê luân phiên ABC (Đợt 3 roadmap 06/08) ─────────────────────────────
export interface CycleCountRow {
  material_id: string; material_code: string; short_name: string | null; category: string | null
  abc: 'A' | 'B' | 'C'; picks: number; stock_pallets: number; stock_cartons: number
  cycle_days: number; last_counted_at: string | null; days_since: number | null
  due_in: number; never_counted: boolean
  loc_ids: string[]; loc_codes: string[]
}
export function useCycleCount(params?: { warehouse_id: string; categories?: string }) {
  return useQuery({
    queryKey: ['cycle-count', params],
    enabled: !!params?.warehouse_id,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/stocktake/cycle', { params })
      return data.data as {
        rows: CycleCountRow[]
        summary: { total: number; due: number; due_a: number; due_b: number; due_c: number; never: number }
        cycle_days: Record<'A' | 'B' | 'C', number>
        window_days: number
      }
    },
  })
}

// ─── Nút chuông: feed cá nhân + cài đặt chuông (06/08) ────────────────────────
export interface NotifyFeedRow {
  id: string; kind: string; title: string; body: string | null; url: string | null
  read_at: string | null; created_at: string
}
export function useNotifyFeed(enabled = true) {
  return useQuery({
    queryKey: ['notify-feed'],
    enabled,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/notify/feed')
      return data.data as { rows: NotifyFeedRow[]; unread: number }
    },
  })
}
export function useMarkFeedRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) => apiClient.post('/notify/feed/read', ids?.length ? { ids } : {}).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notify-feed'] }),
  })
}
export function useNotifyPrefs(enabled = true) {
  return useQuery({
    queryKey: ['notify-prefs'],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/notify/prefs')
      return data.data as { prefs: Record<string, boolean> }
    },
  })
}
export function useUpdateNotifyPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: Record<string, boolean>) => apiClient.put('/notify/prefs', { prefs }).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notify-prefs'] }),
  })
}
