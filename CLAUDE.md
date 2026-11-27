# WMS Supply Chain Webapp

> File này chỉ ghi **luật đang hiệu lực**, ngắn, kèm lý do. Chi tiết, số đo và lịch sử nằm ở:
> `docs/rules/*.md` (luật chung) · `docs/modules/<key>.md` (từng module) · `docs/qa/BUG_CLASSES.md` (sổ lớp lỗi) · skill trong `.claude/skills/`.
> Bản đầy đủ trước ngày 16/11/2026 (có ngày chốt và lịch sử từng luật): `docs/rules/claude-md-full-2026-11-16.md` — tra khi cần biết vì sao một luật ra đời.
>
> Giữ file này dưới khoảng 250 dòng. Bài học mới ghi vào `docs/` hoặc sổ lớp lỗi. Chỉ thêm vào đây khi luật cần cho hầu hết mọi việc; khi thêm thì viết trạng thái hiện tại và xoá luật cũ nó thay, không ghi ngày và lịch sử.

## Cách làm việc

- Trao đổi bằng tiếng Việt, gọi người dùng là "bạn".
- Người dùng làm việc một mình trên nhánh `dev`, Vercel Preview và DB staging. Báo cáo không nhắc `main`, production hay merge, trừ khi người dùng chủ động hỏi. Việc cần nhớ cho lúc lên production ghi vào `SCHEMA_REVIEW.md`.
- **Bạn là người bảo trì lâu dài của codebase này.** Khi một thay đổi sắp chép lại logic đã có ở chỗ khác, hãy gom về một helper dùng chung thay vì chép thêm bản thứ hai; lớp lỗi lặp nhiều nhất của app là "hai cửa cùng một sổ mà khác luật". Ngoài việc đó, giữ thay đổi trong phạm vi yêu cầu: không đổi hành vi, không đổi giao diện, không dọn code không liên quan. Mọi thay đổi ngoài yêu cầu phải được nêu trong báo cáo cuối.
- **Làm hết việc được giao.** Lỗi thường gặp (lỗi lệnh, hết giờ chờ, file bị khoá, Preview chưa lên bản mới) thì tự chẩn đoán và đi tiếp. Lựa chọn nhỏ về kỹ thuật thì chọn phương án hợp lý, ghi vào báo cáo, không dừng hỏi.
- **Các bước làm luôn, không cần hỏi:**
  - sửa code, viết test, viết migration, cập nhật docs và skill;
  - chạy `npm test`, cổng tĩnh, `tsc`, build;
  - commit và `git push origin dev`;
  - đọc DB staging; áp migration lên staging;
  - chạy gói QA của module vừa sửa và các lượt Playwright chỉ đọc, khi ước lượng dưới khoảng 20 MB tải về;
  - cấp và dọn tài khoản CI bằng `scripts/qa/ci-account.mjs`.
- **Hỏi trước khi làm, vì khó hoàn tác hoặc tốn hạn mức chung:**
  - mọi thao tác trên `main` hoặc DB production;
  - gói tải `03-scale`, `05-rush`, `06-readload` và `run-all --tier full` (staging là máy nhỏ, cạn Disk IO là dừng nhiều giờ);
  - lượt test ước lượng trên 20 MB tải về;
  - xoá dữ liệu không do bộ kiểm tạo ra;
  - đổi một luật nghiệp vụ mà người dùng đã chốt.
- **Câu hỏi về một luật không phải lệnh đổi luật.** Khi người dùng hỏi "sao lại thế này", hãy giải thích luật, lý do và các phương án, rồi chờ quyết định.
- **Tính năng có nhiều luật nghiệp vụ** (điều vận, nhập trả, đặt lịch…): trước khi code, nêu các ca khó và hỏi người dùng một lượt, rồi viết thành bảng "tình huống → kết quả mong muốn". Bảng đó trở thành test. Lý do: nhiều luật của app đã phải làm lại vì chỉ lộ ra khi người dùng nhìn thấy màn hình.
- **Nghiệm thu trước khi báo xong** (skill `verify-feature`):
  - đăng nhập bằng một chức danh thật của người sẽ dùng tính năng, không dùng superadmin, và đi hết luồng. Superadmin bỏ qua mọi kiểm quyền nên luôn thấy màn hình chạy tốt;
  - tự hỏi "người mới mở màn này có tìm thấy lối vào không";
  - chụp màn ở 1280 và 390 và tự xem ảnh.
