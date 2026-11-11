# Ma trận khả năng connector — SAVA Marketing Workspace

> Ngày kiểm tra: **11/11/2026**. Múi giờ: Asia/Ho_Chi_Minh.
> **Trạng thái kiểm chứng của mọi kênh: "Chưa kết nối — chờ tài khoản/quyền".**
> Chưa kênh nào có tài khoản/quyền production được cấp cho workspace này nên
> chưa mục nào được coi là đã kiểm chứng trên production. Các khả năng dưới đây
> là khả năng *kỹ thuật theo tài liệu chính thức* của từng nền tảng — phải
> **kiểm tra lại khi tích hợp thật** (quyền app review, phạm vi scope và giới
> hạn API thay đổi theo thời gian và theo loại tài khoản).
> Nguồn tài liệu chính thức chỉ là điểm bắt đầu tra cứu, không phải bằng chứng
> quyền đã được cấp.

## Trạng thái triển khai connector trong code (cập nhật vòng R1 — R20, 11/11/2026)

Phân biệt rõ **code đã viết** với **quyền/tài khoản thật** — hai trục khác nhau:

| Kênh | implementation_status (code OAuth) | Authorize URL builder | Callback contract | Token exchange + gọi API publish/sync | connection_status (tài khoản thật) | publish_support |
|---|---|---|---|---|---|---|
| Facebook Page | implemented_needs_credentials | Có — `buildAuthorizeUrl` (facebook.com/v21.0/dialog/oauth, scopes Pages + Instagram + ads) | Có — `parseOAuthCallback` (kiểm error/state/code) | **Chưa triển khai** — `publish()/sync*()` vẫn ném NOT_CONNECTED | not_connected | supported |
| Instagram Professional | implemented_needs_credentials | Có — instagram.com/oauth/authorize (Instagram Login, scopes instagram_business_*) | Có | **Chưa triển khai** | not_connected | supported |
| LinkedIn Page | implemented_needs_credentials | Có — linkedin.com/oauth/v2/authorization (scopes organization + ads) | Có | **Chưa triển khai** | pending_review (chờ duyệt Community Management) | supported |
| YouTube | implemented_needs_credentials | Có — accounts.google.com/o/oauth2/v2/auth (scopes youtube.readonly/upload + yt-analytics.readonly, access_type=offline) | Có | **Chưa triển khai** | not_connected | supported |
| TikTok | implemented_needs_credentials | Có — tiktok.com/v2/auth/authorize/ (client_key, scopes chỉ-đọc user.info.basic/video.list/video.query) | Có | **Chưa triển khai** (chỉ áp cho đọc khi có credentials) | not_connected | **not_supported_by_design** — không đăng qua app theo quyết định sản phẩm |

Mã nguồn: `supabase/functions/_shared/providers.ts` (bản inline trong
publish-worker/sync-worker KHỚP 100% file này — kiểm bằng script khi sửa).
**Chưa kênh nào được kiểm chứng với tài khoản thật**; không mục nào ở bảng
này được hiểu là "đã kết nối".

## Bảng theo kênh

| Kênh | Đọc bài đã đăng | Đọc analytics | Đăng: post/text | Đăng: ảnh | Đăng: video | Đăng: reel/short | Đăng: story | Đăng: carousel | Ads read | Ads write | Trạng thái kiểm chứng |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Facebook Page | Có (Pages API) | Có (Page Insights) | Có | Có | Có | Có | Hạn chế (không qua luồng post thường) | Có (nhiều ảnh) | Có (Marketing API) | Có (Marketing API, cần quyền ads_management) | Chưa kết nối — chờ tài khoản/quyền |
| Instagram Professional | Có | Có (Insights) | — (không có post chỉ-chữ) | Có (Content Publishing) | Có | Có (Reels) | Có | Có | Có (qua Marketing API) | Có (qua Marketing API) | Chưa kết nối — chờ tài khoản/quyền |
| LinkedIn Page | Có (Posts API, cần quyền) | Có (cần quyền analytics) | Có | Có | Có | Không áp dụng | Không áp dụng | Có (multi-image/document) | Có (Ad Analytics, cần quyền) | Có (cần quyền quảng cáo) | Chưa kết nối — chờ tài khoản/quyền |
| TikTok | Có (Video Query / Display API) | Có (giới hạn theo quyền được cấp) | **Không triển khai theo quyết định sản phẩm** | **Không triển khai theo quyết định sản phẩm** | **Không triển khai theo quyết định sản phẩm** | **Không triển khai theo quyết định sản phẩm** | **Không triển khai theo quyết định sản phẩm** | **Không triển khai theo quyết định sản phẩm** | Chưa triển khai | Chưa triển khai | Chưa kết nối — chờ tài khoản/quyền |
| YouTube | Có (Data API v3) | Có (Analytics API) | — (không có post chỉ-chữ tương đương) | Community post: chưa triển khai | Có (videos.insert, cần audit khi app chưa kiểm chứng) | Có (Shorts = video dọc ngắn) | Không áp dụng | Không áp dụng | Có (qua Google Ads API) | Có (qua Google Ads API) | Chưa kết nối — chờ tài khoản/quyền |

Chú thích:

- "Có" = API chính thức có khả năng này theo tài liệu tại ngày kiểm tra; muốn
  dùng thật vẫn cần: tài khoản đúng loại (Page/Professional/Company Page/
  Brand Channel), app được nền tảng duyệt ở phạm vi tương ứng, và người dùng
  cấp quyền. Đọc được bài **không** suy ra đăng được bài; đọc ads **không**
  suy ra ghi ads được — quyền được lưu tách riêng trong
  `connection_capabilities` (`read_posts`, `read_analytics`, `publish`,
  `ads_read`, `ads_write`).
- **TikTok**: app chỉ soạn script (`tiktok_scripts`), quản lý sản xuất, đăng
  **ngoài app**, lưu `external_url` và theo dõi hiệu quả. Không tạo
  `publish_jobs` cho TikTok (ràng buộc ở cả schema, registry lẫn worker).

## Nguồn tài liệu chính thức (cần kiểm tra lại khi tích hợp)

| Kênh | Tài liệu |
|---|---|
| Facebook Page | https://developers.facebook.com/docs/pages-api/posts |
| Instagram | https://developers.facebook.com/docs/instagram-platform/content-publishing (Instagram Content Publishing) |
| LinkedIn Page | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api |
| YouTube | https://developers.google.com/youtube/v3/docs và https://developers.google.com/youtube/analytics |
| TikTok | https://developers.tiktok.com/doc/research-api-specs-query-videos/ (Video Query) — chỉ phục vụ đọc dữ liệu |

## Quy tắc cập nhật tài liệu này

1. Chỉ đổi trạng thái sang "Đã kiểm chứng" sau khi đã chạy thật trên
   production với đúng tài khoản của SAVA và ghi ngày + người kiểm chứng.
2. Khi nền tảng đổi chính sách/API, cập nhật bảng + ngày kiểm tra, không sửa
   âm thầm các ghi nhận cũ về trạng thái tại thời điểm trước.
