import { Router } from 'express'
import * as skill from '../controllers/hr/skillController'
import * as leave from '../controllers/hr/leaveController'
import * as asg from '../controllers/hr/assignmentController'
import { requirePerm } from '../middlewares/auth'

const router = Router()

// ─── Skill (Vị trí phân công) ───────────────────────────────────────────────
router.get('/skills',        requirePerm('work_skill', 'view'),   skill.listSkills)
router.post('/skills',       requirePerm('work_skill', 'manage'), skill.createSkill)
router.put('/skills/:id',    requirePerm('work_skill', 'manage'), skill.updateSkill)
router.delete('/skills/:id', requirePerm('work_skill', 'manage'), skill.deleteSkill)

// ─── EmployeeSkill (gán skill cho NV) ───────────────────────────────────────
router.get('/employee-skills',          requirePerm('work_skill', 'view'),   skill.employeeSkillMatrix)
router.put('/employees/:id/skills',     requirePerm('work_skill', 'assign'), skill.setEmployeeSkills)

// ─── Nghỉ phép ──────────────────────────────────────────────────────────────
router.get('/leaves',            requirePerm('leave', 'view'),    leave.listLeaves)
router.post('/leaves',           requirePerm('leave', 'request'), leave.createLeave)
router.put('/leaves/:id',        requirePerm('leave', 'request'), leave.updateLeave)
router.patch('/leaves/:id/decide', requirePerm('leave', 'approve'), leave.decideLeave)
router.delete('/leaves/:id',     requirePerm('leave', 'delete'),  leave.deleteLeave)

// ─── Phân công lịch làm việc ─────────────────────────────────────────────────
router.get('/sheets',                 requirePerm('work_assignment', 'view'),    asg.listSheets)
router.get('/sheets/:id',             requirePerm('work_assignment', 'view'),    asg.getSheet)
router.post('/sheets',                requirePerm('work_assignment', 'create'),  asg.upsertSheet)
router.post('/sheets/:id/auto-assign',requirePerm('work_assignment', 'create'),  asg.autoAssign)
router.post('/sheets/:id/assign-one', requirePerm('work_assignment', 'edit'),    asg.assignOne)
router.post('/sheets/:id/publish',    requirePerm('work_assignment', 'publish'), asg.publishSheet)
router.delete('/sheets/:id',          requirePerm('work_assignment', 'delete'),  asg.deleteSheet)

export default router
