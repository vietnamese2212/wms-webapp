# Schema Quick Reference (rev 9)

## Masterdata Models
| Model | Key Fields | Notes |
|---|---|---|
| `Warehouse` | `code` (unique), `name`, `address`, `is_active` | Code = prefix for location_code (e.g., "BV") |
| `Location` | `warehouse_id`, `sub_code`, `sub_name`, `sub_type`, `location_code` (unique, auto-gen), `row`, `shelf`, `max_pallets` | `location_code = {warehouse.code}_{sub_code}_{row}_{shelf}` |
| `Manufacturer` | `code` (unique), `name`, `is_active` | Used as NMSX suffix in QR code |
| `Material` | `material_code` (unique), `material_description`, `short_name`, `cartons_per_pallet`, `ea_per_pallet`, `manufacturer_id` | `short_name = custom_short_name ?? material_description + [last3digits]` |
| `Employee` | `warehouse_id`, `employee_code`, `name`, `role`, `department`, `email`, `password` (bcrypt) | Roles: ADMIN / WAREHOUSE_MANAGER / WAREHOUSE_STAFF / DRIVER / HR_MANAGER |
| `Driver` | `code`, `name`, `phone`, `license_no` | Separate from Employee |
| `Vehicle` | `plate_number` (unique), `type`, `capacity_tons`, `default_driver_id`, `next_inspection` | |

## WMS Models
| Model | Key Fields | Status Values |
|---|---|---|
| `ProductionImport` | `import_code` (unique, auto: NK-YYYYMMDD-NNN), `warehouse_id`, `location_id`, `material_id`, `planned_pallets`, `status`, `imported_by`, `created_by`, `updated_by` | OPEN / COMPLETED / CANCELLED |
| `InventoryEntry` | `pallet_code` (unique), `location_id`, `material_id`, `manufacturer_id`, `cycle`, `machine_code`, `import_order_id`, `stack_layer` (1/2/3), `cartons_imported`, `production_date`, `status`, `created_by`, `updated_by` | IN_STOCK / EXPORTED / TRANSFERRED / PARTIAL |
| `ExportHistory` | `inventory_entry_id`, `material_id`, `exported_by`, `delivery_order_id`, `quantity`, `export_date` | Per-export record |
| `LocationTransfer` | `inventory_entry_id`, `from_location_id`, `to_location_id`, `transferred_by` | Pallet move history |

## TMS Models
| Model | Key Fields | Status Values |
|---|---|---|
| `DeliveryOrder` | `order_code`, `vehicle_id`, `driver_id`, `origin`, `destination`, `status`, `scheduled_at`, `completed_at` | PENDING / IN_PROGRESS / COMPLETED / CANCELLED |

## HR Models
| Model | Key Fields | Status Values |
|---|---|---|
| `Shift` | `name`, `start_time`, `end_time`, `days_of_week[]` | |
| `Schedule` | `employee_id`, `shift_id`, `date`, `status`, `check_in`, `check_out` | SCHEDULED / CONFIRMED / ABSENT / LATE |
| `OvertimeRequest` | `employee_id`, `date`, `hours`, `reason`, `status`, `approved_by` | PENDING / APPROVED / REJECTED |
| `Attendance` | `employee_id`, `date`, `check_in DateTime?`, `check_out DateTime?` | `@@unique([employee_id, date])` |

## System Models
| Model | Purpose |
|---|---|
| `Menu` | Role-based menu permissions (tree structure) |
| `Setting` | Key-value system config |

## Named Relations on Employee (required due to multiple FKs)
```
PIImportedBy, PICreatedBy, PIUpdatedBy  →  ProductionImport
IECreatedBy, IEUpdatedBy               →  InventoryEntry
```

## Key Business Rules in Schema
- `stack_layer = 1` → pallet on floor, counted toward `Location.max_pallets`
- `stack_layer = 2/3` → stacked on another pallet, NOT counted toward capacity
- Only `stack_layer=1` + `status=IN_STOCK` entries count as "used slots" for a location

## Migration History
| Rev | Migration Name | Changes |
|---|---|---|
| 1–8 | (earlier) | Initial schema, all masterdata models |
| 9 | `20260507075751_inbound_feature` | ProductionImport: added warehouse_id, location_id, status, planned_pallets, created_by, updated_by; InventoryEntry: added machine_code, import_order_id, created_by, updated_by; Named relations on Employee |

## Rule After Every Schema Change
1. `cd backend && npx prisma migrate dev --name <description>`
2. Update `SCHEMA_REVIEW.md` (schema code + model status table + changelog)
3. Git push
