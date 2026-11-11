/*
 * js/demo-data.js — Dữ liệu minh họa của SAVA Marketing Workspace.
 * TOÀN BỘ dữ liệu trong file này là dữ liệu minh họa (demo), không phải dữ liệu thật.
 * Chỉ được nạp khi người dùng chủ động bật chế độ demo ở Thiết lập hoặc mở ?demo=1.
 */
(function (global) {
  'use strict';

  var data = {
    demoLabel: 'Dữ liệu minh họa — không phải dữ liệu thật',
    holidays: ['2026-11-19'],
    members: [
      { id: 'member-owner', name: 'Minh Anh (Owner demo)', email: 'owner.demo@sava.example', role: 'owner', roleLabel: 'Owner', capacityHoursPerWeek: 40, daysOff: ['2026-11-20'] },
      { id: 'member-lead', name: 'Hoàng Nam (Lead demo)', email: 'lead.demo@sava.example', role: 'lead', roleLabel: 'Lead', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-content', name: 'Thu Hà (Member demo)', email: 'content.demo@sava.example', role: 'member', roleLabel: 'Member', capacityHoursPerWeek: 32, daysOff: ['2026-11-13'] },
      { id: 'member-design', name: 'Đức Long (Member demo)', email: 'design.demo@sava.example', role: 'member', roleLabel: 'Member', capacityHoursPerWeek: 40, daysOff: [] },
      { id: 'member-ceo', name: 'Giám đốc điều hành (CEO demo)', email: 'ceo.demo@sava.example', role: 'ceo', roleLabel: 'CEO', capacityHoursPerWeek: 0, daysOff: [] }
    ],
    businessUnits: [
      { id: 'bu-game', name: 'Game Studio', products: ['Game di động mẫu A', 'Game di động mẫu B'] },
      { id: 'bu-ai', name: 'AI', products: ['Nền tảng AI mẫu'] },
      { id: 'bu-metaverse', name: 'Metaverse', products: ['Trải nghiệm VR mẫu'] },
      { id: 'bu-publishing', name: 'Publishing', products: ['Dịch vụ phát hành mẫu'] }
    ],
    campaigns: [
      {
        id: 'camp-1', name: 'Ra mắt tính năng mới — Mùa lễ hội', businessUnitId: 'bu-game', product: 'Game di động mẫu A',
        status: 'active', statusLabel: 'Đang chạy', startDate: '2026-11-02', endDate: '2026-11-30',
        ownerId: 'member-lead', baselineStartDate: '2026-11-02', baselineEndDate: '2026-11-27',
        why: 'Tận dụng mùa lễ hội để tăng người chơi mới và giữ chân người chơi hiện tại.',
        businessGoal: 'Tăng doanh thu trong ứng dụng tháng 11 thêm 15% so với tháng 10 (số minh họa).',
        marketingGoal: 'Tăng lượt cài đặt và lượt quay lại phiên chơi trong nhóm người chơi mục tiêu.',
        desiredOutcome: 'Đạt mốc KPI đã đặt ở mục KPI và có bài học cho đợt ra mắt tiếp theo.',
        audiences: [
          { name: 'Người chơi hiện tại 18–34', description: 'Đã chơi trong 30 ngày gần đây, quan tâm sự kiện trong game.' },
          { name: 'Người chơi từng rời đi', description: 'Từng cài đặt, không hoạt động 60 ngày, cần lý do quay lại.' }
        ],
        audienceInsights: 'Người chơi phản hồi tốt với nội dung hậu trường ngắn và phần thưởng có mốc thời gian rõ ràng (insight minh họa).',
        bigIdea: 'Mở hội mùa lễ — mỗi ngày một thử thách, một câu chuyện.',
        keyMessage: 'Vào game mỗi ngày, hoàn thành thử thách, nhận quà mùa lễ.',
        creativeDirection: 'KV tông ấm, nhân vật chính cầm đèn lồng; video ngắn mở đầu bằng thử thách trong 3 giây đầu.',
        risks: 'Video chính phụ thuộc vào việc quay dựng (task quay dựng đang chờ duyệt kịch bản); nguy cơ trễ 2 ngày nếu duyệt chậm.',
        lessons: ''
      },
      {
        id: 'camp-2', name: 'Giới thiệu trải nghiệm VR cho đối tác', businessUnitId: 'bu-metaverse', product: 'Trải nghiệm VR mẫu',
        status: 'planning', statusLabel: 'Đang chuẩn bị', startDate: '2026-11-16', endDate: '2026-12-11',
        ownerId: 'member-owner', baselineStartDate: '2026-11-16', baselineEndDate: '2026-12-11',
        why: 'Tạo nhu cầu trải nghiệm thử ở nhóm đối tác giáo dục và sản xuất.',
        businessGoal: 'Tạo danh sách đối tác quan tâm để đội kinh doanh chăm sóc tiếp.',
        marketingGoal: 'Đặt lịch trải nghiệm thử qua trang giới thiệu.',
        desiredOutcome: 'Có đủ lịch hẹn trải nghiệm trong 4 tuần triển khai.',
        audiences: [{ name: 'Quản lý đào tạo ở doanh nghiệp', description: 'Quan tâm mô phỏng an toàn và đào tạo thực hành.' }],
        audienceInsights: 'Nhóm này cần bằng chứng thực tế và số liệu triển khai rõ ràng hơn là thông điệp cảm xúc.',
        bigIdea: 'Thử một buổi học trong không gian ảo trước khi quyết định.',
        keyMessage: 'Trải nghiệm thử 15 phút, thấy ngay cách vận hành.',
        creativeDirection: 'Ảnh chụp trải nghiệm thật, bố cục sạch, ưu tiên chữ lớn dễ đọc.',
        risks: 'Chưa chốt địa điểm trải nghiệm thử.',
        lessons: ''
      }
    ],
    phases: [
      { id: 'phase-1', campaignId: 'camp-1', name: 'Giai đoạn 1 — Khởi động', startDate: '2026-11-02', endDate: '2026-11-13' },
      { id: 'phase-2', campaignId: 'camp-1', name: 'Giai đoạn 2 — Cao điểm', startDate: '2026-11-14', endDate: '2026-11-27' },
      { id: 'phase-3', campaignId: 'camp-2', name: 'Giai đoạn 1 — Chuẩn bị', startDate: '2026-11-16', endDate: '2026-11-27' }
    ],
    activities: [
      { id: 'act-1', campaignId: 'camp-1', phaseId: 'phase-1', name: 'Teaser trên mạng xã hội', channel: 'Facebook, Instagram', ownerId: 'member-content' },
      { id: 'act-2', campaignId: 'camp-1', phaseId: 'phase-2', name: 'Video thử thách trên TikTok', channel: 'TikTok (đăng ngoài app)', ownerId: 'member-content' },
      { id: 'act-3', campaignId: 'camp-1', phaseId: 'phase-2', name: 'Quảng cáo chuyển đổi', channel: 'Meta Ads', ownerId: 'member-lead' },
      { id: 'act-4', campaignId: 'camp-2', phaseId: 'phase-3', name: 'Trang giới thiệu trải nghiệm thử', channel: 'Website', ownerId: 'member-design' }
    ],
    tasks: [
      { id: 'task-a', campaignId: 'camp-1', phaseId: 'phase-1', activityId: 'act-1', title: 'Chốt kịch bản video thử thách', assigneeId: 'member-content', ownerId: 'member-content', status: 'completed', startDate: '2026-11-02', dueDate: '2026-11-04', baselineStartDate: '2026-11-02', baselineDueDate: '2026-11-04', effortHours: 8, deliverable: 'Kịch bản theo cảnh đã duyệt', availabilityNote: 'Có thể nhận việc từ 02/11' },
      { id: 'task-c', campaignId: 'camp-1', phaseId: 'phase-1', activityId: 'act-1', title: 'Duyệt KV và hướng sáng tạo', assigneeId: 'member-lead', ownerId: 'member-lead', status: 'in_progress', startDate: '2026-11-03', dueDate: '2026-11-10', baselineStartDate: '2026-11-03', baselineDueDate: '2026-11-09', effortHours: 6, deliverable: 'KV chính thức dạng file nguồn + bản xem trước', availabilityNote: 'Bận họp đối tác sáng 10/11' },
      { id: 'task-b', campaignId: 'camp-1', phaseId: 'phase-2', activityId: 'act-2', title: 'Quay dựng video thử thách', assigneeId: 'member-design', ownerId: 'member-design', status: 'todo', startDate: '2026-11-11', dueDate: '2026-11-16', baselineStartDate: '2026-11-10', baselineDueDate: '2026-11-14', effortHours: 20, deliverable: 'Video dọc 30 giây + bản phụ đề', availabilityNote: '' },
      { id: 'task-b1', campaignId: 'camp-1', phaseId: 'phase-2', activityId: 'act-2', parentId: 'task-b', title: 'Dựng bản nháp 15 giây', assigneeId: 'member-design', ownerId: 'member-design', status: 'todo', startDate: '2026-11-11', dueDate: '2026-11-13', effortHours: 8, deliverable: 'Bản nháp để duyệt nội bộ' },
      { id: 'task-b2', campaignId: 'camp-1', phaseId: 'phase-2', activityId: 'act-2', parentId: 'task-b', title: 'Hoàn thiện phụ đề và bản xuất', assigneeId: 'member-design', ownerId: 'member-design', status: 'todo', startDate: '2026-11-14', dueDate: '2026-11-16', effortHours: null, deliverable: 'File xuất cuối cùng kèm phụ đề' },
      { id: 'task-d', campaignId: 'camp-1', phaseId: 'phase-2', activityId: 'act-2', title: 'Lên lịch đăng và theo dõi bình luận', assigneeId: 'member-content', ownerId: 'member-content', status: 'todo', startDate: '2026-11-17', dueDate: '2026-11-20', effortHours: 10, deliverable: 'Bài đã đăng + nhật ký bình luận cần xử lý' },
      { id: 'task-e', campaignId: 'camp-1', phaseId: 'phase-1', activityId: 'act-1', title: 'Viết caption các kênh', assigneeId: 'member-content', ownerId: 'member-content', status: 'in_progress', startDate: '2026-11-09', dueDate: '2026-11-11', effortHours: 6, deliverable: 'Caption riêng cho từng kênh' },
      { id: 'task-f', campaignId: 'camp-2', phaseId: 'phase-3', activityId: 'act-4', title: 'Chuẩn bị trang giới thiệu trải nghiệm thử', assigneeId: 'member-design', ownerId: 'member-design', status: 'todo', startDate: null, dueDate: null, effortHours: 12, deliverable: 'Trang giới thiệu bản xem trước' },
      { id: 'task-g', campaignId: 'camp-1', title: 'Tổng hợp số liệu tuần 1', assigneeId: 'member-lead', ownerId: 'member-lead', status: 'todo', startDate: '2026-11-05', dueDate: '2026-11-07', effortHours: 4, deliverable: 'Bảng số liệu tuần kèm nhận xét' },
      // Fixture cây 4 cấp cho Gantt đệ quy (R2-27): task → sub → sub-sub.
      { id: 'task-tree-1', campaignId: 'camp-1', phaseId: 'phase-2', activityId: 'act-3', title: 'Thiết lập chiến dịch quảng cáo chuyển đổi', assigneeId: 'member-lead', ownerId: 'member-lead', status: 'in_progress', startDate: '2026-11-14', dueDate: '2026-11-25', effortHours: 12, deliverable: 'Cây quảng cáo đã thiết lập' },
      { id: 'task-tree-2', campaignId: 'camp-1', phaseId: 'phase-2', activityId: 'act-3', parentId: 'task-tree-1', title: 'Dựng nhóm quảng cáo theo tệp người chơi', assigneeId: 'member-lead', ownerId: 'member-lead', status: 'todo', startDate: '2026-11-15', dueDate: '2026-11-20', effortHours: 6, deliverable: 'Các nhóm quảng cáo' },
      { id: 'task-tree-3', campaignId: 'camp-1', phaseId: 'phase-2', activityId: 'act-3', parentId: 'task-tree-2', title: 'Viết biến thể quảng cáo cho nhóm 18–34', assigneeId: 'member-content', ownerId: 'member-content', status: 'todo', startDate: '2026-11-16', dueDate: '2026-11-19', effortHours: 4, deliverable: '3 biến thể quảng cáo' },
      { id: 'task-mile-1', campaignId: 'camp-1', phaseId: 'phase-2', title: 'Mốc: mở sự kiện mùa lễ trong game', assigneeId: 'member-lead', ownerId: 'member-lead', status: 'todo', startDate: '2026-11-14', dueDate: '2026-11-14', isMilestone: true, effortHours: 1, deliverable: 'Sự kiện mở đúng giờ' },
      // Việc độc lập (không gắn campaign) — hiện ở nhóm "Việc độc lập" của Gantt tổng.
      { id: 'task-solo-1', campaignId: null, title: 'Cập nhật hồ sơ năng lực của đội Marketing', assigneeId: 'member-owner', ownerId: 'member-owner', status: 'todo', startDate: '2026-11-18', dueDate: '2026-11-21', effortHours: 3, deliverable: 'Hồ sơ năng lực bản mới' }
    ],
    dependencies: [
      { id: 'dep-1', predecessorId: 'task-a', successorId: 'task-b' },
      { id: 'dep-2', predecessorId: 'task-c', successorId: 'task-b' },
      { id: 'dep-3', predecessorId: 'task-b', successorId: 'task-d' },
      { id: 'dep-4', predecessorId: 'task-e', successorId: 'task-d' }
    ],
    blockers: [
      { id: 'blocker-1', taskId: 'task-b', title: 'Chưa có file nhạc có bản quyền rõ ràng', description: 'Cần xác nhận quyền dùng nhạc nền trước khi xuất bản cuối.', status: 'open', createdBy: 'member-design', createdAt: '2026-11-10T09:00:00+07:00' }
    ],
    contentItems: [
      { id: 'content-1', campaignId: 'camp-1', title: 'Video thử thách mùa lễ', type: 'video', editorialStatus: 'in_review', ownerId: 'member-content', scheduledDate: '2026-11-17' },
      { id: 'content-2', campaignId: 'camp-1', title: 'Bài giới thiệu sự kiện trong game', type: 'post', editorialStatus: 'approved', ownerId: 'member-content', scheduledDate: '2026-11-12' },
      { id: 'content-3', campaignId: 'camp-1', title: 'Ảnh KV teaser', type: 'image', editorialStatus: 'draft', ownerId: 'member-design', scheduledDate: '2026-11-11' },
      { id: 'content-4', campaignId: 'camp-2', title: 'Mời trải nghiệm thử VR', type: 'post', editorialStatus: 'scheduled', ownerId: 'member-design', scheduledDate: '2026-11-24' }
    ],
    variants: [
      { id: 'variant-fb-1', contentItemId: 'content-2', platform: 'facebook', channelLabel: 'Facebook', caption: 'Mùa lễ đã mở trong game! Hoàn thành thử thách mỗi ngày để nhận quà giới hạn. Bạn đã sẵn sàng chưa?', scheduledAt: '2026-11-12T09:00:00+07:00', editorialStatus: 'approved', approvalStatus: 'approved', revision: 2, publishMode: 'app' },
      { id: 'variant-ig-1', contentItemId: 'content-2', platform: 'instagram', channelLabel: 'Instagram', caption: '✨ Thử thách mùa lễ bắt đầu hôm nay ✨ Vào game, làm nhiệm vụ, khoe thành tích của bạn ở bình luận nhé!', scheduledAt: '2026-11-12T10:00:00+07:00', editorialStatus: 'approved', approvalStatus: 'approved', revision: 1, publishMode: 'app' },
      { id: 'variant-fb-2', contentItemId: 'content-1', platform: 'facebook', channelLabel: 'Facebook', caption: 'Xem thử thách 30 giây và thử làm nhanh hơn nhân vật chính!', scheduledAt: '2026-11-17T19:00:00+07:00', editorialStatus: 'in_review', approvalStatus: 'pending', revision: 1, publishMode: 'app' },
      {
        id: 'variant-tiktok-1', contentItemId: 'content-1', platform: 'tiktok', channelLabel: 'TikTok', caption: 'Thử thách mùa lễ trong 30 giây — bạn làm được nhanh hơn không?',
        scheduledAt: '2026-11-17T20:00:00+07:00', editorialStatus: 'in_review', approvalStatus: 'pending', revision: 1, publishMode: 'external',
        hook: 'Dừng lại! Đừng lướt nếu bạn chưa thử thử thách 30 giây này.',
        cta: 'Vào game hôm nay và quay lại kết quả của bạn.',
        externalStatus: 'Chờ đăng ngoài app', externalUrl: '',
        scriptScenes: [
          { shot: 1, visual: 'Cận cảnh nhân vật nhận thử thách, đồng hồ đếm ngược xuất hiện', dialogue: 'Chỉ 30 giây thôi — bắt đầu!', onScreenText: 'THỬ THÁCH 30 GIÂY', durationSec: 4 },
          { shot: 2, visual: 'Nhân vật vượt qua 3 chướng ngại, nhịp cắt nhanh', dialogue: 'Nhanh, gọn, đừng chạm vạch đỏ!', onScreenText: '3 chướng ngại', durationSec: 12 },
          { shot: 3, visual: 'Về đích, pháo giấy và hộp quà mùa lễ mở ra', dialogue: 'Xong! Tới lượt bạn thử.', onScreenText: 'Vào game hôm nay', durationSec: 9 },
          { shot: 4, visual: 'Màn hình kết quả và lời mời bình luận', dialogue: 'Bình luận thời gian của bạn nhé.', onScreenText: 'Bạn mất bao lâu?', durationSec: 5 }
        ]
      },
      { id: 'variant-ig-2', contentItemId: 'content-3', platform: 'instagram', channelLabel: 'Instagram', caption: 'KV mùa lễ sắp lộ diện…', scheduledAt: '2026-11-11T18:00:00+07:00', editorialStatus: 'draft', approvalStatus: 'draft', revision: 1, publishMode: 'app' }
    ],
    publishJobs: [
      { id: 'job-1', variantId: 'variant-fb-1', status: 'scheduled', note: 'Job mẫu ở chế độ minh họa — không đăng thật.' }
    ],
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
    approvals: [
      { id: 'approval-1', variantId: 'variant-fb-2', contentItemId: 'content-1', revision: 1, status: 'pending', statusLabel: 'Chờ duyệt', requestedBy: 'member-content', requestedAt: '2026-11-10T15:00:00+07:00', note: '' },
      { id: 'approval-2', variantId: 'variant-tiktok-1', contentItemId: 'content-1', revision: 1, status: 'pending', statusLabel: 'Chờ duyệt', requestedBy: 'member-content', requestedAt: '2026-11-10T15:05:00+07:00', note: '' },
      { id: 'approval-3', variantId: 'variant-fb-1', contentItemId: 'content-2', revision: 2, status: 'approved', statusLabel: 'Chấp thuận', requestedBy: 'member-content', requestedAt: '2026-11-09T10:00:00+07:00', decidedBy: 'member-lead', note: 'Caption rõ ràng, giữ nguyên bản này khi đăng.' }
    ],
    channelAccounts: [
      { id: 'chan-fb', platform: 'facebook', name: 'Fanpage mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chưa có quyền đọc số liệu', publish: 'Chờ kết nối', ads: 'Chờ kết nối' } },
      { id: 'chan-ig', platform: 'instagram', name: 'Instagram mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chưa có quyền đọc số liệu', publish: 'Chờ kết nối', ads: 'Chờ kết nối' } },
      { id: 'chan-tiktok', platform: 'tiktok', name: 'TikTok mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chưa có quyền đọc số liệu', publish: 'Đăng ngoài app', ads: 'Chờ kết nối' } },
      { id: 'chan-yt', platform: 'youtube', name: 'YouTube mẫu SAVA', status: 'Chờ kết nối', apiImplementation: { oauth: 'implemented_needs_credentials', publish: 'not_implemented', sync: 'not_implemented', ads: 'not_implemented' }, capabilities: { readPosts: 'Chờ kết nối', readMetrics: 'Chờ kết nối', publish: 'Chờ kết nối', ads: 'Chờ kết nối' } }
    ],
    externalPosts: [
      { id: 'post-1', platform: 'facebook', channelAccountId: 'chan-fb', externalPostId: 'fb-demo-1001', title: 'Bài giới thiệu sự kiện (bản đăng tay mẫu)', url: 'https://example.com/demo-post-1', publishedAt: '2026-11-05T09:00:00+07:00', campaignId: 'camp-1' },
      { id: 'post-2', platform: 'tiktok', channelAccountId: 'chan-tiktok', externalPostId: 'tt-demo-2001', title: 'Video hậu trường (đăng ngoài app)', url: 'https://example.com/demo-tiktok-1', publishedAt: '2026-11-06T20:00:00+07:00', campaignId: 'camp-1', variantId: 'variant-tiktok-1', contentItemId: 'content-1' },
      { id: 'post-3', platform: 'instagram', channelAccountId: 'chan-ig', externalPostId: 'ig-demo-3001', title: 'Ảnh teaser KV', url: 'https://example.com/demo-post-3', publishedAt: '2026-11-04T18:00:00+07:00', campaignId: null }
    ],
    metricObservations: [
      { id: 'obs-1', externalPostId: 'post-1', metric: 'lifetime_views', value: 100, observedAt: '2026-11-05T10:00:00+07:00', source: 'Nhập tay (minh họa)', enteredBy: 'member-content' },
      { id: 'obs-2', externalPostId: 'post-1', metric: 'lifetime_views', value: 150, observedAt: '2026-11-07T10:00:00+07:00', source: 'Nhập tay (minh họa)', enteredBy: 'member-content' },
      { id: 'obs-3', externalPostId: 'post-1', metric: 'lifetime_views', value: 200, observedAt: '2026-11-09T10:00:00+07:00', source: 'Nhập tay (minh họa)', enteredBy: 'member-lead' },
      { id: 'obs-4', externalPostId: 'post-1', metric: 'impressions', value: 1200, observedAt: '2026-11-09T10:00:00+07:00', source: 'Nhập tay (minh họa)', enteredBy: 'member-lead', spend: 200000, clicks: 60, results: 12, conversionValue: 900000 },
      { id: 'obs-5', externalPostId: 'post-2', metric: 'views', value: 3500, observedAt: '2026-11-09T11:00:00+07:00', source: 'Nhập tay từ link TikTok (minh họa)', enteredBy: 'member-content', spend: 0, clicks: 0, results: 0, conversionValue: 0 },
      { id: 'obs-6', externalPostId: 'post-3', metric: 'reach', value: 800, observedAt: '2026-11-09T09:00:00+07:00', source: 'Nhập tay (minh họa)', enteredBy: 'member-content' }
    ],
    budgetLines: [
      { id: 'budget-1', campaignId: 'camp-1', name: 'Sản xuất nội dung', currency: 'VND', planned: 60000000, approved: 50000000 },
      { id: 'budget-2', campaignId: 'camp-1', name: 'Quảng cáo Meta', currency: 'VND', planned: 90000000, approved: 80000000 },
      { id: 'budget-3', campaignId: 'camp-2', name: 'Trang giới thiệu và trải nghiệm', currency: 'VND', planned: 40000000, approved: 30000000 },
      { id: 'budget-4', campaignId: 'camp-2', name: 'Sự kiện trải nghiệm (USD mẫu)', currency: 'USD', planned: 2000, approved: 1500 }
    ],
    commitments: [
      { id: 'commit-1', budgetLineId: 'budget-1', title: 'Đặt cọc quay dựng video', amount: 20000000, currency: 'VND', status: 'open' },
      { id: 'commit-2', budgetLineId: 'budget-1', title: 'Thuê thiết bị quay', amount: 5000000, currency: 'VND', status: 'open' },
      { id: 'commit-3', budgetLineId: 'budget-2', title: 'Ngân sách quảng cáo đã cam kết tuần 1', amount: 30000000, currency: 'VND', status: 'open' }
    ],
    actuals: [
      { id: 'actual-1', budgetLineId: 'budget-1', commitmentId: 'commit-1', title: 'Thanh toán đợt 1 quay dựng', amount: 8000000, currency: 'VND', date: '2026-11-08' },
      { id: 'actual-2', budgetLineId: 'budget-2', commitmentId: null, title: 'Chi quảng cáo thực tế tuần 1', amount: 18000000, currency: 'VND', date: '2026-11-09' }
    ],
    kpis: [
      { id: 'kpi-1', campaignId: 'camp-1', name: 'Lượt cài đặt mới', target: 10000, actual: 6200, unit: 'lượt', source: 'Số liệu minh họa nhập tay', updatedAt: '2026-11-10T09:00:00+07:00' },
      { id: 'kpi-2', campaignId: 'camp-1', name: 'Lượt xem video thử thách', target: 100000, actual: null, unit: 'lượt xem', source: 'Chưa có nguồn số liệu', updatedAt: null },
      { id: 'kpi-3', campaignId: 'camp-2', name: 'Lịch hẹn trải nghiệm thử', target: 30, actual: 0, unit: 'lịch hẹn', source: 'Số liệu minh họa nhập tay', updatedAt: '2026-11-10T09:00:00+07:00' }
    ],
    adAccounts: [
      { id: 'adacc-1', name: 'Tài khoản quảng cáo mẫu 01', platform: 'Meta Ads', status: 'Chỉ đọc — chờ kết nối' }
    ],
    adCampaigns: [
      { id: 'adc-1', adAccountId: 'adacc-1', campaignId: 'camp-1', level: 'campaign', name: 'Chiến dịch quảng cáo — Cài đặt mùa lễ', status: 'paused', statusLabel: 'Tạm dừng (paused)', spend: 18000000, impressions: 240000, clicks: 7200, results: 950, conversionValue: 54000000 }
    ],
    adSets: [
      { id: 'adset-1', adCampaignId: 'adc-1', level: 'adset', name: 'Nhóm quảng cáo — Người chơi 18–34', status: 'paused', statusLabel: 'Tạm dừng (paused)', spend: 18000000, impressions: 240000, clicks: 7200, results: 950, conversionValue: 54000000 }
    ],
    ads: [
      { id: 'ad-1', adSetId: 'adset-1', level: 'ad', name: 'Quảng cáo — Video thử thách 30 giây', status: 'paused', statusLabel: 'Tạm dừng (paused)', spend: 11000000, impressions: 150000, clicks: 4800, results: 610, conversionValue: 33000000 },
      { id: 'ad-2', adSetId: 'adset-1', level: 'ad', name: 'Quảng cáo — Ảnh KV mùa lễ', status: 'paused', statusLabel: 'Tạm dừng (paused)', spend: 7000000, impressions: 90000, clicks: 2400, results: 340, conversionValue: 21000000 }
    ],
    adInsights: [
      { id: 'ins-1', objectType: 'campaign', objectId: 'adc-1', periodStart: '2026-11-03', periodEnd: '2026-11-09', observedAt: '2026-11-10T08:00:00+07:00', currency: 'VND', spend: 11000000, impressions: 150000, clicks: 4800, reach: 90000, results: 610, resultType: 'install', conversionValue: 33000000 },
      { id: 'ins-2', objectType: 'campaign', objectId: 'adc-1', periodStart: '2026-11-10', periodEnd: '2026-11-16', observedAt: '2026-11-11T08:00:00+07:00', currency: 'VND', spend: 7000000, impressions: 90000, clicks: 2400, reach: 55000, results: 340, resultType: 'install', conversionValue: 21000000 },
      { id: 'ins-3', objectType: 'adset', objectId: 'adset-1', periodStart: '2026-11-03', periodEnd: '2026-11-09', observedAt: '2026-11-10T08:00:00+07:00', currency: 'VND', spend: 11000000, impressions: 150000, clicks: 4800, reach: 90000, results: 610, resultType: 'install', conversionValue: 33000000 },
      { id: 'ins-4', objectType: 'ad', objectId: 'ad-1', periodStart: '2026-11-03', periodEnd: '2026-11-09', observedAt: '2026-11-10T08:00:00+07:00', currency: 'VND', spend: 6500000, impressions: 90000, clicks: 3000, reach: 52000, results: 380, resultType: 'install', conversionValue: 20000000 },
      { id: 'ins-5', objectType: 'ad', objectId: 'ad-2', periodStart: '2026-11-03', periodEnd: '2026-11-09', observedAt: '2026-11-10T08:00:00+07:00', currency: 'VND', spend: 4500000, impressions: 60000, clicks: 1800, reach: 38000, results: 230, resultType: 'install', conversionValue: 13000000 }
    ],
    adChangeRequests: [
      { id: 'adcr-1', title: 'Tăng ngân sách nhóm quảng cáo người chơi 18–34 thêm 10%', target: 'Nhóm quảng cáo — Người chơi 18–34', status: 'draft', statusLabel: 'Nháp', requestedBy: 'member-lead', defaultState: 'Tạm dừng (paused)', createdAt: '2026-11-10T11:00:00+07:00' }
    ],
    marketingRequests: [
      { id: 'req-1', title: 'Cần bài giới thiệu tính năng cho kênh đối tác', requester: 'Đội Sản phẩm (minh họa)', campaignId: 'camp-1', status: 'new', statusLabel: 'Mới ghi nhận', priority: 'Cao', dueDate: '2026-11-18', note: 'Ghi nhận để Lead sắp xếp vào Action Plan.' },
      { id: 'req-2', title: 'Xin bộ ảnh sản phẩm cho trang bán hàng', requester: 'Đội Kinh doanh (minh họa)', campaignId: null, status: 'accepted', statusLabel: 'Đã tiếp nhận', priority: 'Trung bình', dueDate: '2026-11-21', note: '' }
    ],
    reportSnapshots: [
      { id: 'report-1', title: 'Báo cáo tuần 02/11/2026 — 08/11/2026 (minh họa)', frozenAt: '2026-11-09T08:00:00+07:00', status: 'Đã chốt', summary: 'Snapshot đã chốt: nội dung hiển thị đóng băng tại thời điểm chốt, không sửa được trong app.', metrics: { spend: 18000000, impressions: 240000, clicks: 7200 } }
    ],
    manualMetricEntries: []
  };

  global.SAVA_DEMO_DATA = data;
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
