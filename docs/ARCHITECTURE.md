# Kiến trúc — SAVA Marketing Workspace

## Tổng quan

```
┌────────────────────────────┐        ┌──────────────────────────────────────┐
│  Frontend tĩnh (vanilla JS) │        │  Supabase project                    │
│  GitHub Pages, không build  │ HTTPS  │  sava-marketing-workspace (Singapore)│
│                             ├───────►│                                      │
│  config.js: URL + anon key  │  REST/ │  PostgreSQL + RLS (mọi bảng)         │
│  data layer 2 chế độ        │  Auth  │  Auth (email/mật khẩu)               │
└────────────────────────────┘        │  Storage (file/asset nội dung)       │
                                       │  Edge Functions:                     │
        Kênh ngoài (Meta, YouTube…)    │   • publish-worker (theo lịch)       │
              ▲                        │   • sync-worker (theo lịch)          │
              └────────────────────────┤                                      │
                    worker gọi API     └──────────────────────────────────────┘
```

- **Frontend tĩnh:** HTML/CSS/vanilla JS thuần, không framework, không build step. Triển khai bằng GitHub Pages từ chính repo này. Múi giờ hiển thị `Asia/Ho_Chi_Minh`, tuần bắt đầu thứ Hai, ngày `dd/mm/yyyy`, giờ 24h.
- **Backend:** một Supabase project riêng tên `sava-marketing-workspace` (PostgreSQL + Auth + Storage + Row Level Security + Edge Functions). Không dùng chung project với CRM hay hệ thống khác của SAVA.
- **Logic nghiệp vụ thuần** (phụ thuộc task, ngân sách, tỷ lệ ads…) nằm ở `js/domain.js` dạng UMD: trình duyệt nạp bằng thẻ script, Node nạp bằng `module.exports` để chạy kiểm thử (`tests/domain.test.mjs`, `node --test`). Một nguồn sự thật duy nhất cho công thức — frontend và test không tính lệch nhau.

## Data layer 2 chế độ

Tầng truy cập dữ liệu của frontend có đúng 2 chế độ, chuyển đổi theo cấu hình — không trộn lẫn:

1. **Chế độ Supabase (thật):** khi `config.js` có URL + anon key hợp lệ, app đọc/ghi qua Supabase với phiên đăng nhập của người dùng; RLS ở database là lớp bảo vệ cuối cùng (anon key public-safe là nhờ RLS, không phải nhờ giấu key).
2. **Chế độ Demo (minh họa):** khi chưa cấu hình Supabase, app chạy bằng dữ liệu mẫu hoàn toàn ở client để xem trước giao diện/luồng việc. Chế độ này **luôn được gắn nhãn rõ ràng trên giao diện** ("Dữ liệu demo" / trạng thái "Chờ kết nối Supabase"), không ghi gì lên server, và không bao giờ được dùng làm căn cứ nghiệm thu (xem checklist AC01/AC20 trong `docs/SETUP.md`).

Nguyên tắc: dữ liệu demo không được "đổ" thành dữ liệu thật; khi chuyển sang chế độ Supabase, workspace bắt đầu từ schema thật.

## Vì sao worker nằm ở Edge Functions

Việc đăng bài theo lịch và đồng bộ số liệu phải chạy **kể cả khi không có ai mở app**. Nếu để logic này trong tab trình duyệt:

- đóng tab / mất mạng / máy ngủ → job trễ hoặc mất, không ai biết;
- hai tab mở cùng lúc → nguy cơ chạy trùng một job;
- token kênh phải xuất hiện ở client → lộ bề mặt tấn công.

Vì vậy hai tác vụ nền chạy ở **Edge Functions phía server**, được gọi theo lịch (pg_cron hoặc cron ngoài — xem `docs/SETUP.md` bước 3):

- `publish-worker`: nhận các PublishJob đến hạn, gọi API kênh, ghi kết quả **theo từng đích đăng (per-target)**.
- `sync-worker`: kéo số liệu hiệu quả từ các kênh đã kết nối, ghi thành **metric observations** (xem mục dưới).

Worker chạy bằng service role ở phía server; key này không bao giờ xuống client.

## Idempotency + trạng thái publish (§10.3)

- **Idempotency:** mỗi PublishJob mang một khóa idempotency ổn định. Worker xử lý một job theo nguyên tắc kiểm tra-trước-khi-làm: job đã ở trạng thái cuối (`published` / `failed` / `partial`) thì không thực thi lại; lần gọi worker trùng (cron chồng nhau, retry sau timeout) không tạo bài đăng thứ hai cho cùng một đích. Tương tự, sync ghi observations bằng unique key (bên dưới) nên đồng bộ lại cùng một kỳ không nhân đôi số liệu.
- **Trạng thái theo từng đích:** một lần đăng có thể nhắm nhiều đích (nhiều page/kênh). Kết quả được ghi riêng cho từng target:
  - mọi đích thành công → `published`;
  - mọi đích thất bại → `failed`;
  - **một phần thành công, một phần thất bại → `partial`** — đích đã thành công giữ nguyên (không đăng lại), chỉ đích thất bại mới được thử lại hoặc xử lý tay.
