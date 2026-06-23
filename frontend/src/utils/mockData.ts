import type {
  Product, Location, InventoryItem, Transaction,
  Vehicle, Driver,
  Employee, Shift,
} from '@/types'

export const mockProducts: Product[] = [
  { id: 'P001', sku: 'SKU-001', name: 'Thùng carton 3 lớp 40x30x30', unit: 'Thùng', category: 'Bao bì', minStock: 50, qrCode: 'QR-P001' },
  { id: 'P002', sku: 'SKU-002', name: 'Băng keo OPP trong 5cm', unit: 'Cuộn', category: 'Vật tư', minStock: 100, qrCode: 'QR-P002' },
  { id: 'P003', sku: 'SKU-003', name: 'Pallet gỗ tiêu chuẩn 1.2x1.0m', unit: 'Cái', category: 'Pallet', minStock: 20, qrCode: 'QR-P003' },
  { id: 'P004', sku: 'SKU-004', name: 'Màng co nhiệt PE', unit: 'Cuộn', category: 'Vật tư', minStock: 30, qrCode: 'QR-P004' },
  { id: 'P005', sku: 'SKU-005', name: 'Thùng gỗ xuất khẩu 60x40x40', unit: 'Thùng', category: 'Bao bì', minStock: 40, qrCode: 'QR-P005' },
  { id: 'P006', sku: 'SKU-006', name: 'Nhãn mã vạch 100x150mm', unit: 'Tập', category: 'Vật tư', minStock: 200, qrCode: 'QR-P006' },
  { id: 'P007', sku: 'SKU-007', name: 'Xốp lót PE 5mm', unit: 'Tấm', category: 'Vật tư', minStock: 60, qrCode: 'QR-P007' },
  { id: 'P008', sku: 'SKU-008', name: 'Dây đai nhựa 16mm', unit: 'Cuộn', category: 'Vật tư', minStock: 25, qrCode: 'QR-P008' },
]

export const mockLocations: Location[] = [
  { id: 'L001', zone: 'A', row: '01', shelf: '1', bin: '01', qrCode: 'QR-L001', capacity: 10, currentPallets: 8 },
  { id: 'L002', zone: 'A', row: '01', shelf: '1', bin: '02', qrCode: 'QR-L002', capacity: 10, currentPallets: 3 },
  { id: 'L003', zone: 'A', row: '01', shelf: '2', bin: '01', qrCode: 'QR-L003', capacity: 8, currentPallets: 0 },
  { id: 'L004', zone: 'A', row: '02', shelf: '1', bin: '01', qrCode: 'QR-L004', capacity: 10, currentPallets: 10 },
  { id: 'L005', zone: 'B', row: '01', shelf: '1', bin: '01', qrCode: 'QR-L005', capacity: 12, currentPallets: 5 },
  { id: 'L006', zone: 'B', row: '01', shelf: '2', bin: '01', qrCode: 'QR-L006', capacity: 12, currentPallets: 11 },
  { id: 'L007', zone: 'B', row: '02', shelf: '1', bin: '01', qrCode: 'QR-L007', capacity: 8, currentPallets: 2 },
  { id: 'L008', zone: 'C', row: '01', shelf: '1', bin: '01', qrCode: 'QR-L008', capacity: 15, currentPallets: 7 },
]

export const mockInventory: InventoryItem[] = [
  { id: 'INV001', product: mockProducts[0], location: mockLocations[0], quantity: 480, pallets: 8, batchNumber: 'LOT-2024-001', updatedAt: '2026-05-06T08:30:00Z', status: 'IN_STOCK' },
  { id: 'INV002', product: mockProducts[1], location: mockLocations[1], quantity: 30, pallets: 3, batchNumber: 'LOT-2024-012', updatedAt: '2026-05-06T10:15:00Z', status: 'LOW_STOCK' },
  { id: 'INV003', product: mockProducts[2], location: mockLocations[4], quantity: 60, pallets: 5, updatedAt: '2026-05-05T16:00:00Z', status: 'IN_STOCK' },
  { id: 'INV004', product: mockProducts[3], location: mockLocations[5], quantity: 22, pallets: 11, batchNumber: 'LOT-2024-008', updatedAt: '2026-05-06T09:00:00Z', status: 'LOW_STOCK' },
  { id: 'INV005', product: mockProducts[4], location: mockLocations[3], quantity: 0, pallets: 0, updatedAt: '2026-05-04T14:00:00Z', status: 'OUT_OF_STOCK' },
  { id: 'INV006', product: mockProducts[5], location: mockLocations[7], quantity: 840, pallets: 7, batchNumber: 'LOT-2024-020', updatedAt: '2026-05-07T07:00:00Z', status: 'IN_STOCK' },
  { id: 'INV007', product: mockProducts[6], location: mockLocations[2], quantity: 0, pallets: 0, updatedAt: '2026-05-03T11:00:00Z', status: 'OUT_OF_STOCK' },
  { id: 'INV008', product: mockProducts[7], location: mockLocations[6], quantity: 16, pallets: 2, updatedAt: '2026-05-07T08:00:00Z', status: 'IN_STOCK' },
]

