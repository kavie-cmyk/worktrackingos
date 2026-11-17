# Runbook — Migration 0017 (Brand + Planning lên dữ liệu thật) + Seed dữ liệu demo + Gỡ chế độ demo

> Người thực hiện trên production: **Miso**, qua Supabase Dashboard bằng phiên đăng nhập sẵn của Zac (KHÔNG dùng token Management API).
> Repo: `worktrackingos`, branch `feat/marketing-workspace`. Workspace đích: **sava-marketing**, id `a0870eed-cbdc-4fde-a3da-0b09d83d83b6`.
> File liên quan:
> - Migration: `supabase/migrations/0017_brand_planning.sql` (CHỈ viết file ở đợt chuẩn bị — chưa áp)
> - Seed: `supabase/seed/from-demo-data.sql` (sinh tự động bởi `scripts/generate-seed-from-demo.mjs` từ `js/demo-data.js` — không sửa tay file seed)
> - Commit gỡ demo: ở branch local `prep/remove-demo-mode`, hash ghi ở mục (c) — **chưa push, tuyệt đối không push trước khi seed xong**.

---

## FIELD B2B ĐÃ DUYỆT + CỔNG THỨ TỰ SEED (đọc trước khi áp)

**Field B2B đã CHỐT** — Zac đã duyệt toàn bộ mô hình v2 ngày 17/11/2026 22:00. Không còn chờ danh sách field nữa; danh sách chính thức dưới đây đã nằm trong `0017_brand_planning.sql` và trong ánh xạ `js/store-core.js`:

| Bảng | Field chính thức | Kiểu / ràng buộc |
|---|---|---|
| `plan_rows` | `audience` | text, check chỉ nhận `'b2c' \| 'b2b' \| 'both'` (null = chưa phân loại) |
| `plan_rows` | `b2b_split_pct` | numeric(9,4), check 0–100 — tỉ lệ % chia ngân sách sang B2B (cùng quy ước với `uplift_percent_per_month`) |
| `benchmarks` | `paid_to_b2b`, `lead_to_account`, `demo_to_account` | numeric(12,8) — tỉ lệ funnel B2B, cùng quy ước các tỉ lệ funnel hiện có |
| `benchmarks` | key `signup` + key `b2b_account` trong map `cost_per_result` | jsonb — không thêm cột; `b2b_account` = cost per B2B account cho kênh Partnership/Event |
| `phases` | `b2b_churn_rate` | numeric(9,6) — dạng phân số như các churn rate hiện có |
| `phases` | `arppu_b2b`, `cogs_per_b2b_account`, `opening_b2b` | numeric(18,2) |

`js/demo-data.js` hiện **chưa có** các field này — đợt triển khai mô hình B2B trên demo sẽ bổ sung dữ liệu sau. Ánh xạ store-core đã sẵn sàng từ bây giờ để không rớt field khi dữ liệu tới.

### CỔNG THỨ TỰ SEED — BẮT BUỘC

File seed hiện tại (`supabase/seed/from-demo-data.sql`) là **SEED NHÁP** — sinh từ demo-data *trước* khi đợt triển khai mô hình B2B trên demo commit. **Không áp bản nháp này.**

Seed bản cuối chỉ được chốt theo đúng thứ tự:
1. Chờ Miso báo **hash commit của đợt triển khai mô hình B2B trên demo**.
2. Đối chiếu: `git log -1 --format=%H -- js/demo-data.js` (hoặc HEAD của repo tại thời điểm sinh) phải trùng / chứa hash đó. Chưa trùng → dừng, không sinh seed.
3. Chạy lại `node scripts/generate-seed-from-demo.mjs` từ đúng demo-data đó.
4. Chạy `npm test` (test `brand-planning-0017` tự kiểm số INSERT ↔ số dòng demo + 4 số neo theo demo-data mới — số dòng/số neo có thể đã thay đổi sau đợt B2B, lấy số kỳ vọng từ output kiểm chứng của lần sinh cuối).
5. Chỉ khi đó mới sang bước (a)/(b).

