# Chạy Checklive trên máy tính Windows + Cloudflare Tunnel

Toàn bộ Checklive (server, giao diện, cơ sở dữ liệu, sao lưu) chạy trên **máy tính của bạn**. Cloudflare Tunnel cấp **link HTTPS bằng tên miền riêng** để điện thoại, nhân viên, khách (xác nhận đơn) và overlay OBS dùng được từ bất cứ đâu. **Không cần thuê server.**

## 1. Cần chuẩn bị

| Thứ cần có | Ghi chú |
|---|---|
| Máy Windows 10 (64-bit, bản 22H2) hoặc Windows 11 | Bật **ảo hoá** (Virtualization) trong BIOS. Đa số máy đời mới đã bật sẵn. |
| RAM **8 GB** trở lên | Nếu cùng máy còn chạy OBS / phát live thì nên **16 GB**. |
| Ổ **SSD** còn trống khoảng **15 GB** | |
| **Docker Desktop** | Miễn phí cho cá nhân và doanh nghiệp nhỏ (dưới 250 nhân viên và dưới 10 triệu USD doanh thu/năm). |
| **Tên miền** riêng (VD `tenshop.vn`, `tenshop.com`) | Khoản tốn tiền duy nhất (mua theo năm). Không có tên miền thì link đổi mỗi lần khởi động, không dùng được cho QR in sẵn / overlay. |
| Tài khoản **Cloudflare** | Miễn phí. |
| Mạng Internet ổn định | Checklive dùng rất ít băng thông. |

**Lưu ý quan trọng:** máy phải **bật và có mạng** thì Checklive mới chạy. Khách thường bấm link xác nhận đơn sau buổi live (tối, hôm sau), nên tốt nhất để máy chạy **24/7**. Máy tắt thì khách không xác nhận được, đơn có thể hết hạn giữ hàng.

## 2. Cài đặt (làm 1 lần, khoảng 30–60 phút)

### Bước 1: Cài Docker Desktop
1. Tải tại https://www.docker.com/products/docker-desktop/ và cài (giữ các lựa chọn mặc định, có **WSL 2**).
2. Khởi động lại máy nếu được hỏi.
3. Mở Docker Desktop, đồng ý điều khoản (không cần đăng nhập).
4. Vào **Settings → General**, bật **Start Docker Desktop when you sign in to your computer**.

### Bước 2: Tải Checklive về máy
1. Mở trang GitHub của dự án → chọn nhánh `claude/practical-darwin-ec7www` → **Code → Download ZIP**.
2. Giải nén vào một thư mục **không có dấu cách, không nằm trong OneDrive**, VD `C:\Checklive`.
   (Biết dùng git thì `git clone` cũng được; khi đó `6-cap-nhat.bat` tự tải bản mới.)

### Bước 3: Đưa tên miền về Cloudflare
1. Đăng ký tài khoản tại https://dash.cloudflare.com, bấm **Add a domain**, nhập tên miền, chọn gói **Free**.
2. Cloudflare cho 2 địa chỉ **nameserver**. Vào trang quản lý tên miền ở nơi bạn mua (Mắt Bão, PA Việt Nam, Tenten, Namecheap…), đổi nameserver thành 2 địa chỉ đó.
3. Chờ đến khi Cloudflare báo tên miền **Active**: thường vài phút, có khi vài giờ.

### Bước 4: Tạo Cloudflare Tunnel
1. Trong Cloudflare, vào **Zero Trust** (lần đầu chọn gói Free) → **Networks → Tunnels → Create a tunnel** → chọn **Cloudflared** → đặt tên `checklive`.
2. Ở màn hình cài đặt, chọn **Docker**. Cloudflare hiện một lệnh dạng `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJh...`. **Sao chép phần chuỗi dài sau `--token`**. Đây là mã tunnel, không cần chạy lệnh đó.
3. Bấm **Next**, thêm **Public Hostname**:
   - **Subdomain**: `live` (sẽ thành `live.tenshop.vn`)
   - **Domain**: chọn tên miền của bạn
   - **Service**: Type `HTTP`, URL `app:3000`
4. Bấm **Save**.

### Bước 5: Khởi động Checklive
1. Mở thư mục `C:\Checklive\windows`, nhấp đúp **`1-khoi-dong.bat`**.
2. Lần đầu, script tự tạo file cấu hình `.env` và mở bằng Notepad. Sửa 2 dòng:
   - `ADMIN_PASSWORD=` → mật khẩu đăng nhập Checklive của bạn
   - `TUNNEL_TOKEN=` → dán mã tunnel ở Bước 4
   Lưu (Ctrl+S) và đóng Notepad.
3. Nhấp đúp **`1-khoi-dong.bat`** lần nữa. Lần đầu mất khoảng 5–10 phút để tải và dựng, các lần sau chỉ vài giây.
4. Trình duyệt tự mở http://localhost:3000. Đăng nhập bằng `admin@checklive.local` và mật khẩu vừa đặt.
5. Thử mở **https://live.tenshop.vn** trên điện thoại (dùng 4G cho chắc). Thấy trang đăng nhập là xong.

### Bước 6: Chỉnh Windows để chạy ổn định
- **Settings → System → Power**: khi cắm sạc, đặt **Sleep = Never**.
- **Settings → Windows Update → Advanced options → Active hours**: đặt khung giờ hay live, để Windows không tự khởi động lại giữa buổi.
- Nếu muốn tự chạy lại sau khi mất điện: bật tự đăng nhập Windows. Docker Desktop đã được đặt tự mở, và Checklive tự chạy theo Docker.

## 3. Dùng hằng ngày

