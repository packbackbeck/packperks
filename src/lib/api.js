import { supabase } from './supabase'

// ── Device identity ────────────────────────────────────────────────────────
// The only thing that stays in localStorage: a stable device fingerprint.
//
// `crypto.randomUUID()` is only defined in secure contexts (HTTPS or
// localhost/127.0.0.1). When the dev server is reached via a raw LAN IP
// (e.g. http://10.43.22.14:5173 from a phone), the browser leaves it
// undefined and this used to throw — which crashed init before any
// Supabase calls fired. Fall back to a manual v4 UUID generator when
// missing so LAN testing works without HTTPS.
function safeUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function getDeviceId() {
  let id = localStorage.getItem('packperks_device_id')
  if (!id) {
    id = safeUUID()
    localStorage.setItem('packperks_device_id', id)
  }
  return id
}

// ── Profile generation (for brand-new users) ───────────────────────────────
const ANIMAL_NAMES = ['Fox', 'Panda', 'Bear', 'Rabbit', 'Cat', 'Owl', 'Deer', 'Penguin']
const SILLY_NAMES = {
  Fox:     ['Ferris Fox',    'Felix Fox',    'Francis Fox'],
  Panda:   ['Amanda Panda',  'Sandy Panda',  'Wanda Panda'],
  Bear:    ['Barry Bear',    'Perry Bear',   'Larry Bear'],
  Rabbit:  ['Habit Rabbit',  'Grabbit Rabbit','Abbott Rabbit'],
  Cat:     ['Chadwick Cat',  'Pat the Cat',  'Natty Cat'],
  Owl:     ['Rowland Owl',   'Powell Owl',   'Fowler Owl'],
  Deer:    ['Cheerful Deer', 'Sheer Deer',   'Pierre Deer'],
  Penguin: ['Finn Penguin',  'Quinn Penguin','Guin Penguin'],
}

export function generateInitialProfile() {
  const animalIndex = Math.floor(Math.random() * ANIMAL_NAMES.length)
  const names = SILLY_NAMES[ANIMAL_NAMES[animalIndex]]
  const displayName = names[Math.floor(Math.random() * names.length)]
  return { animalIndex, displayName }
}

