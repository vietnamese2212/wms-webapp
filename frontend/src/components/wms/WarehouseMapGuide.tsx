// Hướng dẫn sử dụng SƠ ĐỒ KHO (08/09/2026) — mở từ nút "Hướng dẫn" trên trang, panel trượt phải (FormSheet).
// Nội dung bám ĐÚNG nhãn nút/công cụ đang có trên WarehouseMap.tsx: đổi nhãn bên đó thì đổi ở đây.
// Phần dựng/sửa bản vẽ chỉ hiện khi người dùng có quyền warehouse_map.edit (không dạy nút họ không thấy).
import type { ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { CollapseSection } from '@/components/shared/CollapseSection'
import { Button } from '@/components/ui/button'

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-block rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[10px] leading-4 text-slate-700 whitespace-nowrap">{children}</kbd>
}
function Sw({ c, ring }: { c: string; ring?: string }) {
  return <span className="inline-block h-3 w-3 rounded-sm align-[-2px] border mr-1" style={{ background: c, borderColor: ring ?? '#cbd5e1' }} />
}
function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <CollapseSection title={title}>
      <div className="px-3 py-2.5 space-y-2 text-xs text-slate-700 leading-relaxed">{children}</div>
    </CollapseSection>
  )
}
function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="list-decimal pl-5 space-y-1.5 marker:text-slate-400">{items.map((it, i) => <li key={i}>{it}</li>)}</ol>
}
function Bullets({ items }: { items: ReactNode[] }) {
  return <ul className="list-disc pl-5 space-y-1 marker:text-slate-400">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
}
function Rows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[11px]">
        <tbody className="divide-y divide-slate-100">
          {rows.map(([a, b], i) => (
            <tr key={i} className="align-top">
              <td className="py-1 pr-2 font-medium text-slate-700 whitespace-nowrap">{a}</td>
              <td className="py-1 text-slate-600">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WarehouseMapGuide({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-xl"
      title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-sky-600" />Hướng dẫn Sơ đồ kho</span>}
      description={canEdit
        ? 'Bản vẽ 2D nhìn từ trên xuống. Một ô lưới = một chân pallet. Bạn có quyền vẽ (Sơ đồ kho → Chỉnh sửa) — vẽ trên máy tính, màn rộng.'
        : 'Bản vẽ 2D nhìn từ trên xuống. Một ô lưới = một chân pallet. Tài khoản của bạn xem được, muốn vẽ cần quyền "Sơ đồ kho → Chỉnh sửa".'}
      footer={<Button variant="outline" size="sm" onClick={onClose}>Đóng</Button>}>
      <div className="-mx-4 -mt-4 divide-y divide-slate-200">
        <Sec title="1 · Đọc bản vẽ">
          <Bullets items={[
            <>Mỗi <b>ô lưới là một chân pallet</b>. Kích thước thật của ô ghi ở ô tổng "Kích thước" (mặc định 1,2 m/ô). Khoảng cách trên bản vẽ = số ô × mét/ô.</>,
            <>Một vị trí <b>kéo dài đúng bằng sức chứa</b> của nó: vị trí 43 pallet vẽ thành vệt 43 ô, mỗi ô là một chỗ pallet (dấu ×). Ô kệ 1 pallet/tầng = 1 ô.</>,
            <>Các <b>tầng của cùng chân kệ</b> (A12_T1 … A12_T4) dùng chung một ô. Số nhỏ ở góc ô = số tầng. Bấm ô để xem cột tầng.</>,
            <>Màu: nền theo <b>khu</b> (chú giải ở pane phải) · <Sw c="#22c55e" />Cửa / bãi xuất · <Sw c="#3b82f6" />Cửa / bãi nhập · <Sw c="#f59e0b" />Điểm đầu dãy · <Sw c="#94a3b8" />Tường, cột · <Sw c="#fff" ring="#ef4444" />viền đỏ = ô khớp tìm kiếm · <Sw c="#fff" ring="#0284c7" />viền xanh = ô đang chọn · <Sw c="#fff" ring="#d97706" />viền cam = có pallet QA giữ.</>,
            <>Lớp phủ <b>Tồn theo ô</b>: <Sw c="#38bdf8" />ô xanh = đang có pallet, <Sw c="#fff" />ô trắng dấu × = chỗ trống. Thu nhỏ quá thì cả khối tô một màu, đậm dần theo % đầy.</>,
          ]} />
        </Sec>

        <Sec title="2 · Xem và tra cứu">
          <Bullets items={[
            <>Chọn <b>Kho</b> ở bộ lọc (điện thoại: nút <b>Lọc</b>). Bộ lọc <b>Khu</b> làm mờ các khu khác. <b>Lớp phủ</b>: Tồn theo ô · Đường đi từ cửa · Chỉ bản vẽ.</>,
            <>Di chuyển: <b>kéo</b> để rê bản vẽ, <b>lăn chuột</b> hoặc <b>hai ngón</b> để thu phóng, nút <b>Vừa màn</b> để về toàn cảnh. Góc dưới trái hiện toạ độ ô đang trỏ.</>,
            <>Bấm một ô → pane phải hiện <b>cột tầng</b> (tầng cao ở trên): mã vị trí, số pallet, số mã hàng, nhãn QA / nhặt lẻ. Nút <b>Tồn kho ở ô này</b> mở trang Tồn kho lọc đúng các mã vị trí đó.</>,
            <><b>Đi từ</b>: chọn cửa xuất phát → pane hiện "Từ Cửa xuất 1: 34 ô ≈ 41 m". Chọn lớp phủ <b>Đường đi từ cửa</b> để vẽ đường (nét đứt xanh, chấm xanh lá = cửa). "Không có lối đi" nghĩa là kệ hoặc tường chắn kín.</>,
            <><b>Tìm</b>: gõ tem pallet hoặc mã hàng vào ô tìm → ô chứa nháy viền đỏ, pane liệt kê ô và số pallet; bấm dòng để nhảy tới ô.</>,
            <>Điện thoại / PDA chỉ xem, không vẽ.</>,
          ]} />
        </Sec>

        {canEdit && (
          <Sec title="3 · Dựng bản vẽ lần đầu (máy tính)">
            <Steps items={[
              <>Bấm <b>Chỉnh sửa</b> (kho chưa có bản vẽ thì bấm <b>Dựng bản vẽ</b>). Panel trình vẽ mở bên trái.</>,
              <><b>Khung lưới</b>: nhập <b>Kho dài / Kho rộng</b> theo mét rồi bấm <b>Chia ô</b> (chia theo mét/ô), hoặc gõ thẳng số ô. Xong bấm <b>Lưu khung</b> trên thanh công cụ.</>,
              <><b>Tường</b>: chọn công cụ Tường, <b>bấm</b> một ô hoặc <b>kéo một vệt</b> để tô cột, tường, văn phòng kho. Xoá: kéo vệt bắt đầu trên tường, hoặc công cụ <b>Gỡ</b> kéo vệt qua tường, hoặc <b>Xoá hết tường</b> ở Khung lưới. Ô nhỏ khó nhắm thì lăn chuột phóng to trước. Tường thuộc khung → nhớ <b>Lưu khung</b>.</>,
              <><b>Rải dãy</b>: trong danh sách "Chưa đặt", bấm <b>Rải dãy</b> cạnh tên khu, rồi <b>kéo một vệt</b> trên bản vẽ dọc theo lối đi. Mỗi ô của vệt là đầu một dãy; dãy kéo dài theo sức chứa, <b>vuông góc với vệt</b> về phía đã chọn (mục 4). Còn dãy chưa đặt → kéo vệt tiếp.</>,
              <><b>Đặt lẻ</b>: mở khu, bấm tên chân kệ, rồi <b>bấm</b> ô đầu trên bản vẽ (khối theo sức chứa / N hàng) hoặc <b>kéo một khung</b> — vị trí nhận đúng hình khung vừa kéo (ví dụ Kho Lẻ 100 pallet vẽ 4 ngang × 25 dọc), có xem trước kích thước. Đặt xong tự nhảy sang chân kệ kế tiếp cùng khu.</>,
              <><b>Cửa/bãi</b>: chọn công cụ, bấm ô trống → chọn loại (Cửa / bãi xuất · Cửa / bãi nhập · Điểm đầu dãy), đặt tên, kích thước theo ô → <b>Tạo</b>. Kho có Cửa số 1 … 8 dọc mép thì tạo từng cửa.</>,
              <><b>Gợi ý đầu dãy</b>: sau khi rải, bấm để hệ thống đề xuất một điểm đầu dãy ở đầu mỗi dãy phía cửa xuất (nơi xe nâng hạ đặt pallet). Tick dòng muốn tạo, đổi tên nếu cần.</>,
              <><b>Kệ / Sàn</b>: bấm ô → pane → <b>Đánh là KỆ / SÀN</b> (đổi cả chân kệ). Hệ thống đã tự suy từ đuôi mã (T1 … T4 = kệ, không đuôi = sàn), chỉ sửa chỗ sai.</>,
              <>Kiểm ô tổng <b>Chưa đặt = 0</b>, có cửa xuất và cửa nhập, rồi bấm <b>Xem</b> để về chế độ xem.</>,
            ]} />
          </Sec>
        )}

        {canEdit && (
          <Sec title="4 · Kích thước khi đặt">
            <Bullets items={[
              <>Mặc định <b>Theo sức chứa</b>: 1 ô = 1 pallet, chiều dài = sức chứa lớn nhất trong các tầng của chân kệ. Chạm mép khung hay ô đã có thì dãy bị <b>cắt ngắn</b> và thông báo nêu số dãy bị cắt.</>,
              <><b>Kéo dài về</b> → ← ↓ ↑: phía dãy kéo dài tính từ ô đầu. Khi rải, vệt dọc chỉ dùng → hoặc ←, vệt ngang chỉ dùng ↓ hoặc ↑ (hệ thống tự đổi nếu chọn lệch).</>,
              <><b>Xếp thành N hàng</b>: vị trí GỘP lớn (ví dụ ô Lẻ cả cụm 100 pallet) không nên chạy một vệt 100 ô — đặt 10 hàng → khối 10 × 10, vẫn là một vị trí, không phải tách. Ô đã đặt rồi: bấm ô → pane → nút <b>Vuông</b> gợi ý khối gần vuông theo sức chứa → <b>Áp</b>.</>,
              <>Bỏ tick Theo sức chứa để đặt <b>khối cố định</b> rộng × cao (ô sàn xếp khối, ví dụ 4 × 8). Đặt xong vẫn đổi được: bấm ô → pane → <b>Khối</b> → <b>Áp</b>.</>,
              <>Sức chứa lấy từ trường <b>Số pallet tối đa</b> của vị trí (trang Vị trí kho). Để trống hoặc 0 → vẽ 1 ô; tối đa 100 ô một chiều.</>,
            ]} />
          </Sec>
        )}

        {canEdit && (
          <Sec title="5 · Chọn nhiều, hoàn tác, phím tắt">
            <Rows rows={[
              ['Chọn một ô', <>Bấm. <b>Ô tường cũng chọn được</b> như chân kệ (bấm / Ctrl+bấm / quét khung) → kéo để dời, <Kbd>Delete</Kbd> để xoá; pane hiện "N ô tường đang chọn".</>],
              ['Thêm / bớt vào nhóm', <><Kbd>Ctrl</Kbd> + bấm (Mac: <Kbd>⌘</Kbd>)</>],
              ['Quét chọn cả vùng', <>Ở công cụ <b>Chọn</b> (chế độ Chỉnh sửa): <b>kéo chuột trên ô trống</b> vẽ khung, mọi ô chạm khung được chọn. Giữ <Kbd>Ctrl</Kbd> khi thả để cộng vào nhóm đang chọn. Ở chế độ Xem dùng <Kbd>Shift</Kbd> + kéo.</>],
              ['Chọn tất cả đã đặt', <><Kbd>Ctrl</Kbd>+<Kbd>A</Kbd></>],
              ['Bỏ chọn / thoát công cụ', <><Kbd>Esc</Kbd></>],
              ['Kéo mảng đang chọn', <><b>Kéo chuột trên một ô đang chọn</b> → cả mảng đi theo (bóng mờ xanh), thả xuống mới ghi. Hoặc <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> dời 1 ô, <Kbd>Shift</Kbd> + mũi tên dời 5 ô. Chạm mép hoặc đè ô khác thì từ chối cả nhóm.</>],
              ['Rê bản vẽ khi đang vẽ', <>Công cụ <b>Rê</b> (bàn tay) rồi kéo, hoặc giữ <Kbd>Space</Kbd> + kéo ở bất kỳ công cụ nào, hoặc chuột <b>giữa</b> / chuột <b>phải</b> kéo. Lăn để thu phóng, nút <b>Vừa màn</b> về toàn cảnh. (Chế độ Xem: kéo trái = rê như cũ.)</>],
              ['Gỡ nhóm khỏi bản vẽ', <><Kbd>Delete</Kbd> — chân kệ về danh sách "Chưa đặt" (cửa / bãi gỡ từng cái).</>],
              ['Đánh KỆ / SÀN cả nhóm', <>Pane phải → nút <b>Đánh KỆ</b> / <b>Đánh SÀN</b>.</>],
              ['Hoàn tác / Làm lại', <><Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> / <Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd> (hoặc <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd>), hay hai nút trên thanh công cụ. Nhớ 50 bước gần nhất; đổi kho thì xoá lịch sử.</>],
            ]} />
            <p className="text-slate-500">Hoàn tác áp dụng cho: đặt / rải / dời / gỡ chân kệ, đổi khối, Kệ / Sàn, tạo / gỡ / đổi tên cửa, tô tường, lưu khung. Đặt, gỡ, dời, cửa ghi lên máy chủ ngay khi bấm; khung và tường chỉ ghi khi bấm <b>Lưu khung</b>.</p>
          </Sec>
        )}

        <Sec title={canEdit ? '6 · Sửa về sau và lỗi thường gặp' : '3 · Lỗi thường gặp'}>
          <Rows rows={[
            ...(canEdit ? [
              ['Vị trí mới', <>Vị trí tạo ở trang Vị trí kho tự xuất hiện ở "Chưa đặt". Vị trí ngừng hoạt động biến khỏi bản vẽ.</>] as [ReactNode, ReactNode],
              ['"Ô này đang là …"', <>Ô đã có vị trí. Chọn ô khác hoặc Gỡ trước.</>] as [ReactNode, ReactNode],
              ['"Ô này đang có vị trí khác — chọn ô trống"', <>Hai chân kệ khác nhau giao nhau. Các tầng cùng chân kệ thì được chung ô.</>] as [ReactNode, ReactNode],
              ['"Ô nằm ngoài khung bản vẽ"', <>Nới khung (Khung lưới → Lưu khung) hoặc đặt chỗ khác.</>] as [ReactNode, ReactNode],
              ['Thu nhỏ khung bị từ chối', <>Còn vị trí nằm ngoài khung mới. Gỡ hoặc dời chúng trước.</>] as [ReactNode, ReactNode],
              ['"Đang có N pallet nằm tại …"', <>Gỡ cửa / điểm đầu dãy đang có hàng. Dời hàng đi trước.</>] as [ReactNode, ReactNode],
              ['"Chưa nhận ra dãy nào"', <>Gợi ý đầu dãy cần ≥ 3 chân kệ liên tiếp trên một hàng hoặc một cột và có ô trống ở đầu.</>] as [ReactNode, ReactNode],
            ] : []),
            ['"Không có lối đi từ … tới ô này"', <>Tường hoặc kệ chắn kín. Cần hở ít nhất một ô lối đi từ cửa tới cạnh ô.</>],
            ['Tìm không thấy', <>Chỉ tìm pallet còn hàng của kho đang chọn; ô "(ô chưa vẽ)" là pallet nằm ở vị trí chưa đặt lên bản vẽ.</>],
            ['Người khác đang sửa', <>Bản vẽ tự cập nhật. {canEdit ? 'Khung và tường bạn chưa Lưu khung vẫn giữ trên máy bạn tới khi bạn lưu.' : ''}</>],
          ]} />
        </Sec>

        {canEdit && (
          <Sec title="7 · Bàn giao bản vẽ">
            <Bullets items={[
              <>Ô tổng <b>Chưa đặt = 0</b>.</>,
              <>Có ít nhất một <b>Cửa / bãi xuất</b> và một <b>Cửa / bãi nhập</b>; kho nhiều cửa thì đủ từng cửa.</>,
              <>Tường, cột, văn phòng đã tô và đã <b>Lưu khung</b>.</>,
              <><b>Kệ / Sàn</b> đúng cho mọi chân kệ; dãy kệ cao có <b>Điểm đầu dãy</b>.</>,
              <>Thử: tìm một tem pallet, bấm ô, xem đường đi từ cửa xuất ra đúng khoảng cách.</>,
            ]} />
          </Sec>
        )}
      </div>
    </FormSheet>
  )
}
