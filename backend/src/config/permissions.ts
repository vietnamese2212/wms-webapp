export const ALL_PERMISSIONS: Record<string, string[]> = {
  inventory:    ['view', 'adjust', 'move_location', 'recode', 'qa_update', 'update_ncc', 'update_prod_date', 'export', 'import'],
  inbound:      ['view', 'create', 'edit', 'scan', 'edit_pallet', 'force_edit_pallet', 'delete_pallet', 'force_delete_pallet', 'cancel', 'complete', 'uncomplete'],
  outbound:     ['view', 'prepare', 'create', 'quick_export', 'import', 'edit', 'assign', 'unassign', 'start', 'unstart', 'scan', 'complete', 'uncomplete', 'cancel', 'reconcile'],
  scanlog:      ['view', 'export'],
  loosepicking: ['view', 'scan', 'complete'],
  stocktake:    ['view', 'scan', 'complete', 'export'],
  locations:    ['view', 'create', 'edit', 'delete', 'import', 'export'],
  employees:    ['view'],
  user_admin:   ['view', 'create', 'edit', 'set_password', 'delete', 'manage_roles'],
  wms_settings: ['view', 'manage_warehouse', 'manage_type', 'manage_unit', 'manage_zone', 'manage_shift', 'manage_qa', 'manage_system'],
  tms_plan:          ['view', 'create', 'edit', 'delete', 'add_vehicle', 'release', 'change_date', 'book', 'revoke', 'upload_outbound', 'upload_inbound', 'confirm_receipt', 'export'],
  tms_vehicle_types: ['view', 'create', 'edit', 'delete'],
  tms_slots:         ['view', 'create', 'edit', 'delete'],
  tms_companies:     ['view', 'create', 'edit', 'delete'],
  tms_vehicles:      ['view', 'create', 'edit', 'delete'],
  gate_registration: ['view', 'create', 'edit', 'delete', 'call', 'entry', 'exit'],
  weigh_station: ['view', 'match'],
  control_tower:     ['view'],
  slotting:          ['view', 'plan', 'complete', 'configure'],   // Tối ưu vị trí: xem / tạo-xóa kế hoạch / hoàn thành-hủy-mở lại / tab Cài đặt (hạng nhặt + luồng cửa khu)
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
