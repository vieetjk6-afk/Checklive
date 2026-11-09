# Checklive — Kế hoạch sản phẩm (bản nháp v0.1)

> Webapp theo dõi phiên live Facebook & TikTok: gom bình luận, thống kê tương tác, chạy game show và chốt đơn bằng mã sản phẩm.
> Tài liệu này là bản định hướng để thống nhất trước khi code. Các mục đánh dấu **[CẦN CHỐT]** phụ thuộc câu trả lời ở mục 7.

---

## 1. Tóm tắt khuyến nghị

| Hạng mục | Đề xuất |
|---|---|
| Hình thức | **Webapp** (máy tính + điện thoại), có thêm **trang Overlay** để gắn vào OBS / TikTok LIVE Studio |
| Facebook | **API chính thức (Graph API)** qua quyền quản trị **Fanpage** — ổn định, hợp lệ, còn cho phép trả lời, ẩn bình luận và nhắn tin riêng |
| TikTok | Chưa có API chính thức để đọc live → dùng **thư viện kết nối không chính thức** (`tiktok-live-connector`). Thư viện này cho nhiều dữ liệu nhưng có rủi ro (xem mục 6) |
| Kiến trúc | Tách **Live Worker** (giữ kết nối live chạy nền) khỏi **Webapp**; mọi sự kiện từ 2 nền tảng được chuẩn hoá về **1 định dạng chung**, sau đó đi qua bộ xử lý luật (game / chốt đơn / thống kê) |
| Ngôn ngữ | **TypeScript toàn bộ** (Node.js). Thư viện TikTok tốt nhất hiện nay viết cho Node |
| Bán hàng | Kho sản phẩm → giỏ hàng phiên live có **mã live (A1, A2…)** → bình luận mã thì tự tạo đơn nháp và giữ hàng → **khách tự xác nhận qua link** → thanh toán VietQR (tự đối soát) hoặc COD |

---

## 1b. Quyết định đã chốt (09/11/2026)

| # | Câu hỏi | Trả lời | Ảnh hưởng tới thiết kế |
|---|---|---|---|
| A1 | Dùng cho ai | Cá nhân trước, sau bán cho shop thu phí | Dữ liệu đã gắn `shopId` từ đầu. Đăng nhập Facebook bằng OAuth + Meta App Review để giai đoạn bán tool |
| A2 | Theo dõi kênh người khác | Có | TikTok: làm được ngay. Facebook: API **không** cho đọc Page người khác → xem mục 2b |
| A3 | Fanpage hay trang cá nhân | Cả hai | Fanpage: API chính thức. Trang cá nhân: API **không** hỗ trợ → xem mục 2b |
| A4 | Gộp FB + TikTok | Có | Một phiên gồm nhiều kênh, thống kê gộp và tách theo nền tảng ✅ |
| A5 | Quy mô | 1 tài khoản chạy 1 live cùng lúc | Mỗi kênh chỉ được chạy trong 1 phiên tại một thời điểm ✅ |
| A6 | Rủi ro TikTok không chính thức | Chấp nhận | Dùng `tiktok-live-connector`, thiết kế adapter để thay nhà cung cấp dễ dàng ✅ |
| B7 | Ngành hàng | Đa dạng | Biến thể sản phẩm dạng **thuộc tính tự do** (màu, size, vị, dung tích…), không cố định |
| B8 | Kho | Checklive tự quản, xuất Excel | Chưa đồng bộ phần mềm khác |
| B9 | Cú pháp mã | Tự đặt mã trong phiên, có "chốt", có số lượng | Mã live tự đặt + bình luận "chốt"/"+1" gán cho SP đang bán + đọc số lượng |
| B10 | Xác nhận đơn | Khách quét QR tự xác nhận + nhân viên xác nhận và chốt | Trang xác nhận qua QR/link + màn hình nhân viên duyệt đơn |
| B11 | Thanh toán | COD + chuyển khoản | VietQR + đối soát tự động |
| B12 | In phiếu / vận chuyển | Làm sau | Để giai đoạn 4 |
| B13 | TikTok Shop | Chưa dùng | Chốt đơn qua bình luận TikTok không vướng chính sách TikTok Shop |
| C14 | Game | Đoán số quay, đoán chữ… | Vòng quay số + đoán số, ô chữ mở dần, đố vui, quay may mắn |
| C15 | Thiết bị live | Điện thoại, máy tính, OBS | Overlay cho OBS/TikTok LIVE Studio. Khi live bằng điện thoại: điều khiển game trên thiết bị thứ hai, công bố kết quả bằng bình luận trả lời (FB) |
| C16 | Điều kiện chơi game | Like, share, follow | **Chỉ TikTok kiểm tra được.** Facebook chỉ kiểm tra được "đã bình luận" |
| D17 | Ưu tiên | Thống kê → Bán hàng → Game | Đúng thứ tự lộ trình mục 5 |
| D18 | Server, Meta Business | Chưa có | Đóng gói Docker để chạy trên VPS bất kỳ. Giai đoạn đầu dùng token dán tay (không cần Meta duyệt app) |
| D19 | App điện thoại | Webapp là đủ | Giao diện responsive ✅ |