- **Retry có kiểm soát:** retry chỉ áp cho đích `failed` và vẫn tôn trọng khóa idempotency của từng đích; lỗi từ kênh (hết hạn token, API lỗi tạm thời…) được ghi kèm thông điệp để Lead xử lý, không nuốt lỗi im lặng.

## TikTok không publish qua app

TikTok là ngoại lệ có chủ đích: app **không** tự đăng TikTok và **không tạo PublishJob** cho TikTok — hàm `shouldCreatePublishJob` trong `js/domain.js` trả `false` cho mọi variant có `platform: 'tiktok'` (kể cả khi `publishMode: 'app'`) và cho mọi variant `publishMode: 'external'` ở bất kỳ platform nào. Với TikTok, app chỉ hỗ trợ: soạn script, quản lý sản xuất, đánh dấu đã đăng ngoài app, lưu link bài đã đăng và theo dõi hiệu quả. Chỉ variant `publishMode: 'app'` trên platform khác TikTok mới sinh PublishJob.

## Tách IMC campaign và ad campaign

Hai khái niệm "campaign" khác nhau được mô hình hoá tách bạch, không gộp chung một bảng/một màn hình:

- **IMC campaign:** chiến dịch truyền thông tích hợp của team — chứa mục tiêu, target audiences, hoạt động & kênh triển khai, chuỗi công việc (tasks + dependencies), nội dung, KPI và ngân sách tổng thể.
- **Ad campaign:** chiến dịch quảng cáo trên nền tảng ads (cấu trúc campaign → ad set → ad), gắn với tài khoản quảng cáo và số liệu chi tiêu/hiệu quả theo cấp.

Ad campaign có thể **liên kết** tới một IMC campaign để quy hiệu quả về đúng chiến dịch tổng, nhưng vòng đời, cấu trúc cấp bậc và số liệu của chúng độc lập. Khi tổng hợp số liệu ads phải chọn đúng **một cấp** để cộng (hàm `pickLevelTotals`) — cộng cả campaign + ad set + ad cùng lúc sẽ đếm trùng chi tiêu nhiều lần.

## Metric observations, unique key và luật lifetime snapshot

- Số liệu hiệu quả được lưu dạng **observations**: mỗi bản ghi là một quan sát tại một thời điểm (`observedAt`) cho một metric của một đối tượng (bài đăng, kênh, ad…), kèm nguồn đồng bộ.
- **Unique key** trên (đối tượng, metric, nguồn, thời điểm/kỳ quan sát) đảm bảo sync lại không tạo bản ghi trùng — nền tảng cho idempotency của `sync-worker`.
- **Phân biệt metric cộng dồn theo kỳ và metric lifetime:**
  - Metric theo kỳ (ví dụ impressions trong ngày) mới được cộng qua các kỳ; tỷ lệ (CTR, CPC, CPM, cost per result, ROAS) **luôn** tính lại từ tổng tử / tổng mẫu của kỳ gộp (hàm `aggregateRates`), không lấy trung bình cộng của các tỷ lệ từng dòng.
  - Metric **lifetime** (ví dụ tổng lượt xem tích luỹ của một bài/kênh) là **snapshot**: giá trị đúng là snapshot **mới nhất theo `observedAt`** (hàm `latestLifetimeSnapshot`) — cộng các snapshot lại là sai (100 + 150 + 200 ≠ 450 lượt xem; đáp án đúng là 200).
  - **Reach là metric unique** (một người xem nhiều lần chỉ tính một): không cộng reach qua các kỳ/đối tượng — hàm `sumUniqueReachGuard` trả `summable: false` cho reach để mọi màn hình tổng hợp phải tôn trọng.
- **Thiếu dữ liệu thì nói thiếu:** mẫu số bằng 0 hoặc chưa có số liệu thì tỷ lệ/KPI hiển thị trạng thái thiếu ("Chưa cập nhật", giá trị `null` ở tầng logic) — không suy diễn, không lấp bằng số 0 giả.

## Ngân sách và cam kết chi

Ngân sách theo dòng (line) có số **approved**; số còn lại được tính ở `js/domain.js` (`budgetRemaining`):

```
remaining = approved − Σ actuals − Σ phần còn mở của các commitment đang open
phần còn mở của một commitment = amount − Σ actuals gắn với commitment đó
```

Commitment đã `settled` hoặc `cancelled` không bị trừ thêm ngoài actual đã ghi — tránh trừ trùng một khoản chi hai lần.

## Ranh giới tích hợp CRM trong tương lai

Marketing Workspace **độc lập** với SAVA CRM ở giai đoạn này: không đồng bộ hai chiều, không ghi vào hệ thống của team khác. Ranh giới chuẩn bị cho tương lai chỉ gồm:

- dùng **ID ổn định** (UUID) cho các thực thể có khả năng liên kết sau này (campaign, nội dung, liên hệ/lead nếu phát sinh);
- giữ khả năng truy cập qua **API có RLS** của Supabase làm bề mặt tích hợp duy nhất khi có quyết định kết nối.

Ngoài hai điểm chuẩn bị đó: **chưa có sync, chưa có mapping dữ liệu, chưa có tài khoản máy chung**. Mọi tích hợp thật phải có quyết định riêng của Zac trước khi triển khai.
