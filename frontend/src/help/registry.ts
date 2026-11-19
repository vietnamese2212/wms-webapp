// Danh sách bài hướng dẫn của module Hỗ trợ. THÊM BÀI: viết file trong ./guides (theo kiểu Guide ở ./types) rồi thêm vào GUIDES.
// Bài gắn `module` chỉ hiện cho người có quyền xem module đó (superadmin thấy hết) — cùng luật menu.
import { canAccess, type ModulePermissions } from '@/config/permissions'
import type { Guide, GuideStep } from './types'
import { MES_GUIDE } from './guides/mes'

export const GUIDES: Guide[] = [MES_GUIDE]

export function visibleGuides(perms: ModulePermissions | null, admin: boolean): Guide[] {
  return GUIDES.filter(g => !g.module || admin || canAccess(perms, g.module))
}
export const guideById = (id: string | undefined) => GUIDES.find(g => g.id === id)
export const stepCount = (g: Guide) => g.sections.reduce((n, s) => n + s.steps.length, 0)

/** Bỏ dấu + chữ thường — tìm "nap bon" vẫn ra "Nạp BTP vào bồn" */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')

export interface StepHit { guide: Guide; sectionId: string; sectionTitle: string; step: GuideStep; index: number }
/** Bước có tiêu đề / nội dung chứa mọi từ trong câu tìm (tối đa `limit` kết quả) */
export function searchSteps(guides: Guide[], q: string, limit = 30): StepHit[] {
  const words = fold(q).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: StepHit[] = []
  for (const g of guides) for (const s of g.sections) s.steps.forEach((step, index) => {
    if (out.length >= limit) return
    const hay = fold([step.title, ...step.text, step.note ?? '', s.title].join(' '))
    if (words.every(w => hay.includes(w))) out.push({ guide: g, sectionId: s.id, sectionTitle: s.title, step, index })
  })
  return out
}
/** neo của một bước trên trang bài: <mục>-<số thứ tự bước> */
export const stepAnchor = (sectionId: string, index: number) => `${sectionId}-${index + 1}`