- **Báo cáo:** giữa lượt chỉ viết một dòng trạng thái. Mọi tổng kết gom vào một tin cuối. Viết cho người không xem các bước làm: câu ngắn, từ thường, kết luận trước, nói rõ phần chưa làm và phần cần người dùng quyết.
- Nhiều phiên Claude có thể cùng làm trên thư mục này. Trước khi sửa file đang nóng, xem `git status` và `git log -2`. Nếu cổng pre-push đỏ vì code dở của phiên khác thì chờ, không dùng `--no-verify`.

## Môi trường

- Remote `https://github.com/vietnamese2212/wms-webapp.git`. Nhánh `dev` → Vercel Preview + Supabase staging `bxxryrmpfabvjitqbdnw`. Nhánh `main` → production + DB `svicyfquresxaigfxsdb`.
- `backend/.env`: `DATABASE_URL` chỉ đọc (staging) · `DIRECT_URL` ghi được (staging) · `LOF_DATABASE_URL` là production. `.mcp.json` không được commit; MCP postgres khai `node scripts/mcp/postgres-mcp.mjs` (đọc `DATABASE_URL` từ `backend/.env`, mật khẩu qua `PGPASSWORD`) — không ghi chuỗi kết nối có mật khẩu vào `.mcp.json` / `~/.claude.json`. Cổng tĩnh `secret_literal_in_repo` gác file trong repo.
- Mật khẩu và token không đi qua tham số lệnh gọi công cụ. Script tự đọc trong tiến trình (mẫu `scripts/qa/ci-account.mjs`).
- `Template upload.xlsx` ở thư mục gốc là dữ liệu gốc của người dùng: chỉ đọc, không sửa, không `git add`. Luôn `git add` từng file cụ thể. Không add `docs/presentation/` và `ui-ux/`.
- Sửa `backend/src` thì tăng `// rebuild-token` trong `api/index.ts`, nếu không Vercel không build lại hàm.
- **Hạn mức Supabase:** staging dùng chung cho mọi lượt test. Trước lượt test chạm DB, ước lượng số MB tải về; sau lượt, báo số đo. Ngân sách cả ngày khoảng 165 MB. Lượt kiểm đêm (`qa-nightly`) đang tắt và `qa-smoke` chỉ chạy tay cho tới khi người dùng bật lại.
- Chạy tại máy: `cd backend && npm run dev` (cổng 4000) · `cd frontend && npm run dev` (cổng 5173).

## Kiểm thử và chống lỗi lặp

- Tầng rẻ nhất chạy trước: `cd backend && npm test` (vài giây, không cần DB) → `node scripts/qa/09-static-gate.mjs` → `tsc`. Cổng `.githooks/pre-push` chạy đủ các bước này.
- **Mỗi bản sửa lỗi kèm một lưới máy** ở tầng rẻ nhất bắt được: kiểu TypeScript → test trong `backend/tests` → luật ở cổng tĩnh → phép kiểm trong gói QA. Luật viết bằng chữ không tự thi hành. Phép kiểm mới phải đỏ trên bản lỗi rồi mới tin.
- Mỗi lỗi ghi vào `docs/qa/BUG_CLASSES.md`: **LẶP** (lớp đã có: sửa lưới của lớp đó) hoặc **MỚI** (thêm dòng và lưới).
- Đổi một luật thì rà cả phép kiểm đang đọc luật đó. Phép kiểm khoá hành vi cũ sẽ đỏ oan mỗi lượt.
- Giao diện: `scripts/qa/ui-mobile-sweep.mjs` (mọi trang và form ở 1280 / 390 / 360) và `scripts/qa/ui-layout-sync.mjs` (bố cục máy tính giống nhau ở mọi cỡ màn từ 1280).
- Chi tiết, các bậc `fast` / `full`, quy trình lên production: `docs/rules/qa-and-release.md`.

