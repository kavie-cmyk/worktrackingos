# SAVA Marketing Workspace

Web app quản lý toàn bộ công việc Marketing cho SAVA META: IMC & Gantt, Content Calendar, Action Plan & công việc (dependencies), duyệt nội dung, kết nối kênh & thư viện bài đã đăng, social analytics, quản lý quảng cáo, KPI & ngân sách, dashboard hiệu quả và báo cáo lãnh đạo.

- Giao diện tiếng Việt, múi giờ `Asia/Ho_Chi_Minh`, tuần bắt đầu thứ Hai, định dạng ngày `dd/mm/yyyy`, giờ 24h.
- Frontend tĩnh vanilla JS (không build step), triển khai GitHub Pages từ repo này.
- Backend: Supabase (PostgreSQL + Auth + Storage + RLS + Edge Functions) trên **project riêng** `sava-marketing-workspace` — xem [docs/SETUP.md](docs/SETUP.md). Khi chưa cấu hình Supabase, app hiển thị trạng thái "Chờ kết nối Supabase"; chế độ dữ liệu minh họa (demo) được gắn nhãn rõ ràng và tách biệt.
- TikTok: chỉ soạn script, quản lý sản xuất, đăng ngoài app, lưu link và theo dõi hiệu quả — app **không** tự đăng TikTok và không tạo PublishJob cho TikTok.

## Trạng thái vòng sửa QA R1 (11/11/2026)

Vòng sửa QA R1 đã hoàn thành ở các tầng đã kiểm chứng (chi tiết trong [PR #1](https://github.com/kavie-cmyk/worktrackingos/pull/1), mục "Vòng sửa QA R1"): sửa backend (migrations 0004–0008 đã áp live, RPC duyệt + revisions bất biến, gate worker fail-closed), Store/domain (helper ghi duy nhất, permissions/validation chung, publish job contract, archive thay hard-delete) và UI (CRUD đầy đủ, panel công việc dùng chung, panel chỉ-đọc đúng vai ở bản chốt R1). QA độc lập: 92/92 test tại thời điểm QA (bản chốt nâng lên 98/98), đạt 23/28 mục QA01–14, 19–27 ở các tầng UI-demo/Store/Backend-live/SQL.

**Chưa kiểm chứng production:** publishing, sync và ads với tài khoản kênh thật (QA15–18, QA28) — mọi kênh vẫn ở trạng thái chờ credentials của SAVA, chưa kênh nào được khai là đã kết nối (xem [docs/CAPABILITY_MATRIX.md](docs/CAPABILITY_MATRIX.md)).

## Chạy thử ở máy local

```bash
python3 -m http.server 8080   # mở http://localhost:8080
npm test                      # chạy kiểm thử logic (node --test)
```

## Tài liệu

- [docs/SETUP.md](docs/SETUP.md) — tạo Supabase project, chạy migrations, điền `config.js`.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — kiến trúc, data layer, worker bền vững.
- [docs/ROLE_GUIDE.md](docs/ROLE_GUIDE.md) — hướng dẫn theo vai trò.
- [docs/CAPABILITY_MATRIX.md](docs/CAPABILITY_MATRIX.md) — ma trận khả năng từng connector.
- [docs/METRICS.md](docs/METRICS.md) — định nghĩa chỉ số và công thức dashboard.
