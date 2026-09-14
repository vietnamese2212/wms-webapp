# Kế hoạch: "Đi nhặt lẻ" — MỘT nút mở ĐƯỜNG ĐI và QUÉT ngay tại đó (user chốt 14/09/2026)

> **ĐÃ THỰC THI 14/09** (commit `df261a4d`) — nút lấy tên user chốt: **"Theo vị trí"** (màn "Theo vị trí công việc"),
> component `components/wms/LooseRouteSheet.tsx`; `GdoScanSheet` tách thành `GdoScanPanel`; BE `loose-route` trả
> `remaining_base` · `material_name` · `units` · `dist_from_prev_cells` · `cell_m`. Gói 57 [25d1–25d2]. Phần dưới là plan gốc.

> User: *"mở 1 nút và hiện lên con đường đi lấy, và quét được luôn ở đó."* — sau khi hỏi *"cả chục mã thì làm sao?"*
> về dải đường đi một dòng trên trang Nhặt lẻ. Plan viết trước khi compact; thực thi ở lượt sau.

## Hiện trạng (đã lên dev tới `70cc3392`)
- BE `GET /wms/directed/loose-route?gdo_id=` (`directedWorkController.getLooseRoute`): điểm ghé = vị trí lấy FEFO
  đầu của mỗi mã (`rotationSuggestionsByMaterial`), thứ tự = `orderLocationsFromDock` (BFS từ cửa chuyến, `directedRoute.ts`).
  Trả `{ routed, start_code, stops[{ seq, location_id, location_code, is_pick_face, materials[{ item_id, material_id,
  material_code, pct_date, available }] }], unlocated[] }`. Bỏ dòng đã lấy đủ (`cartons_scanned >= cartons_ordered`).
- FE `LoosePickingDetail.tsx`: hook `useLooseRoute`, dải tóm tắt "N điểm ghé từ Cửa X", số ghé tròn ở đầu từng dòng,
  bảng xếp theo thứ tự ghé. Gói 57 [25a–25c].
- Quét: `components/wms/GdoScanSheet.tsx` **đã có `mode: 'loose'`** cho CẢ chuyến — quét tem bất kỳ, tự nhận dòng hàng
  theo mã trên QR (`activeItemId`), gọi `loose_picking_mode: true`, xử lý phần dư / luân chuyển / cất hàng. Trang Nhặt lẻ
  nút "Quét QR" ở header đang mở đúng sheet này. `LoosePickingItemDetail` là bản quét MỘT dòng (`?scan=1`).

## Giả định (nói rõ, sửa nếu sai)
1. "Quét được luôn ở đó" = quét pallet như hiện nay (loose mode, tự nhận mã), KHÔNG cần quét tem VỊ TRÍ để xác nhận tới ô.
   (Có thể thêm bước "quét tem vị trí = tới ô" sau nếu kho muốn kỷ luật đường đi — để tuỳ chọn, không ép.)
2. Đơn vị đi đường = CHUYẾN (một thủ kho nhặt trọn chuyến), không gom nhiều chuyến.
3. Màn dùng chính trên PDA/điện thoại 360 px; PC vẫn mở được.

## Thiết kế — component `components/wms/LooseRouteSheet.tsx` (full-screen, cùng khuôn `GdoScanSheet`)
- **Mở từ:** nút **"Đi nhặt lẻ"** (primary, `ScanIcon` + Route) ở header `LoosePickingDetail` (thay/đứng cạnh "Quét QR");
  và từ tab Sắp quét của Việc cần làm cho dòng nhặt lẻ (link "Đi nhặt lẻ ›" cạnh "Trừ tồn nhặt lẻ ›", gọi `anchorDirected()`).
