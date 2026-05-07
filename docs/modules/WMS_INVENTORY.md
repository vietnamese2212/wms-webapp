# Module WMS – Inventory Dashboard & Locations

## Status: Locations ✅ | Inventory Dashboard ❌ (mock data)

## Frontend Files
```
frontend/src/pages/wms/Inventory.tsx   ← mock useInventory() — needs real API
frontend/src/pages/wms/Locations.tsx   ← uses real useLocationsReal() ✅
```

## Real API Already Available (via masterdata)
- `GET /api/masterdata/locations?warehouse_id=&sub_code=`
- Hook: `useLocationsReal(params?)`

## Mock Hooks (need replacing)
- `useInventory()` → `mockInventory`
- `useTransactions(limit?)` → `mockTransactions`
- `useLocations()` → `mockLocations`

## Inventory API to Build
```
GET /api/wms/inventory
  → Group InventoryEntry by (location_id, material_id) where status = "IN_STOCK"
  → Return: location_code, material info, pallet_count, total_cartons
  → Include: warning if pallet_count < material.min_stock (if field added)

GET /api/wms/inventory/summary
  → By warehouse: total pallets, total locations used, utilization %

GET /api/wms/transactions
  → InventoryEntry + ExportHistory + LocationTransfer combined log
  → Filters: date_from, date_to, material_id, location_id
```

## TODO
- [ ] `GET /api/wms/inventory` endpoint (add to `wms.ts`)
- [ ] Replace `useInventory()` hook with real API call
- [ ] Inventory dashboard: pallet count by location, material breakdown
- [ ] Low stock alerts (compare against threshold)
- [ ] Transaction log view combining all history
- [ ] Cycle Count feature (separate, see below)

## Cycle Count (Future Feature)
- Create `CycleCount` model: `{ id, location_id, counted_by, count_date, status }`
- User selects location → system shows expected stock (InventoryEntry IN_STOCK)
- User enters actual count → system flags discrepancies
- `GET /api/wms/cycle-counts`, `POST /api/wms/cycle-counts/:id/submit`
