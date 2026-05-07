# WMS Supply Chain Webapp

## Project Overview

Webapp quản lý vận hành Supply Chain toàn diện, bao gồm:
- **WMS** – Quản lý kho (QR code scanning, nhập/xuất/kiểm kho)
- **TMS** – Quản lý xe và giao nhận (đăng ký xe, lịch vận chuyển, theo dõi)
- **HR** – Quản lý nhân sự (lịch làm việc, tăng ca, ca kíp)

Chạy trên browser và mobile (iOS/Android) thông qua PWA. Không cần cài app.

---

## Tech Stack

### Frontend
- **React 18** + **TypeScript**
- **Vite** – build tool
- **Tailwind CSS v3** – styling (utility-first, responsive)
- **shadcn/ui** – component library (Radix UI primitives)
- **React Router v6** – routing (SPA)
- **TanStack Query (React Query)** – server state, caching
- **React Hook Form** + **Zod** – form validation
- **html5-qrcode** – QR code scanner (camera trên mobile/browser)
- **qrcode** – QR code generator
- **date-fns** – date/time utilities
- **Lucide React** – icons
- **PWA** via `vite-plugin-pwa` – offline support, installable trên mobile

### Backend
- **Node.js** + **Express** + **TypeScript**
- **Prisma ORM** – database access layer
- **PostgreSQL** – primary database
- **Redis** – session cache, realtime queue
- **JWT** – authentication (access + refresh tokens)
- **bcrypt** – password hashing
- **Multer** – file upload (ảnh, chứng từ)
- **node-qrcode** – server-side QR generation
- **socket.io** – realtime notifications

### DevOps / Infrastructure
- **Docker** + **Docker Compose** – local development và deployment
- **Nginx** – reverse proxy, serve static files
- **PostgreSQL** chạy trong Docker

---

## Project Structure

```
wms-webapp/
├── frontend/
│   ├── src/
│   │   ├── api/            # Axios instances, API call functions
│   │   ├── components/
│   │   │   ├── ui/         # shadcn/ui base components
│   │   │   ├── layout/     # Shell, Sidebar, Header, BottomNav
│   │   │   └── shared/     # QRScanner, DataTable, StatusBadge, etc.
│   │   ├── features/
│   │   │   ├── wms/        # Warehouse: inventory, locations, transactions
│   │   │   ├── tms/        # Transport: vehicles, orders, deliveries
│   │   │   └── hr/         # HR: employees, shifts, schedules, overtime
│   │   ├── hooks/          # Custom hooks
│   │   ├── pages/          # Route-level components
│   │   ├── stores/         # Zustand global state (auth, user, settings)
│   │   ├── types/          # TypeScript interfaces/types
│   │   └── utils/          # Helpers, formatters, constants
│   ├── public/
│   └── index.html
│
├── backend/
│   ├── src/
│   │   ├── routes/         # Express routers (wms, tms, hr, auth)
│   │   ├── controllers/    # Route handlers
│   │   ├── services/       # Business logic layer
│   │   ├── middlewares/    # Auth, error, validation, upload
│   │   ├── prisma/         # Schema, migrations, seed
│   │   └── utils/          # QR helpers, date utils, response helpers
│   └── server.ts
│
├── docker-compose.yml
└── CLAUDE.md
```

---

## Core Modules

### WMS – Warehouse Management
- Quản lý **vị trí kho** (zone, row, shelf, bin) theo cấu trúc cây
- **QR code** cho từng vị trí và từng sản phẩm/lô hàng, 1 vị trí sẽ có số lượng Pallet tối đa, khi để pallet tối đa sẽ không để thêm được nữa ( kho quản lý hàng theo Pallet, 1 pallet có nhiều thùng trên đó, mỗi pallet hàng sẽ được gắn 1 QR code định danh)
- **Nhập kho**: Tạo phiếu nhập kho, chọn vị trí, quét QR code Pallet để nhập - cảnh báo ngăn chặn nếu nhập sai vị trí, sai mã hàng hoặc quá số lượng Pallet cho phép
- **Xuất kho**: scan QR order, cảnh báo nếu xuất sai mã hàng so với đơn hàng, xuất sai các thông tin quy định về đơn hàng, xác nhận
- **Kiểm kho**: cycle count theo vị trí, so sánh hệ thống vs thực tế
- **Inventory dashboard**: tồn kho real-time, cảnh báo hàng sắp hết
- **Lịch sử giao dịch**: audit trail đầy đủ theo sản phẩm/vị trí/người dùng