// ── Timestamp formatter ────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── User ───────────────────────────────────────────────────────────────────
// Hybrid identity model:
//
//   1. **Anonymous (default)** — keyed by localStorage `device_id`. Works
//      with zero friction on first run; clearing the browser data loses
//      the balance.
//   2. **Linked to Supabase Auth** — once the user verifies an email via
//      magic link, we set `users.auth_user_id` and from then on they can
//      sign in from any device and re-bind the row to a new device_id.
//
// `getOrCreateUser()` prefers the auth path when a Supabase session is
// present (i.e. the user has signed in with their email at least once),
// and falls back to the device path otherwise. Returning an existing
// row by either lookup is always preferred over inserting a duplicate.
export async function getOrCreateUser(orgId) {
  const deviceId = getDeviceId()

  // Safety net: never resolve a user without an org. A device can now have
  // one row PER org (per-org identity), so an org-less lookup hits multiple
  // rows, errors, and mints a fresh orphan user — fragmenting the balance.
  // Fall back to the default org so we always land on a real per-org row.
  if (!orgId) orgId = await getDefaultOrgId()

  // 1. Auth path — if a Supabase session is in scope, look the user up
  //    by auth_user_id. This is the only path that survives a fresh
  //    browser / new device.
  const { data: sessionData } = await supabase.auth.getSession()
  const authUid = sessionData?.session?.user?.id
  const authEmail = sessionData?.session?.user?.email

  if (authUid) {
    // Per-org identity: scope every lookup to the active org so the same
    // person/device gets a separate row (and balance) in each org.
    let byAuthQ = supabase.from('users').select('*').eq('auth_user_id', authUid)
    if (orgId) byAuthQ = byAuthQ.eq('org_id', orgId)
    const { data: byAuth } = await byAuthQ.maybeSingle()

    if (byAuth) {
      // Refresh the device_id binding so subsequent anonymous-path
      // visits on this device find the same row even without a session.
      if (byAuth.device_id !== deviceId) {
        await supabase.from('users').update({ device_id: deviceId }).eq('id', byAuth.id)
      }
      return byAuth
    }

    // Session exists but no users row for this org — check whether the
    // current device_id row (in this org) is unlinked, and adopt it.
    let byDeviceQ = supabase.from('users').select('*').eq('device_id', deviceId)
    if (orgId) byDeviceQ = byDeviceQ.eq('org_id', orgId)
    const { data: byDevice } = await byDeviceQ.maybeSingle()

    if (byDevice && !byDevice.auth_user_id) {
      const { data: linked } = await supabase
        .from('users')
        .update({
          auth_user_id: authUid,
          email: byDevice.email || authEmail || null,
          email_verified_at: new Date().toISOString(),
        })
        .eq('id', byDevice.id)
        .select()
        .single()
      return linked || byDevice
    }
    // No row yet — fall through and create one bound to both keys.
    const newRow = {
      device_id: deviceId,
      auth_user_id: authUid,
      email: authEmail || null,
      email_verified_at: new Date().toISOString(),
      animal_index: 0,
    }
    if (orgId) newRow.org_id = orgId
    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert(newRow)
      .select()
      .single()
    if (createErr) throw createErr
    const balRow = { user_id: created.id, balance: 0, lifetime_cups: 0 }
    if (orgId) balRow.org_id = orgId
    await supabase.from('cup_balances').insert(balRow)
    return created
  }

  // 2. Anonymous device path — scoped to the active org so each org keeps
  //    its own customer/user row for this device.
  let existingQ = supabase.from('users').select('*').eq('device_id', deviceId)
  if (orgId) existingQ = existingQ.eq('org_id', orgId)
  const { data: existing } = await existingQ.maybeSingle()

  if (existing) return existing

  const anonRow = { device_id: deviceId, animal_index: 0 }
  if (orgId) anonRow.org_id = orgId
  const { data: newUser, error } = await supabase
    .from('users')
    .insert(anonRow)
    .select()
    .single()

  // React StrictMode mounts twice — second insert hits the unique constraint.
  // Just re-fetch the row that the first call created.
  if (error?.code === '23505') {
    let retryQ = supabase.from('users').select('*').eq('device_id', deviceId)
    if (orgId) retryQ = retryQ.eq('org_id', orgId)
    const { data: existing2 } = await retryQ.maybeSingle()
    return existing2
  }

  if (error) throw error

  // Ignore duplicate balance row (same race condition safety)
  const anonBalRow = { user_id: newUser.id, balance: 0, lifetime_cups: 0 }
  if (orgId) anonBalRow.org_id = orgId
  await supabase.from('cup_balances').insert(anonBalRow)

  return newUser
}

// ── Email magic link auth ──────────────────────────────────────────────────
//
// Two-step flow:
//   1. `sendMagicLink(email)` — Supabase emails the user a one-tap link.
//      Returns immediately so the UI can render a "check your inbox" state.
//   2. User clicks the link → comes back to the app with a session
//      cookie in place. App.jsx subscribes to onAuthStateChange and
//      re-runs getOrCreateUser, which links the existing anonymous row
//      to the new auth.users id (see step 1 of getOrCreateUser).
//
// The redirect target defaults to the current origin so the user lands
// back inside the app instead of on a generic Supabase confirmation page.
export async function sendMagicLink(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('invalid_email')
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      // Land them back at the user app — Supabase exchanges the code
      // for a session automatically when this URL is hit.
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      // Allow creating new auth.users rows on first signin. Existing
      // PackPerks customers who never had an email will get a fresh
      // auth row that we link to their device-side user row.
      shouldCreateUser: true,
    },
  })
  if (error) throw error
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ── Restore-by-email flow (lost-my-cups recovery) ─────────────────────────
// Symmetric to sendMagicLink but explicitly intended for the "I lost my
// cups" path where the user types the 6-digit OTP into the UI instead of
// clicking the link in the email. Same Supabase Auth endpoint either way
// — the difference is purely how the client picks up the session.
export async function requestRestoreOtp(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('invalid_email')
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      // Create the auth.users row if it doesn't exist yet. The edge
      // function's "no_prior_history" branch handles the case where
      // the email has no PackPerks footprint — they just become a
      // fresh user after the standard SIGNED_IN flow.
      shouldCreateUser: true,
      // No emailRedirectTo override — we WANT the user to come back
      // through the in-app code entry, not a magic-link round trip.
    },
  })
  if (error) throw error
}

