// GÓI 09 — CỔNG TĨNH (không cần server, không dependency — chạy được cả trong CI).
// Nguyên tắc RATCHET (bánh răng một chiều): mỗi luật có BASELINE trong static-baseline.json.
//   - Vi phạm TĂNG so với baseline → ĐỎ (code mới vi phạm luật đã chốt).
//   - Vi phạm GIẢM → nhắc hạ baseline (đã dọn được thì khoá thành quả, không cho phình lại).
// Nợ cũ không chặn (không ép mass-rewrite — CLAUDE.md cấm churn), nhưng KHÔNG được tăng thêm.
// usage: node scripts/qa/09-static-gate.mjs [--update-baseline]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, sep } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'static-baseline.json')
const UPDATE = process.argv.includes('--update-baseline')

function* walk(dir, exts) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    if (statSync(p).isDirectory()) yield* walk(p, exts)
    else if (exts.some(e => name.endsWith(e))) yield p
  }
}
// roots = thư mục HOẶC đường dẫn file cụ thể (luật chỉ áp cho vài trang tổng gộp)
function filesOf(root, exts) {
  const p = join(ROOT, root)
  return statSync(p).isFile() ? [p] : [...walk(p, exts)]
}
function countMatches(roots, exts, test, sampleOut) {
  let n = 0
  for (const root of roots) {
    for (const f of filesOf(root, exts)) {
      const lines = readFileSync(f, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        // truyền cả đường dẫn: có luật cần MIỄN chính file chứa luật (vd utils/putaway.ts)
        if (test(line, f)) { n++; if (sampleOut && sampleOut.length < 5) sampleOut.push(`${f.slice(ROOT.length + 1)}:${i + 1}`) }
      })
    }
  }
  return n
}

