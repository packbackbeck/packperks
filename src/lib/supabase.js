import { createClient } from '@supabase/supabase-js'
import { getDeviceId } from './deviceId'

// Database requests carry the device id so the database can tell whose rows
// a request may touch (request_device_id() in migration 043). Only /rest/v1/
// gets it: the same fetch serves edge functions and storage, whose CORS rules
// don't list the header and would reject the request. The dashboard shares
// this client; the header does nothing for staff, who are matched by login.
const REST_PATH = '/rest/v1/'

function fetchWithDeviceId(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  if (!url.includes(REST_PATH)) return fetch(input, init)
  const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers))
  headers.set('x-device-id', getDeviceId())
  return fetch(input, { ...init, headers })
}

// The PackPulse embed (/packpulse-embed, docs/packpulse/INTEGRATION.md)
// signs in as its connection's own login. That session lives in memory
// only, so it never replaces a customer or dashboard login saved for this
// domain.
export const IS_PACKPULSE_EMBED = typeof window !== 'undefined'
  && window.location.pathname.startsWith('/packpulse-embed')

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  IS_PACKPULSE_EMBED
    ? {
      global: { fetch: fetchWithDeviceId },
      auth: { persistSession: false, detectSessionInUrl: false, storageKey: 'pp-packpulse-embed' },
    }
    : { global: { fetch: fetchWithDeviceId } }
)

// In the embed, the dashboard's readers run unchanged, but every table
// they read resolves to its packpulse_* view (migration 057): the
// connected venue's rows only, without customer emails, payout links or
// cup codes. Anything else reads what any signed-in login may read.
const PACKPULSE_VIEWS = {
  users: 'packpulse_users',
  cup_balances: 'packpulse_cup_balances',
  claims: 'packpulse_claims',
  cup_scans: 'packpulse_cup_scans',
  activity_history: 'packpulse_activity_history',
  cups: 'packpulse_cups',
  system_events: 'packpulse_system_events',
  client_events: 'packpulse_client_events',
  pending_batches: 'packpulse_pending_batches',
  backup_cup_uses: 'packpulse_backup_cup_uses',
  bin_sessions: 'packpulse_bin_sessions',
  consent_rejections: 'packpulse_consent_rejections',
  // User analytics → User flow, Heatmap, Session replay (migration 064).
  // The ux_* RPCs behind them are reached directly, not through a view:
  // ux_guard(p_orgs) is what keeps a connection to its own venues.
  ux_sessions: 'packpulse_ux_sessions',
  ux_events: 'packpulse_ux_events',
  ux_layouts: 'packpulse_ux_layouts',
}

if (IS_PACKPULSE_EMBED) {
  const from = supabase.from.bind(supabase)
  supabase.from = (relation) => from(PACKPULSE_VIEWS[relation] || relation)
}
