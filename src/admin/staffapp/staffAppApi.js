import { supabase } from '../../lib/supabase';

/* The Staff app page talks to the `staff-app` edge function, which checks
 * the signed-in account can see this venue and what its role allows on the
 * Staff app tab (view: look and approve requests; edit: everything). */

const MESSAGES = {
  app_off: 'Switch the staff app on for this venue first.',
  insufficient_role: 'Your role can view this page but not change it.',
  rate_limited: 'Too many invitations this hour. Try again later.',
  too_many: 'Add at most 20 emails at a time.',
  no_emails: 'Add at least one email address.',
  not_requested: 'That request was already handled. The list is up to date now.',
  not_found: 'That person is no longer on the list.',
  email_failed: 'The email could not be sent. Try again in a minute.',
};

export async function staffAdmin(action, orgId, body = {}) {
  const { data, error } = await supabase.functions.invoke('staff-app', {
    body: { action, org_id: orgId, ...body },
  });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { /* not json */ }
    const code = payload?.error;
    const err = new Error(MESSAGES[code] || payload?.detail || 'Something went wrong. Try again.');
    err.code = code;
    throw err;
  }
  return data;
}

export const RESULT_TEXT = {
  invited: 'added and emailed',
  reminded: 'emailed again',
  approved: 'had asked already, so they are approved now',
  approved_email_failed: 'approved, but the email could not be sent',
  already_active: 'already has an account',
  other_venue: 'is staff at another venue',
  blocked: 'is paused, resume them instead',
  invalid_email: 'is not a valid email address',
  added_email_failed: 'added, but the email could not be sent',
  email_failed: 'the email could not be sent',
  failed: 'could not be added',
};

export const STAFF_APP_URL = 'https://perks.packback.network/staff';
