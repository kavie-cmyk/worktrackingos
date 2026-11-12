# R3.1 Contract — Migration 0009/0010 (đã áp live 12/11/2026)

Project: `sava-marketing-workspace` (`nlbtjtubihxbkigdfpdg`). Cả hai file chạy lại lần 2 không lỗi (AC20 idempotent). Đội Store/UI dùng tài liệu này để map field — KHÔNG tự suy từ UI demo.

## 1. Cột mới trên bảng cũ

| Bảng | Cột mới | Kiểu / ràng buộc | Ghi chú cho Store/UI |
|---|---|---|---|
| budget_lines | `planned_amount` | numeric(18,2), ≥0, nullable | R3-05: kế hoạch, ĐỘC LẬP `approved_amount`. Bỏ fallback `planned = approved_amount` khi đọc. |
| budget_lines | `activity_id`, `task_id` | FK → activities/tasks, nullable, ON DELETE SET NULL | Scope chi: giữ nguyên `campaign_id`. Trigger scope (mục 4) kiểm khớp campaign/workspace. |
| budget_actuals | `title` | text, nullable | R3-07: nội dung/tên khoản chi. `description` = ghi chú/chứng từ. Không alias đè nhau nữa. |
| budget_actuals | `idempotency_key` | text + UNIQUE(workspace_id, idempotency_key) WHERE NOT NULL | AC09: client gửi key ổn định cho mỗi lần ghi payment; trùng → 409. (`commitment_id` đã có từ 0001.) |
| kpis | `definition` | jsonb NOT NULL default `{}` — `{how, source, formula?, dedup_key?, note?}` | R3-08: định nghĩa cách đo, tách khỏi name/target. |
| kpis | `scope_type` | text NOT NULL default `campaign`, CHECK in (campaign, activity, task, content, bu_product, pillar, channel, workspace) + CHECK bộ cột theo scope (mục 3) | `metric_code` đã có từ 0001. |
| kpis | `activity_id`, `task_id`, `content_item_id`, `bu_product_id`, `pillar_id` | FK nullable (SET NULL) | `product_id` cũ giữ nguyên (legacy); scope `bu_product` chấp nhận `bu_product_id` HOẶC `product_id`. |
| kpis | `aggregation_mode` | text NOT NULL default `direct`, CHECK in (direct, sum, unique, ratio, snapshot, manual) | |
| kpis | `target_version` | int NOT NULL default 1 | Tăng khi đổi target; mỗi lần đổi ghi 1 dòng `kpi_target_versions`. |
| activities | `owner_id` (FK users), `channel` (text), `deliverables` (jsonb default `[]`), `objective` (text) | nullable | R3-08: trước đây bị bỏ khỏi payload. |
| content_items | `pillar_id`, `pillar_id_at_publish` (FK content_pillars), `bu_product_id`, `activity_id` (FK, tùy chọn), `series` (text), `source_content_id` (FK self — nội dung gốc khi dùng lại) | nullable | Campaign/activity vẫn TÙY CHỌN (R3.1). `pillar_id_at_publish` = snapshot phân loại lúc đăng. |
| content_variants | `owner_id`, `reviewer_id` (FK users), `production_deadline` (timestamptz), `brief` (text) | nullable | R3-08. |
| brand_pages | `owner_id` (FK users), `tags` (text[] default `{}`) | | R3-11. |
| tasks | `is_milestone` | boolean NOT NULL default false | |

## 2. Bảng mới

| Bảng | Cột chính | Ràng buộc |
|---|---|---|
| content_pillars | workspace_id, bu_product_id?, name, description, classification_guide, status(active/archived), archived_at | RLS: operational đọc, `edit` ghi |
| kpi_target_versions | kpi_id, version, target_value, unit, definition jsonb, aggregation_mode, note, created_by | UNIQUE(kpi_id, version) |
| kpi_contributions | kpi_id, source_kpi_id?, source_fact_type(measurement/metric_observation/external_fact/manual), source_fact_id text, rule(sum/unique_dedup/ratio_num/ratio_den/snapshot_latest), dedup_key_field | CHECK: phải có source_kpi_id hoặc source_fact_id. Tham chiếu — không copy actual. |
| brand_page_versions | brand_page_id, version, snapshot jsonb, created_by | UNIQUE(brand_page_id, version) |
| member_capacity | workspace_id, user_id, hours_per_week numeric ≥0, days_off jsonb (mảng ngày), effective_from/to | Xem RPC mục 5. Thay hardcode 40h/[]. |
| campaign_baselines | campaign_id, version, snapshot jsonb, approved_by, approved_at, note | UNIQUE(campaign_id, version); RLS ghi = `approve` |
| campaign_assets | campaign_id, asset_id, role, note | UNIQUE(campaign_id, asset_id) |
| budget_allocations | source_kind(actual/commitment), actual_id?, commitment_id?, campaign_id, activity_id? (null = chi trực tiếp campaign), amount >0, share_percent?, effective_date, currency | CHECK đúng 1 nguồn theo source_kind; trigger trần (mục 4) |
| cash_accounts | workspace_id, name, currency, opening_balance default 0, status(active/archived) | Sổ Thu–Chi R2-24 |
| cash_categories | workspace_id, name, kind(in/out) | |
| cash_transactions | account_id, category_id?, direction(in/out), amount >0, occurred_on, campaign_id?, activity_id?, note, evidence_ref, idempotency_key | UNIQUE(workspace_id, idempotency_key) WHERE NOT NULL |
| VIEW cash_account_balances | account_id, workspace_id, currency, balance | `balance = opening_balance + Σin − Σout`; security_invoker = tôn trọng RLS người gọi |