// Đếm lời gọi hook DANH MỤC LỚN mà không khai `limit` (= kéo cả danh mục về trình duyệt).
// Chiến dịch 27/07 dọn Mã hàng nhưng bỏ sót VỊ TRÍ: 15/08 đo lại còn 6 màn nạp trọn vị trí của
// kho (Bàu Bàng 1.517 = 616KB/lần + BE quét InventoryEntry chunk 300 để tính used_slots).
// Hợp lệ khi có `limit` (typeahead) hoặc `ids` (tra nhãn giá trị đang chọn).
// Bỏ qua chính file định nghĩa hook; đọc cả khối tham số nhiều dòng (ngoặc cân bằng).
function countCatalogueFullLoad(sampleOut) {
  const HOOKS = ['useLocationsReal', 'useMaterials']
  let n = 0
  for (const f of filesOf('frontend/src', ['.ts', '.tsx'])) {
    if (f.endsWith(`api${sep}hooks.ts`)) continue
    const src = readFileSync(f, 'utf8')
    for (const hook of HOOKS) {
      const re = new RegExp(`\\b${hook}\\s*\\(`, 'g')
      let m
      while ((m = re.exec(src))) {
        let i = m.index + m[0].length, depth = 1
        while (i < src.length && depth > 0) {
          if (src[i] === '(') depth++
          else if (src[i] === ')') depth--
          i++
        }
        const args = src.slice(m.index, i)
        if (/\blimit\b/.test(args) || /\bids\b/.test(args)) continue
        n++
        if (sampleOut && sampleOut.length < 5)
          sampleOut.push(`${f.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
  }
  return n
}

// Đếm cặp `X_COLS` (mảng cột) ↔ `X_COL_DEFAULTS` (mảng độ rộng) LỆCH SỐ PHẦN TỬ.
// Bảng Manhattan dùng <colgroup> + table-fixed: thiếu 1 số thì MỌI cột từ đó trở đi ăn nhầm độ rộng
// của cột bên cạnh, cột cuối rộng `undefined` (bóp về 0) và totalWidth cộng thiếu → kéo giãn cột
// cuối ra NaN. Không có lỗi biên dịch, không có cảnh báo — chỉ nhìn mới thấy (bug thật 03/08: thêm
// cột "Cửa booking" mà quên thêm số). Đếm bằng cách so số phần tử, không heuristics mờ.
function countColWidthMismatch(roots, sampleOut) {
  let n = 0
  for (const root of roots) {
    for (const f of filesOf(root, ['.tsx', '.ts'])) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/const (\w+)_COLS\b[^=]*=\s*\[([\s\S]*?)\n\]/g)) {
        const cols = (m[2].match(/\bid:\s*['"]/g) ?? []).length
        if (!cols) continue
        const dm = src.match(new RegExp(`const ${m[1]}_COL_DEFAULTS\\s*=\\s*\\[([^\\]]*)\\]`))
        if (!dm) continue
        const widths = dm[1].split(',').map(x => x.trim()).filter(Boolean).length
        if (cols !== widths) {
          n++
          if (sampleOut && sampleOut.length < 5)
            sampleOut.push(`${f.slice(ROOT.length + 1)} — ${m[1]}_COLS có ${cols} cột nhưng ${m[1]}_COL_DEFAULTS có ${widths} số`)
        }
      }
    }
  }
  return n
}

// ── Các luật — mỗi luật là 1 phép đếm thuần văn bản, KHÔNG heuristics mờ (mờ = báo oan = bị tắt) ──
const RULES = [
  // `booked_count` là CACHE và DB KHÔNG có trigger nào — xoá dòng xe mà quên `recount_slot` là khung
  // giờ kẹt "Đầy" vĩnh viễn (đo thật 04/08). Mọi chỗ xoá mới PHẢI đi qua `deleteVehicleSlotsAndRecount`.
  // Baseline = 2: bookingGuards (chính helper) + vehicleSlotController.deleteVehicleSlot (đã recount tại chỗ).
  {
    key: 'vslot_delete_without_recount',
    label: 'xoá TmsVehicleSlot trực tiếp — phải dùng deleteVehicleSlotsAndRecount (không đếm lại = khung giờ kẹt "Đầy")',
    count: (s) => countMatches(['backend/src'], ['.ts'],
      l => /from\('TmsVehicleSlot'\)[\s\S]*\.delete\(/.test(l), s),
  },
  {
    key: 'col_defaults_length_mismatch',
    label: 'mảng cột và mảng độ rộng LỆCH số phần tử — cột lệch nhãn + cột cuối bóp về 0 (thêm cột phải thêm số)',
    count: (s) => countColWidthMismatch(['frontend/src'], s),
  },
  // Ngày xuất của chuyến SAP là dữ liệu BỊ ĐỘNG (user chốt 02/08): ô tích "chuyển ngày hàng loạt"
  // trên list Xuất phải loại chuyến SAP NGAY TỪ FE (BE đã chặn 422, nhưng để user tick rồi mới
  // báo lỗi là trải nghiệm sai). Quay lại `gdo.status === 'PENDING'` trần = mở lại cửa đó.
  {
    key: 'outbound_movedate_checkbox_ignores_origin',
    label: 'ô tích Chuyển ngày (list Xuất) bỏ qua origin — phải dùng canMoveDateOf để loại chuyến SAP',
    count: (s) => countMatches(['frontend/src/pages/wms/Outbound.tsx'], ['.tsx'],
      l => /checkable=\{canEditGdo && gdo\.status === 'PENDING'\}/.test(l), s),
  },
  // Kế hoạch xuất bị xóa ⇒ chuyến NGỪNG HOẠT ĐỘNG, KHÔNG xóa (user chốt 03/08: "chuyến hàng đó bên
  // Xuất sẽ không bị xóa mà vào trạng thái không hoạt động, chỉ xem được info — từ đó xem được lịch sử").
  // Nhánh emptyGcs của replanKhvcGroups từng DELETE thẳng GroupDeliveryOrder; quay lại là mất vết vĩnh viễn.
  {
    key: 'replan_hard_deletes_gdo',
    label: 'replan XÓA CỨNG chuyến khi kế hoạch hết dòng — phải đánh dấu plan_dropped (giữ chuyến để tra lịch sử)',
    count: (s) => countMatches(['backend/src/controllers/wms/outboundController.ts'], ['.ts'],
      l => /from\('GroupDeliveryOrder'\)\s*\.delete\(\)\s*\.eq\('id', g\.id\)/.test(l), s),
  },
  {
    key: 'as_any',
    label: '`as any` (BE+FE) — nợ cũ dọn dần khi đụng file, code MỚI cấm (CLAUDE.md)',
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'], l => l.includes('as any'), s),
  },
  {
    key: 'split_comma_controllers',
    label: "tự `.split(',')` trong controller — phải dùng parseListParam (utils/httpQuery); bug 29/07: `?codes=` rỗng dump cả danh mục 2,5MB",
    count: (s) => countMatches(['backend/src/controllers'], ['.ts'], l => l.includes(".split(',')") && !l.includes('parseListParam'), s),
  },
  {
    key: 'tolocaledatestring_no_tz',
    label: 'toLocaleDateString thiếu timeZone — ngày lệch theo giờ MÁY, phải Asia/Ho_Chi_Minh (CLAUDE.md)',
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'], l => l.includes('toLocaleDateString(') && !l.includes('timeZone'), s),
  },
  {
    key: 'band_label_thung_ton',
    label: `nhãn ô tổng cross-mã ghi "Thùng tồn"/"Tổng thùng" — phải QTY_CONVERTED_LABEL "SL (quy đổi)". Baseline 2 = cột per-MÃ ở OutboundDetail/LoosePickingDetail (tách Thùng/Hộp đúng luật base-unit, KHÔNG phải bug — đừng "dọn")`,
    count: (s) => countMatches(['frontend/src'], ['.tsx'], l => /label:\s*['"](Thùng tồn|Tổng thùng)['"]/.test(l), s),
  },
  {
    key: 'thung_unit_on_aggregate_pages',
    label: 'nhãn đơn vị "thùng" trên TRANG TỔNG GỘP CROSS-MÃ (Dashboard/Giám sát vận hành/Báo cáo nhập/Slotting) — ' +
           'ô & cột ở đây cộng cả mã KG/cái nên KHÔNG được gọi là "thùng" (bug 29/07: khối "Hàng nhập theo mã" ' +
           'hiện 2.816.800 "thùng" cho 22 pallet — thực chất là CÁI). Dùng QTY_CONVERTED_LABEL / in ĐVT theo dòng',
    count: (s) => countMatches(
      ['frontend/src/pages/Dashboard.tsx', 'frontend/src/pages/wms/ControlTower.tsx',
       'frontend/src/pages/tms/TMSReport.tsx', 'frontend/src/pages/wms/Slotting.tsx'],
      [''],   // đường dẫn FILE (không phải thư mục) — walk() nhận qua exts rỗng khớp mọi tên
      l => /\((thùng|Thùng)\)|>\s*Thùng\s*<|['"]Thùng['"]\s*[,:\]]|\{['"]Thùng['"]\}/.test(l), s),
  },
  {
    key: 'gdo_category_exact_match',
    label: 'so khớp NGUYÊN CHUỖI Loại kho của CHUYẾN (GroupDeliveryOrder) trong migration — chuyến chở lẫn ' +
           'lưu "FG01+PM01" nên `g.warehouse_type = ANY(...)` ẨN MẤT chuyến với mọi user có scope loại ' +
           '(bug 30/07: 67/122 chuyến biến mất). RPC mới phải dùng `wt_cats(g.warehouse_type) && mảng`. ' +
           'Baseline = số lần còn trong các migration CŨ (file lịch sử, không sửa) — chỉ cấm TĂNG',
    count: (s) => countMatches(['backend/migrations'], ['.sql'],
      l => /\b(g|gd)\.warehouse_type\s*=\s*any\s*\(/i.test(l), s),
  },
  // Bản TypeScript của CÙNG lớp lỗi trên: cắt list bằng `warehouse_type.in.(...)` của PostgREST cũng
  // là so khớp NGUYÊN CHUỖI. Vá cho GroupDeliveryOrder 30/07 nhưng TÁI SINH ở TmsOrder khi lệnh VC
  // tự sinh (03/08) sao chép chuỗi ghép từ chuyến — đo staging 04/08: user scope FG01 thấy 50/117
  // lệnh, scope PM01 thấy 1/68. Cách đúng: `categoryTextOrScopeFilter()` (utils/categoryScope).
  {
    key: 'category_text_exact_match_ts',
    label: 'cắt list theo Loại kho bằng `warehouse_type.in.(...)` — cột này có thể là CHUỖI GHÉP ' +
           '("FG01+PM01") nên so khớp nguyên chuỗi ẨN MẤT bản ghi chở lẫn với mọi user có scope loại. ' +
           'Dùng `categoryTextOrScopeFilter(col, scope)` (giao ≥1, null-inclusive)',
    count: (s) => countMatches(['backend/src'], ['.ts'],
      l => /warehouse_type\.in\.\(/.test(l), s),
  },
  // Danh sách field LƯU bị dùng luôn làm danh sách CỘT render: thêm 1 field cấp-xe vào mảng là
  // lặng lẽ đẻ thêm 1 <input> cho MỖI DÒNG mà hàng <th> không có cột tương ứng ⇒ lệch cột + có ô
  // nhập cho thứ đáng lẽ 1 xe 1 giá trị + khối dán Excel lệch 1 cột. Đã xảy ra thật với
  // `booking_category` (bắt bằng Playwright 04/08). Ô nhập theo dòng phải lấy từ KHVC_ROW_FIELDS.
  {
    key: 'khvc_save_fields_used_as_columns',
    label: 'KHVC_FIELDS (danh sách field LƯU) bị dùng để render cột/dán Excel — phải dùng KHVC_ROW_FIELDS',
    count: (s) => countMatches(['frontend/src/pages/external'], ['.tsx'],
      l => /KHVC_FIELDS\.map\(|KHVC_FIELDS\[/.test(l), s),
  },
  // Lý do chuyến KHÔNG thao tác được phải hiện trên MỌI cỡ màn. Công nhân dùng điện thoại/PDA là
  // chính; khối `orderInfoJSX` của trang chi tiết Xuất chỉ hiện từ `sm:` trở lên, nên nhét banner
  // giải thích vào đó = trên điện thoại chỉ thấy nút mờ, không biết vì sao (đã sửa 02/08 cho rule
  // cổng/cân, tái phạm 03/08 với banner "chờ dữ liệu SAP" — bắt ở đợt kiểm vòng 2).
  {
    key: 'inert_banner_desktop_only',
    label: 'banner lý do chuyến bất động nằm trong khối chỉ-hiện-desktop (orderInfoJSX) — mobile mất lý do',
    count: (s) => countInertBannerInDesktopOnly(s),
  },
  // Ô TÌM CHẾT: khai state `search` trong store + viết logic lọc nhưng QUÊN render `<SearchInput>`
  // → user không có chỗ gõ, filter vĩnh viễn rỗng, và lỗi này KHÔNG lộ ra ở tsc/build vì mọi biến
  // đều "được dùng". Bắt thật 03/08: tab Chuyển kho có tSearch + lọc mà không có ô input nào.
  {
    key: 'search_state_without_input',
    label: 'trang khai state tìm (const x = <filter>.search) nhiều hơn số ô <SearchInput> render — ô tìm chết, user không có chỗ gõ',
    count: (s) => countDeadSearchState(s),
  },
  // MÃ LOẠI KHO VIẾT CỨNG: taxonomy Loại kho là DỮ LIỆU (LookupValue, mỗi đơn vị mỗi bộ) — luật
  // multi-tenant trong CLAUDE.md: "hành vi mới theo loại = thêm key meta, KHÔNG if tên loại".
  // Viết `=== 'FG01'` vào logic là khoá app vào 1 đơn vị. Bỏ qua dòng comment; baseline hiện tại là
  // dòng VÍ DỤ trong mẫu Excel tải về (dữ liệu mẫu, không phải logic).
  // Ô "Loại kho" lưới Kế hoạch VC phải nhắc `booking_category`: chuyến CHỜ dữ liệu SAP có
  // warehouse_type NULL (loại hàng suy từ mã hàng VL06O) nên ô sẽ TRỐNG TRƠN dù cửa đã khai ở kế
  // hoạch — đúng thứ trang booking cần (user báo 03/08 "loại kho lại k hiện lên trong booking tms").
  {
    key: 'tms_cargo_cell_ignores_booking_category',
    label: 'ô "Loại kho" lưới Kế hoạch VC KHÔNG dùng booking_category — chuyến chờ dữ liệu SAP sẽ hiện ô trống',
    count: (s) => countCargoCellWithoutDoor(s),
  },
  // FIXTURE QA TỰ HỎNG THEO GIỜ: khung giờ (DeliverySlot) tạo với `date: today` — app chặn đặt
  // khung ĐÃ QUA, nên chạy bộ QA vào cuối ngày là gói TỰ ĐỎ dù code không sai (đo 03/08 lúc 23:08:
  // gói 14 và 15 cùng đỏ vì khung 22:00/23:00 hôm nay). Cổng gác mà tự hỏng thì hoặc bị bỏ qua,
  // hoặc chặn oan — cả hai đều nguy hiểm hơn không có cổng. Fixture khung giờ phải đặt ở NGÀY MAI.
  // `.in(cột, <danh sách>)` KHÔNG qua helper phân trang: 1 khóa có thể khớp NHIỀU dòng nên tập 200
  // khóa đã cho >1.000 dòng → PostgREST cắt ÂM THẦM ở db-max-rows. Đây là lớp lỗi tái phát nhiều
  // nhất của dự án (chiến dịch 03/07 dọn ~40 chỗ, 03/08 vẫn đẻ chỗ mới). Chỉ đếm dạng RỦI RO:
  // tham số KHÔNG phải biến chunk (`chunk`/`c`) — tức không nằm trong callback của fetchAllByIdChunks.
  // Nợ cũ không chặn (baseline), nhưng code MỚI không được làm tăng.
  {
    key: 'unpaginated_in_query',
    label: '`.in()` với danh sách khóa mà KHÔNG qua fetchAllByIdChunks/fetchAllRowsParallel/limit — cap 1000 cắt âm thầm',
    count: (s) => countMatches(['backend/src'], ['.ts'],
      (line) => /\.in\('[^']+',\s*[A-Za-z_$][\w$.]*/.test(line)
        && !/\.in\('[^']+',\s*(chunk|c)\b/.test(line)
        && !/\.(limit|range|single|maybeSingle)\(/.test(line)
        && !/\.slice\(/.test(line)
        && !/^\s*(\/\/|\*)/.test(line), s),
  },
  {
    key: 'qa_slot_fixture_on_today',
    label: 'fixture QA tạo DeliverySlot với `date: today` — chạy cuối ngày sẽ tự đỏ ("khung giờ đã qua"), phải dùng ngày mai',
    count: (s) => countQaSlotFixtureOnToday(s),
  },
  {
    key: 'hardcoded_warehouse_type_code',
    label: 'mã Loại kho viết CỨNG trong code (FG0x/PM0x/RM0x/PK0x) — phải đọc từ danh mục LookupValue, không so tên loại',
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'],
      (line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /['"](FG0\d|PM0\d|RM0\d|PK0\d)['"]/.test(line), s),
  },
  // MOJIBAKE — tiếng Việt UTF-8 bị double-encode (bug thật 13/08 đêm: PowerShell 5.1 Get-Content
  // đọc file UTF-8 không BOM bằng codepage ANSI rồi ghi lại → 10 file nát font, tsc/build VẪN XANH
  // nên không tự lộ, user nhìn màn hình mới thấy). Dấu vết = 'á' theo sau bởi U+00BA/U+00BB
  // (byte 0xE1 0xBA/0xBB của khối chữ Việt bị đọc nhầm) — tiếng Việt thật KHÔNG BAO GIỜ có cặp này.
  // Pattern dựng bằng escape để chính file này không tự khớp. Rewrite text hàng loạt: dùng Node utf8.
  {
    key: 'mojibake_double_utf8',
    label: 'chuỗi mojibake (UTF-8 tiếng Việt bị đọc nhầm ANSI rồi ghi đè) — font nát mà build vẫn xanh',
    count: (s) => countMatches(['backend/src', 'frontend/src', 'scripts'], ['.ts', '.tsx', '.mjs'],
      (line) => new RegExp('á[º»]').test(line), s),
  },
  // SUPERADMIN = CỜ is_superadmin (cột Employee → JWT, migration 20260813f) — audit hardcode 13/08
  // dọn ~18 chỗ BE + FE isAdmin từng so TÊN 'Admin'/'ADMIN': đổi tên hiển thị tài khoản là mất quyền
  // âm thầm, và tên là dữ liệu người dùng sửa được — không bao giờ là căn cứ quyền. Baseline 0.
  // (employeeController còn 1 guard chặn ĐẶT TÊN tài khoản mới = 'Admin' — so biến trần, không khớp mẫu này.)
  {
    key: 'superadmin_by_name',
    label: "nhận diện superadmin bằng so TÊN (.name === 'Admin' / .employee_code === 'ADMIN' / name.eq.Admin) — phải đọc cờ is_superadmin",
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'],
      (line) => !/^\s*(\/\/|\*|\/\*)/.test(line)
        && /\.name\s*[!=]==\s*'Admin'|\.employee_code\s*[!=]==\s*'ADMIN'|name\.eq\.Admin/.test(line), s),
  },
  // Đổi VỊ TRÍ pallet phải đi qua RPC `move_pallets_to_location` — RPC khoá dòng Location rồi mới
  // đếm sức chứa DƯỚI LOCK. Ghi thẳng `location_id` bằng UPDATE là bỏ qua hàng rào đó: hai người
  // cùng dồn vào một ô 1 slot thì cả hai cùng "thành công", và tồn kho ghi 2 pallet ở chỗ chỉ chứa
  // được 1 — sai câm, chỉ ra kho mới biết. Luật này gác cả 3 đường đang ghi vị trí (slotting quét
  // thực hiện · leftover khi xuất · fill hàng). Baseline = số chỗ ghi hợp lệ hiện có (RPC + seed).
  {
    key: 'location_write_without_move_rpc',
    label: 'ghi thẳng location_id vào InventoryEntry — phải qua RPC move_pallets_to_location (khoá sức chứa dưới lock)',
    count: (s) => countMatches(['backend/src'], ['.ts'],
      (line) => /\.update\(\s*\{[^}]*\blocation_id\s*:/.test(line) && !/^\s*(\/\/|\*)/.test(line), s),
  },
  {
    key: 'putaway_door_unreviewed',
    label: 'cửa ghi MỚI đặt pallet vào vị trí (gọi move_pallets_to_location) ngoài 4 cửa ĐÃ soi quy tắc cất hàng',
    // Bài học 15/08 (đợt D): đợt B gác luật cất hàng ở 4 cửa của Nhập kho rồi coi như xong, trong
    // khi "Chuyển vị trí hàng loạt" (Tồn kho) vẫn đẩy pallet vào ô CẤM NHẬN HÀNG mà không hỏi luật
    // câu nào — công tắc "bắt buộc" của kho chỉ gác được một nửa số cửa. Không mechanize được
    // "đã liệt kê đủ cửa chưa", nhưng mechanize được "có cửa THỨ 5 xuất hiện":
    //   • inventoryController  — Chuyển vị trí hàng loạt: CÓ gác (guardPutawayBatch)
    //   • outboundController   — chỗ đặt phần dư khi quét xuất: CÓ gác từ 18/08 (guardPutaway).
    //     Mang phần dư sang ô KHÁC là một lần cất hàng thật. Ngõ cụt tránh bằng cách khác: "Giữ
    //     chỗ cũ" KHÔNG bị chấm, nên người quét luôn còn một lối lưu được lượt quét.
    //   • slottingController   — quét thực hiện kế hoạch: đích do engine chọn, đã loại slot_no_in
    //   • fillController       — đích BẮT BUỘC là vị trí nhặt lẻ ⇒ luật block_pick_face mà áp vào
    //     đây thì tự chặn chính mình; Fill có validate riêng
    // Thêm cửa mới = phải trả lời câu hỏi đó rồi mới thêm file vào danh sách. Baseline 0.
    count: (s) => countMatches(['backend/src'], ['.ts'],
      (line, file) => !/^\s*(\/\/|\*|\/\*)/.test(line)
        && /rpc\(\s*['"]move_pallets_to_location['"]/.test(line)
        && !/(inventoryController|outboundController|slottingController|fillController)\.ts$/.test(file), s),
  },
  // Overlay quét KEEP-MOUNTED (ẩn bằng CSS `${open ? '' : 'hidden'}`) mà <QRScanner> không truyền
  // `active={open}` = camera CHẠY NGẦM sau khi user đóng (đèn camera sáng, tốn pin, lo ngại riêng
  // tư — user bắt 05/08 ở màn quét Fill). Màn quét unmount khi đóng thì không cần active.
  {
    key: 'qrscanner_keepmounted_without_active',
    label: 'overlay quét ẩn bằng CSS nhưng <QRScanner> thiếu `active` — camera chạy ngầm sau khi đóng',
    count: (s) => countKeepMountedScannerWithoutActive(s),
  },
  // `relative` đặt THẲNG lên <TableHead> đè mất `sticky top-0 z-10` của base (tailwind-merge giữ
  // class position CUỐI) → header hết freeze khi cuộn — bẫy đã ghi memory sticky-header-relative-trap
  // mà các module mới 04–06/08 vẫn đẻ 7 chỗ (Alerts/Fill×4/StocktakeCycle/TMSBookings — user bắt
  // 10/08). Tay kéo cột KHÔNG cần relative: th sticky tự là containing block cho span absolute
  // (mẫu đúng: Inbound đặt trần, Slotting bọc <span className="relative"> bên trong).
  {
    key: 'tablehead_relative_kills_sticky',
    label: 'class `relative` trên <TableHead> — đè mất sticky top-0 của base, header hết freeze khi cuộn (relative đặt vào span con)',
    count: (s) => countTableHeadRelative(s),
  },
  // Component con khai TRONG body component cha (`function Tab(){ const Field = (...) => (...) }`)
  // là TYPE MỚI mỗi lần render → React unmount/remount cả cụm. Cụm chỉ hiển thị thì vô hại, nhưng
  // cụm có Ô NHẬP thì gõ 1 ký tự là focus văng về <body>, ký tự thứ 2 rơi mất — không lỗi biên dịch,
  // không cảnh báo, tsc/build đều xanh (bug thật 13/08 ở tab Hệ thống: đo trên Preview
  // document.activeElement = BODY ngay sau ký tự đầu). Cách đúng: đưa ra module-level và truyền props
  // (mẫu: components/shared/SettingsForm.tsx). Baseline 0 — luật chỉ đếm ca CÓ ô nhập.
  // Quyết định HÀNH VI bằng cách so TÊN danh mục tiếng Việt ('Lái xe', 'Đơn vị vận tải'): đổi tên
  // chức danh/phòng ban là việc quản trị hoàn toàn hợp lệ, nhưng luồng gán xe / màn hình tài xế
  // biến mất ÂM THẦM — không lỗi, không cảnh báo. Nay đọc CỜ danh mục (JobTitle.is_driver ·
  // Department.is_carrier, migration 20260814_role_flags). Baseline 0.
  {
    key: 'role_by_vietnamese_name',
    label: "quyết định vai trò bằng so TÊN tiếng Việt ('Lái xe' / 'Đơn vị vận tải') — phải đọc cờ is_driver / is_carrier",
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'],
      (line) => !/^\s*(\/\/|\*|\/\*)/.test(line)
        && /[=!]==\s*'(Lái xe|Đơn vị vận tải)'|'(Lái xe|Đơn vị vận tải)'\s*===/.test(line), s),
  },
  {
    key: 'rotation_rule_hand_rolled',
    label: 'tự so ngày để đoán "pallet nào nên lấy trước" — phải đi qua utils/rotation (BE) / khối `rotation` do BE trả (FE)',
    // Bug thật 14/08: luật này từng có 4 BẢN chép tay (cột "Vị trí lấy" sắp theo %Date · 3 màn quét
    // so production_date) nên gợi ý và cảnh báo chỉ vào 2 pallet khác nhau. Bắt đúng mẫu so-sánh
    // giữa 2 mốc ngày của tồn kho; file utils/rotation.ts được miễn (nó LÀ luật).
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'],
      (line) => !/^\s*(\/\/|\*|\/\*)/.test(line)
        && /\b(production_date|expiry_date)\b\s*[<>]=?\s*\w*\.?\b(best_available_date|production_date|expiry_date)\b/.test(line), s),
    // Baseline 1 = phép so DUY NHẤT còn được phép: nhánh đọc dữ liệu LỊCH SỬ trước 14/08 trong
    // frontend/src/utils/rotation.ts (dòng cũ không có cột rotation_*). Code mới không được tăng.
  },
  {
    key: 'putaway_rule_hand_rolled',
    label: 'tự đoán "cất pallet vào ô nào" (has_same_material / slot_no_in / so sức chứa để gợi ý) — phải đi qua utils/putaway (BE) / khối `putaway` do BE trả (FE)',
    // Cùng họ bug với rotation_rule_hand_rolled, đo 15/08: luật ★ có 3 bản chép tay (BE
    // sameMaterialLocIds · Inbound.tsx isRecommended · InboundDetail.tsx locRec) và màn quét PDA
    // thì KHÔNG hiển thị gì, còn cờ Location.slot_no_in ("cấm đưa hàng vào") chỉ Slotting đọc —
    // luồng nhập vẫn gợi ý cất vào đúng ô bị cấm. Bắt việc ĐỌC has_same_material/slot_no_in ngoài
    // 2 file luật (utils/putaway.ts BE+FE, services/putawayContext.ts) để chấm ★/chặn.
    // Bắt việc ĐỌC cờ (`x.has_same_material` / `x.slot_no_in`) để tự kết luận — khai báo kiểu,
    // danh sách cột, `useLocationsByFlag('slot_no_in')`, `.eq('slot_no_in', …)` và phép GÁN đều
    // không tính. Miễn 5 file: 2 file luật, putawayContext (đường nạp chung), slottingController
    // + locationController (nơi DUY NHẤT dựng PutawayLoc rồi gọi luật), và trang danh mục
    // pages/wms/Locations.tsx (17/08 — nơi KHAI/HIỂN THỊ cờ: cột bảng, pane, form sửa, export;
    // đọc cờ để in ra chứ không đoán "cất vào đâu"). Baseline 0.
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'],
      (line, file) => !/^\s*(\/\/|\*|\/\*)/.test(line)
        && !/utils[\\/]putaway\.ts$|services[\\/]putawayContext\.ts$|slottingController\.ts$|locationController\.ts$|pages[\\/]wms[\\/]Locations\.tsx$/.test(file)
        && /\.\s*(has_same_material|slot_no_in)\b(?!\s*=[^=])/.test(line), s),
  },
  {
    key: 'n_plus_1_supabase_in_map',
    label: 'gọi supabase TRONG .map(async …) không chia lô = N+1 round-trip (pool PostgREST ~10 khe → nghẽn cả app)',
    count: (s) => countNPlus1SupabaseInMap(s),
  },
  {
    key: 'today_frozen_at_import',
    label: 'NGÀY HÔM NAY chốt bằng hằng module (tính 1 lần lúc mở app) — PDA/màn kho mở qua đêm sẽ dùng ngày HÔM QUA (min= chặn oan, filter "Hôm nay" sai). Khai dạng HÀM: const TODAY = () => …',
    // CHỈ bắt khai báo CẤP MODULE (không thụt lề) — khai trong thân component thì mỗi lần render
    // tính lại, hoàn toàn đúng; bắt luôn cả hai là báo oan, mà báo oan thì cổng sẽ bị bỏ qua.
    count: (s) => countMatches(['frontend/src'], ['.ts', '.tsx'],
      (line) => /^const\s+\w*(TODAY|Today)\w*\s*(:[^=]+)?=\s*new Date\(\)/.test(line), s),
  },
  // "Mọi view mới phải có mặt trong phân quyền" (user chốt 19/08): route trang mới trong App.tsx
  // PHẢI bọc PermissionRoute/ExternalRoute/DashboardRoute. Baseline 3 = 3 route MỞ CHỦ ĐÍCH:
  // /wms/alerts (tab Cá nhân = feed của mình) · /settings (tài khoản cá nhân) · /wms/multi-scan
  // (trang test). Thêm route KHÔNG gate mới → tăng số → CI đỏ, buộc khai quyền đủ 5 việc.
  {
    key: 'route_without_permission',
    label: 'route trang trong App.tsx KHÔNG bọc PermissionRoute — view mới phải được phân quyền (3 route mở là chủ đích)',
    count: (s) => countMatches(['frontend/src/App.tsx'], ['.tsx'],
      l => /<Route path=/.test(l) && /element=\{/.test(l)
        && !/(PermissionRoute|ExternalRoute|DashboardRoute|<Login|Navigate)/.test(l), s),
  },
  // Tập mã camera đọc được khai MỘT CHỖ (utils/scanEngine). Khai literal ở màn quét mới = màn đó
  // lệch với luồng thật (21/08: cả app từng chỉ khai QR nên mã vạch 1D bị bỏ qua ÂM THẦM).
  {
    key: 'scan_formats_declared_outside_engine',
    label: 'khai formats quét bằng literal ngoài utils/scanEngine.ts — dùng NATIVE_FORMATS/ZXING_FORMATS thay vì chép danh sách',
    count: (s) => countMatches(['frontend/src'], ['.ts', '.tsx'],
      (line, file) => /formats:\s*\[\s*'/.test(line) && !file.endsWith('scanEngine.ts'), s),
  },
  // Tablist cuộn ngang + justify-center = TAB ĐẦU KHÔNG BẤM ĐƯỢC trên phone (đo 21/08: Cài đặt WMS
  // 390px, scrollLeft đã 0 mà tab "Kho"/"Loại kho" vẫn ở x âm ⇒ không cuộn tới). Lỗi chỉ hiện khi
  // số tab đủ nhiều nên rất dễ tái sinh lúc thêm tab.
  {
    key: 'tablist_center_blocks_scroll',
    label: 'TabsList căn giữa (justify-center) — tablist tràn thì tab ĐẦU nằm ngoài vùng cuộn, phone không bấm được (dùng justify-start)',
    count: (s) => countMatches(['frontend/src/components/ui/tabs.tsx'], ['.tsx'],
      l => /justify-center/.test(l) && /inline-flex h-10/.test(l), s),
  },
  {
    key: 'component_defined_inside_component',
    label: 'component con có Ô NHẬP khai trong body component cha — remount mỗi lần state đổi, ô mất focus sau 1 ký tự (đưa ra module-level)',
    count: (s) => countInnerComponentWithInput(s),
  },
  {
    key: 'catalogue_full_load',
    label: 'ô chọn nạp CẢ DANH MỤC về trình duyệt (useLocationsReal/useMaterials thiếu `limit`) — ' +
           'đo 15/08: 1 kho 1.517 vị trí = 616KB + hàng chục round-trip MỖI LẦN mở màn; phải `search` + `limit: 50` ' +
           '(+ hook by-ids giữ nhãn giá trị đang chọn). Chỉ trang CẤU HÌNH/danh mục gốc mới được lấy cả danh sách',
    count: (s) => countCatalogueFullLoad(s),
  },
  {
    key: 'upload_without_preflight',
    label: 'route upload file KHÔNG có "kiểm trước khi ghi" — mọi upload phải chèn `isPreflight(req)` giữa pha kiểm và pha ghi ' +
           '(utils/uploadPreflight; chuẩn user chốt 29/07: xem vấn đề của file + bấm Xác nhận mới ghi)',
    count: (s) => countUploadsMissingPreflight(s),
  },
]

// Khai báo component trong body hàm khác = dòng thụt lề ≥2 space, `const <TênHoa> = (`. Chỉ tính vi
// phạm khi thân nó (≤16 dòng đầu) có ô nhập — đó là ca làm mất focus. Cụm thuần hiển thị (Tile/Row/
// Info) không đếm: remount vô hại, ép sửa chỉ tạo churn.
function countInnerComponentWithInput(sampleOut) {
  let n = 0
  for (const f of filesOf('frontend/src', ['.tsx'])) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!/^\s{2,}(const [A-Z][A-Za-z0-9]*\s*=\s*\(|function [A-Z][A-Za-z0-9]*\s*\()/.test(line)) return
      const body = lines.slice(i, i + 16).join('\n')
      if (!/<Input\b|<input\b|<textarea\b|<Textarea\b|onChange=/.test(body)) return
      n++
      if (sampleOut && sampleOut.length < 5) sampleOut.push(`${f.slice(ROOT.length + 1)}:${i + 1}`)
    })
  }
  return n
}

// Đếm số lần `inertReason` xuất hiện BÊN TRONG khai báo `const orderInfoJSX = (…)` của trang chi
// tiết Xuất (khối đó bọc `hidden sm:block` nên mobile không thấy). Banner phải render ngoài khối.
function countInertBannerInDesktopOnly(sampleOut) {
  const f = 'frontend/src/pages/wms/OutboundDetail.tsx'
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { return 0 }
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex(l => /const orderInfoJSX\s*=\s*\(/.test(l))
  if (start < 0) return 0
  let n = 0
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{0,2}\)\s*$/.test(lines[i])) break            // hết khối JSX
    if (lines[i].includes('inertReason')) {
      n++
      if (sampleOut && sampleOut.length < 5) sampleOut.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 100)}`)
    }
  }
  return n
}

// Mỗi khối tạo DeliverySlot trong bộ QA: quét 8 dòng sau đó, gặp `date: today` = vi phạm.
function countQaSlotFixtureOnToday(sampleOut) {
  let n = 0
  for (const f of filesOf('scripts/qa', ['.mjs'])) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!/'DeliverySlot'\s*,\s*'POST'/.test(line)) return
      const vung = lines.slice(i, i + 8).join('\n')
      if (/\bdate:\s*today\b/.test(vung)) {
        n++
        if (sampleOut && sampleOut.length < 5) sampleOut.push(`${f.slice(ROOT.length + 1)}:${i + 1}`)
      }
    })
  }
  return n
}