## Luật code

Mỗi dòng là một luật đã từng gây lỗi thật. Chi tiết và số đo: `docs/rules/scale-and-data.md`, `docs/rules/backend.md`.

**Quy mô** — thiết kế cho vài nghìn người dùng và bảng nghiệp vụ hàng triệu dòng:
- PostgREST cắt âm thầm ở khoảng 1.000 dòng mỗi phản hồi. List dùng `fetchAllRowsParallel` hoặc phân trang server. Cần một tập hay một tổng thì hỏi DB bằng RPC, không kéo dòng về đếm.
- `.in('col', ids)` nằm trên URL: chia lô 300 id, kể cả lệnh ghi. Danh sách id lớn thì truyền cho RPC qua body. Lọc theo kho dùng cột `warehouse_id`, không liệt kê vị trí.
- Số request tới PostgREST là tài nguyên hiếm (khoảng 10 khe). RPC phân trang trả dòng, không trả id. Các ô tổng của một màn gom vào một lời gọi. Tổng hợp nặng phải cache, không nằm trong đường request.
- Phản hồi qua Vercel tối đa 4,5 MB: trang nào dữ liệu tăng theo thời gian thì phân trang server. Upload Excel đi qua `excelUploadBody` + middleware `excelFromStorage`.
- Danh mục lớn (mã hàng, vị trí, biển số) không nạp cả vào trình duyệt: ô chọn tìm trên server, giá trị đã chọn luôn có nhãn.
- Bảng không phân trang mà dài theo dữ liệu thì vẽ thân bảng qua `WindowedRows`.
- Ghi hàng loạt theo lô khoảng 500 dòng, không ghi tuần tự từng dòng (quá 60 giây của Vercel). Chuẩn đầy đủ: skill `upload-download-standard`.
- Sổ nhật ký lớn lên theo năm phải đăng ký hạn giữ ở `services/dataArchive.ts`. Chuỗi truy xuất lô (pallet, nhập, quét, đơn xuất, kiểm kê) không lưu trữ ra ngoài.

**Ghi dữ liệu và realtime** (skill `mutation-realtime`):
- Mọi INSERT có `id: randomUUID()` và `updated_at`. DB không có giá trị mặc định, thiếu là lỗi 23502.
- Bộ đếm, tồn, sức chứa dùng chung phải cập nhật nguyên tử: RPC có khoá dòng, hoặc ghi có điều kiện "giá trị vẫn như lúc đọc" kèm thử lại có giãn cách ngẫu nhiên. Luôn hình dung vài trăm người cùng thao tác.
- Cửa ghi chạm từ hai sổ trở lên phải nằm trong một giao dịch (RPC), hoặc trả lỗi để màn hình hỏi thử lại.
- Số liệu cập nhật realtime: `invalidateQueries` đủ khoá, thêm bảng vào `TABLE_QUERY_MAP`. Realtime chạy bằng broadcast từ trigger DB. Không tạo policy cho vai `authenticated` hay `anon`; hai vai này có 0 quyền trên bảng và gói QA 00 gác điều đó.
- Đổi schema: file `backend/migrations/YYYYMMDD_<mô tả>.sql` → áp staging → `npm run db:types` → cập nhật `SCHEMA_REVIEW.md`.

**Số lượng — đơn vị gốc (base unit):**
- Mọi lưu trữ, phép tính và trường số lượng qua API là số theo đơn vị gốc của mã hàng. Thùng chỉ là lớp hiển thị: "N thùng + M hộp".
- Mọi quy đổi đi qua `utils/qtyUnits.ts` (hai bản BE và FE phải ra cùng kết quả). Không tự chia, nhân hệ số ở chỗ khác.
- Mã có đơn vị thùng thì số gốc phải nguyên, trừ khi đơn vị gốc là đơn vị đo (kg, lít…): mã đó hiện kg là số chính, quy cách là gợi ý ("110 kg (5 bao + 10 kg)"). Luật này chỉ nằm ở `baseAllowsDecimal` / `qtyIntegerError` (code) và `qty_whole_required` (DB). Thêm hoặc bỏ đơn vị quy cách thì số / pallet đổi theo (`palletQtyOnUnitChange`). Tổng nhiều mã phải quy đổi từng mã rồi mới cộng, và dùng nhãn `QTY_CONVERTED_LABEL`.
- Sau khi sửa, kiểm số hiển thị trên màn thật.