// Verify the 6-digit code the user typed. On success, a Supabase Auth
// session is established (same as if they'd clicked the magic link).
// We then call the restore-by-email edge function to actually merge
// their device row into the email-side history.
export async function verifyRestoreOtp(email, code) {
  if (!email || !code) throw new Error('missing_email_or_code')
  const cleaned = String(code).replace(/\D/g, '').slice(0, 6)
  if (cleaned.length !== 6) throw new Error('invalid_code')
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: cleaned,
    type: 'email',
  })
  if (error) throw error
}

// Finalise the restore: ask the edge function to find the email-side
// users row, merge any cups the current device has into it, and link
// the rows together. Must be called AFTER verifyRestoreOtp succeeds so
// there's a valid auth session for the JWT check on the server.
//
// Returns the function's structured response — UIs that want to show
// "we restored N cups" can read `merged_balance` when status === 'merged'.
export async function finaliseRestore() {
  const deviceId = getDeviceId()
  const { data, error } = await supabase.functions.invoke('restore-by-email', {
    body: { device_id: deviceId },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload })
  }
  return data
}

// Read-only helper for components that want to show the current email
// in a "signed in as …" affordance.
export async function getCurrentAuthEmail() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.email || null
}

// Subscribe to auth state changes. Returns the unsubscribe function.
// App.jsx uses this to refresh the local user object when the magic
// link click lands a brand-new session.
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })
  return () => data?.subscription?.unsubscribe?.()
}

export async function updateUserProfile(userId, updates) {
  const dbUpdates = { updated_at: new Date().toISOString() }
  if ('displayName' in updates) dbUpdates.display_name = updates.displayName
  if ('animalIndex' in updates) dbUpdates.animal_index = updates.animalIndex
  if ('email' in updates) dbUpdates.email = updates.email
  if ('iban' in updates) dbUpdates.iban = updates.iban
  if ('selectedRewardId' in updates) dbUpdates.selected_reward_id = updates.selectedRewardId
  if ('device' in updates) dbUpdates.device = updates.device

  const { error } = await supabase
    .from('users')
    .update(dbUpdates)
    .eq('id', userId)

  if (error) throw error
}

// ── Cup balance ────────────────────────────────────────────────────────────
export async function getCupBalance(userId) {
  const { data, error } = await supabase
    .from('cup_balances')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data?.balance ?? 0
}

// Cumulative stats for the user-app impact card.
// `lifetime_cups` is the running total of every cup ever credited to
// this user — never decremented, even when they redeem rewards. Used
// by the impact metrics card to show "you've returned N cups across
// your whole time using PackPerks". The current `balance` is also
// returned in the same trip so the caller can avoid a second query.
export async function getUserStats(userId) {
  if (!userId) return { balance: 0, lifetimeCups: 0 }
  const { data, error } = await supabase
    .from('cup_balances')
    .select('balance, lifetime_cups')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return {
    balance:      data?.balance       ?? 0,
    lifetimeCups: data?.lifetime_cups ?? 0,
  }
}

// Community-wide totals for the Impact detail modal. Sums every
// cup_balances row's `lifetime_cups` (optionally scoped to a single
// org) so the customer sees the real, server-sourced "look what we've
// done together" number — not a marketing estimate.
//
// Scoping: pass an `orgId` to get just that brand's community total
// (the more common case for per-org campaigns). Pass null/undefined
// to get the cross-org PackPerks-wide total. RLS on cup_balances
// permits authenticated reads (same as `getCupBalance` already does)
// so anonymous users count too.
export async function getGlobalImpact(orgId) {
  let query = supabase.from('cup_balances').select('lifetime_cups')
  if (orgId) query = query.eq('org_id', orgId)
  const { data, error } = await query
  if (error) throw error
  let totalLifetime = 0
  let userCount = 0
  for (const row of data || []) {
    totalLifetime += row?.lifetime_cups || 0
    if ((row?.lifetime_cups || 0) > 0) userCount += 1
  }
  return { totalLifetimeCups: totalLifetime, returningUsers: userCount }
}

export async function updateCupBalance(userId, newBalance) {
  const { error } = await supabase
    .from('cup_balances')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId)

  if (error) throw error
}

