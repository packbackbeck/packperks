import { useMemo, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { resolveEffectiveMode } from '../lib/orgModes';
import { WAYS_IN, WAY_BY_KEY, deriveFlow, flowIssues, isByo } from '../lib/flowModes';
import { setOrgGroupMembership, setOrgMode } from '../lib/adminApi';
import { staffAdmin } from '../staffapp/staffAppApi';
import { logAction } from '../auth/actionLog';

/* ─────────────────────────────────────────────────────────────────────
 * The open venue's ways in and out (lib/flowModes.js), and what each
 * switch does when it is flipped.
 *
 * Most ways are draft settings and go live with Publish. Two are not:
 *   Staff App        organizations.staff_app_enabled, through the same
 *                    staff-app call the Staff App page uses: at once.
 *   Deferred Refund  changes which customer app the venue runs (the wallet
 *                    or the rewards), so it is a master's switch, made at
 *                    once after a typed confirm, like the old programme
 *                    switch it replaces.
 * ───────────────────────────────────────────────────────────────────── */

const BIN_ORDER = WAYS_IN.filter(w => w.family === 'smartbin').map(w => w.key);

export function useVenueFlow(settings) {
  const org = useOrg();
  const appMode = resolveEffectiveMode(org.activeOrgMode, org.activeGroupMode);
  const staff = !!org.activeOrg?.staff_app_enabled;
  const groupPayment = org.activeGroupSettings?.paymentMethod || null;
  return useMemo(() => {
    const flow = deriveFlow({ settings, appMode, staffAppEnabled: staff, groupPayment });
    return { flow, appMode, issues: flowIssues(flow), byo: isByo(flow) };
  }, [settings, appMode, staff, groupPayment]);
}

/* draftState: the dashboard's draft. notify(label, direct): an optional
 * toast after a change (direct = saved at once rather than to the draft). */
export function useFlowActions({ draftState, flow, appMode, notify }) {
  const org = useOrg();
  const orgId = org.activeOrgId;
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  function patch(next, label) {
    draftState?.updateDraft?.(d => ({ ...d, settings: { ...d.settings, ...next } }));
    notify?.(label, false);
  }

  async function toggle(key, on) {
    setError(null);
    const way = WAY_BY_KEY[key];
    if (!way) return;
    if (BIN_ORDER.includes(key)) {
      const now = BIN_ORDER.filter(k => flow.ins.has(k));
      const nextBin = on ? [...now, key] : now.filter(k => k !== key);
      patch({ binWaysIn: BIN_ORDER.filter(k => nextBin.includes(k)) }, way.label);
      return;
    }
    if (key === 'static_qr') { patch({ featureStaticQr: on }, way.label); return; }
    if (key === 'donation') { patch({ featureDonations: on }, way.label); return; }
    if (key === 'direct_refund') { patch({ featureDirectRefunds: on }, way.label); return; }
    if (key === 'reward_voucher' && on) { patch({ paymentMethod: 'voucher' }, way.label); return; }
    if (key === 'reward_cashback' && on) { patch({ paymentMethod: 'tikkie' }, way.label); return; }
    if (key === 'staff_app') {
      setBusy(key);
      try {
        await staffAdmin('admin_toggle', orgId, { enabled: on });
        await org.refresh?.(orgId);
        notify?.(`Staff App ${on ? 'on' : 'off'}`, true);
      } catch (e) {
        setError(e?.message || 'Could not change the Staff App.');
      } finally {
        setBusy(null);
      }
    }
  }

  /* A master switching the venue's customer app: to the wallet (Deferred
   * Refund) or back to the rewards (Voucher or Cashback). */
  async function switchApp(key) {
    setError(null);
    setBusy(key);
    try {
      if (key === 'deferred_refund') {
        // The wallet app has no group to belong to: no market page, no
        // shared profile.
        if (org.activeGroupId) await setOrgGroupMembership(orgId, null);
        await setOrgMode(orgId, 'tikkie_only');
        draftState?.updateDraft?.(d => ({ ...d, settings: { ...d.settings, mode: 'tikkie_only' } }));
      } else {
        await setOrgMode(orgId, null);
        draftState?.updateDraft?.(d => {
          const settings = { ...d.settings, paymentMethod: key === 'reward_voucher' ? 'voucher' : 'tikkie' };
          delete settings.mode;
          return { ...d, settings };
        });
      }
      logAction({
        action: 'org.mode', targetType: 'organization', targetId: orgId,
        before: { mode: appMode }, after: { mode: key === 'deferred_refund' ? 'tikkie_only' : 'standard', way: key },
      });
      try { window.dispatchEvent(new Event('pp-org-mode-changed')); } catch { /* ignore */ }
      await org.refresh?.(orgId);
      notify?.(`Switched to ${WAY_BY_KEY[key].label}`, true);
      return true;
    } catch (e) {
      setError(e?.message || 'Could not switch the customer app.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, toggle, switchApp };
}