**Helper tập trung** — sửa luật ở một chỗ, không viết lại rải rác:
- Biển số: `normalizePlate` (BE) và `normalizeLicensePlate` (FE), dạng `^[A-Z0-9]+$`, chuẩn hoá ở backend. Hai cột `WeighTicket.license_plate` và `erp_outbound_orders.license_plate` giữ nguyên văn nguồn ngoài.
- Tem QR pallet (hai định dạng `_` và `;` cùng tồn tại): `parseInboundQR` và `normalizeQR` (BE), `utils/qr.ts` (FE). Mọi điểm quét gọi `normalizeQR`. Chi tiết: `docs/rules/multi-tenant-qr.md`.
- %Date: `computePctDate` trong `shelfLife.ts`. Luật chặn theo date: `palletMeetsDateRule` / `dateRuleBelowError`, dùng ở mọi cửa chỉ đường và mọi cửa trừ tồn.
- Ngày giờ (múi giờ Việt Nam): đọc mốc từ DB qua `utcMs()`, so với ngày Việt Nam qua `vnDayOf()`, hiển thị qua `utils/formatters.ts`. "Hôm nay" là hàm, không phải hằng số. `InventoryEntry.import_date` là ngày hàng thật sự vào kho; thao tác nội bộ kế thừa ngày này.
- Đổi vị trí pallet: gọi `logPalletMoves`. Dòng xe của một kho: đọc qua `services/vehicleModelScope.ts`. Chuỗi tình trạng xe: `services/tripFlow.ts`.

**Backend:**
- Gọi `fail(res, error)` với cả đối tượng lỗi để lỗi Postgres do đầu vào thành 400/409/404, không thành 500. Sửa hoặc xoá theo id phải kiểm số dòng bị tác động.
- Route ghi mới có `validate({…})`. Router mới đi qua `catchAsyncErrors`. File BE mới dùng client `db` có kiểu.
- Đường đọc cắt phạm vi kho giống đường ghi. Route có hai id phải kiểm id con thuộc id cha.
- Việc nền ghi lỗi qua `recordBackgroundFailure` để phân biệt quá tải với hỏng thật.
- Không dùng `as any` trong code mới. Code cũ chỉ dọn khi đụng tới file đó.

**Đa đơn vị:** một codebase, mỗi đơn vị một DB và một bản triển khai. Khác biệt xử lý bằng cờ trong `SystemSetting` (khai ở `KNOWN_SETTINGS`), mặc định là hành vi cũ. Không viết `if (tenant === …)`.

## Giao diện

Chuẩn chi tiết: skill `table-format` (list, bảng, trang chi tiết), skill `qr-scan-flow` (quét), `docs/rules/ui.md`.

- Màn mới phải giống các màn sẵn có: so với một màn chuẩn cùng loại (`Inbound.tsx`, `InboundDetail.tsx`) trước khi báo xong.
- Dùng component chung: `FormSheet` cho form thêm/sửa · `ActionCluster` cho nút thanh công cụ · `FloatingActionBar` cho thao tác khi chọn nhiều dòng · `ResizableTable`, `ListFooter`, `SummaryBand`, `StatusBadge`, `TableEmptyRow`, `InfoTip`, `ScanIcon`, `SingleSelect`, `useConfirmDialog`.
- Bộ lọc của list lưu trong `useWmsFilterStore`. Slice mới có Kho hoặc Loại kho thì thêm vào `sweepGlobalScope`.
- Điện thoại (đến 360 px): không tràn ngang, không phần tử nào đè phần tử khác, nút chính thấy ngay khi mở màn. Máy tính từ 1280 trở lên: cùng một bố cục ở mọi cỡ màn.
- Lỗi API hiện băng đỏ ngay trong màn. Nút gọi API bị khoá trong lúc chờ.
- Ô kế thừa giá trị từ cấp cha phải in giá trị đang hiệu lực. Nhãn đơn vị tính lấy từ danh mục qua `unitLabel()`.
- Trang có tab mới thì khai vào `PAGE_TABS` và gọi `useMobileTabs`.

