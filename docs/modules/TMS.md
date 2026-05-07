# Module TMS – Transport Management

## Status: ❌ NOT BUILT (mock data only)

## Frontend Files
```
frontend/src/pages/tms/Vehicles.tsx    ← mock useVehicles()
frontend/src/pages/tms/Deliveries.tsx  ← mock useDeliveries()
```

## Mock Hooks (need replacing)
- `useVehicles()` → `mockVehicles`
- `useDeliveries()` → `mockDeliveries`

## DB Models (already in schema — no migration needed)
```prisma
Driver        { code, name, phone, id_card, license_no, is_active }
Vehicle       { plate_number, type, capacity_tons, default_driver_id, next_inspection, is_active }
DeliveryOrder { order_code, vehicle_id, driver_id, origin, destination,
                status: PENDING|IN_PROGRESS|COMPLETED|CANCELLED,
                scheduled_at, completed_at }
ExportHistory.delivery_order_id → links export to delivery trip
```

## API to Build
```
GET/POST        /api/tms/vehicles
GET/PUT         /api/tms/vehicles/:id

GET/POST        /api/tms/drivers
GET/PUT         /api/tms/drivers/:id

GET/POST        /api/tms/delivery-orders
GET             /api/tms/delivery-orders/:id
PATCH           /api/tms/delivery-orders/:id/status   body: { status }
```

## TODO
- [ ] `backend/src/routes/tms.ts` + register in `app.ts`
- [ ] `vehicleController.ts`, `driverController.ts`, `deliveryOrderController.ts`
- [ ] Frontend Vehicles page: list, create, edit
- [ ] Frontend Deliveries page: list, create, status update
- [ ] Link DeliveryOrder to ExportHistory (xuất kho → giao hàng)
