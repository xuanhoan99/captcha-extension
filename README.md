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
- `Click trước khi OCR`: selector của input/button cần click để captcha xuất hiện, ví dụ `button.send-code`.
- OCR hiện đang tối ưu cố định cho captcha đúng `3` ký tự và chỉ gồm chữ số `0-9`.
- `Số ký tự captcha` và `Cho phép chữ + số` không còn ảnh hưởng trong mode tối ưu 3 số.
- `Tự phát hiện captcha`: bật để extension theo dõi ảnh captcha xuất hiện, đổi `src`, hoặc reload rồi tự chạy OCR.
- `Delay submit (ms)`: thời gian chờ sau khi điền captcha trước khi submit. Chỉ có tác dụng khi bật `Tự submit sau khi điền`.
- `Chờ click enable (ms)`: thời gian tối đa để đợi element trong `Click trước khi OCR` hết `disabled` trước khi click.

## Lưu ý kỹ thuật

OCR hiện tại phù hợp với captcha số đơn giản, ít nhiễu, các chữ số tách tương đối rõ. Nếu để độ dài `0`, các ký tự nên có khoảng cách rõ để extension tự tách vùng. Nếu captcha của bạn có đường nhiễu, xoay/kéo méo mạnh hoặc nền phức tạp, hãy dùng nó như khung extension rồi thay module `ocr.js` bằng engine OCR nội bộ của bạn.

Nếu ảnh captcha bị chặn khi vẽ lên canvas, hãy đảm bảo ảnh cùng origin với trang test hoặc server captcha trả header CORS phù hợp.

Với captcha nền tối/chữ màu, OCR dùng bộ lọc sáng/màu, bỏ nhiễu mảnh, chia cố định 3 vùng và so template có chịu lệch pixel. Sau khi nâng cấp OCR, hãy train lại mẫu mới vì mẫu cũ không còn được dùng để nhận diện.

## Theo dõi log

- Popup có khung `Log test` để xem nhanh từng bước train, OCR, điền input và submit.
- Mở DevTools trên tab test rồi vào `Console` để xem log chi tiết với prefix `[CaptchaTest]`.
- Nếu popup đóng, log trong popup sẽ không nhận message mới, nhưng log trong Console của tab vẫn còn.
- Khi bật `Tự phát hiện captcha`, log sẽ ghi các sự kiện `watch-start`, `dom-change`, hoặc `image-load` để bạn biết vì sao OCR được kích hoạt.
- Nếu auto-watch không chạy OCR, Console sẽ log lý do bỏ qua như `OCR đang chạy`, `cooldown`, hoặc `captcha chưa đổi`.

## Debug OCR

Bấm `Debug OCR` trong popup để xem ảnh mask sau xử lý và 3 vùng ký tự đã normalize. Nếu preview bị mất nét số hoặc giữ quá nhiều đường nhiễu, cần chỉnh tiếp bộ lọc trong `ocr.js`.

## Open Panel

Bấm `Open Panel` từ popup khi đang đứng ở tab captcha để mở giao diện extension thành tab riêng. Panel sẽ ghi nhớ tab captcha đó để các nút `Train`, `Chạy thử`, `Debug OCR`, `Train từ input` vẫn gửi lệnh về đúng trang test.

## Bật/tắt extension

Checkbox `Bật extension` là công tắc tổng. Khi tắt, extension sẽ không train, OCR, debug hoặc auto-watch nữa, nhưng vẫn giữ toàn bộ cấu hình và mẫu đã train.

## Export/import mẫu train

Bấm `Export mẫu` để copy JSON mẫu train hiện tại vào clipboard và hiển thị trong textarea. Trên máy khác, dán JSON đó vào textarea rồi bấm `Import mẫu`.

Import chỉ nhận mẫu đúng OCR version hiện tại để tránh dùng nhầm dữ liệu cũ.

## Train nhanh khi OCR sai

Khi `Tự submit sau khi điền` đang tắt, bạn có thể sửa lại mã captcha trực tiếp trong input trên trang rồi bấm `Train từ input` trong popup. Extension sẽ lấy giá trị input hiện tại và train ảnh captcha đang hiển thị, không click tạo captcha mới.

Popup cũng hiển thị số mẫu đã có cho từng digit `0-9`; digit có ít hơn 2 mẫu sẽ được tô nền vàng nhạt.
