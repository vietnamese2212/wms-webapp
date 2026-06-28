// ─── Module + Action registry ─────────────────────────────────────────────────
// Thêm module mới: thêm key vào MODULES
// Thêm action mới trong module: thêm key vào actions của module đó
//
// `page` = TÊN TRANG/MENU mà module thuộc về (dùng gom nhóm trong trình phân quyền).
// `tab`  = TÊN TAB trong trang đó (chỉ khi nhiều module dùng chung 1 page). Trình phân
//          quyền gom các module cùng `page` lại, mỗi `tab` là 1 dòng con → "Trang → Tab".
// QUY TẮC ĐỘ MỊN: mỗi capability = 1 action riêng (create/edit/delete...), KHÔNG gộp `manage`.

export const MODULES = {
  inventory: {
    page: 'Tồn kho',
    actions: {
      view:            'Xem danh sách',
      adjust:          'Điều chỉnh tồn',
      move_location:   'Chuyển vị trí',
      recode:          'Chuyển mã',
      qa_update:       'Cập nhật QA Status',
      update_ncc:      'Sửa NCC hàng loạt',
      update_prod_date:'Cập nhật ngày SX',
      export:          'Xuất Excel',
    },
  },
  inbound: {
    page: 'Nhập kho',
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
    page: 'Xuất kho',
    actions: {
      view:       'Xem danh sách',
      prepare:    'Chuẩn bị hàng (soạn hàng)',
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
    page: 'Lịch sử quét',
    actions: {
      view: 'Xem lịch sử quét',
    },
  },
  loosepicking: {
    page: 'Nhặt lẻ',
    actions: {
      view:     'Xem danh sách',
      scan:     'Quét QR',
      complete: 'Hoàn thành',
    },
  },
  stocktake: {
    page: 'Kiểm kho',
    actions: {
      view:     'Xem danh sách',
      scan:     'Quét QR',
      complete: 'Bỏ cờ chênh lệch',
    },
  },
  locations: {
    page: 'Vị trí kho',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm vị trí',
      edit:   'Sửa vị trí',
      delete: 'Xóa vị trí',
    },
  },
  employees: {
    page: 'Sơ đồ tổ chức (xem)',
    actions: {
      view: 'Xem sơ đồ tổ chức / danh sách nhân sự',
    },
  },
  user_admin: {
    page: 'Quản lý người dùng',
    tab:  'Người dùng & Phân quyền',
    actions: {
      view:         'Mở trang / xem danh sách',
      create:       'Thêm tài khoản [Nhân viên]',
      edit:         'Sửa thông tin [Nhân viên]',
      set_password: 'Đặt mật khẩu [Nhân viên]',
      delete:       'Xóa / khôi phục [Nhân viên]',
      manage_roles: 'Sửa & phân quyền [Phòng ban · Chức danh]',
    },
  },
  work_skill: {
    page: 'Quản lý người dùng',
    tab:  'Vị trí & Skill',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm vị trí',
      edit:   'Sửa vị trí',
      delete: 'Xóa vị trí',
      assign: 'Gán skill cho nhân viên',
    },
  },
  wms_settings: {
    page: 'Cài đặt WMS',
    actions: {
      view:             'Mở trang cài đặt',
      manage_warehouse: 'Quản lý Kho',
      manage_type:      'Quản lý Loại kho',
      manage_zone:      'Quản lý Khu vực kho (kho được gán)',
      manage_shift:     'Quản lý Ca nhập',
      manage_qa:        'Quản lý Tình trạng QA',
    },
  },
  tms_plan: {
    page: 'TMS Bookings',
    tab:  'Đặt lịch & Chuyển kho',
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
      confirm_receipt: 'Nhận hàng chuyển kho: xác nhận / quét / hoàn thành [Chuyển kho]',
    },
  },
  inbound_plan: {
    page: 'TMS Bookings',
    tab:  'Kế hoạch nhập',
    actions: {
      view:   'Xem kế hoạch nhập',
      create: 'Thêm / Upload dòng kế hoạch',
      edit:   'Sửa dòng kế hoạch',
      delete: 'Xóa dòng (nhập nhầm)',
      cancel: 'Hủy dòng kế hoạch',
    },
  },
  tms_vehicle_types: {
    page: 'Cài đặt TMS',
    tab:  'Loại xe',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm loại xe',
      edit:   'Sửa loại xe',
    },
  },
  tms_slots: {
    page: 'Cài đặt TMS',
    tab:  'Khung giờ',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm khung giờ',
      edit:   'Sửa khung giờ',
      delete: 'Xóa khung giờ',
    },
  },
  tms_companies: {
    page: 'Cài đặt TMS',
    tab:  'ĐVVT / NCC',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm ĐVVT',
      edit:   'Sửa ĐVVT',
      delete: 'Xóa ĐVVT',
    },
  },
  tms_vehicles: {
    page: 'Cài đặt TMS',
    tab:  'Xe',
    actions: {
      view:   'Xem danh sách xe',
      create: 'Thêm xe',
      edit:   'Sửa xe',
      delete: 'Xóa xe',
    },
  },
  gate_registration: {
    page: 'Đăng ký cổng',
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
  materials: {
    page: 'Mã hàng',
    actions: {
      view:   'Xem danh sách',
      create: 'Thêm mã hàng',
      edit:   'Sửa mã hàng',
      delete: 'Ẩn mã hàng',
    },
  },
  pallet_print: {
    page: 'In tem pallet',
    actions: {
      view:    'Xem trang',
      generate:'Sinh tem mới (in)',
      reprint: 'In lại (tồn kho / lịch sử)',
    },
  },
  pallet_ops: {
    page: 'Dồn / Tách pallet',
    actions: {
      view:    'Xem trang',
      merge:   'Dồn (gom nhóm)',
      ungroup: 'Tách nhóm (gỡ dồn)',
      split:   'Tách số lượng',
    },
  },
  leave: {
    page: 'Chấm công',
    tab:  'Nghỉ phép',
    actions: {
      view:    'Xem danh sách',
      request: 'Gửi đơn nghỉ',
      approve: 'Duyệt / Từ chối',
      delete:  'Xóa đơn',
    },
  },
  attendance: {
    page: 'Chấm công',
    tab:  'Bảng công',
    actions: {
      view:     'Xem bảng công [Bảng công]',
      self_log: 'Tự chấm công (của mình) [Của tôi]',
      edit:     'Sửa công người khác [Bảng công]',
      report:   'Xem báo cáo [Bảng công]',
    },
  },
  work_assignment: {
    page: 'Phân công lịch làm việc',
    actions: {
      view:               'Xem phân công',
      create:             'Tạo phiếu + Tự xếp',
      edit:               'Sửa tay (đổi người)',
      publish:            'Phát hành',
      delete:             'Xóa phiếu',
      manage_layout:      'Quản lý Layout vị trí',
      manage_shift_rules: 'Quản lý Quy tắc ca',
    },
  },
} as const

export type ModuleKey = keyof typeof MODULES
export type ModulePermissions = Partial<Record<ModuleKey, string[]>>

// PERMISSION_PAGES (gom module theo Trang → Tab cho trình phân quyền) ĐÃ CHUYỂN sang
// `config/navigation.ts` để xếp THEO THỨ TỰ SIDEBAR (tránh import vòng: navigation → permissions).

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