Không cần làm gì: Checklive tự chạy cùng Docker Desktop khi bật máy. Các file trong thư mục `windows`:

| File | Dùng khi |
|---|---|
| `1-khoi-dong.bat` | Bật Checklive (hoặc sau khi sửa `.env`) |
| `2-dung.bat` | Tắt Checklive (dữ liệu giữ nguyên) |
| `3-xem-nhat-ky.bat` | Xem nhật ký khi có lỗi |
| `4-sao-luu-ngay.bat` | Sao lưu ngay (VD trước khi cập nhật) |
| `5-khoi-phuc.bat` | Khôi phục dữ liệu từ 1 bản sao lưu |
| `6-cap-nhat.bat` | Cập nhật Checklive lên bản mới |

**Tiện ích Chrome** (cho Facebook trang cá nhân / Group): tải tại `https://live.tenshop.vn/downloads/checklive-connector.zip`. File này đã điền sẵn địa chỉ server.

**Overlay OBS**: dùng link `https://live.tenshop.vn/overlay/...` lấy ở tab Bán hàng / Game của phiên live.

## 4. Cài trên 1 máy, live trên máy khác

Máy cài Checklive làm **máy chủ** (để bật thường xuyên). Bạn live trên máy khác, hoặc điện thoại, đều được.

**Máy chủ không cần đăng nhập tài khoản TikTok / Facebook nào.** Tài khoản chỉ đăng nhập trên máy live:
- **Máy chủ**: chạy Checklive + cơ sở dữ liệu + Cloudflare Tunnel. Không mở, không đăng nhập TikTok / Facebook.
- **Máy live**: đăng nhập TikTok / Facebook để phát live; mở Checklive bằng trình duyệt; cài tiện ích Chrome nếu live Facebook trang cá nhân / Group.

| Việc | Làm ở đâu |
|---|---|
| Đọc bình luận **TikTok** và **Fanpage (API)** | Checklive tự kết nối từ máy chủ. Phát live từ máy nào / điện thoại nào cũng được, máy live không cần cài gì. |
| Màn hình quản lý (theo dõi, chốt đơn, game) | Mở `https://live.tenshop.vn` trên máy live, điện thoại, máy nhân viên… Nhiều người mở cùng lúc được. |
| **Overlay OBS** trên máy live | Trong OBS thêm nguồn **Browser** với link `https://live.tenshop.vn/overlay/...` (lấy ở tab Bán hàng / Game). |
| **Tiện ích Chrome** (Facebook trang cá nhân / Group) | Cài trên máy nào sẽ **mở tab live Facebook suốt buổi**: máy chủ (tiện vì luôn bật) hoặc máy live đều được. Tải tại `https://live.tenshop.vn/downloads/checklive-connector.zip`. |

- Nếu không phát live trên máy chủ thì máy chủ không cần mạnh: **8 GB RAM là đủ**.
- **Chưa có tên miền, các máy dùng chung mạng wifi / LAN:** mở `http://IP-máy-chủ:3000` (xem IP bằng lệnh `ipconfig` trên máy chủ, VD `192.168.1.10`). Lần đầu nếu Windows hỏi cho phép Docker qua tường lửa, chọn **Private networks**. Cách này **chỉ dùng được trong mạng nhà**: khách bấm link xác nhận đơn từ bên ngoài sẽ không vào được, nên khi dùng thật vẫn cần tên miền.

## 5. Sao lưu dữ liệu

- Checklive **tự sao lưu 6 tiếng 1 lần** vào thư mục `C:\Checklive\backups` và giữ 14 ngày gần nhất.
- Sao lưu chỉ nằm trên cùng máy, nên **hỏng ổ cứng là mất cả bản sao lưu**. Hãy chép thư mục `backups` ra ngoài thường xuyên. Cách dễ nhất: cài **Google Drive cho máy tính** và cho đồng bộ thư mục `backups`.
- Khôi phục: chạy `5-khoi-phuc.bat`, nhập tên file, gõ `DONG Y`. Script tự sao lưu dữ liệu hiện tại trước khi thay thế.

## 6. Gặp lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| "Docker Desktop chưa chạy" | Mở Docker Desktop, chờ biểu tượng cá voi báo running rồi chạy lại. |
| Docker báo lỗi WSL / Virtualization | Bật Virtualization trong BIOS; mở PowerShell (Admin) chạy `wsl --update`, rồi khởi động lại máy. |
| Mở `localhost:3000` được nhưng tên miền không vào được | Kiểm tra `TUNNEL_TOKEN` trong `.env`; trong Cloudflare, tunnel phải ở trạng thái **Healthy** và Public Hostname phải là `http://app:3000`. Chạy lại `1-khoi-dong.bat`. |
| Báo cổng 3000 đang bị dùng | Có chương trình khác dùng cổng 3000: tắt chương trình đó hoặc khởi động lại máy. |
| Kênh TikTok báo "Không kết nối được" | Kênh phải đang live. Có thể TikTok đang giới hạn: thử lại sau ít phút, hoặc thêm `EULER_API_KEY` vào `.env`. |
| Muốn đổi mật khẩu quản trị | Vào **Cài đặt → Đổi mật khẩu đăng nhập**. (`ADMIN_PASSWORD` trong `.env` chỉ dùng ở lần chạy đầu tiên, sửa sau đó không có tác dụng.) |

## 7. Khi nào nên chuyển sang thuê server?

Khi cần Checklive chạy 24/7 mà không muốn để máy tính bật liên tục, hoặc khi bán tool cho nhiều shop. Lúc đó chuyển sang VPS / Railway + Supabase. Dữ liệu chuyển được bằng bản sao lưu ở mục 5.
