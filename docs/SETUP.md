# Hướng dẫn thiết lập — SAVA Marketing Workspace

> **Hiện trạng (cập nhật 11/11/2026): project ĐÃ được tạo và migrations ĐÃ được áp.** Project `sava-marketing-workspace` thuộc Organization **MKT OS**, **Project ref:** `nlbtjtubihxbkigdfpdg`, **Region:** `ap-south-1` (Mumbai), Plan Free, trạng thái ACTIVE_HEALTHY. Ngày 11/11/2026, migrations `0001_schema.sql`, `0002_rls.sql`, `0003_functions.sql` đã được áp lên project qua Supabase Management API (đều trả HTTP 201) và đã đọc lại xác nhận: **49 bảng, RLS bật 49/49, 155 policies**, các function/ràng buộc then chốt đều có. `config.js` trong repo đã điền Project URL + anon key (khóa công khai, an toàn kèm RLS). Các bước 1, 2 và 4 dưới đây giữ lại làm tài liệu tái triển khai. **Cập nhật vòng 2 (11/11/2026): Bước 3 ĐÃ XONG** — 2 Edge Functions đã deploy (ACTIVE, verify_jwt) và đã đặt lịch pg_cron mỗi 5 phút qua Vault (xem docs/WORKERS.md); **Bước 6 ĐÃ XONG** — Auth config đã trỏ site_url/uri_allow_list về https://kavie-cmyk.github.io/worktrackingos/ (GitHub Pages đã bật từ branch feat/marketing-workspace, HTTP 200), email mời Owner đã được API invite chấp nhận lúc 21:18 ICT 11/11/2026 cho anhthu.tang2004@gmail.com (user id 1d360d36-c504-41eb-9547-388f40860719, trạng thái chờ bấm link đặt mật khẩu) và bootstrap_owner đã gán sẵn membership role owner — bấm link trong email, đặt mật khẩu là vào app với quyền Owner.

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

## Bước 6 — Tạo tài khoản Owner đầu tiên (luồng mời + bootstrap)

Thứ tự bắt buộc: **(a) cấu hình redirect → (b) mời auth user → (c) chạy bootstrap → (d) kiểm tra**. Bootstrap ở (c) **không tự tạo auth user** — nếu chưa có auth user với email đó, function sẽ báo lỗi rõ ràng và dừng.

### (a) Cấu hình Auth redirect — ĐÃ CẤU HÌNH 11/11/2026 qua Management API

Đã `PATCH /v1/projects/nlbtjtubihxbkigdfpdg/config/auth` (HTTP 200, đã GET đọc lại xác nhận; toàn bộ các khoá Auth khác giữ nguyên) với đúng 2 giá trị:

| Trường | Giá trị |
|---|---|
| `site_url` | `https://kavie-cmyk.github.io/worktrackingos/` |
| `uri_allow_list` | `https://kavie-cmyk.github.io/worktrackingos/` (chuỗi phân tách bằng dấu phẩy — hiện chỉ chứa URL Pages này) |

Hai giá trị này quyết định link trong email mời / khôi phục mật khẩu redirect về đúng app trên GitHub Pages. Khi cần sửa lại bằng tay: Supabase Dashboard → **Authentication → URL Configuration** → **Site URL** và **Redirect URLs** điền cùng các giá trị trên.

### (b) Mời Owner bằng Auth Admin invite

1. Trong Supabase Dashboard → **Authentication → Users**, chọn **Invite user** (mời bằng email — không chọn tạo user kèm mật khẩu đặt tay) và nhập email của Zac.
2. Zac nhận email mời, bấm link **Accept invitation** trong email — link redirect về `https://kavie-cmyk.github.io/worktrackingos/` kèm tham số `type=invite`.
3. App nhận diện `type=invite` và hiện **form đặt mật khẩu**. Zac tự đặt mật khẩu trên form này (mật khẩu không đi qua chat/repo/SQL).
4. Đặt mật khẩu xong, app đăng nhập luôn bằng tài khoản vừa kích hoạt và vào thẳng app. Lúc này đã có **auth user** trong `auth.users` — đủ điều kiện chạy bootstrap ở (c). (Owner có thể chưa thấy dữ liệu/mục quản trị cho tới khi (c) và (d) xong — đó là bình thường, vì quyền nằm ở `memberships`, không nằm ở auth user.)

### (c) Chạy bootstrap gán quyền Owner

File nguồn: `supabase/bootstrap/owner.sql` (idempotent — chạy lại nhiều lần an toàn).

Cách 1 — SQL Editor trên Supabase Dashboard:

1. Mở **SQL Editor** trong project `sava-marketing-workspace`, dán toàn bộ nội dung `supabase/bootstrap/owner.sql` và bấm **Run** một lần để định nghĩa function `public.bootstrap_owner(text)`.
2. Chạy câu gọi với email thật của Owner (thay email mẫu):

```sql
select * from public.bootstrap_owner('<email-owner>');
```

Cách 2 — Management API: gửi cùng câu lệnh `select * from public.bootstrap_owner('<email-owner>');` qua `POST /v1/projects/nlbtjtubihxbkigdfpdg/database/query` (sau khi function đã được định nghĩa bằng Cách 1 ít nhất một lần).

Function sẽ tự làm, theo đúng schema `0001_schema.sql`:

- Tìm auth user theo email trong `auth.users` — không có thì `raise exception`: *"Chưa có auth user với email này — hãy gửi invite/tạo user trước"* (quay lại (b), không sửa SQL để lách).
- Upsert `public.users` (`id` = auth user id, `email`, `display_name` = phần trước `@` nếu chưa có, `is_active = true`).
- Tạo workspace mặc định nếu chưa có: `slug = 'sava-marketing'`, `name = 'SAVA Marketing Workspace'` (timezone mặc định `Asia/Ho_Chi_Minh` theo schema).
- Upsert `public.memberships` cho workspace đó với `role = 'owner'`, `is_active = true` (bảng `memberships` **không có cột `status`** — trạng thái là cột `is_active`).

### (d) Kiểm tra membership role owner

Chạy trong SQL Editor — kết quả đúng phải là đúng 1 dòng với `role = 'owner'` và `is_active = true`:

```sql
select m.role, m.is_active, u.email, w.slug
from public.memberships m
join public.users u on u.id = m.user_id
join public.workspaces w on w.id = m.workspace_id
where w.slug = 'sava-marketing' and lower(u.email) = lower('<email-owner>');
```

Sau đó đăng nhập app bằng tài khoản Owner, kiểm tra thấy đủ mục quản trị (thiết lập workspace, kết nối kênh, phân quyền thành viên). Từ đây Owner mời thêm Lead/Member ngay trong app — không cần tạo tay từng tài khoản bằng SQL nữa.

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
