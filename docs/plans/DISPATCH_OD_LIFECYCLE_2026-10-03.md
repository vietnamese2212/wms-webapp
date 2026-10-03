# Vòng đời OD trên bàn Điều vận — luật xử lý thay đổi từ SAP (bản đề xuất 03/10/2026)

> Trạng thái: ĐỀ XUẤT, chờ user chốt. Căn cứ: cách SAP EWM nhận thay đổi từ ERP (ODR → ODO → goods issue, change request chấp nhận / từ chối theo hoạt động kho, delivery split có document flow) — map sang hoàn cảnh của app là nạp ZSD02 theo **ảnh chụp** (không có thông điệp thay đổi, phải tự so khác).
> User chốt 03/10: nguồn sự thật về điều vận = **lịch sử của app + dấu tay của người**; SAP là **tham chiếu + cảnh báo**. Hậu quả nặng nhất phải chặn bằng máy: **một đơn hàng đi hai lần ở hai ngày**.

## 1. Bốn nguyên tắc mượn từ SAP EWM

| # | SAP EWM | Áp vào app |
|---|---|---|
| 1 | **Phân phối = chuyển chủ.** Delivery đã phân phối sang EWM thì ERP không sửa trực tiếp được ("The delivery was distributed, processing occurs in another system"), mọi thay đổi đi dưới dạng *yêu cầu thay đổi* để EWM chấp nhận hay từ chối | Mốc "phân phối" của app = **Xác nhận kế hoạch** (OD vào Kế hoạch xuất). Trước mốc đó bàn điều vận tự áp mọi thay đổi SAP; sau mốc đó thay đổi SAP là *yêu cầu*, không tự ghi đè |
| 2 | **Có hoạt động kho thì từ chối.** Đã tạo/confirm warehouse task (nhặt, đóng gói) thì giảm/xoá từ ERP không áp vào ODO nữa cho tới khi post goods issue; tăng số lượng không bao giờ tự áp | Hoạt động kho = chuyến Xuất kho **Đang xuất / Tạm dừng** (đã quét). Từ đây mọi thay đổi SAP vào hàng chờ **Cần xử lý**, kho quyết |
| 3 | **Sau goods issue không sửa, chỉ đảo.** Sai thì reversal / return delivery, không "xoá" chứng từ đã đi | Chuyến **Hoàn thành** / xe đã ra cổng: không đụng. SAP xoá hay tạo lại DO cho hàng đã đi = cờ đỏ + rào họ hàng, xử lý bằng nghiệp vụ trả hàng hoặc xác nhận "đơn bổ sung" |
| 4 | **Tách là một chứng từ có phả hệ.** Delivery split tạo chứng từ mới tham chiếu chứng từ gốc, liên kết ghi trong bảng flow (LEDSPD_FLOW); EWM khuyến nghị hạn chế split tạo chứng từ mới bên ERP khi đã phân phối (note 3398607) | Bảng **phả hệ DO** (`od_lineage`): DO cũ → DO mới, loại (thay · tách · gộp · tạo lại sau post), số lượng, giờ, file. Rào chống trùng kiểm trên **cả họ**, không chỉ số DO |

Nguồn: SAP Help *Processing of Outbound Deliveries*; SAP Community "Changing ECC Delivery after Distribution", "Delete or change outbound delivery distributed to EWM", "Split Outbound Delivery Order in S/4HANA EWM"; SAP Note 3398607.

## 2. Trạng thái app của một OD (trục cột)

| Mã | Trạng thái | Căn cứ dữ liệu | Chủ |
|---|---|---|---|
| A | **Trên bàn**: Điều · khung chờ · trên xe nháp / chờ ĐVVT | `dispatch_trip_od` của kế hoạch DRAFT/TENDERED, hoặc không ở đâu | Điều vận, SAP còn được sửa tự do |
| B | **Đã xác nhận**: Kế hoạch xuất, chuyến chờ, đã đặt lịch / đăng ký cổng | `khvc_lines` ACTIVE · GDO PENDING · slot BOOKED · gate chưa IN | Kho đã nhận, chưa động hàng |
| C | **Kho đang xuất** | GDO IN_PROGRESS / PAUSED · gate IN | Kho |
| D | **Đã đi** | GDO COMPLETED · gate COMPLETED | Lịch sử, chỉ đảo bằng nghiệp vụ |
| X | **Dấu tay**: Không điều ngày này · Không điều · Ngoài app | `dispatch_od_hold` + dấu mới `OUTSIDE_APP` | Người |

