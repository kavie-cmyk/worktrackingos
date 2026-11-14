// ============================================================================
// invite-member — Edge Function mời thành viên vào workspace (R06/R25).
// 1 file, không import _shared (deploy qua helper 1 file — xem CONNECTOR.md).
//
// Luồng:
//   1) verify_jwt (bật ở tầng deploy) + hàm tự lấy user từ Bearer JWT.
//   2) Kiểm người gọi là OWNER active của workspace được mời (memberships).
//   3) Dùng service_role (chỉ phía server) gọi Auth Admin inviteUserByEmail
//      + upsert public.users + upsert memberships với role được mời.
//   4) Trả { user_id, email, role, workspace_id }.
// User thường / anon KHÔNG tự mời được: thiếu JWT -> 401 (verify_jwt);
// có JWT nhưng không phải owner của workspace -> 403.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const INVITABLE_ROLES = ["lead", "member", "ceo"];

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "UNAUTHORIZED", message: "Thiếu Bearer JWT của người gọi." }, 401);
  }

  // Xác thực người gọi bằng chính JWT của họ (không dùng service_role).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  const caller = userData?.user;
  if (userError || !caller) {
    return json({ error: "UNAUTHORIZED", message: "JWT người gọi không hợp lệ." }, 401);
  }

  let body: { workspace_id?: string; email?: string; role?: string; display_name?: string; redirect_url?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "BAD_REQUEST", message: "Body phải là JSON." }, 400);
  }
  const workspaceId = body.workspace_id ?? "";
  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role ?? "";
  if (!workspaceId || !email || !email.includes("@")) {
    return json({ error: "BAD_REQUEST", message: "Thiếu workspace_id hoặc email không hợp lệ." }, 400);
  }
  if (!INVITABLE_ROLES.includes(role)) {
    return json({ error: "BAD_REQUEST", message: `role phải thuộc: ${INVITABLE_ROLES.join(", ")} (owner không mời qua đường này).` }, 400);
  }

  const admin: SupabaseClient = createClient(supabaseUrl, serviceKey);

  // Chỉ OWNER active của đúng workspace mới được mời.
  const { data: membership } = await admin
    .from("memberships")
    .select("role, is_active")
    .eq("workspace_id", workspaceId)
    .eq("user_id", caller.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership || membership.role !== "owner") {
    return json({ error: "FORBIDDEN", message: "Chỉ Owner của workspace mới mời được thành viên." }, 403);
  }

  // Mời qua Auth Admin — Supabase gửi email mời, user tự đặt mật khẩu.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirect_url || undefined,
    data: { invited_role: role, workspace_id: workspaceId },
  });
  if (inviteError || !invited?.user) {
    return json(
      { error: "INVITE_FAILED", message: inviteError?.message ?? "Auth Admin không tạo được lời mời." },
      422,
    );
  }
  const newUserId = invited.user.id;

  // Hồ sơ public.users (id TRÙNG auth.users.id) + membership với role được mời.
  const displayName = (body.display_name ?? "").trim() || email.split("@")[0];
  const { error: profileError } = await admin
    .from("users")
    .upsert({ id: newUserId, email, display_name: displayName, is_active: true }, { onConflict: "id" });
  if (profileError) {
    return json({ error: "PROFILE_FAILED", message: profileError.message, user_id: newUserId }, 500);
  }

  const { error: memberError } = await admin
    .from("memberships")
    .upsert(
      { workspace_id: workspaceId, user_id: newUserId, role, is_active: true },
      { onConflict: "workspace_id,user_id" },
    );
  if (memberError) {
    return json({ error: "MEMBERSHIP_FAILED", message: memberError.message, user_id: newUserId }, 500);
  }

  return json({ user_id: newUserId, email, role, workspace_id: workspaceId }, 200);
});
