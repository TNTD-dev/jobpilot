# JobPilot

JobPilot là demo web local bằng tiếng Việt giúp học sinh, sinh viên và người đi làm chuẩn bị ứng tuyển dựa trên bằng chứng thật trong CV.

## Chạy local

Yêu cầu Node.js 20+ và `pdftotext` (để đọc PDF).

```bash
npm install
cp .env.example .env
# điền DEEPSEEK_API_KEY vào .env nếu muốn bật model
npm run dev
```

Mở http://localhost:4173.

Nếu không có API key, app vẫn chạy với bản tách từ khóa dự phòng và nói rõ model chưa bật.
DOCX được đọc bằng Mammoth.
Mỗi lần phân tích gửi nội dung tin và CV tới DeepSeek khi có key; server không lưu file hay tạo database.

## Kịch bản demo 4 phút

1. (0:00-0:35) Mở app, đọc consent: CV là dữ liệu cá nhân, dữ liệu rời máy khi gọi model, không lưu sau phiên.
2. (0:35-1:45) Dán URL tin tuyển dụng công khai thật và tải CV thật (PDF/DOCX), nhấn **Phân tích bằng chứng**.
3. (1:45-2:25) Chiếu bảng JD → Proof: must-have/nice-to-have, ba trạng thái, câu nguyên văn của tin và dòng nguyên văn từ CV.
Không có match score hay xếp hạng.
4. (2:25-3:05) Sang **Copilot**, chọn bullet, tạo rewrite và cover-letter opening.
Chỉ ra nhãn TỪ CV / TỪ TIN / CẦN BẠN XÁC NHẬN, rồi duyệt từng bản trước khi copy.
5. (3:05-3:50) Sang **Replay**, nhận 2-3 câu hỏi từ cùng nguồn, trả lời thật bằng mic hoặc gõ fallback.
Chiếu transcript và các mảnh ghép nội dung còn thiếu: bối cảnh, hành động, kết quả.
6. (3:50-4:00) Nếu còn thời gian, dán bài Facebook/Zalo vào **Trust check**.
Các cảnh báo chỉ nói needs verification / exercise caution và trích nguyên văn, không kết luận lừa đảo.

Nút **Xóa dữ liệu** xóa trạng thái trên giao diện và file upload chỉ nằm trong bộ nhớ request.
Không có auto-apply, gửi tin nhắn, chấm điểm ứng viên, phân tích cảm xúc/ngoại hình, hay tư vấn lương/pháp lý.
