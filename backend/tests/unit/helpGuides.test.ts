// Module Hỗ trợ (19/11): bài hướng dẫn là dữ liệu thuần — test này gác ảnh hỏng (đổi tên / quên chép ảnh), neo trùng,
// kích thước giữ chỗ sai (ảnh tải sau đẩy nội dung ⇒ cuộn tới bước dừng lệch). Thêm bài mới ⇒ thêm vào GUIDES dưới đây.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { MES_GUIDE } from '../../../frontend/src/help/guides/mes'

const PUBLIC = path.resolve(__dirname, '../../../frontend/public')
const GUIDES = [MES_GUIDE]

/** kích thước điểm ảnh của file JPG (đọc khung SOF) */
function jpgSize(file: string): [number, number] | null {
  const b = fs.readFileSync(file)
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1], len = b.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
    i += 2 + len
  }
  return null
}

describe.each(GUIDES.map(g => [g.id, g] as const))('bài hướng dẫn %s', (_id, g) => {
  it('mã bài và neo các mục: chữ thường-gạch nối, không trùng', () => {
    expect(g.id).toMatch(/^[a-z0-9-]+$/)
    const ids = g.sections.map(s => s.id)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('mỗi bước có tiêu đề + nội dung', () => {
    for (const s of g.sections) for (const st of s.steps) {
      expect(st.title.trim().length).toBeGreaterThan(0)
      expect(st.text.length).toBeGreaterThan(0)
    }
  })
  const imgs = g.sections.flatMap(s => s.steps.flatMap(st => st.images ?? []))
  it('mọi ảnh có file thật trong public/ và có chú thích', () => {
    const missing = imgs.filter(i => !fs.existsSync(path.join(PUBLIC, i.src)))
    expect(missing.map(i => i.src)).toEqual([])
    for (const i of imgs) expect(i.alt.trim().length).toBeGreaterThan(0)
  })
  it('kích thước giữ chỗ khớp ảnh thật (khổ chuẩn 1280×800 / điện thoại 780×1688, khác thì khai w / h)', () => {
    const wrong = imgs.filter(i => {
      const sz = jpgSize(path.join(PUBLIC, i.src))
      const want: [number, number] = [i.w ?? (i.phone ? 780 : 1280), i.h ?? (i.phone ? 1688 : 800)]
      return !sz || sz[0] !== want[0] || sz[1] !== want[1]
    }).map(i => `${i.src} ${jpgSize(path.join(PUBLIC, i.src))?.join('x')}`)
    expect(wrong).toEqual([])
  })
})