## Phân quyền

Chi tiết: skill `add-permission`, `docs/rules/rbac.md`.

- Quyền nằm trên chức danh (`JobTitle.module_permissions`). Superadmin là cột `Employee.is_superadmin`. Vai trò đọc theo cờ danh mục, không so tên tiếng Việt.
- Mỗi nút hoặc route ghi có quyền riêng, khai đủ bốn nơi: `MODULES` (FE), `ALL_PERMISSIONS` (BE), `can()` ở nút, `requirePerm` ở route. Xuất dữ liệu ra file cần quyền `export` riêng.
- **Module hoặc quyền mới phải kèm migration cấp cho các chức danh sẽ dùng.** Nếu không, chỉ superadmin thấy tính năng.
- Phạm vi dữ liệu: người dùng chỉ thấy và ghi được dữ liệu của kho và loại kho được giao. FE dùng `useScopedWarehouses` / `useScopedWhTypes`; BE dùng `utils/categoryScope.ts`. Một bản ghi mang nhiều loại kho thì "giao ít nhất một loại là thấy".
- Lối tắt tới trang khác kiểm quyền qua `useCanSeePath()`.
- Chỉ superadmin được sửa hồ sơ, đặt mật khẩu, xoá hoặc đổi kho của tài khoản superadmin (`blockIfTargetSuperadmin`), và người không phải superadmin không được cấp cho chức danh quyền vượt quyền của chính mình (`escalationError`). Lý do: một tài khoản quản lý thường không được tự leo lên quyền cao nhất. Chi tiết: `docs/rules/rbac.md`.

## Giao thoa giữa các module

Sửa module nào thì đọc `docs/modules/<key>.md` của nó và các file trong mục "Giao thoa với" của file đó. Các dòng chảy chính:

- **SAP → xe:** ZSD02/VL06O (`external_do_sap`) → Điều vận (`dispatch`) → Kế hoạch xuất (`external_khvc`) → chuyến Xuất kho (`outbound`) và lệnh vận chuyển (`tms_plan`) → khung giờ, cổng, cân → cước (`freight`). Xuất kho là kết quả dẫn xuất: muốn sửa thì sửa ở nguồn. Với kho dùng bàn ghép xe, bàn là cửa ghi duy nhất của Kế hoạch xuất. Luật ghép xe nằm trong một hàm `manualRuleBlocks`. "Đã xuất" chỉ tính theo chuyến hoàn thành trong app, không theo cờ SAP. Ngày giao trong ZSD02 không quyết định gì.
- **Tồn kho** là đích ghi của nhập, xuất, nhặt lẻ, kiểm kê, dồn/tách, slotting, fill: mọi cửa ghi theo đơn vị gốc và nguyên tử.
- **Hạ hàng xuống ô nhặt lẻ:** Fill ⇄ Việc cần làm ⇄ Nhặt lẻ. Phép trừ "đã có người lo" đếm cả hai nguồn.
- **Sản xuất (MES, `production`):** kho chế biến là kho phụ nội bộ; nguyên liệu → mẻ → bồn → Sổ đóng gói → pallet thành phẩm. Rút nguyên liệu vào mẻ và "xuất tiêu hao" ở kho phụ là hai cửa trừ cùng một sổ, nên cùng luật giữ QA và FEFO. Hàng có tem QR phải quét. Sổ bồn chỉ ghi thêm. Mẻ gắn một bồn từ lúc tạo, mã lô tự ghép (chữ nhà máy + chu kỳ + số mẻ + mã bồn); QA đạt / không đạt bấm ở bồn; điều kiện của mẻ chỉ tính ở hàm `mes_batch_gate`. Chuỗi gia phả mẻ không lưu trữ ra ngoài. Chi tiết: `docs/modules/production.md`.
- **Hàng trả về:** phiếu nhập `source_type='RETURN'`; chi tiết ở `docs/modules/inbound.md`.
- **Khách hàng** nuôi %Date (kho), kho đích chuyển kho (`Customer.warehouse_id`) và luật dòng xe (điều vận). **Loại kho** quyết định phạm vi quyền và điều kiện bảo quản.
- Mẫu lỗi hay gặp nhất: hai cửa cùng ghi hoặc đọc một sổ mà khác luật (form ↔ upload ↔ API ↔ máy tự làm). Đổi luật ở một cửa thì rà mọi cửa của bảng đó.