Cờ SAP đọc từ ZSD02 (tham chiếu, không đổi trạng thái): **Đã post** (Mat Doc / SL đã xuất) · **SAP gắn xe** (biển số, ĐVVT) · **SAP sửa** · **SAP thay/tách/gộp** · **SAP bỏ** · **Hàng trả về**.

## 3. Sự kiện SAP phát hiện khi nạp ZSD02 (trục hàng)

Phát hiện bằng so ảnh chụp mới với sổ đang có, theo khoá SO Item (ổn định) và số DO (hay đổi):

| Mã | Sự kiện | Dấu hiệu trong file |
|---|---|---|
| E1 | DO mới | SO Item lần đầu có DO |
| E2 | DO giảm | cùng DO, số lượng giảm hoặc mất dòng, không có DO mới nhận dòng đó |
| E3 | DO tăng | cùng DO, số lượng tăng hoặc thêm dòng |
| E4 | DO bị xoá | DO vắng file, SO Item không có DO khác, hoặc SO mang trạng thái huỷ |
| E5 | Thay 1 → 1 | DO vắng, cùng SO Item có đúng một DO mới, DO cũ chưa post |
| E6 | Tách 1 → N | DO vắng, cùng SO Item có nhiều DO mới |
| E7 | Gộp N → 1 | nhiều DO vắng, một DO mới nhận các SO Item đó |
| E8 | Tách một phần | DO cũ còn nhưng bớt dòng, dòng đó xuất hiện ở DO mới |
| E9 | Giao từng phần | DO mới cùng SO Item trong khi DO cũ vẫn đủ trong file — **không phải thay**, chỉ ghi họ "cùng SO Item" |
| E10 | Đổi ngày giao | cùng DO, `delivery_date` đổi |
| E11 | Đổi khách / kho / sloc | cùng DO, ship-to hoặc plant/sloc đổi |
| E12 | SAP post | Mat Doc hoặc SL đã xuất xuất hiện |
| E13 | SAP gắn xe | biển số / ĐVVT / trạng thái điều phối đổi |
| E14 | Tạo lại sau post | E5/E6 nhưng DO cũ đã post |
| E15 | Nạp file lùi | file có "Thời gian tạo OD" lớn nhất nhỏ hơn mốc đã nạp và ít dòng hơn |

## 4. Ma trận hành vi (sự kiện × trạng thái app của DO cũ)

Mã hành vi: **ÁP** = tự áp, không hỏi · **ÁP+CỜ** = tự áp, cắm cờ, ghi nhật ký, thông báo người lập · **CXL** = không tự áp, vào hàng chờ Cần xử lý với nút hành động nêu đích danh · **KHOÁ** = không đụng dữ liệu app, chỉ cờ tham chiếu đỏ, rào họ hàng · **–** = không phát sinh.

| Sự kiện | A Trên bàn | B Đã xác nhận | C Kho đang xuất | D Đã đi |
|---|---|---|---|---|
| E1 DO mới | ÁP: vào Điều của ngày giao, nhãn Mới | – | – | – |
| E2 giảm | ÁP: tải xe tính lại | ÁP+CỜ (EWM giảm khi chưa nhặt): sửa dòng chuyến chờ, chuyến rỗng thì huỷ + nhả khung giờ | CXL: "SAP giảm còn N, kho đã quét M" — nút Cắt dòng / Giữ | KHOÁ: cờ "SAP giảm sau khi đã đi", Cần xử lý đối chiếu |
| E3 tăng | ÁP | CXL (EWM không tự tăng): nút Áp phần tăng vào chuyến / Tách phần tăng thành đơn về Điều | CXL | KHOÁ: phần tăng = đơn bổ sung, người xác nhận |
| E4 xoá | ÁP: rời bàn, nếu trên xe thì gỡ, tải tính lại | ÁP+CỜ: gỡ khỏi chuyến chờ, chuyến rỗng huỷ, nhả lịch/cổng, báo ĐVVT | CXL: kho quyết hoàn hàng về vị trí / hoàn chuyến | KHOÁ: "SAP xoá DO đã đi" cờ đỏ, sai bên SAP |
| E5 thay 1→1 | ÁP: DO mới thế chỗ (kể cả trên xe), dấu Không điều chuyển theo | ÁP+CỜ nếu khách · ngày · số lượng không đổi: đổi số DO trên chuyến; khác bất kỳ ô nào → CXL | CXL: nút Đổi số DO (kho chưa in chứng từ) / Giữ | KHOÁ + rào: DO mới cờ đỏ "họ hàng đã đi ngày X" |
| E6 tách 1→N | ÁP: phần cùng ngày lên **cùng xe** chỗ DO cũ, phần khác ngày về Điều ngày đó, chip họ | CXL: nút Thay DO cũ bằng các phần cùng ngày / Gỡ về Điều | CXL | KHOÁ + rào |
| E7 gộp N→1 | ÁP nếu các DO cũ cùng xe hoặc đều ở khung chờ; khác xe → CXL (phải chọn xe) | CXL | CXL | KHOÁ + rào |
| E8 tách một phần | = E2 trên DO cũ + E1 cho DO mới có họ | như E2 + DO mới về Điều, chip họ | CXL | KHOÁ |
| E9 giao từng phần | ÁP như E1, chip "SO Item này đã có DO X đi ngày Y" | – | – | – |
| E10 đổi ngày giao | ÁP: ngày mới ngoài cửa sổ kế hoạch → rời bàn sang Điều của ngày mới | CXL: nút Dời chuyến/OD sang ngày mới (RPC dời ngày) / Giữ ngày kho | KHOÁ cờ | – |
| E11 đổi khách / kho | ÁP: trên xe thì gỡ về Điều + cờ (xe có thể sai) | CXL | CXL | KHOÁ |
| E12 SAP post | Cờ đỏ "SAP đã post, app chưa điều"; Xác nhận hỏi lại; gợi ý nút Ngoài app hàng loạt | Cờ vàng "post trước khi kho xuất" | Bình thường | Bình thường, đối chiếu khớp |
| E13 SAP gắn xe | Cờ tham chiếu, in biển số SAP cạnh xe app | Cờ vàng nếu khác xe app | Cờ vàng nếu khác | – |
| E14 tạo lại sau post | DO mới vào Điều với cờ đỏ + rào họ hàng; người chọn Ngoài app hoặc Xác nhận đơn bổ sung | như D | như D | như D |
| E15 file lùi | Chặn nạp, bắt xác nhận "đúng là muốn nạp file cũ hơn" (không áp E2/E4 từ file cũ) | | | |