---|---|---|
| `plan_rows` | `audience` (b2c/b2b/both), `b2b_split_pct` | Áp cho các dòng ngân sách của kênh Paid Media/Partnership/Event |
| `benchmarks` | `paid_to_b2b`, `lead_to_account`, `demo_to_account` | 3 tỉ lệ funnel B2B mới |
| `benchmarks` | cost per B2B account cho kênh Partnership/Event | Có thể nằm trong map `cost_per_result` |
| `phases` | `b2b_churn_rate`, `arppu_b2b`, `cogs_per_b2b_account`, `opening_b2b` | Chỉ số B2B riêng theo Phase |

Nhận xét của đợt chuẩn bị (không tự quyết thay danh sách chính thức):
- `cost_per_result` của `benchmarks` đã là map jsonb theo objective → cost per B2B account nhiều khả năng chỉ cần **thêm khóa trong map** (vd `b2b_account`), không cần thêm cột.
- `plan_rows` đã có `segment` (b2c/b2b, null = dùng chung) — `audience` dự kiến có thêm giá trị `both`, khác segment ở chỗ ghi tường minh trên từng dòng ngân sách; có cần cả hai hay audience thay segment là quyết định của danh sách chính thức.

Khi có danh sách chính thức, việc cần làm trước khi sang bước (a):
1. Bổ sung cột vào `supabase/migrations/0017_brand_planning.sql` tại đúng các điểm đã đánh dấu `ĐIỂM BỔ SUNG B2B` (theo từng bảng) + bổ sung cột tương ứng vào `TABLE_COLUMNS`/`FIELD_ALIASES` trong `js/store-core.js` nếu tên app khác tên cột.
2. Chạy lại `node scripts/generate-seed-from-demo.mjs` để sinh lại seed (cơ chế tự động — không sửa tay).
3. Chạy `npm test` — suite phải xanh — rồi mới áp.

---

## Quyết định ánh xạ (đợt chuẩn bị đã chốt — áp dụng cho 0017 + seed + store)

