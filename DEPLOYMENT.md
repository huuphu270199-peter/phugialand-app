# Triển khai Phú Gia Land lên hosting

Tài liệu này dùng đúng ba hostname:

| Hostname | Giao diện |
| --- | --- |
| `phugialand.vn` | Trang chủ và thông tin công khai |
| `app.phugialand.vn` | Ứng dụng quản lý |
| `tenant.phugialand.vn` | Cổng người thuê |

## 1. Phần đưa lên GitHub

Đẩy toàn bộ source được Git theo dõi, gồm JavaScript, HTML, CSS, manifest, asset, test, `database-schema.sql`, `package.json`, `package-lock.json` và `.cpanel.yml`.

Không đưa lên GitHub:

- `.env` hoặc bất kỳ mật khẩu/token/private key nào
- `data/state.json`, `data/media/`, `data/documents/`
- `phu-gia-land-hosting-transfer.zip` hoặc file backup ZIP khác
- `node_modules/`, log và thư mục tạm

Trước khi push:

```bash
npm test
git status --short
git add .
git status --short
git commit -m "Prepare production deployment"
git push origin main
```

Kiểm tra danh sách staged trước khi commit. Không tiếp tục nếu thấy `.env`, `data/` hoặc file `.zip`.

## 2. DNS và SSL

Trong DNS Zone Editor, tạo bản ghi cho cả ba hostname trỏ về IP hosting:

```text
@        A       <IP_HOSTING>
app      A       <IP_HOSTING>
tenant   A       <IP_HOSTING>
```

Nếu nhà cung cấp yêu cầu CNAME cho subdomain, dùng giá trị họ cung cấp thay bản ghi A. Sau khi DNS hoạt động, bật AutoSSL cho cả ba hostname và xác nhận cả ba URL mở bằng HTTPS.

## 3. Kiến trúc Node.js trên cPanel

### Phương án khuyến nghị: một Node app, ba hostname

Clone/deploy GitHub một lần vào thư mục như:

```text
/home/CPANEL_USER/phugialand-app
```

Tạo một Node.js Application dùng Node 22, startup file `server.js`. Yêu cầu hosting ánh xạ cả `phugialand.vn`, `app.phugialand.vn` và `tenant.phugialand.vn` vào cùng ứng dụng Passenger/Node này. Server tự chọn giao diện theo hostname.

Phương án này chỉ có một bản source và một thư mục media, tránh lệch dữ liệu giữa ba tiến trình.

### Nếu cPanel chỉ cho một hostname trên mỗi Node app

Tạo ba Node.js Application cùng pull một GitHub repository. Cả ba phải dùng:

- Cùng MySQL database
- Cùng `NVP_SESSION_SECRET`
- Cùng thư mục tuyệt đối `NVP_DATA_DIRECTORY`, ví dụ `/home/CPANEL_USER/phugialand-data`
- Cùng các biến tích hợp Tuya, webhook và VAPID

Chỉ chạy migration hoặc restore trên một instance. Sau đó restart cả ba instance.

Với ba application root khác nhau, đường dẫn virtualenv trong `.cpanel.yml` có thể không khớp cả ba. Khi đó chạy `npm ci --omit=optional` trong giao diện Node.js App hoặc Terminal của từng instance, rồi dùng `Restart Application` thay cho deployment task tự động.

## 4. Tạo MySQL database

Trong cPanel MySQL Databases:

1. Tạo database.
2. Tạo database user với mật khẩu riêng.
3. Gán user vào database với quyền `ALL PRIVILEGES`.
4. Mở phpMyAdmin, chọn database và chạy file `database-schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS app_state (
  state_key VARCHAR(191) NOT NULL PRIMARY KEY,
  state_value LONGTEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Không khởi động app với cấu hình MySQL trước khi bảng `app_state` tồn tại.

## 5. Biến môi trường trên hosting

Đặt trong cPanel Node.js Application, không commit `.env`:

```dotenv
NODE_ENV=production
NVP_ADMIN_EMAIL=<TEN_DANG_NHAP_QUAN_TRI>
NVP_ADMIN_PASSWORD=<MAT_KHAU_RIENG_TOI_THIEU_12_KY_TU>
NVP_ADMIN_PASSWORD_CHANGE_REQUIRED=true
NVP_SESSION_SECRET=<CHUOI_NGAU_NHIEN_TOI_THIEU_32_KY_TU>
NVP_APP_HOSTS=app.phugialand.vn
NVP_TENANT_HOSTS=tenant.phugialand.vn
NVP_DATA_DIRECTORY=/home/CPANEL_USER/phugialand-data

