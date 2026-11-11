-- ============================================================================
-- SAVA Marketing Workspace — bootstrap/owner.sql
-- Tạo / khôi phục tài khoản Owner ĐẦU TIÊN cho workspace mặc định.
--
-- IDEMPOTENT: chạy lại nhiều lần an toàn — mọi thao tác đều là upsert,
-- chạy lần 2+ chỉ xác nhận lại đúng trạng thái (user active, workspace
-- 'sava-marketing' tồn tại, membership role='owner', is_active=true),
-- không tạo bản ghi trùng.
--
-- ĐIỀU KIỆN TIÊN QUYẾT: auth user phải ĐÃ TỒN TẠI trong auth.users trước
-- khi chạy (Owner được mời bằng Auth Admin invite — xem docs/SETUP.md
-- Bước 6 — hoặc tạo trước trong Dashboard → Authentication → Users).
-- File này KHÔNG tạo auth user và KHÔNG đặt mật khẩu.
--
-- Cách chạy: dán toàn bộ file này vào SQL Editor của project
-- sava-marketing-workspace (ref nlbtjtubihxbkigdfpdg) rồi Run một lần để
-- định nghĩa function, sau đó gọi function với email của Owner (dòng gọi
-- mẫu ở CUỐI file, đang bị comment hoá — bỏ comment và thay email thật).
-- Cũng có thể gọi qua Management API (database/query) với cùng câu lệnh.
--
-- Tên cột đối chiếu migration 0001_schema.sql:
--   workspaces   (id, name, slug UNIQUE, timezone DEFAULT 'Asia/Ho_Chi_Minh',
--                 settings jsonb)
--   users        (id = auth.users.id, email UNIQUE, display_name NOT NULL,
--                 is_active boolean)
--   memberships  (workspace_id, user_id, role CHECK owner/lead/member/ceo,
--                 is_active boolean, UNIQUE (workspace_id, user_id))
--   LƯU Ý: memberships KHÔNG có cột `status` — trạng thái là `is_active`.
-- ============================================================================

create or replace function public.bootstrap_owner(p_email text)
returns table (workspace_id uuid, user_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email        text := lower(trim(p_email));
  v_user_id      uuid;
  v_workspace_id uuid;
  v_display_name text;
begin
  if v_email is null or v_email = '' then
    raise exception 'bootstrap_owner: email không được để trống';
  end if;

  -- 1. Tìm auth user theo email trong auth.users.
  select au.id
    into v_user_id
    from auth.users au
   where lower(au.email) = v_email
   limit 1;

  if v_user_id is null then
    raise exception 'Chưa có auth user với email này — hãy gửi invite/tạo user trước (email: %)', v_email;
  end if;

  -- display_name mặc định = phần trước '@' của email (chỉ dùng khi tạo mới).
  v_display_name := split_part(v_email, '@', 1);
  if v_display_name = '' then
    v_display_name := v_email;
  end if;

  -- 2. Upsert hồ sơ public.users (id TRÙNG auth.users.id).
  --    Khi đã có: chỉ kích hoạt lại + đồng bộ email, GIỮ NGUYÊN display_name.
  insert into public.users (id, email, display_name, is_active)
  values (v_user_id, v_email, v_display_name, true)
  on conflict (id) do update
    set email     = excluded.email,
        is_active = true,
        updated_at = now();

  -- 3. Workspace mặc định: tạo nếu chưa có (theo slug).
  --    on conflict (slug) do nothing rồi lấy lại id — an toàn khi chạy lại.
  insert into public.workspaces (name, slug)
  values ('SAVA Marketing Workspace', 'sava-marketing')
  on conflict (slug) do nothing;

  select w.id
    into v_workspace_id
    from public.workspaces w
   where w.slug = 'sava-marketing'
   limit 1;

  if v_workspace_id is null then
    raise exception 'bootstrap_owner: không tìm thấy workspace slug sava-marketing sau khi tạo';
  end if;

  -- 4. Upsert membership role 'owner' cho user trong workspace mặc định.
  --    Dùng UPDATE-rồi-INSERT thay cho ON CONFLICT: tên OUT parameter của
  --    function (workspace_id, user_id) trùng tên cột memberships khiến
  --    mệnh đề ON CONFLICT (workspace_id, user_id) bị lỗi 42702 ambiguous
  --    (QA vòng 2 phát hiện 11/11/2026).
  update public.memberships m
     set role       = 'owner',
         is_active  = true,
         updated_at = now()
   where m.workspace_id = v_workspace_id
     and m.user_id      = v_user_id;

  if not found then
    insert into public.memberships (workspace_id, user_id, role, is_active)
    values (v_workspace_id, v_user_id, 'owner', true);
  end if;

  -- 5. Trả về kết quả để người chạy kiểm tra ngay.
  return query select v_workspace_id, v_user_id, 'owner'::text;
end;
$$;

comment on function public.bootstrap_owner(text) is
  'Bootstrap Owner đầu tiên: upsert public.users + workspace mặc định (slug sava-marketing) + membership role owner. Idempotent. Auth user phải tồn tại trước trong auth.users.';

-- ============================================================================
-- HƯỚNG DẪN DÙNG
-- 1. Chạy toàn bộ file này một lần trong SQL Editor để tạo function.
-- 2. Mời / tạo auth user cho Owner trước (xem docs/SETUP.md Bước 6).
-- 3. Bỏ comment dòng dưới, thay email mẫu bằng email thật của Owner, chạy:
--
-- select * from public.bootstrap_owner('email@example.com');
--
-- Kết quả đúng: 1 dòng trả về gồm workspace_id, user_id và role = 'owner'.
-- Kiểm tra lại nếu cần:
--   select m.role, m.is_active, u.email
--     from public.memberships m
--     join public.users u on u.id = m.user_id
--     join public.workspaces w on w.id = m.workspace_id
--    where w.slug = 'sava-marketing';
-- ============================================================================
