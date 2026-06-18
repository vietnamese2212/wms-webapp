import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { layoutSkillsDetailed, layoutJobTitleIds } from './layoutController'
import { loadShiftRuleMap } from './shiftRuleController'

type ReqUser = { sub?: string; name?: string }
const userOf = (req: Request): ReqUser => (req as { user?: ReqUser }).user ?? {}
const now = () => new Date().toISOString()

const SHEET_SELECT = 'id, work_date, warehouse_id, layout_id, status, note, published_at, created_at, updated_at, created_by, updated_by'

// Vị trí (skill) của phiếu = skill trong layout. Trả {id: skill_id, name, shift_tag, sort_order, job_title}
async function sheetSkills(layout_id: string | null) {
  if (!layout_id) return [] as { id: string; name: string; shift_tag: string | null; sort_order: number; job_title: string | null }[]
  const rows = await layoutSkillsDetailed(layout_id)
  return rows.map(r => ({ id: r.skill_id, name: r.name, shift_tag: r.shift_tag, sort_order: r.sort_order, job_title: r.job_title }))
}

// ─── List phiếu phân công ───────────────────────────────────────────────────
export async function listSheets(req: Request, res: Response) {
  try {
    const { warehouse_id, layout_id, date_from, date_to, status } = req.query as Record<string, string>
    let q = supabase.from('WorkAssignmentSheet').select(SHEET_SELECT).order('work_date', { ascending: false })
    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
    if (layout_id)    q = q.eq('layout_id', layout_id)
    if (status)       q = q.eq('status', status)
    if (date_from)    q = q.gte('work_date', date_from)
    if (date_to)      q = q.lte('work_date', date_to)
    const { data, error } = await q
    if (error) return fail(res, error.message)

    const sheets = (data ?? []) as { id: string; layout_id: string | null; warehouse_id: string }[]
    if (!sheets.length) return ok(res, [])
    const ids = sheets.map(s => s.id)
    // tên layout
    const lIds = [...new Set(sheets.map(s => s.layout_id).filter(Boolean))] as string[]
    const { data: layouts } = lIds.length ? await supabase.from('WorkLayout').select('id, name').in('id', lIds) : { data: [] }
    const lMap = new Map((layouts ?? []).map((l: { id: string; name: string }) => [l.id, l.name]))
    // tên kho
    const wIds = [...new Set(sheets.map(s => s.warehouse_id).filter(Boolean))]
    const { data: whs } = wIds.length ? await supabase.from('Warehouse').select('id, name').in('id', wIds) : { data: [] }
    const wMap = new Map((whs ?? []).map((w: { id: string; name: string }) => [w.id, w.name]))

    // đếm demand + assignment cho từng sheet
    const [{ data: demands }, { data: asgs }] = await Promise.all([
      supabase.from('WorkAssignmentDemand').select('sheet_id, required_count').in('sheet_id', ids),
      supabase.from('WorkAssignment').select('sheet_id, status').in('sheet_id', ids),
    ])
    const demandBy = new Map<string, number>()
    for (const d of (demands ?? []) as { sheet_id: string; required_count: number }[])
      demandBy.set(d.sheet_id, (demandBy.get(d.sheet_id) ?? 0) + d.required_count)
    const asgBy = new Map<string, number>()
    const leaveBy = new Map<string, number>()
    for (const a of (asgs ?? []) as { sheet_id: string; status: string }[]) {
      if (a.status === 'ASSIGNED') asgBy.set(a.sheet_id, (asgBy.get(a.sheet_id) ?? 0) + 1)
      else if (a.status === 'LEAVE') leaveBy.set(a.sheet_id, (leaveBy.get(a.sheet_id) ?? 0) + 1)
    }

    return ok(res, sheets.map(s => ({
      ...s,
      layout_name: s.layout_id ? lMap.get(s.layout_id) ?? null : null,
      warehouse_name: wMap.get(s.warehouse_id) ?? null,
      total_required: demandBy.get(s.id) ?? 0,
      total_assigned: asgBy.get(s.id) ?? 0,
      total_on_leave: leaveBy.get(s.id) ?? 0,
    })))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Chi tiết phiếu ─────────────────────────────────────────────────────────
export async function getSheet(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: sheet, error } = await supabase.from('WorkAssignmentSheet').select(SHEET_SELECT).eq('id', id).maybeSingle()
    if (error) return fail(res, error.message)
    if (!sheet) return fail(res, 'Không tìm thấy phiếu', 404)

    const [{ data: demands }, { data: asgs }, skills] = await Promise.all([
      supabase.from('WorkAssignmentDemand').select('id, skill_id, required_count, note').eq('sheet_id', id),
      supabase.from('WorkAssignment').select('id, employee_id, skill_id, status, is_manual, note').eq('sheet_id', id),
      sheetSkills((sheet as { layout_id: string | null }).layout_id),
    ])

    // gắn thông tin NV
    const empIds = [...new Set(((asgs ?? []) as { employee_id: string }[]).map(a => a.employee_id))]
    const { data: emps } = empIds.length
      ? await supabase.from('Employee').select('id, name, employee_code, job_title_id').in('id', empIds)
      : { data: [] as { id: string; name: string; employee_code: string; job_title_id: string | null }[] }
    const jtIds = [...new Set((emps ?? []).map((e: { job_title_id: string | null }) => e.job_title_id).filter(Boolean))] as string[]
    const { data: jts } = jtIds.length ? await supabase.from('JobTitle').select('id, name').in('id', jtIds) : { data: [] }
    const jtMap  = new Map((jts ?? []).map((j: { id: string; name: string }) => [j.id, j.name]))
    const empMap = new Map((emps ?? []).map((e: { id: string; name: string; employee_code: string; job_title_id: string | null }) =>
      [e.id, { id: e.id, name: e.name, employee_code: e.employee_code, job_title: e.job_title_id ? jtMap.get(e.job_title_id) ?? null : null }]))

    const layoutId = (sheet as { layout_id: string | null }).layout_id
    const { data: layout } = layoutId ? await supabase.from('WorkLayout').select('name').eq('id', layoutId).maybeSingle() : { data: null }

    return ok(res, {
      ...sheet,
      layout_name: (layout as { name: string } | null)?.name ?? null,
      skills: skills ?? [],
      demands: demands ?? [],
      assignments: ((asgs ?? []) as { employee_id: string }[]).map(a => ({ ...a, employee: empMap.get(a.employee_id) ?? null })),
    })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Tạo / cập nhật phiếu (upsert theo ngày + layout) + demands ─────────────
export async function upsertSheet(req: Request, res: Response) {
  try {
    const u = userOf(req)
    const { layout_id, work_date, note, demands, create_only } = req.body as {
      layout_id?: string; work_date?: string; note?: string; create_only?: boolean
      demands?: { skill_id: string; required_count: number; note?: string }[]
    }
    if (!layout_id || !work_date) return fail(res, 'layout_id, work_date là bắt buộc', 400)

    // kho lấy từ layout
    const { data: layout } = await supabase.from('WorkLayout').select('id, warehouse_id').eq('id', layout_id).maybeSingle()
    if (!layout) return fail(res, 'Không tìm thấy layout', 404)
    const warehouse_id = (layout as { warehouse_id: string }).warehouse_id

    // tìm phiếu sẵn có (ngày + layout) — mỗi layout chỉ 1 phiếu/ngày
    const { data: existing } = await supabase.from('WorkAssignmentSheet').select('id, status')
      .eq('work_date', work_date).eq('layout_id', layout_id).maybeSingle()
    // tạo mới: nếu đã có phiếu cho (ngày+layout) → chặn, không tạo trùng
    if (create_only && existing) return fail(res, 'Ngày này đã có phiếu cho layout đã chọn — không thể tạo trùng.', 409)

    let sheetId: string
    const isNew = !existing
    if (existing) {
      sheetId = (existing as { id: string }).id
      await supabase.from('WorkAssignmentSheet').update({ note: note ?? null, updated_at: now(), updated_by: u.name || null }).eq('id', sheetId)
    } else {
      sheetId = randomUUID()
      const { error } = await supabase.from('WorkAssignmentSheet').insert({
        id: sheetId, work_date, warehouse_id, layout_id, status: 'DRAFT', note: note ?? null,
        created_at: now(), updated_at: now(), created_by: u.name || null, updated_by: u.name || null,
      })
      if (error) return fail(res, error.message)
    }

    // demands: dùng demands truyền lên; nếu tạo mới mà không truyền → đổ từ layout
    let demandRows: { skill_id: string; required_count: number; note?: string }[] | undefined = demands
    if (demandRows === undefined && isNew) {
      const ls = await layoutSkillsDetailed(layout_id)
      demandRows = ls.map(r => ({ skill_id: r.skill_id, required_count: r.required_count, note: r.note ?? undefined }))
    }
    if (demandRows !== undefined) {
      await supabase.from('WorkAssignmentDemand').delete().eq('sheet_id', sheetId)
      const valid = demandRows.filter(d => d.skill_id && d.required_count > 0)
      if (valid.length) {
        await supabase.from('WorkAssignmentDemand').insert(valid.map(d => ({
          id: randomUUID(), sheet_id: sheetId, skill_id: d.skill_id, required_count: d.required_count,
          note: d.note || null, created_at: now(), updated_at: now(),
        })))
      }
    }
    return ok(res, { id: sheetId }, isNew ? 201 : 200)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Tự xếp người (greedy) ──────────────────────────────────────────────────
export async function autoAssign(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: sheet } = await supabase.from('WorkAssignmentSheet').select(SHEET_SELECT).eq('id', id).maybeSingle()
    if (!sheet) return fail(res, 'Không tìm thấy phiếu', 404)
    const { warehouse_id, layout_id, work_date } = sheet as { warehouse_id: string; layout_id: string | null; work_date: string }
    if (!layout_id) return fail(res, 'Phiếu chưa gắn layout', 400)
    if ((sheet as { status: string }).status === 'PUBLISHED') return fail(res, 'Phiếu đã phát hành — Hoàn tác trước khi xếp lại', 409)

    // Gộp lưu yêu cầu vào luôn (1 round-trip): nếu body có demands → cập nhật trước khi xếp
    const bodyDemands = (req.body as { demands?: { skill_id: string; required_count: number; note?: string }[] })?.demands
    if (Array.isArray(bodyDemands)) {
      await supabase.from('WorkAssignmentDemand').delete().eq('sheet_id', id)
      const valid = bodyDemands.filter(d => d.skill_id && d.required_count > 0)
      if (valid.length) await supabase.from('WorkAssignmentDemand').insert(valid.map(d => ({
        id: randomUUID(), sheet_id: id, skill_id: d.skill_id, required_count: d.required_count, note: d.note || null, created_at: now(), updated_at: now(),
      })))
    }

    const { data: demands } = await supabase.from('WorkAssignmentDemand').select('skill_id, required_count').eq('sheet_id', id)
    const demandList = (demands ?? []) as { skill_id: string; required_count: number }[]
    if (!demandList.length) return fail(res, 'Phiếu chưa có yêu cầu vị trí nào', 400)

    // ── 1. Skill thuộc layout (phạm vi vị trí) ──
    const layoutSkills = await layoutSkillsDetailed(layout_id)
    const scopeSkillIds = new Set(layoutSkills.map(s => s.skill_id))

    // ── 2. Ứng viên: NV có quyền truy cập kho + có ≥1 skill trong layout + đang hoạt động ──
    const { data: waRows } = await supabase.from('UserWarehouseAccess').select('employee_id').eq('warehouse_id', warehouse_id)
    const accessSet = new Set((waRows ?? []).map((r: { employee_id: string }) => r.employee_id))
    const { data: esRows } = scopeSkillIds.size
      ? await supabase.from('EmployeeSkill').select('employee_id, skill_id, priority').in('skill_id', [...scopeSkillIds])
      : { data: [] as { employee_id: string; skill_id: string; priority: number }[] }
    const empWithSkill = [...new Set(((esRows ?? []) as { employee_id: string }[]).map(r => r.employee_id))].filter(eid => accessSet.has(eid))
    const { data: emps } = empWithSkill.length
      ? await supabase.from('Employee').select('id, job_title_id').in('id', empWithSkill).eq('is_active', true).is('deleted_at', null)
      : { data: [] as { id: string; job_title_id: string | null }[] }
    // pool theo chức danh trong layout (nếu layout có khai báo chức danh) — "gọi đúng người"
    const ljtSet = new Set(await layoutJobTitleIds(layout_id))
    const candidateIds = ((emps ?? []) as { id: string; job_title_id: string | null }[])
      .filter(e => ljtSet.size === 0 || (e.job_title_id != null && ljtSet.has(e.job_title_id)))
      .map(e => e.id)
    const candidateSet = new Set(candidateIds)

    // ── 3. Nghỉ phép đã duyệt phủ work_date ──
    const { data: leaves } = await supabase.from('LeaveRequest').select('employee_id')
      .eq('status', 'APPROVED').lte('date_from', work_date).gte('date_to', work_date).in('employee_id', candidateIds.length ? candidateIds : ['__none__'])
    const onLeave = new Set((leaves ?? []).map((l: { employee_id: string }) => l.employee_id))
    const available = candidateIds.filter((eid: string) => !onLeave.has(eid))

    // empSkills: empId -> Map(skillId -> priority) (chỉ NV ứng viên + skill trong layout)
    const empSkills = new Map<string, Map<string, number>>()
    for (const r of (esRows ?? []) as { employee_id: string; skill_id: string; priority: number }[]) {
      if (!candidateSet.has(r.employee_id) || !scopeSkillIds.has(r.skill_id)) continue
      const m = empSkills.get(r.employee_id) ?? new Map<string, number>()
      m.set(r.skill_id, r.priority)
      empSkills.set(r.employee_id, m)
    }

    // ── 4. Giữ các dòng xếp tay (is_manual) → khóa NV + giảm demand ──
    const { data: prevAsg } = await supabase.from('WorkAssignment').select('employee_id, skill_id, status, is_manual').eq('sheet_id', id)
    const manualRows = ((prevAsg ?? []) as { employee_id: string; skill_id: string | null; status: string; is_manual: boolean }[])
      .filter(a => a.is_manual && a.status === 'ASSIGNED' && a.skill_id)
    const lockedEmp = new Set(manualRows.map(a => a.employee_id))
    const remainingNeed = new Map<string, number>()
    for (const d of demandList) remainingNeed.set(d.skill_id, d.required_count)
    for (const a of manualRows) if (a.skill_id) remainingNeed.set(a.skill_id, (remainingNeed.get(a.skill_id) ?? 0) - 1)

    // ── 4b. Ràng buộc nghỉ giữa ca: ca ngày D-1 cấm 1 số ca ngày D (đọc từ ShiftRestRule) ──
    const shiftTagOf = new Map(layoutSkills.map(s => [s.skill_id, s.shift_tag]))
    const restRules = await loadShiftRuleMap()   // from_shift -> Set(to_shift bị cấm)
    const empPrevShifts = new Map<string, Set<string>>()
    if (restRules.size && candidateIds.length) {
      const prevDate = (() => { const d = new Date(`${work_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()
      const { data: pSheets } = await supabase.from('WorkAssignmentSheet').select('id').eq('warehouse_id', warehouse_id).eq('work_date', prevDate)
      const pSheetIds = (pSheets ?? []).map((s: { id: string }) => s.id)
      if (pSheetIds.length) {
        const { data: pAsg } = await supabase.from('WorkAssignment').select('employee_id, skill_id')
          .in('sheet_id', pSheetIds).eq('status', 'ASSIGNED').in('employee_id', candidateIds)
        const pSkillIds = [...new Set(((pAsg ?? []) as { skill_id: string | null }[]).map(a => a.skill_id).filter(Boolean))] as string[]
        const { data: pSkills } = pSkillIds.length ? await supabase.from('Skill').select('id, shift_tag').in('id', pSkillIds) : { data: [] }
        const pShiftOf = new Map(((pSkills ?? []) as { id: string; shift_tag: string | null }[]).map(s => [s.id, s.shift_tag]))
        for (const a of (pAsg ?? []) as { employee_id: string; skill_id: string | null }[]) {
          const tag = a.skill_id ? pShiftOf.get(a.skill_id) : null
          if (!tag) continue
          const set = empPrevShifts.get(a.employee_id) ?? new Set<string>()
          set.add(tag); empPrevShifts.set(a.employee_id, set)
        }
      }
    }
    const violatesRest = (eid: string, todayTag: string | null): boolean => {
      if (!todayTag) return false
      const prev = empPrevShifts.get(eid)
      if (!prev) return false
      for (const f of prev) if (restRules.get(f)?.has(todayTag)) return true
      return false
    }

    // ── 4c. Tải tháng theo ca (để cân bằng công bằng) ──
    // Đếm số lần mỗi ứng viên đã được xếp từng shift_tag trong THÁNG của work_date,
    // cùng kho, mọi phiếu (DRAFT+PUBLISHED), trừ chính phiếu này. Dùng làm tie-breaker.
    const monthLoad = new Map<string, Map<string, number>>() // empId -> (shift_tag -> count)
    if (candidateIds.length) {
      const [yy, mm] = work_date.split('-').map(Number)
      const pad = (n: number) => String(n).padStart(2, '0')
      const monthStart = `${yy}-${pad(mm)}-01`
      const nextMonthStart = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${pad(mm + 1)}-01`
      const { data: mSheets } = await supabase.from('WorkAssignmentSheet').select('id')
        .eq('warehouse_id', warehouse_id).gte('work_date', monthStart).lt('work_date', nextMonthStart).neq('id', id)
      const mSheetIds = (mSheets ?? []).map((s: { id: string }) => s.id)
      if (mSheetIds.length) {
        const { data: mAsg } = await supabase.from('WorkAssignment').select('employee_id, skill_id')
          .in('sheet_id', mSheetIds).eq('status', 'ASSIGNED').in('employee_id', candidateIds)
        const mSkillIds = [...new Set(((mAsg ?? []) as { skill_id: string | null }[]).map(a => a.skill_id).filter(Boolean))] as string[]
        const { data: mSkills } = mSkillIds.length ? await supabase.from('Skill').select('id, shift_tag').in('id', mSkillIds) : { data: [] }
        const mShiftOf = new Map(((mSkills ?? []) as { id: string; shift_tag: string | null }[]).map(s => [s.id, s.shift_tag]))
        for (const a of (mAsg ?? []) as { employee_id: string; skill_id: string | null }[]) {
          const tag = a.skill_id ? mShiftOf.get(a.skill_id) : null
          if (!tag) continue
          const m = monthLoad.get(a.employee_id) ?? new Map<string, number>()
          m.set(tag, (m.get(tag) ?? 0) + 1)
          monthLoad.set(a.employee_id, m)
        }
      }
    }
    const tagLoad = (eid: string, tag: string | null) => (tag ? (monthLoad.get(eid)?.get(tag) ?? 0) : 0)
    const caLoad = (eid: string) => tagLoad(eid, 'CA1') + tagLoad(eid, 'CA2') + tagLoad(eid, 'CA3')   // tổng ngày ĐI CA trong tháng
    const hcLoad = (eid: string) => tagLoad(eid, 'HC')

    // ── 5. Ghép TỐI ĐA theo TẦNG ƯU TIÊN PHỦ + CÂN BẰNG ──
    // Tầng phủ: lấp CA1+CA2 trước → CA3 → HC. Thiếu người thì hụt rơi vào HC/CA3, KHÔNG hụt CA1/CA2.
    // Cân bằng: mỗi tầng xét người theo tải ÍT nhất của tầng đó (CA3 theo số CA3 → luân phiên ca đêm);
    //           tầng ca thêm tie-break tổng-ngày-đi-ca để cân "đi ca vs HC". Vẫn theo rule skill (priority) + nghỉ ca.
    const skillOrder = new Map(layoutSkills.map(s => [s.skill_id, s.sort_order]))
    const people = available.filter(eid => !lockedEmp.has(eid))
    const slotsOfSkill = new Map<string, string[]>()
    for (const [sid, n] of remainingNeed) if (n > 0) slotsOfSkill.set(sid, Array.from({ length: n }, (_, k) => `${sid}#${k}`))
    const skillOfSlot = (slot: string) => slot.slice(0, slot.lastIndexOf('#'))
    const tagOfSlot = (slot: string) => shiftTagOf.get(skillOfSlot(slot)) ?? null
    // adjacency người → slot đủ điều kiện; trong 1 người: priority (sở trường) → cân bằng từng-ca → thứ tự vị trí
    const adj = new Map<string, string[]>()
    for (const eid of people) {
      const sk = empSkills.get(eid)
      if (!sk) continue
      const quals = [...sk.entries()]
        .filter(([sid]) => slotsOfSkill.has(sid) && !violatesRest(eid, shiftTagOf.get(sid) ?? null))
        .sort(([sa, pa], [sb, pb]) =>
          pa - pb
          || tagLoad(eid, shiftTagOf.get(sa) ?? null) - tagLoad(eid, shiftTagOf.get(sb) ?? null)
          || (skillOrder.get(sa) ?? 9999) - (skillOrder.get(sb) ?? 9999))
      const slots: string[] = []
      for (const [sid] of quals) slots.push(...(slotsOfSkill.get(sid) ?? []))
      if (slots.length) adj.set(eid, slots)
    }
    const slotMatch = new Map<string, string>()  // slot -> empId
    const empSlot = new Map<string, string>()     // empId -> slot
    const augment = (eid: string, seen: Set<string>, allow: Set<string>): boolean => {
      for (const slot of adj.get(eid) ?? []) {
        const tag = tagOfSlot(slot)
        if (!tag || !allow.has(tag) || seen.has(slot)) continue
        seen.add(slot)
        const occ = slotMatch.get(slot)
        if (occ === undefined || augment(occ, seen, allow)) { slotMatch.set(slot, eid); empSlot.set(eid, slot); return true }
      }
      return false
    }
    const TIERS: { tags: string[]; key: (e: string) => number; ca: boolean }[] = [
      { tags: ['CA1', 'CA2'], key: e => tagLoad(e, 'CA1') + tagLoad(e, 'CA2'), ca: true },
      { tags: ['CA3'],        key: e => tagLoad(e, 'CA3'),                     ca: true },
      { tags: ['HC'],         key: e => hcLoad(e),                            ca: false },
    ]
    const allow = new Set<string>()
    for (const tier of TIERS) {
      for (const tg of tier.tags) allow.add(tg)
      const order = [...people].sort((a, b) =>
        tier.key(a) - tier.key(b)
        || (tier.ca ? caLoad(a) - caLoad(b) : 0)            // tầng ca: cân thêm "đi ca vs HC"
        || (adj.get(a)?.length ?? 0) - (adj.get(b)?.length ?? 0)
        || (a < b ? -1 : 1))
      for (const eid of order) if (!empSlot.has(eid)) augment(eid, new Set(), allow)
    }
    // kết quả + cập nhật nhu cầu còn thiếu (cho shortfalls)
    const assignedEmp = new Set<string>(lockedEmp)
    const result = new Map<string, string>() // empId -> skillId
    const filledBySkill = new Map<string, number>()
    for (const [slot, eid] of slotMatch) {
      const sid = skillOfSlot(slot)
      result.set(eid, sid); assignedEmp.add(eid)
      filledBySkill.set(sid, (filledBySkill.get(sid) ?? 0) + 1)
    }
    for (const [sid, n] of remainingNeed) remainingNeed.set(sid, n - (filledBySkill.get(sid) ?? 0))

    // ── 6. Ghi DB: xóa các dòng auto cũ (giữ manual), tạo mới ──
    await supabase.from('WorkAssignment').delete().eq('sheet_id', id).eq('is_manual', false)
    const rows: Record<string, unknown>[] = []
    // auto assigned
    for (const [eid, skillId] of result.entries())
      rows.push({ id: randomUUID(), sheet_id: id, employee_id: eid, skill_id: skillId, status: 'ASSIGNED', is_manual: false, created_at: now(), updated_at: now() })
    // nghỉ phép
    for (const eid of candidateIds.filter((x: string) => onLeave.has(x)))
      rows.push({ id: randomUUID(), sheet_id: id, employee_id: eid, skill_id: null, status: 'LEAVE', is_manual: false, created_at: now(), updated_at: now() })
    // chưa phân (available nhưng không được xếp & không bị khóa)
    for (const eid of available)
      if (!assignedEmp.has(eid))
        rows.push({ id: randomUUID(), sheet_id: id, employee_id: eid, skill_id: null, status: 'UNASSIGNED', is_manual: false, created_at: now(), updated_at: now() })
    if (rows.length) await supabase.from('WorkAssignment').insert(rows)

    // shortfalls
    const shortfalls = demandList.map(d => ({
      skill_id: d.skill_id, required: d.required_count, short: Math.max(0, remainingNeed.get(d.skill_id) ?? 0),
    })).filter(s => s.short > 0)

    await supabase.from('WorkAssignmentSheet').update({ updated_at: now(), updated_by: userOf(req).name || null }).eq('id', id)
    return ok(res, { assigned: result.size + manualRows.length, on_leave: onLeave.size, shortfalls })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Sửa tay: gán 1 NV vào 1 vị trí (hoặc bỏ) ───────────────────────────────
export async function assignOne(req: Request, res: Response) {
  try {
    const { id } = req.params // sheet_id
    const { employee_id, skill_id } = req.body as { employee_id?: string; skill_id?: string | null }
    if (!employee_id) return fail(res, 'employee_id là bắt buộc', 400)

    const { data: sh } = await supabase.from('WorkAssignmentSheet').select('status').eq('id', id).maybeSingle()
    if ((sh as { status: string } | null)?.status === 'PUBLISHED') return fail(res, 'Phiếu đã phát hành — Hoàn tác trước khi sửa', 409)

    const { data: existing } = await supabase.from('WorkAssignment').select('id, status')
      .eq('sheet_id', id).eq('employee_id', employee_id).maybeSingle()
    const status = skill_id ? 'ASSIGNED' : 'UNASSIGNED'
    if (existing) {
      // không cho ghi đè dòng nghỉ phép tự động
      await supabase.from('WorkAssignment').update({ skill_id: skill_id || null, status, is_manual: true, updated_at: now() }).eq('id', (existing as { id: string }).id)
    } else {
      await supabase.from('WorkAssignment').insert({
        id: randomUUID(), sheet_id: id, employee_id, skill_id: skill_id || null, status, is_manual: true, created_at: now(), updated_at: now(),
      })
    }
    return ok(res, { employee_id, skill_id: skill_id || null })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Sửa tay: đặt DANH SÁCH vị trí cho 1 NV (1 người có thể làm nhiều vị trí) ──
export async function setPositions(req: Request, res: Response) {
  try {
    const { id } = req.params // sheet_id
    const { employee_id, skill_ids } = req.body as { employee_id?: string; skill_ids?: string[] }
    if (!employee_id) return fail(res, 'employee_id là bắt buộc', 400)

    const { data: sh } = await supabase.from('WorkAssignmentSheet').select('status').eq('id', id).maybeSingle()
    if ((sh as { status: string } | null)?.status === 'PUBLISHED') return fail(res, 'Phiếu đã phát hành — Hoàn tác trước khi sửa', 409)

    // thay toàn bộ phân công của NV này trong phiếu bằng danh sách vị trí mới (mỗi vị trí 1 dòng)
    await supabase.from('WorkAssignment').delete().eq('sheet_id', id).eq('employee_id', employee_id)
    const ids = [...new Set((skill_ids ?? []).filter(Boolean))]
    const ts = now()
    if (ids.length) {
      await supabase.from('WorkAssignment').insert(ids.map(sk => ({
        id: randomUUID(), sheet_id: id, employee_id, skill_id: sk, status: 'ASSIGNED', is_manual: true, created_at: ts, updated_at: ts,
      })))
    } else {
      await supabase.from('WorkAssignment').insert({
        id: randomUUID(), sheet_id: id, employee_id, skill_id: null, status: 'UNASSIGNED', is_manual: true, created_at: ts, updated_at: ts,
      })
    }
    await supabase.from('WorkAssignmentSheet').update({ updated_at: ts, updated_by: userOf(req).name || null }).eq('id', id)
    return ok(res, { employee_id, count: ids.length })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Phát hành ──────────────────────────────────────────────────────────────
export async function publishSheet(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { publish } = req.body as { publish?: boolean }
    const status = publish === false ? 'DRAFT' : 'PUBLISHED'
    const { error } = await supabase.from('WorkAssignmentSheet').update({
      status, published_at: status === 'PUBLISHED' ? now() : null, updated_at: now(), updated_by: userOf(req).name || null,
    }).eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { id, status })
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteSheet(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { error } = await supabase.from('WorkAssignmentSheet').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
