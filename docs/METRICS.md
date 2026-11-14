# Định nghĩa chỉ số & công thức — SAVA Marketing Workspace

> Nguồn sự thật cho mọi số hiển thị trên dashboard, báo cáo và snapshot.
> Ngày chốt: 11/11/2026. Múi giờ kỳ báo cáo: Asia/Ho_Chi_Minh; tuần bắt đầu
> thứ Hai; ngày hiển thị dd/mm/yyyy.
> Dữ liệu gốc lưu ở `metric_observations` (organic) và `ads_insights` (paid);
> chỉ số dẫn xuất **tính khi hiển thị**, không lưu trữ, để luôn khớp định
> nghĩa hiện hành + `definition_version` của kỳ.

## 1. Công thức chỉ số quảng cáo (§10.8–10.9)

| Chỉ số | Công thức | Đơn vị hiển thị |
|---|---|---|
| CTR | `clicks / impressions` | % |
| CPC | `spend / clicks` | tiền/click (theo currency của tài khoản ads) |
| CPM | `spend / impressions × 1000` | tiền/1.000 hiển thị |
| Cost per result | `spend / results` | tiền/kết quả (kèm `result_type`) |
| ROAS | `conversion_value / spend` | **dạng lần** — ví dụ `2,4 lần`, không hiển thị % |

Quy tắc bắt buộc:

- **Mẫu số bằng 0 hoặc thiếu dữ liệu → hiển thị "Không tính được"**, không
  hiển thị `0`, không hiển thị `0%`, không suy diễn. Trong dữ liệu, giá trị
  không có = `NULL` (khác với giá trị thật bằng 0).
- Không trộn tiền tệ: chỉ tổng hợp các dòng cùng `currency`; khác currency
  thì tách cột/theo tài khoản.
- **Tỷ lệ tổng hợp tính từ tổng tử số / tổng mẫu số** của toàn kỳ
  (ví dụ CTR kỳ = Σclicks / Σimpressions), **không** trung bình cộng các CTR
  theo ngày/bài — trung bình các tỷ lệ sẽ sai khi mẫu số khác nhau.

## 2. Chỉ số tương tác (Engagement Rate)

ER không có một công thức duy nhất — **mọi nơi hiển thị ER phải ghi rõ cách
tính đang dùng** ngay cạnh con số:

| Cách tính | Công thức | Khi dùng |
|---|---|---|
| ER theo reach | `tổng tương tác / reach` | Mặc định cho bài organic khi có reach |
| ER theo impressions | `tổng tương tác / impressions` | Khi nền tảng không trả reach (hoặc so sánh chéo nền tảng) |
| ER theo followers | `tổng tương tác / followers tại thời điểm đăng` | Khi so sánh giữa các tài khoản/kênh khác cỡ |

- "Tổng tương tác" phải liệt kê gồm những gì theo từng nền tảng (reactions +
  comments + shares [+ saves nếu nền tảng có]) — không so sánh ER giữa hai
  nền tảng nếu tử số gồm thành phần khác nhau mà không ghi chú.
- Mẫu số 0/thiếu → "Không tính được" như mục 1.

## 3. Snapshot trọn đời (lifetime) & kỳ báo cáo

- Chỉ số **lifetime** (tích lũy từ khi đăng) là *snapshot*: ở mỗi lần sync,
  lấy **giá trị mới nhất** (`observed_at` lớn nhất) — **tuyệt đối không cộng
  dồn các lần sync** (cộng dồn sẽ nhân đôi).
- Phân biệt rạch ròi hai khái niệm, mọi báo cáo phải ghi thuộc loại nào:
  - **"Bài đăng trong kỳ"**: tập bài có `published_at` nằm trong kỳ, kèm hiệu
    quả (thường là lifetime hoặc tới cuối kỳ) của chính các bài đó.
  - **"Hiệu quả phát sinh trong kỳ"**: mọi biến động/chỉ số ghi nhận trong kỳ,
    kể cả phát sinh trên bài đăng từ kỳ trước.
- Hai loại số này khác nhau về bản chất; không đặt cạnh nhau như thể cùng
  một thước đo mà không ghi nhãn.

## 4. Những phép cộng bị cấm

- **Không cộng reach duy nhất (unique reach)** giữa các bài, các ngày hoặc
  các tài khoản: một người thấy 3 bài vẫn là 1 reach duy nhất ở cấp tổng
  (nền tảng không cung cấp reach tổng đã khử trùng lặp từ reach từng bài).
  Cần reach tổng thì lấy metric reach ở cấp tài khoản/kỳ do nền tảng trả.
- **Không cộng chồng các cấp ads**: account + campaign + ad group (ad set) +
  ad là các lát cắt của *cùng một* chi phí. Tổng hợp ở cấp nào thì chỉ lấy
  dữ liệu của đúng cấp đó.
- **Không cộng breakdown chồng lấn**: các breakdown (theo tuổi, giới tính,
  vị trí hiển thị…) là các cách chia khác nhau của cùng một tổng; chỉ dùng
  một breakdown tại một thời điểm, không cộng các breakdown với nhau.
- Followers có thể **âm** (mất follower ròng trong kỳ): giữ nguyên số âm,
  không đổi thành 0.

