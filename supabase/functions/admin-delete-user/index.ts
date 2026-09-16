// ──────────────────────────────────────────────────────────────────────────
// PackPerks — admin-delete-user Edge Function
//
// The dashboard's "delete customer". It erases the customer's rows the same
// way the customer's own deletion does (migration 043: claims kept as the
// 7-year accounting record, everything personal removed), removes their
// receipt and scan photos, and deletes their login. A database function
// can't delete a login, which is why deleting from the dashboard used to
// leave it behind: the next sign-in rebuilt the profile from the login and
// the account, email included, came back with an empty balance.
//
// Body: { user_ids: string[], whole_account?: boolean }
//   whole_account true  → every store row that shares the person's identity
//                         (admin_purge_users)
//   whole_account false → just these rows (admin_delete_records 'users')
//
// A login is deleted only when no customer row or shared profile still uses
// it and it isn't a dashboard account; otherwise it is kept and counted.
//
// Auth: verify_jwt = true. The caller must be an owner, admin or manager;
// the database functions run as the caller and check that again.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITER_ROLES = new Set(["owner", "admin", "manager"]);
const MAX_IDS = 500;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// Photos go through the Storage API in batches. Best-effort: a missing object
// must not stop an erasure.
async function removeObjects(bucket: string, paths: unknown): Promise<void> {
  const list = (Array.isArray(paths) ? paths : [])
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  for (let i = 0; i < list.length; i += 100) {
    try { await service.storage.from(bucket).remove(list.slice(i, i + 100)); } catch (_e) { /* best-effort */ }
  }
}

// True when nothing else still needs this login.
async function loginIsUnused(authId: string): Promise<boolean> {
  const [rows, identities, staff] = await Promise.all([
    service.from("users").select("id", { count: "exact", head: true }).eq("auth_user_id", authId),
    service.from("customer_identities").select("id", { count: "exact", head: true }).eq("auth_user_id", authId),
    service.from("admin_profiles").select("id").eq("id", authId).maybeSingle(),
  ]);
  if (rows.error || identities.error || staff.error) return false;
  return (rows.count ?? 0) === 0 && (identities.count ?? 0) === 0 && !staff.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "missing_token" }, 401);
  const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
  if (userErr || !user) return json({ error: "invalid_token" }, 401);

  const { data: me } = await service.from("admin_profiles")
    .select("role, status").eq("id", user.id).maybeSingle();
  if (!me || me.status !== "active" || !WRITER_ROLES.has(me.role)) {
    return json({ error: "forbidden" }, 403);
  }

  let body: { user_ids?: unknown; whole_account?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const ids = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : [])
    .filter((v): v is string => typeof v === "string" && UUID.test(v)))];
  if (ids.length === 0) return json({ error: "no_user_ids" }, 400);
  if (ids.length > MAX_IDS) return json({ error: "too_many", detail: `At most ${MAX_IDS} at a time.` }, 400);
  const wholeAccount = body.whole_account === true;

  // Run the erasure as the caller, so the database's own permission check
  // applies to exactly this person.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = wholeAccount
    ? await asCaller.rpc("admin_purge_users", { p_user_ids: ids })
    : await asCaller.rpc("admin_delete_records", { p_table: "users", p_ids: ids });
  if (error) {
    return json({ error: "delete_failed", detail: error.message }, error.code === "42501" ? 403 : 500);
  }
  const result = (data ?? {}) as {
    deleted_rows?: number; deleted_identities?: number; kept_claims?: number;
    receipt_paths?: unknown; scan_paths?: unknown; auth_user_ids?: unknown;
  };

  await removeObjects("receipts", result.receipt_paths);
  await removeObjects("cup-scans", result.scan_paths);

  let loginsDeleted = 0;
  let loginsKept = 0;
  const logins = (Array.isArray(result.auth_user_ids) ? result.auth_user_ids : [])
    .filter((v): v is string => typeof v === "string" && UUID.test(v));
  for (const authId of logins) {
    if (!(await loginIsUnused(authId))) { loginsKept++; continue; }
    const { error: delErr } = await service.auth.admin.deleteUser(authId);
    if (delErr) { loginsKept++; console.error(`[admin-delete-user] login ${authId}: ${delErr.message}`); }
    else loginsDeleted++;
  }

  const summary = {
    deleted: result.deleted_rows ?? 0,
    deleted_rows: result.deleted_rows ?? 0,
    deleted_identities: result.deleted_identities ?? 0,
    kept_claims: result.kept_claims ?? 0,
    logins_deleted: loginsDeleted,
    logins_kept: loginsKept,
  };

  // Best-effort audit trail; an audit hiccup never undoes an erasure.
  try {
    await service.from("admin_action_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? null,
      org_id: null,
      action: "customer.delete",
      target_type: "users",
      target_id: ids[0],
      after_state: { user_ids: ids, whole_account: wholeAccount, ...summary },
      ip: req.headers.get("x-forwarded-for") || null,
      user_agent: req.headers.get("user-agent") || null,
    });
  } catch (_e) { /* best-effort */ }

  return json(summary);
});