1. **ID**: Mọi bảng nghiệp vụ dùng `uuid` như schema hiện hành. ID text của demo (vd `brand-lumus-ai`) được seed ánh xạ **deterministic**: `uuid = md5('sava-seed-v1:' || <demo id>)` định dạng uuid (version nibble = 4). Mọi khóa ngoại trong seed đều qua cùng hàm này nên liên kết không vỡ. Ví dụ: `brand-lumus-ai` → `c21ebdb3-66d5-4217-97ac-3765023c266c`; `brand-sava-meta` → `ecdb9029-1a4c-4a7b-92f2-f98d6089c532`; `camp-play-unknown` → `30c93f15-420f-4c3f-806c-904286d9751c`. Bản ghi tạo mới qua app sau này được DB cấp uuid ngẫu nhiên như mọi collection cũ (store-core bỏ id không phải uuid khi insert) — app không phụ thuộc dạng id.
2. **`phases` dùng chung một bảng** (không tạo bảng mới): ALTER thêm cột cho phase Brand (`brand_id`, `segment`, `start_month`, `end_month`, `objective`, `uplift_percent_per_month`, `note`, và các cột tài chính `paid_churn_rate`, `free_churn_rate`, `arppu`, `cogs_per_user`, `fixed_cost`, `opening_free`, `opening_paid` + 4 cột B2B chính thức `b2b_churn_rate`, `arppu_b2b`, `cogs_per_b2b_account`, `opening_b2b`). Lý do: collection `phases` của app đã trỏ bảng này; `activities`/`tasks`/`kpis` đều FK tới `phases(id)` — tách bảng sẽ vỡ FK và phải fork collection. Phân biệt hai loại phase bằng cột nào có dữ liệu: phase campaign có `campaign_id`/`plan_id` + `start_date`/`end_date`; phase Brand có `brand_id` + `start_month`/`end_month`. Ràng buộc cũ của 0001 (`plan_id` hoặc `campaign_id` not null) được 0017 thay bằng `phases_scope_check` (`plan_id` hoặc `campaign_id` hoặc `brand_id` not null) — migration tự tìm constraint cũ theo định nghĩa, không đoán tên.
3. **`group` → `channel_group`**: `GROUP` là từ khóa PostgreSQL nên cột đặt tên `channel_group` ở `plan_rows` và `benchmarks`; store-core có `FIELD_ALIASES` (`group` ↔ `channel_group`) nên app/demo vẫn dùng field `group` như cũ, hai chiều không rớt.
4. **`brand_id`/`segment` chỉ thêm vào `campaigns`, `kpis`, `budget_lines`** — vì dữ liệu demo của đúng 3 collection này đã có sẵn hai field đó. `tasks`/`activities`/`contentItems` demo không có → không thêm; app suy Brand/Segment qua campaign cha như cơ chế hiện hành. `kpis` thêm cả `phase_id`, `period_key`, `source` (demo đã có). `kpis.actual` **không** thêm cột: actual suy từ `measurements` như cơ chế hiện hành, và mọi giá trị `actual` trong demo đều `null` nên không mất dữ liệu.
5. **Members demo KHÔNG seed**: app không có bảng `members` — members là `memberships` JOIN `users` (id = `auth.users.id`). Seed không đụng `auth.users`, `public.users`, `memberships`. Hệ quả: mọi cột FK tới users mà demo điền member id (`owner_id`, `approver_id`, `approved_by`, `created_by`, `requested_by`…) được seed để **NULL**. Bảng tra member demo (để Owner gán lại sau khi chuyển): `member-owner` = Zac (owner), `member-lead` = Hiếu (lead), `member-content` = Kiều, `member-design` = Triều, `member-hien` = Hiển, `member-long` = Long, `member-ns` = NS, `member-ds-hn` = DS Hà Nội, `member-thanh` = Thành. Tên người phụ trách gốc vẫn còn trong text `source_ref` của từng task Camp 01 (custom_fields) nên truy lại được. Capacity của member demo cũng không seed (member_capacity thuộc về user thật).
6. **businessUnits → bu_products**: mở rộng theo `products[]` như `_loadBusinessUnits` ở chế độ thật: 4 đơn vị → **5 dòng** bu_products (Game Studio có 2 sản phẩm). `campaigns.custom_fields.business_unit_id` được seed bằng **tên đơn vị** (vd `Publishing`) vì ở chế độ thật id của BU chính là `bu_name`. `content_pillars.bu_product_id` / `content_items.bu_product_id`: demo gắn ở mức đơn vị, DB gắn ở mức sản phẩm → seed trỏ tới **sản phẩm đầu tiên** của đơn vị đó.
7. **Ánh xạ đặc thù theo collection trong seed** (generator mirror đúng `Store._toPayload`): campaigns `why` → cột `objectives` (bản sao vẫn giữ trong custom_fields); kpis `metric_code` (NOT NULL, demo không có) suy từ id demo (vd `kpi-camp01-brand-follows` → `camp01_brand_follows`), `period_start`/`period_end` suy từ `periodKey`; tasks `completed` thiếu `completed_at` (DB check bắt buộc) → suy = `due_date`; variants `editorialStatus`/`approvalStatus` dịch sang enum DB (`approved` → `final`…), TikTok ép `publish_mode='external'`; brandPages `status`/`version` → `guidelines` jsonb (đúng cách store đọc ở chế độ thật); brandAssets `type` ngoài enum → `asset_type='other'` + `tags=[type gốc]`, `Approved`/`Draft` → `approval_status`, và `version` → dòng `asset_versions` phái sinh (3 dòng); channelAccounts trạng thái tiếng Việt → enum DB; adAccounts thiếu `external_id` (NOT NULL) → dùng chính demo id `adacc-1` làm placeholder; adChangeRequests `title`/`target`/`defaultState` → `after_state` + `reason` (theo `adChangePayload` khi insert, `target_type='ad_campaign'`, `change_type='other'`); reportSnapshots → `report_type='custom'`, `metrics`/`summary`/`status`/`frozenAt` gói vào `data` jsonb, `generated_at = frozenAt`; metricObservations → `object_type='external_post'`, `object_id` = uuid của external post đã seed, `period_start = period_end = observed_at`, `enteredBy` giữ trong `dimensions.entered_by_demo_id`; cashTransactions `title` → `note` + `idempotency_key = 'seed-<demo id>'`; timestamps thiếu → mốc cố định `2026-11-17T12:00:00+07:00` để seed sinh lại luôn giống hệt.
8. **Field cố ý loại (không vào DB)** — chỉ 3 nhóm, đều là dữ liệu suy được ở chế độ thật: (i) mọi field nhãn `*Label`/`statusLabel` (app tự dịch từ status); (ii) `variants.revision` (demo đều = 1; chế độ thật suy từ `content_revisions`, mặc định 1 khi chưa có revision); (iii) `channelAccounts.apiImplementation`/`capabilities` (chế độ thật lấy từ registry tĩnh `providers.ts` + capabilities tổng hợp trong `_rowToItem`). `holidays` (1 ngày) không có bảng trong schema — app ở chế độ thật vốn để trống; không seed.
9. **Seed chạy bằng SQL Editor (vai postgres) là có chủ ý**: seed ghi cả số đã duyệt (`budget_lines.approved_amount`, `campaigns.budget_ceiling_amount`) — đường ghi qua app bị khóa bởi chuỗi duyệt 0014/RPC, nhưng đây là nạp dữ liệu khởi tạo một lần, không phải thao tác nghiệp vụ.