## 5. Tiến độ campaign & ngân sách (§12)

- **Tiến độ campaign** tính từ **leaf tasks** (task không có task con) thuộc
  campaign: `tiến độ = số leaf task 'completed' / tổng số leaf task`, **loại
  trừ task đã hủy ('cancelled') khỏi mẫu số**. Task cha và subtask không
  được tính trùng: task có con thì chính nó không tham gia tử/mẫu (tránh
  đếm 2 lần cùng một việc). Không có leaf task hợp lệ → "Chưa có dữ liệu",
  không hiển thị 0%.
- **Ngân sách còn lại** của một dòng ngân sách (semantic CHỐT vòng R1,
  khớp `budget_remaining()` ở `supabase/migrations/0005_data_contracts.sql`
  và `budgetRemaining()` ở `js/domain.js` — JS/SQL/export dùng đúng 1 quy tắc):
  `remaining = approved − Σ actuals − Σ (commitment.amount − commitment.settled_amount)`
  với tổng cam kết chỉ gồm cam kết **còn mở** (status `planned` / `committed` /
  `partially_actualised`; phía frontend alias `open` / `partial` tương ứng).
  `settled_amount` là phần cam kết đã thanh toán/đối soát, ghi trực tiếp trên
  commitment (nguồn sự thật — không suy từ actuals nữa; khi đọc dữ liệu cũ
  chưa có `settled_amount`, JS mới fallback sang Σ actuals gắn commitment đó).
  Cam kết `settled` / `released` / `cancelled` **không** trừ phần chưa settle
  (coi như đã giải phóng ngân sách); phần đã trả của chúng nằm trong Σ actuals.
  Kết quả âm = vượt ngân sách, giữ số âm.

  **Fixture đối chiếu QA23 (JS + SQL + export phải ra cùng một số):**

  | Hạng mục | Giá trị |
  |---|---|
  | approved | 1.000.000 |
  | C-open (committed, amount 250.000, settled_amount 0) | trừ 250.000 |
  | C-partial (partially_actualised, amount 300.000, settled_amount 200.000) | trừ 100.000 |
  | C-settled (settled, amount 150.000, settled_amount 150.000) | trừ 0 |
  | C-cancelled (cancelled, amount 80.000, settled_amount 0) | trừ 0 |
  | Actuals: 200.000 (gắn C-partial) + 150.000 (gắn C-settled) + 100.000 (không gắn) | trừ 450.000 |
  | **remaining** | **200.000** |

  Regression: `QA23` trong `tests/r1-regressions.test.mjs` (tầng unit) dùng
  đúng bộ số này.
- Chi ads đồng bộ về (`budget_actuals.ad_spend_source_id`) phải đối chiếu
  với `ads_insights` theo nguồn đó để không cộng trùng chi quảng cáo hai lần
  trong cùng một báo cáo.

## 6. Ghi chú khi trình bày cho lãnh đạo

- Mọi số trong `report_snapshots` là số **đã đóng băng** tại thời điểm tạo
  báo cáo kèm `definition_versions` đã dùng; số liệu nguồn thay đổi về sau
  không làm đổi snapshot. Muốn số mới → tạo snapshot mới.
- Khi một chỉ số ghi "Không tính được", phải ghi lý do thuộc loại nào:
  chưa kết nối kênh, nền tảng không trả, hay mẫu số bằng 0.

## 7. Bổ sung vòng R1 (11/11/2026)

- **Lifetime theo object (R23/QA19):** khi tổng hợp lifetime của nhiều bài,
  lấy latest theo từng `object + metric + scope + definition_version` trước
  (`lifetimeLatestByObject` ở `js/domain.js`), rồi mới cộng các latest đó —
  và chỉ cộng khi cùng metric/scope/definition/currency
  (`sumLifetimeLatest`; khác định nghĩa → `null`). Ví dụ kiểm chứng:
  A: 100 → 150, B: 200 → 250 ⇒ latest A=150, B=250, tổng = 400 (không phải
  700 nếu cộng mọi snapshot, không phải 250 nếu lấy 1 bài đại diện).
- **Thiếu dữ liệu (R22/QA20):** `aggregateRates` — trường nào thiếu
  (null) ở bất kỳ dòng nào thì tổng trường đó = `null` và tỷ lệ phụ thuộc
  trả `null` (ví dụ `conversionValue = null` ⇒ ROAS `null`, không phải 0).
  Export CSV (`buildCsv` ở `js/domain.js`): giá trị thiếu = **ô trống**,
  kèm cột cuối `missing_status` liệt kê cột thiếu của dòng (`đầy đủ` nếu đủ);
  số 0 thật vẫn xuất `0`.
- **Workload (R25/QA22):** chỉ tính **leaf tasks**; effort phân bổ theo ngày
  làm việc trên toàn khoảng task rồi chỉ cộng phần thuộc **tuần được chọn**
  (`weeklyWorkload(tasks, { weekStart, capacityByMember, holidays })`).
  Capacity và ngày nghỉ lấy từ cấu hình truyền vào — không hardcode
  40h/tuần hay 8h/ngày; thiếu cấu hình thì capacity = `null`.
