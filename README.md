# Checklive

Webapp theo dõi phiên live Facebook & TikTok: gom bình luận, thống kê tương tác, chạy game show và chốt đơn bằng mã sản phẩm.

- Kế hoạch sản phẩm và các quyết định đã chốt: [docs/KE-HOACH.md](docs/KE-HOACH.md)

## Đã làm được (Giai đoạn 0 + 1: Thống kê)

- Đăng nhập quản trị.
- Quản lý kênh: **TikTok** (@username hoặc link, theo dõi được cả kênh người khác), **Fanpage Facebook** (Page ID + Page access token), **kênh giả lập** để thử khi chưa có live thật.
- Phiên live gộp nhiều kênh (FB + TikTok cùng lúc). Mỗi kênh chỉ chạy trong 1 phiên tại một thời điểm.
- Tự chờ kênh lên sóng, tự kết nối lại khi rớt mạng, tự phát hiện live kết thúc.
- Bảng điều khiển realtime:
  - Người xem hiện tại / cao nhất, bình luận, số người bình luận, like, share, follow, quà (kim cương).
  - Biểu đồ bình luận và người xem theo phút.
  - Top người tương tác (bình luận / like / share / quà).
  - Luồng bình luận gộp các nền tảng: tìm kiếm không dấu, lọc theo nền tảng, lọc bình luận **có số điện thoại** (tô sáng), tạm dừng cuộn.
  - Danh sách share / follow / quà mới nhất.
- Lưu toàn bộ vào PostgreSQL; xem lại phiên cũ; **xuất Excel** (Tổng quan, Bình luận, Người tham gia, Theo phút).
- Giao diện dùng tốt trên điện thoại.

## Chạy bằng Docker (khuyên dùng khi đưa lên VPS)

```bash
cp .env.example .env      # sửa JWT_SECRET và ADMIN_PASSWORD
docker compose up -d --build
```

Mở `http://<địa-chỉ-máy>:3000`, đăng nhập bằng `ADMIN_EMAIL` / `ADMIN_PASSWORD` trong `.env`.

## Chạy để phát triển

Cần Node.js 22+ và PostgreSQL 16.

```bash
npm install
cp server/.env.example server/.env        # sửa DATABASE_URL, JWT_SECRET…
npm run db:migrate -w server               # tạo bảng
npm run dev:server                         # API + realtime: http://localhost:3000
npm run dev:web                            # giao diện: http://localhost:5173
```

Kiểm thử:

```bash
npm test                                                     # unit test
TEST_DATABASE_URL=postgresql://.../checklive_test npm test   # thêm test tích hợp (cần CSDL test đã migrate)
```

## Kết nối Facebook (Fanpage)

Facebook chỉ cho đọc live của **Fanpage bạn quản trị** qua API chính thức. Cách lấy Page access token khi đang dùng cho shop của bạn (chưa cần Meta duyệt app):

1. Vào [developers.facebook.com](https://developers.facebook.com) → **Tạo ứng dụng** (loại Business).
2. Mở **Graph API Explorer**, chọn ứng dụng vừa tạo, thêm các quyền: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`. Bấm **Generate Access Token** và cho phép truy cập Fanpage.
3. Đổi sang token dài hạn: mở **Access Token Debugger**, dán token, bấm **Extend Access Token**.
4. Quay lại Graph API Explorer với token dài hạn, gọi `GET /me/accounts`. Lấy `id` (Page ID) và `access_token` (Page access token) của Fanpage.
5. Trong Checklive → **Kênh** → **Fanpage**: dán Page ID và Page access token → **Kiểm tra**.

Ghi chú:

- Danh sách quyền Meta yêu cầu có thể thay đổi. Nếu bấm **Kiểm tra** báo thiếu quyền, thêm quyền được nêu trong thông báo lỗi rồi lấy lại token.
- Facebook chỉ cung cấp **tổng số** cảm xúc. Không biết ai đã like, không có số share và follow theo từng người.
- Bước sau (bán tool cho shop khác) sẽ thay việc dán token bằng nút "Đăng nhập bằng Facebook", và cần Meta duyệt app.

## Kết nối TikTok

- Chỉ cần @username, không cần đăng nhập. Dùng thư viện **không chính thức** [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector), nên có thể gián đoạn khi TikTok thay đổi.
- Nên đăng ký API key miễn phí tại [Euler Stream](https://www.eulerstream.com) và điền vào `EULER_API_KEY` để kết nối ổn định hơn.
- TikTok cung cấp chi tiết theo từng người: bình luận, like, share, follow, quà, người vào phòng.

## Cấu trúc

```
server/   API (Fastify) + Socket.IO + bộ kết nối nền tảng + thống kê + Prisma/PostgreSQL
  src/adapters/   tiktok.ts, facebook.ts, simulator.ts — mỗi nền tảng 1 bộ chuyển đổi về định dạng sự kiện chung
  src/live/       sessionManager.ts (chạy phiên), stats.ts (tổng hợp), persistence.ts, exportXlsx.ts
web/      Giao diện React + Vite + Tailwind
docs/     Kế hoạch sản phẩm
```
