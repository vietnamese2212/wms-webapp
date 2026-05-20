export const ALL_PERMISSIONS: Record<string, string[]> = {
  inventory:    ['view', 'adjust', 'move_location', 'recode', 'export'],
  inbound:      ['view', 'create', 'scan', 'delete_pallet', 'cancel'],
  outbound:     ['view', 'create', 'start', 'scan', 'assign', 'complete', 'cancel'],
  loosepicking: ['view', 'create', 'start', 'scan', 'complete', 'cancel'],
  stocktake:    ['view', 'create', 'scan', 'complete'],
  locations:    ['view', 'create', 'edit', 'delete'],
  employees:    ['view', 'create', 'edit', 'set_password'],
  vehicles:     ['view', 'create', 'edit'],
  deliveries:   ['view', 'create', 'edit'],
}