// ── Cup claim via QR scan (new flow) ───────────────────────────────────────
//
// Parses a scanned QR payload into an array of cup UUIDs, then invokes the
// claim-cups edge function which atomically activates them and increments
// the user's balance. The payload format is either:
//   • A URL: `https://…/?cups=<uuid>,<uuid>,...`
//   • Or a raw list: `<uuid>,<uuid>,...`
// Anything else is rejected client-side.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* Parse the QR payload into a claim spec. Recognises three forms:
 *   • URL ?batch=<uuid>     → { batchId }      ← preferred (tiny QR)
 *   • URL ?cups=<uuid,uuid> → { cupIds: [..] } ← legacy / multi-cup
 *   • Raw uuid CSV          → { cupIds: [..] } ← bare payload
 * Returns null if the payload doesn't look like a PackPerks cup code. */
export function parseCupQr(payload) {
  if (!payload || typeof payload !== 'string') return null
  let batch = null
  let cupsParam = null
  try {
    const url = new URL(payload)
    batch = url.searchParams.get('batch')
    cupsParam = url.searchParams.get('cups')
  } catch {
    cupsParam = payload
  }
  if (batch && UUID_RE.test(batch)) return { batchId: batch }
  if (cupsParam) {
    const ids = cupsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length > 0 && ids.every(id => UUID_RE.test(id))) return { cupIds: ids }
  }
  return null
}

// Upload a cup-scan snapshot to the private cup-scans bucket. The
// scanId is generated client-side so the upload and the subsequent
// claim-cups call can share a key — admin UI reads this back via a
// signed URL.
//
// The gallery flow on iOS Safari has, historically, been the most
// fragile path here:
//   • Compressed JPEG data-URLs can still weigh in at 1–2 MB on a
//     1600px source if the JPEG has heavy texture.
//   • Some HEIC originals decode oddly on Safari and produce data-URLs
//     with mime "image/png" or no mime at all — we used to honour that
//     and write `.png` files that nothing else expected.
//
// Both bite us silently because the upload returns 200 with garbage,
// or 413 with a CORS-stripped error body. So now:
//   1. We always upload as `image/jpeg` with a `.jpg` extension.
//   2. We bail early (and log loudly) on data-URLs that are obviously
//      empty / malformed.
//   3. We surface storage errors in the console with the source URL
//      length, so a future investigator can see "ah, it was 4.2 MB
//      hitting the bucket limit".
export async function uploadCupScanPhoto(scanId, photoDataUrl) {
  if (!scanId) return null
  if (!photoDataUrl || typeof photoDataUrl !== 'string' || !photoDataUrl.startsWith('data:')) {
    if (photoDataUrl) console.warn('uploadCupScanPhoto: ignoring non-dataURL photo (len=' + (photoDataUrl?.length ?? 0) + ')')
    return null
  }
  const blob = dataUrlToBlob(photoDataUrl)
  if (!blob || blob.size === 0) {
    console.warn('uploadCupScanPhoto: empty blob, skipping (raw len=' + photoDataUrl.length + ')')
    return null
  }
  // Always normalise to JPEG. compressToJpeg in the user app already
  // emits image/jpeg, but iOS Safari occasionally tags a re-encoded
  // gallery image as image/png. Forcing the content type + extension
  // keeps the admin table thumbnail and the bucket key in sync.
  const path = `${scanId}.jpg`
  const { error } = await supabase.storage
    .from('cup-scans')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) {
    console.error('cup-scan upload failed (path=' + path + ', size=' + blob.size + ' bytes):', error)
    return null
  }
  return path
}

export async function getCupScanSignedUrl(photoPath, ttlSec = 600) {
  if (!photoPath) return null
  const { data, error } = await supabase.storage
    .from('cup-scans')
    .createSignedUrl(photoPath, ttlSec)
  if (error) {
    console.error('cup-scan sign url failed:', error)
    return null
  }
  return data?.signedUrl ?? null
}

export async function shareCups(userId, count) {
  const { data, error } = await supabase.functions.invoke('share-cups', {
    body: { user_id: userId, count, device_id: getDeviceId() },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload })
  }
  return data // { cup_ids, count, newBalance, batch_id }
}