---

## 2. Thực tế kỹ thuật: lấy được gì từ mỗi nền tảng

Phần này quyết định giới hạn của sản phẩm, nên cần đọc kỹ.

| Dữ liệu | Facebook (Fanpage, API chính thức) | TikTok (kết nối không chính thức) |
|---|---|---|
| Bình luận realtime + tên người bình luận | ✅ (ID người dùng theo Page, tên) | ✅ (username, nickname, avatar) |
| Like / thả cảm xúc | ✅ tổng số. ⚠️ danh sách **ai** đã thả bị hạn chế | ✅ từng lượt like **kèm người like** và số lần |
| Share | ⚠️ chỉ có tổng số (không đầy đủ). ❌ gần như **không biết ai share** | ✅ sự kiện share **kèm người share** |
| Người xem đồng thời | ✅ | ✅ |
| Quà tặng | ⚠️ hạn chế (Stars) | ✅ quà, người tặng, giá trị (kim cương) |
| Follow mới, người vào phòng | ❌ | ✅ |
| Trả lời / ẩn bình luận | ✅ | ❌ (chỉ đọc) |
| Nhắn tin riêng cho người bình luận | ✅ (Private Reply qua Messenger, 1 lần/bình luận) | ❌ |
| Live trên **trang cá nhân / Group** | ❌ API không hỗ trợ | — |
| Đọc live của **kênh người khác** | ❌ (cần quyền đặc biệt, rất khó được duyệt) | ✅ chỉ cần @username, live công khai |
| Độ ổn định | Cao | Trung bình: có thể gián đoạn khi TikTok thay đổi |
| Độ trễ bình luận | Vài giây | ~1 giây |

**Lưu ý với Facebook:**
- Mặc định Facebook **lọc bớt bình luận "chất lượng thấp"** trên live. Cần tắt bộ lọc này (`live_filter=no_filter`) để không sót bình luận chốt đơn hoặc trả lời game.
- Thời gian bình luận của Facebook chỉ chính xác đến **giây**. Khi nhiều người trả lời đúng trong cùng 1 giây, hệ thống xếp hạng theo thứ tự nhận được. Cần nói rõ điều này trong thể lệ game.
- Để dùng cho Fanpage của **người khác** (bán tool), Meta App phải qua **App Review** và **Business Verification** (thường mất 1–4 tuần). Nếu chỉ dùng cho Fanpage của bạn, có thể chạy ngay ở chế độ phát triển (admin/tester của app).

### 2b. Facebook trang cá nhân và Fanpage của người khác

API chính thức của Facebook không đọc được live trên **trang cá nhân** và live của **Fanpage người khác**. Phương án đề xuất (làm sau, khi phần chính đã ổn):

- **Tiện ích trình duyệt Chrome "Checklive Connector"**: admin mở trang live trên trình duyệt máy tính. Tiện ích đọc bình luận đang hiển thị trên trang và gửi về Checklive như một kênh bình thường.
- Ưu điểm: dùng tài khoản và phiên đăng nhập của chính admin, không cần quyền API.
- Nhược điểm:
  - Phải mở sẵn tab live trên máy tính trong suốt buổi.
  - Dễ hỏng khi Facebook đổi giao diện.
  - Chỉ đọc được những gì trang hiển thị: tên và bình luận, không có ID ổn định, không có số người xem chính xác.
  - Không trả lời hay ẩn bình luận tự động được.
