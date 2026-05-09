# Skill: QR Scan Flow

## Hai loại flow
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
`ddmmyy_MATERIAL_CYCLE_MACHINE_SEQUENCE_...` — split by `_`, min 5 parts.

## Checklist implement QR mới
- [ ] Mount camera một lần (CSS hidden)
- [ ] `unlockAudio()` khi mở, `playBeep()` khi scan
- [ ] Lỗi: banner đỏ inline, không auto-resume
- [ ] Thành công: auto-resume 1500ms
- [ ] Nút "Quét tiếp" để manual resume khi lỗi