- **Bố cục (mobile trước):**
  - Header: `tripName(gdo)` · "điểm ghé k/N" · nút đóng.
  - **Dải điểm ghé** ngang, cuộn được, mỗi điểm = ô tròn số + mã vị trí rút gọn; điểm hiện tại tô đậm; điểm xong gạch/xanh;
    bấm để nhảy. (Dùng luật 12/09: hàng nowrap trong khung co ⇒ `overflow-x-auto`, tự cuộn điểm hiện tại vào tầm nhìn.)
  - **Thẻ điểm hiện tại**: mã vị trí to (`font-mono`), khoảng cách từ điểm trước (ô × `cell_m` → mét, nếu có bản vẽ),
    danh sách mã phải lấy tại đây: mã · tên · **còn lấy** (`qtyLabel` thùng + hộp, cùng công thức `looseRemainingOf`) ·
    %Date/NSX pallet gợi ý · nút tra tồn (`MaterialStockDialog`).
  - **Vùng quét NGAY DƯỚI thẻ**: nhúng phần lõi của `GdoScanSheet` mode `loose` (camera + súng PDA + panel xác nhận
    số thùng / phần dư / luân chuyển). Cách rẻ nhất: **tách thân `GdoScanSheet` thành `GdoScanPanel`** (không có khung
    full-screen riêng) rồi cả `GdoScanSheet` cũ và `LooseRouteSheet` cùng dùng — KHÔNG viết luồng quét thứ hai
    (luật một nguồn cho luân chuyển/cất/phần dư).
  - Sau mỗi lượt Lưu thành công: realtime `gdo` key làm mới `useLooseRoute` + `useGDO`; điểm hiện tại hết mã ⇒ tự chuyển
    sang điểm kế + beep; quét tem mã KHÔNG thuộc điểm hiện tại ⇒ vẫn cho lưu (Hướng dẫn là chỉ đường, không phải rào —
    luật Việc cần làm) nhưng hiện nhắc vàng "mã này ở điểm ghé số X".
  - Footer: "◀ Điểm trước" · "Điểm sau ▶" · đếm "đã lấy m/n mã".
- **BE bổ sung nhỏ (`getLooseRoute`):** thêm vào mỗi `materials[]`: `remaining_base` (còn lấy nhặt lẻ — dùng đúng công thức
  `looseRemainingOf` phía BE; hiện có `cartons_scanned`/`loose_picking`/scan_entries — nếu cần đọc `OutboundScanEntry`
  `is_loose_picking` thì gộp một câu theo item_id chunk 300), `units` (units_per_carton/entry_unit/base_unit),
  `material_name`; mỗi `stops[]`: `dist_from_prev_cells` (BFS đã có trong `orderLocationsFromDock` — trả luôn, đừng đo lại
  ở FE), `done: boolean`. Giữ đúng ratchet `unpaginated_in_query` (chunk / limit).
- **Quyền:** không quyền mới — mở sheet cần `loosepicking.view`, quét cần `loosepicking.scan` (nút quét ẩn nếu thiếu).

## Kế hoạch thực thi (mỗi bước có phép kiểm)
1. Refactor `GdoScanSheet` → tách `GdoScanPanel` (props: gdo, mode, pdaMode, initialScan, onSaved?) + vỏ full-screen giữ API cũ
   → kiểm: tsc/build; Playwright mở "Quét QR" trang chuyến và Nhặt lẻ vẫn quét được (không đổi hành vi).
2. BE `getLooseRoute` thêm `remaining_base` · `units` · `material_name` · `dist_from_prev_cells` · `done`
   → kiểm: gói 57 [25d] dòng đã quét đủ không còn trong stops; `remaining_base` = đặt − đã quét lẻ.
3. FE `LooseRouteSheet` + hook type mở rộng; nút "Đi nhặt lẻ" ở `LoosePickingDetail`; link ở tab Sắp quét
   → kiểm: Playwright 360 px trên chuyến Ba Vì có ≥2 dòng nhặt lẻ: dải điểm ghé cuộn, thẻ điểm hiện tại đủ 3 mẩu
   (vị trí · còn lấy · nút quét), quét 1 tem qua panel → còn lấy giảm, tự sang điểm kế khi hết.
4. Tự chuyển điểm + nhắc "mã này ở điểm X" → kiểm: Playwright quét tem của điểm 2 khi đang ở điểm 1 → vẫn lưu, có nhắc vàng.
5. Chuẩn: `verify-feature` (tsc BE/FE · build · 57 · fast tier), cập nhật CLAUDE.md hàng `loosepicking` + `directed_work`,
   memory `checkapp-opsdrill-2026-09-13.md`.

## Không làm trong đợt này (nói ra để không bị hiểu là quên)
- Quét tem VỊ TRÍ để xác nhận tới ô (tuỳ chọn sau).
- Gom nhiều chuyến vào một đường đi (thủ kho nhặt nhiều chuyến cùng lúc) — cần đo nhu cầu trước.
- Đường đi cho tab Sắp quét (xuất nguyên pallet): thứ tự đã có `seq` theo `assignSeq`; chỉ thêm link mở sheet.