---

## (a) Áp migration 0017

Điều kiện tiên quyết: **CỔNG THỨ TỰ SEED** ở trên đã qua (seed bản cuối đã sinh từ demo-data sau commit B2B trên demo, đối chiếu đúng hash, suite xanh).

1. Mở Supabase Dashboard (phiên đăng nhập sẵn) → project **sava-marketing-workspace** → **SQL Editor**.
2. Dán **toàn bộ** nội dung file `supabase/migrations/0017_brand_planning.sql` → Run. Kỳ vọng: không lỗi (file idempotent — chạy lại lần hai cũng không lỗi).
3. Kiểm chứng ngay bằng các câu lệnh sau (chạy trong SQL Editor):

```sql
-- 4 bảng mới phải tồn tại:
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('brands','benchmarks','plan_rows','phase_assumptions')
order by table_name;                       -- kỳ vọng: 4 dòng

-- RLS phải bật ở cả 4 bảng mới:
select relname, relrowsecurity from pg_class
where relname in ('brands','benchmarks','plan_rows','phase_assumptions')
order by relname;                          -- kỳ vọng: 4 dòng, relrowsecurity = true

-- Số policy của 4 bảng mới:
select tablename, count(*) as so_policy from pg_policies
where schemaname = 'public' and tablename in ('brands','benchmarks','plan_rows','phase_assumptions')
group by tablename order by tablename;     -- kỳ vọng: mỗi bảng 4, tổng 16 policy

-- Cột mới trên các bảng cũ:
select table_name, count(*) as so_cot_moi from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'phases' and column_name in ('brand_id','segment','start_month','end_month','objective','uplift_percent_per_month','note','paid_churn_rate','free_churn_rate','arppu','cogs_per_user','fixed_cost','opening_free','opening_paid','b2b_churn_rate','arppu_b2b','cogs_per_b2b_account','opening_b2b')) or
  (table_name = 'campaigns' and column_name in ('brand_id','segment')) or
  (table_name = 'kpis' and column_name in ('brand_id','segment','phase_id','period_key','source')) or
  (table_name = 'budget_lines' and column_name in ('brand_id','segment'))
) group by table_name order by table_name;
-- kỳ vọng: phases 18, campaigns 2, kpis 5, budget_lines 2

-- Ràng buộc scope mới của phases:
select conname from pg_constraint
where conrelid = 'public.phases'::regclass and conname = 'phases_scope_check';
-- kỳ vọng: 1 dòng
```