RLS: mọi bảng mới đều bật RLS + grant authenticated theo mẫu 0002 (operational/`edit` cho pillar/versions/assets-nối; member đọc + `edit` cho kpi_*; `budget_view`/`budget_edit` cho allocations + cash_*).

## 3. CHECK bộ cột KPI theo scope_type

- `campaign`: campaign_id NOT NULL; activity/task/content phải NULL.
- `activity`: activity_id NOT NULL; task/content phải NULL (campaign_id được phép = campaign của activity).
- `task`: task_id NOT NULL; content phải NULL.
- `content`: content_item_id NOT NULL.
- `bu_product`: bu_product_id hoặc product_id NOT NULL. `pillar`: pillar_id NOT NULL.
- `channel`/`workspace`: không bắt FK nghiệp vụ.

## 4. Trigger backend (0010)

- **Scope chéo (AC04)** — `activities_scope_check`, `budget_lines_scope_check`, `kpis_scope_check`, `tasks_scope_check`, `content_items_scope_check`, `cash_transactions_scope_check`, trigger của allocations: đối tượng tham chiếu phải cùng `workspace_id`; nếu có cả activity + campaign thì `campaign_id` phải bằng `activities.campaign_id` (tương tự với task). Vi phạm → exception `R31_SCOPE…` (errcode 23514, PostgREST 400).
- **Trần allocation (AC08)** — `budget_allocations_cap_check`: khóa dòng nguồn (actual/commitment), `Σ amount các allocation của nguồn + amount mới ≤ amount của nguồn`; vượt → exception `R31_ALLOC…`. UI không cần tự chặn nhưng phải hiển thị lỗi này.

## 5. Hàm / RPC

- **`budget_remaining(p_budget_line_id uuid) → numeric`** (R3-06, khớp `js/domain.js` `budgetRemaining`):
  `remaining = approved_amount − Σ budget_actuals.amount − Σ_{commitment còn mở (planned/committed/partially_actualised)} max(0, commitment.amount − Σ actuals WHERE commitment_id = commitment.id)`.
  `settled_amount` KHÔNG còn được dùng. Đối chiếu AC12: approved 1000, commitment 1000, actual liên kết 400 → SQL trả `0.00` (đã kiểm live).
- **`upsert_member_capacity(p_workspace_id, p_user_id, p_hours_per_week, p_days_off jsonb, p_effective_from, p_effective_to)`** — SECURITY DEFINER; caller phải là member active; đặt cho người khác cần owner/lead; user đích phải là member active. Trả dòng `member_capacity` vừa tạo (mỗi lần gọi = 1 bản ghi hiệu lực mới).
- **`get_member_capacity(p_workspace_id, p_user_id = null)`** — SECURITY DEFINER; chỉ member của workspace mới gọi được.

## 6. Đã kiểm chứng live (vai thật, user thử role lead — đã xóa sạch)

Campaign → activity (owner/channel/deliverables round-trip) → budget_line (planned 1200 ≠ approved 1000 round-trip) → commitment 1000 → actual 400 (title `Chi ads R31` tách description `Hoa don HD01`); duplicate `idempotency_key` → **409**; KPI scope=activity + definition jsonb → 201; pillar → content_item (pillar + series) → 201; RPC capacity 32h → 200. **AC04**: budget_line kèm activity của campaign A + campaign_id B → **400 R31_SCOPE**. **AC08**: allocation 180/300 → 201, thêm 200 (tổng 380 > 300) → **400 R31_ALLOC**. Anon không JWT đọc campaigns → `[]`. Sau kiểm: auth.users = 1, workspaces = 1 (sava-marketing), mọi bảng nghiệp vụ = 0 dòng.
