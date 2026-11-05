# xT studio

Bộ công cụ video AI chạy trên máy (Electron): tạo video và ảnh bằng **Muse, Google Flow, Dola, Seedance**, viết kịch bản nhiều cảnh, đồng bộ nhân vật giữa các cảnh, ghép và cắt video, giọng đọc, đăng Facebook Reels.

## Chạy

```bash
npm install
npm start            # hoặc ./scripts/xt-studio.sh
```

Cần **Google Chrome** (Linux: `google-chrome` hoặc `chromium` trong PATH) cho các tài khoản tạo video, và **ffmpeg / ffprobe** cho cắt, ghép, kiểm file.
Giọng đọc Edge cần `pip install edge-tts`; giọng VieNeu cần Python 3.12.

Thêm icon vào menu ứng dụng (Linux):

```bash
sed "s#@REPO@#$PWD#" packaging/xt-studio.desktop > ~/.local/share/applications/xt-studio.desktop
install -Dm644 packaging/xt-studio.png ~/.local/share/icons/hicolor/512x512/apps/xt-studio.png
```

## Kiểm tra

```bash
npm run check        # cú pháp toàn bộ file JS
npm test             # bài thử luồng Muse (trang Muse giả, không cần tài khoản)
```

## Chức năng

| Tab | Việc |
|---|---|
| Tạo video | Prompt → ảnh/video, hàng đợi chung, tự chọn engine |
| Kịch bản | Ý tưởng/truyện → nhiều cảnh, tự ghép, lồng giọng |
| Đồng bộ cảnh | Hồ sơ nhân vật/bối cảnh lặp nguyên văn ở mọi cảnh |
| Tư liệu | Ảnh nhân vật, mẫu prompt, người mẫu cố định |
| Ghép video · Cắt video · Giọng đọc | Dựng, cắt, đọc giọng chạy trên máy |
| Thư viện · Đăng Reels | Kết quả, phân trang, đăng Fanpage |
| Tài khoản | Mỗi tài khoản 1 Chrome riêng, proxy, hạn mức |

## Cấu trúc

```
main.js, preload.js     Electron main + cầu nối giao diện
engine/                 điều khiển Chrome (CDP), Muse/Flow/Dola/Seedance, hàng đợi, ffmpeg, TTS
engine/platform.js      khác biệt Windows / macOS / Linux
ui/                     giao diện (index.html, app.css, từng tab 1 file JS)
test/                   bài thử node:test
```

Dữ liệu người dùng (tài khoản, hồ sơ Chrome, hàng đợi) nằm ở thư mục dữ liệu của app (`~/.config/xT studio`), không nằm trong repo.
