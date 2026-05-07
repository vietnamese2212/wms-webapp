# Module WMS – Xuất kho (Outbound)

## Status: ❌ NOT BUILT (mock/placeholder page only)

## Frontend File
- `frontend/src/pages/wms/Outbound.tsx` — placeholder with mock data

## DB Models Available (already in schema — no migration needed)
```prisma
ExportHistory { id, inventory_entry_id, material_id, exported_by, delivery_order_id, quantity, export_date }
InventoryEntry.status → "EXPORTED" | "PARTIAL" after export
DeliveryOrder → links export to delivery trip
```

## Planned Flow (to build)
1. User tạo lệnh xuất (DeliveryOrder) hoặc scan QR order
2. Quét QR pallet để xuất — validations:
   - `material_code` trong QR khớp với order
   - Pallet đang `IN_STOCK`
   - Số lượng không vượt yêu cầu
3. Tạo `ExportHistory` record
4. Cập nhật `InventoryEntry.status` → `EXPORTED` hoặc `PARTIAL`

## API Endpoints to Build
```
GET/POST   /api/wms/outbound-orders
GET        /api/wms/outbound-orders/:id
POST       /api/wms/outbound-orders/:id/scan    body: { qr_code, quantity }
POST       /api/wms/outbound-orders/:id/complete
POST       /api/wms/outbound-orders/:id/cancel
```

## TODO
- [ ] Backend: `outboundController.ts` + add routes to `wms.ts`
- [ ] Frontend: Outbound list page, detail page (scan to export)
- [ ] Hooks: `useOutboundOrders`, `useScanExport`, etc.
- [ ] Validation: material match, status check, partial export handling
- [ ] When all cartons exported → `status = "EXPORTED"`, partial → `"PARTIAL"`
