# Module WMS – Nhập kho (Inbound)

## Status: ✅ DONE (backend + frontend + migration applied)
## Lưu ý: Cần tốc độ truy xuất và di chuyển giữa các transaction nhanh, ưu tiên cảm giác sử dụng của người dùng

## Flow
1. User tạo phiếu nhập (`ProductionImport`) → chọn kho, material, vị trí (optional), planned_pallets
2. Phiếu tạo với `status = "OPEN"`, `import_code = "NK-YYYYMMDD-NNN"` (auto-gen)
3. User mở phiếu → quét QR pallet → xác nhận thông tin → `InventoryEntry` được tạo
4. User complete / cancel phiếu

## QR Code Format
```
ddmmyy_MaterialCode_ChuKy_MachineCode_PalletSeq_ManufacturerCode
VD: 070526_510000127_C05_M1_001_A
```
Parsed by `backend/src/utils/qrParser.ts` → `parseInboundQR(raw): ParsedQR`

## Scan Validations (inboundController.ts → scanQR)
1. QR phải parse được (≥ 6 parts)
2. `material_code` trong QR phải khớp `ProductionImport.material.material_code`
3. `pallet_code` phải unique (không trùng)
4. `stack_layer = 1`: kiểm tra `used_slots < max_pallets`
5. `stack_layer = 2/3`: phải có base layer (`stack_layer - 1`) đang `IN_STOCK` tại cùng location
6. `manufacturer_code` được auto-lookup từ `Manufacturer.code`
7. `cartons_imported` = `material.cartons_per_pallet` (user override được)

## Location Suggestions
- `GET /api/wms/inbound-orders/:id/location-suggestions`
- Sort: `has_same_material DESC`, `available_slots DESC`, limit 10
- `available_slots = max_pallets - count(stack_layer=1, IN_STOCK entries)`

## Backend Files
```
backend/src/routes/wms.ts
backend/src/controllers/wms/inboundController.ts
backend/src/utils/qrParser.ts
```

## API Endpoints
```
GET    /api/wms/inbound-orders                          ?warehouse_id, status, material_id, search
POST   /api/wms/inbound-orders                          body: { warehouse_id, material_id, location_id?, planned_pallets?, notes? }
GET    /api/wms/inbound-orders/:id                      includes inventory_entries
PATCH  /api/wms/inbound-orders/:id                      body: { location_id?, planned_pallets?, notes? }
POST   /api/wms/inbound-orders/:id/complete
POST   /api/wms/inbound-orders/:id/cancel
POST   /api/wms/inbound-orders/:id/scan                 body: { qr_code, location_id, stack_layer?, cartons_override? }
DELETE /api/wms/inbound-orders/:id/entries/:entryId
GET    /api/wms/inbound-orders/:id/location-suggestions
```

## QR Scan Flow (AppSheet-style – instant, no confirm dialog)
1. User chọn vị trí trên phiếu (nếu chưa có — inline select trong card)
2. Bấm "Mở camera quét QR" → **full-screen overlay** mở (camera chiếm toàn màn hình)
3. Camera bắt QR → `playBeep()` ngay lập tức → overlay đóng → quay ra trang phiếu
4. API call chạy background (`location_id = order.location_id`, `stack_layer = 1` default)
5. Thành công → banner xanh hiện trong scan card → nút đổi thành "Quét pallet tiếp ▸"
6. Lỗi → banner đỏ → nút "Mở camera quét QR" để thử lại
7. Không có confirm dialog, không có delay nhân tạo

### Audio
- `frontend/src/utils/audio.ts` → `unlockAudio()` + `playBeep()`
- **`unlockAudio()` PHẢI gọi trong onClick** (user-gesture) khi mở camera — browser chặn AudioContext nếu không có gesture
- `playBeep()` dùng shared AudioContext đã unlock

### Camera UX – Full-screen overlay (`CameraOverlay` component trong InboundDetail)
- `fixed inset-0 z-50 bg-black` — chiếm toàn màn hình như native app
- Top bar: nút back + material code + location code đang nhập
- Khi QR detect: overlay đóng ngay (`setShowCamera(false)`) → camera unmount → cleanup tự stop
- `QRScanner` export `QRScannerHandle { resume() }` qua `forwardRef` (cho các module khác nếu cần)

## Frontend Files
```
frontend/src/pages/wms/Inbound.tsx           ← list (stats + table + create dialog)
frontend/src/pages/wms/InboundDetail.tsx     ← detail (instant QR scan + inline feedback + pallet table)
frontend/src/components/shared/QRScanner.tsx ← html5-qrcode wrapper + forwardRef + QRScannerHandle
```

## Frontend Hooks (hooks.ts)
```
useInboundOrders(params?)
useInboundOrder(id?)
useInboundLocationSuggestions(orderId?)
useCreateInboundOrder()
useUpdateInboundOrder()
useCompleteInboundOrder()
useCancelInboundOrder()
useScanPallet()
useDeletePalletEntry()
```

## Types (types/index.ts)
```typescript
InboundOrderStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED'
InboundOrder       // full with _count.inventory_entries, relations, inventory_entries?
PalletEntry        // InventoryEntry with all relations
LocationSuggestion // { id, location_code, sub_code, sub_name, max_pallets, used_slots, available_slots, has_same_material }
```

## DB Models
- `ProductionImport` — phiếu nhập (header)
- `InventoryEntry` — mỗi pallet quét vào
- Named relations: `PIImportedBy`, `PICreatedBy`, `PIUpdatedBy`, `IECreatedBy`, `IEUpdatedBy`

## Migration Applied
`backend/prisma/migrations/20260507075751_inbound_feature/` → applied to Supabase ✅