// `parsed` is what parseCupQr returns (or a bare array for back-compat).
// Optional opts: { scanId, scanType, photoPath } pass-through to server
// so admins can review the photo and audit every attempt.
export async function claimCups(userId, parsed, opts = {}) {
  const body = { user_id: userId, device_id: getDeviceId() }
  if (Array.isArray(parsed)) {
    body.cup_ids = parsed
  } else if (parsed?.batchId) {
    body.batch_id = parsed.batchId
  } else if (parsed?.cupIds) {
    body.cup_ids = parsed.cupIds
  } else {
    throw new Error('claimCups: invalid scan payload')
  }
  if (opts.scanId)    body.scan_id   = opts.scanId
  if (opts.scanType)  body.scan_type = opts.scanType
  if (opts.photoPath) body.photo_path = opts.photoPath

  const { data, error } = await supabase.functions.invoke('claim-cups', { body })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch {}
    throw Object.assign(new Error(payload?.reason || error.message), { detail: payload })
  }
  return data
}

// ── Cup scans (legacy: photo-based, kept for backwards compat) ─────────────
// Logs each scan event. Phase 2: set status='pending' and populate photo_url.
export async function logCupScan(userId, { cupsAwarded = 1, photoUrl = null } = {}) {
  const { data, error } = await supabase
    .from('cup_scans')
    .insert({
      user_id: userId,
      cups_awarded: cupsAwarded,
      photo_url: photoUrl,
      status: photoUrl ? 'pending' : 'approved', // pending when photo present so admin reviews it
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

// ── Activity history ───────────────────────────────────────────────────────
export async function getHistory(userId) {
  const { data, error } = await supabase
    .from('activity_history')
    .select('type, label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []).map(row => ({
    type: row.type,
    label: row.label,
    time: formatTime(row.created_at),
    // Raw timestamp is needed by the activity modal to find the exact
    // matching claim row (claim and activity are written ~simultaneously
    // in a Promise.all, so matching on time proximity gives the right one
    // even when the user has multiple claims for the same reward).
    createdAt: row.created_at,
  }))
}

export async function addHistoryEntry(userId, type, label) {
  const { error } = await supabase
    .from('activity_history')
    .insert({ user_id: userId, type, label })

  if (error) throw error
}

// ── Published app config (rewards + settings pushed from admin) ────────────
//
// Multi-org transition: `app_config` was a single-tenant key-value row
// keyed 'published'. After migration 011, every org gets its own row
// keyed 'published:<org_id>'. These helpers accept an optional orgId
// and, when none is given, resolve the default org from the
// `organizations` table. We also fall back to the legacy 'published'
// key if the per-org row doesn't exist yet (graceful behaviour during
// the deploy window between code rolling out and the migration
// running).

// Resolve the default org id (the oldest non-deleted org). Exported so
// the admin context layer in Phase 2 can reuse the same logic before
// the user has picked an active org.
export async function getDefaultOrgId() {
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return data?.id || null
  } catch {
    return null
  }
}

// Fetch an organisation row by its URL slug. Used by the user-facing
// app to bootstrap branding/copy/rewards for a path like /coffeeshop/.
export async function getOrgBySlug(slug) {
  if (!slug) return null
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, slug, brand_color, logo_url, partner_brand_name, email_domain_hint')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle()
    return data || null
  } catch {
    return null
  }
}

// Fetch an organisation row by id. Used after a deep-link cup scan to
// resolve which org the scanned batch belongs to (in case the user
// arrived via QR rather than the slug).
export async function getOrgById(orgId) {
  if (!orgId) return null
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, slug, brand_color, logo_url, partner_brand_name, email_domain_hint')
      .eq('id', orgId)
      .maybeSingle()
    return data || null
  } catch {
    return null
  }
}

// Fetch the default (oldest non-deleted) organisation row. Used as a
// fallback when the URL has no slug.
export async function getDefaultOrg() {
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, slug, brand_color, logo_url, partner_brand_name, email_domain_hint')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return data || null
  } catch {
    return null
  }
}

export async function getAppConfig(orgId) {
  try {
    const resolvedOrgId = orgId || (await getDefaultOrgId())
    if (resolvedOrgId) {
      const { data } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', `published:${resolvedOrgId}`)
        .maybeSingle()
      if (data?.value) return data.value
      // Org is known but has no published config yet — return null rather
      // than leaking another org's config through the legacy key.
      return null
    }
    // No org context at all (e.g. fresh single-tenant install before
    // migration 011 ran) — try the pre-migration legacy key.
    const { data: legacy } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'published')
      .maybeSingle()
    return legacy?.value || null
  } catch {
    return null
  }
}

