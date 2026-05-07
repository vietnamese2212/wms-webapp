# Module Masterdata

## Status: Backend ✅ | Frontend Locations ✅ | Frontend Warehouse/Material/Manufacturer ❌

## Backend Routes (`/api/masterdata/...`)
```
GET/POST        /warehouses
GET/PUT/DELETE  /warehouses/:id

GET             /locations/sub-groups     ?warehouse_id  → distinct sub_code groups
GET/POST        /locations                ?warehouse_id, sub_code
GET/PUT/DELETE  /locations/:id

GET/POST        /manufacturers
GET/PUT/DELETE  /manufacturers/:id

GET/POST        /materials                ?search, manufacturer_id
GET/PUT/DELETE  /materials/:id
```

## Backend Files
```
backend/src/routes/masterdata.ts
backend/src/controllers/masterdata/warehouseController.ts
backend/src/controllers/masterdata/locationController.ts
backend/src/controllers/masterdata/manufacturerController.ts
backend/src/controllers/masterdata/materialController.ts
```

## Frontend Hooks (hooks.ts)
```
useWarehouses(onlyActive?)
useSubGroups(warehouseId?)
useLocationsReal(params?: { warehouse_id?, sub_code? })
useManufacturers()
useMaterials(params?: { search?, manufacturer_id? })
useCreateWarehouse()
useCreateLocation()
useCreateMaterial()
useCreateManufacturer()
```

## Frontend Pages
- `frontend/src/pages/wms/Locations.tsx` — Location management UI ✅
- Warehouse CRUD page → TODO
- Material CRUD page → TODO
- Manufacturer CRUD page → TODO

## Key Business Rules
- `Location.location_code` auto-generated (never entered manually): `{warehouse.code}_{sub_code}_{row}_{shelf}`
- `Material.short_name` = `{custom_short_name ?? material_description} [{last 3 digits of material_code}]`
- `Material.cartons_per_pallet` → used as default `cartons_imported` when scanning inbound QR
- `Manufacturer.code` → NMSX suffix in QR code (last part: `ddmmyy_MatCode_Cycle_Machine_Seq_NMSX`)

## TODO
- [ ] Warehouse CRUD page (list, create, edit, deactivate)
- [ ] Material CRUD page (search, create, edit fields including cartons_per_pallet)
- [ ] Manufacturer CRUD page (simple list + create)
