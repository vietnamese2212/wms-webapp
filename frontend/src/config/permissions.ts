// ─── Module + Action registry ─────────────────────────────────────────────────
// Thêm module mới: thêm key vào MODULES
// Thêm action mới trong module: thêm key vào actions của module đó

export const MODULES = {
  inventory: {
    label: 'Tồn kho',
    actions: {
      view:            'Xem danh sách',
      adjust:          'Điều chỉnh tồn',
      move_location:   'Chuyển vị trí',
      recode:          'Chuyển mã',
      qa_update:       'Cập nhật QA Status',
      update_prod_date:'Cập nhật ngày SX',
      export:          'Xuất Excel',
    },
  },
  inbound: {
    label: 'Nhập kho',
    actions: {
      view:               'Xem danh sách',
      create:             'Tạo phiếu',
      edit:               'Sửa nhóm phiếu NCC',
      scan:               'Quét QR',
      edit_pallet:        'Sửa pallet (của mình)',
      force_edit_pallet:  'Sửa pallet (bất kỳ)',
      delete_pallet:      'Xóa pallet (của mình)',
      force_delete_pallet:'Xóa pallet (bất kỳ)',
      cancel:             'Hủy phiếu',
      complete:           'Hoàn thành phiếu',
      uncomplete:         'Gỡ hoàn thành phiếu',
    },
  },
  outbound: {
    label: 'Xuất kho',
    actions: {
      view:       'Xem danh sách',
      create:     'Tạo đơn',
      edit:       'Sửa đơn / xe',
      assign:     'Giao đơn',
      unassign:   'Gỡ giao đơn',
      start:      'Bắt đầu',
      unstart:    'Gỡ bắt đầu',
      scan:       'Quét QR',
      complete:   'Hoàn thành',
      uncomplete: 'Bỏ hoàn thành',
      cancel:     'Huỷ đơn',
    },
  },
  scanlog: {
    label: 'Lịch sử quét',
    actions: {
      view: 'Xem lịch sử quét',
    },
  },
  loosepicking: {
    label: 'Nhặt lẻ',
    actions: {
      view:     'Xem danh sách',
      create:   'Tạo đơn',
      start:    'Bắt đầu',
      scan:     'Quét QR',
      complete: 'Hoàn thành',
      cancel:   'Huỷ đơn',
    },
  },
  stocktake: {
    label: 'Kiểm kho',
    actions: {
      view:     'Xem danh sách',
      create:   'Tạo phiếu',
      scan:     'Quét QR',
      complete: 'Hoàn thành',
    },
  },
  locations: {
    label: 'Vị trí kho',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm vị trí',
      edit:   'Sửa vị trí',
      delete: 'Xóa vị trí',
    },
  },
  employees: {
    label: 'Sơ đồ tổ chức (xem)',
    actions: {
      view: 'Xem sơ đồ tổ chức / danh sách nhân sự',
    },
  },
  user_admin: {
    label: 'Quản lý người dùng',
    actions: {
      view:         'Mở trang / xem danh sách',
      create:       'Thêm tài khoản',
      edit:         'Sửa thông tin',
      set_password: 'Đặt mật khẩu',
      delete:       'Xóa / khôi phục',
      manage_roles: 'Sửa phòng ban / chức danh & sơ đồ + phân quyền',
    },
  },
  deliveries: {
    label: 'Giao hàng',
    actions: {
      view:   'Xem danh sách',
      create: 'Tạo chuyến',
      edit:   'Sửa',
    },
  },
  schedule: {
    label: 'Lịch làm việc',
    actions: {
      view:   'Xem lịch',
      create: 'Tạo lịch',
      approve:'Duyệt / Từ chối',
    },
  },
  wms_settings: {
    label: 'Cài đặt WMS',
    actions: {
      view:          'Xem cài đặt',
      manage_zone:   'Quản lý khu vực kho (kho được assign)',
      manage_global: 'Quản lý toàn bộ (kho, loại kho, khu vực)',
    },
  },
  tms_plan: {
    label: 'Vận chuyển: Đặt lịch & Chuyển kho (trang TMS Bookings)',
    actions: {
      view:            'Xem kế hoạch',
      create:          'Thêm đơn',
      edit:            'Sửa đơn',
      delete:          'Xóa đơn',
      add_vehicle:     'Thêm / Xóa xe phụ',
      release:         'Trả lại khung giờ',
      change_date:     'Đổi ngày đơn hàng',
      book:            'Đặt khung giờ (ĐVVT / Lái xe)',
      revoke:          'Thu hồi booking (bỏ qua giờ)',
      upload_outbound: 'Upload kế hoạch xuất',
      upload_inbound:  'Upload kế hoạch nhập',
      confirm_receipt: 'Nhận hàng chuyển kho (xác nhận / quét / hoàn thành) — tab Chuyển kho',
    },
  },
  tms_vehicle_types: {
    label: 'TMS — Loại xe',
    actions: {
      view:   'Xem danh sách',
      manage: 'Thêm / Sửa loại xe',
    },
  },
  tms_slots: {
    label: 'TMS — Khung giờ',
    actions: {
      view:   'Xem danh sách',
      manage: 'Thêm / Sửa / Xóa khung giờ',
    },
  },
  tms_companies: {
    label: 'TMS — ĐVVT / NCC',
    actions: {
      view:   'Xem danh sách',
      manage: 'Thêm / Sửa / Xóa ĐVVT',
    },
  },
  tms_vehicles: {
    label: 'TMS — Xe',
    actions: {
      view:   'Xem danh sách xe',
      manage: 'Thêm / Sửa / Xóa xe',
    },
  },
  gate_registration: {
    label: 'Đăng ký cổng',
    actions: {
      view:   'Xem danh sách',
      create: 'Tạo đăng ký',
      edit:   'Sửa thông tin',
      delete: 'Xóa đăng ký',
      call:   'Gọi xe (NV Kho)',
      entry:  'Xác nhận xe vào (Bảo vệ)',
      exit:   'Xác nhận xe ra (Bảo vệ)',
    },
  },
  inbound_plan: {
    label: 'Kế hoạch nhập (từ ngoài) — trang KH nhập',
    actions: {
      view:   'Xem kế hoạch',
      create: 'Thêm / Upload dòng kế hoạch',
      edit:   'Sửa dòng kế hoạch',
      delete: 'Xóa dòng (nhập nhầm)',
      cancel: 'Hủy dòng kế hoạch',
    },
  },
  materials: {
    label: 'Mã hàng',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm mã hàng',
      edit:   'Sửa mã hàng',
      delete: 'Ẩn mã hàng',
    },
  },
  pallet_print: {
    label: 'In tem pallet',
    actions: {
      view:    'Xem trang',
      generate:'Sinh tem mới (in)',
      reprint: 'In lại (tồn kho / lịch sử)',
    },
  },
  pallet_ops: {
    label: 'Dồn / Tách pallet',
    actions: {
      view:    'Xem trang',
      merge:   'Dồn (gom nhóm)',
      ungroup: 'Tách nhóm (gỡ dồn)',
      split:   'Tách số lượng',
    },
  },
  work_skill: {
    label: 'Vị trí & Skill',
    actions: {
      view:   'Xem danh sách',
      manage: 'Thêm / Sửa / Xóa vị trí',
      assign: 'Gán skill cho nhân viên',
    },
  },
  leave: {
    label: 'Nghỉ phép',
    actions: {
      view:    'Xem danh sách',
      request: 'Gửi đơn nghỉ',
      approve: 'Duyệt / Từ chối',
      delete:  'Xóa đơn',
    },
  },
  work_assignment: {
    label: 'Phân công lịch làm việc',
    actions: {
      view:    'Xem phân công',
      create:  'Tạo phiếu + Tự xếp',
      edit:    'Sửa tay (đổi người)',
      publish: 'Phát hành',
      delete:  'Xóa phiếu',
    },
  },
  attendance: {
    label: 'Chấm công',
    actions: {
      view:     'Xem bảng công',
      self_log: 'Tự chấm công (của mình)',
      edit:     'Sửa công người khác',
      report:   'Xem báo cáo',
    },
  },
} as const

export type ModuleKey = keyof typeof MODULES
export type ModulePermissions = Partial<Record<ModuleKey, string[]>>

// All permissions — dùng cho NATIONAL_MANAGER fallback
export const ALL_PERMISSIONS: ModulePermissions = Object.fromEntries(
  Object.entries(MODULES).map(([key, mod]) => [key, Object.keys(mod.actions)])
) as ModulePermissions

export function can(
  perms: ModulePermissions | null | undefined,
  module: ModuleKey,
  action: string,
): boolean {
  if (!perms) return false
  return perms[module]?.includes(action) ?? false
}

export function canAccess(
  perms: ModulePermissions | null | undefined,
  module: ModuleKey,
): boolean {
  if (!perms) return false
  return can(perms, module, 'view')
}

export function canAccessAny(
  perms: ModulePermissions | null | undefined,
  ...modules: ModuleKey[]
): boolean {
  return modules.some(m => canAccess(perms, m))
}

export function isAdmin(name?: string | null): boolean {
  return name === 'Admin'
}
