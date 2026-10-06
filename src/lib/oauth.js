import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/* ─────────────────────────────────────────────────────────────────────
 * Sign in with Google, for the customer app.
 *
 * Google is a second door into the SAME account an emailed code opens.
 * Supabase Auth links the two automatically when the address is the same
 * and verified (a Google address always is), so:
 *
 *   • someone who used codes before and now taps Google lands in their
 *     account, with their cups;
 *   • someone who signed up with Google and later asks for a code to that
 *     address gets the same account too.
 *
 * Nothing here decides an account; it only starts the round trip and
 * remembers why it started. Google sends the browser away and back, so the
 * reason (a claim waiting on an email, a Deferred Tikkie receipt…) is kept
 * in sessionStorage as an "intent" and picked up on the way back:
 *
 *   rewards modes → App.jsx's auth listener (SIGNED_IN / INITIAL_SESSION)
 *   Deferred Tikkie → TikkieHomePage, which hands the session to bin-tikkie
 *                     (action oauth_login) because that mode's wallet is
 *                     keyed by device, not by login.
 *
 * The button only appears when the project actually has Google switched on
 * (Supabase → Authentication → Providers). Until then every caller renders
 * nothing, so shipping this changes no screen.
 * ───────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const INTENT_KEY = 'pp_oauth_intent';
const PROVIDERS_KEY = 'pp_auth_providers';
const PROVIDERS_TTL_MS = 10 * 60 * 1000;
const INTENT_TTL_MS = 15 * 60 * 1000;

/* DEV only: `?google=1` shows the button before the provider is switched
 * on, so the screens can be checked. Clicking it then fails at Supabase
 * with "provider is not enabled", which is the honest result. */
function devForced() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).get('google') === '1'; } catch { return false; }
}

let providersPromise = null;

/** Which sign-in providers the project has on, read from Supabase's public
 *  settings endpoint (the same one its own UI kits use). Cached briefly. */
export function enabledProviders() {
  if (providersPromise) return providersPromise;
  providersPromise = (async () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(PROVIDERS_KEY) || 'null');
      if (cached && Date.now() - cached.at < PROVIDERS_TTL_MS) return cached.external || {};
    } catch { /* no storage */ }
    try {
      const resp = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON } });
      const body = await resp.json();
      const external = body?.external || {};
      try { sessionStorage.setItem(PROVIDERS_KEY, JSON.stringify({ at: Date.now(), external })); } catch { /* fine */ }
      return external;
    } catch {
      return {};
    }
  })();
  return providersPromise;
}

/** True once we know Google sign-in is switched on for this project. */
export function useGoogleAvailable() {
  const [on, setOn] = useState(devForced);
  useEffect(() => {
    if (devForced()) return undefined;
    let alive = true;
    enabledProviders().then((ext) => { if (alive) setOn(ext?.google === true); });
    return () => { alive = false; };
  }, []);
  return on;
}

/** Send the customer to Google. `intent` says what to do on the way back:
 *  { kind: 'rewards', pending: 'claim' | 'refund' | null }
 *  { kind: 'tikkie', orgId, batchId } */
export async function startGoogleSignIn(intent = {}) {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({
      ...intent, provider: 'google', at: Date.now(), path: window.location.pathname,
    }));
  } catch { /* the round trip still works; only the follow-up is lost */ }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Back to THIS venue, without the query: a ?batch= or ?byo= in the
      // address would be scanned a second time on the way back. A receipt
      // that started the sign-in travels in the intent instead.
      redirectTo: window.location.origin + window.location.pathname,
      // Always show the account picker, so a shared or family phone does
      // not silently sign in as whoever used Google last.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) {
    clearOAuthIntent();
    throw error;
  }
}

function readIntent() {
  try {
    const it = JSON.parse(sessionStorage.getItem(INTENT_KEY) || 'null');
    if (!it || Date.now() - Number(it.at || 0) > INTENT_TTL_MS) return null;
    return it;
  } catch {
    return null;
  }
}

export function clearOAuthIntent() {
  try { sessionStorage.removeItem(INTENT_KEY); } catch { /* fine */ }
}

/** The pending round trip, if one is in flight, without consuming it. */
export function peekOAuthIntent() {
  return readIntent();
}

/** The pending round trip, consumed: it is acted on exactly once. */
export function takeOAuthIntent() {
  const it = readIntent();
  clearOAuthIntent();
  return it;
}

/** Google (or Supabase) sent the customer back with an error instead of a
 *  session — they closed the picker, or the provider is misconfigured.
 *  Read it once and clean it off the address. */
export function readOAuthError() {
  if (typeof window === 'undefined') return null;
  const { search, hash } = window.location;
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const code = q.get('error') || h.get('error');
  if (!code) return null;
  const description = q.get('error_description') || h.get('error_description') || '';
  try {
    ['error', 'error_code', 'error_description'].forEach(k => q.delete(k));
    const rest = q.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  } catch { /* leave the address as it is */ }
  return { code, description };
}

/** A round trip of `kind` that came back with an error: consume its intent,
 *  clean the address, and return { intent, message }. Only ever reads the
 *  address when one of OUR round trips is in flight, so an error meant for
 *  somebody else (the dashboard's own sign-in links) is left alone. */
export function takeOAuthReturnError(kind) {
  const it = readIntent();
  if (!it || it.kind !== kind) return null;
  const err = readOAuthError();
  if (!err) return null;
  clearOAuthIntent();
  return { intent: it, message: oauthErrorMessage(err) };
}

/** What to tell the customer when the round trip came back empty. */
export function oauthErrorMessage(err) {
  if (!err) return null;
  if (err.code === 'access_denied') {
    return 'Google sign-in was closed before it finished. You can try again, or use your email instead.';
  }
  return 'Google sign-in didn’t go through. Try again, or use your email instead.';
}

/** The ways the current login can sign in: ['email'], ['google'] or both. */
export function providersOf(session) {
  const meta = session?.user?.app_metadata || {};
  const list = Array.isArray(meta.providers) ? meta.providers : (meta.provider ? [meta.provider] : []);
  return [...new Set(list)];
}

/** The signed-in email and how it signs in, or nulls when anonymous. */
export async function getAuthInfo() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session || null;
  return {
    email: session?.user?.email || null,
    providers: providersOf(session),
    accessToken: session?.access_token || null,
  };
}
