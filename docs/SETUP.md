# Hướng dẫn thiết lập — SAVA Marketing Workspace

> **Hiện trạng (cập nhật 11/11/2026): project ĐÃ được tạo và migrations ĐÃ được áp.** Project `sava-marketing-workspace` thuộc Organization **MKT OS**, **Project ref:** `nlbtjtubihxbkigdfpdg`, **Region:** `ap-south-1` (Mumbai), Plan Free, trạng thái ACTIVE_HEALTHY. Ngày 11/11/2026, migrations `0001_schema.sql`, `0002_rls.sql`, `0003_functions.sql` đã được áp lên project qua Supabase Management API (đều trả HTTP 201) và đã đọc lại xác nhận: **49 bảng, RLS bật 49/49, 155 policies**, các function/ràng buộc then chốt đều có. `config.js` trong repo đã điền Project URL + anon key (khóa công khai, an toàn kèm RLS). Các bước 1, 2 và 4 dưới đây giữ lại làm tài liệu tái triển khai; việc còn lại là **Bước 3 (deploy Edge Functions + đặt lịch chạy worker)** và **Bước 6 (tạo tài khoản Owner đầu tiên)**.

Thứ tự thực hiện: **1 → 7**. Các bước 2–5 do người triển khai kỹ thuật làm sau khi Zac hoàn thành bước 1 và cung cấp URL + keys của project.

---

## Bước 1 — Tạo Supabase project (ĐÃ XONG 11/11/2026)

Zac đã tạo Organization **MKT OS** và project trong đó:

   - **Name:** `sava-marketing-workspace`
   - **Project ref:** `nlbtjtubihxbkigdfpdg`
   - **Region:** `ap-south-1` (Mumbai) — region thực tế của project, giữ nguyên sử dụng
   - **Plan:** Free
   - **Project URL:** `https://nlbtjtubihxbkigdfpdg.supabase.co`

Project này là project **riêng** cho Marketing Workspace — không dùng chung với project CRM (`sava-crm`) hay project nào khác.

## Bước 2 — Chạy migrations (tạo schema + RLS) — ĐÃ ÁP 11/11/2026

Đã áp cả 3 migrations lên project `nlbtjtubihxbkigdfpdg` qua Management API (HTTP 201 từng file) và xác nhận 49 bảng / RLS 49/49 / 155 policies. Phần dưới đây là quy trình tái áp dụng khi cần triển khai lại từ đầu.

Các file migration nằm trong thư mục `supabase/migrations/`, đánh số thứ tự tăng dần. Phải chạy **đúng thứ tự số** — migration sau phụ thuộc migration trước.

Cách A — Supabase CLI (khuyến nghị khi chạy nhiều migration):

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Cách B — SQL Editor trên Supabase Dashboard (khi không tiện cài CLI):

1. Mở **SQL Editor** trong project `sava-marketing-workspace`.
2. Lần lượt mở từng file trong `supabase/migrations/` theo thứ tự số tăng dần, dán toàn bộ nội dung vào một query mới và bấm **Run**.
3. Không gộp nhiều migration vào một lần chạy và không đổi thứ tự — nếu một migration báo lỗi thì dừng lại, xử lý lỗi đó rồi mới chạy tiếp.

Kiểm tra sau khi chạy xong: vào **Table Editor** phải thấy đủ các bảng của workspace, và mọi bảng đều bật **RLS** (hàng "RLS enabled"). Xem thêm ma trận phân quyền trong tài liệu kiến trúc và `docs/CAPABILITY_MATRIX.md`.

## Bước 3 — Deploy Edge Functions + đặt lịch gọi worker + secrets

Hai Edge Function chạy phía server:

- `publish-worker` — xử lý các PublishJob đang chờ (đăng bài lên các kênh hỗ trợ đăng qua app).
- `sync-worker` — đồng bộ dữ liệu hiệu quả (social / ads metrics) từ các kênh đã kết nối về bảng observations.

Deploy bằng Supabase CLI:

```bash
supabase functions deploy publish-worker
supabase functions deploy sync-worker
```

Đặt **secrets phía server** (Dashboard → Edge Functions → Secrets, hoặc CLI `supabase secrets set ...`). Các giá trị này chỉ tồn tại ở phía server:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase tự cấp sẵn cho Edge Functions trong đa số trường hợp — kiểm tra trước khi đặt thêm).
- Thông tin xác thực/token của từng kênh tích hợp theo `docs/CAPABILITY_MATRIX.md`.

> `service_role` key bypass toàn bộ RLS. Nó chỉ được dùng trong Edge Functions / tác vụ quản trị phía server. **Tuyệt đối không** điền vào `config.js`, không nhúng vào frontend, không commit.

