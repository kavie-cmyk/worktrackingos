/*
 * js/demo-data.js — Dữ liệu minh họa của SAVA Marketing Workspace.
 * TOÀN BỘ dữ liệu trong file này là dữ liệu minh họa (demo), không phải dữ liệu thật.
 * Chỉ được nạp khi người dùng chủ động bật chế độ demo ở Thiết lập hoặc mở ?demo=1.
 */
(function (global) {
  'use strict';

  // =====================================================================
  // Brand + Planning (bản bấm thử 17/11/2026) — CHỈ dữ liệu demo.
  // Nguồn: Lumus 2027 Master Forecast (.xlsm): sheet "01 Execution" (ma
  // trận channel × tháng), sheet "03 Inputs" (benchmark/đơn giá/tỉ lệ),
  // sheet "04 Monthly" (Paid Ads T1–T2 đối chiếu); Draft IMC Game Chapter
  // (.xlsm): campaign PLAY/BUILD THE UNKNOWN + tổng ngân sách từng camp.
  // Xem tài liệu mô hình: MO-HINH-BRAND-PLANNING.md.
  // =====================================================================
  var PLAN_MONTHS_2027 = ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
    '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'];
  // Ma trận sản lượng Lumus AI theo sheet 01 Execution (T1..T12).
  // Website Articles: 11 ở 10 tháng đầu, 10 ở T11–T12 (tổng 130, khớp file).
  var PLAN_MATRIX = [
    { channel: 'KOL Nano', group: 'KOL', segment: 'b2c', unit: 'assets', qty: [4, 6, 7, 7, 7, 3, 4, 4, 3, 10, 8, 2] },
    { channel: 'KOL Micro', group: 'KOL', segment: 'b2c', unit: 'assets', qty: [4, 5, 6, 7, 6, 3, 3, 3, 3, 9, 9, 2] },
    { channel: 'KOL Expert', group: 'KOL', segment: 'b2c', unit: 'assets', qty: [1, 1, 1, 2, 1, 0, 1, 0, 1, 2, 2, 0] },
    { channel: 'Facebook Owned', group: 'Owned Social', segment: 'b2c', unit: 'posts', qty: [21, 20, 20, 21, 20, 20, 21, 20, 20, 21, 20, 20] },
    { channel: 'TikTok Owned', group: 'Owned Social', segment: 'b2c', unit: 'videos', qty: [9, 9, 8, 9, 9, 8, 9, 9, 8, 9, 9, 8] },
    { channel: 'LinkedIn Owned', group: 'Owned Social', segment: 'b2b', unit: 'posts', qty: [9, 9, 8, 9, 9, 8, 9, 9, 8, 9, 9, 8] },
    { channel: 'Website Articles', group: 'Content', segment: 'b2c', unit: 'articles', qty: [11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 10, 10] },
    { channel: 'Email Sends', group: 'Email', segment: 'b2c', unit: 'sends', qty: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
    { channel: 'B2B Event', group: 'Event', segment: 'b2b', unit: 'events', qty: [0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0] },
    { channel: 'Paid Community', group: 'Community', segment: 'b2c', unit: 'activities', qty: [2, 2, 3, 3, 3, 1, 1, 2, 2, 4, 3, 1] }
  ];
  // Paid Ads: ngân sách THẲNG theo tháng (VNĐ), không có qty/đơn giá.
  // Cách quy ra tháng từ file nguồn (03 Inputs): quỹ Paid Media 31.200 USD
  // (Meta 21.000 / TikTok 7.000) × ADS pace theo phase (GĐ1 5% / GĐ2 40% /
  // GĐ3 15% / GĐ4 40%) × stage split trong phase (GĐ1: 40/60; GĐ2: 30/40/30;
  // GĐ3: 20/25/25/30; GĐ4: 46/46/8) × FX 26.000 VNĐ/USD. Đối chiếu: T1 Meta
  // 420 USD / TikTok 140 USD và T2 Meta 630 / TikTok 210 KHỚP sheet 04
  // Monthly; tổng năm Meta 546.000.000đ (=21.000 USD), TikTok 182.000.000đ.
  var PAID_BUDGET_VND = {
    'Meta Ads': [10920000, 16380000, 65520000, 87360000, 65520000, 16380000, 20475000, 20475000, 24570000, 100464000, 100464000, 17472000],
    'TikTok Ads': [3640000, 5460000, 21840000, 29120000, 21840000, 5460000, 6825000, 6825000, 8190000, 33488000, 33488000, 5824000]
  };
  function planSlug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  // Phase Lumus theo khoảng tháng (khớp BRAND_PHASES bên dưới):
  // T1–T2 → GĐ1, T3–T5 → GĐ2, T6–T9 → GĐ3, T10–T12 → GĐ4.
  function lumusPhaseIdForMonth(month) {
    if (month <= '2027-02') return 'phase-lumus-1';
    if (month <= '2027-05') return 'phase-lumus-2';
    if (month <= '2027-09') return 'phase-lumus-3';
    return 'phase-lumus-4';
  }
  function buildPlanRows() {
    var rows = [];
    PLAN_MATRIX.forEach(function (m) {
      PLAN_MONTHS_2027.forEach(function (month, i) {
        rows.push({
          id: 'plan-lumus-' + month + '-' + planSlug(m.channel),
          brand_id: 'brand-lumus-ai', segment: m.segment, month: month,
          channel: m.channel, group: m.group, unit: m.unit, qty: m.qty[i], budget: null,
          phase_id: lumusPhaseIdForMonth(month)
        });
      });
    });
    Object.keys(PAID_BUDGET_VND).forEach(function (channel) {
      PLAN_MONTHS_2027.forEach(function (month, i) {
        rows.push({
          id: 'plan-lumus-' + month + '-' + planSlug(channel),
          brand_id: 'brand-lumus-ai', segment: 'b2c', month: month,
          channel: channel, group: 'Paid Media', unit: null, qty: null,
          budget: PAID_BUDGET_VND[channel][i],
          phase_id: lumusPhaseIdForMonth(month)
        });
      });
    });
    return rows;
  }
  var PLAN_ROWS = buildPlanRows();
  // plan_rows SAVA META — CAMP 01 (T10–T11/2026): qty = số content theo channel x tháng
  // đếm từ 24 dòng tab Social Plan; budget = 9 dòng ngân sách CAMP 01 phân bổ theo tháng
  // chạy của activity (Brand Content Meta Ads chia đều T10/T11; PR HNĐT đăng cuối T10;
  // còn lại T11 — tháng của Job Fair 06/11, Livestream 12/11 và Game Cũ 03–16/11).
  var SAVA_PLAN_ROWS = [
  {
    "id": "plan-sava-2026-10-email-crm",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-10",
    "channel": "Email CRM",
    "group": "Email",
    "unit": "sends",
    "qty": 3,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-10-facebook",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-10",
    "channel": "Facebook",
    "group": "Owned Social",
    "unit": "posts",
    "qty": 5,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-10-linkedin",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-10",
    "channel": "LinkedIn",
    "group": "Owned Social",
    "unit": "posts",
    "qty": 3,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-10-website",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-10",
    "channel": "Website",
    "group": "Content",
    "unit": "articles",
    "qty": 3,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-11-email-crm",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Email CRM",
    "group": "Email",
    "unit": "sends",
    "qty": 4,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-11-facebook",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Facebook",
    "group": "Owned Social",
    "unit": "posts",
    "qty": 18,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-11-gamek-pr",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "GameK PR",
    "group": "PR",
    "unit": "articles",
    "qty": 1,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-11-linkedin",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "LinkedIn",
    "group": "Owned Social",
    "unit": "posts",
    "qty": 4,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-11-tiktok",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "TikTok",
    "group": "Owned Social",
    "unit": "videos",
    "qty": 1,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-11-website",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Website",
    "group": "Content",
    "unit": "articles",
    "qty": 6,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-2026-11-youtube",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "YouTube",
    "group": "Owned Social",
    "unit": "videos",
    "qty": 1,
    "budget": null,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-01",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-10",
    "channel": "Meta Ads",
    "group": "Paid Media",
    "unit": null,
    "qty": null,
    "budget": 4396000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-02",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Meta Ads",
    "group": "Paid Media",
    "unit": null,
    "qty": null,
    "budget": 4396000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-03",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Meta Ads",
    "group": "Paid Media",
    "unit": null,
    "qty": null,
    "budget": 2000000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-04",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-10",
    "channel": "PR GameK",
    "group": "Campaign Budget",
    "unit": null,
    "qty": null,
    "budget": 6600000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-05",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Rewards",
    "group": "Campaign Budget",
    "unit": null,
    "qty": null,
    "budget": 2884000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-06",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "PTIT-MKT",
    "group": "Campaign Budget",
    "unit": null,
    "qty": null,
    "budget": 5000000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-07",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Meta Ads",
    "group": "Paid Media",
    "unit": null,
    "qty": null,
    "budget": 9438000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-08",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "PR GameK",
    "group": "Campaign Budget",
    "unit": null,
    "qty": null,
    "budget": 6600000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-09",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Community Seeding",
    "group": "Campaign Budget",
    "unit": null,
    "qty": null,
    "budget": 2500000,
    "phase_id": "phase-sava-play"
  },
  {
    "id": "plan-sava-budget-10",
    "brand_id": "brand-sava-meta",
    "segment": "b2c",
    "month": "2026-11",
    "channel": "Rewards",
    "group": "Campaign Budget",
    "unit": null,
    "qty": null,
    "budget": 7725000,
    "phase_id": "phase-sava-play"
  }
];
  PLAN_ROWS = PLAN_ROWS.concat(SAVA_PLAN_ROWS);

  // =====================================================================
  // Phase + Uplift (bổ sung 17/11/2026) — CHỈ dữ liệu demo.
  // LƯU Ý đặt tên: collection `phases` của app VỐN là "giai đoạn campaign"
  // (campaignId/startDate/endDate, có bảng Supabase thật). Các phase
  // Brand + Planning dưới đây nằm CHUNG mảng demo `phases` nhưng phân biệt
  // rõ bằng brand_id + start_month/end_month (không có campaignId nên
  // không lẫn vào màn campaign/Gantt/baseline vốn lọc theo campaignId);
  // liên kết campaign của phase SAVA ghi ở field campaign_id (snake).
  //
  // Lumus: khoảng tháng GĐ1–GĐ4 khớp sheet 03 Inputs (T1–T2 / T3–T5 /
  // T6–T9 / T10–T12). File nguồn KHÔNG có tên phase tiếng Anh, objective
  // theo phase, uplift hay tỉ lệ riêng theo phase → tên + uplift do bản
  // bấm thử chốt (0 / 5 / 5 / 3 %/tháng), objective là ĐIỀN TẠM hợp lý
  // (note ghi rõ từng dòng).
  // SAVA: objective lấy nguyên văn mô tả campaign ở sheet IMC Timeline
  // của file IMC Game Chapter; khoảng tháng PLAY 2026-10..2026-11 và
  // BUILD 2026-11..2027-01 khớp campaign demo tương ứng; CREATE
  // 2027-02..2027-03 lấy từ sheet "KPI & Budget" của file IMC
  // ("CAMP 03 - CREATE THE UNKNOWN | T2–T3/2027") — KHÔNG phải
  // placeholder. Riêng uplift của SAVA là SỐ MẪU nhỏ (1–2%), file nguồn
  // không có số này.
  // =====================================================================
  var BRAND_PHASES = [
    { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', objective: 'Chuẩn bị nền tảng: dựng kênh owned, chốt benchmark và lịch booking KOL/Paid đợt đầu.', uplift_percent_per_month: 0, note: 'Objective điền tạm cho bản bấm thử — file nguồn chỉ ghi khoảng tháng T1–T2 và 15% operating budget cho GĐ1.' },
    { id: 'phase-lumus-2', brand_id: 'brand-lumus-ai', name: 'Test & Validate', start_month: '2027-03', end_month: '2027-05', objective: 'Kiểm chứng: chạy wave Paid T3–T5 cùng KOL, đo tỉ lệ chuyển đổi thực tế so với benchmark giả định.', uplift_percent_per_month: 5, note: 'Objective điền tạm — căn cứ ghi chú file nguồn "Ưu tiên 2 wave: T3–T5 và T10–T11"; uplift 5%/tháng là số của bản bấm thử.' },
    { id: 'phase-lumus-3', brand_id: 'brand-lumus-ai', name: 'Optimize & Grow', start_month: '2027-06', end_month: '2027-09', objective: 'Tối ưu và tăng trưởng: tinh chỉnh channel mix theo dữ liệu GĐ2, duy trì nhịp owned publishing.', uplift_percent_per_month: 5, note: 'Objective điền tạm cho bản bấm thử; uplift 5%/tháng là số của bản bấm thử.' },
    { id: 'phase-lumus-4', brand_id: 'brand-lumus-ai', name: 'Scale & Convert', start_month: '2027-10', end_month: '2027-12', objective: 'Mở rộng và chuyển đổi: dồn lực wave T10–T11, đẩy Signup → First → Paid cuối năm.', uplift_percent_per_month: 3, note: 'Objective điền tạm — căn cứ wave T10–T11 trong file nguồn; uplift 3%/tháng là số của bản bấm thử.' },
    { id: 'phase-sava-play', brand_id: 'brand-sava-meta', segment: 'b2c', campaign_id: 'camp-play-unknown', name: 'PLAY THE UNKNOWN', start_month: '2026-10', end_month: '2026-11', objective: 'Xây dựng tệp khách hàng, mở phễu: tập hợp đúng Game Audience bằng conversation, ký ức và những trải nghiệm chung quanh Game.', uplift_percent_per_month: 1, note: 'Objective theo file IMC Game Chapter; uplift 1%/tháng là SỐ MẪU cho bản bấm thử.' },
    { id: 'phase-sava-build', brand_id: 'brand-sava-meta', segment: 'b2b', campaign_id: 'camp-build-unknown', name: 'BUILD THE UNKNOWN', start_month: '2026-11', end_month: '2027-01', objective: 'Sàng lọc cơ hội kinh doanh, chuyển đổi phễu: đưa Studio/Creator có Project thật vào quy trình đánh giá, Market Test và mở cơ hội hợp tác Publishing.', uplift_percent_per_month: 2, note: 'Objective theo file IMC Game Chapter; uplift 2%/tháng là SỐ MẪU cho bản bấm thử.' },
    { id: 'phase-sava-create', brand_id: 'brand-sava-meta', segment: 'b2c', campaign_id: 'camp-create-unknown', name: 'CREATE THE UNKNOWN', start_month: '2027-02', end_month: '2027-03', objective: 'Mở rộng tệp Future Builder, nuôi dưỡng phễu: chuyển Game Audience từ quan tâm sang hành động sáng tạo, qua đó nhận diện những Creator/Game Maker Signal tiềm năng.', uplift_percent_per_month: 1, note: 'Khoảng tháng + objective theo file IMC Game Chapter (CAMP 03, T2–T3/2027); campaign demo camp-create-unknown đã seed theo đúng tổng file (49.349.500đ); uplift 1%/tháng là SỐ MẪU.' }
  ];
  // phase_assumptions: tỉ lệ null = kế thừa benchmark của brand×channel.
  // File nguồn 03 Inputs KHÔNG ghi tỉ lệ riêng theo phase → toàn bộ 12
  // dòng KOL (3 channel × 4 phase Lumus) để null hết, top_funnel_override
  // cũng null (engine/UI phải chạy đúng khi assumption toàn null).
  var PHASE_ASSUMPTIONS = (function () {
    var out = [];
    var kolChannels = ['KOL Nano', 'KOL Micro', 'KOL Expert'];
    ['phase-lumus-1', 'phase-lumus-2', 'phase-lumus-3', 'phase-lumus-4'].forEach(function (pid) {
      kolChannels.forEach(function (ch) {
        out.push({
          id: 'passump-' + pid.replace('phase-', '') + '-' + planSlug(ch),
          phase_id: pid, channel: ch,
          view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null,
          top_funnel_override: null
        });
      });
    });
    return out;
  })();

  var data = {
    demoLabel: 'Dữ liệu minh họa — không phải dữ liệu thật',
    holidays: ['2026-11-19'],
    members: [
      { id: 'member-owner', name: 'Zac', email: 'zac.demo@sava.example', role: 'owner', roleLabel: 'Owner', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-lead', name: 'Hiếu', email: 'hieu.demo@sava.example', role: 'lead', roleLabel: 'Lead', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-content', name: 'Kiều', email: 'kieu.demo@sava.example', role: 'member', roleLabel: 'Member', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-design', name: 'Triều', email: 'trieu.demo@sava.example', role: 'member', roleLabel: 'Member', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-hien', name: 'Hiển', email: 'hien.demo@sava.example', role: 'member', roleLabel: 'Member', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-long', name: 'Long', email: 'long.demo@sava.example', role: 'member', roleLabel: 'Member', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-ns', name: 'NS', email: 'ns.demo@sava.example', role: 'member', roleLabel: 'Member (Nhân Sự)', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-ds-hn', name: 'DS Hà Nội', email: 'ds-hanoi.demo@sava.example', role: 'member', roleLabel: 'Member (Design Hà Nội)', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-thanh', name: 'Thành', email: 'thanh.demo@sava.example', role: 'member', roleLabel: 'Member', capacityHoursPerWeek: 40, daysOff: [] }
    ],
    businessUnits: [
      { id: 'bu-game', name: 'Game Studio', products: ['Game di động mẫu A', 'Game di động mẫu B'] },
      { id: 'bu-ai', name: 'AI', products: ['Nền tảng AI mẫu'] },
      { id: 'bu-metaverse', name: 'Metaverse', products: ['Trải nghiệm VR mẫu'] },
      { id: 'bu-publishing', name: 'Publishing', products: ['Dịch vụ phát hành mẫu'] }
    ],
    // Brand + Planning (17/11): identity của Lumus AI rút từ file forecast
    // (sản phẩm AI/productivity/quản lý công việc; LinkedIn 100% English);
    // tagline/palette/voice của cả 2 brand là ĐIỀN TẠM hợp lý cho bản bấm
    // thử (trừ màu chủ đạo SAVA #066DBD là màu xanh SAVA đã dùng ở CRM),
    // chờ đội Brand chốt chính thức. funnel_steps theo tài liệu mô hình.
    brands: [
      {
        id: 'brand-sava-meta', code: 'SAVA', name: 'SAVA META',
        tagline: 'Play the Unknown. Build the Unknown.',
        description: 'Thương hiệu SAVA META — Game Studio & Publishing: xây tệp Game Audience (B2C) và mở cơ hội hợp tác Publishing với Studio/Creator (B2B) qua Game Chapter / Road to Global.',
        market: 'Việt Nam',
        primary_color: '#066DBD', color: '#066DBD',
        palette: ['#066DBD', '#0B2A4A', '#F5A623', '#FFFFFF'],
        voice: 'Tiên phong, bản lĩnh, gần gũi với cộng đồng game thủ và giới làm game.',
        key_messages: ['PLAY THE UNKNOWN — chơi và khám phá điều chưa biết', 'BUILD THE UNKNOWN — đưa game Việt ra thị trường toàn cầu', 'CREATE THE UNKNOWN — cộng đồng sáng tạo game'],
        funnel_steps: ['Reach', 'Follow', 'Participation', 'Lead', 'Application'],
        status: 'active'
      },
      {
        id: 'brand-lumus-ai', code: 'LUMUS', name: 'Lumus AI',
        tagline: 'AI cho công việc hiệu quả hơn.',
        description: 'Lumus AI — sản phẩm AI hỗ trợ productivity và quản lý công việc; funnel B2C từ Reach tới Paid User, kênh B2B (LinkedIn, B2B Event, ads B2B) tách theo segment.',
        market: 'Việt Nam (B2C) + thị trường nói tiếng Anh (B2B, LinkedIn 100% English)',
        primary_color: '#6C4CF1', color: '#6C4CF1',
        palette: ['#6C4CF1', '#1E1B4B', '#38BDF8', '#FFFFFF'],
        voice: 'Chuyên môn, rõ ràng, hướng tới hiệu quả đo được.',
        key_messages: ['AI hỗ trợ quản lý công việc và năng suất cá nhân', 'Bắt đầu miễn phí, nâng cấp khi thấy giá trị', 'Nội dung chuyên môn AI/productivity từ KOL Expert'],
        funnel_steps: ['Reach', 'Visit', 'Signup', 'First', 'Paid'],
        status: 'active'
      }
    ],
    // Benchmark = brand × channel (sheet 03 Inputs). Chuỗi hạ nguồn
    // visit→signup 0,09 / signup→first 0,5 / first→paid 0,055 DÙNG CHUNG
    // cho cả 3 KOL trong file nguồn (R44–R46) — chỉ view→visit khác nhau.
    // Paid Ads: direct_budget = true, unit_price/output/view→visit = null
    // (ngân sách nhập thẳng ở plan_rows.budget). Forecast Paid KHÔNG suy
    // Views (cột REACH/VIEWS của file nguồn để trống cho Paid) mà suy
    // Visits từ ngân sách theo đúng công thức sheet 04 Monthly của file:
    // Visits = Ngân sách VNĐ × traffic_share ÷ cost_per_visit, với
    // traffic_share (cột M) + cost_per_visit = COST/LP VISIT VND (cột N)
    // ở 03 Inputs R59 (Meta: 0,6 / 20.000đ) và R60 (TikTok: 0,7 / 22.000đ);
    // hạ nguồn visit→signup 0,09 / signup→first 0,5 / first→paid 0,055
    // lấy từ chính R59/R60 (cột H/I/J). Kiểm chứng: Meta cả năm
    // 546.000.000 × 0,6 ÷ 20.000 = 16.380 Visits và TikTok
    // 182.000.000 × 0,7 ÷ 22.000 = 5.790,909… Visits — khớp sheet
    // 02 KPI Budget R23/R24 của file nguồn.
    benchmarks: [
      { id: 'bench-lumus-kol-nano', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Nano', group: 'KOL', unit_price: 1500000, currency: 'VND', output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, direct_budget: false, confidence: 'C — giả định', source: '03 Inputs — Media kit & Lumus pilot' },
      { id: 'bench-lumus-kol-micro', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Micro', group: 'KOL', unit_price: 5500000, currency: 'VND', output_per_unit: 15000, view_to_visit: 0.004, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, direct_budget: false, confidence: 'C — giả định', source: '03 Inputs — Media kit & Lumus pilot' },
      { id: 'bench-lumus-kol-expert', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Expert', group: 'KOL', unit_price: 30000000, currency: 'VND', output_per_unit: 25000, view_to_visit: 0.005, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, direct_budget: false, confidence: 'C — giả định', source: '03 Inputs — Media kit & Lumus pilot' },
      { id: 'bench-lumus-meta-ads', brand_id: 'brand-lumus-ai', segment: 'b2c', channel: 'Meta Ads', group: 'Paid Media', unit_price: null, currency: 'VND', output_per_unit: null, view_to_visit: null, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, traffic_share: 0.6, cost_per_visit: 20000, direct_budget: true, confidence: 'C — giả định', source: '03 Inputs R59 — Paid Media pool 21.000 USD/năm, ngân sách thẳng theo tháng; traffic share 60% + cost/LP visit 20.000đ (cột M/N), hạ nguồn 0,09/0,5/0,055 (cột H/I/J)' },
      { id: 'bench-lumus-tiktok-ads', brand_id: 'brand-lumus-ai', segment: 'b2c', channel: 'TikTok Ads', group: 'Paid Media', unit_price: null, currency: 'VND', output_per_unit: null, view_to_visit: null, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, traffic_share: 0.7, cost_per_visit: 22000, direct_budget: true, confidence: 'C — giả định', source: '03 Inputs R60 — Paid Media pool 7.000 USD/năm, ngân sách thẳng theo tháng; traffic share 70% + cost/LP visit 22.000đ (cột M/N), hạ nguồn 0,09/0,5/0,055 (cột H/I/J)' }
    ],
    plan_rows: PLAN_ROWS,
    phase_assumptions: PHASE_ASSUMPTIONS,
    campaigns: [
      {
        // Game Chapter Camp 1 (file IMC thật): T10–T11/2026, tổng ngân sách
        // 60.391.500đ; KPI chính: >=6.300 lượt theo dõi mới, 200–300 câu hỏi
        // hợp lệ HNĐT #02. Tệp Game Audience -> segment b2c.
        id: 'camp-play-unknown', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'CAMP 01 — PLAY THE UNKNOWN', businessUnitId: 'bu-publishing', product: 'Game Chapter',
        status: 'planning', statusLabel: 'Đang chuẩn bị', startDate: '2026-10-01', endDate: '2026-11-30',
        ownerId: 'member-lead', budgetCeiling: 51539000, budgetCeilingCurrency: 'VND',
        why: 'Xây dựng tệp khách hàng, mở phễu: tập hợp đúng Game Audience bằng conversation, ký ức và trải nghiệm chung quanh Game.',
        businessGoal: 'Đạt >=6.300 lượt theo dõi mới và 200–300 câu hỏi hợp lệ cho Hỏi Ngay – Đáp Thật #02 (số từ file IMC).',
        marketingGoal: 'Brand Content/Game Culture + HNĐT #02 + Game Cũ - Chuyện Cũ trên Meta Ads, Fanpage, PR GameK và Seeding.',
        desiredOutcome: 'Phễu B2C SAVA META: Reach -> Follow -> Participation.',
        audiences: [{ name: 'Game Audience — người chơi trẻ quan tâm Game', description: 'Tiếp cận qua nội dung văn hóa game và ký ức game thủ.' }],
        audienceInsights: 'Nội dung ký ức game (Game Cũ) kéo tương tác tự nhiên tốt (theo file IMC).',
        bigIdea: 'PLAY THE UNKNOWN — Dấn bước tiên phong.',
        keyMessage: 'Chơi điều chưa biết cùng SAVA META.',
        creativeDirection: 'Nội dung conversation + livestream hỏi đáp + thử thách ký ức game.',
        risks: 'Ngân sách Ads phục vụ đồng thời Follower Growth và Submit câu hỏi, chưa chia riêng hai mục tiêu (ghi chú file IMC).',
        lessons: ''
      },
      {
        // Game Chapter Camp 2 (file IMC thật): T11/2026–T1/2027, tổng ngân
        // sách 154.200.000đ (chưa gồm Market Test Fund 10.000 USD quản lý
        // riêng); KPI: 200 Contact Leads, 40 RTG Applications, 3 Market
        // Tests, 1 Winner. Tệp Studio/Creator -> segment b2b.
        id: 'camp-build-unknown', brand_id: 'brand-sava-meta', segment: 'b2b', name: 'BUILD THE UNKNOWN — Game Chapter (Camp 2)', businessUnitId: 'bu-publishing', product: 'Road to Global',
        status: 'planning', statusLabel: 'Đang chuẩn bị', startDate: '2026-11-01', endDate: '2027-01-31',
        ownerId: 'member-owner', budgetCeiling: 154200000, budgetCeilingCurrency: 'VND',
        why: 'Sàng lọc cơ hội kinh doanh, chuyển đổi phễu: đưa Studio/Creator có Project thật vào quy trình đánh giá, Market Test và mở cơ hội hợp tác Publishing.',
        businessGoal: '200 Contact Leads mới, 40 RTG Applications, 3 Market Tests, 1 Winner, 3–5 Publishing Opportunities (số từ file IMC).',
        marketingGoal: 'Studio Outreach x Gameforum + Road to Global (Announcement -> Education -> Submission) + Qualification & Pitch.',
        desiredOutcome: 'Phễu B2B SAVA META: Lead -> Application -> Market Test.',
        audiences: [{ name: 'Studio / Indie Developer / Game Creator', description: 'Có project thật, quan tâm Publishing và thị trường toàn cầu.' }],
        audienceInsights: 'Contact Leads phải khử trùng, có quyền liên hệ phù hợp; không mặc định 200 leads đều đủ điều kiện RTG (ghi chú file IMC).',
        bigIdea: 'BUILD THE UNKNOWN — Bản lĩnh mở lối toàn cầu.',
        keyMessage: 'Đưa game Việt ra thị trường toàn cầu cùng SAVA Publishing.',
        creativeDirection: 'PR CafeF/CafeBiz + nội dung giáo dục Road to Global + seeding cộng đồng indie developer.',
        risks: 'Market Test Fund 10.000 USD quản lý riêng, không cộng vào ngân sách campaign này.',
        lessons: ''
      },
      {
        // Game Chapter Camp 3 (file IMC): T2–T3/2027, tổng ngân sách
        // 49.349.500đ = HNĐT #03 16.936.500đ + SAVA Game Idea Challenge
        // 32.413.000đ (sheet KPI & Budget, file IMC Game Chapter).
        id: 'camp-create-unknown', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'CAMP 03 — CREATE THE UNKNOWN', businessUnitId: 'bu-publishing', product: 'Game Chapter',
        status: 'planning', statusLabel: 'Đang chuẩn bị', startDate: '2027-02-01', endDate: '2027-03-31',
        ownerId: 'member-lead', budgetCeiling: 49349500, budgetCeilingCurrency: 'VND',
        why: 'Mở rộng tệp Future Builder, nuôi dưỡng phễu: chuyển Game Audience từ quan tâm sang hành động sáng tạo, qua đó nhận diện những Creator/Game Maker Signal tiềm năng.',
        businessGoal: 'New Follows 1.500–1.700; HNĐT #03: 140–160 câu hỏi hợp lệ; SAVA Game Idea Challenge: >=120 Game Idea hợp lệ (số từ file IMC).',
        marketingGoal: 'HNĐT #03 (Paid Ads + PR CafeBiz + Rewards) + SAVA Game Idea Challenge (Paid Ads + Seeding + PR GameK + Rewards).',
        desiredOutcome: 'Phễu B2C SAVA META: Follow -> Participation -> Creator Signal.',
        audiences: [{ name: 'Game Audience / Future Builder', description: 'Người chơi trẻ muốn thử sáng tạo Game Idea đầu tiên.' }],
        audienceInsights: 'Game Idea Challenge không yêu cầu biết Code/Prototype — hạ rào cản sáng tạo để nhận diện Creator Signal (theo file IMC).',
        bigIdea: 'CREATE THE UNKNOWN — Tự do kiến tạo.',
        keyMessage: 'Từ người chơi thành người sáng tạo cùng SAVA META.',
        creativeDirection: 'Livestream HNĐT #03 + thử thách sáng tạo Bé SAVA bằng AI.',
        risks: '',
        lessons: ''
      }
    ],
    // Collection `phases` của demo CHỈ còn BRAND_PHASES (Brand + Planning,
    // brand_id/start_month) — xem ghi chú ở định nghĩa BRAND_PHASES phía trên.
    // (Các phase gắn campaign của fixture tiền đã chuyển vào fixture ẩn
    // tests/fixtures/money-contract.mjs.)
    phases: [].concat(BRAND_PHASES),
    activities: [
      // CAMP 01 — 3 activity đúng tab KPI & Budget (file Action Plan CAMP 01).
      { id: 'act-camp01-brand', campaignId: 'camp-play-unknown', phaseId: 'phase-sava-play', name: 'Brand Content / Game Culture', channel: 'Meta Ads / Fanpage', ownerId: 'member-lead', status: 'in_progress', startDate: '2026-10-01', endDate: '2026-11-30', objective: '2.000 New Follows', deliverables: 'Nội dung Brand/Game Culture chạy Meta Ads' },
      { id: 'act-camp01-hndt', campaignId: 'camp-play-unknown', phaseId: 'phase-sava-play', name: 'HNĐT #02 × PTIT Job Fair', channel: 'Livestream / Meta Ads / PR GameK / PTIT', ownerId: 'member-lead', status: 'in_progress', startDate: '2026-10-19', endDate: '2026-11-17', objective: '300 câu hỏi hợp lệ + 1.000 New Follows', deliverables: 'Landing Page + Livestream HNĐT #02 (12/11) + booth PTIT Job Fair (06/11)' },
      { id: 'act-camp01-gamecu', campaignId: 'camp-play-unknown', phaseId: 'phase-sava-play', name: 'Game Cũ – Chuyện Cũ – Người Cũ', channel: 'Meta Ads / PR GameK / Seeding', ownerId: 'member-lead', status: 'in_progress', startDate: '2026-11-03', endDate: '2026-11-24', objective: '100 bài dự thi + 4.000 New Follows', deliverables: 'Bài phát động MỘT CUỘC CHƠI. NGÀN CHUYỆN ĐỂ KỂ. (nhận bài 03–16/11)' }
    ],
    tasks: [
      // Fixture cây 4 cấp cho Gantt đệ quy (R2-27): task → sub → sub-sub.
      // Việc độc lập (không gắn campaign) — hiện ở nhóm "Việc độc lập" của Gantt tổng.
      { id: 'task-solo-1', campaignId: null, title: 'Cập nhật hồ sơ năng lực của đội Marketing', assigneeId: 'member-owner', ownerId: 'member-owner', status: 'todo', startDate: '2026-11-18', dueDate: '2026-11-21', effortHours: 3, deliverable: 'Hồ sơ năng lực bản mới' },
      // CAMP 01: 115 task seed nguyên văn từ 2 tab Action Plan (LP + Job Fair: 66; HNĐT: 49) —
      // title = cột Công Việc, assignee = cột Phụ trách, ngày năm 2026, trạng thái map:
      // Hoàn thành->completed, Đang thực hiện->in_progress, Chưa bắt đầu/Chờ xác nhận/Chờ phê duyệt->todo.
      {"id": "task-camp01-lp-a01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận Speaker và chủ đề HNĐT #02", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-19", "dueDate": "2026-10-20", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A01 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế hoàn chỉnh, duyệt và bàn giao Technical", "assigneeId": "member-design", "ownerId": "member-design", "status": "completed", "startDate": "2026-10-19", "dueDate": "2026-10-21", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A02 (Phụ trách gốc: Triều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chốt nội Dzung khảo sát BD và Customer Journey", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-19", "dueDate": "2026-10-21", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A03 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Hoàn thiện Copywriting hai Landing Page", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-20", "dueDate": "2026-10-20", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A04 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Điều chỉnh layout Landing Page, Thank You Page và Lucky Wheel", "assigneeId": "member-design", "ownerId": "member-design", "status": "completed", "startDate": "2026-10-20", "dueDate": "2026-10-20", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A05 (Phụ trách gốc: Triều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a06", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Phiên bản landing page mobile, tablet", "assigneeId": "member-design", "ownerId": "member-design", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A06 (Phụ trách gốc: Triều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a07", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Rà soát và phân bổ lại ngân sách theo từng hạng mục Paid Media", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-20", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A07 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a08", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Liên hệ GameK, xác nhận báo giá, quyền lợi, lịch đăng và booking PR", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "in_progress", "startDate": "2026-10-20", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A08 (Phụ trách gốc: Hiếu; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-lp-a09", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận thể lệ, KPI và yêu cầu triển khai", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "in_progress", "startDate": "2026-10-20", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A09 (Phụ trách gốc: Hiếu; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-lp-a10", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chốt danh sách, số lượng và cơ cấu quà", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "in_progress", "startDate": "2026-10-20", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A10 (Phụ trách gốc: Hiếu; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-lp-a11", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Điều chỉnh timeline CAMP 01, điểm rơi Media và phân bổ nguồn lực", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-20", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A11 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-a12", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Quy trình thanh toán với kế toán: /  - Quỹ 5M quà tặng với Nhân Sự /  - Hợp đồng chi phí, cách thức thanh toán", "assigneeId": "member-content", "ownerId": "member-content", "status": "completed", "startDate": "2026-10-26", "dueDate": "2026-10-28", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #A12 (Phụ trách gốc: Kiều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Code Landing Page và Form thu thông tin, câu hỏi", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B01 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Hoàn thiện toàn bộ chức năng hai Landing Page", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B02 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết lập cấu trúc dữ liệu khảo sát và câu hỏi", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B03 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng Dashboard và chức năng xuất dữ liệu", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B04 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tích hợp Lucky Wheel và cấu hình xác suất", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B05 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b06", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Code Thank You Page, xác nhận nhận quà và quản lý tồn kho", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B06 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b07", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tracking lượt quay, kết quả và quà đã nhận", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B07 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b08", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Hoàn thiện nội Dzung Backdrop, Standee, Flyer và Brochure", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B08 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b09", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Kiểm thử toàn bộ hành trình hai LP và dữ liệu", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-22", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B09 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b10", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sửa lỗi, kiểm thử lại và nghiệm thu", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-22", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B10 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b11", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chốt quy tắc ghi nhận 300 câu hỏi, tiêu chí hợp lệ và thể lệ thưởng", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-22", "dueDate": "2026-10-26", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B11 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b12", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng Master Social Content Plan HNĐT #02", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "in_progress", "startDate": "2026-10-22", "dueDate": "2026-10-22", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B12 (Phụ trách gốc: Hiếu; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-lp-b13", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Triển khai nội Dzung chi tiết", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-22", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B13 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b14", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế Backdrop, Standee", "assigneeId": "member-design", "ownerId": "member-design", "status": "completed", "startDate": "2026-10-22", "dueDate": "2026-10-26", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B14 (Phụ trách gốc: Triều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b15", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế Flyer và Brochure", "assigneeId": "member-ds-hn", "ownerId": "member-ds-hn", "status": "completed", "startDate": "2026-10-23", "dueDate": "2026-10-26", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B15 (Phụ trách gốc: DS Hà Nội; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b16", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng Social Content Plan PTIT", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-22", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B16 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b17", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sản xuất nội Dzung Social Teasing và gợi mở chủ đề HNĐT", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-22", "dueDate": "2026-10-25", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B17 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b18", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đăng bài, tạo điểm chạm Facebook Event và theo dõi phản hồi", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-10-22", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B18 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b19", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận ngân sách, phối hợp NS mua và chuẩn bị quà", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-23", "dueDate": "2026-11-03", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B19 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b20", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Viết nội Dzung chi tiết và bài ghim", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-28", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B20 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b21", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sản xuất nội Dzung và Creative công bố HNĐT #02", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B21 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b22", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chốt ngân sách Meta Ads, Audience, Creative và Tracking", "assigneeId": "member-content", "ownerId": "member-content", "status": "completed", "startDate": "2026-10-23", "dueDate": "2026-10-26", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B22 (Phụ trách gốc: Kiều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-b23", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Brief, viết, duyệt và phối hợp đăng bài PR HNĐT #02", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-31", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B23 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-b24", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Hướng dẫn/giới thiệu landing page, cách điều chỉnh tỉ lệ vòng quay, thống nhất nội Dzung social, phân công côn", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-26", "dueDate": "2026-10-26", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #B24 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-c01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-brand", "title": "Đồng bộ lịch Brand/Game Content với HNĐT và PTIT", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-26", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C01 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-c02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Bàn giao DevOps và đưa hai Landing Page hoạt động", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-26", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C02 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-c03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Duyệt và bàn giao file in cho NS", "assigneeId": "member-design", "ownerId": "member-design", "status": "completed", "startDate": "2026-10-26", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C03 (Phụ trách gốc: Triều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-c04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế và duyệt Visual HNĐT theo lịch đăng", "assigneeId": "member-design", "ownerId": "member-design", "status": "completed", "startDate": "2026-10-26", "dueDate": "2026-10-28", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C04 (Phụ trách gốc: Triều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-c05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Làm việc với Speaker về phạm vi nội Dzung và định hướng chương trình", "assigneeId": "member-content", "ownerId": "member-content", "status": "completed", "startDate": "2026-10-26", "dueDate": "2026-10-29", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C05 (Phụ trách gốc: Kiều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-c07", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Theo dõi tiến độ thu thập 300 câu hỏi HNĐT từ các nguồn", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "completed", "startDate": "2026-10-27", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C07 (Phụ trách gốc: Hiển; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-c08", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Khởi chạy, theo dõi và tối ưu Paid Ads HNĐT #02", "assigneeId": "member-content", "ownerId": "member-content", "status": "in_progress", "startDate": "2026-10-27", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C08 (Phụ trách gốc: Kiều; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-lp-c09", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế và duyệt Visual Social PTIT", "assigneeId": "member-design", "ownerId": "member-design", "status": "completed", "startDate": "2026-10-27", "dueDate": "2026-10-30", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C09 (Phụ trách gốc: Triều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-lp-c10", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sản xuất nội Dzung Speaker, Winning Idea, câu hỏi và giải thưởng", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-28", "dueDate": "2026-11-09", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C10 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-c11", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Soạn và gửi Email thông báo, nhắc lịch HNĐT #02", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-28", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C11 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-c12", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng SOP hướng dẫn tham gia và nhận quà PTIT", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-29", "dueDate": "2026-11-02", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C12 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-c13", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng kịch bản MC–Speaker, Q&A và trao thưởng", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-26", "dueDate": "2026-10-28", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #C13 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-d01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết lập bài ghim, đăng bài và theo dõi phản hồi", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-11-02", "dueDate": "2026-11-06", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #D01 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-d02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận quy trình và phân công với NS, BD", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-02", "dueDate": "2026-11-04", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #D02 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-d03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chuẩn bị Visual Live, thiết bị, setup và phương án dự phòng", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-04", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #D03 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-d04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đối chiếu tồn kho thực tế với Lucky Wheel", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-04", "dueDate": "2026-11-05", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #D04 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-d05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Kiểm tra toàn bộ hạng mục trước Job Fair", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-05", "dueDate": "2026-11-05", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #D05 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-e01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thu hút và hướng dẫn sinh viên tương tác Fanpage", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-06", "dueDate": "2026-11-06", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #E01 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-e02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Hỗ trợ khảo sát BD và Lucky Wheel", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-06", "dueDate": "2026-11-06", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #E02 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-e03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận, phát quà và xử lý sự cố", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-06", "dueDate": "2026-11-06", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #E03 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-e04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Ghi nhận hình ảnh và video tại booth", "assigneeId": "member-long", "ownerId": "member-long", "status": "todo", "startDate": "2026-11-06", "dueDate": "2026-11-06", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #E04 (Phụ trách gốc: Long; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Phân loại và bàn giao câu hỏi PTIT cho HNĐT #02", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-09", "dueDate": "2026-11-09", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F01 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tổng hợp và làm sạch dữ liệu khảo sát, câu hỏi PTIT", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-11-09", "dueDate": "2026-11-09", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F02 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đối soát lượt quay, quà tặng và Follower", "assigneeId": "member-ns", "ownerId": "member-ns", "status": "todo", "startDate": "2026-11-09", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F03 (Phụ trách gốc: NS; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sản xuất và đăng Recap Job Fair", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-09", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F04 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Triển khai nội Dzung nhắc lịch Livestream", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-09", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F05 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f06", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chọn bộ câu hỏi cuối và bàn giao MC/Speaker", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-10", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F06 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f07", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tổng duyệt MC, Speaker và hệ thống Livestream", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-11", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F07 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f08", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tổng hợp KPI, chi phí và báo cáo Job Fair", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-11", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F08 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-lp-f09", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Vận hành Livestream, quản lý tương tác và ghi nhận KPI", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-11-12", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan LP + Job Fair #F09 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-a01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận Speaker, chủ đề và ngân sách HNĐT #02.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-19", "dueDate": "2026-10-21", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #A01 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-hndt-a02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng bộ đề xuất: định hướng nội Dzung, 6–7 câu phỏng vấn kèm gợi ý trả lời, nhóm Q&A và danh sách thông ti", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-21", "dueDate": "2026-10-21", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #A02 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-hndt-a03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Gửi đề xuất cho chị Dzung, thu thập phản hồi và xác nhận nội Dzung, ảnh chính thức, bio, chức danh, lịch tham", "assigneeId": "member-content", "ownerId": "member-content", "status": "completed", "startDate": "2026-10-22", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #A03 (Phụ trách gốc: Kiều; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-hndt-a04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận Long làm MC xuyên suốt; thống nhất cách phối hợp, lịch rehearsal và trách nhiệm chụp ảnh/quay video t", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-26", "dueDate": "2026-10-28", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #A04 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-hndt-a05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Từ nội Dzung Speaker xác nhận, phát triển MC Script, timeline theo phút, phần giao lưu, chuyển đoạn, Q&A, trao", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-28", "dueDate": "2026-11-06", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #A05 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng Content Calendar HNĐT #02: tuyến nội Dzung, số bài, định dạng, kênh cascade và lịch đăng.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-22", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B01 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-hndt-b02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sản xuất Copy các bài Teasing, Announcement, Speaker, Topic, Q&A, Rewards và Reminder theo Calendar.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "in_progress", "startDate": "2026-10-23", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B02 (Phụ trách gốc: Hiếu; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-hndt-b03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế Visual cho từng bài Social theo nội Dzung và lịch ưu tiên đã duyệt.", "assigneeId": "member-design", "ownerId": "member-design", "status": "in_progress", "startDate": "2026-10-24", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B03 (Phụ trách gốc: Triều; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-hndt-b04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đăng bài theo Calendar, kiểm tra CTA/đường dẫn và quản lý phản hồi.", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-10-26", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B04 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chốt TA, Objective, thông điệp, KPI và phương án phân phối cho HNĐT #02.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-24", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B05 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b06", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sản xuất các phiên bản Ad Copy/Hook/CTA chuyên biệt theo TA và mục tiêu quảng cáo.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-26", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B06 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b07", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế và bàn giao các phiên bản hình ảnh quảng cáo để test/tối ưu.", "assigneeId": "member-design", "ownerId": "member-design", "status": "todo", "startDate": "2026-10-24", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B07 (Phụ trách gốc: Triều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b08", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết lập Campaign/Ad Set, cấu hình quảng cáo, UTM và kiểm tra tracking.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-10-26", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B08 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b09", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Triển khai quảng cáo, đánh giá Creative và tối ưu phân phối/ngân sách trong thời gian chạy.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-10-28", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B09 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b10", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Liên hệ GameK, xác nhận báo giá, quyền lợi, điều khoản thanh toán và lịch booking.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "in_progress", "startDate": "2026-10-20", "dueDate": "2026-10-23", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B10 (Phụ trách gốc: Hiếu; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-hndt-b11", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đề xuất và thực hiện thanh toán đợt 1 theo điều khoản booking.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-26", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B11 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b12", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Sản xuất PR Brief, phối hợp viết bản thảo, lấy phản hồi và duyệt bài cuối.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-24", "dueDate": "2026-10-30", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B12 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b13", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận thời gian đăng, phối hợp phát hành và lưu bài đã đăng để nghiệm thu.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-30", "dueDate": "2026-10-31", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B13 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b14", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đối soát quyền lợi đã thực hiện và đề xuất thanh toán phần còn lại.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-02", "dueDate": "2026-11-04", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B14 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b15", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Quy trình thanh toán với kế toán: /  - 8 voucher 200l", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-10-26", "dueDate": "2026-10-28", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B15 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b16", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Soạn, duyệt và gửi email giới thiệu HNĐT #02.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-28", "dueDate": "2026-10-31", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B16 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b17", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Soạn và gửi email nhắc lịch Livestream.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-09", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B17 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b18", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Rà soát câu hỏi từ Public/PTIT theo tiêu chí hợp lệ; loại câu hỏi spam, trùng lặp, sai chủ đề; phân nhóm nội D", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-06", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B18 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b19", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Liên hệ các CLB IT/Game Development phù hợp, giới thiệu chương trình, xác nhận khả năng hợp tác, quyền lợi và", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B19 (Phụ trách gốc: Hiển; trạng thái gốc: Chờ xác nhận)"},
      {"id": "task-camp01-hndt-b20", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Soạn nội Dzung giới thiệu HNĐT #02, điều chỉnh thông điệp phù hợp sinh viên và từng CLB; gửi duyệt trước khi đ", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-27", "dueDate": "2026-10-29", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B20 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b21", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Phối hợp đăng theo lịch, kiểm tra nội Dzung, CTA, link Landing Page và lưu bằng chứng đăng bài.", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-10-29", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B21 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b22", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tổng hợp link, số bài thực hiện và kết quả tương tác để nghiệm thu quyền lợi hợp tác.", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-11-10", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B22 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b24", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Liên hệ đơn vị cung cấp dịch vụ, xác nhận phạm vi, số lượng output, chi phí, lịch triển khai và điều khoản tha", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B24 (Phụ trách gốc: Hiếu; trạng thái gốc: Chờ phê duyệt)"},
      {"id": "task-camp01-hndt-b25", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng Brief, thông điệp và bộ nội Dzung phân phối; thống nhất nội Dzung với đơn vị thực hiện.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-27", "dueDate": "2026-10-29", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B25 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b26", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Theo dõi các đợt phân phối, kiểm tra nội Dzung và số lượng output, lưu link/bằng chứng thực hiện.", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-10-29", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B26 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b27", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đối soát số lượng, chất lượng và kết quả phân phối với cam kết dịch vụ; xác nhận nghiệm thu.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-10", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B27 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-b28", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Kiểm tra chứng từ, xác nhận nghiệm thu và phối hợp thanh toán theo điều khoản hợp đồng.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-11", "dueDate": "2026-11-13", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #B28 (Phụ trách gốc: Kiều; trạng thái gốc: Chờ phê duyệt)"},
      {"id": "task-camp01-hndt-c01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xác nhận cơ cấu 10 giải thưởng HNĐT, điều kiện hợp lệ và quy trình xác minh/trao quà.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "completed", "startDate": "2026-10-23", "dueDate": "2026-10-27", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C01 (Phụ trách gốc: Hiếu; trạng thái gốc: Hoàn thành)"},
      {"id": "task-camp01-hndt-c02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chuẩn bị quà/voucher, xác nhận số lượng, mã quà và phương án cấp phát sau Livestream.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-10-28", "dueDate": "2026-11-04", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C02 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-c03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đề xuất, xin duyệt và chuẩn bị thiệp mời, quà cảm ơn Speaker/MC; xác nhận thời điểm trao tặng.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-10-23", "dueDate": "2026-11-04", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C03 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-c04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chốt địa điểm, lịch trình, di chuyển, đón tiếp, hậu cần, phân vai ekip và trách nhiệm ghi hình/chụp ảnh.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-02", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C04 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-c05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Thiết kế, duyệt và bàn giao Opening, khung câu hỏi, viền livestream, bảng trao giải hiển thị trên live", "assigneeId": "member-design", "ownerId": "member-design", "status": "in_progress", "startDate": "2026-10-30", "dueDate": "2026-11-06", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C05 (Phụ trách gốc: Triều; trạng thái gốc: Đang thực hiện)"},
      {"id": "task-camp01-hndt-c06", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Kiểm kê camera, mic, ánh sáng, capture, recording, internet; xác định thiết bị thiếu và đề xuất mượn/thuê/mua", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-10-26", "dueDate": "2026-11-04", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C06 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-c07", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Lắp đặt, kiểm thử hình ảnh, âm thanh, Visual Live, recording và đường truyền chính/dự phòng.", "assigneeId": "member-thanh", "ownerId": "member-thanh", "status": "todo", "startDate": "2026-11-04", "dueDate": "2026-11-10", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C07 (Phụ trách gốc: Thành; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-c08", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Xây dựng quy trình chọn câu hỏi trực tiếp từ bình luận Livestream: MC Long và chị Dzung lựa chọn câu hỏi trong", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-04", "dueDate": "2026-11-09", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #C08 (Phụ trách gốc: Kiều, Long; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-d01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Chọn lọc các câu hỏi hợp lệ. Chia ra thành các nhóm câu hỏi. Gửi cho chị Dzung để chọn 5 câu hỏi trúng quà", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-11", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #D01 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-d02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đưa câu hỏi thực tế vào MC Script/Rundown, xác nhận bản cuối với Speaker/MC và bàn giao cho kỹ thuật.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-10", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #D02 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-d03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tổng duyệt chương trình, lời dẫn MC, Speaker, kỹ thuật, hiển thị Q&A, âm thanh và phương án dự phòng.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-11", "dueDate": "2026-11-11", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #D03 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-d04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Vận hành phát sóng, điều phối chương trình, chăm sóc Speaker", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-12", "dueDate": "2026-11-12", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #D04 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-e01", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Đối soát người trúng giải, xác minh thông tin, trao quà và lưu minh chứng hoàn tất.", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-11-13", "dueDate": "2026-11-16", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #E01 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-e02", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Gửi lời cảm ơn, chăm sóc sau chương trình và hoàn tất các đầu việc liên quan Speaker/MC.", "assigneeId": "member-content", "ownerId": "member-content", "status": "todo", "startDate": "2026-11-13", "dueDate": "2026-11-14", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #E02 (Phụ trách gốc: Kiều; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-e03", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Bàn giao Recording, chọn các đoạn chuyên môn nổi bật và dựng asset Recap/Short-form.", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-11-13", "dueDate": "2026-11-16", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #E03 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-e04", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Hoàn thiện nội Dzung, duyệt và đăng Social Recap; cascade sang những kênh phù hợp.", "assigneeId": "member-lead", "ownerId": "member-lead", "status": "todo", "startDate": "2026-11-16", "dueDate": "2026-11-17", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #E04 (Phụ trách gốc: Hiếu; trạng thái gốc: Chưa bắt đầu)"},
      {"id": "task-camp01-hndt-e05", "campaignId": "camp-play-unknown", "phaseId": "phase-sava-play", "activityId": "act-camp01-hndt", "title": "Tổng hợp KPI Livestream, kết quả Organic/Paid/PR/Email, chi phí thực tế và đánh giá hiệu quả so với mục tiêu.", "assigneeId": "member-hien", "ownerId": "member-hien", "status": "todo", "startDate": "2026-11-13", "dueDate": "2026-11-17", "deliverable": "", "sourceRef": "Action Plan Action Plan HNĐT #E05 (Phụ trách gốc: Hiển; trạng thái gốc: Chưa bắt đầu)"}
    ],
    dependencies: [],
    blockers: [],
    contentPillars: [
      { id: 'pillar-knowledge', buProductId: 'bu-ai', name: 'Kiến thức ngành', description: 'Giải thích khái niệm, xu hướng và kiến thức nền của ngành.', classificationGuide: 'Phân loại khi bài chủ yếu giúp người đọc hiểu một chủ đề. Ví dụ: giải thích ứng dụng VR trong đào tạo.', status: 'active' },
      { id: 'pillar-solution', buProductId: 'bu-ai', name: 'Giải pháp & sản phẩm', description: 'Giới thiệu giải pháp, tính năng và cách sản phẩm giải quyết vấn đề.', classificationGuide: 'Phân loại khi bài tập trung vào giải pháp/sản phẩm cụ thể. Ví dụ: bài mời tham gia livestream giới thiệu giải pháp.', status: 'active' },
      { id: 'pillar-case', buProductId: 'bu-metaverse', name: 'Dự án & ứng dụng thực tế', description: 'Case study và dự án đã triển khai được phép công bố.', classificationGuide: 'Phân loại khi bài kể một dự án/ứng dụng có thật kèm kết quả.', status: 'active' },
      { id: 'pillar-people', buProductId: 'bu-metaverse', name: 'Con người & thương hiệu', description: 'Con người, văn hóa đội ngũ và câu chuyện thương hiệu.', classificationGuide: 'Phân loại khi bài tập trung vào con người/thương hiệu thay vì sản phẩm.', status: 'active' }
    ],
    contentItems: [
      // Fixture R3.1 Content (a) AC24: nội dung THƯỜNG XUYÊN — có pillar +
      // lịch đăng nhưng campaign/activity TRỐNG (campaignChoice='none'
      // tường minh, khác "chưa chọn").
      { id: 'content-always-1', campaignId: null, campaignChoice: 'none', activityId: null, pillarId: 'pillar-knowledge', buProductId: 'bu-metaverse', product: 'Trải nghiệm VR mẫu', title: 'Giải thích ứng dụng VR trong đào tạo an toàn', type: 'article', editorialStatus: 'approved', ownerId: 'member-content', scheduledDate: null, alwaysOn: true, evergreen: true, tags: ['VR', 'Đào tạo'], goal: 'Xây nhu cầu tương lai: giúp quản lý đào tạo hiểu ứng dụng VR.' },
      // Fixture R3.1 Content (c) AC28: 2 tags phụ + ĐÚNG 1 pillar chính —
      // content mix tính 1 lần ở pillar-people, tags không làm tăng tổng.
      { id: 'content-tags-1', campaignId: null, campaignChoice: 'none', pillarId: 'pillar-people', buProductId: 'bu-metaverse', product: 'Trải nghiệm VR mẫu', title: 'Hậu trường đội ngũ xây dựng trải nghiệm VR', type: 'video', editorialStatus: 'draft', ownerId: 'member-content', scheduledDate: null, alwaysOn: true, evergreen: false, tags: ['Hậu trường', 'Đội ngũ'] },
      // Fixture R3.1 Content: bài import/sync THIẾU pillar -> Chờ phân loại;
      // campaign trống KHÔNG bị biến thành campaign giả.
      { id: 'content-queue-1', campaignId: null, campaignChoice: 'unset', pillarId: null, title: 'Bài đồng bộ chưa phân loại (minh họa)', type: 'post', editorialStatus: 'draft', ownerId: 'member-content', scheduledDate: null },
      // CAMP 01: 24 content từ tab Social Plan (file Action Plan) — title = Chủ đề/Content Direction,
      // phase = cột Phase (field contentPhase), ngày = Timeline, channels = các cột kênh có nội dung.
      {"id": "content-camp01-01", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Comic Wave 01: 2–3 tình huống hài về góp ý, bất đồng và lựa chọn Game Idea; chưa tiết lộ HNĐT.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-10-31", "contentPhase": "Attention", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #1 (Timeline: 31/10)"},
      {"id": "content-camp01-02", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "HNĐT #02: Giới thiệu chủ đề, chị Dzung, lịch Live, cách tham gia và 10 giải thưởng.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-10-31", "contentPhase": "Announcement", "channels": ["Facebook", "LinkedIn", "Website", "Email CRM"], "sourceRef": "Social Plan CAMP 01 #2 (Timeline: 31/10)"},
      {"id": "content-camp01-03", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Comic Wave 02: 2–3 tình huống người nghĩ Idea, người đánh giá và người triển khai có góc nhìn khác nhau.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-10-29", "contentPhase": "Engagement", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #3 (Timeline: 29/10–03/11)"},
      {"id": "content-camp01-04", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Giới thiệu riêng chị Thuỳ Dzung và SkyBull: hành trình nghề nghiệp, sản phẩm, thành tích và kinh nghiệm được x", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-10-30", "contentPhase": "Consideration", "channels": ["Facebook", "LinkedIn", "Website"], "sourceRef": "Social Plan CAMP 01 #4 (Timeline: 30/10–02/11)"},
      {"id": "content-camp01-05", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Chuyên đề 4 vấn đề: tìm Idea, chọn Idea, kiểm chứng và quyết định tiếp tục hay dừng.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-10-31", "contentPhase": "Education", "channels": ["Facebook", "LinkedIn", "Website", "Email CRM"], "sourceRef": "Social Plan CAMP 01 #5 (Timeline: 31/10–02/11)"},
      {"id": "content-camp01-06", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Thông báo SAVA META tham gia PTIT Job Fair: booth, trải nghiệm và hoạt động dành cho sinh viên.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-02", "contentPhase": "PTIT", "channels": ["Facebook", "Website"], "sourceRef": "Social Plan CAMP 01 #6 (Timeline: 02/11)"},
      {"id": "content-camp01-07", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Định hướng nghề nghiệp trong lĩnh vực game. SAVA xuất hiện Job Fair. Ảnh hưởng, hưởg ứng từ các bạn trẻ + giới", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-10", "contentPhase": "PR Cascade", "channels": ["Facebook", "LinkedIn", "Website", "GameK PR"], "sourceRef": "Social Plan CAMP 01 #7 (Timeline: 08–10/11)"},
      {"id": "content-camp01-08", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "HNĐT phiên bản PTIT: đồ án, Game Jam, dự án Game đầu tiên và cách tham gia chương trình.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-04", "contentPhase": "PTIT", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #8 (Timeline: 04/11)"},
      {"id": "content-camp01-09", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Minigame PTIT: thể lệ, nhiệm vụ, thời hạn và giải thưởng theo Flyer cùng xác nhận HR.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-05", "contentPhase": "PTIT", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #9 (Timeline: 05/11)"},
      {"id": "content-camp01-10", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "PTIT Event Day: hình ảnh booth, hoạt động và trải nghiệm thực tế cùng sinh viên.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-06", "contentPhase": "PTIT", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #10 (Timeline: 06/11)"},
      {"id": "content-camp01-11", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Comic Wave 03: 2 tình huống về Playtest, Feedback hoặc quyết định khó khi phát triển Game.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-10", "contentPhase": "Engagement / Bridge", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #11 (Timeline: 07–10/11)"},
      {"id": "content-camp01-12", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Question Guide: gợi ý câu hỏi có chiều sâu dựa trên 4 nhóm chủ đề của HNĐT.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-09", "contentPhase": "Participation", "channels": ["Facebook", "Email CRM"], "sourceRef": "Social Plan CAMP 01 #12 (Timeline: 07–09/11)"},
      {"id": "content-camp01-13", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Thể lệ HNĐT: 5 câu trước Live, 5 câu trong Live, 10 phần thưởng và cách nhận giải.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-10", "contentPhase": "Participation", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #13 (Timeline: 08–10/11)"},
      {"id": "content-camp01-14", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Từ Game Idea đến Prototype: nên kiểm chứng điều gì trước khi tiếp tục đầu tư nguồn lực?", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-09", "contentPhase": "Education", "channels": ["Facebook", "LinkedIn", "Website"], "sourceRef": "Social Plan CAMP 01 #14 (Timeline: 08–09/11)"},
      {"id": "content-camp01-15", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Recap SAVA META tại PTIT Job Fair 2026: hoạt động, hình ảnh, kết quả thực tế; không ép về Game.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-07", "contentPhase": "PTIT Recap", "channels": ["Facebook", "LinkedIn", "Website"], "sourceRef": "Social Plan CAMP 01 #15 (Timeline: 07/11)"},
      {"id": "content-camp01-16", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Công bố kết quả Minigame PTIT và hướng dẫn nhận thưởng.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-11", "contentPhase": "PTIT Results", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #16 (Timeline: 10–11/11)"},
      {"id": "content-camp01-17", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Livestream Reminder: lịch Live, khách mời và cách gửi câu hỏi trước hoặc trong Live.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-11", "contentPhase": "Participation", "channels": ["Facebook", "Email CRM"], "sourceRef": "Social Plan CAMP 01 #17 (Timeline: 11/11)"},
      {"id": "content-camp01-18", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Livestream Reminder: lịch Live, khách mời và cách gửi câu hỏi trước hoặc trong Live.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-12", "contentPhase": "Reminder", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #18 (Timeline: 12/11)"},
      {"id": "content-camp01-19", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "HNĐT #02 Livestream cùng chị Dzung, Q&A và công bố kết quả lựa chọn câu hỏi.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-12", "contentPhase": "Live", "channels": ["Facebook", "Email CRM"], "sourceRef": "Social Plan CAMP 01 #19 (Timeline: 12/11)"},
      {"id": "content-camp01-20", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Công bố lại danh sách câu hỏi nhận thưởng và hướng dẫn liên hệ Fanpage trong 5 ngày.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-14", "contentPhase": "Post-event", "channels": ["Facebook"], "sourceRef": "Social Plan CAMP 01 #20 (Timeline: 13–14/11)"},
      {"id": "content-camp01-21", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Livestream Highlights: chọn câu trả lời đáng chú ý, adapt video theo từng nền tảng.", "type": "video", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-16", "contentPhase": "Content Value", "channels": ["Facebook", "Email CRM", "TikTok", "YouTube"], "sourceRef": "Social Plan CAMP 01 #21 (Timeline: 14–16/11)"},
      {"id": "content-camp01-22", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Editorial Recap: tổng hợp những góc nhìn chuyên môn và bài học từ Live.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-18", "contentPhase": "Content Value", "channels": ["Facebook", "LinkedIn", "Website"], "sourceRef": "Social Plan CAMP 01 #22 (Timeline: 16–18/11)"},
      {"id": "content-camp01-23", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "10 câu hỏi đáng chú ý: trích 2–3 Q&A làm Social Editorial, dẫn đến bộ Q&A đầy đủ.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-11-21", "contentPhase": "Content Value", "channels": ["Facebook", "Website"], "sourceRef": "Social Plan CAMP 01 #23 (Timeline: 19–21/11)"},
      {"id": "content-camp01-24", "campaignId": "camp-play-unknown", "activityId": "act-camp01-hndt", "title": "Email xác nhận đã nhận câu hỏi và nhắc lịch Live, không cam kết trúng thưởng.", "type": "post", "editorialStatus": "draft", "ownerId": "member-lead", "scheduledDate": "2026-10-26", "contentPhase": "System", "channels": ["Email CRM"], "sourceRef": "Social Plan CAMP 01 #24 (Timeline: Từ khi Form hoạt động)"}
    ],
    variants: [
      { id: 'variant-always-fb', contentItemId: 'content-always-1', platform: 'facebook', channelLabel: 'Facebook', channelAccountId: 'chan-fb', caption: 'VR trong đào tạo an toàn: thử một buổi học trong không gian ảo trước khi quyết định.', scheduledAt: '2026-11-18T09:00:00+07:00', editorialStatus: 'approved', approvalStatus: 'approved', revision: 1, publishMode: 'app' },
      
      // CAMP 01: variant theo từng kênh Social (Facebook/LinkedIn/TikTok/YouTube) của 24 content Social Plan.
      {"id": "variant-camp01-01-facebook", "contentItemId": "content-camp01-01", "platform": "facebook", "channelLabel": "Facebook", "caption": "Dự kiến 3 bài", "scheduledAt": "2026-10-31T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-02-facebook", "contentItemId": "content-camp01-02", "platform": "facebook", "channelLabel": "Facebook", "caption": "Thông báo chính thức của chương trình / (bài viết ghim số 1)", "scheduledAt": "2026-10-31T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-02-linkedin", "contentItemId": "content-camp01-02", "platform": "linkedin", "channelLabel": "LinkedIn", "caption": "Thông báo chính thức của chương trình /", "scheduledAt": "2026-10-31T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-03-facebook", "contentItemId": "content-camp01-03", "platform": "facebook", "channelLabel": "Facebook", "caption": "Dự kiến 3 bài", "scheduledAt": "2026-10-29T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-04-facebook", "contentItemId": "content-camp01-04", "platform": "facebook", "channelLabel": "Facebook", "caption": "Câu chuyện của c. Dzung", "scheduledAt": "2026-10-30T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-04-linkedin", "contentItemId": "content-camp01-04", "platform": "linkedin", "channelLabel": "LinkedIn", "caption": "Câu chuyện của c. Dzung", "scheduledAt": "2026-10-30T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-05-facebook", "contentItemId": "content-camp01-05", "platform": "facebook", "channelLabel": "Facebook", "caption": "Triển khai ngắn gọn có hook từ các chủ đề", "scheduledAt": "2026-10-31T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-05-linkedin", "contentItemId": "content-camp01-05", "platform": "linkedin", "channelLabel": "LinkedIn", "caption": "Triển khai ngắn gọn có hook từ các chủ đề", "scheduledAt": "2026-10-31T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-06-facebook", "contentItemId": "content-camp01-06", "platform": "facebook", "channelLabel": "Facebook", "caption": "Thông báo event: / - Ngắn gọn các sự kiện / - Chi tiết các phần quà", "scheduledAt": "2026-11-02T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-07-facebook", "contentItemId": "content-camp01-07", "platform": "facebook", "channelLabel": "Facebook", "caption": "Đưa link bài viết gốc + luận điểm ngắn gọn + giới thiệu HNĐT #02", "scheduledAt": "2026-11-10T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-07-linkedin", "contentItemId": "content-camp01-07", "platform": "linkedin", "channelLabel": "LinkedIn", "caption": "Đưa link bài viết gốc + luận điểm ngắn gọn + giới thiệu HNĐT #02", "scheduledAt": "2026-11-10T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-08-facebook", "contentItemId": "content-camp01-08", "platform": "facebook", "channelLabel": "Facebook", "caption": "Giới thiệu HNĐT phiên bản PTIT: / - Quà riêng cho các bạn sinh viên / (bài viết ghim số 2)", "scheduledAt": "2026-11-04T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-09-facebook", "contentItemId": "content-camp01-09", "platform": "facebook", "channelLabel": "Facebook", "caption": "Thể lệ MiniGame của Job Fair / ((bài viết ghim số 3)", "scheduledAt": "2026-11-05T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-10-facebook", "contentItemId": "content-camp01-10", "platform": "facebook", "channelLabel": "Facebook", "caption": "Bài viết: SAVA đã sẵn sàng", "scheduledAt": "2026-11-06T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-11-facebook", "contentItemId": "content-camp01-11", "platform": "facebook", "channelLabel": "Facebook", "caption": "Dự kiến 2 bài", "scheduledAt": "2026-11-10T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-12-facebook", "contentItemId": "content-camp01-12", "platform": "facebook", "channelLabel": "Facebook", "caption": "Đi sâu vào 4 vấn đề. Mỗi vấn đề ví dụ 3 câu hỏi. Gợi ý, bạn hoàn toàn có thể sử dụng câu hỏi gợi ý của SAVA", "scheduledAt": "2026-11-09T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-13-facebook", "contentItemId": "content-camp01-13", "platform": "facebook", "channelLabel": "Facebook", "caption": "Chi tiết giải thưởng, cách thức chọn câu hỏi", "scheduledAt": "2026-11-10T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-14-facebook", "contentItemId": "content-camp01-14", "platform": "facebook", "channelLabel": "Facebook", "caption": "Hook & Painpoint --> các tiêu chí đánh giá ngắn gọn nhưng phải có ít từ góc nhìn SAVA", "scheduledAt": "2026-11-09T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-14-linkedin", "contentItemId": "content-camp01-14", "platform": "linkedin", "channelLabel": "LinkedIn", "caption": "Hook & Painpoint --> các tiêu chí đánh giá ngắn gọn nhưng phải có ít từ góc nhìn SAVA", "scheduledAt": "2026-11-09T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-15-facebook", "contentItemId": "content-camp01-15", "platform": "facebook", "channelLabel": "Facebook", "caption": "SAVA cảm ơn các bạn đã ghé và chơi cùng SAVA", "scheduledAt": "2026-11-07T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-15-linkedin", "contentItemId": "content-camp01-15", "platform": "linkedin", "channelLabel": "LinkedIn", "caption": "Góc nhìn SAVA về thế hệ trẻ thông qua sự kiện", "scheduledAt": "2026-11-07T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-16-facebook", "contentItemId": "content-camp01-16", "platform": "facebook", "channelLabel": "Facebook", "caption": "Công bế kết quả cuộc thi Minigame", "scheduledAt": "2026-11-11T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-17-facebook", "contentItemId": "content-camp01-17", "platform": "facebook", "channelLabel": "Facebook", "caption": "Chỉ còn 1 ngày tới sự kiện. Câu hỏi bạn gửi chưa, nếu chưa thì xem thêm bài viết gợi ý câu hỏi của SAVA nhé!", "scheduledAt": "2026-11-11T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-18-facebook", "contentItemId": "content-camp01-18", "platform": "facebook", "channelLabel": "Facebook", "caption": "Bắt đầu đếm ngược tới giờ Live. SAVA đã nhận được xx câu hỏi", "scheduledAt": "2026-11-12T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-19-facebook", "contentItemId": "content-camp01-19", "platform": "facebook", "channelLabel": "Facebook", "caption": "Giờ G đã điểm! Chị Dzung và SAVA đã sẵn sàng. Chiến thôi!", "scheduledAt": "2026-11-12T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-20-facebook", "contentItemId": "content-camp01-20", "platform": "facebook", "channelLabel": "Facebook", "caption": "Chúc mừng các bạn trúng thưởng", "scheduledAt": "2026-11-14T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-21-facebook", "contentItemId": "content-camp01-21", "platform": "facebook", "channelLabel": "Facebook", "caption": "3-4 Reel các câu hỏi quan trọng", "scheduledAt": "2026-11-16T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-21-tiktok", "contentItemId": "content-camp01-21", "platform": "tiktok", "channelLabel": "TikTok", "caption": "1 TikTok Video", "scheduledAt": "2026-11-16T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "external"},
      {"id": "variant-camp01-21-youtube", "contentItemId": "content-camp01-21", "platform": "youtube", "channelLabel": "YouTube", "caption": "1 YouTube Short", "scheduledAt": "2026-11-16T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-22-facebook", "contentItemId": "content-camp01-22", "platform": "facebook", "channelLabel": "Facebook", "caption": "Bài viết đúc kết giải pháp/góc nhìn chung từ chủ đề đưa ra", "scheduledAt": "2026-11-18T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-22-linkedin", "contentItemId": "content-camp01-22", "platform": "linkedin", "channelLabel": "LinkedIn", "caption": "1 Editorial POV", "scheduledAt": "2026-11-18T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"},
      {"id": "variant-camp01-23-facebook", "contentItemId": "content-camp01-23", "platform": "facebook", "channelLabel": "Facebook", "caption": "Carousel tối ưu các câu trả lời của chị Dzung", "scheduledAt": "2026-11-21T09:00:00+07:00", "editorialStatus": "draft", "approvalStatus": "draft", "revision": 1, "publishMode": "app"}
    ],
    publishJobs: [],
    brandPages: [
      { id: 'brand-page-1', title: 'Giới thiệu thương hiệu SAVA', status: 'Approved', version: 3, updatedAt: '2026-11-01T09:00:00+07:00', summary: 'Câu chuyện, giá trị cốt lõi và cách xưng hô của thương hiệu.' },
      { id: 'brand-page-2', title: 'Giọng điệu trên mạng xã hội', status: 'Draft', version: 1, updatedAt: '2026-11-08T14:00:00+07:00', summary: 'Cách viết caption, cách trả lời bình luận, từ nên dùng và nên tránh.' },
      { id: 'brand-page-3', title: 'Trang mẫu cũ năm 2025', status: 'Archived', version: 5, updatedAt: '2025-12-20T09:00:00+07:00', summary: 'Bản đã lưu trữ, chỉ để tham khảo lịch sử.' }
    ],
    brandAssets: [
      { id: 'asset-1', name: 'Bộ logo chính (file mẫu)', type: 'Logo', status: 'Approved', version: 4, updatedAt: '2026-10-28T09:00:00+07:00' },
      { id: 'asset-2', name: 'Bảng màu và font chữ', type: 'Hướng dẫn', status: 'Approved', version: 2, updatedAt: '2026-10-28T09:00:00+07:00' },
      { id: 'asset-3', name: 'KV mùa lễ — bản đang sửa', type: 'Hình ảnh', status: 'Draft', version: 1, updatedAt: '2026-11-10T16:00:00+07:00' }
    ],
    approvals: [],
    channelAccounts: [
      { id: 'chan-fb', platform: 'facebook', name: 'Fanpage mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chưa có quyền đọc số liệu', publish: 'Chờ kết nối', ads: 'Chờ kết nối' } },
      { id: 'chan-ig', platform: 'instagram', name: 'Instagram mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chưa có quyền đọc số liệu', publish: 'Chờ kết nối', ads: 'Chờ kết nối' } },
      { id: 'chan-tiktok', platform: 'tiktok', name: 'TikTok mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chưa có quyền đọc số liệu', publish: 'Đăng ngoài app', ads: 'Chờ kết nối' } },
      { id: 'chan-yt', platform: 'youtube', name: 'YouTube mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chờ kết nối', publish: 'Chờ kết nối', ads: 'Chờ kết nối' } }
    ],
    externalPosts: [
      
      { id: 'post-3', platform: 'instagram', channelAccountId: 'chan-ig', externalPostId: 'ig-demo-3001', title: 'Ảnh teaser KV', url: 'https://example.com/demo-post-3', publishedAt: '2026-11-04T18:00:00+07:00', campaignId: null },
    ],
    metricObservations: [
      { id: 'obs-6', externalPostId: 'post-3', metric: 'reach', value: 800, observedAt: '2026-11-09T09:00:00+07:00', source: 'Nhập tay (minh họa)', enteredBy: 'member-content' }
    ],
    budgetLines: [
      // CAMP 01: 9 dòng ngân sách đúng tab KPI & Budget (file Action Plan) — tổng 51.539.000đ.
      { id: 'bl-camp01-brand-meta', campaignId: 'camp-play-unknown', activityId: 'act-camp01-brand', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'Meta Ads — Brand Content/Game Culture', currency: 'VND', planned: 8792000, approved: 8792000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-hndt-meta', campaignId: 'camp-play-unknown', activityId: 'act-camp01-hndt', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'HNĐT — Meta Ads', currency: 'VND', planned: 2000000, approved: 2000000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-hndt-pr', campaignId: 'camp-play-unknown', activityId: 'act-camp01-hndt', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'HNĐT — PR GameK', currency: 'VND', planned: 6600000, approved: 6600000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-hndt-rewards', campaignId: 'camp-play-unknown', activityId: 'act-camp01-hndt', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'HNĐT — Rewards', currency: 'VND', planned: 2884000, approved: 2884000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-ptit-mkt', campaignId: 'camp-play-unknown', activityId: 'act-camp01-hndt', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'PTIT — MKT', currency: 'VND', planned: 5000000, approved: 5000000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-gamecu-meta', campaignId: 'camp-play-unknown', activityId: 'act-camp01-gamecu', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'Game Cũ — Meta Ads', currency: 'VND', planned: 9438000, approved: 9438000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-gamecu-pr', campaignId: 'camp-play-unknown', activityId: 'act-camp01-gamecu', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'Game Cũ — PR GameK', currency: 'VND', planned: 6600000, approved: 6600000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-gamecu-seeding', campaignId: 'camp-play-unknown', activityId: 'act-camp01-gamecu', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'Game Cũ — Community Seeding', currency: 'VND', planned: 2500000, approved: 2500000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'bl-camp01-gamecu-rewards', campaignId: 'camp-play-unknown', activityId: 'act-camp01-gamecu', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'Game Cũ — Rewards', currency: 'VND', planned: 7725000, approved: 7725000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'budget-build-unknown', campaignId: 'camp-build-unknown', brand_id: 'brand-sava-meta', segment: 'b2b', name: 'Ngân sách Camp 2 — BUILD THE UNKNOWN (tổng theo file IMC, chưa gồm Market Test Fund)', currency: 'VND', planned: 154200000, approved: 154200000, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null},
      { id: 'budget-create-unknown', campaignId: 'camp-create-unknown', brand_id: 'brand-sava-meta', segment: 'b2c', name: 'Ngân sách Camp 3 — CREATE THE UNKNOWN (tổng theo file IMC)', currency: 'VND', planned: 49349500, approved: 49349500, approvedBy: 'member-owner', approvedAt: '2026-11-15T09:00:00+07:00', approvedViaProposalId: null}
    ],
    commitments: [],
    actuals: [],
    kpis: [
      // SAVA META: KPI CAMP 01 (tab KPI & Budget — Action Plan) + CAMP 02/03 (sheet KPI & Budget — IMC).
      {"id": "kpi-camp01-brand-follows", "campaignId": "camp-play-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-play", "scopeType": "activity", "name": "New Follows — Brand Content/Game Culture", "target": 2000, "actual": null, "unit": "follows", "periodKey": "2026-11", "source": "Tab KPI & Budget — Action Plan CAMP 01", "updatedAt": null, "activityId": "act-camp01-brand"},
      {"id": "kpi-camp01-hndt-questions", "campaignId": "camp-play-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-play", "scopeType": "activity", "name": "Câu hỏi hợp lệ — HNĐT #02", "target": 300, "actual": null, "unit": "câu hỏi", "periodKey": "2026-11", "source": "Tab KPI & Budget — Action Plan CAMP 01", "updatedAt": null, "activityId": "act-camp01-hndt"},
      {"id": "kpi-camp01-hndt-follows", "campaignId": "camp-play-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-play", "scopeType": "activity", "name": "New Follows — HNĐT #02 × PTIT Job Fair", "target": 1000, "actual": null, "unit": "follows", "periodKey": "2026-11", "source": "Tab KPI & Budget — Action Plan CAMP 01", "updatedAt": null, "activityId": "act-camp01-hndt"},
      {"id": "kpi-camp01-gamecu-entries", "campaignId": "camp-play-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-play", "scopeType": "activity", "name": "Bài dự thi — Game Cũ – Chuyện Cũ – Người Cũ", "target": 100, "actual": null, "unit": "bài dự thi", "periodKey": "2026-11", "source": "Tab KPI & Budget — Action Plan CAMP 01 (bản chi tiết IMC ghi 150 bài hợp lệ — lấy theo Action Plan)", "updatedAt": null, "activityId": "act-camp01-gamecu"},
      {"id": "kpi-camp01-gamecu-follows", "campaignId": "camp-play-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-play", "scopeType": "activity", "name": "New Follows — Game Cũ – Chuyện Cũ – Người Cũ", "target": 4000, "actual": null, "unit": "follows", "periodKey": "2026-11", "source": "Tab KPI & Budget — Action Plan CAMP 01 (bản chi tiết IMC ghi >=3.600 — lấy theo Action Plan)", "updatedAt": null, "activityId": "act-camp01-gamecu"},
      {"id": "kpi-camp02-contact-leads", "campaignId": "camp-build-unknown", "brand_id": "brand-sava-meta", "segment": "b2b", "phase_id": "phase-sava-build", "scopeType": "campaign", "name": "Contact Leads mới — Studio Outreach × Gameforum", "target": 200, "actual": null, "unit": "leads", "periodKey": "2026-12", "source": "Sheet KPI & Budget — IMC Game Chapter Camp 2", "updatedAt": null},
      {"id": "kpi-camp02-rtg-applications", "campaignId": "camp-build-unknown", "brand_id": "brand-sava-meta", "segment": "b2b", "phase_id": "phase-sava-build", "scopeType": "campaign", "name": "RTG Applications — Road to Global", "target": 40, "actual": null, "unit": "hồ sơ", "periodKey": "2026-12", "source": "Sheet KPI & Budget — IMC Game Chapter Camp 2", "updatedAt": null},
      {"id": "kpi-camp02-market-tests", "campaignId": "camp-build-unknown", "brand_id": "brand-sava-meta", "segment": "b2b", "phase_id": "phase-sava-build", "scopeType": "campaign", "name": "Market Tests hoàn thành", "target": 3, "actual": null, "unit": "market test", "periodKey": "2027-01", "source": "Sheet KPI & Budget — IMC Game Chapter Camp 2", "updatedAt": null},
      {"id": "kpi-camp02-winner", "campaignId": "camp-build-unknown", "brand_id": "brand-sava-meta", "segment": "b2b", "phase_id": "phase-sava-build", "scopeType": "campaign", "name": "Winner — Road to Global", "target": 1, "actual": null, "unit": "winner", "periodKey": "2027-01", "source": "Sheet KPI & Budget — IMC Game Chapter Camp 2", "updatedAt": null},
      {"id": "kpi-camp03-follows", "campaignId": "camp-create-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-create", "scopeType": "campaign", "name": "New Follows — CREATE THE UNKNOWN", "target": 1500, "actual": null, "unit": "follows", "periodKey": "2027-02", "source": "Sheet KPI & Budget — IMC Game Chapter Camp 3 (khoảng 1.500–1.700, lấy cận dưới)", "updatedAt": null},
      {"id": "kpi-camp03-questions", "campaignId": "camp-create-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-create", "scopeType": "campaign", "name": "Câu hỏi hợp lệ — HNĐT #03", "target": 140, "actual": null, "unit": "câu hỏi", "periodKey": "2027-02", "source": "Sheet KPI & Budget — IMC Game Chapter Camp 3 (khoảng 140–160, lấy cận dưới)", "updatedAt": null},
      {"id": "kpi-camp03-game-ideas", "campaignId": "camp-create-unknown", "brand_id": "brand-sava-meta", "segment": "b2c", "phase_id": "phase-sava-create", "scopeType": "campaign", "name": "Game Idea hợp lệ — SAVA Game Idea Challenge", "target": 120, "actual": null, "unit": "game idea", "periodKey": "2027-03", "source": "Sheet KPI & Budget — IMC Game Chapter Camp 3 (>=120)", "updatedAt": null}
    ],
    kpiContributions: [],
    budgetAllocations: [],
    adAccounts: [
      { id: 'adacc-1', name: 'Tài khoản quảng cáo mẫu 01', platform: 'Meta Ads', status: 'Chỉ đọc — chờ kết nối' }
    ],
    adCampaigns: [],
    adSets: [],
    ads: [],
    adInsights: [],
    adChangeRequests: [
      { id: 'adcr-1', title: 'Tăng ngân sách nhóm quảng cáo người chơi 18–34 thêm 10%', target: 'Nhóm quảng cáo — Người chơi 18–34', status: 'draft', statusLabel: 'Nháp', requestedBy: 'member-lead', defaultState: 'Tạm dừng (paused)', createdAt: '2026-11-10T11:00:00+07:00' }
    ],
    marketingRequests: [
      { id: 'req-2', title: 'Xin bộ ảnh sản phẩm cho trang bán hàng', requester: 'Đội Kinh doanh (minh họa)', campaignId: null, status: 'accepted', statusLabel: 'Đã tiếp nhận', priority: 'Trung bình', dueDate: '2026-11-21', note: '' }
    ],
    // Fixture WAVE-B3 (demo): sổ quỹ Thu–Chi TỐI THIỂU để biểu đồ cột tháng +
    // đường số dư lũy kế hiện trong chế độ demo/screenshot. Đây CHỈ là dữ
    // liệu minh họa trong demo-data, không phải thay đổi mô hình dữ liệu.
    // Đối chiếu tay (VND): T9 Thu 20tr / Chi 4tr / Ròng +16tr; T10 Thu 30tr /
    // Chi 8,5tr / Ròng +21,5tr; T11 Thu 5tr / Chi 0 / Ròng +5tr.
    // Số dư lũy kế (từ 0): T9 16tr -> T10 37,5tr -> T11 42,5tr.
    // Số dư tài khoản: Quỹ vận hành 50tr mở đầu + Thu 50tr - Chi 10,5tr =
    // 89,5tr; Quỹ sự kiện 10tr mở đầu + Thu 5tr - Chi 2tr = 13tr.
    cashAccounts: [
      { id: 'cash-acc-1', name: 'Quỹ vận hành Marketing (minh họa)', currency: 'VND', openingBalance: 50000000 },
      { id: 'cash-acc-2', name: 'Quỹ sự kiện & sản xuất (minh họa)', currency: 'VND', openingBalance: 10000000 }
    ],
    cashTransactions: [
      { id: 'cash-tx-01', accountId: 'cash-acc-1', direction: 'in', amount: 20000000, occurredOn: '2026-09-05', title: 'Nạp quỹ đầu tháng 9 (minh họa)' },
      { id: 'cash-tx-02', accountId: 'cash-acc-1', direction: 'out', amount: 4000000, occurredOn: '2026-09-12', title: 'Chi sản xuất nội dung tháng 9 (minh họa)' },
      { id: 'cash-tx-03', accountId: 'cash-acc-1', direction: 'in', amount: 30000000, occurredOn: '2026-10-03', title: 'Nạp quỹ tháng 10 (minh họa)' },
      { id: 'cash-tx-04', accountId: 'cash-acc-1', direction: 'out', amount: 6500000, occurredOn: '2026-10-15', title: 'Chi quảng cáo tháng 10 (minh họa)' },
      { id: 'cash-tx-05', accountId: 'cash-acc-2', direction: 'out', amount: 2000000, occurredOn: '2026-10-20', title: 'Đặt cọc địa điểm sự kiện (minh họa)' },
      { id: 'cash-tx-10', accountId: 'cash-acc-2', direction: 'in', amount: 5000000, occurredOn: '2026-11-28', title: 'Thu hồi một phần tiền cọc sự kiện (minh họa)' }
    ],
    reportSnapshots: [
      { id: 'report-1', title: 'Báo cáo tuần 02/11/2026 — 08/11/2026 (minh họa)', frozenAt: '2026-11-09T08:00:00+07:00', status: 'Đã chốt', summary: 'Snapshot đã chốt: nội dung hiển thị đóng băng tại thời điểm chốt, không sửa được trong app.', metrics: { spend: 18000000, impressions: 240000, clicks: 7200 } }
    ],
    manualMetricEntries: []
  };

  global.SAVA_DEMO_DATA = data;
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
