---
name: add-permission
description: BẮT BUỘC làm theo khi thêm/sửa BẤT KỲ nút hay route gọi API write nào (tạo/sửa/xóa/quét/giao/duyệt/phát hành…). Mỗi action = 1 permission riêng, phải khai báo ĐỦ 4 nơi: FE config, BE config (nguồn ALL_PERMISSIONS — thiếu thì admin mất quyền dù superadmin), gate nút FE bằng can(), và requirePerm trên route BE. Chống lỗi "đã gate nút nhưng quên backend" / "admin không bấm được nút".
---

# Thêm permission cho 1 action

Mỗi nút write = **1 permission riêng** — KHÔNG gộp `manage` cho nhiều loại action. "Thêm/Sửa/Xóa" cùng module = 3 permission `create`/`edit`/`delete` riêng.

## 4 nơi BẮT BUỘC (đủ cả 4 mới đúng)
1. **FE config** — thêm key action vào `MODULES` trong `frontend/src/config/permissions.ts`.
2. **BE config** — thêm vào `backend/src/config/permissions.ts`. **BẮT BUỘC**: đây là nguồn `ALL_PERMISSIONS` mà superadmin (`name='Admin'` hoặc `employee_code='ADMIN'`) nhận lúc login (xem `authController.ts`). Thiếu → admin **không có** quyền đó dù là superadmin.
3. **Gate nút FE**:
   ```tsx
   const perms = user?.module_permissions as ModulePermissions | null ?? null   // user từ useAuthStore(s => s.user)
   {can(perms, 'module_key', 'action_key') && <Button onClick={...}>…</Button>}
   ```
   import `can, type ModulePermissions` từ `@/config/permissions`.
4. **Route BE**: `requirePerm('module', 'action')` (hoặc `requireAnyPerm([...],[...])`) trên route trong `backend/src/routes/*.ts`.

## Bẫy "gộp quyền" — capability riêng phải map đúng quyền sở hữu
ĐỪNG gate một capability bằng quyền KHÔNG liên quan chỉ vì tiện. Vd lỗi thực tế: nút **đổi vị trí phiếu nhập** từng gate bằng `inbound.edit` (vốn là "Sửa nhóm phiếu NCC") → giám sát kho có `scan`+`edit_pallet` nhưng KHÔNG có `edit` nên không đổi được, dù việc đặt/đổi vị trí thuộc về quyền sửa pallet. Cách đúng: đổi vị trí gate `inbound.edit_pallet`/`force_edit_pallet` (của mình / bất kỳ), **route RIÊNG** `PATCH /inbound-orders/:id/location` chỉ đổi `location_id` — KHÔNG nhét vào `updateOrder` (tránh nới quyền sửa field khác). Khi 1 endpoint đụng nhiều field với mức quyền khác nhau → **tách route theo từng capability**, mỗi route 1 mức quyền.

## Lưu ý
- Backend enforce qua `requirePerm` là điểm bảo mật thật; FE chỉ ẩn nút. Phải có cả hai.
- Khi review job title: action lạ không nằm trong `MODULES`/`ALL_PERMISSIONS` (vd `inbound.delete` cũ) là quyền **lỗi thời** → dọn bằng migration JSONB (`jsonb_agg` lọc bỏ phần tử) để không gây nhiễu.
- Permission load lúc login theo `module_permissions` của **JobTitle** (non-superadmin) → user thường cần chức danh có quyền đó.
- Sửa `backend/src` (kể cả config) → **bump rebuild-token** trong `api/index.ts` (Vercel rebuild). Xong chạy [[verify-feature]].

## Checklist
- [ ] FE `config/permissions.ts` có key
- [ ] BE `config/permissions.ts` có key (ĐỪNG QUÊN — admin mất quyền nếu thiếu)
- [ ] Nút FE bọc `can(perms, module, action)`
- [ ] Route BE có `requirePerm`/`requireAnyPerm`
- [ ] Bump rebuild-token (vì sửa BE)
