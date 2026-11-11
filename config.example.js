// Ví dụ cấu hình SAVA Marketing Workspace — sao chép nội dung này sang config.js
// và thay hai giá trị placeholder bằng thông tin của Supabase project thật.
//
// Hướng dẫn 3 bước:
//   1. Tạo Supabase project riêng cho Marketing Workspace.
//   2. Chạy các migration trong thư mục supabase/ theo tài liệu thiết lập.
//   3. Lấy Project URL và anon public key tại Settings > API của project,
//      rồi điền vào config.js (anon key là khóa công khai, được RLS bảo vệ;
//      tuyệt đối KHÔNG dùng service_role key ở frontend).
window.SAVA_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY"
};
