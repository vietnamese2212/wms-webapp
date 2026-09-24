# Quy định date — đợt 2: mức theo (KHÁCH × LOẠI HÀNG), thêm kiểu "≥ số ngày"

> Tiếp nối [CUSTOMER_DATE_RULE_PLAN.md](CUSTOMER_DATE_RULE_PLAN.md) (đợt 1 ✅ 11/09). Đợt 1 cho mỗi khách **một** mức.
> Đo lại với user 11/09 cho thấy mức thuộc về **cặp (khách × loại hàng)** và không diễn đạt được bằng phần trăm.
> **Trạng thái: ✅ ĐÃ THỰC THI XONG 11/09/2026** — dev `acd0a512` → `08bca5aa`.
> Migration áp staging: `20260911c` (bảng mức + MIN_DAYS) · `d` (customer_page) · `e`+`g` (date_rule_lines v3) · `f` (khoảng hạn dùng theo loại).
> Đo: **QA 58 64/64** · 57 91/91 · 12 35/35 · 13 41 · 14 35 · 08 13/13 · 07 96/96 · 00 30/30 · `npm test` 66/66 ·
> tsc BE+FE + build FE xanh · cổng tĩnh XANH · Playwright 1280 + 360 (không tràn ngang, dòng đầu ở 330px).

---

## 0. Vì sao phải đổi — số đo, không phải cảm tính

| Đo trên staging 11/09 | Con số |
|---|---|
| Danh mục `Customer` đang có | **3 dòng**, cả 3 do gói QA tự tạo (chưa ai bấm "Nạp từ SAP") |
| Mã ship-to chờ nạp (RPC `customer_seed_candidates`) | **102** |
| Trong đó chính là kho đã có trong danh mục Kho | **44** (20 khớp mã · 24 khớp tên duy nhất) |
| Kho đang mang **2** mã ship-to | 5 (Phượng Hoàn `10000373`+`30000340`, TC, Phương Anh, An Sơn, Bluestar) |
| Danh mục Kho | 153 dòng, **149 là NPP**, 147 dòng `inventory_mode=NONE` |
| Khách được **cả Ba Vì lẫn Bàu Bàng** phục vụ (đơn thật, ngoài sổ nạp giả) | **29/74**, gánh 127/216 chuyến |
| `Warehouse.shipto_codes` đã khai | **0/153** |
| Hạn dùng **FG01** | 120–720 ngày · TB 248 (415 mã) |
| Hạn dùng **FG02** | **45–60 ngày** · TB 50 (32 mã) |
| Mã **PM01** khai hạn dùng | **0/888** |
| Dòng hàng không tính được %Date (đơn thật) | **181/1.601 = 11,3%** (106 PM01 + 75 FG01 chưa khai hạn dùng) |

**Kết luận rút ra từ bảng trên:**

1. **Không tách danh mục khách theo kho xuất.** 39% khách đã dùng chung hai kho; tách là nhân đôi một sự thật rồi chờ nó lệch. User xác nhận 11/09 không có ca "cùng khách, Ba Vì 60% mà Bàu Bàng 70%" — ngoại lệ (nếu có) xử bằng **chốt tay**, vốn là bậc 1 không bao giờ bị đè.
2. **Phần trăm không diễn đạt được yêu cầu theo ngày.** "Còn ≥35 ngày" = **77,8%** trên mã FG02 hạn 45 ngày, = **58,3%** trên mã hạn 60 ngày. Không có con số % nào phục vụ được cả nhóm. Tệ hơn: FG02 đi kênh NPP ăn mức chung ≥60% thì mã hạn 45 ngày chỉ cần còn **27 ngày** là qua — thiếu 8 ngày, **không ai thấy gì sai**.
3. **Mức khác nhau theo từng khách** (user 11/09): FG01 có khách 60 · 70 · 80 · 85 %; FG02 có khách 35 · 40 ngày. ⇒ một cột `date_rule` trên `Customer` không chứa nổi.

