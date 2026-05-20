export const ALL_PERMISSIONS: Record<string, string[]> = {
  inventory:    ['view', 'adjust', 'move_location', 'recode', 'export'],
  inbound:      ['view', 'create', 'scan', 'edit_pallet', 'force_edit_pallet', 'delete_pallet', 'force_delete_pallet', 'cancel'],
  outbound:     ['view', 'create', 'edit', 'assign', 'unassign', 'start', 'unstart', 'scan', 'complete', 'uncomplete', 'cancel'],
  loosepicking: ['view', 'create', 'start', 'scan', 'complete', 'cancel'],
  stocktake:    ['view', 'create', 'scan', 'complete'],
  locations:    ['view', 'create', 'edit', 'delete'],
  employees:    ['view', 'create', 'edit', 'set_password'],
  vehicles:     ['view', 'create', 'edit'],
  deliveries:   ['view', 'create', 'edit'],
}
