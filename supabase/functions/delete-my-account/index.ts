// PackPerks - delete-my-account Edge Function
//
// Self-service account erasure for a REGISTERED customer (GDPR right to be
// forgotten). The caller must present their own Supabase auth session, so a
// person can only ever delete their OWN footprint.
//
// purge_my_account() gathers every users row belonging to this person (by
// login, by this device, and through their shared identity, tombstones
// included) and erases them: profile, balances, scans, history and shared
// identity are deleted; claims stay as the 7-year accounting record with
// everything personal removed (migration 043, docs/RETENTION_SCHEDULE.md).
// This function then removes their receipt and scan photos, which only the
// Storage API can delete, and finally the login, so the email is forgotten
// and nothing resurfaces on the next sign-in. A login that is also a
// dashboard account is left alone.
//
// Body: { device_id?: string }. Auth: verify_jwt = true.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

// Photos go through the Storage API in batches. Best-effort: a missing object
// must not stop an erasure.
async function removeObjects(bucket: string, paths: unknown): Promise<void> {
  const list = (Array.isArray(paths) ? paths : [])
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (let i = 0; i < list.length; i += 100) {
    try { await supabase.storage.from(bucket).remove(list.slice(i, i + 100)); } catch (_e) { /* best-effort */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'missing_token' }, 401);
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return json({ error: 'invalid_token' }, 401);
  const authUid = user.id;

  let body: { device_id?: string } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const deviceId = (body?.device_id || '').trim() || null;

  try {
    const { data, error } = await supabase.rpc('purge_my_account', {
      p_auth: authUid,
      p_device: deviceId,
    });
    if (error) return json({ error: 'delete_failed', detail: error.message }, 500);
    const result = (data ?? {}) as {
      deleted_rows?: number; deleted_identities?: number; kept_claims?: number;
      receipt_paths?: unknown; scan_paths?: unknown;
    };

    await removeObjects('receipts', result.receipt_paths);
    await removeObjects('cup-scans', result.scan_paths);

    // Finally remove the login so the email is fully forgotten and can't
    // resurface an account on next load.
    const { data: staff } = await supabase.from('admin_profiles')
      .select('id').eq('id', authUid).maybeSingle();
    if (!staff) {
      try { await supabase.auth.admin.deleteUser(authUid); } catch (_e) { /* best-effort */ }
    }

    return json({
      deleted: true,
      deleted_rows: result.deleted_rows ?? 0,
      deleted_identities: result.deleted_identities ?? 0,
      kept_claims: result.kept_claims ?? 0,
    });
  } catch (e) {
    return json({ error: 'delete_failed', detail: String(e) }, 500);
  }
});