---

## 1. Cấu trúc dữ liệu — MỘT bảng mức dùng chung cho khách và kênh

```sql
CREATE TABLE public.date_rule_master (
  id          text PRIMARY KEY,
  scope       text NOT NULL CHECK (scope IN ('CUSTOMER','CHANNEL')),
  scope_key   text NOT NULL,        -- Customer.id  |  LookupValue.value của kênh
  category    text,                 -- FG01 · FG02 · …  |  NULL = mọi loại hàng còn lại
  rule        jsonb NOT NULL,
  note        text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text, updated_by text,
  CONSTRAINT date_rule_master_rule_ck CHECK (
    public.date_rule_valid(rule)
    AND (rule->>'kind') IN ('FEFO','MIN_PCT','MIN_DAYS')     -- KHÔNG nhận EXACT/SPLIT ở tầng master
  )
);
CREATE UNIQUE INDEX uq_date_rule_master ON public.date_rule_master (scope, scope_key, category) NULLS NOT DISTINCT;
```

**Vì sao một bảng, không phải hai chỗ:** khách và kênh mang **cùng một hình dạng sự thật**. Hai kho chứa = hai bộ kiểm tra hợp lệ = hai thành phần giao diện = đúng khuôn "luật chép tay, bản sau thiếu một nhánh" đã phải dọn 4 lần (BASE⇄thùng, luân chuyển 4 bản, %Date BE↔FE).

**`Customer.date_rule` BỎ** — không giữ song song. Giữ lại là đẻ ra câu hỏi "cột nói 60%, bảng nói 70%, cái nào thắng". Danh mục đang rỗng (3 dòng rác QA) ⇒ **không tốn một dòng dữ liệu nào để đổi**; để vài tuần nữa mới đổi thì phải gỡ ra khai lại.
`LookupValue.meta.date_rule` của kênh cũng chuyển sang bảng này (migration mang 1 dòng NPP ≥60%).

---

## 2. Kiểu quy tắc: thêm `MIN_DAYS`

| Kiểu | Nhãn trên màn | Ý nghĩa |
|---|---|---|
| `MIN_PCT` | **≥ % hạn dùng** | như cũ |
| `MIN_DAYS` | **≥ số ngày còn lại** | MỚI — `computeDaysLeft ≥ N` |
| `FEFO` | **Không đòi mốc — lấy theo thứ tự của kho (đang: FEFO)** | đổi NHÃN, xem §3 |
| `EXACT` · `SPLIT` | chỉ ở tầng khai từng dòng, không có ở master | |

**CHIA PHẦN THEO SỐ LƯỢNG nhận cả kiểu ngày** (user chốt 11/09): *"10 thùng date 40 ngày, 7 thùng date 35"* — và trộn được cả hai thước trên cùng một dòng (*5 thùng ≥ 70 % + 3 thùng ≥ 35 ngày*). Nền đã có sẵn: `SplitPart.kind` là `SimpleRuleKind` nên `MIN_DAYS` vào theo; `rulePartsOf` → `matchesRule` đo từng phần riêng. Việc phải làm nằm ở **giao diện**: ô chọn kiểu của TỪNG PHẦN phải có đủ ba lựa chọn, và `date_rule_valid()` đã nới cho `MIN_DAYS` trong `parts` (migration `20260911c`).

- `computeDaysLeft(entry, material, now)` đặt **cạnh `computePctDate`** trong `utils/shelfLife.ts`, BE + FE mirror, có `backend/tests/mirror/shelfLife.mirror.test.ts` gác. HSD hiệu lực = `expiry_date` tường minh (tem V2) → NSX + `resolveShelfLife`. **Dùng lại `effectiveExpiryMs` của rotation.ts hay tách?** → tách một hàm dùng chung, KHÔNG chép công thức lần thứ ba.
- `matchesRule` (`services/directedTasks.ts`) thêm đúng một nhánh. `checkDateRuleStock`, sinh việc, cảnh báo "chỉ đủ n/m" **tự chạy theo** vì đều gọi hàm này.
- `date_rule_valid()` nới cho `MIN_DAYS` ở cả mức trên cùng lẫn trong `parts` của SPLIT (migration thay hàm, IMMUTABLE nên phải `DROP … CASCADE`? → **không**: `CREATE OR REPLACE` giữ được vì chữ ký không đổi; CHECK cũ vẫn chạy hàm mới).