## (b) Chạy seed

Điều kiện tiên quyết: seed trong tay là **bản cuối** (đã qua CỔNG THỨ TỰ SEED — không phải SEED NHÁP) + bước (a) xong + DB đang **trống nghiệp vụ** trong workspace đích (kiểm nhanh: `select count(*) from public.campaigns where workspace_id = 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6';` phải = 0; tương tự `tasks`, `plan_rows`).

1. SQL Editor → dán toàn bộ `supabase/seed/from-demo-data.sql` → Run. File đã bọc `begin; … commit;` — lỗi ở bất kỳ INSERT nào thì toàn bộ seed tự rollback, sửa nguyên nhân rồi chạy lại từ đầu (đừng chạy từng đoạn).
2. Cuối file seed đã kèm sẵn các SELECT kiểm chứng — chạy chúng (hoặc chạy lại riêng phần sau `commit;`). Số kỳ vọng cụ thể từng bảng (cột `ky_vong` trong chính truy vấn): brands 2, bu_products 5, campaigns 3, phases 7, activities 3, content_pillars 4, brand_pages 3, assets 3, asset_versions 3, channel_accounts 4, content_items 27, content_variants 33, external_posts 1, metric_observations 1, budget_lines 11, kpis 12, tasks 116, ad_accounts 1, ads_change_requests 1, marketing_requests 1, cash_accounts 2, cash_transactions 6, report_snapshots 1, benchmarks 7, plan_rows 237, phase_assumptions 12.
3. **4 số neo** (cũng có sẵn ở cuối file seed, cột `ky_vong` để đối chiếu):
   - Lumus **776** content: `sum(qty)` của plan_rows thuộc brand Lumus AI.
   - Tổng ngân sách Planning năm **2027 = 1.598.700.000đ**: Σ (qty × đơn giá hiệu dụng) + Σ budget trực tiếp, đơn giá hiệu dụng = `unit_price` của dòng, trống thì benchmark Brand × Channel (truy vấn join ở cuối seed). Lưu ý: đây là tổng theo **năm 2027** — các dòng ngân sách trực tiếp của SAVA (51.539.000đ) nằm ở tháng 2026 nên không nằm trong số này.
   - Camp 01 budget **51.539.000đ**: `sum(planned_amount)` của budget_lines thuộc Camp 01.
   - **115** task thuộc Camp 01: `count(*)` tasks có `campaign_id` của Camp 01 (tổng tasks là 116 — 1 task độc lập không thuộc campaign nào).

## (c) Push commit gỡ demo

Chỉ làm sau khi (a) + (b) kiểm chứng đạt. Commit gỡ demo đã chuẩn bị sẵn ở branch local `prep/remove-demo-mode` (tạo từ đỉnh `feat/marketing-workspace` sau khi các commit chuẩn bị đã push), hash: **`__SEED_DEMO_COMMIT_HASH__`** (điền khi bàn giao đợt chuẩn bị — xem báo cáo bàn giao kèm runbook này).

```bash
cd ~/workspace/worktrackingos
git checkout prep/remove-demo-mode   # chứa đúng 1 commit gỡ demo trên đỉnh feat/marketing-workspace
npm test                             # phải xanh toàn bộ trước khi push
git push origin prep/remove-demo-mode:feat/marketing-workspace
git checkout feat/marketing-workspace
git pull --ff-only origin feat/marketing-workspace   # đồng bộ về đúng commit vừa push
```