DB_HOST=localhost
DB_PORT=3306
DB_NAME=<TEN_DATABASE_DAY_DU>
DB_USER=<TEN_DATABASE_USER_DAY_DU>
DB_PASSWORD=<MAT_KHAU_DATABASE>
```

`NVP_ADMIN_PASSWORD` và `NVP_ADMIN_PASSWORD_CHANGE_REQUIRED` chỉ dùng để khởi tạo tài khoản chủ lần đầu. Sau khi đổi mật khẩu trong app, server lưu hash vào `NVP_DATA_DIRECTORY/owner-credentials.json`; file này phải được giữ nguyên khi deploy hoặc restart. Không đặt `NVP_DATA_DIRECTORY` bên trong thư mục source có thể bị ghi đè khi pull code.

Sau khi thay đổi source hoặc biến môi trường, bấm **Restart** trong trang Node.js Application để Passenger nạp phiên bản mới.

Tạo session secret trên máy cá nhân:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Các biến tùy chọn chỉ điền khi sử dụng:

```dotenv
NVP_API_TOKEN=
NVP_SMART_HOME_PUSH_TOKEN=
NVP_BANK_WEBHOOK_SECRET=
NVP_VAPID_PUBLIC_KEY=
NVP_VAPID_PRIVATE_KEY=
NVP_VAPID_SUBJECT=mailto:admin@phugialand.vn
TUYA_ACCESS_ID=
TUYA_ACCESS_SECRET=
TUYA_ENDPOINT=https://openapi-sg.iotbing.com
TUYA_MQ_ENDPOINT=wss://mqe.tuyaus.com:8285/
TUYA_MQ_TOPIC=
TUYA_MQ_TOKEN=
TUYA_MQ_SUBSCRIPTION=
TUYA_MQ_PAYLOAD_KEY=
```

Nếu cấu hình VAPID, phải điền đồng thời public key, private key và subject. Không dùng lại mật khẩu mặc định từng xuất hiện trong lịch sử Git.

## 6. Chuyển 100% dữ liệu

### Bước A: khóa ghi dữ liệu tạm thời

Thông báo người dùng ngừng cập nhật dữ liệu trong thời gian chuyển. Backup phải được tạo sau thao tác cuối cùng để không mất bản ghi phát sinh giữa lúc sao lưu và restore.

### Bước B: tạo gói chuyển trên máy nguồn

Chạy tại thư mục dự án:

```bash
npm run backup:data -- ./phu-gia-land-hosting-transfer.zip
```

ZIP chứa:

- `backup.json`: toàn bộ state nghiệp vụ, tài khoản, khách thuê, hóa đơn, tòa nhà và cấu hình ứng dụng
- `media/`: toàn bộ ảnh/video bất động sản
- `documents/`: toàn bộ tài liệu và ảnh phản ánh

File ZIP bị Git ignore và phải chuyển riêng bằng kết nối an toàn.

### Bước C: deploy code và khởi động hosting

Pull code từ GitHub, cài thư viện bằng `npm ci --omit=optional`, cấu hình biến môi trường, tạo bảng MySQL rồi restart Node app. Mở `https://app.phugialand.vn` và đăng nhập bằng tài khoản chủ cấu hình trên hosting.

### Bước D: restore vào hosting

Trong hồ sơ quản trị, mở **Sao lưu và khôi phục**, chọn **Khôi phục bản sao**, rồi chọn `phu-gia-land-hosting-transfer.zip`.

Khi DB_* đã được cấu hình, state trong ZIP được ghi vào MySQL. Media và documents được ghi vào `NVP_DATA_DIRECTORY`. Quá trình này thay thế toàn bộ dữ liệu đang có trên hosting, vì vậy chỉ chạy một lần trên database mới hoặc sau khi đã backup hosting.

Nếu ZIP lớn hơn 75 MB hoặc hosting chặn upload request lớn, giải nén ZIP trên máy cá nhân, tải thủ công `media/` và `documents/` vào `NVP_DATA_DIRECTORY`, tải `data/state.json` nguồn lên hosting, rồi chạy:

```bash
npm run migrate:mysql
```

Script tự tạo bảng nếu cần và thay toàn bộ state MySQL bằng nội dung `NVP_DATA_DIRECTORY/state.json`.

## 7. Xác minh sau chuyển

1. `https://phugialand.vn`: chỉ hiển thị trang công khai.
2. `https://app.phugialand.vn`: hiện trang đăng nhập quản lý, đăng nhập được.
3. `https://tenant.phugialand.vn`: hiện cổng người thuê, không hiện dashboard quản lý.
4. Kiểm tra số tòa nhà, căn hộ, khách thuê, hóa đơn, tài khoản và phản ánh.
5. Mở thử từng ảnh, video và tài liệu.
6. Đăng nhập một tài khoản người thuê và kiểm tra hóa đơn/thông báo.
7. Gọi health endpoint:

   ```text
   https://app.phugialand.vn/api/health
   ```

8. Từ hosting, xuất thêm một backup mới và giữ ở nơi an toàn ngoài hosting.

Chỉ mở lại quyền nhập liệu sau khi số lượng bản ghi và file đã đối chiếu đúng.

## 8. Các file phải chuyển tay

| Nội dung | Cách chuyển |
| --- | --- |
| Mật khẩu và secret | Nhập trong cPanel Environment Variables |
| Cấu hình DB/Tuya/VAPID/webhook | Nhập trong cPanel Environment Variables |
| `phu-gia-land-hosting-transfer.zip` | Upload qua chức năng Restore hoặc cPanel File Manager/SFTP |
| Media/documents nếu ZIP quá lớn | cPanel File Manager/SFTP vào `NVP_DATA_DIRECTORY` |
| SQL schema | Chạy `database-schema.sql` bằng phpMyAdmin |

Không gửi các nội dung này qua GitHub, issue, commit, ảnh chụp màn hình công khai hoặc tin nhắn không mã hóa.