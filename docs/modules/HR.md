# Module HR – Human Resources

## Status: ❌ NOT BUILT (mock data only)

## Frontend Files
```
frontend/src/pages/hr/Employees.tsx  ← mock useEmployees()
frontend/src/pages/hr/Schedule.tsx   ← mock useSchedules()
```

## Mock Hooks (need replacing)
- `useEmployees()` → `mockEmployees`
- `useSchedules()` → `mockSchedules`
- `useOvertimeRequests()` → `mockOvertimeRequests`

## DB Models (already in schema — no migration needed)
```prisma
Employee      { warehouse_id, employee_code, name, role, department,
                email, password (bcrypt), is_active }
              roles: ADMIN | WAREHOUSE_MANAGER | WAREHOUSE_STAFF | DRIVER | HR_MANAGER

Shift         { name, start_time "HH:MM", end_time "HH:MM", days_of_week String[] }

Schedule      { employee_id, shift_id, date @db.Date,
                status: SCHEDULED|CONFIRMED|ABSENT|LATE,
                check_in String?, check_out String?  ← actual time as "HH:MM"
                @@unique([employee_id, date]) }

OvertimeRequest { employee_id, date, hours Float, reason,
                  status: PENDING|APPROVED|REJECTED,
                  approved_by, approved_at }

Attendance    { employee_id, date, check_in DateTime?, check_out DateTime?
                @@unique([employee_id, date]) }
```

## Employee ↔ WMS Connection
- `Employee.warehouse_id` → which warehouse they belong to
- `Employee.department` → e.g., "Kho", "Vận chuyển", "HR"
- Employee.id is used as `created_by`, `updated_by` in WMS (InventoryEntry, ProductionImport)

## Auth Connection
- Login: `POST /api/auth/login` with `Employee.email` + password
- JWT payload: `{ employee_id, role, warehouse_id }`
- `authStore.ts` (Zustand): stores `isAuthenticated`, `user`

## API to Build
```
GET/POST        /api/hr/employees
GET/PUT         /api/hr/employees/:id

GET/POST        /api/hr/shifts
GET/PUT         /api/hr/shifts/:id

GET/POST        /api/hr/schedules          ?employee_id, date_from, date_to
PUT             /api/hr/schedules/:id

GET/POST        /api/hr/overtime
PATCH           /api/hr/overtime/:id       body: { status: APPROVED | REJECTED }

GET/POST        /api/hr/attendance
```

## TODO
- [ ] `backend/src/routes/hr.ts` + register in `app.ts`
- [ ] Employee CRUD (with bcrypt password, warehouse assignment)
- [ ] Shift management (create/edit shifts)
- [ ] Schedule assignment (weekly calendar UI)
- [ ] Overtime request + approval flow
- [ ] Attendance tracking (check-in/out)