## Bản đồ module

`node scripts/docs/check-modules.mjs` kiểm bảng này với `docs/modules/`. Thêm module: thêm dòng ở đây, thêm file module, nối "Giao thoa với" hai phía.

| Module key | Nhãn (bảng quyền) | Trang / Menu | Actions (theo `ALL_PERMISSIONS`) | Chi tiết |
|---|---|---|---|---|
| `inventory` | Tồn kho | Tồn kho (+ Sổ pallet) | view, adjust, move_location, recode, qa_update, update_ncc, update_prod_date, export, import | [docs/modules/inventory.md](docs/modules/inventory.md) |
| `inbound` | Nhập kho | Nhập kho (+ Hàng trả về) | view, create, edit, scan, edit_pallet, force_edit_pallet, delete_pallet, force_delete_pallet, cancel, complete, uncomplete, putaway_override, export, recall_manage | [docs/modules/inbound.md](docs/modules/inbound.md) |
| `outbound` | Xuất kho | Xuất kho · Chốt %Date · Quy định date (4 rule Bắt đầu chuyến, dẫn xuất từ SAP) | view, prepare, create, quick_export, import, edit, assign, unassign, start, unstart, scan, complete, uncomplete, cancel, reconcile, weigh_waive, gate_waive, rotation_override, set_date, push_transfer | [docs/modules/outbound.md](docs/modules/outbound.md) |
| `scanlog` | Lịch sử quét | Lịch sử quét | view, export | [docs/modules/scanlog.md](docs/modules/scanlog.md) |
| `traceability` | Truy xuất lô | Truy xuất lô (menu Báo cáo) | view, export, investigate | [docs/modules/traceability.md](docs/modules/traceability.md) |
| `loosepicking` | Nhặt lẻ | Nhặt lẻ (+ Tối ưu tuyến) | view, scan, complete, recalc | [docs/modules/loosepicking.md](docs/modules/loosepicking.md) |
| `stocktake` | Kiểm kho | Kiểm kho (4 tab, Luân phiên ABC) | view, scan, complete, export | [docs/modules/stocktake.md](docs/modules/stocktake.md) |
| `locations` | Vị trí kho | Vị trí kho (+ tab Sơ đồ kho) | view, create, edit, delete, import, export, print_label | [docs/modules/locations.md](docs/modules/locations.md) |
| `materials` | Mã hàng | Mã hàng (+ Nhà sản xuất) | view, create, edit, import, delete | [docs/modules/materials.md](docs/modules/materials.md) |
| `customers` | Khách hàng | Khách hàng (menu Cấu hình) — kênh · mức date · toạ độ điểm giao | view, edit, import, manage_channel, create_channel, locate, geocode | [docs/modules/customers.md](docs/modules/customers.md) |
| `external_do_sap` | Dữ liệu bên ngoài → DO SAP | Dữ liệu bên ngoài → DO SAP · Chưa có OD (ZSD02 / VL06O) | view, create, edit, delete, export | [docs/modules/external_do_sap.md](docs/modules/external_do_sap.md) |
| `pallet_print` | In tem pallet | In tem pallet | view, generate, reprint, history, audit | [docs/modules/pallet_print.md](docs/modules/pallet_print.md) |
| `pallet_ops` | Dồn / Tách pallet | Dồn / Tách pallet | view, merge, ungroup, split | [docs/modules/pallet_ops.md](docs/modules/pallet_ops.md) |
| `wms_settings` | Cài đặt WMS | Cài đặt WMS (kho, loại kho, ĐK bảo quản, khu, ca, QA, máy, hệ thống) | view, manage_warehouse, manage_type, manage_unit, manage_zone, manage_shift, manage_qa, manage_machine, manage_system | [docs/modules/wms_settings.md](docs/modules/wms_settings.md) |
| `employees` | Sơ đồ tổ chức (xem) | Sơ đồ tổ chức | view | [docs/modules/employees.md](docs/modules/employees.md) |
| `user_admin` | Quản lý người dùng | Quản lý người dùng (+ Nhật ký) | view, create, edit, set_password, unlock, delete, manage_roles, audit_log | [docs/modules/user_admin.md](docs/modules/user_admin.md) |
| `work_skill` | Vị trí & Skill | trong Quản lý người dùng | view, create, edit, delete, assign | [docs/modules/work_skill.md](docs/modules/work_skill.md) |
| `schedule` | Lịch làm việc | Lịch làm việc | _(không có trong config)_ | [docs/modules/schedule.md](docs/modules/schedule.md) |
| `work_assignment` | Phân công lịch làm việc | Phân công (Layout · Quy tắc ca) | view, create, edit, publish, delete, manage_layout, manage_shift_rules | [docs/modules/work_assignment.md](docs/modules/work_assignment.md) |
| `attendance` | Chấm công | Chấm công | view, self_log, edit, report | [docs/modules/attendance.md](docs/modules/attendance.md) |
| `leave` | Nghỉ phép | Chấm công → tab Nghỉ phép | view, request, approve, delete, export | [docs/modules/leave.md](docs/modules/leave.md) |
| `tms_plan` | Vận chuyển: Đặt lịch & Chuyển kho | TMS Bookings (Đặt lịch · Chuyển kho) | view, create, edit, delete, add_vehicle, release, change_date, book, revoke, upload_outbound, upload_inbound, confirm_receipt, export | [docs/modules/tms_plan.md](docs/modules/tms_plan.md) |
| `tms_vehicle_types` | TMS — Loại xe | Cài đặt TMS — Loại xe + Mã dòng xe | view, create, edit, delete | [docs/modules/tms_vehicle_types.md](docs/modules/tms_vehicle_types.md) |
| `freight` | Cước vận chuyển | Cước vận chuyển (menu TMS) | view, manage, export | [docs/modules/freight.md](docs/modules/freight.md) |
| `dispatch` | Điều vận | Điều vận (menu TMS) | view, plan, confirm, export, customer_vehicles | [docs/modules/dispatch.md](docs/modules/dispatch.md) |
| `tms_slots` | TMS — Khung giờ | Cài đặt TMS — Khung giờ | view, create, edit, delete | [docs/modules/tms_slots.md](docs/modules/tms_slots.md) |
| `tms_companies` | TMS — ĐVVT / NCC | Cài đặt TMS — ĐVVT / NCC | view, create, edit, delete | [docs/modules/tms_companies.md](docs/modules/tms_companies.md) |
| `tms_vehicles` | TMS — Xe | Cài đặt TMS — Xe | view, create, edit, delete | [docs/modules/tms_vehicles.md](docs/modules/tms_vehicles.md) |
| `gate_registration` | Đăng ký cổng | Đăng ký cổng | view, create, edit, delete, call, entry, exit | [docs/modules/gate_registration.md](docs/modules/gate_registration.md) |
| `weigh_station` | Phiếu cân (trạm cân) | Phiếu cân | view, match | [docs/modules/weigh_station.md](docs/modules/weigh_station.md) |
| `dashboard` | Dashboard (Tổng quan) | Tổng quan (+ tab KPI, Dịch vụ) | view, kpi_target, kpi_note | [docs/modules/dashboard.md](docs/modules/dashboard.md) |
| `warehouse_cost` | Chi phí kho | Chi phí kho | view, edit, lock, manage_item | [docs/modules/warehouse_cost.md](docs/modules/warehouse_cost.md) |
| `control_tower` | Giám sát vận hành | Giám sát vận hành | view | [docs/modules/control_tower.md](docs/modules/control_tower.md) |
| `alerts` | Cảnh báo vận hành | Thông báo + nút chuông | view, ack | [docs/modules/alerts.md](docs/modules/alerts.md) |
| `slotting` | Tối ưu vị trí (Slotting) | Tối ưu vị trí | view, plan, delete, complete, cancel, reopen, configure | [docs/modules/slotting.md](docs/modules/slotting.md) |
| `warehouse_map` | Sơ đồ kho | Sơ đồ kho (tab của Vị trí kho) | view, edit | [docs/modules/warehouse_map.md](docs/modules/warehouse_map.md) |
| `directed_work` | Việc cần làm | Việc cần làm (+ Hộp việc) | view, confirm, replan | [docs/modules/directed_work.md](docs/modules/directed_work.md) |
| `fill` | Fill hàng (nhặt lẻ) | Fill hàng | view, plan, cancel, change_dest, assign, execute | [docs/modules/fill.md](docs/modules/fill.md) |
| `forklift` | Xe nâng | Xe nâng (check list) | view, check, delete_check, manage_vehicle, manage_item | [docs/modules/forklift.md](docs/modules/forklift.md) |
| `packing` | Sổ đóng gói | Sổ đóng gói | view, record, open_run, edit, cancel, export | [docs/modules/packing.md](docs/modules/packing.md) |
| `inbound_plan` | Kế hoạch nhập chuyển kho | trong TMS Bookings (tab Kế hoạch) | view, edit | [docs/modules/inbound_plan.md](docs/modules/inbound_plan.md) |
| `external_khvc` | Dữ liệu bên ngoài → Kế hoạch xuất | Dữ liệu bên ngoài → Kế hoạch xuất | view, create, edit, delete | [docs/modules/external_khvc.md](docs/modules/external_khvc.md) |
| `production` | Sản xuất (Mẻ chế biến · Bồn) | Mẻ chế biến · Bồn · Báo cáo NVL · Định mức · Cài đặt MES (nhóm menu cấp 1 "Sản xuất (MES)") — MES gđ1 | view, open_batch, consume, reverse, qa_release, manage_tank, tank_ops, export, configure, manage_recipe, view_recipe, shift_report, process_log, edit_requirement, approve_lead, approve_qa, print_label, pour, approve_expired | [docs/modules/production.md](docs/modules/production.md) |
| `help` | Hỗ trợ | Hỗ trợ → Hướng dẫn sử dụng (bài đánh số theo thứ tự người mới cần học: Bắt đầu (ai cũng thấy) · Mã hàng · In tem · Nhập kho · Tồn kho · Dồn/Tách · Kiểm kê · MES · Truy xuất lô · Lịch sử quét — mỗi bài theo module của nó) | _(không có trong config — ai đăng nhập cũng vào; từng bài theo quyền xem module của bài)_ | [docs/modules/help.md](docs/modules/help.md) |

