# Hướng dẫn theo vai trò — SAVA Marketing Workspace

Hướng dẫn ngắn cho từng vai trò. Thuật ngữ trên giao diện: **Mục tiêu**, **Target audiences**, **Hoạt động & Kênh triển khai**, **Người phụ trách**, **Đầu ra cần bàn giao**, **Mốc cần hoàn thành**.

## Owner — người quản trị workspace

Bạn là người thiết lập và giữ workspace chạy đúng:

- **Thiết lập ban đầu:** hoàn thành các bước trong `docs/SETUP.md` (Supabase project, migrations, Edge Functions, `config.js`, GitHub Pages) và tạo tài khoản Owner đầu tiên.
- **Kết nối kênh:** vào mục kết nối kênh, kết nối từng kênh chính thức của công ty (page/kênh social, tài khoản quảng cáo) bằng tài khoản được uỷ quyền; kiểm tra trạng thái kết nối sau khi nối. Token/khoá bí mật chỉ nằm phía server — không dán khoá bí mật vào ô ghi chú hay nơi công khai.
  - Lưu ý: TikTok **không** đăng qua app — không cần (và không thể) kết nối TikTok để đăng tự động; TikTok chỉ lưu link bài đã đăng ngoài app và theo dõi hiệu quả.
- **Phân quyền:** mời thành viên và gán đúng vai — Owner / Lead / Member / CEO. Người rời team thì thu hồi quyền ngay trong mục thành viên. Chỉ cấp Owner cho người thật sự quản trị hệ thống.
- **Khi có sự cố:** kiểm tra trạng thái kết nối kênh và lịch chạy worker trước (bài lên lịch chưa đăng thường do kênh hết hạn kết nối hoặc worker chưa được gọi).

## Lead — người phụ trách campaign

Chuỗi công việc chuẩn của bạn, theo đúng thứ tự:

1. **Tạo campaign** — đặt tên, **Mục tiêu**, **Target audiences**, giai đoạn và **Mốc cần hoàn thành** chính.
2. **Tách việc** — chia campaign thành các đầu việc trong **Hoạt động & Kênh triển khai**; việc lớn tách thành việc con, đặt quan hệ phụ thuộc (việc sau chờ việc trước) để hệ thống báo đúng việc nào đã sẵn sàng làm, việc nào đang bị chặn.
3. **Giao việc** — mỗi việc có một **Người phụ trách**, **Đầu ra cần bàn giao** rõ ràng, ngày bắt đầu và hạn hoàn thành. Dời ngày một việc thì xem trước danh sách việc phía sau bị ảnh hưởng trước khi chốt.
4. **Content** — lên nội dung cho từng kênh trong lịch nội dung: bản nháp, media đính kèm, caption và lịch dự kiến đăng.
5. **Duyệt** — kiểm tra nội dung Member gửi: duyệt để chuyển sang trạng thái sẵn sàng đăng, hoặc trả lại kèm lý do cụ thể cần sửa.
6. **Đăng / đăng ngoài app TikTok** — nội dung đã duyệt trên các kênh hỗ trợ sẽ đăng qua app theo lịch (từng đích đăng có trạng thái riêng: thành công / thất bại / thành công một phần — kiểm tra và xử lý riêng đích bị lỗi). Riêng **TikTok: đăng ngoài app** bằng ứng dụng TikTok, sau đó quay lại app đánh dấu đã đăng và **dán link bài** để hệ thống theo dõi tiếp.
7. **Theo dõi hiệu quả** — xem số liệu từng bài/kênh trên dashboard hiệu quả; chỉ số chưa có dữ liệu sẽ hiện "Chưa cập nhật" — đó là trạng thái thật, không phải lỗi.
8. **Ads** — quản lý quảng cáo gắn với campaign: xem chi tiêu và hiệu quả theo đúng một cấp (campaign / ad set / ad) mỗi lần tổng hợp, tránh đếm trùng.
9. **Báo cáo** — chốt kỳ, đối chiếu KPI và ngân sách (số đã duyệt − đã chi − cam kết đang mở), xuất báo cáo cho lãnh đạo.