export async function saveAppConfig(config, orgId) {
  const resolvedOrgId = orgId || (await getDefaultOrgId())
  if (!resolvedOrgId) {
    throw new Error('saveAppConfig: no organization available to save against')
  }
  const { error } = await supabase
    .from('app_config')
    .upsert({
      key: `published:${resolvedOrgId}`,
      value: config,
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

// ── Claims ─────────────────────────────────────────────────────────────────

// Fetch the claims belonging to this device's user. Used by the user-side
// activity feed to surface live status (pending / completed / failed) from
// admin actions, since activity_history is append-only and doesn't update.
export async function getMyClaims(userId) {
  const { data, error } = await supabase
    .from('claims')
    .select('id, type, reward_id, cups_redeemed, payout_amount, status, created_at, verified_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Record a completed donation claim so the admin Donations page can
// aggregate real cup and euro totals. Unlike other claims, donations
// are auto-completed (no admin review / receipt needed) — the user is
// voluntarily giving up their cup value, so there's nothing to approve.
export async function addDonationClaim(userId, cupsCount, payoutAmount, orgId) {
  const insert = {
    user_id: userId,
    type: 'donation',
    cups_redeemed: cupsCount,
    payout_amount: payoutAmount ?? 0,
    status: 'completed',
  }
  if (orgId) insert.org_id = orgId
  const { error } = await supabase.from('claims').insert(insert)
  if (error) throw error
}

export async function createClaim(userId, { type, rewardId, cupsRedeemed, payoutAmount, iban, receiptPhotoUrl, receiptPhotoPath, orgId }) {
  // Generate the claim id client-side and insert WITHOUT a RETURNING
  // select. Why: the anonymous user app has INSERT on `claims` but no
  // SELECT policy (locked down in C-1), so `.insert().select().single()`
  // would fail trying to read the new row back. Supplying our own id
  // sidesteps the read entirely — anon INSERT alone is enough.
  const id = safeUUID()
  const insert = {
    id,
    user_id: userId,
    type,
    reward_id: rewardId ?? null,
    cups_redeemed: cupsRedeemed,
    payout_amount: payoutAmount,
    iban,
    receipt_photo_url: receiptPhotoUrl ?? null,
    receipt_photo_path: receiptPhotoPath ?? null,
    status: 'pending',
  }
  if (orgId) insert.org_id = orgId
  const { error } = await supabase.from('claims').insert(insert)
  if (error) throw error
  return id
}

// ── Receipt upload + AI verification ───────────────────────────────────────
//
// Two-step flow that matches the verify-receipt edge function contract:
//   1. uploadReceiptPhoto(claimId, blob)  → puts photo at receipts/{claim_id}.{ext}
//   2. verifyReceipt(claimId)             → triggers Claude Haiku, writes verdict
//
// Both are anon-keyed; the edge function uses service_role internally.

// Turn a data-URL like "data:image/jpeg;base64,xxx" into a Blob.
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',')
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export async function uploadReceiptPhoto(claimId, photoDataUrl) {
  if (!photoDataUrl) throw new Error('no_photo')
  const blob = dataUrlToBlob(photoDataUrl)
  const ext = blob.type === 'image/png' ? 'png' : 'jpg'
  const path = `${claimId}.${ext}`

  const { error } = await supabase.storage
    .from('receipts')
    .upload(path, blob, {
      contentType: blob.type,
      upsert: true, // tolerate retries on the same claim
    })
  if (error) throw error

  // Update the claim row with the path so the edge function can find it
  const { error: updErr } = await supabase
    .from('claims')
    .update({ receipt_photo_path: path })
    .eq('id', claimId)
  if (updErr) throw updErr

  return path
}

export async function verifyReceipt(claimId) {
  const { data, error } = await supabase.functions.invoke('verify-receipt', {
    body: { claim_id: claimId },
  })
  if (error) throw error
  return data // { status, failureChecks, verdict, summary, requiredItem }
}

// Helper: get a temporary signed URL for displaying a private receipt photo.
// Used by admin UI; ttl defaults to 10 minutes.
export async function getReceiptSignedUrl(photoPath, ttlSec = 600) {
  if (!photoPath) return null
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(photoPath, ttlSec)
  if (error) {
    console.error('Sign URL failed:', error)
    return null
  }
  return data?.signedUrl ?? null
}