## Skill

Skill chứa chuẩn chi tiết của từng loại việc. Nạp skill khi việc khớp, thay vì làm theo trí nhớ. Một việc có thể cần nhiều skill.

| Việc | Skill |
|---|---|
| Việc lớn: module mới, đổi schema, yêu cầu còn mơ hồ | `brainstorm-plan` |
| Rà một module | `review-module` |
| Kiểm app, tìm lỗi | `check-app` |
| List, bảng, trang chi tiết | `table-format` |
| Quét QR | `qr-scan-flow` |
| Upload, export | `upload-download-standard` |
| Nút hoặc route ghi | `add-permission` |
| INSERT/UPDATE, đổi schema | `mutation-realtime` |
| Trước khi báo xong | `verify-feature` |
| Lỗi chưa rõ nguyên nhân | `debug-systematic` |
| Route có id, bảng/RPC mới, đăng nhập, thư viện mới | `security-hardening` |

## Tech stack

- Frontend: React 18, TypeScript, Vite, Tailwind v3, shadcn/ui, React Router v6, TanStack Query. Quét mã bằng `BarcodeDetector`, dự phòng `zxing-wasm`.
- Backend: Node, Express, TypeScript, `@supabase/supabase-js` (service role), chạy serverless qua `api/index.ts`. Đăng nhập bằng JWT.
- Định dạng API: `{ "success": true, "data": {} }` hoặc `{ "success": false, "error": { "code": "…", "message": "…" } }`.
