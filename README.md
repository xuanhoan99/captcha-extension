# Owned Captcha Test Helper

Chrome Extension Manifest V3 de test captcha 3 chu so tren he thong ban so huu.

Extension dung OCR local bang template matching, toi uu cho captcha co dinh 3 ky tu va chi gom chu so `0-9`.

## Cai vao Chrome

1. Mo `chrome://extensions`.
2. Bat `Developer mode`.
3. Bam `Load unpacked`.
4. Chon thu muc `D:\Source\captcha-extension`.

## Cau hinh

- `Domain test`: vi du `localhost`, `127.0.0.1`, hoac domain staging cua ban.
- `Selector anh captcha`: vi du `img.captcha`, `img[alt="Captcha"]`.
- `Selector input`: vi du `input[name='captcha']`, `input[maxlength="3"][inputmode="numeric"]`.
- `Selector form/nut submit`: vi du `form`, `#loginForm`, hoac `button[type='submit']`.
- `Selector submit phu`: selector du phong neu nut submit chinh khong co hoac dang disabled, vi du `button.bg-red-600` hoac `text:Attack!`.
- `Click truoc khi OCR`: selector cua input/button can click de captcha xuat hien, vi du `button.btn-primary`.
- `Bat extension`: cong tac tong.
- `Tu dien sau khi nhan dien`: tu dien ket qua OCR vao input.
- `Tu submit sau khi dien`: submit sau khi dien.
- `Tu phat hien captcha`: theo doi captcha xuat hien/doi anh va tu OCR.
- `Chi chay tab target`: khi da mo panel, auto-watch chi chay tren tab captcha duoc ghi nho.
- `Delay submit (ms)`: thoi gian cho truoc khi submit.
- `Cho click enable (ms)`: thoi gian toi da doi nut trong `Click truoc khi OCR` het disabled.
- `Max mau train`: tong so mau toi da duoc giu, chia deu cho 10 digit.

## Workflow train

Chi dung `Train tu input`:

1. Tat `Tu submit sau khi dien`.
2. Bam `Chay thu` hoac de auto-watch dien thu.
3. Neu OCR sai, sua lai 3 so dung trong input captcha tren trang.
4. Bam `Train tu input`.

Extension se lay gia tri input hien tai va train anh captcha dang hien thi, khong click tao captcha moi.

Khi train, extension dung lock ngan han trong `chrome.storage.local` de tranh hai tab cung ghi de templates.

## Can bang mau

Extension chia deu `Max mau train` cho 10 digit `0-9`. Vi du `400` thi moi digit giu toi da 40 mau. Khi train them, mau moi nhat cua tung digit duoc giu lai de tranh mot so co qua nhieu mau lam lech matcher.

## Export/import mau

- `Export file JSON`: tai file mau train hien tai.
- `Chon file JSON`: chon file da export tu may khac.
- `Import file`: import mau vao extension.

Import chi nhan mau dung OCR version hien tai.

## Gop mau tu nhieu profile

Dung script `scripts/merge-templates.js` de gop nhieu file JSON thanh mot file master:

1. Tao thu muc `template-exports`.
2. Copy cac file JSON export tu cac profile vao thu muc do.
3. Chay:

```powershell
node scripts\merge-templates.js
```

Mac dinh script se tao `captcha-templates-master.json` voi toi da `600` mau, chia deu cho 10 digit.

Co the truyen duong dan tuy chinh:

```powershell
node scripts\merge-templates.js template-exports captcha-templates-master.json 600
```

Sau do import `captcha-templates-master.json` vao cac profile can dung chung mau.

## Open Panel

Bam `Open Panel` tu popup khi dang dung o tab captcha de mo giao dien extension thanh tab rieng. Panel se ghi nho tab captcha do de cac nut `Train tu input`, `Chay thu`, `Export`, `Import` van hoat dong dung tab test.

## AI Model (xac minh bang AI)

Extension ho tro dung AI Vision (Gemini hoac OpenAI GPT) de xac minh ket qua OCR va tu dong hoc them mau.

### Cau hinh

- `Bat AI xac minh`: cong tac bat/tat AI.
- `Tu train khi AI ≠ OCR`: tu dong train mau moi tu ket qua AI khi AI va OCR khac nhau.
- `Provider`: chon `Gemini` hoac `OpenAI (GPT)`.
- `API Key`: API key cua provider da chon.
- `Model`: ten model tuy chon. De trong se dung model mac dinh (`gemini-2.0-flash` cho Gemini, `gpt-4o-mini` cho OpenAI).

### Cach hoat dong

1. OCR local chay truoc, tra ve ket qua dua tren template matching.
2. Neu AI bat, anh captcha duoc gui toi AI model de nhan dien.
3. So sanh hai ket qua:
   - **Khop nhau**: dung ket qua OCR (do tin cao).
   - **Khac nhau**: dung ket qua AI va tu dong train mau OCR tu ket qua AI (neu bat `Tu train khi AI ≠ OCR`).
4. Neu AI loi hoac khong tra ket qua, extension van dung ket qua OCR binh thuong.

### Provider duoc ho tro

| Provider | Model mac dinh | API Key |
|----------|---------------|---------|
| Gemini | `gemini-2.0-flash` | Lay tu [Google AI Studio](https://aistudio.google.com/apikey) |
| OpenAI | `gpt-4o-mini` | Lay tu [OpenAI Platform](https://platform.openai.com/api-keys) |

### Luu y

- AI goi API moi lan OCR nen se ton API credit. Co the tat AI sau khi da train du mau.
- API call duoc thuc hien tu background service worker nen khong bi CORS.
- Ket qua hien thi trong status va log se ghi ro nguon `[OCR]` hoac `[AI]`.

## Log

- Popup co khung `Log test`.
- DevTools Console cua tab test co log prefix `[CaptchaTest]`.
- Auto-watch se log ly do bo qua nhu `OCR dang chay`, `cooldown`, `captcha chua doi`, hoac `nut click truoc dang disabled`.
