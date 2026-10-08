// NÚT XỬ LÝ trên một việc "Cần xử lý" (đối chiếu SAP↔WMS, tab Dữ liệu bên ngoài) — MỘT chỗ quyết, test ở
// backend/tests/unit/reconcileActions.test.ts.
// Đổi MÃ hàng / đổi KHÁCH GIAO: BE không áp thẳng (resolve 'apply' trả 422) — xử ở nguồn rồi "Đã xử lý tay". Bản cũ viết tại chỗ
// `r.action === 'MATERIAL_CHANGED'` — giá trị của `change_type`, `action` không bao giờ mang ⇒ việc đổi mã chỉ có "Áp SAP" (luôn
// 422) + "Giữ WMS", không có lối "Đã xử lý tay" mà chính câu lỗi bảo người dùng bấm (08/10).
export const HAND_ONLY_CHANGES: ReadonlySet<string> = new Set(['MATERIAL_CHANGED', 'SHIPTO_CHANGED'])

export interface ReconcileTaskLike {
  status: string; action: string; change_type: string
  new_ordered: number | string | null; scanned: number | string | null
}

export function reconcileButtons(t: ReconcileTaskLike): { apply: boolean; manual: boolean; keep: boolean } {
  const open = t.status === 'OPEN'
  const handOnly = HAND_ONLY_CHANGES.has(t.change_type)
  return {
    // SAP ít hơn đã quét thì không áp được (phải trả hàng trước) — BE chặn cùng luật
    apply: open && t.action === 'NEEDS_REVIEW' && !handOnly && Number(t.new_ordered) >= Number(t.scanned),
    manual: open && (t.action === 'BLOCKED' || handOnly),
    keep: open,
  }
}
