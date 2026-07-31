// PackPerks - consolidate-identity Edge Function
//
// The one authoritative "restore / unify my account" call. Run on sign-in.
// Given the caller's verified auth session (+ their current device id), it
// gathers ALL of that person's users rows across the whole group and points
// them at ONE canonical customer_identity that finally carries auth_user_id,
// merging any duplicate per-store rows so each store shows a single balance.
//
// This fixes the root cause of the cross-store bug: customer_identities never
// got auth_user_id backfilled, so a person's rows scattered across several
// identities and getGroupBalances (keyed on identity_id) only ever saw one
// store's cups. All the heavy lifting is in the consolidate_identity() Postgres
// function (atomic, service-role only); this wrapper just verifies the JWT and
// passes the trusted auth id — a client can never spoof someone else's id.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'missing_token' }, 401);
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return json({ error: 'invalid_token' }, 401);

  let body: { device_id?: string } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const deviceId = (body?.device_id || '').trim() || null;

  const { data, error } = await supabase.rpc('consolidate_identity', {
    p_auth: user.id,
    p_device: deviceId,
    p_email: user.email || null,
  });
  if (error) return json({ error: 'consolidate_failed', detail: error.message }, 500);
  return json({ ok: true, ...(data as Record<string, unknown>) });
});
