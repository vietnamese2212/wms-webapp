export const ALL_PERMISSIONS: Record<string, string[]> = {
  inventory:    ['view', 'adjust', 'move_location', 'recode', 'qa_update', 'update_ncc', 'update_prod_date', 'export', 'import'],
  inbound:      ['view', 'create', 'edit', 'scan', 'edit_pallet', 'force_edit_pallet', 'delete_pallet', 'force_delete_pallet', 'cancel', 'complete', 'uncomplete', 'putaway_override'],
  outbound:     ['view', 'prepare', 'create', 'quick_export', 'import', 'edit', 'assign', 'unassign', 'start', 'unstart', 'scan', 'complete', 'uncomplete', 'cancel', 'reconcile', 'weigh_waive', 'gate_waive', 'rotation_override'],
  scanlog:      ['view', 'export'],
  loosepicking: ['view', 'scan', 'complete', 'recalc'],
  stocktake:    ['view', 'scan', 'complete', 'export'],
  locations:    ['view', 'create', 'edit', 'delete', 'import', 'export', 'print_label'],
  employees:    ['view'],
  user_admin:   ['view', 'create', 'edit', 'set_password', 'delete', 'manage_roles'],
  wms_settings: ['view', 'manage_warehouse', 'manage_type', 'manage_unit', 'manage_zone', 'manage_shift', 'manage_qa', 'manage_machine', 'manage_system'],
  tms_plan:          ['view', 'create', 'edit', 'delete', 'add_vehicle', 'release', 'change_date', 'book', 'revoke', 'upload_outbound', 'upload_inbound', 'confirm_receipt', 'export'],
  tms_vehicle_types: ['view', 'create', 'edit', 'delete'],
  tms_slots:         ['view', 'create', 'edit', 'delete'],
  tms_companies:     ['view', 'create', 'edit', 'delete'],
  tms_vehicles:      ['view', 'create', 'edit', 'delete'],
  gate_registration: ['view', 'create', 'edit', 'delete', 'call', 'entry', 'exit'],
  weigh_station: ['view', 'match'],
  dashboard:         ['view'],          // Trang Tổng quan (19/08 — trước đó mở cho mọi user; migration 20260819b backfill mọi chức danh)
  control_tower:     ['view'],
  // Chi phí kho (27/08): TIỀN là dữ liệu nhạy cảm — tách hẳn khỏi `dashboard.view`, ai không có
  // `warehouse_cost.view` vẫn xem được tấn/công/tăng ca nhưng KHÔNG thấy ô nào có tiền.
  warehouse_cost:    ['view', 'edit', 'lock'],
  alerts:            ['view', 'ack'],   // Trung tâm cảnh báo (06/08): view = xem + nhận push cảnh báo mới theo kho; ack riêng
  slotting:          ['view', 'plan', 'delete', 'complete', 'cancel', 'reopen', 'configure'],   // Tối ưu vị trí: mỗi nút 1 quyền (tách 05/08 — tạo / xóa / hoàn thành / hủy / mở lại / tab Cài đặt)
  fill:              ['view', 'plan', 'cancel', 'change_dest', 'assign', 'execute'],   // Fill hàng: mỗi nút 1 quyền (tách 05/08 — ra lệnh / hủy dòng·lệnh / đổi vị trí đến / gán người / quét)
  forklift:          ['view', 'check', 'delete_check', 'manage_vehicle', 'manage_item'],   // Xe nâng: ghi-sửa check ≠ xóa bản ghi (tách 05/08) / danh mục xe / danh mục hạng mục
  packing:           ['view', 'record', 'open_run', 'edit', 'cancel', 'export'],   // Sổ đóng gói (11/08): open_run = mở/đóng TRANG SỔ (lệnh) ≠ record = quét pallet; export riêng theo luật 26/07
  inbound_plan:      ['view', 'edit'],   // create/delete/cancel ĐÃ BỎ (mồ côi — đi theo tms_plan.upload_inbound/edit)
  materials:         ['view', 'create', 'edit', 'import', 'delete'],
  pallet_print:      ['view', 'generate', 'reprint', 'history', 'audit'],
  pallet_ops:        ['view', 'merge', 'ungroup', 'split'],
  work_skill:        ['view', 'create', 'edit', 'delete', 'assign'],
  leave:             ['view', 'request', 'approve', 'delete', 'export'],
  work_assignment:   ['view', 'create', 'edit', 'publish', 'delete', 'manage_layout', 'manage_shift_rules'],
  attendance:        ['view', 'self_log', 'edit', 'report'],
  external_do_sap:   ['view', 'create', 'edit', 'delete', 'export'],   // Dữ liệu bên ngoài → tab DO SAP (raw ERP/SAP)
  external_khvc:     ['view', 'create', 'edit', 'delete'],   // Dữ liệu bên ngoài → tab Kế hoạch xuất (raw KHVC/điều vận)
}