**Công tắc kho** `dispatch_sap_change_mode` = `MANUAL` (mặc định) | `AUTO`: ở `MANUAL`, mọi ô **ÁP+CỜ** của cột B trở thành **CXL** (người bấm mới áp) — đúng tinh thần user "không tự ép gì, mọi thứ là cấu hình". `AUTO` = hành vi EWM.

## 5. Rào cứng (tầng DB, không tin tầng ứng dụng)

1. **Sổ Kế hoạch xuất**: trigger — DO còn hiệu lực chỉ ở **một ngày xuất**; cùng ngày khác Số xe cho phép (máy tách một OD lên hai xe). Kiểm trên **cả họ** theo `od_lineage`, trừ quan hệ đã có dấu *đã giải quyết* (người bấm nút ở Cần xử lý hoặc Xác nhận đơn bổ sung). Vi phạm → 409 `OD_ALREADY_PLANNED` nêu DO, ngày, Số xe đang giữ.
2. **Dòng OD của nháp**: trigger — một OD (hoặc họ hàng) không lên xe ở hai kế hoạch đang mở.
3. **Một đường dời ngày**: RPC duy nhất gỡ dòng cũ rồi ghi dòng mới trong một giao dịch; không có cửa nào UPDATE `export_date` trực tiếp.
4. **Cửa thứ tư** (tạo chuyến Xuất kho tay, mã DO trong chuỗi): không khoá được → **bất biến hằng đêm** + ô Giám sát vận hành: "DO (hoặc họ hàng) nằm trong hai chuyến còn hiệu lực khác ngày = 0".
5. **Thứ tự file**: E15 chặn ở cửa nạp.

## 6. Hàng chờ Cần xử lý (tương đương Delivery Processing Monitor)

Mỗi dòng: DO cũ · DO mới (họ) · sự kiện · trạng thái app · chuyến/xe bị ảnh hưởng · nút hành động đúng ô ma trận · người/giờ xử lý. Chuyến có dòng CXL chưa xử lý → **kho không Bắt đầu chuyến** được (chốt chặn ở Xuất kho). Tab Xem đơn hiện chip đếm "N việc Cần xử lý của ngày này".

## 7. Việc gỡ đơn do người chủ động (không do SAP)

| OD đang ở | Cho gỡ? | Cách | Hệ quả |
|---|---|---|---|
| Khung chờ nháp khác | tự do | kế hoạch khác lấy thẳng | rời khung chờ cũ |
| Trên xe nháp khác | có | nút Kéo về đây | xe kia tính lại, nhật ký, nháp kia được báo |
| B Đã xác nhận / đã đặt lịch | có, có lý do | nút Gỡ khỏi kế hoạch (RPC) | rút khỏi Kế hoạch xuất và chuyến; chuyến rỗng huỷ + nhả lịch/cổng + báo ĐVVT |
| C Kho đang xuất | không ở bàn | chỉ Xuất kho cắt dòng | OD cắt về Điều với cờ "kho đã cắt" |
| D Đã đi | không | nghiệp vụ trả hàng | – |
| X Dấu tay | có | nút Điều lại / Bỏ dấu | về Điều |

