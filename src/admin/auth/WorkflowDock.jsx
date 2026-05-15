import { useMemo, useState } from 'react';
import './WorkflowDock.css';

/* ─────────────────────────────────────────────────────────────────────
 * WorkflowDock — top-right command cluster, Framer-style.
 *
 * A static row of icon buttons that mirrors the structure Framer uses
 * in the top-right of its editor (Settings · Help · Version · Preview ·
 * Publish). No expand/collapse animation — that previous design jostled
 * the search bar every time the cursor brushed past, which was
 * distracting.
 *
 *   • Settings        — gear icon, navigates to the Settings page.
 *   • Support         — question-mark icon, opens the help center
 *                       (external link).
 *   • Version history — clock-arrow icon, navigates to History page.
 *   • Preview         — labelled button, opens the live user app in a
 *                       new tab.
 *   • Publish         — the only highlighted button. Always available
 *                       (changes auto-save now, so Save is gone).
 *
 * Auto-save means there is no explicit Save button or contextual primary
 * cycling through unsaved → saved → published states. The Publish
 * button is always live and pushes the current draft to the user app. */
export default function WorkflowDock({ draftState, onPreview, onOpenHistory, onOpenSettings, onOpenSupport }) {
  const { publishDraft, isDirty, published, draft } = draftState || {};
  const [publishModal, setPublishModal] = useState(false);
  const [publishNote, setPublishNote] = useState('');

  /* P-34: derive a small diff between the draft and the last-published
   * snapshot so the admin can see exactly what they're pushing live.
   * We compare two surfaces:
   *
   *   1. settings (flat key/value map) — straight key compare with
   *      before/after values for anything that changed.
   *   2. rewards (array of objects keyed by id) — added / removed /
   *      changed entries, with the most user-visible field diffs
   *      listed inline.
   *
   * The diff is computed lazily when the modal opens to avoid doing
   * the work on every render. Limited to a sane top-5 per category so
   * a "I edited 30 nutrition values" doesn't drown the modal. */
  const diff = useMemo(() => {
    if (!publishModal) return null;
    return buildPublishDiff(published, draft);
  }, [publishModal, published, draft]);

  // Subtle pulse on Publish when there are auto-saved-but-not-yet-published
  // changes. We treat `isDirty` (anything edited since the last publish)
  // and "saved-but-never-published" as the same state for this indicator.
  const hasPending = isDirty || (draftState?.lastSaved && !published);

  function handlePublishConfirm() {
    publishDraft?.(publishNote);
    setPublishNote('');
    setPublishModal(false);
  }

  return (
    <>
      <div className="wd" role="toolbar" aria-label="Workflow actions">
        {/* Settings */}
        <button
          type="button"
          className="wd-icon"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>

        {/* Support */}
        <button
          type="button"
          className="wd-icon"
          onClick={onOpenSupport}
          title="Help & support"
          aria-label="Help & support"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>

        {/* Version history */}
        <button
          type="button"
          className="wd-icon"
          onClick={onOpenHistory}
          title="Version history"
          aria-label="Version history"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="12" x2="15" y2="15" />
          </svg>
        </button>

        {/* Preview — labelled */}
        <button
          type="button"
          className="wd-preview"
          onClick={onPreview}
          title="Open the user app in a new tab"
        >
          Preview
        </button>

        {/* Publish — highlighted primary */}
        <button
          type="button"
          className="wd-publish"
          onClick={() => setPublishModal(true)}
        >
          Publish
          {hasPending && <span className="wd-publish__dot" aria-hidden />}
        </button>
      </div>

      {publishModal && (
        <div className="admin-publish-overlay" onClick={() => setPublishModal(false)}>
          <div className="admin-publish-modal admin-publish-modal--wide" onClick={e => e.stopPropagation()}>
            <div className="admin-publish-modal__header">
              <div className="admin-publish-modal__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 2 11 13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
              <div>
                <h3 className="admin-publish-modal__title">Publish to live</h3>
                <p className="admin-publish-modal__sub">This pushes all changes to the user-facing app immediately.</p>
              </div>
            </div>

            {/* P-34: diff preview so the admin can see what's about to
             *  go live. If nothing changed we still show a benign
             *  "nothing to publish" hint instead of hiding the block,
             *  because the visual placement teaches admins where to
             *  look on future publishes. */}
            <div className="wd-diff">
              <div className="wd-diff__title">Changes since last publish</div>
              {diff && (diff.settings.length + diff.rewards.length === 0) ? (
                <div className="wd-diff__empty">
                  No changes detected. Publishing now will re-stamp the live config without touching any values.
                </div>
              ) : diff ? (
                <ul className="wd-diff__list">
                  {diff.settings.slice(0, 6).map((d, i) => (
                    <li key={'s' + i} className="wd-diff__row">
                      <span className="wd-diff__kind wd-diff__kind--settings">setting</span>
                      <span className="wd-diff__label">{d.label}</span>
                      <span className="wd-diff__values">
                        <span className="wd-diff__from">{formatDiffValue(d.before)}</span>
                        <span className="wd-diff__arrow">→</span>
                        <span className="wd-diff__to">{formatDiffValue(d.after)}</span>
                      </span>
                    </li>
                  ))}
                  {diff.rewards.slice(0, 5).map((d, i) => (
                    <li key={'r' + i} className="wd-diff__row">
                      <span className={`wd-diff__kind wd-diff__kind--${d.kind}`}>{d.kind}</span>
                      <span className="wd-diff__label">{d.name}</span>
                      <span className="wd-diff__values">
                        {d.detail && <span className="wd-diff__detail">{d.detail}</span>}
                      </span>
                    </li>
                  ))}
                  {diff.settings.length + diff.rewards.length > 11 && (
                    <li className="wd-diff__more">
                      + {diff.settings.length + diff.rewards.length - 11} more change{diff.settings.length + diff.rewards.length - 11 === 1 ? '' : 's'}
                    </li>
                  )}
                </ul>
              ) : null}
            </div>

            <label className="admin-publish-modal__label">Change summary (optional)</label>
            <input
              className="admin-publish-modal__input"
              placeholder="e.g. Added new reward, updated cashback rate…"
              value={publishNote}
              onChange={e => setPublishNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePublishConfirm()}
              autoFocus
            />
            <div className="admin-publish-modal__actions">
              <button className="admin-publish-modal__cancel" onClick={() => setPublishModal(false)}>
                Cancel
              </button>
              <button className="admin-publish-modal__confirm" onClick={handlePublishConfirm}>
                Publish now →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Publish-diff helpers (P-34).
 *
 * The published snapshot is { rewards, settings, _publishedAt }. Draft
 * matches that shape. We diff the two and emit a flat list of changes
 * an admin can scan in one breath.
 *
 *   buildPublishDiff(published, draft) →
 *     {
 *       settings: [{ key, label, before, after }, ...],
 *       rewards:  [{ kind: 'added'|'removed'|'changed', name, detail }, ...]
 *     }
 *
 * If published is null (no prior version), every reward + every setting
 * that differs from defaults counts as added/changed. That's fine for
 * the first-ever publish — the modal still tells a complete story. */

const SETTINGS_LABELS = {
  cashbackRatePerCup:    'Cashback rate',
  refundRatePerCup:      'Direct refund rate',
  heroHeadline:          'Hero headline',
  heroSubtext:           'Hero subtext',
  donationRecipient:     'Donation recipient',
  donationDescription:   'Donation description',
  minIbanLength:         'Min IBAN length',
  maxCupsPerScan:        'Cups per scan',
  maxCupsToShare:        'Max cups per share',
  featureCupSharing:     'Cup sharing feature',
  featureDonations:      'Donations feature',
  featureDirectRefunds:  'Direct refunds feature',
  maintenanceMode:       'Maintenance mode',
  privacyUrl:            'Privacy URL',
  termsUrl:              'Terms URL',
  cookieUrl:             'Cookie URL',
};

const REWARD_DIFF_FIELDS = [
  { key: 'name',        label: 'name' },
  { key: 'euros',       label: 'price' },
  { key: 'cupsNeeded',  label: 'cups needed' },
  { key: 'subsidy',     label: 'subsidy' },
  { key: 'status',      label: 'status' },
  { key: 'featured',    label: 'featured' },
];

function buildPublishDiff(published, draft) {
  const out = { settings: [], rewards: [] };
  if (!draft) return out;
  const pubSettings = published?.settings || {};
  const pubRewards = published?.rewards || [];
  const draftSettings = draft.settings || {};
  const draftRewards = draft.rewards || [];

  // Settings diff
  const keys = new Set([...Object.keys(pubSettings), ...Object.keys(draftSettings)]);
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(SETTINGS_LABELS, k)) continue;
    const before = pubSettings[k];
    const after = draftSettings[k];
    // JSON-compare to keep nested arrays/objects honest (no nested
    // ones today but cheap insurance). Skip strict-equal primitives.
    if (before === after) continue;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    out.settings.push({ key: k, label: SETTINGS_LABELS[k], before, after });
  }

  // Rewards diff — keyed by id
  const pubMap = new Map(pubRewards.map(r => [r.id, r]));
  const draftMap = new Map(draftRewards.map(r => [r.id, r]));
  for (const [id, dRwd] of draftMap) {
    const pRwd = pubMap.get(id);
    if (!pRwd) {
      out.rewards.push({ kind: 'added', name: dRwd.name || id });
      continue;
    }
    const changed = REWARD_DIFF_FIELDS
      .filter(f => JSON.stringify(pRwd[f.key]) !== JSON.stringify(dRwd[f.key]))
      .map(f => `${f.label}: ${formatDiffValue(pRwd[f.key])} → ${formatDiffValue(dRwd[f.key])}`);
    if (changed.length > 0) {
      out.rewards.push({ kind: 'changed', name: dRwd.name || id, detail: changed.join(' · ') });
    }
  }
  for (const [id, pRwd] of pubMap) {
    if (!draftMap.has(id)) {
      out.rewards.push({ kind: 'removed', name: pRwd.name || id });
    }
  }
  return out;
}

function formatDiffValue(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return s.length > 36 ? s.slice(0, 33) + '…' : s;
}