export const mockTransactions: Transaction[] = [
  {
    id: 'TXN001', type: 'INBOUND', product: mockProducts[0], location: mockLocations[0],
    quantity: 120, pallets: 2, userId: '2', userName: 'Trần Văn Kho',
    status: 'COMPLETED', createdAt: '2026-05-07T07:30:00Z', completedAt: '2026-05-07T08:15:00Z',
    referenceNo: 'PO-2026-0512', note: 'Nhập từ nhà cung cấp ABC',
  },
  {
    id: 'TXN002', type: 'OUTBOUND', product: mockProducts[2], location: mockLocations[4],
    quantity: 60, pallets: 5, userId: '3', userName: 'Lê Thị Hoa',
    status: 'IN_PROGRESS', createdAt: '2026-05-07T09:00:00Z',
    referenceNo: 'SO-2026-1843',
  },
  {
    id: 'TXN003', type: 'INBOUND', product: mockProducts[5], location: mockLocations[7],
    quantity: 300, pallets: 3, userId: '2', userName: 'Trần Văn Kho',
    status: 'PENDING', createdAt: '2026-05-07T10:00:00Z',
    referenceNo: 'PO-2026-0513',
  },
  {
    id: 'TXN004', type: 'OUTBOUND', product: mockProducts[1], location: mockLocations[1],
    quantity: 50, pallets: 5, userId: '4', userName: 'Phạm Đức Minh',
    status: 'COMPLETED', createdAt: '2026-05-06T14:00:00Z', completedAt: '2026-05-06T15:30:00Z',
    referenceNo: 'SO-2026-1840',
  },
  {
    id: 'TXN005', type: 'CYCLE_COUNT', product: mockProducts[3], location: mockLocations[5],
    quantity: 22, pallets: 11, userId: '1', userName: 'Nguyễn Văn Quản Lý',
    status: 'COMPLETED', createdAt: '2026-05-06T16:00:00Z', completedAt: '2026-05-06T16:45:00Z',
    referenceNo: 'CC-2026-0089',
  },
  {
    id: 'TXN006', type: 'TRANSFER', product: mockProducts[0], location: mockLocations[0],
    quantity: 60, pallets: 1, userId: '3', userName: 'Lê Thị Hoa',
    status: 'COMPLETED', createdAt: '2026-05-05T11:00:00Z', completedAt: '2026-05-05T11:30:00Z',
    referenceNo: 'TR-2026-0211',
  },
]

export const mockDrivers: Driver[] = [
  { id: 'D001', name: 'Nguyễn Tài Xế A', licenseNumber: 'B2-123456', phone: '0912345678', status: 'ACTIVE' },
  { id: 'D002', name: 'Trần Tài Xế B', licenseNumber: 'C-654321', phone: '0987654321', status: 'ACTIVE' },
  { id: 'D003', name: 'Lê Tài Xế C', licenseNumber: 'B2-111222', phone: '0901234567', status: 'ON_LEAVE' },
  { id: 'D004', name: 'Phạm Tài Xế D', licenseNumber: 'C-999888', phone: '0933333333', status: 'ACTIVE' },
]

