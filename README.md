# SAVA Marketing Workspace

Web app quản lý toàn bộ công việc Marketing cho SAVA META: IMC & Gantt, Content Calendar, Action Plan & công việc (dependencies), duyệt nội dung, kết nối kênh & thư viện bài đã đăng, social analytics, quản lý quảng cáo, KPI & ngân sách, dashboard hiệu quả và báo cáo lãnh đạo.

- Giao diện tiếng Việt, múi giờ `Asia/Ho_Chi_Minh`, tuần bắt đầu thứ Hai, định dạng ngày `dd/mm/yyyy`, giờ 24h.
- Frontend tĩnh vanilla JS (không build step), triển khai GitHub Pages từ repo này.
- Backend: Supabase (PostgreSQL + Auth + Storage + RLS + Edge Functions) trên **project riêng** `sava-marketing-workspace` — xem [docs/SETUP.md](docs/SETUP.md). Khi chưa cấu hình Supabase, app hiển thị trạng thái "Chờ kết nối Supabase"; chế độ dữ liệu minh họa (demo) được gắn nhãn rõ ràng và tách biệt.
- TikTok: chỉ soạn script, quản lý sản xuất, đăng ngoài app, lưu link và theo dõi hiệu quả — app **không** tự đăng TikTok và không tạo PublishJob cho TikTok.

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
