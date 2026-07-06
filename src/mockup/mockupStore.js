/* ─────────────────────────────────────────────────────────────────────
 * mockupStore — the shared team library, backed by the `mockups` table.
 *
 * The tool is opened in a new tab from the logged-in admin, so it shares
 * the admin's Supabase auth session via per-origin localStorage. RLS on
 * `mockups` requires an authenticated user, so every call is gated on a
 * live session; when there is none, the UI shows a sign-in notice and the
 * (local) editor still works — only the shared library is unavailable.
 * ───────────────────────────────────────────────────────────────────── */

import { supabase } from '../lib/supabase';

/** Resolve the current auth session (null when the tab isn't signed in). */
export async function getSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
  } catch {
    return null;
  }
}

const COLS = 'id, name, config, thumb, created_at, updated_at';

/** All saved mockups, newest first. */
export async function listMockups() {
  const { data, error } = await supabase
    .from('mockups')
    .select(COLS)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Insert a new mockup; returns the created row. */
export async function createMockup(name, config, thumb) {
  const { data, error } = await supabase
    .from('mockups')
    .insert({ name: (name || 'Untitled mockup').trim(), config, thumb: thumb || null })
    .select(COLS)
    .single();
  if (error) throw error;
  return data;
}

/** Update an existing mockup's name, config and/or thumbnail. */
export async function updateMockup(id, { name, config, thumb }) {
  const patch = { updated_at: new Date().toISOString() };
  if (name != null) patch.name = name.trim();
  if (config != null) patch.config = config;
  if (thumb !== undefined) patch.thumb = thumb;
  const { data, error } = await supabase
    .from('mockups')
    .update(patch)
    .eq('id', id)
    .select(COLS)
    .single();
  if (error) throw error;
  return data;
}

/** Permanently remove a mockup. */
export async function deleteMockup(id) {
  const { error } = await supabase.from('mockups').delete().eq('id', id);
  if (error) throw error;
}
