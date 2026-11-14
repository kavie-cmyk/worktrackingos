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

## Hợp đồng Store vòng R1 (store/contract)

- **Một helper gọi Supabase duy nhất (R12):** mọi đường ghi/đọc trong
  `js/store.js` đi qua `Store._attempt(step, query, { requireRows })` (và
  `Store._rpc(name, args)` cho RPC) — helper kiểm `res.error` trên promise
  *resolved* (không chỉ catch rejection) và row count khi cần. Ghi nhiều
  bước không atomic được trả `{ ok:false, partial:true, failedStep, item }`
  rõ ràng; UI không bao giờ nhận `ok` giả cho bước đã lỗi.
- **Trạng thái tải theo collection (R13):** `Store.loadState[collection] =
  { status: 'idle|loading|ready|error|denied|empty|stale', error, updatedAt }`,
  đọc qua `Store.getLoadState(collection)`. `403/42501` → `denied`; lỗi khác
  → `error`; refresh lỗi khi đã có dữ liệu cũ → `stale` và **giữ dữ liệu
  cũ**; tải thành công 0 dòng → `empty` (phân biệt với lỗi).
- **Permissions + validation dùng chung (R32/R30):** matrix
  `PERMISSIONS` (roles owner/lead/member/ceo × actions như
  `task.updateStatus`, `campaign.edit`, `budget.edit`, `approval.decide`,
  `publish.create`, `settings.manage`) và validation (date range theo
  `Asia/Ho_Chi_Minh` — `todayISO` không dùng UTC, parent/dependency cycle,
  số hợp lệ) nằm ở `js/store-core.js`; demo adapter và Supabase adapter
  cùng kiểm một bộ này trước khi ghi. CEO chỉ đọc ở cả hai chế độ.
- **Duyệt = RPC (R27):** quyết định duyệt chỉ qua
  `decide_approval(p_step_id, p_revision_id, p_decision, p_comment)`;
  gửi duyệt qua `submit_for_review(p_variant_id)`. Sửa caption/media của
  variant tạo `content_revisions` **mới** rồi cập nhật
  `content_variants.current_revision_id` (backend trigger tự invalidate
  duyệt khi revision đổi). `revisionId` khi decide lấy từ state đang hiển
  thị — store không tự fetch "latest"; RPC trả `REVISION_MISMATCH` thì
  store dịch thành lỗi "Nội dung đã thay đổi, cần tải lại".
- **PublishJob (R28):** `createPublishJob(variant, { accountId,
  scheduledAt|null, decisionId })` — thiếu `decisionId` thì từ chối;
  `scheduledAt = null` nghĩa là đăng ngay (`scheduled_at = now`);
  `idempotency_key` = hash ổn định của
  variant+revision+account+slot lịch (khớp phút) nên double-click cùng
  intent tạo cùng một key; snapshot chứa `decision_id`, `revision_id` và
  `approved_hash`; cột `publish_jobs.decision_id` ghi cùng job.
- **Mapping & metric (R15/R16):** gắn campaign cho bài đã đăng chỉ qua
  `post_content_mappings` (insert/delete), không update `external_posts`
  để gắn. Metric TikTok qua `saveTiktokMetrics(variantId, metrics,
  source)`: có external post đã map → observation
  `object_type='external_post'`; chưa có → `object_type='content_variant'`,
  `object_id=variantId`.
- **Assets (R17):** `assets.approval_status` (draft/in_review/approved)
  tách khỏi `assets.status` (active/archived); version thật =
  `max(asset_versions.version_no)` — tạo asset sinh version 1, sửa nội
  dung asset sinh version mới.
- **Archive thay hard-delete (R31):** `Store.remove*` đặt `archived_at`
  cho entity chính (danh sách `ARCHIVABLE_TABLES` ở store-core, khớp
  migration 0005), `Store.restore*` gỡ archive; `list()` mặc định lọc
  archived. Archive variant còn huỷ publish_jobs đang chờ của variant.
