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
      scan:               'Quét QR',
      edit_pallet:        'Sửa pallet (của mình)',
      force_edit_pallet:  'Sửa pallet (bất kỳ)',
      delete_pallet:      'Xóa pallet (của mình)',
      force_delete_pallet:'Xóa pallet (bất kỳ)',
      cancel:             'Hủy phiếu',
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
    label: 'Quản lý nhân sự',
    actions: {
      view:         'Xem danh sách',
      create:       'Thêm nhân viên',
      edit:         'Sửa thông tin',
      set_password: 'Đặt mật khẩu',
      delete:       'Xóa nhân viên',
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
      view:   'Xem cài đặt',
      manage: 'Quản lý master data',
    },
  },
  tms: {
    label: 'Vận tải (TMS)',
    actions: {
      view:              'Xem lịch & booking',
      book:              'Đặt slot (ĐVVT/Lái xe)',
      manage_booking:    'Quản lý booking (Điều vận)',
      revoke:            'Thu hồi booking (bỏ qua giờ)',
      upload_outbound:   'Upload kế hoạch xuất',
      upload_inbound:    'Upload kế hoạch nhập',
      gate_log:          'Ghi nhận xe cổng (Bảo vệ)',
      manage_slots:      'Quản lý loại xe & khung giờ',
      manage_companies:  'Quản lý ĐVVT & xe',
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

export function isAdmin(name?: string | null): boolean {
  return name === 'Admin'
}