- **Không khuyến khích** cách chạy trình duyệt ẩn trên server bằng cookie tài khoản: dễ bị Facebook khoá tài khoản (checkpoint).

---

## 3. Kiến trúc đề xuất

```
 Facebook Graph API (stream/poll)        TikTok LIVE (WebSocket qua connector)
                 \                                  /
                  +------- LIVE WORKER (Node.js) --+
                          - mỗi phiên live = 1 kết nối
                          - tự kết nối lại khi rớt
                          - chuẩn hoá về "LiveEvent" chung
                                     |
                              Redis (hàng đợi + pub/sub)
                                     |
          +--------------------------+---------------------------+
          |                          |                           |
   Bộ máy GAME               Bộ máy CHỐT ĐƠN              Bộ máy THỐNG KÊ
   (khớp đáp án,            (đọc mã, biến thể,           (đếm theo phút, top
    xếp hạng)                số lượng, giữ hàng)          người dùng, đỉnh xem)
          |                          |                           |
          +--------------- PostgreSQL (lưu trữ) -----------------+
                                     |
                         Socket.IO (đẩy realtime)
               /                     |                       \
     Webapp quản trị         Trang Overlay (OBS)       Trang khách hàng
     (Next.js)               game / SP đang bán        xác nhận đơn, thanh toán
```

**Định dạng sự kiện chung (LiveEvent):**
`{ nền tảng, phiên live, loại (comment | like | share | gift | follow | join | viewer_count), người dùng {id, tên, avatar}, nội dung, số lượng, thời gian theo nền tảng, thời gian nhận, dữ liệu gốc }`
→ Game, chốt đơn và thống kê **không cần biết** sự kiện đến từ FB hay TikTok. Sau này thêm YouTube, Shopee Live… chỉ cần viết thêm 1 bộ chuyển đổi (adapter).

**Công nghệ (đang dùng):**
- Frontend: React + Vite + Tailwind. Webapp quản trị không cần SEO nên chọn SPA cho gọn, thay vì Next.js.
- Backend: Fastify + Socket.IO + Prisma, viết bằng TypeScript.
- CSDL: PostgreSQL.
- Hàng đợi: hiện xử lý trong cùng tiến trình, đủ cho quy mô 1 live/kênh. Khi bán tool cho nhiều shop sẽ thêm Redis và tách Live Worker riêng. Phần adapter đã tách sẵn nên không phải viết lại.
- Triển khai: Docker Compose trên VPS (khởi điểm 2 vCPU / 4 GB RAM), domain + HTTPS.

---

## 4. Các module chức năng

### 4.1 Tài khoản & kết nối kênh
- Đăng nhập, quản lý shop. Phân quyền: **Chủ shop**, **Nhân viên chốt đơn**, **Người điều khiển game**.
- Kết nối Facebook: "Đăng nhập bằng Facebook" → chọn Fanpage → lưu token dài hạn.
- Kết nối TikTok: nhập @username.
- **Phiên live**: tạo trước (gắn sản phẩm, kịch bản game) → hệ thống **tự phát hiện khi kênh lên sóng** và bắt đầu ghi nhận. Một phiên có thể gộp **nhiều kênh cùng lúc** (FB + TikTok). **[CẦN CHỐT]**

### 4.2 Bảng điều khiển trong lúc live
- Luồng bình luận realtime gộp từ các nền tảng, có bộ lọc: có mã SP, có SĐT, câu hỏi, khách cũ/mới, khách bị cảnh báo.
- Tô sáng: mã sản phẩm, số điện thoại, khách VIP, khách "bom hàng".
- Thao tác nhanh trên từng bình luận: tạo đơn thủ công, trả lời (FB), ẩn (FB), gắn tag, chặn.
- Chỉ số realtime: người xem hiện tại / đỉnh, bình luận/phút, số người bình luận (không trùng), like, share, quà, follow.

### 4.3 Thống kê & báo cáo
- Biểu đồ người xem và bình luận theo thời gian, có **đánh dấu mốc** (bắt đầu bán A1, bắt đầu game 2…) để thấy sản phẩm hay game nào kéo tương tác.
- Top người bình luận / like / share / tặng quà.
- Từ khoá nổi bật. Tuỳ chọn: AI phân loại bình luận (hỏi giá, hỏi size, khen, chê, spam).
- So sánh giữa các phiên; xuất Excel.

