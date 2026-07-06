---
name: qr-scan-flow
description: BẮT BUỘC áp dụng khi làm/ sửa BẤT KỲ tính năng quét QR (scan camera) nào — Inbound, Outbound, Inventory, Attendance. Gồm (A) quét ĐƠN 1 mã/lần (flow confirm vs instant, camera keep-alive, unlockAudio/playBeep, auto-resume 1.5s, parse QR); (B) quét HÀNG LOẠT nhiều QR trong 1 khung hình kiểu Scandit MatrixScan (BarcodeDetector native + fallback zxing-wasm, dedupe client, khung màu overlay, ống kính/zoom/torch, giới hạn quang học tem nhỏ).
---

# QR Scan Flow

> Có **2 kiểu**: **ĐƠN** (1 mã/lần, mục 1→7 bên dưới) và **HÀNG LOẠT** (nhiều QR/khung, mục "Multi-QR batch scan" cuối file). Chọn kiểu theo nghiệp vụ: xác nhận/ghi DB từng mã → ĐƠN; đếm/gom nhiều tem cùng lúc (pallet, kiện) → HÀNG LOẠT.

## Hai loại flow (kiểu ĐƠN)
- **Confirm** (Inbound): Scan → pause → preview → "Lưu" → API → auto-resume 1.5s
- **Instant** (Outbound/Inventory/Attendance): Scan → API ngay → auto-resume 1.5s / pause khi lỗi

## QRScanner component
`frontend/src/components/shared/QRScanner.tsx` — `forwardRef<QRScannerHandle>` với method `resume()`.
Sau mỗi scan: tự `pause(true)` rồi gọi `onScan(text)`. Parent tự resume.

## Camera keep-alive (quan trọng)
Mount một lần, dùng CSS `hidden` thay vì unmount — tránh hỏi lại quyền camera:
```tsx
{hasOpenedScan && <ScanDialog open={showScan} ... />}
// Bên trong ScanDialog:
<div className={`fixed inset-0 z-50 ${open ? '' : 'hidden'}`}>
```
Khi re-open: `useEffect([open]) → setTimeout(() => scannerRef.current?.resume(), 50)`

## Confirm Flow — state cốt lõi
```tsx
const [pendingQR, setPendingQR] = useState<string | null>(null)
// handleScan: setPendingQR + validate client-side
// handleSave: gọi API → onSuccess: resume sau 1.5s / onError: KHÔNG resume
// dismissPending ("Quét tiếp"): clear state + resume ngay
```
UI: nút "Quét tiếp" top-center (`top-[8%]`) khi `pendingQR` set; nút "Lưu" center khi validation.ok.

## Instant Flow — template
```tsx
function handleScan(raw: string) {
  playBeep()
  doAction({ qr_code: raw }, {
    onSuccess: () => { setFeedback('success'); setTimeout(() => scannerRef.current?.resume(), 1500) },
    onError:   () => { setFeedback('error') },  // không auto-resume
  })
}
```

## Audio
```ts
unlockAudio()  // trên gesture mở scanner
playBeep()     // trong handleScan
```

## QR string format (Inbound)
`ddmmyy_MATERIAL_CYCLE_MACHINE_SEQUENCE_...` — split by `_`, min 5 parts. Sau parse ngày: `isNaN(date.getTime())` trước khi dùng.

## Checklist implement QR mới (kiểu ĐƠN)
- [ ] Mount camera một lần (CSS hidden)
- [ ] `unlockAudio()` khi mở, `playBeep()` khi scan
- [ ] Lỗi: banner đỏ inline, không auto-resume
- [ ] Thành công: auto-resume 1500ms
- [ ] Nút "Quét tiếp" để manual resume khi lỗi

---

# Multi-QR batch scan (quét HÀNG LOẠT nhiều QR/khung — kiểu Scandit MatrixScan)

> Dùng khi cần bắt **nhiều tem QR cùng lúc** trong 1 khung camera (vd 1 pallet 140 thùng, mỗi thùng 1 QR 2cm) — không confirm/ghi DB từng mã mà **gom + dedupe client** rồi xử lý cả lô.
> **Implement mẫu (copy được cho app sau): `frontend/src/pages/wms/MultiScanTest.tsx`** — trang độc lập, không gọi API, đủ engine + overlay + dedupe + ống kính + lịch sử phiên. Đây là nguồn chuẩn, đọc file này khi làm tính năng multi-scan mới.

## Kiến trúc engine — 2 tầng (bắt buộc để chạy được trên MỌI máy)
1. **BarcodeDetector native** (`window.BarcodeDetector`) — Android Chrome: nhanh, đa mã, decode thẳng từ `<video>`. Kiểm hỗ trợ QR: `getSupportedFormats()` phải include `'qr_code'`.
2. **Fallback zxing-wasm** (`zxing-wasm/reader`) — iPhone/Safari + desktop (KHÔNG có BarcodeDetector). Vẽ frame vào canvas → `readBarcodes(imageData, { formats:['QRCode'], maxNumberOfSymbols: 64, tryHarder, tryRotate:true })`.
   - Load wasm nội bộ (không CDN): `import('zxing-wasm/reader/zxing_reader.wasm?url')` + `prepareZXingModule({ overrides:{ locateFile } })`.
```ts
async function detectFrame(video) {
  if (engineRef.current === 'native' && detectorRef.current) {
    const found = await detectorRef.current.detect(video)          // đa mã, tọa độ cornerPoints
    return found.map(b => ({ text: b.rawValue, points: b.cornerPoints }))
  }
  // WASM: downscale về wasmWidth rồi decode ImageData, quy tọa độ về pixel video gốc (nhân 1/scale)
}
```

