import { supabase } from '../../lib/supabase';
import { logAction } from '../auth/actionLog';
import { TABS } from '../lib/access';

/* ─────────────────────────────────────────────────────────────────────
 * Master Settings data: people (accounts and pending invitations) and
 * helpers for roles. Only masters can write any of this; the database
 * enforces it (migration 048).
 * ───────────────────────────────────────────────────────────────────── */

const PROFILE_COLUMNS = 'id, email, display_name, avatar_url, color, role, access_role, org_ids, all_orgs, org_id, status, last_login_at, created_at, invited_by';
const INVITE_COLUMNS = 'id, email, role, access_role, org_ids, all_orgs, org_id, status, method, token, invited_at, expires_at, invited_by, single_use';

/* Old role names map onto these when an account has no role yet. */
const LEGACY_ROLE_KEY = { owner: 'master', admin: 'master', manager: 'manager', checker: 'viewer', vendor: 'vendor' };

function normalizeAccess(row) {
  const roleKey = row.access_role || LEGACY_ROLE_KEY[row.role] || 'manager';
  const orgIds = Array.isArray(row.org_ids) && row.org_ids.length ? row.org_ids : (row.org_id ? [row.org_id] : []);
  const legacyGlobal = !row.access_role && !row.org_id && row.role !== 'vendor';
  return { roleKey, orgIds, allOrgs: !!row.all_orgs || legacyGlobal };
}

export async function listPeople() {
  const [profiles, invites] = await Promise.all([
    supabase.from('admin_profiles').select(PROFILE_COLUMNS).neq('status', 'deleted').order('created_at'),
    supabase.from('admin_invitations').select(INVITE_COLUMNS).eq('status', 'pending').order('invited_at', { ascending: false }),
  ]);
  if (profiles.error) throw profiles.error;
  const now = Date.now();
  const people = (profiles.data || []).map(p => ({
    kind: 'account',
    key: `a:${p.id}`,
    id: p.id,
    email: p.email,
    name: p.display_name || null,
    avatarUrl: p.avatar_url || null,
    color: p.color || null,
    legacyRole: p.role,
    status: p.status,
    lastActiveAt: p.last_login_at,
    createdAt: p.created_at,
    ...normalizeAccess(p),
  }));
  const pending = (invites.data || [])
    .filter(i => new Date(i.expires_at).getTime() > now)
    .map(i => ({
      kind: 'invite',
      key: `i:${i.id}`,
      id: i.id,
      email: i.method === 'link' && /@invites\.local$/.test(i.email) ? null : i.email,
      name: null,
      method: i.method,
      token: i.token,
      legacyRole: i.role,
      status: 'invited',
      invitedAt: i.invited_at,
      expiresAt: i.expires_at,
      ...normalizeAccess(i),
    }));
  return [...pending, ...people];
}

/* Change what an account can do. The database derives the old role
 * name and org_id from these fields. */
export async function updatePersonAccess(person, { roleKey, orgIds, allOrgs, name }) {
  const table = person.kind === 'invite' ? 'admin_invitations' : 'admin_profiles';
  const patch = { access_role: roleKey, org_ids: allOrgs ? [] : orgIds, all_orgs: !!allOrgs };
  if (person.kind === 'account' && name !== undefined) patch.display_name = name?.trim() || null;
  if (person.kind === 'account') patch.updated_at = new Date().toISOString();
  const { error } = await supabase.from(table).update(patch).eq('id', person.id);
  if (error) throw error;
  logAction({
    action: person.kind === 'invite' ? 'team.invite_access' : 'team.access',
    targetType: person.kind === 'invite' ? 'admin_invitation' : 'admin_profile',
    targetId: person.id,
    before: { access_role: person.roleKey, org_ids: person.orgIds, all_orgs: person.allOrgs },
    after: patch,
    metadata: { target_email: person.email },
  });
}

export async function setPersonStatus(person, status) {
  const { error } = await supabase.from('admin_profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', person.id);
  if (error) throw error;
  const action = status === 'blocked' ? 'team.block' : status === 'deleted' ? 'team.delete' : 'team.unblock';
  logAction({ action, targetType: 'admin_profile', targetId: person.id, metadata: { target_email: person.email } });
}

export async function revokeInvite(person) {
  const { error } = await supabase.from('admin_invitations').update({ status: 'revoked' }).eq('id', person.id);
  if (error) throw error;
  logAction({ action: 'team.invite_revoke', targetType: 'admin_invitation', targetId: person.id, metadata: { email: person.email } });
}

/* Invite someone by email. Sends the new fields and, for an older build of
 * the invite function, the old role name and first organisation too; then
 * writes the exact access onto the invitation. */