**Đặt lịch gọi worker:** worker phải được gọi định kỳ từ bên ngoài vòng đời trình duyệt (app không phụ thuộc tab nào đang mở). Hai lựa chọn:

- **pg_cron + pg_net** ngay trong Supabase: tạo job gọi HTTP tới endpoint của từng function theo chu kỳ đã chốt trong `supabase/` (ví dụ mỗi vài phút cho `publish-worker`, theo giờ cho `sync-worker`).
- **Cron ngoài** (ví dụ GitHub Actions với `schedule`, hoặc một dịch vụ cron bất kỳ) gửi request tới URL của function kèm header xác thực service.

Dù chọn cách nào, worker được thiết kế **idempotent** — gọi trùng không tạo bài đăng trùng hay số liệu trùng (xem `docs/ARCHITECTURE.md`).

## Bước 4 — Điền `config.js` cho frontend — ĐÃ ĐIỀN 11/11/2026

`config.js` trong repo đã chứa Project URL + anon key của project `nlbtjtubihxbkigdfpdg`. Phần dưới đây là quy trình khi cần điền lại.

Frontend tĩnh không có bước build và không đọc `.env`. Cấu hình runtime nằm ở file `config.js` ở thư mục gốc của app:

1. Sao chép `config.example.js` thành `config.js`.
2. Điền đúng 2 giá trị lấy ở bước 1:
   - URL của project.
   - **anon key**.
3. Kiểm tra lại trước khi commit/publish: trong `config.js` **chỉ** có URL + anon key. Anon key là public-safe **vì** toàn bộ dữ liệu được bảo vệ bằng RLS — người có anon key nhưng không đăng nhập đúng tài khoản/thành viên sẽ không đọc được dữ liệu nghiệp vụ. Ngược lại, **service role key tuyệt đối không xuất hiện trong `config.js`** hay bất kỳ file frontend nào.

## Bước 5 — Bật GitHub Pages

1. Vào repo trên GitHub → **Settings → Pages**.
2. Mục **Build and deployment → Source:** chọn **Deploy from a branch**.
3. Chọn branch **`main`** và thư mục **`/ (root)`**, rồi **Save**.
4. Chờ Pages build xong và mở URL `https://<owner>.github.io/<repo>/` để kiểm tra app tải được, không còn báo "Chờ kết nối Supabase" khi đã điền `config.js`.

## Bước 6 — Tạo tài khoản Owner đầu tiên

1. Trong Supabase Dashboard → **Authentication → Users → Add user**, tạo user bằng email của Zac (đặt mật khẩu qua luồng của Supabase — không gửi mật khẩu qua chat/repo).
2. Gán membership với vai **owner** cho user vừa tạo bằng SQL trong SQL Editor. Mẫu dưới đây dùng placeholder — thay `<auth-user-id>` bằng ID của user ở mục Authentication và `<workspace-id>` bằng ID workspace thực tế (xem đúng tên bảng/cột trong migration membership nếu repo đã chốt khác):

```sql
insert into public.memberships (workspace_id, user_id, role, status)
values ('<workspace-id>', '<auth-user-id>', 'owner', 'active');
```

3. Đăng nhập app bằng tài khoản này, kiểm tra thấy đủ mục quản trị (thiết lập workspace, kết nối kênh, phân quyền thành viên). Từ đây Owner mời thêm Lead/Member ngay trong app — không cần tạo tay từng tài khoản bằng SQL nữa.

## Bước 7 — Checklist nghiệm thu cần tài khoản thật

Hai tiêu chí sau **chỉ** nghiệm thu được khi đã có Supabase project thật + tài khoản thật; không kết luận "đạt" dựa trên dữ liệu demo:

- [ ] **AC01** — Đăng nhập bằng tài khoản thật, dữ liệu tải từ Supabase project `sava-marketing-workspace` (không phải demo), phân quyền theo vai hiển thị đúng.
- [ ] **AC20** — Luồng kết nối kênh thật chạy end-to-end bằng tài khoản/kênh thật, dữ liệu đồng bộ về đúng workspace và hiển thị đúng trên app.

Checklist bổ sung trước khi bàn giao sử dụng thật:

- [ ] Migrations đã chạy đủ, đúng thứ tự; mọi bảng bật RLS.
- [ ] `publish-worker` + `sync-worker` đã deploy, có lịch gọi định kỳ, secrets chỉ nằm phía server.
- [ ] `config.js` chỉ chứa URL + anon key; rà soát repo không có service role key ở bất kỳ file nào.
- [ ] GitHub Pages đang phục vụ từ branch `main`, thư mục gốc.
- [ ] Tài khoản Owner đăng nhập được và mời được thành viên.
- [ ] `npm test` đạt (xanh) ở commit bàn giao.
