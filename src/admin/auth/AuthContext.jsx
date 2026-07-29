import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { bootstrapAdmin, signOut } from './authApi';

/* ─────────────────────────────────────────────────────────────────────
 * AuthContext — single source of truth for the currently signed-in
 * admin. Exposes:
 *
 *   • session   — raw Supabase Auth session (or null)
 *   • profile   — row from admin_profiles (display name, role, color…)
 *   • status    — 'loading' | 'unauthenticated' | 'no_profile' | 'authenticated'
 *   • refresh() — reload the profile (after edit / role change)
 *   • signOut() — sign out and clear local state
 *
 * The status state machine drives AuthGate's routing decisions:
 *   loading          → splash
 *   unauthenticated  → login page
 *   no_profile       → bootstrap call (creates admin_profile, then re-renders)
 *   authenticated    → render the admin app
 * ───────────────────────────────────────────────────────────────────── */

const AuthCtx = createContext(null);

/* Captured once at module load — BEFORE supabase-js processes and strips the
 * URL hash — so we know a password-recovery link was opened even after the
 * token has been consumed. supabase also fires a PASSWORD_RECOVERY event we
 * listen for below as a backup. */
const INITIAL_RECOVERY =
  typeof window !== 'undefined' && /[#&]type=recovery/.test(window.location.hash || '');

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [status, setStatus]   = useState('loading');
  const [error, setError]     = useState(null);
  // When true, AuthGate shows the "set a new password" screen instead of the
  // app / login, regardless of profile status.
  const [recovering, setRecovering] = useState(INITIAL_RECOVERY);

  // Tracks the user id behind the current session so we can tell a genuine
  // account change (sign-in/out, switch user) apart from a token refresh.
  const lastUserIdRef = useRef(null);

  // Track the initial session + listen for future auth events.
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      lastUserIdRef.current = data.session?.user?.id ?? null;
      setSession(data.session ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      const nextUserId = sess?.user?.id ?? null;
      // A recovery link opened in this tab — show the reset-password screen.
      if (_event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(sess ?? null);
      // Only invalidate the cached profile when the actual signed-in user
      // changes (sign-out, or a different account signs in). Supabase fires
      // TOKEN_REFRESHED every time the browser tab regains focus; that keeps
      // the same user, so clearing the profile there would flip status to
      // 'loading', unmount the whole admin tree, and wipe any unpublished
      // in-progress edits. Keeping the profile avoids that churn entirely.
      if (nextUserId !== lastUserIdRef.current) {
        lastUserIdRef.current = nextUserId;
        setProfile(null);
      }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  // Whenever we have a session but no profile, call bootstrap-admin.
  // That function is idempotent — it will create the row on first
  // sign-in or return the existing row otherwise.
  useEffect(() => {
    if (!session) {
      setStatus('unauthenticated');
      setProfile(null);
      return;
    }
    if (profile) {
      setStatus('authenticated');
      return;
    }
    setStatus('loading');
    bootstrapAdmin()
      .then(result => {
        setProfile(result?.profile ?? null);
        setStatus(result?.profile ? 'authenticated' : 'no_profile');
      })
      .catch(err => {
        console.error('bootstrapAdmin failed:', err);
        setError(err.message || 'Unknown auth error');
        setStatus('no_profile');
      });
  }, [session, profile]);

  async function refresh() {
    // Force a re-run of the bootstrap effect.
    setProfile(null);
  }

  async function handleSignOut() {
    try { await signOut(); } catch (e) { console.error('signOut failed:', e); }
    setProfile(null);
    setSession(null);
    setStatus('unauthenticated');
  }

  // Leave the password-recovery flow: clear the flag + scrub any leftover token
  // fragment from the URL so a refresh doesn't re-trigger the reset screen.
  function endRecovery() {
    setRecovering(false);
    if (typeof window !== 'undefined' && window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* ignore */ }
    }
  }

  const value = {
    session,
    profile,
    status,
    error,
    recovering,
    endRecovery,
    refresh,
    signOut: handleSignOut,
    setProfile, // for ProfileSetup to update without a round-trip
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/* Convenience hook for permission checks. Maps the role on the current
 * admin profile to a boolean per-action. Centralising here means a
 * future change to the permission matrix touches one file. */
export function usePermission(action) {
  const { profile } = useAuth();
  if (!profile) return false;
  return hasPermission(profile.role, action);
}

export function hasPermission(role, action) {
  // Permission matrix mirrors the one we agreed on. New actions can be
  // added without touching every component.
  const matrix = {
    owner:   true, // owner gets everything by default
    admin:   new Set([
      'view', 'claim.approve', 'claim.hide_image',
      'reward.edit', 'reward.publish',
      'cupqr.generate', 'customer.adjust', 'export',
      'team.invite', 'team.role', 'team.password', 'team.block',
      'org.edit', 'audit.read', 'settings.maintenance',
    ]),
    manager: new Set([
      'view', 'claim.approve', 'reward.edit', 'reward.publish',
      'cupqr.generate', 'export',
    ]),
    checker: new Set(['view', 'export']),
  };
  const allowed = matrix[role];
  if (allowed === true) return true;
  if (!allowed) return false;
  return allowed.has(action);
}
