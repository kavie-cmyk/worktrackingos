# WORKERS — Trạng thái Edge Functions, lịch worker & GitHub Pages

Cập nhật: 2026-11-11, vòng executor 2. Mọi trạng thái dưới đây là kết quả đọc lại thật
từ Supabase Management API / GitHub API / curl tại thời điểm ghi (giờ UTC; ICT = UTC+7).
Project duy nhất được đụng tới: `nlbtjtubihxbkigdfpdg` (sava-marketing-workspace, ap-south-1).

## 1. Edge Functions — ĐÃ DEPLOY, ACTIVE

Lần deploy đầu (giữ nguyên import `../_shared/providers.ts`) bị từ chối ở cả 2 function:

- HTTP 400 — `Failed to bundle the function (reason: Module not found "file:///tmp/user_fn_..._1/_shared/providers.ts". at file:///tmp/user_fn_..._1/source/index.ts:25:8).`
- Nguyên nhân: helper `deploy_function2.py` chỉ gửi 1 file `index.ts`.

Khắc phục theo đúng phương án dự phòng trong nhiệm vụ: inline toàn bộ nội dung cần dùng của
`supabase/functions/_shared/providers.ts` vào từng `index.ts`, giữ nguyên hành vi, có comment
đánh dấu `inlined từ _shared/providers.ts để deploy 1 file` (dòng 21 ở publish-worker,
dòng 20 ở sync-worker). File `_shared/providers.ts` gốc không đổi, vẫn là nguồn tham chiếu.

Kết quả deploy lại (POST deploy qua Management API, helper cài sẵn `verify_jwt=true`):

| Function | HTTP deploy | id | version | verify_jwt | status (đọc lại) | created_at |
|---|---|---|---|---|---|---|
| publish-worker | 201 | 436a4404-c544-4775-834f-df6fa6925b5a | 1 | true | ACTIVE | 1794405703270 (2026-11-11T14:01:43Z) |
| sync-worker | 201 | 8bde6713-2fc6-4487-bad5-316b97f41c74 | 1 | true | ACTIVE | 1794405704803 (2026-11-11T14:01:44Z, xấp xỉ theo epoch trả về) |

Đọc lại độc lập sau deploy: `GET /v1/projects/nlbtjtubihxbkigdfpdg/functions` lúc
2026-11-11T14:01:47Z → HTTP 200, cả 2 function `status: "ACTIVE"`, `verify_jwt: true`,
`import_map: false`, ezbr_sha256:

- publish-worker: `61fec7ae262c5f99c5be832072da8a676d9742e0ccfca2bc139493b81a14ed39`
- sync-worker: `da58b9e266173cc0c0fb999a43c4c98d5650d348747c653ee97becd2717ecb3b`

Lưu ý hành vi thật: provider chưa có credentials production (xem CAPABILITY_MATRIX.md) nên
worker chạy được nhưng mọi publish/sync tới nền tảng thật vẫn trả `NOT_CONNECTED` —
không có đăng/đồng bộ giả.

## 2. Lịch worker (pg_cron / pg_net) — EXTENSION BẬT ĐƯỢC, CHƯA ĐẶT LỊCH

Đã chạy qua `POST /v1/projects/nlbtjtubihxbkigdfpdg/database/query` (HTTP 201, kết quả `[]`):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Đọc lại `pg_extension` (HTTP 201):

| Extension | Version |
|---|---|
| pg_cron | 1.6.4 |
| pg_net | 0.20.4 |
| supabase_vault | 0.3.1 |

- Schema `vault` có tồn tại (kiểm qua `information_schema.schemata`, HTTP 201).
- NHƯNG `vault.secrets` hiện có **0 dòng** (đọc lại HTTP 201, kết quả `[]`) và
  `cron.job` cũng **0 dòng** — tức chưa có secret nào được lưu sẵn để job tham chiếu.
- Lời gọi pg_net tới `https://nlbtjtubihxbkigdfpdg.supabase.co/functions/v1/<slug>`
  cần JWT (function bật `verify_jwt=true`), thực tế là service_role key. Worker vòng này
  KHÔNG được chạm vào service_role key, và không được nhúng key thật vào SQL/job/repo.

**Kết luận tại thời điểm executor chạy: CHƯA đặt lịch** — vault có sẵn nhưng chưa có
secret service_role được lưu, và executor không được phép tự lấy key để lưu.

**Cập nhật coordinator (11/11/2026, 21:1x ICT): ĐÃ ĐẶT LỊCH.** Coordinator đã lưu
service_role key vào Vault với tên `service_role_key` (key chỉ đi qua tiến trình gọi
Management API, không ghi vào repo/log) và tạo 2 cron job — đọc lại `cron.job` xác nhận:

| Job | Lịch | Active |
|---|---|---|
| `publish-worker-5min` | `*/5 * * * *` | true |
| `sync-worker-5min` | `*/5 * * * *` | true |

Job chỉ tham chiếu `vault.decrypted_secrets` (name = 'service_role_key'), không chứa
key trong câu lệnh. AC10 đạt ở mức: worker chạy phía server theo lịch 5 phút, không
phụ thuộc tab trình duyệt; chưa có publish job thật nào tới hạn để đối chứng đầu-cuối.

## 3. GitHub Pages — ĐÃ BẬT, BUILD XONG, HTTP 200

- Tạo Pages: `POST /repos/kavie-cmyk/worktrackingos/pages` với
  `source[branch]=feat/marketing-workspace`, `source[path]=/` → thành công (không báo đã tồn tại).
- Đọc lại `GET /repos/kavie-cmyk/worktrackingos/pages`: `status: "built"`,
  `build_type: "legacy"`, `source: {branch: "feat/marketing-workspace", path: "/"}`,
  `public: true`, `https_enforced: true`,
  `html_url: https://kavie-cmyk.github.io/worktrackingos/`.
- Build mới nhất (`GET .../pages/builds/latest`): id `1360350451`, `status: "built"`,
  `error.message: null`, commit `4bac2343d1155d03c2e8b05f5199a5141c757ae7`,
  created 2026-11-11T14:02:43Z, updated 2026-11-11T14:03:28Z, duration 45325 ms.
- Kiểm tra `curl https://kavie-cmyk.github.io/worktrackingos/`:
  lần 1 → HTTP 404; lần 2 (sau ~30s) → HTTP 404; lần 3 (sau ~30s) → **HTTP 200**,
  nội dung 1240 byte, chứa "SAVA Marketing" (2 lần khớp, gồm `<title>SAVA Marketing Workspace</title>`)
  — đúng `index.html` của branch. Đạt ở lần thử thứ 3/6 tối đa.

URL public: https://kavie-cmyk.github.io/worktrackingos/

## Tóm tắt AC liên quan

- Deploy 2 Edge Functions: **ĐẠT** (ACTIVE, verify_jwt=true, đã đọc lại).
- AC10 lịch worker mỗi 5 phút: **ĐÃ ĐẶT** (cập nhật coordinator 11/11/2026) — pg_cron 1.6.4
  + pg_net 0.20.4 đã bật, service_role key đã lưu trong Vault (`service_role_key`), 2 job
  `publish-worker-5min` / `sync-worker-5min` (`*/5 * * * *`, active) đã đọc lại xác nhận.
- GitHub Pages từ branch `feat/marketing-workspace`: **ĐẠT** (built, HTTP 200, đúng nội dung).
  Không merge PR, không đổi branch nguồn.
