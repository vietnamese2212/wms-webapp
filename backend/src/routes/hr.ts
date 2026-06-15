import { Router } from 'express'
import * as skill from '../controllers/hr/skillController'
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

export default router
