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

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: fetchWithDeviceId } }
)