### TMS – Transport Management
- **Đăng ký xe**: thông tin xe, tài xế, biển số, tải trọng, hạn đăng kiểm
- **Lệnh vận chuyển**: tạo order, gán xe + tài xế, timeline giao hàng
- **Giao nhận**: xác nhận giao (chữ ký / ảnh / QR), trạng thái real-time
- **Lịch xe**: calendar view theo ngày/tuần cho fleet
- **Báo cáo**: km đi, chi phí, hiệu suất theo xe/tài xế

### HR – Human Resource Scheduling
- **Danh sách nhân viên**: thông tin, role, phòng ban, kho phụ trách
- **Ca làm việc**: định nghĩa các ca (sáng/chiều/tối, khung giờ, ngày áp dụng)
- **Lịch làm việc**: xếp ca theo tuần/tháng, drag-and-drop assignment
- **Tăng ca**: đăng ký/phê duyệt tăng ca, ghi nhận giờ thực tế
- **Chấm công**: check-in/out (có thể dùng QR cá nhân), tổng hợp giờ làm
- **Báo cáo**: giờ làm theo người/ca/tháng, export Excel

---

## Design System

### Nguyên tắc thiết kế
- **Mobile-first**: layout tối ưu cho màn hình 375px trở lên
- **Touch-friendly**: nút tối thiểu 44×44px, spacing rộng rãi
- **Thông tin rõ ràng**: data table gọn, badge màu trạng thái, icon đi kèm text
- **Tối giản**: không thừa decoration, chỉ hiện thông tin cần thiết trong context

### Color Palette (Tailwind tokens)
```
Primary:   blue-600   (#2563EB)  – CTA, active states
Success:   green-500  (#22C55E)  – hoàn thành, OK
Warning:   amber-500  (#F59E0B)  – cảnh báo, chờ duyệt
Danger:    red-500    (#EF4444)  – lỗi, từ chối, hết hàng
Neutral:   slate-*               – text, borders, backgrounds
Surface:   white / slate-50      – card backgrounds
```

### Typography
- Font: **Inter** (system fallback: sans-serif)
- Heading: `text-xl font-semibold` (page title), `text-base font-medium` (section)
- Body: `text-sm text-slate-700`
- Caption/label: `text-xs text-slate-500`

### Layout Patterns
- **Desktop**: Sidebar cố định 240px + content area
- **Mobile**: Bottom navigation bar (4–5 tab chính) + Header với back button
- **Cards**: `rounded-xl shadow-sm border border-slate-200 p-4`
- **Tables**: sticky header, row hover, responsive (horizontal scroll trên mobile)

---

## API Conventions

### REST Endpoints
```
GET    /api/wms/inventory          – danh sách tồn kho
POST   /api/wms/transactions       – tạo giao dịch nhập/xuất
GET    /api/wms/locations/:id/qr   – lấy QR của vị trí

GET    /api/tms/vehicles           – danh sách xe
POST   /api/tms/orders             – tạo lệnh vận chuyển
PATCH  /api/tms/orders/:id/status  – cập nhật trạng thái

GET    /api/hr/schedules           – lịch làm việc
POST   /api/hr/overtime            – đăng ký tăng ca
PATCH  /api/hr/overtime/:id        – duyệt/từ chối tăng ca

POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
```

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "total": 100 }
}
```

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Không tìm thấy sản phẩm" }
}
```

### Auth
- JWT access token (15 phút) trong `Authorization: Bearer` header
- Refresh token (7 ngày) trong HttpOnly cookie
- Role-based access: `ADMIN`, `WAREHOUSE_MANAGER`, `WAREHOUSE_STAFF`, `DRIVER`, `HR_MANAGER`

---

## Data Models (Prisma – key entities)

