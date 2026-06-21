import { Router } from 'express'
import * as skill from '../controllers/hr/skillController'
import * as leave from '../controllers/hr/leaveController'
import * as asg from '../controllers/hr/assignmentController'
import * as layout from '../controllers/hr/layoutController'
import * as att from '../controllers/hr/attendanceController'
import * as shiftRule from '../controllers/hr/shiftRuleController'
import { requirePerm, requireAnyPerm } from '../middlewares/auth'

const router = Router()

// ─── Skill (Vị trí phân công) ───────────────────────────────────────────────
router.get('/skills',        requirePerm('work_skill', 'view'),   skill.listSkills)
router.post('/skills',       requirePerm('work_skill', 'manage'), skill.createSkill)
router.put('/skills/:id',    requirePerm('work_skill', 'manage'), skill.updateSkill)
router.delete('/skills/:id', requirePerm('work_skill', 'manage'), skill.deleteSkill)

// ─── EmployeeSkill (NV pick skill từ chức danh) ─────────────────────────────
router.get('/employees/:id/skills',     requirePerm('work_skill', 'view'),   skill.getEmployeeSkills)
router.put('/employees/:id/skills',     requirePerm('work_skill', 'assign'), skill.setEmployeeSkills)

// ─── Nghỉ phép ──────────────────────────────────────────────────────────────
router.get('/leaves',            requirePerm('leave', 'view'),    leave.listLeaves)
router.post('/leaves',           requirePerm('leave', 'request'), leave.createLeave)
router.put('/leaves/:id',        requirePerm('leave', 'request'), leave.updateLeave)
router.patch('/leaves/:id/decide', requirePerm('leave', 'approve'), leave.decideLeave)
router.delete('/leaves/:id',     requirePerm('leave', 'delete'),  leave.deleteLeave)

// ─── Layout (mẫu gom skill theo Kho) ─────────────────────────────────────────
router.get('/layouts',               requirePerm('work_assignment', 'view'),   layout.listLayouts)
router.get('/layouts/:id',           requirePerm('work_assignment', 'view'),   layout.getLayout)
router.post('/layouts',              requirePerm('work_assignment', 'manage_layout'), layout.createLayout)
router.put('/layouts/:id',           requirePerm('work_assignment', 'manage_layout'), layout.updateLayout)
router.put('/layouts/:id/skills',    requirePerm('work_assignment', 'manage_layout'), layout.setLayoutSkills)
router.put('/layouts/:id/job-titles', requirePerm('work_assignment', 'manage_layout'), layout.setLayoutJobTitles)
router.delete('/layouts/:id',        requirePerm('work_assignment', 'manage_layout'), layout.deleteLayout)

// ─── Phân công lịch làm việc ─────────────────────────────────────────────────
router.get('/sheets',                 requirePerm('work_assignment', 'view'),    asg.listSheets)
router.get('/sheets/:id',             requirePerm('work_assignment', 'view'),    asg.getSheet)
router.post('/sheets',                requirePerm('work_assignment', 'create'),  asg.upsertSheet)
router.post('/sheets/:id/auto-assign',requirePerm('work_assignment', 'create'),  asg.autoAssign)
router.post('/sheets/:id/assign-one', requirePerm('work_assignment', 'edit'),    asg.assignOne)
router.post('/sheets/:id/assign-positions', requirePerm('work_assignment', 'edit'), asg.setPositions)
router.post('/sheets/:id/publish',    requirePerm('work_assignment', 'publish'), asg.publishSheet)
router.delete('/sheets/:id',          requirePerm('work_assignment', 'delete'),  asg.deleteSheet)

// ─── Quy tắc nghỉ giữa ca ────────────────────────────────────────────────────
router.get('/shift-rules',        requirePerm('work_assignment', 'view'),   shiftRule.listShiftRules)
router.post('/shift-rules',       requirePerm('work_assignment', 'manage_shift_rules'), shiftRule.createShiftRule)
router.delete('/shift-rules/:id', requirePerm('work_assignment', 'manage_shift_rules'), shiftRule.deleteShiftRule)

// ─── Chấm công ───────────────────────────────────────────────────────────────
router.get('/attendance/report', requirePerm('attendance', 'report'), att.reportAttendance)
router.get('/attendance',     requireAnyPerm(['attendance', 'view'], ['attendance', 'self_log']), att.listAttendance)
router.post('/attendance',    requireAnyPerm(['attendance', 'self_log'], ['attendance', 'edit']),  att.upsertAttendance)
router.delete('/attendance/:id', requireAnyPerm(['attendance', 'self_log'], ['attendance', 'edit']), att.deleteAttendance)

export default router