- **Sync status (R29):** trạng thái sync từ server được giữ nguyên trạng
  (`recordSyncStatus` không tự nâng `incomplete` thành `complete`).

### Chốt contract R1 (11/11/2026, migrations 0004–0008 đã áp live)

Tóm tắt các bất biến đã kiểm chứng ở vòng sửa QA R1 — chi tiết từng mục ở
các gạch đầu dòng ngay trên:

- **Duyệt chỉ qua RPC:** gửi duyệt chỉ qua `submit_for_review(p_variant_id)`
  và quyết định chỉ qua `decide_approval(p_step_id, p_revision_id,
  p_decision, p_comment)` (migration 0004). Client **không** được sửa trực
  tiếp các cột duyệt nhạy cảm của `content_variants` (`approval_status`,
  `approved_revision_id`, `publishing_status`, `editorial_status` sang
  trạng thái duyệt) — trigger `guard_content_variant_sensitive` ở backend
  chặn đường ghi trực tiếp; `content_revisions` là **bất biến** (chặn
  UPDATE, DELETE chỉ dành cho service_role/postgres), muốn sửa nội dung
  thì tạo revision mới và đổi `current_revision_id` (đổi revision tự
  invalidate quyết định duyệt cũ; thứ tự trigger đã chốt ở migration 0008).
- **Store:** mọi đọc/ghi qua `Store._attempt`/`Store._rpc`; trạng thái tải
  theo collection qua `Store.loadState`/`loadStateOf` ở UI (loading /
  error / denied / stale giữ dữ liệu cũ / empty phân biệt với lỗi).
- **Publish job:** `createPublishJob(variant, { accountId, scheduledAt,
  decisionId })` — bắt buộc có `decision_id` của quyết định duyệt,
  `idempotency_key` ổn định theo variant+revision+account+slot lịch,
  `scheduledAt = null` nghĩa là **đăng ngay** (`scheduled_at = now`).
- **Archive thay hard-delete:** `remove` đặt `archived_at` cho entity
  chính (migration 0005), `restore` gỡ archive; danh sách mặc định ẩn
  mục đã archive.
- **PERMISSIONS dùng chung:** một matrix duy nhất ở `js/store-core.js`
  (owner/lead/member/ceo × action) áp cho **cả demo lẫn Supabase thật**;
  Store và UI cùng kiểm matrix này, RLS/RPC ở backend là lớp chặn cuối.
  CEO chỉ đọc ở cả hai chế độ.

## Ngân sách và cam kết chi

Ngân sách theo dòng (line) có số **approved**; số còn lại được tính ở `js/domain.js` (`budgetRemaining`):

```
remaining = approved − Σ actuals − Σ (amount − settled_amount) của commitment còn mở
commitment còn mở = status planned / committed / partially_actualised
```

Commitment đã `settled` / `released` / `cancelled` không trừ phần chưa
settle (phần đã trả nằm trong Σ actuals) — semantic chốt ở migration 0005,
fixture đối chiếu ở `docs/METRICS.md` mục 5 (QA23).

## Ranh giới tích hợp CRM trong tương lai

Marketing Workspace **độc lập** với SAVA CRM ở giai đoạn này: không đồng bộ hai chiều, không ghi vào hệ thống của team khác. Ranh giới chuẩn bị cho tương lai chỉ gồm:

- dùng **ID ổn định** (UUID) cho các thực thể có khả năng liên kết sau này (campaign, nội dung, liên hệ/lead nếu phát sinh);
- giữ khả năng truy cập qua **API có RLS** của Supabase làm bề mặt tích hợp duy nhất khi có quyết định kết nối.

Ngoài hai điểm chuẩn bị đó: **chưa có sync, chưa có mapping dữ liệu, chưa có tài khoản máy chung**. Mọi tích hợp thật phải có quyết định riêng của Zac trước khi triển khai.