## Member — người thực thi

- **Việc của tôi:** mở mục "Việc của tôi" để xem mọi việc được giao, xếp theo hạn hoàn thành; việc đang chờ việc khác xong sẽ được đánh dấu chưa sẵn sàng kèm việc đang chặn.
- **Cập nhật task:** làm tới đâu cập nhật tới đó — chuyển trạng thái (đang làm / chờ duyệt / hoàn thành), ghi tiến độ, đính kèm **Đầu ra cần bàn giao** (file, link, bản nháp) ngay trên việc.
- **Gửi duyệt:** khi nội dung/bàn giao đã sẵn sàng, bấm gửi duyệt để Lead xem. Bị trả lại thì đọc lý do, sửa và gửi lại trên cùng một việc — không tạo việc mới cho cùng một đầu ra.
- **Báo tắc sớm:** nếu thiếu tư liệu, thiếu quyền truy cập hoặc bị chặn bởi việc khác, ghi rõ ngay trên task để Lead xử lý — đừng để tới hạn mới báo.

## CEO — người xem báo cáo

- **Xem dashboard / báo cáo:** mở dashboard để xem bức tranh toàn cảnh — tiến độ campaign (chỉ tính việc lá, việc đã huỷ không tính), KPI đạt/chưa đạt, ngân sách đã chi và còn lại, hiệu quả kênh và quảng cáo theo kỳ.
- **Xuất CSV:** dùng nút xuất CSV trên các bảng/báo cáo để lấy số liệu ra ngoài khi cần làm việc trong spreadsheet hoặc gửi kèm tài liệu họp.
- **Không sửa:** vai CEO là vai chỉ xem — bạn không chỉnh sửa campaign, việc, nội dung hay số liệu trong app. Cần thay đổi gì thì trao đổi với Lead/Owner để họ cập nhật đúng nguồn dữ liệu.

## Chuỗi duyệt ngân sách (đề xuất → duyệt → cam kết/chi)

Ngân sách đi đúng một chuỗi — không ai sửa thẳng số đã duyệt trong form:

1. **Đề xuất:** Owner / Lead / Member (quyền `budget.propose`) tạo **đề xuất ngân sách** cho một hạn mức campaign hoặc một dòng ngân sách: mở form "Đề xuất ngân sách" ở màn **KPI & Ngân sách**, nút **Đề xuất duyệt** trong form sửa dòng ngân sách, hoặc nút ở khối hạn mức trong **Tổng quan campaign**. Form hiện số hiện tại → số đề xuất, tiền tệ điền sẵn theo đối tượng, kèm lý do. Form dòng ngân sách không còn ô nhập "Được duyệt" — chỉ hiện dấu duyệt hiện tại (đã duyệt bởi ai, ngày nào; hoặc "Chưa được duyệt").
2. **Duyệt ngân sách:** **chỉ Owner** (quyền `budget.decide`) quyết định đề xuất trong hàng đợi **Ngân sách** ở màn Duyệt/Requests. Duyệt xong, số đã duyệt của dòng / hạn mức của campaign và dấu duyệt (người duyệt + ngày) cập nhật ngay; từ chối thì đối tượng đích giữ nguyên.
3. **Cam kết / khoản chi:** cam kết và khoản chi mới tạo luôn ở trạng thái **chờ duyệt**. **Lead / Owner** (quyền `approval.decide`) duyệt/từ chối ngay tại danh sách cam kết/khoản chi — nhưng chỉ khi dòng ngân sách chứa nó **đã có dấu duyệt của Owner**, tổng sử dụng sau duyệt (chỉ tính các khoản đã duyệt) **không vượt số đã duyệt**, và **không tự duyệt khoản do mình tạo** (trừ Owner). UI khóa nút kèm lý do tại chỗ ("Khoản ngân sách chưa được duyệt" / "Vượt số đã duyệt") khi tiền kiểm không đạt; server vẫn là chốt cuối.
4. **CEO** không đề xuất, không duyệt — chỉ xem trạng thái và dấu duyệt như các số liệu khác trong phạm vi xem của mình.