export const mockVehicles: Vehicle[] = [
  { id: 'V001', plateNumber: '51F-12345', type: 'TRUCK', capacity: 5000, driver: mockDrivers[0], status: 'AVAILABLE', nextInspectionDate: '2026-08-15', brand: 'HINO', model: 'XZU730L', year: 2022 },
  { id: 'V002', plateNumber: '51G-67890', type: 'TRUCK', capacity: 8000, driver: mockDrivers[1], status: 'IN_USE', nextInspectionDate: '2026-06-20', brand: 'Thaco', model: 'OLLIN', year: 2021 },
  { id: 'V003', plateNumber: '51H-11111', type: 'VAN', capacity: 1500, driver: mockDrivers[2], status: 'MAINTENANCE', nextInspectionDate: '2026-09-01', brand: 'Ford', model: 'Transit', year: 2020 },
  { id: 'V004', plateNumber: '51K-22222', type: 'CONTAINER', capacity: 20000, driver: mockDrivers[3], status: 'AVAILABLE', nextInspectionDate: '2026-05-10', brand: 'ISUZU', model: 'FVM34W', year: 2023 },
  { id: 'V005', plateNumber: '51L-33333', type: 'VAN', capacity: 1000, status: 'EXPIRED', nextInspectionDate: '2026-04-01', brand: 'Hyundai', model: 'Porter', year: 2019 },
]

export const mockEmployees: Employee[] = [
  { id: 'E001', name: 'Nguyễn Văn Quản Lý', employeeCode: 'NV001', department: 'Kho vận', phone: '0901234567', email: 'ql@wms.vn', qrCode: 'QR-E001', status: 'ACTIVE', joinDate: '2021-03-01' },
  { id: 'E002', name: 'Trần Văn Kho', employeeCode: 'NV002', department: 'Kho vận', phone: '0912345678', email: 'tvk@wms.vn', qrCode: 'QR-E002', status: 'ACTIVE', joinDate: '2022-01-15' },
  { id: 'E003', name: 'Lê Thị Hoa', employeeCode: 'NV003', department: 'Kho vận', phone: '0923456789', email: 'lth@wms.vn', qrCode: 'QR-E003', status: 'ACTIVE', joinDate: '2022-06-01' },
  { id: 'E004', name: 'Phạm Đức Minh', employeeCode: 'NV004', department: 'Kho vận', phone: '0934567890', email: 'pdm@wms.vn', qrCode: 'QR-E004', status: 'ON_LEAVE', joinDate: '2023-02-10' },
  { id: 'E005', name: 'Hoàng Thị Lan', employeeCode: 'NV005', department: 'Nhân sự', phone: '0945678901', email: 'htl@wms.vn', qrCode: 'QR-E005', status: 'ACTIVE', joinDate: '2020-11-01' },
  { id: 'E006', name: 'Nguyễn Tài Xế A', employeeCode: 'NV006', department: 'Vận tải', phone: '0912345678', email: 'nta@wms.vn', qrCode: 'QR-E006', status: 'ACTIVE', joinDate: '2022-03-15' },
  { id: 'E007', name: 'Trần Tài Xế B', employeeCode: 'NV007', department: 'Vận tải', phone: '0987654321', email: 'ttb@wms.vn', qrCode: 'QR-E007', status: 'ACTIVE', joinDate: '2021-09-01' },
  { id: 'E008', name: 'Võ Văn Phụ Kho', employeeCode: 'NV008', department: 'Kho vận', phone: '0956789012', email: 'vvpk@wms.vn', qrCode: 'QR-E008', status: 'ACTIVE', joinDate: '2023-08-20' },
]

export const mockShifts: Shift[] = [
  { id: 'S001', name: 'Ca Sáng', type: 'MORNING', startTime: '06:00', endTime: '14:00', daysOfWeek: [1,2,3,4,5,6], color: '#3B82F6' },
  { id: 'S002', name: 'Ca Chiều', type: 'AFTERNOON', startTime: '14:00', endTime: '22:00', daysOfWeek: [1,2,3,4,5,6], color: '#F59E0B' },
  { id: 'S003', name: 'Ca Tối', type: 'NIGHT', startTime: '22:00', endTime: '06:00', daysOfWeek: [1,2,3,4,5,6], color: '#8B5CF6' },
  { id: 'S004', name: 'Ca Hành Chính', type: 'FULL_DAY', startTime: '08:00', endTime: '17:00', daysOfWeek: [1,2,3,4,5], color: '#10B981' },
]

export const dashboardKPIs = {
  inventoryAccuracy: 99.7,
  orderFulfillmentRate: 97.8,
  warehouseUtilization: 76.2,
  todayInbound: 3,
  todayOutbound: 7,
  lowStockAlerts: 3,
}