### 4.4 Game show
**Các loại game đề xuất:**

| Game | Cách ghi nhận |
|---|---|
| Đố vui – trả lời nhanh | Lấy **N người đầu tiên** trả lời đúng |
| Đoán số / đoán giá | Người đoán gần nhất (tuỳ chọn: không vượt quá) |
| Ai bình luận từ khoá nhanh nhất | Người đầu tiên có từ khoá |
| Quay số may mắn | Bốc ngẫu nhiên từ danh sách người hợp lệ |
| Bình chọn | Đếm phiếu A/B/C, hiện tỉ lệ |
| Quiz nhiều vòng | Cộng điểm, bảng xếp hạng tích luỹ |

**Cấu hình mỗi game:**
- Câu hỏi, **nhiều đáp án chấp nhận**. Khi so khớp: bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng và ký tự thừa, tuỳ chọn chấp nhận sai 1 ký tự.
- Mở/đóng bằng nút bấm hoặc đếm ngược.
- Mỗi người chỉ tính **câu trả lời đầu tiên**, không tính bình luận đã sửa.
- Loại trừ: tài khoản Page/nhân viên, danh sách đen.
- Điều kiện thêm (chỉ TikTok kiểm tra được): đã like / share / follow / tặng quà.
- Giới hạn số người thắng, chọn nền tảng áp dụng.

**Vận hành:** soạn sẵn **kịch bản game** trước buổi live, khi live chỉ bấm "Câu tiếp theo". Mọi bình luận được **lưu log kèm thời gian** để xuất bằng chứng khi có khiếu nại.
**Overlay:** câu hỏi, đồng hồ đếm ngược, người thắng, bảng xếp hạng.

### 4.5 Bán hàng (đề xuất đầy đủ)

**Luồng tổng thể:**
```
Kho sản phẩm ─► Giỏ hàng phiên live (gán mã A1, A2…) ─► Live: bật "Đang bán" A1
      ─► Khách bình luận "A1 đỏ M 2" ─► Đơn nháp + GIỮ HÀNG
      ─► Gửi link xác nhận cho khách ─► Khách điền thông tin, chọn thanh toán
      ─► Đã thanh toán / COD ─► Đóng gói, giao hàng ─► Hoàn tất
```

**1. Kho sản phẩm (dùng chung cho mọi phiên)**
Tên, ảnh, mô tả, **biến thể** (màu, size…), SKU, giá gốc, tồn kho, cân nặng (để tính phí ship).

**2. Giỏ hàng phiên live**
- Chọn sản phẩm từ kho vào phiên. Mỗi sản phẩm có **mã live** (tự sinh A1, A2… hoặc tự đặt), **giá live**, số lượng mở bán trong phiên, giới hạn mỗi khách, thứ tự lên sóng.
- Trạng thái: *Chờ* → **Đang bán** → *Đã đóng* / *Hết hàng*.
- Hai chế độ nhận đơn: (a) chỉ nhận mã của sản phẩm **đang bán**; (b) nhận mọi mã có trong phiên.
- Bình luận ngắn như "chốt", "lấy", "+1" → tự gán cho sản phẩm **đang bán**.

**3. Đọc cú pháp bình luận (cấu hình được)**
- Ví dụ: `A1`, `A1 2`, `A1 x2`, `A1 đỏ M`, `a1 do m 2`, `A1 + A3`.
- Nhận diện: mã SP, biến thể (từ điển đồng nghĩa: đỏ / do / red), số lượng, **số điện thoại**.
- Thiếu biến thể hoặc không rõ → đơn vào trạng thái **"Cần xác nhận"** để nhân viên xử lý.

**4. Giữ hàng & danh sách chờ**
- Bình luận hợp lệ → **trừ tồn tạm** ngay, ai bình luận trước được trước.
- Hết hàng → vào **danh sách chờ**. Khách huỷ hoặc quá hạn không xác nhận (ví dụ 24 giờ) → hàng tự chuyển cho người chờ tiếp theo.

**5. Gom đơn theo khách**
Một khách bình luận nhiều lần, nhiều sản phẩm → **gom vào 1 giỏ/đơn** trong phiên (tránh tách nhiều đơn, tốn phí ship).