Nội dung commit gỡ demo: app khởi động thẳng vào dữ liệu thật (Supabase); bỏ nút "Xem dữ liệu mẫu" ở màn hình đăng nhập, bỏ các nút demo ở Planning/Brand và công tắc demo trong Thiết lập; bỏ toàn bộ đường nạp `js/demo-data.js` vào app (file vẫn ở trong repo vì test còn dùng làm fixture dữ liệu + là nguồn sinh seed).

## (d) Kiểm chứng cuối bằng tài khoản Owner trên app

Đăng nhập Owner → kiểm từng số neo tại đúng màn hình:

1. **776 + 1.598.700.000đ**: mở **Planning** → bộ lọc Brand/Segment toàn cục để **Tất cả / Tất cả** → chọn **năm 2027** → lưới Theo tháng: tổng số lượng của Brand Lumus AI (cột tổng năm / thẻ Brand ở trang Brand) = **776**; tổng ngân sách năm hiển thị ở Planning (tổng Budget của lưới năm 2027) = **1.598.700.000đ**. Bấm vào một dòng Channel (vd KOL Nano) → bảng chi tiết mở ngay bên dưới, sửa được Số lượng/Đơn giá (không còn banner khóa "chưa có bảng").
2. **Planning Theo phase**: chuyển chế độ Theo phase → thấy 4 phase Lumus (Preparation → Scale & Convert) + phase SAVA; ô Uplift / Tỉ lệ / Đơn giá mỗi bài sửa được và lưu (toast thành công, tải lại trang vẫn giữ số).
3. **51.539.000đ + 115 task**: mở **Campaigns** → **CAMP 01 — PLAY THE UNKNOWN** → tổng ngân sách (Σ dòng ngân sách) = **51.539.000đ**, số task của campaign = **115**. Trang Brand: thẻ **SAVA META** hiện 3 Campaign; thẻ **Lumus AI** hiện 216 dòng plan.
4. **Không còn dấu vết demo**: không banner "Dữ liệu minh họa", màn hình đăng nhập không có nút "Xem dữ liệu mẫu", Thiết lập không có mục "Chế độ demo", thanh trên không có bộ đổi người dùng demo.

## (e) Quay lui

**Seed sai (0017 đúng, dữ liệu sai)** — xóa dữ liệu nghiệp vụ của workspace đích theo thứ tự con → cha dưới đây (giữ nguyên `workspaces`, `users`, `memberships`, `member_capacity` và mọi dữ liệu ngoài workspace đích). Chạy trong SQL Editor, thay `<WS>` = `a0870eed-cbdc-4fde-a3da-0b09d83d83b6`:

