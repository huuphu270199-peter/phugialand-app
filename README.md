# Phu Gia Land

Ứng dụng Node.js quản lý bất động sản, cổng cư dân và trang thông tin công khai.

Hướng dẫn đưa code và toàn bộ dữ liệu lên ba domain production: [DEPLOYMENT.md](DEPLOYMENT.md).

## Yêu cầu

- Node.js 22 trở lên
- MySQL cho môi trường production, hoặc file JSON cục bộ khi phát triển
- HTTPS trên hosting để cookie đăng nhập có thuộc tính `Secure`

## Chạy cục bộ

1. Cài thư viện:

   ```bash
   npm ci
   ```

2. Tạo `.env` từ `.env.example` và điền tối thiểu:

   ```dotenv
   NVP_ADMIN_EMAIL=owner@example.com
   NVP_ADMIN_PASSWORD=replace-with-a-unique-password
   NVP_SESSION_SECRET=replace-with-at-least-32-random-characters
   ```

   Có thể tạo session secret bằng Node.js:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Khởi động:

   ```bash
   npm start
   ```

Mặc định ứng dụng chạy tại `http://localhost:4176`.

## Triển khai

Thiết lập các biến môi trường trên hosting, không tải file `.env` lên GitHub. `NVP_ADMIN_EMAIL` có thể là email, số điện thoại hoặc tên đăng nhập quản trị. Ba biến `NVP_ADMIN_EMAIL`, `NVP_ADMIN_PASSWORD` và `NVP_SESSION_SECRET` là bắt buộc; server sẽ từ chối khởi động nếu thiếu hoặc không đủ mạnh.

Với cPanel Node.js Application:

- Node.js: phiên bản 22
- Application startup file: `server.js`
- Biến `NODE_ENV`: `production`
- Đặt `NVP_APP_HOSTS` và `NVP_TENANT_HOSTS` theo domain thực tế
- Cấu hình đầy đủ `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` nếu dùng MySQL
- Chạy migration một lần bằng `npm run migrate:mysql` khi chuyển dữ liệu file sang MySQL

File `.cpanel.yml` dùng `npm ci --omit=optional` để cài đúng phiên bản từ `package-lock.json`. Optional dependency `pulsar-client` chỉ cần khi chạy listener Tuya Message Queue riêng.

## Dữ liệu và bí mật

- `.env`, thư mục `data/`, file ZIP sao lưu, log và `node_modules/` đều bị loại khỏi Git.
- Không lưu mật khẩu, API token, VAPID private key hoặc thông tin khách thuê trong source code.
- Dữ liệu trên hosting phải được sao lưu bằng chức năng backup trước mỗi lần migration hoặc thay đổi lớn.
- Nếu một bí mật từng được đưa lên GitHub, phải thu hồi và tạo bí mật mới; xóa file ở commit sau không làm bí mật biến mất khỏi lịch sử Git.

## Kiểm tra trước khi đẩy code

```bash
npm test
npm audit --omit=dev
git status --short
```

SDK `@tuya/tuya-connector-nodejs` hiện kéo theo phiên bản Axios có cảnh báo bảo mật chưa có bản sửa từ upstream. Không truyền URL hoặc header do người dùng cung cấp trực tiếp vào SDK, và cần kiểm tra lại `npm audit` trước mỗi lần phát hành.