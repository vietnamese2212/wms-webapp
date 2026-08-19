// Scope filter + saved-views theo từng user — tránh user kế tiếp (cùng trình duyệt) kế thừa
// filter/view của người đăng nhập trước. Key persist gắn user.id; đổi user → reset về default
// rồi nạp dữ liệu riêng của user (nếu có).
//
// Import side-effect 1 lần ở entry (main.tsx) — KHÔNG export gì cần gọi.
import { useAuthStore } from './authStore'
import { useWmsFilterStore } from './wmsFilterStore'
import { useSavedViewsStore } from './savedViewsStore'
import { useGlobalScopeStore, GLOBAL_SCOPE_BASE, sweepGlobalScope } from './globalScopeStore'

const FILTER_BASE = 'wms-filters-v10'
const VIEWS_BASE  = 'wms-saved-views'
const keyFor = (base: string, uid: string | null) => (uid ? `${base}:${uid}` : base)

let currentUid: string | null | undefined = undefined

// Di trú 1 lần (chỉ saved-views ở localStorage): nếu key theo-user chưa có dữ liệu nhưng key
// chung (legacy, từ trước khi tách user) còn → copy sang để không mất view đã lưu.
function migrateLegacyViews(uid: string | null) {
  if (!uid) return
  const userKey = keyFor(VIEWS_BASE, uid)
  if (localStorage.getItem(userKey) != null) return
  const legacy = localStorage.getItem(VIEWS_BASE)
  if (legacy != null) localStorage.setItem(userKey, legacy)
}

function applyScope(uid: string | null) {
  if (uid === currentUid) return
  currentUid = uid

  // Filters (sessionStorage, ephemeral): reset default → nạp filter riêng của user nếu có.
  useWmsFilterStore.getState().reset()
  useWmsFilterStore.persist.setOptions({ name: keyFor(FILTER_BASE, uid) })
  const filtersReady = useWmsFilterStore.persist.rehydrate()

  // Saved views (localStorage, bền): migrate legacy 1 lần → reset → nạp của user.
  migrateLegacyViews(uid)
  useSavedViewsStore.getState().reset()
  useSavedViewsStore.persist.setOptions({ name: keyFor(VIEWS_BASE, uid) })
  void useSavedViewsStore.persist.rehydrate()

  // Bối cảnh Kho/Loại kho toàn cục (localStorage, bền): reset → nạp của user → sau khi CẢ HAI
  // store sẵn sàng thì áp lại vào filter các trang (force=false — chỉ áp phần ĐANG CHỌN, không
  // xoá lựa chọn đã nhớ khi bối cảnh để "Tất cả"). Header luôn phản ánh đúng bối cảnh khi mở app.
  useGlobalScopeStore.getState().reset()
  useGlobalScopeStore.persist.setOptions({ name: keyFor(GLOBAL_SCOPE_BASE, uid) })
  const scopeReady = useGlobalScopeStore.persist.rehydrate()
  void Promise.all([filtersReady, scopeReady]).then(() => {
    if (!uid || uid !== currentUid) return
    const g = useGlobalScopeStore.getState()
    if (g.warehouseId || g.whType) sweepGlobalScope(g, { force: false })
  })
}

// Khởi tạo theo user hiện tại (authStore đã rehydrate đồng bộ từ localStorage 'wms-auth').
applyScope(useAuthStore.getState().user?.id ?? null)

// Đổi user (login / logout) → re-scope.
useAuthStore.subscribe((s) => applyScope(s.user?.id ?? null))
