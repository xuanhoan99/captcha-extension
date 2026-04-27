# Owned Captcha Test Helper

Chrome Extension Manifest V3 để test captcha 3 chữ số trên hệ thống bạn sở hữu.

Extension này dùng OCR cục bộ bằng template matching:

- Bạn mở trang test có captcha.
- Cấu hình selector cho ảnh, input, form/nút submit và số ký tự captcha.
- Nhập mã đúng hiện tại rồi bấm `Train`.
- Sau vài mẫu train, bấm `Chạy thử` để extension nhận diện, điền input và submit nếu bạn bật tùy chọn đó.

## Cài vào Chrome

1. Mở `chrome://extensions`.
2. Bật `Developer mode`.
3. Bấm `Load unpacked`.
4. Chọn thư mục `D:\Source\captcha-extension`.

## Cấu hình

- `Domain test`: ví dụ `localhost`, `127.0.0.1`, hoặc domain staging của bạn.
- `Selector ảnh captcha`: ví dụ `img.captcha`, `#captchaImage`.
- `Selector input`: ví dụ `input[name='captcha']`.
- `Selector form/nút submit`: ví dụ `form`, `#loginForm`, hoặc `button[type='submit']`.
- `Số ký tự captcha`: nhập `3`, `4`, `5`... để ép OCR theo độ dài đó, hoặc nhập `0`/để trống để tự đoán theo vùng ký tự tìm được.
- `Cho phép chữ + số`: bật nếu captcha của bạn có cả `A-Z` và `0-9`. Khi train, chữ thường sẽ được chuẩn hóa thành chữ hoa.

## Lưu ý kỹ thuật

OCR hiện tại phù hợp với captcha số đơn giản, ít nhiễu, các chữ số tách tương đối rõ. Nếu để độ dài `0`, các ký tự nên có khoảng cách rõ để extension tự tách vùng. Nếu captcha của bạn có đường nhiễu, xoay/kéo méo mạnh hoặc nền phức tạp, hãy dùng nó như khung extension rồi thay module `ocr.js` bằng engine OCR nội bộ của bạn.

Nếu ảnh captcha bị chặn khi vẽ lên canvas, hãy đảm bảo ảnh cùng origin với trang test hoặc server captcha trả header CORS phù hợp.

## Theo dõi log

- Popup có khung `Log test` để xem nhanh từng bước train, OCR, điền input và submit.
- Mở DevTools trên tab test rồi vào `Console` để xem log chi tiết với prefix `[CaptchaTest]`.
- Nếu popup đóng, log trong popup sẽ không nhận message mới, nhưng log trong Console của tab vẫn còn.