export async function invitePerson({ email, role, orgIds, allOrgs }) {
  const isMaster = role.level === 'master';
  const hasEdit = Object.values(role.tabs || {}).includes('edit');
  const legacyRole = isMaster ? 'admin' : role.level === 'vendor' ? 'vendor' : hasEdit ? 'manager' : 'checker';
  const scoped = !isMaster && !allOrgs;
  const body = {
    email: email.trim().toLowerCase(),
    method: 'email',
    access_role: role.key,
    org_ids: scoped ? orgIds : [],
    all_orgs: !scoped,
    role: legacyRole,
  };
  if (scoped && orgIds[0]) body.org_id = orgIds[0];
  const { data, error } = await supabase.functions.invoke('invite-admin', { body });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { /* not json */ }
    throw new Error(payload?.detail || inviteErrorText(payload?.error) || error.message);
  }
  const invitation = data?.invitation;
  if (invitation?.id) {
    await supabase.from('admin_invitations')
      .update({ access_role: role.key, org_ids: scoped ? orgIds : [], all_orgs: !scoped })
      .eq('id', invitation.id);
  }
  return invitation;
}

function inviteErrorText(code) {
  switch (code) {
    case 'insufficient_role': return 'Only a master can add people.';
    case 'already_member': return 'That person already has dashboard access.';
    case 'invalid_email': return 'That email address doesn’t look right.';
    case 'org_required': return 'Pick at least one organisation.';
    case 'rate_limited': return 'Too many invitations this hour. Try again later.';
    case 'email_send_failed': return 'The invitation was saved but the email could not be sent.';
    default: return null;
  }
}

/* ── Roles ─────────────────────────────────────────────────────────── */

export function roleCounts(role) {
  const counts = { edit: 0, view: 0, hidden: 0 };
  for (const t of TABS) {
    if (t.masterOnly) continue;
    const v = role.level === 'master' ? 'edit' : role.tabs?.[t.id] || 'hidden';
    counts[v] += 1;
  }
  return counts;
}

export function slugForRole(label, taken) {
  const base = String(label || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28) || 'role';
  const start = /^[a-z]/.test(base) ? base : `r_${base}`;
  let key = start;
  let n = 2;
  while (taken.has(key)) key = `${start}_${n++}`;
  return key;
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const s = (Date.now() - t) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  if (s < 60) return 'just now';
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 604800) return rtf.format(-Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysUntil(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 86400000));
}

/* ── PackPerks Staff (migration 050) ───────────────────────────────── */

export async function listStaff() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [members, codes] = await Promise.all([
    supabase.from('staff_members')
      .select('id, org_id, email, name, avatar_url, status, auth_user_id, created_at, activated_at, last_seen_at')
      .order('created_at'),
    supabase.from('staff_qr_codes')
      .select('staff_id, cups, cancelled_at')
      .gte('created_at', since),
  ]);
  if (members.error) throw members.error;
  const stats = {};
  for (const c of codes.data || []) {
    if (c.cancelled_at || !c.staff_id) continue;
    const s = (stats[c.staff_id] ||= { codes: 0, cups: 0 });
    s.codes += 1;
    s.cups += c.cups;
  }
  return (members.data || []).map(m => ({ ...m, last30: stats[m.id] || { codes: 0, cups: 0 } }));
}

export async function setOrgStaffApp(org, on) {
  const { error } = await supabase.from('organizations')
    .update({ staff_app_enabled: on, updated_at: new Date().toISOString() })
    .eq('id', org.id);
  if (error) throw error;
  logAction({
    action: on ? 'staff.app_on' : 'staff.app_off',
    targetType: 'organization',
    targetId: org.id,
    metadata: { org_name: org.name },
  });
}

/* Adds people to a venue's staff list and emails them how to sign up. */
export async function inviteStaff(orgId, emails) {
  const { data, error } = await supabase.functions.invoke('staff-app', {
    body: { action: 'admin_invite', org_id: orgId, emails },
  });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { /* not json */ }
    const code = payload?.error;
    throw new Error(
      code === 'app_off' ? 'Switch the staff app on for this venue first.'
        : code === 'insufficient_role' ? 'Only a master can add staff.'
          : code === 'rate_limited' ? 'Too many invitations this hour. Try again later.'
            : code === 'too_many' ? 'Add at most 20 emails at a time.'
              : payload?.detail || error.message,
    );
  }
  return data?.results || [];
}

export async function setStaffStatus(member, status) {
  const { error } = await supabase.from('staff_members')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', member.id);
  if (error) throw error;
  logAction({
    action: status === 'blocked' ? 'staff.pause' : 'staff.resume',
    targetType: 'staff_member',
    targetId: member.id,
    metadata: { email: member.email },
  });
}

export async function removeStaff(member) {
  const { error } = await supabase.from('staff_members').delete().eq('id', member.id);
  if (error) throw error;
  logAction({
    action: 'staff.remove',
    targetType: 'staff_member',
    targetId: member.id,
    before: { email: member.email, org_id: member.org_id, status: member.status },
    metadata: { email: member.email },
  });
}
