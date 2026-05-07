# Infrastructure & Project Setup

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS v3 + shadcn/ui + React Router v6 + TanStack Query + html5-qrcode
- **Backend**: Node.js + Express + TypeScript + Prisma ORM + PostgreSQL (Supabase)
- **Auth**: JWT (15min access token in `Authorization: Bearer` header, 7-day refresh in HttpOnly cookie)

## Key Paths
```
backend/
  src/
    app.ts                           ← Express app, mounts all routers
    server.ts                        ← Entry point (port 4000)
    routes/
      masterdata.ts                  ← /api/masterdata/...
      wms.ts                         ← /api/wms/...
      auth.ts                        ← /api/auth/...
    controllers/
      masterdata/                    ← warehouseController, locationController, materialController, manufacturerController
      wms/
        inboundController.ts         ← Inbound feature (fully built)
    utils/
      qrParser.ts                    ← parseInboundQR()
  prisma/
    schema.prisma
    migrations/

frontend/
  src/
    api/
      client.ts                      ← Axios instance (VITE_API_URL)
      hooks.ts                       ← All TanStack Query hooks
    components/
      ui/                            ← shadcn/ui components
      layout/                        ← Shell, Sidebar, Header, BottomNav
      shared/                        ← QRScanner, PageHeader, TableSkeleton, EmptyState
    pages/
      wms/                           ← Inbound, InboundDetail, Inventory, Locations, Outbound
      tms/                           ← Vehicles, Deliveries
      hr/                            ← Employees, Schedule
      Dashboard.tsx, Login.tsx, Settings.tsx
    stores/authStore.ts              ← Zustand (isAuthenticated, user)
    types/index.ts                   ← All TypeScript interfaces
    utils/
      formatters.ts                  ← Status labels, date formatters
      mockData.ts                    ← Mock data for unbuilt modules
    App.tsx                          ← Routes definition
```

## Dev Commands
```bash
cd backend && npm run dev    # port 4000
cd frontend && npm run dev   # port 5173

# After schema change (REQUIRED):
cd backend && npx prisma migrate dev --name <description>
```

## Deployment
- **Frontend + Backend**: Vercel (auto-deploy on push to `main`)
- **DB**: Supabase PostgreSQL
- **GitHub**: `https://github.com/vietnamese2212/wms-webapp.git` branch `main`
- **Rule**: Push after EVERY code change

## API Response Format
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "...", "message": "..." } }
```

## Locale Rules
- UI labels & error messages: Tiếng Việt
- Code identifiers & comments: English
- Dates: UTC stored in DB → format `Asia/Ho_Chi_Minh` on frontend (date-fns `vi`)
