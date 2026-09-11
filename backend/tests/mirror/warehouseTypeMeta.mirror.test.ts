// MIRROR cờ Loại kho khi CHƯA có meta (phòng hộ legacy): BE `LEGACY_*` ⇄ FE `cargoCategory` fallback.
// Lệch = form Mã hàng (FE) không đòi HSD nhưng BE 422 "thiếu HSD" (hoặc ngược lại) cho cùng một loại.
import { describe, it, expect } from 'vitest'
import * as FE from '../../../frontend/src/utils/cargoCategory'

// warehouseTypeMeta import client supabase (throw nếu thiếu env) → nạp động sau khi đặt env giả; không gọi mạng.
async function loadBE() {
  process.env.SUPABASE_URL ??= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
  return import('../../src/utils/warehouseTypeMeta')
}

describe('warehouseTypeMeta BE ⇄ FE (fallback khi chưa seed meta)', () => {
  it('bắt buộc HSD / Pallet-EA theo loại khớp giữa hai bên', async () => {
    const BE = await loadBE()
    const CATS = ['Thành phẩm', 'POSM', 'Raw', 'Thùng', 'Giấy', 'NVL', 'Bao bì', 'FG01', 'PM01', 'Lạ']
    for (const c of CATS) {
      expect(FE.needsShelfLife(c), c).toBe(!BE.LEGACY_NO_SHELF_LIFE.includes(c))
      expect(FE.needsPalletPerEa(c), c).toBe(BE.LEGACY_PALLET_PER_EA.includes(c))
    }
    // Có meta tường minh thì meta thắng fallback ở FE (BE cùng luật trong getMaterialCategoryRules)
    const meta = new Map([['Thùng', { requires_shelf_life: true, requires_pallet_per_ea: false }]])
    expect(FE.needsShelfLife('Thùng', meta)).toBe(true)
    expect(FE.needsPalletPerEa('Thùng', meta)).toBe(false)
  })
})
