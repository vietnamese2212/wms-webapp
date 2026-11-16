# Prompt dọn chỉ dẫn AI (dán cho Claude Code ở máy / dự án khác)

Dùng khi một dự án đã tích nhiều luật trong `CLAUDE.md`, memory và skill. Đã áp cho repo này ngày 16/11/2026: `CLAUDE.md` từ 94 KB xuống khoảng 26 KB.

Nguồn: [Prompting Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2).

```text
Tôi muốn bạn dọn các chỉ dẫn mà AI đọc trong dự án này: CLAUDE.md, thư mục memory của dự án, và các skill trong .claude/skills. Không sửa code ứng dụng.

Lý do: các file này được viết dần cho model cũ. Model hiện tại làm theo chỉ dẫn rất sát, coi câu "không bao giờ" là tuyệt đối, và lời dè chừng dồn lại làm bạn hỏi tôi nhiều hơn cần thiết. Tôi muốn bớt phải chỉ đạo.

Việc cần làm:

1. Sao lưu trước. Chép CLAUDE.md hiện tại nguyên văn vào docs/ (ví dụ docs/rules/claude-md-full-<ngày>.md). Chép thư mục memory sang một thư mục sao lưu bên cạnh nó.

2. Viết lại CLAUDE.md, mục tiêu dưới khoảng 250 dòng:
   - Chỉ ghi luật đang hiệu lực. Mỗi luật một hoặc hai câu, kèm lý do ngắn.
   - Bỏ ngày tháng, lịch sử "ai chốt lúc nào", số đo, chuyện sự cố. Những thứ đó chuyển vào docs/ và để lại đường dẫn.
   - Bỏ luật đã bị luật khác thay.
   - Bỏ chữ viết HOA để nhấn mạnh và các từ "TUYỆT ĐỐI", "BẮT BUỘC" khi không cần.
   - Viết lại "không bao giờ X" thành "hỏi trước khi X" nếu tôi vẫn muốn việc đó được làm khi có phép. Chỉ giữ lệnh cấm tuyệt đối cho thứ thật sự không được đụng, và ghi lý do.
   - Giữ nguyên những phần mà script trong repo đang đọc từ CLAUDE.md. Tìm bằng cách grep "CLAUDE.md" trong thư mục scripts và CI trước khi viết lại.

3. Thêm vào CLAUDE.md một mục "Cách làm việc" gồm:
   - Danh sách các bước bạn làm luôn không cần hỏi (sửa code, chạy test, commit, push nhánh làm việc, đọc DB thử nghiệm…). Suy ra từ thói quen của dự án và ghi cụ thể.
   - Danh sách ngắn các việc phải hỏi trước, kèm lý do (production, xoá dữ liệu, việc tốn hạn mức, đổi luật nghiệp vụ tôi đã chốt).
   - Câu: làm hết việc được giao; lỗi thường gặp thì tự chẩn đoán và đi tiếp; lựa chọn kỹ thuật nhỏ thì tự chọn và ghi vào báo cáo.
   - Câu: bạn là người bảo trì lâu dài của codebase; khi sắp chép lại logic đã có thì gom về một chỗ dùng chung; ngoài ra giữ thay đổi trong phạm vi yêu cầu và nêu mọi thay đổi ngoài yêu cầu trong báo cáo.
   - Với tính năng nhiều luật nghiệp vụ: hỏi tôi các ca khó một lượt trước khi code, viết thành bảng "tình huống → kết quả mong muốn", dùng bảng đó làm test.
   - Trước khi báo xong: kiểm bằng tài khoản của người dùng thật (không dùng quản trị cao nhất), chụp màn hình máy tính và điện thoại, tự xem ảnh.
   - Báo cáo: một tin cuối, câu ngắn, kết luận trước, nói rõ phần chưa làm và phần cần tôi quyết.

4. Dọn memory:
   - Xoá ghi chú đã hết hiệu lực hoặc bị ghi chú khác thay.
   - File chỉ mục (MEMORY.md) chỉ giữ sở thích làm việc và quyết định còn hiệu lực, mỗi dòng ngắn, không viết HOA. Nhật ký từng đợt làm việc chuyển sang một file chỉ mục lưu trữ.
   - Ghi chú nào bảo "mỗi lần xong việc thì thêm luật vào CLAUDE.md" thì sửa thành: bài học ghi vào docs hoặc skill; CLAUDE.md giữ ngắn.

5. Skill: đọc lướt, chỉ sửa những dòng mâu thuẫn với CLAUDE.md mới hoặc bảo bạn dừng hỏi khi không cần. Không viết lại toàn bộ.

6. Chạy các cổng kiểm không cần DB của dự án để chắc không script nào hỏng vì CLAUDE.md đổi. Commit và push nhánh làm việc.

Xong nghĩa là: CLAUDE.md mới dưới khoảng 250 dòng, bản cũ còn nguyên trong docs/, memory đã có bản sao lưu, các cổng kiểm xanh. Báo lại cho tôi: kích thước trước và sau, những luật bạn đã bỏ hẳn (không chuyển đi đâu), và những chỗ bạn không chắc nên để tôi quyết.

Chỉ dừng hỏi tôi khi hai luật mâu thuẫn nhau và bạn không xác định được luật nào còn hiệu lực.
```
