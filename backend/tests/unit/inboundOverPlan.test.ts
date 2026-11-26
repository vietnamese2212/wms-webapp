// 26/11 — Nhập vượt số kế hoạch (user chốt: công tắc 2 tầng Kho + Loại kho; kho chế biến cho vượt, chỉ báo Thừa).
// Mảnh thuần mà mọi cửa nhập dựa vào (qua services/inboundOverPlan.ts): resolveInboundOverPlan ghép tầng Kho + Loại kho.
//   null = như cũ (máy chủ không chặn) · ALLOW = cho vượt · BLOCK = chặn; tầng Loại null = theo kho, khai thì đè kho.
// Validator dùng chung 2 tầng: applyPutawayBody nhận ALLOW / BLOCK / null / '' (= null), từ chối giá trị lạ.
import { describe, it, expect } from 'vitest'
import { resolveInboundOverPlan, applyPutawayBody, WH_TYPE_CFG_COLS } from '../../src/utils/putaway'

describe('resolveInboundOverPlan — ghép tầng Kho + Loại kho', () => {
  it('cột có trong WH_TYPE_CFG_COLS (select / ghi / ghép tầng loại tự theo)', () => {
    expect((WH_TYPE_CFG_COLS as readonly string[]).includes('inbound_over_plan')).toBe(true)
  })
  it('kho chưa đặt, loại không khai ⇒ null (như cũ)', () => {
    expect(resolveInboundOverPlan({ inbound_over_plan: null }, [], 'RM01')).toEqual({ mode: null, source: 'WAREHOUSE' })
    expect(resolveInboundOverPlan(null, null, 'RM01').mode).toBeNull()
  })
  it('kho ALLOW, loại không khai ⇒ ALLOW (nguồn: kho)', () => {
    expect(resolveInboundOverPlan({ inbound_over_plan: 'ALLOW' }, [{ type_code: 'RM01', inbound_over_plan: null }], 'RM01'))
      .toEqual({ mode: 'ALLOW', source: 'WAREHOUSE' })
  })
  it('kho ALLOW, loại RM01 khai BLOCK ⇒ RM01 chặn (nguồn: loại); loại khác vẫn theo kho', () => {
    const rows = [{ type_code: 'RM01', inbound_over_plan: 'BLOCK' }]
    expect(resolveInboundOverPlan({ inbound_over_plan: 'ALLOW' }, rows, 'RM01')).toEqual({ mode: 'BLOCK', source: 'TYPE' })
    expect(resolveInboundOverPlan({ inbound_over_plan: 'ALLOW' }, rows, 'PK01')).toEqual({ mode: 'ALLOW', source: 'WAREHOUSE' })
  })
  it('giá trị lạ trong DB ⇒ coi như chưa đặt (không đoán chặn / cho)', () => {
    expect(resolveInboundOverPlan({ inbound_over_plan: 'MAYBE' }, [], 'RM01').mode).toBeNull()
  })
})

describe('applyPutawayBody — inbound_over_plan', () => {
  it('nhận ALLOW / BLOCK / null; chuỗi rỗng ⇒ null', () => {
    for (const v of ['ALLOW', 'BLOCK', null] as const) {
      const t: Record<string, unknown> = {}
      expect(applyPutawayBody({ inbound_over_plan: v }, t)).toBeNull()
      expect(t.inbound_over_plan).toBe(v)
    }
    const t: Record<string, unknown> = {}
    expect(applyPutawayBody({ inbound_over_plan: '' }, t)).toBeNull()
    expect(t.inbound_over_plan).toBeNull()
  })
  it('giá trị lạ ⇒ báo lỗi, không ghi', () => {
    const t: Record<string, unknown> = {}
    expect(applyPutawayBody({ inbound_over_plan: 'WARN' }, t)).toMatch(/không hợp lệ/)
    expect('inbound_over_plan' in t).toBe(false)
  })
})