```prisma
model Product { id, sku, name, unit, category, minStock, qrCode }
model Location { id, zone, row, shelf, bin, qrCode, capacity }
model InventoryItem { id, productId, locationId, quantity, updatedAt }
model Transaction { id, type, productId, locationId, quantity, userId, note, createdAt }

model Vehicle { id, plateNumber, type, capacity, driverId, status, nextInspectionDate }
model Driver { id, name, licenseNumber, phone, status }
model DeliveryOrder { id, vehicleId, driverId, origin, destination, status, scheduledAt, completedAt }

model Employee { id, name, employeeCode, role, department, phone, qrCode }
model Shift { id, name, startTime, endTime, daysOfWeek }
model Schedule { id, employeeId, shiftId, date, status }
model OvertimeRequest { id, employeeId, date, hours, reason, status, approvedBy }
model Attendance { id, employeeId, checkIn, checkOut, date }
```

---

## Development Commands

```bash
# Backend
cd backend
npm install
npx prisma migrate dev
npm run dev              # ts-node-dev, port 4000

# Frontend
cd frontend
npm install
npm run dev              # Vite, port 5173

# Docker (full stack)
docker-compose up -d     # PostgreSQL + Redis + backend + frontend + nginx
```

---

## Key Implementation Notes

1. **QR Scanning**: Dùng `html5-qrcode` với camera constraint `facingMode: environment` (camera sau) trên mobile. Fallback cho desktop là upload ảnh.
2. **Offline PWA**: Cache API responses với Workbox cho các màn hình read-only (inventory lookup, schedule view). Mutation operations yêu cầu có mạng.
3. **Realtime**: Socket.io emit events khi inventory thay đổi, delivery status update – frontend subscribe và invalidate React Query cache.
4. **Timezone**: Toàn bộ backend lưu UTC, frontend format theo `Asia/Ho_Chi_Minh`.
5. **Mobile performance**: Lazy load routes, virtual scrolling cho danh sách dài (react-virtual), image optimization.
6. **In-app language**: Tiếng Việt cho UI labels, error messages. Code comments và identifiers bằng tiếng Anh.

---

## Testing Strategy

- **Unit**: Vitest cho utility functions (QR parsing, date calc, business rules)
- **Integration**: Supertest cho API routes với test database
- **E2E**: Playwright (desktop Chrome + mobile viewport)
- **QR flows**: Test bằng physical device camera trước khi release

---

## Security Requirements

- Sanitize all user input (express-validator)
- Rate limiting trên auth endpoints
- CORS chỉ cho phép domain production và localhost dev
- File upload: validate MIME type, giới hạn 5MB, lưu ngoài webroot
- Không log sensitive data (token, password)
- HTTPS bắt buộc trên production (Nginx SSL termination)

---

## Modern Industry Reference – Warehouse, Logistics & Planning

Tham khảo các phương pháp và khái niệm từ các phần mềm tiên tiến (SAP S/4 HANA EWM, Oracle WMS Cloud, Manhattan Associates, Blue Yonder) để định hướng phát triển tính năng.

---

### WMS – Modern Warehouse Management

#### Storage & Slotting Optimization
- **Slotting**: Xếp hàng theo ABC analysis – hàng A (bán chạy) đặt gần cửa/lối chính, giảm quãng đường pick. SAP EWM gọi là *Warehouse Slotting*.
- **Fixed vs. Dynamic bin**: Bin cố định cho hàng chủ lực; bin động (chaotic storage) cho hàng nhập lẻ – hệ thống tự suggest vị trí tối ưu còn trống.
- **Bin capacity check**: Mỗi bin có `maxWeight`, `maxVolume`, `allowedProductTypes` – kiểm tra trước khi put-away.
- **Multi-level location**: Zone → Aisle → Row → Level → Bin (5 cấp). SAP dùng `Storage Type → Storage Section → Storage Bin`.

#### Inbound (Nhập kho) – Advanced Flow
- **Advance Shipping Notice (ASN)**: Nhà cung cấp gửi ASN trước khi hàng đến – hệ thống pre-allocate vị trí, tạo PUT-AWAY task tự động.
- **Goods Receipt (GR) posting**: Tạo Material Document, cập nhật stock real-time (unrestricted / quality inspection / blocked stock).
- **Cross-docking**: Hàng nhập → chuyển thẳng ra xe giao mà không lưu kho. Áp dụng khi có demand order khớp với shipment đến.
- **Put-away strategies**: FIFO (First In First Out), FEFO (First Expired First Out cho hàng có HSD), Nearest empty bin, Fixed bin.