**6. Khách tự xác nhận đơn**
- **Facebook:** tự động trả lời bình luận ("Đã nhận đơn A1, bạn kiểm tra tin nhắn nhé") và **gửi tin nhắn riêng** kèm link trang xác nhận đơn: xem giỏ, điền tên/SĐT/địa chỉ, chọn thanh toán. Khách cũ được điền sẵn thông tin.
- **TikTok:** không gửi tin nhắn tự động được. Thay vào đó:
  - Overlay hiện "@user đã chốt A1".
  - **Trang tra cứu đơn** công khai: khách nhập @username TikTok hoặc mã đơn để xác nhận.
  - Mã QR dẫn tới trang này hiện thường trực trên màn hình live.
- Tự động **ẩn bình luận có số điện thoại** (FB) để bảo vệ thông tin khách và tránh đối thủ lấy khách.

**7. Thanh toán**
- COD.
- Chuyển khoản **VietQR động**: nội dung chuyển khoản = mã đơn. Tự đối soát qua dịch vụ webhook ngân hàng (SePay, Casso…) → đơn tự chuyển sang **"Đã thanh toán"**.
- Khách có lịch sử bom hàng → bắt buộc chuyển khoản trước.

**8. Sau live**
- Danh sách đơn theo trạng thái, gọi xác nhận, in phiếu.
- Xuất Excel hoặc **đẩy đơn sang hãng vận chuyển** (GHN, GHTK, Viettel Post, J&T…) hoặc phần mềm bán hàng đang dùng. **[CẦN CHỐT]**

**9. Quản lý khách hàng**
Lịch sử mua, tỉ lệ nhận hàng/bom hàng, tag VIP, danh sách đen (tô đỏ khi họ bình luận). Liên kết cùng 1 khách giữa FB và TikTok qua số điện thoại.

**10. Overlay bán hàng**
Sản phẩm đang bán (ảnh, tên, giá, mã, **còn X cái**), dòng chạy "Nguyễn A vừa chốt A1", đồng hồ flash sale.

**11. Báo cáo bán hàng**
Doanh thu theo phiên và theo sản phẩm. **Phễu chuyển đổi:** bình luận → đơn nháp → xác nhận → thanh toán → giao thành công.

**Trạng thái đơn:**
`Nháp` → `Chờ khách xác nhận` → `Đã xác nhận` → `Đã thanh toán / COD` → `Đang giao` → `Hoàn tất` (hoặc `Huỷ` / `Hoàn hàng`)

---

## 5. Lộ trình (ước lượng sơ bộ, 1 dev full-time)

| Giai đoạn | Nội dung | Thời gian |
|---|---|---|
| **0. Thử nghiệm kỹ thuật** | Kết nối Fanpage + TikTok thật, nhận bình luận realtime, lưu DB, đo độ trễ | ~1 tuần — **code xong, cần chạy thử với kênh thật** |
| **1. Nền tảng** | Tài khoản, kết nối kênh, phiên live, bảng điều khiển realtime, thống kê cơ bản, xuất Excel | 3–4 tuần — **bản đầu đã xong** (xem README) |
| **2. Bán hàng** | Kho SP, giỏ phiên live, đọc cú pháp, đơn nháp, giữ hàng, trang xác nhận, nhắn tin FB, overlay SP | 3–4 tuần |
| **3. Game show** | Các loại game, kịch bản, overlay game, xuất log | 2–3 tuần |
| **4. Mở rộng** | VietQR + đối soát, vận chuyển, AI phân loại bình luận, báo cáo nâng cao, đa shop + gói cước | tuỳ chọn |

Thứ tự giai đoạn 2 và 3 có thể đảo, tuỳ bạn cần tính năng nào trước. **[CẦN CHỐT]**

---

## 6. Rủi ro & lưu ý

1. **TikTok không chính thức:** có thể vi phạm điều khoản TikTok, có thể gián đoạn khi TikTok thay đổi, và phụ thuộc dịch vụ ký request bên thứ ba (Euler Stream có gói miễn phí giới hạn, gói trả phí cho nhu cầu lớn).
   → Giảm rủi ro: thiết kế adapter để **thay nhà cung cấp dễ dàng**, có cảnh báo khi mất kết nối, tự kết nối lại.