### FIFO / LIFO — KHÔNG thêm vào ô khai

`ROTATION_PRINCIPLES = ['FEFO','FIFO','LIFO']` **đã có** ở `utils/rotation.ts`, khai theo **kho** và theo **từng loại kho** (`warehouse_type_configs`), kèm cần gạt Bắt buộc + quyền `rotation_override` + mã lý do + ô đo % tuân thủ.

**Phát hiện 11/09 — nhãn "FEFO" trong ô chốt đang nói dối:** `matchesRule('FEFO')` chỉ trả `true` cho mọi pallet (= không đòi mốc); **thứ tự do kho quyết định** qua `rotationSortKey(c, mat, principle)` tại [directedTasks.ts:338](../../backend/src/services/directedTasks.ts#L338). Kho đặt LIFO thì dòng ghi "FEFO" sẽ được lấy **hàng mới trước**. Hôm nay 153/153 kho đều FEFO và chưa kho nào bật Bắt buộc nên chưa ai đau — bật một cái là sai ngay, sai không báo gì.

⇒ **Đổi nhãn cho đúng sự thật** + hiện nguyên tắc kho đang đặt ngay cạnh ô khai (chỉ-đọc, có đường dẫn sang form Kho). Thêm FIFO/LIFO vào `date_rule` là dựng nguồn thứ hai quyết định thứ tự, và khi kho khai LIFO còn dòng khai FIFO thì **không có ai xử**.

---

## 3. Thang ưu tiên mới

```
1. chốt tay (date_rule.source = MANUAL / thiếu khoá)        — không bao giờ bị đè
2. VL06O date_required > 0
3. kho có date_rule_policy = OFF                            → để trống
4. policy = NO_NOTE và dòng CÓ header text                  → để trống
5. mã KHÔNG khai hạn dùng (effShelfLife = 0)                → TỰ ĐẶT "không đòi mốc"  ← MỚI
6. date_rule_master  scope=CUSTOMER  category = loại của mã ← MỚI
7. date_rule_master  scope=CUSTOMER  category = NULL
8. date_rule_master  scope=CHANNEL   category = loại của mã ← MỚI
9. date_rule_master  scope=CHANNEL   category = NULL
10. để trống — KHÔNG ĐOÁN
```

Bậc 6–9 là **4 lần tra `Map`**, không thêm lượt hỏi máy chủ nào (`loadPolicyCtx` nạp trọn bảng master — vài trăm dòng).

**Bậc 5 — điều kiện là "mã này có ĐO ĐƯỢC date không", đọc từ dữ liệu:**

```ts
dateMeasurable = effShelfLife(mat, null) > 0  ||  labelFormat === 'semicolon'
```

⚠️ **Vế thứ hai lộ ra lúc viết phép kiểm mirror, không có trong bản plan đầu.** Phép kiểm mới đỏ ngay lần chạy đầu (seed 20260911) ở ca: mã **chưa khai** `shelf_life_days`, pallet **thiếu NSX**, nhưng tem V2 mang **HSD tường minh** → `computeDaysLeft` ra số bình thường còn `computePctDate` trả `null` (không có mẫu số). Tức với đơn vị dùng tem `;`, **`MIN_DAYS` đo được ở chỗ `MIN_PCT` chịu thua** ⇒ miễn trừ theo mỗi `shelf_life_days` sẽ cắt oan cả một đơn vị. Staging hiện `label_format = underscore` nên vế này chưa đổi hành vi của LOF, nhưng thiếu nó là đặt sẵn một quả mìn cho đơn vị 2.

Quan hệ hai thước đo **không đối xứng** và đã khoá lại bằng phép kiểm: *không đo được NGÀY ⇒ chắc chắn không đo được %Date; chiều ngược lại KHÔNG đúng.*

**Cách đặt để không thành lỗ hổng** (user chốt 11/09): hệ thống tự đặt `{kind:'FEFO', source:'SYSTEM', reason:'NO_SHELF_LIFE'}`, hiện nguyên văn lý do "mã không khai hạn dùng", ghi `outbound_events`, **người sửa lại được**. Khác hẳn "bỏ qua âm thầm": dòng đó có giá trị nhìn thấy được và có vết. Ngày nào có người khai hạn dùng cho mã đó thì nó tự quay về diện phải khai — điều kiện đọc từ danh mục, không phải hằng số trong code.

**Cài đặt kho chỉ làm CHẶT hơn, không bao giờ nới:** policy = OFF thì dù khách đã khai đủ, dòng vẫn chưa có quy định → vẫn phải có người chốt. Và **nguyên tắc luân chuyển của kho KHÔNG lấp được chỗ trống**: nó xếp thứ tự giữa các pallet **đã đạt mốc**, không định ra mốc. Không có mốc = không có tập để xếp.

---

## 4. Cửa gác khi lấy hàng — mở rộng ngoài kho Hướng dẫn

User 11/09: *"trong phần Xuất (nhặt lẻ, xuất) nếu dòng nào ko khai thì dòng đó k thao tác đc"*.

Hiện `dateRuleGateError` chỉ chặn khi `work_mode === 'GUIDED'`. Mở rộng thành:

```
chặn khi:  work_mode = GUIDED   HOẶC   date_rule_policy ≠ OFF
```

**⚠️ Vì sao KHÔNG chặn vô điều kiện mọi kho:** cả 153 kho đang để `date_rule_policy = OFF` (mặc định đợt 1 — "áp tự động là đổi hành vi, không tự bật hộ ai"). Chặn vô điều kiện = **dừng xuất hàng toàn bộ 153 kho** ngay khi lên máy, vì không dòng nào được cấp mức. Buộc vào chính cờ chính sách thì ngữ nghĩa cũng liền mạch: *bật quy định date ở kho nào thì kho đó chạy theo quy định date*. Không đẻ thêm cần gạt (CLAUDE.md #2).

Đủ 5 cửa như hiện nay: `checkScanItem` · `scanItem` · quét nhặt lẻ · `confirmLoosePickingItem` · `manualCompleteItem`/`manualLooseItem`. Sửa GIẢM / hoàn vẫn cho qua (luật là "chưa khai thì chưa lấy", không phải "không sửa sai").

---

## 5. Đổi tên: **Chốt %Date → Quy định date**

| Chỗ | Cũ | Mới |
|---|---|---|
| Menu (`config/navigation.ts:67`) | Chốt %Date | **Quy định date** |
| Trang `pages/wms/DateRules.tsx` tiêu đề + nút | Chốt %Date | Quy định date |
| Cột trang chuyến / Nhặt lẻ | %Date lấy hàng | **Quy định date** |
| `SetDateRuleSheet` tiêu đề | Chốt %Date | Quy định date |
| Nhãn quyền `outbound.set_date` (FE + BE config) | Chốt %Date | Quy định date |
| Chữ trong `DirectedWork.tsx` (3 chỗ hướng dẫn) | chốt %Date | khai quy định date |
| `StrategyFields.tsx`, `WMSSettings.tsx` nhóm cài đặt | %Date | Quy định date |

13 file FE có chuỗi này (`dateRuleLabel|Chốt %Date|set_date`). Đường dẫn `/wms/outbound/date-rules` **giữ nguyên** (đổi URL làm hỏng link đã lưu, không đáng).

---

## 6. Màn hình

### 6.1 Khối khai mức — dùng chung form Khách hàng và tab Kênh

```
QUY ĐỊNH DATE                                          [+ Thêm dòng]
┌────────────────────────┬─────────────────────────┬──────────┬───┐
│ Loại hàng              │ Kiểu                    │ Giá trị  │   │
├────────────────────────┼─────────────────────────┼──────────┼───┤
│ Các loại còn lại     ▾ │ ≥ % hạn dùng          ▾ │    70 %  │ ✕ │
│ (FG01, PK01, RM01)     │                         │          │   │
│ FG02                 ▾ │ ≥ số ngày còn lại     ▾ │  35 ngày │ ✕ │
└────────────────────────┴─────────────────────────┴──────────┴───┘
  FG02: hạn dùng 45–60 ngày · 35 ngày ≈ 58–78% tuỳ mã
  PM01 — không khai hạn dùng, quy định date không áp
```

- **Nhãn dòng chung tính sống**: liệt kê đúng những loại **chưa** khai riêng. Khai thêm FG02 thì nhãn tự bớt FG02. Khai hết từng loại thì dòng chung **tự ẩn**.
- Danh sách loại lấy từ taxonomy Loại kho (`LookupValue.type='warehouse_type'`), cắt theo `allowed_categories` của người khai. Loại **không có mã nào khai hạn dùng** hiện **mờ** kèm chú giải — đọc từ dữ liệu (`COUNT(*) FILTER (WHERE shelf_life_days>0) GROUP BY category`, cache), **không phải danh sách cứng**.
- **Câu quy đổi sống** dưới bảng: gõ `≥60%` cho FG02 → *"≈ còn 27–36 ngày"*. Chính là cái bẫy suýt nuốt mất yêu cầu 35 ngày.
- Ô "Không đòi mốc" hiện kèm nguyên tắc luân chuyển kho đang đặt (chỉ-đọc).

### 6.2 Khai hàng loạt + Excel

- Danh sách khách: tick nhiều → **Đặt quy định date** (Loại hàng + Kiểu + Giá trị) → áp cả nhóm. Thành thao tác thứ 5 cạnh Phân kênh · Trỏ kho · Ngừng. Vẫn theo luật `ids` **HOẶC** `filter`.
- **Upload Excel** `Mã ship-to | Loại hàng | Kiểu | Giá trị`, 2 pha kiểm-trước. Tiền lệ: **Chi phí kho** — bản lưới 154×7 đã bị user bác 27/08, chốt "dạng kê khai/upload excel". Bài toán ở đây cùng hình dạng (102 khách × 2–3 loại, mỗi ô một số riêng).

### 6.3 Trang Quy định date

- **KHÔNG hiển thị dòng có mã không khai hạn dùng** (user chốt 11/09) — màn này chỉ để xử lý thứ CÓ đòi date. Lọc ngay trong RPC `outbound_date_rule_lines`, không lọc ở FE (kẻo phân trang đếm sai).
- Giữ **một ô band đếm** "Không có hạn dùng: n" để con số không biến mất khỏi sổ sách (không liệt kê mã).

> **ẨN KHỎI MÀN KHAI ≠ BIẾN MẤT KHỎI CÔNG VIỆC** (user hỏi thẳng 11/09). Đây chính là lý do bậc 5 **tự đặt "không đòi mốc"** thay vì để trống:
>
> | | Để trống (chưa khai) | Tự đặt "không đòi mốc" |
> |---|---|---|
> | Sinh việc lấy hàng | **không có việc nào** | sinh bình thường |
> | Cửa quét / nhặt lẻ | **bị chặn** | đi qua |
> | Thứ tự lấy | — | **theo quãng đường tới cửa** |
>
> Với dòng không đòi mốc, `rotationSortKey` trả `null` cho mọi pallet nên bậc 1 của [phép sắp](../../backend/src/services/directedTasks.ts#L341) hoà, thứ tự rơi thẳng xuống **khoảng cách BFS trên Sơ đồ kho** → tầng thấp (đỡ phải hạ) → ô ít hàng nhất (dọn hàng lẻ) → mã ô. Đúng thứ mong muốn: không có date để so thì tối ưu quãng đường.
>
> ⇒ Hàng POSM vẫn có mặt đầy đủ ở **Việc cần làm** (Cần hạ · Cần đưa ra · Sắp quét), ở **Nhặt lẻ** và ở chi tiết chuyến. Nó chỉ vắng mặt ở **màn khai**, vì ở đó không có gì để khai.
- Bộ lọc thêm: **Loại hàng** · **Kiểu quy định** (% / ngày / không đòi mốc / chưa khai). Giữ nguyên Nguồn · Ngày xuất · Kho · tìm.

### 6.4 Hai cột RIÊNG, mỗi dòng chỉ điền một (user chốt 11/09)

**Một dòng chỉ mang MỘT yêu cầu** — đã đòi % thì thôi đòi ngày. Nên **tách hai cột**, cột không dùng để gạch ngang, đọc và lọc được từng cột:

| % date yêu cầu | Ngày date còn yêu cầu |
|---|---|
| ≥ 70 % | — |
| — | ≥ 35 ngày |
| — | — *(không đòi mốc — kèm lý do nếu do hệ thống đặt)* |

**KHÔNG in số quy đổi trong bảng dòng hàng.** Quy đổi chỉ xuất hiện ở **màn khai** (§6.1), nơi nó có tác dụng chặn bẫy lúc gõ; nhét vào bảng vận hành là bịa thêm một con số không ai yêu cầu.

Áp cho: trang **Quy định date** · **chi tiết chuyến** (`OutboundDetail`) · **Nhặt lẻ** (`LoosePickingDetail`) · **Việc cần làm** (`DirectedWork`) · **SetDateRuleSheet**. Nhãn dựng ở **một chỗ** — `dateRuleLabel` mở rộng, `masterRuleLabel` cho tầng master.

**Nguồn ngoài chỉ mang %** (`erp_outbound_orders.pct_date_req`; đo: **0/26.675 dòng có giá trị** nên thực tế app luôn là nguồn duy nhất). Thứ tự giữ nguyên: **VL06O có số thì thắng** (bậc 2), setting của app chỉ **bổ sung chỗ trống**.

⚠️ **Bẫy phải gắn cờ:** VL06O cho `60%` trên mã FG02 hạn 45 ngày = **27 ngày**, thấp hơn mức 35 ngày khách đã khai. KHÔNG đè lên số của SAP (nguồn ngoài vẫn thắng), nhưng gắn `review: 'BELOW_MASTER'` → hiện ở ô band **Cần xem** kèm câu "SAP 60% ≈ 27 ngày, thấp hơn mức khách khai 35 ngày". Im lặng nhận là giao thiếu date mà không ai biết.

Bộ lọc **Quy định date** (đã khai / chưa khai / theo kiểu) thêm vào list **Xuất kho** và **Nhặt lẻ**.

### 6.5 Màn khai từng dòng (`SetDateRuleSheet`) — mở TRỌN màn hình, đủ thông tin

User 11/09 (kèm ảnh): panel đang chiếm ~55% bề ngang, bảng chỉ có 5 cột và bỏ trống gần hết chiều cao, trong khi người khai cần nhìn **khách hàng** mới quyết được mức.

- **Desktop: full màn** (`w-screen max-w-none`, giữ `FormSheet` 3 vùng header · thân cuộn · footer dính đáy). Mobile giữ nguyên full-width như hiện nay.
- Cột đầy đủ, thứ tự nghiệp vụ trước: **Mã hàng · Tên hàng · Khách hàng (tên + mã ship-to) · Kênh · Kho · Ngày xuất · Chuyến · Còn lấy · Ghi chú của CS · Quy định đang có (nguồn) · % date yêu cầu · Ngày date còn yêu cầu · SL áp**.
- Khách chưa có trong danh mục / chưa phân kênh hiện **hổ phách** đúng như trang Quy định date — người khai thấy ngay vì sao dòng này không được cấp tự động, và bấm được sang khai master.
- Cột **Quy định đang có** hiện nguồn (chốt tay · theo khách · theo kênh · VL06O · hệ thống đặt) để không ghi đè nhầm thứ người khác vừa chốt.

---

## 7. Thứ tự thi công + kiểm

| # | Bước | Kiểm được bằng |
|---|---|---|
| 1 | Migration: `date_rule_master` + `date_rule_valid` nhận `MIN_DAYS` + bỏ `Customer.date_rule` + mang kênh NPP sang | apply staging, `SCHEMA_REVIEW.md`, `npm run db:types` |
| 2 | `computeDaysLeft` BE + FE mirror | `backend/tests/mirror/shelfLife.mirror.test.ts` đỏ trước khi vá |
| 3 | `matchesRule` nhánh MIN_DAYS | QA 57 oracle FEFO/ngày |
| 4 | `resolveDateRule` nhận `category` + `shelfLifeKnown`, thang 10 bậc | QA 58 mở rộng — mỗi bậc 1 phép kiểm |
| 5 | Bậc 5 tự đặt "không đòi mốc" + vết `outbound_events` | QA 58: dòng PM01 có rule, có reason, có sự kiện |
| 6 | Cửa gác mở rộng theo `date_rule_policy ≠ OFF` | QA 57 [19x] — chặn đúng kho bật, **KHÔNG khoá nhầm kho OFF** |
| 7 | RPC board lọc bỏ mã không hạn dùng + band + 2 filter mới | QA 58: đếm dòng board = đếm SQL độc lập |
| 8 | Form khai (khách + kênh) · nhãn dòng chung tính sống · câu quy đổi | Playwright 1280 + 360 |
| 9 | Bulk "Đặt quy định date" + upload Excel 2 pha | QA 58: `ids` XOR `filter`, re-upload không nhân đôi |
| 10 | Đổi tên toàn bộ + cột "≈ N ngày" ở 5 bảng | cổng tĩnh + Playwright |

**Ratchet mới cần cân nhắc:** `rotation_kind_in_date_rule` (baseline 0) — chặn ai đó nhét `FIFO`/`LIFO` vào `date_rule` sau này, đúng luật "bug chết hai lần".

---

## 8. Việc đợt 1 còn treo, gộp làm luôn

1. **Nạp từ SAP tự trỏ kho** — RPC trả kho gợi ý (khớp mã → khớp tên duy nhất), bảng xem trước có cột bỏ tick được. **44/102 dòng tự nối**, khỏi ngồi nối tay.
2. **Ô "Ship-to phụ" ở form Kho ghi thẳng sang Khách hàng** — thêm mã thì sinh dòng khách trỏ về kho đó; gỡ mã thì gỡ trỏ kho chứ không xoá khách; mã đang thuộc kho khác → 409 nói rõ kho nào. Trả lời câu "tạo kho mới thì bên Khách hàng có luôn không".
3. **Danh mục rỗng thì nút "Nạp từ SAP" thành nút chính** kèm "đang có 102 mã chờ nạp"; bỏ `mobileHidden` (đang ẩn hẳn trên điện thoại = ngõ cụt).
4. Cleaner gói QA 12/13/14 dọn `Customer` theo tiền tố tag (đang để lại QATMS/QAAWSHIP/QADRVSHIP).

---

## 9. Ranh giới — những thứ CỐ Ý không làm

- **Không tách danh mục khách theo kho xuất** (§0.1). Ngoại lệ dùng chốt tay.
- **Không thêm FIFO/LIFO vào ô khai** (§2). Chúng sống ở cài đặt Kho / Loại kho.
- **Không giữ song song `Customer.date_rule`** cạnh bảng mới.
- **Không chặn xuất ở kho `date_rule_policy = OFF`** (§4) — sẽ dừng cả 153 kho.
- **Không đổi URL** `/wms/outbound/date-rules` dù đổi nhãn.