## Vòng quét (loop) — không dùng requestVideoFrameCallback
`setTimeout(loop, native ? 50 : 15)`. Bỏ frame khi `pausedRef | video.readyState<2 | document.hidden`. Đo `decode ms` bằng EMA (`ema*0.8 + ms*0.2`) để hiện tốc độ ổn định + so máy.

## Dedupe client + chống "bóng ma" (cốt lõi độ chính xác)
- `Map<text, { valid, at, hits }>` — key = nội dung QR. Mỗi frame thấy lại → `hits++`.
- **Mã ĐÚNG định dạng: nhận NGAY lần đầu** (hits≥1). QR có mã sửa lỗi Reed-Solomon → gần như KHÔNG thể decode nhầm ra đúng cấu trúc → không cần chờ 2 lần (chờ 2 lần chỉ làm chậm, user từ chối).
- **Mã SAI định dạng: cần ≥`INVALID_MIN_HITS` (=2) lần** mới hiện → diệt "bóng ma" (giải rác 1 frame lúc lia máy/mờ). Bộ lọc hiển thị + lưu: `c.valid || c.hits >= INVALID_MIN_HITS`.
- **Validate theo định dạng nghiệp vụ** (regex riêng từng app) để tách hợp lệ/sai — đây là phần app-specific, thay theo tem của bạn.
- Feedback: `playBeep()` + `navigator.vibrate?.(40)` khi có mã hợp lệ MỚI; beep khác tần số khi mã sai mới.

## Overlay khung màu (phản hồi tức thì)
Vẽ đa giác 4 góc lên `<canvas>` phủ trên video: **xanh**=mã mới nhận · **xám**=đã quét (dup) · **vàng**=đang xác nhận (pending, chưa đủ hits) · **đỏ**=sai định dạng. Map tọa độ video→element theo **object-contain** (`scale = Math.min(W/vw, H/vh)` + offset canh giữa) — phải khớp CSS video (`object-contain` hiện TRỌN khung = đúng vùng đang quét; đừng `object-cover` sẽ crop cạnh gây hiểu nhầm "chưa bao trùm").

## Quang học tem nhỏ — GIỚI HẠN VẬT LÝ phải biết trước khi hứa
- QR 2cm cần **~64–100px** trong ảnh mới decode. Video **cap ~4K** kể cả điện thoại 48MP (chỉ ImageCapture/Android cho still 48MP). ⇒ khoảng cách làm việc thực tế **~20–60cm** cho tem 2cm ở 4K.
- **Độ phân giải xử lý WASM = đòn bẩy khoảng cách**: mặc định phải để **GỐC (native res, đừng downscale về 1920)** — downscale làm giảm khoảng cách quét. Cho user nút chọn 1280/1920/2560/Gốc để cân tốc độ↔xa.
- `tryHarder` = quét được xa/mờ hơn nhưng chậm hơn → để user bật khi cần.
- **Ống kính**: dò ống góc siêu rộng qua `enumerateDevices()` (label regex `/ultra|siêu r|0\.5|wide angle/i`, chỉ có nhãn SAU khi đã cấp quyền camera). 0.5× bao trùm hơn nhưng QR nhỏ đi (đánh đổi). Zoom quang + torch qua `track.getCapabilities()/applyConstraints({ advanced:[{zoom}|{torch}] })` (đọc caps thẳng từ track, state có thể chưa kịp cập nhật).
- **iOS Safari = trần cứng**: không BarcodeDetector, không ImageCapture → chỉ WASM + video ≤4K. Đừng hứa 48MP still trên iPhone.
- **Che khuất**: chỉ QR bề mặt + chìa ra ngoài mới quét được; pallet đặc ~23% thùng khuất hẳn → multi-scan KHÔNG thay được quét từng mặt nếu cần đủ 100%.

## Nhớ setup + lịch sử phiên (localStorage)
- Setup nhớ giữa các lần quét: `{ wasmWidth, lens, zoom, tryHarder }` (`saveSettings` mỗi khi đổi; khôi phục trong `start()`).
- **Dừng = LƯU phiên + XÓA data** (sẵn sàng pallet kế tiếp); **Tạm dừng = GIỮ data**. Rời trang khi đang quét vẫn chốt phiên (cleanup effect). Lưu ≤20 phiên gần nhất kèm engine/res/decode-ms/danh sách mã → xuất JSON để phân tích trên máy thật.

## Checklist implement multi-scan mới
- [ ] Engine 2 tầng: BarcodeDetector native → fallback zxing-wasm (load wasm nội bộ, không CDN)
- [ ] `maxNumberOfSymbols` đủ lớn (vd 64); quy tọa độ WASM về pixel video gốc
- [ ] Dedupe `Map<text>`; hợp lệ nhận ngay, sai định dạng cần ≥2 hits (lọc bóng ma)
- [ ] Overlay khung màu new/dup/pending/invalid, map theo object-contain (khớp CSS video)
- [ ] Độ phân giải xử lý mặc định GỐC; nút chọn res + `tryHarder`; ống kính 0.5×/zoom/torch nếu máy hỗ trợ
- [ ] Nhớ setup (localStorage) + phiên: Dừng=lưu+xóa, Tạm dừng=giữ
- [ ] Biết trước giới hạn quang học (khoảng cách ~20–60cm tem 2cm, iOS không native, che khuất) — đừng hứa quá