#### Outbound (Xuất kho) – Advanced Flow
- **Wave planning**: Gom nhiều đơn hàng xuất trong một khung giờ thành 1 "wave", tối ưu lộ trình pick chung.
- **Pick strategies**: Single order pick, Batch pick (nhiều đơn/1 lần), Zone pick (mỗi người pick zone riêng), Cluster pick (cart nhiều tote).
- **Transfer Order (TO)**: SAP tạo TO cho mỗi pick task – ghi rõ `source bin`, `destination bin`, `quantity`, `picker`.
- **Packing & Staging**: Sau pick → pack vào thùng → staging area chờ xe → load confirmation khi lên xe.
- **Pick confirmation + exception**: Picker xác nhận số lượng thực tế; nếu thiếu hàng → tạo short-pick exception, hệ thống re-direct sang bin khác.

#### Inventory Management – Advanced
- **Lot/Batch tracking**: Mỗi lô hàng có `batchNumber`, `manufactureDate`, `expiryDate`, `supplier`. Truy xuất nguồn gốc (traceability) đầy đủ.
- **Serial number management**: Theo dõi từng đơn vị riêng lẻ (serial) – quan trọng với hàng điện tử, thiết bị.
- **Stock types**: Unrestricted, Quality Inspection, Blocked, Consignment (hàng ký gửi), In-transit.
- **Cycle count scheduling**: SAP dùng ABC indicator để lên lịch đếm hàng A hàng tuần, B hàng tháng, C hàng quý – không cần đếm toàn kho một lúc.
- **Stock aging report**: Cảnh báo hàng tồn quá X ngày theo từng bin/lô.

#### Labor Management (LMS)
- **Task interleaving**: Sau khi picker deposit hàng đã pick, hệ thống tự giao put-away task ngay trên đường về – tránh đi tay không.
- **Engineered labor standards**: Định mức thời gian chuẩn cho mỗi loại task (pick, pack, putaway) theo trọng lượng/khoảng cách → đo năng suất thực tế vs chuẩn.
- **Workload balancing**: Phân bổ task đều cho picker theo năng lực, zone phụ trách, equipment loại.

---

### TMS – Modern Transport Management

#### Order & Load Planning
- **Load building**: Gom nhiều delivery order thành 1 chuyến xe tối ưu (max weight, max volume, delivery window). Thuật toán bin-packing / VRP (Vehicle Routing Problem).
- **Route optimization**: Tối ưu thứ tự giao hàng theo địa lý (nearest neighbor, Dijkstra, Google OR-Tools). SAP TM dùng *Freight Order Optimizer*.
- **Delivery time window**: Mỗi điểm giao có khung giờ cho phép (`earliestDelivery`, `latestDelivery`) – lên lịch phải nằm trong window.
- **Freight cost calculation**: Chi phí vận chuyển tính theo km, trọng lượng, fuel surcharge, toll – ghi nhận vào Freight Order.

#### Fleet & Driver Management
- **Driver HOS (Hours of Service)**: Giới hạn giờ lái liên tục (EU: 4.5h, US: 11h) – hệ thống cảnh báo khi schedule vượt ngưỡng.
- **Vehicle maintenance schedule**: Bảo dưỡng định kỳ theo km hoặc ngày; block xe tự động khi đến hạn.
- **Real-time GPS tracking**: Cập nhật vị trí xe liên tục, ETA động theo traffic (tích hợp Google Maps / HERE Maps).
- **Proof of Delivery (POD)**: Xác nhận giao hàng bằng chữ ký điện tử, ảnh, barcode scan tại điểm giao – timestamp + GPS stamp.

#### Freight Settlement
- **Carrier rate management**: Bảng giá cước theo carrier, lane, weight break – tự động apply khi tạo shipment.
- **Freight invoice matching**: So khớp hóa đơn carrier với freight order – phát hiện sai lệch tự động.

---

### Planning & Forecasting (IBP / Supply Planning)