```sql
begin;
delete from public.phase_assumptions where workspace_id = '<WS>';
delete from public.plan_rows where workspace_id = '<WS>';
delete from public.benchmarks where workspace_id = '<WS>';
delete from public.metric_observations where workspace_id = '<WS>';
delete from public.post_content_mappings where workspace_id = '<WS>';
delete from public.external_posts where workspace_id = '<WS>';
delete from public.content_revisions where workspace_id = '<WS>';
delete from public.tiktok_scripts where workspace_id = '<WS>';
delete from public.approval_decisions where workspace_id = '<WS>';
delete from public.approval_steps where workspace_id = '<WS>';
delete from public.publish_jobs where workspace_id = '<WS>';
delete from public.content_variants where workspace_id = '<WS>';
delete from public.content_items where workspace_id = '<WS>';
delete from public.task_dependencies where workspace_id = '<WS>';
delete from public.blockers where workspace_id = '<WS>';
delete from public.budget_allocations where workspace_id = '<WS>';
delete from public.budget_actuals where workspace_id = '<WS>';
delete from public.budget_commitments where workspace_id = '<WS>';
delete from public.budget_proposals where workspace_id = '<WS>';
delete from public.budget_lines where workspace_id = '<WS>';
delete from public.measurements where workspace_id = '<WS>';
delete from public.kpi_contributions where workspace_id = '<WS>';
delete from public.kpi_target_versions where workspace_id = '<WS>';
delete from public.kpis where workspace_id = '<WS>';
delete from public.cash_transactions where workspace_id = '<WS>';
delete from public.cash_accounts where workspace_id = '<WS>';
delete from public.cash_categories where workspace_id = '<WS>';
delete from public.ads_change_requests where workspace_id = '<WS>';
delete from public.ads_insights where workspace_id = '<WS>';
delete from public.ads where workspace_id = '<WS>';
delete from public.ad_groups where workspace_id = '<WS>';
delete from public.ad_campaigns where workspace_id = '<WS>';
delete from public.ad_accounts where workspace_id = '<WS>';
delete from public.marketing_requests where workspace_id = '<WS>';
delete from public.report_snapshots where workspace_id = '<WS>';
delete from public.comments where workspace_id = '<WS>';
delete from public.tasks where workspace_id = '<WS>';
delete from public.activities where workspace_id = '<WS>';
delete from public.campaign_assets where workspace_id = '<WS>';
delete from public.campaign_baselines where workspace_id = '<WS>';
delete from public.campaigns where workspace_id = '<WS>';
delete from public.phases where workspace_id = '<WS>';
delete from public.channel_accounts where workspace_id = '<WS>';
delete from public.brand_page_versions where workspace_id = '<WS>';
delete from public.brand_pages where workspace_id = '<WS>';
delete from public.asset_versions where workspace_id = '<WS>';
delete from public.assets where workspace_id = '<WS>';
delete from public.content_pillars where workspace_id = '<WS>';
delete from public.bu_products where workspace_id = '<WS>';
delete from public.brands where workspace_id = '<WS>';
commit;
```

Sau khi xóa: sửa nguyên nhân (sửa `js/demo-data.js` hoặc generator rồi chạy lại script sinh seed, hoặc sửa migration nếu là lỗi schema) → chạy lại seed từ bước (b).

**Phải quay lui cả 0017** khi: migration gây lỗi cho dữ liệu/vận hành cũ (vd ràng buộc `phases_scope_check` chặn thao tác cũ), hoặc quyết định hủy đợt chuyển đổi. Cách làm:
1. Xóa dữ liệu như trên (bảng mới phải trống trước khi drop).
2. Drop phần 0017:

```sql
drop table if exists public.phase_assumptions;
drop table if exists public.plan_rows;
drop table if exists public.benchmarks;
drop table if exists public.brands;
alter table public.phases drop column if exists brand_id, drop column if exists segment,
  drop column if exists start_month, drop column if exists end_month, drop column if exists objective,
  drop column if exists uplift_percent_per_month, drop column if exists note,
  drop column if exists paid_churn_rate, drop column if exists free_churn_rate, drop column if exists arppu,
  drop column if exists cogs_per_user, drop column if exists fixed_cost,
  drop column if exists opening_free, drop column if exists opening_paid;
alter table public.phases drop constraint if exists phases_scope_check;
alter table public.phases drop constraint if exists phases_segment_check;
alter table public.phases drop constraint if exists phases_month_format_check;
-- Khôi phục ràng buộc scope gốc của 0001:
alter table public.phases add constraint phases_plan_campaign_check
  check (plan_id is not null or campaign_id is not null);
alter table public.campaigns drop column if exists brand_id, drop column if exists segment;
alter table public.kpis drop column if exists brand_id, drop column if exists segment,
  drop column if exists phase_id, drop column if exists period_key, drop column if exists source;
alter table public.budget_lines drop column if exists brand_id, drop column if exists segment;
```

3. **Commit gỡ demo khi quay lui**: nếu chưa push theo mục (c) thì không cần làm gì (branch `prep/remove-demo-mode` cứ để local). Nếu **đã push** rồi mới quay lui: tạo commit revert trên `feat/marketing-workspace` (`git revert <hash-gỡ-demo>`) và push — app quay lại có chế độ demo như trước đợt này; không force-push.