// Từ dòng đánh dấu ô "Loại kho" của lưới Kế hoạch VC, quét 30 dòng tiếp: phải có booking_category.
// 1 = vi phạm (ô sẽ trống với chuyến chờ dữ liệu SAP), 0 = đạt.
function countCargoCellWithoutDoor(sampleOut) {
  const f = 'frontend/src/pages/tms/TMSBookings.tsx'
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { return 0 }
  const lines = src.split(/\r?\n/)
  const at = lines.findIndex(l => /\{\/\* Loại kho — merge qua tất cả rows/.test(l))
  if (at < 0) return 0                       // đổi cấu trúc thì luật này không còn neo được
  const vung = lines.slice(at, at + 30).join('\n')
  if (vung.includes('booking_category')) return 0
  sampleOut?.push(`${f}:${at + 1}: ô Loại kho không tham chiếu booking_category`)
  return 1
}

// Mỗi state tìm lấy từ filter store (`const search = tf.search`) phải có 1 ô `<SearchInput` tương
// ứng trong CÙNG file. Thiếu = ô tìm chết (state + logic lọc có, chỗ gõ không có).
function countDeadSearchState(sampleOut) {
  let miss = 0
  for (const f of filesOf('frontend/src/pages', ['.tsx'])) {
    const src = readFileSync(f, 'utf8')
    const declared = [...src.matchAll(/const\s+\w+\s*=\s*\w+\.search\b/g)].length
    if (!declared) continue
    const rendered = [...src.matchAll(/<SearchInput\b/g)].length
    if (rendered < declared) {
      miss += declared - rendered
      if (sampleOut && sampleOut.length < 5)
        sampleOut.push(`${f.slice(ROOT.length + 1)} — khai ${declared} state tìm nhưng chỉ render ${rendered} ô SearchInput`)
    }
  }
  return miss
}

// File có overlay ẩn-bằng-CSS (`${open ? '' : 'hidden'}`) thì mọi thẻ <QRScanner …> trong file
// phải mang prop `active` (thường active={open}) — thiếu = camera vẫn giữ stream khi overlay đóng.
// N+1 PostgREST: `.map(async …)` mà trong thân có gọi supabase và KHÔNG chia lô.
// Gốc rễ (đo 14/08): gợi ý vị trí nhập chạy 1 truy vấn / 1 VỊ TRÍ — kho Bàu Bàng 1.517 vị trí =
// 1.517 request mỗi lần tạo phiếu nhập, trong khi pool PostgREST chỉ ~10 khe ⇒ nghẽn CẢ APP.
// Loại lỗi này KHÔNG có triệu chứng trên màn hình (không lỗi, không cảnh báo) nên sống sót rất lâu.
// Chia lô (`.slice(i, i + N)`) thì không tính — đó là cách xử ĐÚNG khi buộc phải gọi từng dòng.
function countNPlus1SupabaseInMap(sampleOut) {
  let n = 0
  for (const f of filesOf('backend/src', ['.ts'])) {
    const src = readFileSync(f, 'utf8')
    const lines = src.split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!/\.map\(\s*async\b/.test(line)) return
      // Đã chia lô — trên chính dòng đó (`arr.slice(i, i+8).map(async …)`) hoặc ở dòng ngay trên
      // (`const batch = arr.slice(i, i+8)` rồi `batch.map(async …)`). Chia lô là cách xử ĐÚNG khi
      // buộc phải gọi từng dòng, không tính là vi phạm.
      if (/\.slice\(/.test(line) || /\.slice\(/.test(lines[i - 1] ?? '')) return
      const body = lines.slice(i, i + 12).join('\n')        // thân callback (đủ để thấy lời gọi)
      if (!/\bsupabase\s*\.\s*(from|rpc)\b/.test(body)) return
      n++
      if (sampleOut && sampleOut.length < 5) sampleOut.push(`${f.slice(ROOT.length + 1)}:${i + 1}`)
    })
  }
  return n
}

function countKeepMountedScannerWithoutActive(sampleOut) {
  let n = 0
  for (const f of filesOf('frontend/src', ['.tsx'])) {
    const src = readFileSync(f, 'utf8')
    if (!src.includes("? '' : 'hidden'")) continue
    for (const m of src.matchAll(/<QRScanner\b[^>]*>/g)) {
      if (!/\bactive=/.test(m[0])) {
        n++
        if (sampleOut && sampleOut.length < 5)
          sampleOut.push(`${f.slice(ROOT.length + 1)} — <QRScanner> trong overlay keep-mounted thiếu active=`)
      }
    }
  }
  return n
}

// Bắt className của <TableHead> (kể cả xuống dòng) chứa từ `relative` — position class truyền vào
// đè `sticky` của base qua tailwind-merge nên header không còn dính khi cuộn.
function countTableHeadRelative(sampleOut) {
  let n = 0
  for (const f of filesOf('frontend/src', ['.tsx'])) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/<TableHead\b[\s\S]{0,200}?className=\{?[`"]([^`"]*)[`"]/g)) {
      if (/\brelative\b/.test(m[1])) {
        n++
        if (sampleOut && sampleOut.length < 5)
          sampleOut.push(`${f.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
  }
  return n
}

// Soi TỪNG route `upload.single('file'), <ns>.<fn>` → mở controller của <ns> → thân hàm <fn> có
// `isPreflight` không. Bắt được cả upload MỚI thêm sau này (không phải danh sách cứng).
function countUploadsMissingPreflight(sampleOut) {
  let miss = 0
  for (const routeFile of ['backend/src/routes/wms.ts', 'backend/src/routes/masterdata.ts', 'backend/src/routes/tms.ts', 'backend/src/routes/hr.ts']) {
    let src
    try { src = readFileSync(join(ROOT, routeFile), 'utf8') } catch { continue }
    // \s+ chứ không phải 1 space: masterdata.ts canh cột import bằng nhiều space
    const imports = new Map([...src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'/g)].map(m => [m[1], m[2]]))
    for (const m of src.matchAll(/upload\.single\('file'\),\s*(\w+)\.(\w+)/g)) {
      const [, ns, fn] = m
      const rel = imports.get(ns)
      if (!rel) { miss++; sampleOut?.push(`${routeFile}: không tra được controller của "${ns}"`); continue }
      let ctrl
      try { ctrl = readFileSync(join(ROOT, 'backend/src/routes', rel + '.ts'), 'utf8') } catch { miss++; sampleOut?.push(`${routeFile}: không đọc được ${rel}`); continue }
      // thân hàm = từ "export async function fn(" tới "export " tiếp theo
      const start = ctrl.indexOf(`export async function ${fn}(`)
      if (start < 0) { miss++; sampleOut?.push(`${rel}: không thấy hàm ${fn}`); continue }
      const next = ctrl.indexOf('\nexport ', start + 10)
      const body = ctrl.slice(start, next < 0 ? undefined : next)
      // uploadKhvc gọi processVehicleGroups (hàm dùng chung) — nhánh preflight nằm ở đó, chấp nhận cả 2 dấu hiệu
      if (!/isPreflight\(/.test(body) && !/processVehicleGroups\(/.test(body)) {
        miss++
        if (sampleOut && sampleOut.length < 5) sampleOut.push(`${rel}.${fn} — thiếu isPreflight (route ${routeFile})`)
      }
    }
  }
  return miss
}

let baseline = {}
try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) } catch { /* lần đầu */ }

console.log('── GÓI STATIC-GATE (ratchet) ──')
let fail = 0
const next = {}
for (const r of RULES) {
  const samples = []
  const n = r.count(samples)
  next[r.key] = n
  const base = baseline[r.key]
  if (base === undefined) {
    console.log(`  🆕 ${r.key}: ${n} (chưa có baseline — sẽ ghi)`)
  } else if (n > base) {
    fail++
    console.log(`  ❌ ${r.key}: ${n} > baseline ${base} — CODE MỚI VI PHẠM: ${r.label}`)
    samples.forEach(x => console.log(`       ${x}`))
  } else if (n < base) {
    console.log(`  📉 ${r.key}: ${n} < baseline ${base} — đã dọn bớt, chạy --update-baseline để KHOÁ thành quả`)
  } else {
    console.log(`  ✅ ${r.key}: ${n} (= baseline)`)
  }
}

if (UPDATE || Object.keys(baseline).length === 0) {
  writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
  console.log(`  💾 đã ghi baseline: ${JSON.stringify(next)}`)
}

console.log(`\n[STATIC-GATE] ${fail === 0 ? 'XANH' : fail + ' luật ĐỎ'}`)
process.exitCode = fail ? 1 : 0