## 8. Phép đối chiếu chống thiếu

Chân bảng Xem đơn: `OD lên xe được trong cửa sổ = Điều + Đang xếp + Đã điều (B+C+D) + Không điều + Ngoài app`. Lệch → đỏ. Đơn quá 14 ngày chưa dấu nào nằm ở băng "quá hạn chưa quyết", không biến mất.

## 9. Thứ tự làm — trạng thái 03/10 tối

1. ✅ Rào cứng (mục 5) + `od_lineage` + bộ phát hiện E4–E9, E14 + bất biến gói 00 (đợt 1). E15 (file lùi) = cổng `COVERAGE_SUSPECT` ở cửa nạp. Ô Giám sát vận hành: chưa (bất biến đã nằm ở gói 00 hằng đêm).
2. ✅ Trạng thái theo app, tab Đang xếp nơi khác, cờ SAP tham chiếu, dấu Ngoài app, khung chờ tự do, đối chiếu chân bảng, nút Bỏ nháp, băng nháp quá ngày (đợt 1).
3. ✅ **Hàng chờ Cần xử lý** (RPC `dispatch_decisions`, tab "Cần xử lý" ở Xem đơn) cho cột B/C/D: GONE · REPLACED · KIN · QTY, nút đúng ô (Gỡ khỏi kế hoạch · Đổi số DO · Ngoài app · Xác nhận đơn bổ sung · link Cần xử lý của kho); chốt chặn Bắt đầu chuyến = `sapIssueError` (đợt 1). **Công tắc `dispatch_sap_change_mode` KHÔNG làm** — user chốt "không tự ép gì", mọi ô là người bấm (= MANUAL vĩnh viễn; AUTO chỉ làm khi có yêu cầu).
4. ✅ Gỡ chủ động bậc B có lý do + nhật ký (`POST /tms/dispatch/khvc/remove`, nút "Gỡ khỏi KH xuất" ở tab Đã điều kèm tiến độ kho). Bậc "đã đặt lịch / đăng ký cổng": replan hiện có nhả khung giờ khi chuyến ngừng; chưa có bước "báo ĐVVT".
5. ✅ **Nhiều người một kho = MẢNG, không phải nhiều nháp theo người** (user chốt 03/10 tối sau khi tôi đề xuất "một nháp": "2–3 người làm Trung chuyển, NPP, KA… một user là một mảng của kế hoạch tổng"): hai mảng **Trung chuyển** (khách tick "Trung chuyển" ở Khách hàng; seed ba kho LOF) và **Bán hàng** (còn lại, kể cả STO của NPP); mỗi kho × ngày × mảng một nháp mở; Xem đơn tab Trung chuyển | Bán hàng; "Lấy sang mảng kia" (dấu kho × OD); Số xe đếm chung hai mảng. Lưới `PLAN_RECENTLY_EDITED` giữ nguyên trong từng mảng. Thêm tab **"Không liên quan" theo từng người** (dấu riêng, không đổi kế hoạch). Chi tiết: `docs/modules/dispatch.md` mục "03/10 tối — MẢNG".

**Còn mở sau đợt 2:** E10 đổi ngày giao · E11 đổi khách trên đơn đã vào KH xuất (dòng KH xuất không chụp ngày giao / ship-to SAP nên chưa so được — cần thêm bản chụp hoặc so với `delivery_date` của GDO) · E2/E3 ở cột B hiện vẫn TỰ ÁP ở mức dòng hàng qua `reconcileFromSap` (Z1/Z2) như trước 03/10 — chỉ ghi `reconcile_tasks` RESOLVED, không hiện ở hàng chờ · ô Giám sát vận hành cho bất biến trùng ngày.

## 10. Điểm user đã chốt

- Công tắc kho: **MANUAL** (không có AUTO).
- E6 ở cột A: các phần cùng ngày về **khung chờ** như OD mới (chip họ) — người kéo; không tự lên xe.
- Cột D: **cho "Xác nhận đơn bổ sung"** (chốt (b) 03/10) — và Ngoài app khi hàng đã đi dưới số cũ.
- Tên dấu: **"Ngoài app"**.
- Chuyến đã bắt đầu mà DO bị SAP bỏ / thay: **huỷ rồi điều lại** (chốt (c) 03/10), không có "giữ và chạy tiếp".