2. **TikTok Shop:** nếu shop bán qua TikTok Shop, việc kéo khách chốt đơn ngoài sàn qua bình luận **có thể vi phạm chính sách** của TikTok Shop. Cần cân nhắc.
3. **Facebook:** chỉ hỗ trợ Fanpage. Nhắn tin riêng tuân theo chính sách Messenger (Private Reply 1 lần/bình luận, trong thời hạn cho phép). Muốn bán tool cho shop khác thì phải qua App Review.
4. **Dữ liệu cá nhân:** hệ thống lưu SĐT, địa chỉ khách → cần tuân thủ quy định bảo vệ dữ liệu cá nhân của Việt Nam (Nghị định 13/2023, Luật Bảo vệ dữ liệu cá nhân 2025), có chính sách quyền riêng tư.
5. **Game có thưởng:** chương trình có yếu tố may rủi (quay số) và giải thưởng giá trị có thể phải thông báo/đăng ký khuyến mại với Sở Công Thương.

---

## 7. Câu hỏi cần chốt

*(Mỗi câu có gợi ý mặc định. Câu nào bạn đồng ý mặc định thì chỉ cần ghi "OK".)*

**A. Phạm vi**
1. Tool dùng **cho shop của bạn** hay **bán cho nhiều shop** (SaaS thu phí)? — *Mặc định: thiết kế đa shop ngay từ đầu, nhưng ra mắt trước cho shop của bạn.*
2. Chỉ theo dõi live **kênh của mình**, hay cả live **kênh người khác** (đối thủ, KOL)? Với Facebook, chỉ đọc được Fanpage mình quản trị.
3. Facebook live trên **Fanpage**, hay trên trang cá nhân / Group? Trang cá nhân và Group không dùng API được.
4. Có live **đồng thời FB + TikTok** và cần gộp đơn/game chung không? — *Mặc định: có.*
5. Quy mô: bao nhiêu phiên live **cùng lúc**? Mỗi phiên khoảng bao nhiêu người xem và bình luận?
6. Bạn có chấp nhận rủi ro của kết nối TikTok không chính thức (mục 6.1) không?

**B. Bán hàng**
7. Ngành hàng chính là gì (thời trang có size/màu, mỹ phẩm, thực phẩm…)?
8. Đang dùng phần mềm bán hàng/kho nào (KiotViet, Sapo, Haravan, Pancake, Nhanh.vn, Excel…)? Cần đồng bộ tồn kho, hay để Checklive tự quản kho? — *Mặc định: Checklive tự quản kho, xuất Excel.*
9. Cú pháp mã mong muốn: `A1/A2`, mã SKU hay số thứ tự? Có dùng "chốt"/"+1" cho sản phẩm đang bán không? — *Mặc định: A1/A2 + có "chốt".*
10. Khách xác nhận đơn bằng **link tự xác nhận** (đề xuất), nhân viên gọi/inbox, hay cả hai? Giữ hàng tối đa bao lâu? — *Mặc định: cả hai, giữ 24 giờ.*
11. Thanh toán: COD, chuyển khoản (có cần tự đối soát?), hay cả hai?
12. Vận chuyển: tự in phiếu, hay cần kết nối hãng (hãng nào)?
13. Bạn có bán qua **TikTok Shop** không?

**C. Game**
14. Bạn hay chạy loại game nào? Cho tôi **1–2 ví dụ thực tế** (câu hỏi, cách trao thưởng).
15. Bạn live bằng **điện thoại** hay **máy tính (OBS / TikTok LIVE Studio)**? Overlay chỉ gắn được khi live bằng máy tính.
16. Điều kiện hợp lệ của người chơi: chỉ cần bình luận đúng, hay phải like/share/follow (chỉ TikTok kiểm tra được)?

**D. Vận hành**
17. Thứ tự ưu tiên: **Thống kê / Bán hàng / Game**: cái nào cần dùng trước?
18. Đã có **server, domain, Meta Business đã xác minh** chưa? Ngân sách hạ tầng mỗi tháng khoảng bao nhiêu?
19. Nhân viên cần **app điện thoại**, hay webapp chạy tốt trên điện thoại là đủ? — *Mặc định: webapp responsive.*
20. Giao diện chỉ tiếng Việt? — *Mặc định: tiếng Việt.*