#### Demand Planning
- **Statistical forecasting**: Dùng time-series models (Moving Average, Exponential Smoothing, Holt-Winters) để dự báo nhu cầu. SAP IBP dùng ML models.
- **Forecast accuracy KPIs**: MAPE (Mean Absolute Percentage Error), Bias, Forecast vs Actual – đo và cải thiện liên tục.
- **Seasonality & trend**: Nhận diện chu kỳ mùa vụ (Tết, lễ hội) và trend tăng trưởng trong forecast.
- **Collaborative forecasting**: Sales team nhập manual override vào forecast của hệ thống (consensus planning).

#### Inventory Planning
- **Safety stock calculation**: `Safety Stock = Z × σ_demand × √(Lead Time)` – tính động theo service level target và lead time variability.
- **Reorder point (ROP)**: `ROP = Average demand × Lead Time + Safety Stock` – trigger purchase order tự động.
- **Min/Max replenishment**: Đơn giản hóa cho kho nhỏ: khi tồn < Min → order lên Max.
- **ABC-XYZ matrix**: ABC (giá trị) × XYZ (mức độ biến động nhu cầu) → 9 ô chiến lược tồn kho khác nhau.
- **MRP (Material Requirements Planning)**: Từ demand plan → tính ngược nguyên vật liệu cần mua/sản xuất theo BOM và lead time.

#### Supply Network Planning
- **Capable-to-Promise (CTP)**: Kiểm tra khả năng giao hàng thực tế (kho + production capacity + transport) trước khi confirm order.
- **Distribution Requirements Planning (DRP)**: Tính toán nhu cầu bổ sung hàng giữa các kho trong mạng phân phối.
- **Constraint-based planning**: Ưu tiên kế hoạch theo bottleneck thực tế (xe, nhân công, cửa dock).

---

### Process Concepts Áp Dụng Cho Project Này

| Concept | Áp dụng trong WMS webapp |
|---|---|
| ASN (Advance Shipping Notice) | Tạo phiếu nhập dự kiến trước khi hàng đến, pre-fill form scan |
| Transfer Order | Mỗi task nhập/xuất/chuyển kho là 1 TO với status workflow |
| FEFO pick strategy | Sort bin suggestions theo `expiryDate` tăng dần khi xuất hàng có HSD |
| Wave planning | Gom các lệnh xuất trong ca → tạo pick list chung cho warehouse staff |
| Cycle count scheduling | Lên lịch kiểm kho tự động theo ABC, không chờ kiểm toàn kho |
| Safety stock alert | Cảnh báo khi `quantity < minStock` (đã có), mở rộng thành tính toán ROP động |
| Batch/Lot tracking | Thêm `batchNumber`, `expiryDate` vào Transaction và InventoryItem |
| POD (Proof of Delivery) | Ảnh + chữ ký + timestamp GPS khi tài xế confirm giao hàng |
| Load building | Suggest gom đơn hàng cùng tuyến/khu vực vào 1 chuyến xe |
| Driver HOS | Cảnh báo khi tổng giờ lái trong ngày vượt ngưỡng an toàn |

---

### Key KPIs Để Track (Industry Standard)

#### WMS KPIs
- **Inventory Accuracy** = (Correct bins / Total bins counted) × 100% → target ≥ 99.5%
- **Order Fulfillment Rate** = Đơn giao đúng hạn / Tổng đơn → target ≥ 98%
- **Dock-to-Stock Time** = Thời gian từ xe đến đến hàng vào vị trí → target < 2h
- **Pick Accuracy** = Đơn không có lỗi pick / Tổng đơn → target ≥ 99.9%
- **Warehouse Utilization** = Bin đang dùng / Tổng bin × 100%

#### TMS KPIs
- **On-Time Delivery (OTD)** = Chuyến đúng giờ / Tổng chuyến → target ≥ 95%
- **Vehicle Utilization** = Trọng lượng thực / Tải trọng tối đa → optimize > 80%
- **Cost per km** = Tổng chi phí / Tổng km
- **Empty mile ratio** = Km chạy không tải / Tổng km → minimize

#### Inventory Planning KPIs
- **Days of Supply (DOS)** = Tồn kho / Nhu cầu trung bình ngày
- **Inventory Turnover** = COGS / Tồn kho bình quân → cao = tốt
- **Fill Rate** = Số lượng đáp ứng từ kho / Tổng số lượng được yêu cầu
- **MAPE** (Forecast accuracy) → target < 20% cho hàng A
