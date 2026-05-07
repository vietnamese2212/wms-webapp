import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

function makeShortName(description: string, code: string, custom?: string) {
  const suffix = code.slice(-3)
  const base = custom ?? description
  return `${base} [${suffix}]`
}

async function main() {
  console.log('🌱 Seeding database...')

  // Xoá data cũ theo thứ tự phụ thuộc FK
  await prisma.exportHistory.deleteMany()
  await prisma.locationTransfer.deleteMany()
  await prisma.productionImport.deleteMany()
  await prisma.inventoryEntry.deleteMany()
  await prisma.deliveryOrder.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.overtimeRequest.deleteMany()
  await prisma.schedule.deleteMany()
  await prisma.shift.deleteMany()
  await prisma.vehicle.deleteMany()
  await prisma.driver.deleteMany()
  await prisma.material.deleteMany()
  await prisma.manufacturer.deleteMany()
  await prisma.location.deleteMany()
  await prisma.subWarehouse.deleteMany()
  await prisma.employee.deleteMany()
  await prisma.warehouse.deleteMany()
  await prisma.menu.deleteMany()
  await prisma.setting.deleteMany()

  // ─── WAREHOUSE ─────────────────────────────────────────────
  const bavi = await prisma.warehouse.create({
    data: { code: 'BV', name: 'Kho Ba Vì', address: 'Ba Vì, Hà Nội' },
  })
  const baubang = await prisma.warehouse.create({
    data: { code: 'BB', name: 'Kho Bàu Bàng', address: 'Bàu Bàng, Bình Dương' },
  })

  // ─── SUB-WAREHOUSE ─────────────────────────────────────────
  const bv_tp1 = await prisma.subWarehouse.create({
    data: { warehouse_id: bavi.id, code: 'TP1', name: 'Thành phẩm 1', type: 'THANH_PHAM' },
  })
  const bv_tp2 = await prisma.subWarehouse.create({
    data: { warehouse_id: bavi.id, code: 'TP2', name: 'Thành phẩm 2', type: 'THANH_PHAM' },
  })
  const bv_nl1 = await prisma.subWarehouse.create({
    data: { warehouse_id: bavi.id, code: 'NL1', name: 'Nguyên liệu 1', type: 'NGUYEN_LIEU' },
  })
  const bb_tp1 = await prisma.subWarehouse.create({
    data: { warehouse_id: baubang.id, code: 'TP1', name: 'Thành phẩm 1', type: 'THANH_PHAM' },
  })

  // ─── LOCATION ──────────────────────────────────────────────
  // BV_TP1: 3 hàng × 2 tầng = 6 vị trí
  const locs_bv_tp1: Awaited<ReturnType<typeof prisma.location.create>>[] = []
  for (let row = 1; row <= 3; row++) {
    for (const shelf of ['T1', 'T2']) {
      locs_bv_tp1.push(
        await prisma.location.create({
          data: {
            sub_warehouse_id: bv_tp1.id,
            location_code: `BV_TP1_${row}_${shelf}`,
            row: String(row),
            shelf,
            max_pallets: 2,
          },
        })
      )
    }
  }

  // BV_TP2: 2 hàng × 3 tầng = 6 vị trí
  const locs_bv_tp2: Awaited<ReturnType<typeof prisma.location.create>>[] = []
  for (let row = 1; row <= 2; row++) {
    for (const shelf of ['T1', 'T2', 'T3']) {
      locs_bv_tp2.push(
        await prisma.location.create({
          data: {
            sub_warehouse_id: bv_tp2.id,
            location_code: `BV_TP2_${row}_${shelf}`,
            row: String(row),
            shelf,
            max_pallets: 3,
          },
        })
      )
    }
  }

  // BV_NL1: 2 hàng × 2 tầng
  for (let row = 1; row <= 2; row++) {
    for (const shelf of ['T1', 'T2']) {
      await prisma.location.create({
        data: {
          sub_warehouse_id: bv_nl1.id,
          location_code: `BV_NL1_${row}_${shelf}`,
          row: String(row),
          shelf,
          max_pallets: 2,
        },
      })
    }
  }

  // BB_TP1: 2 hàng × 2 tầng
  const locs_bb_tp1: Awaited<ReturnType<typeof prisma.location.create>>[] = []
  for (let row = 1; row <= 2; row++) {
    for (const shelf of ['T1', 'T2']) {
      locs_bb_tp1.push(
        await prisma.location.create({
          data: {
            sub_warehouse_id: bb_tp1.id,
            location_code: `BB_TP1_${row}_${shelf}`,
            row: String(row),
            shelf,
            max_pallets: 2,
          },
        })
      )
    }
  }

  // ─── MANUFACTURER (NMSX) ───────────────────────────────────
  const mfr_a  = await prisma.manufacturer.create({ data: { code: 'A',  name: 'Nhà máy A' } })
  const mfr_b  = await prisma.manufacturer.create({ data: { code: 'B',  name: 'Nhà máy B' } })
  const mfr_01 = await prisma.manufacturer.create({ data: { code: '01', name: 'Nhà máy 01' } })

  // ─── MATERIAL ──────────────────────────────────────────────
  const mat1 = await prisma.material.create({
    data: {
      material_code: '1000000001',
      material_description: 'Thùng carton 3 lớp 40x30x30',
      short_name: makeShortName('Thùng carton 3 lớp 40x30x30', '1000000001'),
      product_type: 'Bao bì', unit: 'thùng', manufacturer_id: mfr_a.id,
    },
  })
  const mat2 = await prisma.material.create({
    data: {
      material_code: '1000000002',
      material_description: 'Thùng carton 5 lớp 50x40x40',
      short_name: makeShortName('Thùng carton 5 lớp 50x40x40', '1000000002'),
      product_type: 'Bao bì', unit: 'thùng', manufacturer_id: mfr_a.id,
    },
  })
  const mat3 = await prisma.material.create({
    data: {
      material_code: '2000000010',
      material_description: 'Nắp nhựa PP 38mm màu trắng',
      custom_short_name: 'Nắp PP trắng',
      short_name: makeShortName('Nắp nhựa PP 38mm màu trắng', '2000000010', 'Nắp PP trắng'),
      product_type: 'Phụ kiện', unit: 'cái', manufacturer_id: mfr_b.id,
    },
  })
  const mat4 = await prisma.material.create({
    data: {
      material_code: '3000000089',
      material_description: 'Băng keo OPP trong 48mm',
      short_name: makeShortName('Băng keo OPP trong 48mm', '3000000089'),
      product_type: 'Vật tư', unit: 'cuộn', manufacturer_id: mfr_01.id,
    },
  })
  const mat5 = await prisma.material.create({
    data: {
      material_code: '4000000123',
      material_description: 'Pallet gỗ 1200x1000mm',
      short_name: makeShortName('Pallet gỗ 1200x1000mm', '4000000123'),
      product_type: 'Thiết bị', unit: 'cái',
    },
  })

  // Thành phẩm sữa – dữ liệu thực từ LOF
  const mat6 = await prisma.material.create({
    data: {
      material_code: '510000127',
      material_description: 'LOF Ba Vì Sữa tươi Có đường 180mlx48',
      custom_short_name: 'Ba Vì 180',
      short_name: makeShortName('LOF Ba Vì Sữa tươi Có đường 180mlx48', '510000127', 'Ba Vì 180'),
      product_type: '180',
      unit: 'thùng',
      weight_kg: 9.82,
      cartons_per_pallet: 110,
      cartons_per_pallet_mn: 110,
      units_per_carton: 48,
      shelf_life_days: 240,
      storage_category: 'UHT',
      old_code: '401000002',
    },
  })
  const mat7 = await prisma.material.create({
    data: {
      material_code: '510000126',
      material_description: 'LOF Ba Vì Sữa tươi Có đường 110mlx48',
      custom_short_name: 'Ba Vì 110',
      short_name: makeShortName('LOF Ba Vì Sữa tươi Có đường 110mlx48', '510000126', 'Ba Vì 110'),
      product_type: '110',
      unit: 'thùng',
      weight_kg: 6.1,
      cartons_per_pallet: 140,
      cartons_per_pallet_mn: 140,
      units_per_carton: 48,
      shelf_life_days: 240,
      storage_category: 'UHT',
      old_code: '401000001',
    },
  })

  // ─── EMPLOYEE ──────────────────────────────────────────────
  const pw = await bcrypt.hash('123456', 10)

  const emp_admin = await prisma.employee.create({
    data: { employee_code: 'EMP001', name: 'Nguyễn Văn Admin', role: 'ADMIN',
      department: 'IT', email: 'admin@wms.local', password: pw },
  })
  const emp_mgr_bv = await prisma.employee.create({
    data: { warehouse_id: bavi.id, employee_code: 'EMP002', name: 'Trần Thị Lan',
      role: 'WAREHOUSE_MANAGER', department: 'Kho', email: 'lan@wms.local', password: pw },
  })
  const emp_staff1 = await prisma.employee.create({
    data: { warehouse_id: bavi.id, employee_code: 'EMP003', name: 'Lê Văn Minh',
      role: 'WAREHOUSE_STAFF', department: 'Kho', email: 'minh@wms.local', password: pw },
  })
  const emp_staff2 = await prisma.employee.create({
    data: { warehouse_id: bavi.id, employee_code: 'EMP004', name: 'Phạm Thị Hoa',
      role: 'WAREHOUSE_STAFF', department: 'Kho', email: 'hoa@wms.local', password: pw },
  })
  const emp_hr = await prisma.employee.create({
    data: { warehouse_id: bavi.id, employee_code: 'EMP005', name: 'Hoàng Văn Đức',
      role: 'HR_MANAGER', department: 'Nhân sự', email: 'duc@wms.local', password: pw },
  })
  const emp_mgr_bb = await prisma.employee.create({
    data: { warehouse_id: baubang.id, employee_code: 'EMP006', name: 'Vũ Thị Mai',
      role: 'WAREHOUSE_MANAGER', department: 'Kho', email: 'mai@wms.local', password: pw },
  })

  // ─── DRIVER ────────────────────────────────────────────────
  const drv1 = await prisma.driver.create({
    data: { code: 'DRV001', name: 'Nguyễn Văn Tài', phone: '0901234567',
      id_card: '001234567890', license_no: 'B2-12345' },
  })
  const drv2 = await prisma.driver.create({
    data: { code: 'DRV002', name: 'Trần Văn Hùng', phone: '0912345678',
      id_card: '001234567891', license_no: 'C-67890' },
  })
  const drv3 = await prisma.driver.create({
    data: { code: 'DRV003', name: 'Lê Thị Bình', phone: '0923456789',
      id_card: '001234567892', license_no: 'B2-11111' },
  })

  // ─── VEHICLE ───────────────────────────────────────────────
  const veh1 = await prisma.vehicle.create({
    data: { plate_number: '51C-12345', type: 'Xe tải 1.5 tấn', capacity_tons: 1.5,
      default_driver_id: drv1.id, next_inspection: new Date('2026-12-01') },
  })
  const veh2 = await prisma.vehicle.create({
    data: { plate_number: '51C-67890', type: 'Xe tải 3 tấn', capacity_tons: 3.0,
      default_driver_id: drv2.id, next_inspection: new Date('2026-08-15') },
  })
  const veh3 = await prisma.vehicle.create({
    data: { plate_number: '72C-11111', type: 'Xe container 10 tấn', capacity_tons: 10.0,
      default_driver_id: drv3.id, next_inspection: new Date('2026-06-01') },
  })

  // ─── INVENTORY ENTRY ───────────────────────────────────────
  // PAL-BV-001: layer 1 tại BV_TP1_1_T1
  const inv1 = await prisma.inventoryEntry.create({
    data: { pallet_code: 'PAL-BV-001', location_id: locs_bv_tp1[0].id,
      material_id: mat1.id, manufacturer_id: mfr_a.id, cycle: '2025-05',
      stack_layer: 1, cartons_imported: 50, production_date: new Date('2025-05-01'), status: 'IN_STOCK' },
  })
  // PAL-BV-002: layer 2 (chồng lên PAL-BV-001) — demo stack_layer, không tính slot
  const inv2 = await prisma.inventoryEntry.create({
    data: { pallet_code: 'PAL-BV-002', location_id: locs_bv_tp1[0].id,
      material_id: mat1.id, manufacturer_id: mfr_a.id, cycle: '2025-05',
      stack_layer: 2, cartons_imported: 50, production_date: new Date('2025-05-01'), status: 'IN_STOCK' },
  })
  const inv3 = await prisma.inventoryEntry.create({
    data: { pallet_code: 'PAL-BV-003', location_id: locs_bv_tp1[1].id,
      material_id: mat2.id, manufacturer_id: mfr_a.id, cycle: '2025-04',
      stack_layer: 1, cartons_imported: 40, production_date: new Date('2025-04-15'), status: 'IN_STOCK' },
  })
  // PAL-BV-004: PARTIAL — đã xuất 1 phần
  const inv4 = await prisma.inventoryEntry.create({
    data: { pallet_code: 'PAL-BV-004', location_id: locs_bv_tp2[0].id,
      material_id: mat3.id, manufacturer_id: mfr_b.id, cycle: '2025-05',
      stack_layer: 1, cartons_imported: 100, production_date: new Date('2025-05-10'), status: 'PARTIAL' },
  })
  // PAL-BV-005: EXPORTED — đã xuất hết
  const inv5 = await prisma.inventoryEntry.create({
    data: { pallet_code: 'PAL-BV-005', location_id: locs_bv_tp2[1].id,
      material_id: mat4.id, manufacturer_id: mfr_01.id, cycle: '2025-03',
      stack_layer: 1, cartons_imported: 80, production_date: new Date('2025-03-20'), status: 'EXPORTED' },
  })
  const inv6 = await prisma.inventoryEntry.create({
    data: { pallet_code: 'PAL-BB-001', location_id: locs_bb_tp1[0].id,
      material_id: mat2.id, manufacturer_id: mfr_a.id, cycle: '2025-05',
      stack_layer: 1, cartons_imported: 60, production_date: new Date('2025-05-05'), status: 'IN_STOCK' },
  })

  // ─── EXPORT HISTORY ────────────────────────────────────────
  await prisma.exportHistory.create({
    data: { inventory_entry_id: inv4.id, material_id: mat3.id,
      exported_by: emp_staff1.id, quantity: 30,
      export_date: new Date('2025-05-15'), notes: 'Xuất cho đơn ĐH-2025-001' },
  })
  await prisma.exportHistory.create({
    data: { inventory_entry_id: inv5.id, material_id: mat4.id,
      exported_by: emp_staff2.id, quantity: 80,
      export_date: new Date('2025-05-10') },
  })

  // ─── DELIVERY ORDER ────────────────────────────────────────
  await prisma.deliveryOrder.create({
    data: { order_code: 'DO-2025-001', vehicle_id: veh1.id, driver_id: drv1.id,
      origin: 'Kho Ba Vì', destination: 'Hà Nội – Q. Hoàng Mai',
      status: 'COMPLETED', scheduled_at: new Date('2025-05-10T08:00:00'),
      completed_at: new Date('2025-05-10T11:30:00') },
  })
  await prisma.deliveryOrder.create({
    data: { order_code: 'DO-2025-002', vehicle_id: veh2.id,
      driver_id: drv3.id, // khác default_driver của xe — demo override
      origin: 'Kho Ba Vì', destination: 'Bắc Ninh – KCN Tiên Sơn',
      status: 'IN_PROGRESS', scheduled_at: new Date() },
  })
  await prisma.deliveryOrder.create({
    data: { order_code: 'DO-2025-003', vehicle_id: veh3.id, driver_id: drv2.id,
      origin: 'Kho Bàu Bàng', destination: 'TP.HCM – Q. Bình Tân',
      status: 'PENDING', scheduled_at: new Date(Date.now() + 86400000) },
  })

  // ─── SHIFT ─────────────────────────────────────────────────
  const shift_sang = await prisma.shift.create({
    data: { name: 'Ca sáng', start_time: '06:00', end_time: '14:00',
      days_of_week: ['1','2','3','4','5','6'] },
  })
  const shift_chieu = await prisma.shift.create({
    data: { name: 'Ca chiều', start_time: '14:00', end_time: '22:00',
      days_of_week: ['1','2','3','4','5','6'] },
  })
  await prisma.shift.create({
    data: { name: 'Ca tối', start_time: '22:00', end_time: '06:00',
      days_of_week: ['1','2','3','4','5'] },
  })

  // ─── SCHEDULE (tuần hiện tại T2–T6) ───────────────────────
  const monday = new Date()
  monday.setHours(0, 0, 0, 0)
  const day = monday.getDay()
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1))

  for (let i = 0; i < 5; i++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const isPast = i < 2

    await prisma.schedule.create({
      data: { employee_id: emp_staff1.id, shift_id: shift_sang.id, date,
        status: isPast ? 'CONFIRMED' : 'SCHEDULED',
        check_in: isPast ? '06:03' : null, check_out: isPast ? '14:07' : null },
    })
    await prisma.schedule.create({
      data: { employee_id: emp_staff2.id, shift_id: shift_chieu.id, date,
        status: isPast ? 'CONFIRMED' : 'SCHEDULED',
        check_in: isPast ? '14:00' : null, check_out: isPast ? '22:12' : null },
    })
  }

  // ─── OVERTIME REQUEST ──────────────────────────────────────
  const yesterday = new Date(monday)
  yesterday.setDate(monday.getDate() - 1)

  await prisma.overtimeRequest.create({
    data: { employee_id: emp_staff1.id, date: yesterday, hours: 2,
      reason: 'Hàng về gấp, cần nhập kho thêm', status: 'APPROVED',
      approved_by: 'Trần Thị Lan', approved_at: new Date() },
  })
  await prisma.overtimeRequest.create({
    data: { employee_id: emp_staff2.id, date: monday, hours: 3,
      reason: 'Kiểm kê cuối tháng', status: 'PENDING' },
  })

  // ─── SETTING ───────────────────────────────────────────────
  await prisma.setting.createMany({
    data: [
      { key: 'app_name',           value: 'WMS Pro',              type: 'string', label: 'Tên ứng dụng' },
      { key: 'timezone',           value: 'Asia/Ho_Chi_Minh',     type: 'string', label: 'Múi giờ' },
      { key: 'language',           value: 'vi',                   type: 'string', label: 'Ngôn ngữ' },
      { key: 'max_stack_height',   value: '3',                    type: 'number', label: 'Số tầng chồng tối đa' },
      { key: 'low_stock_threshold',value: '10',                   type: 'number', label: 'Ngưỡng cảnh báo hàng thấp' },
    ],
  })

  console.log('✅ Seed hoàn tất!')
  console.log('   Warehouses      : 2  (BV, BB)')
  console.log('   SubWarehouses   : 4')
  console.log('   Locations       : 20')
  console.log('   Manufacturers   : 3  (A, B, 01)')
  console.log('   Materials       : 5')
  console.log('   Employees       : 6  (password: 123456)')
  console.log('   Drivers         : 3')
  console.log('   Vehicles        : 3')
  console.log('   InventoryEntries: 6  (incl. stack_layer=2 demo)')
  console.log('   Shifts          : 3')
  console.log('   DeliveryOrders  : 3')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
