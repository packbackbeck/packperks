import { useMemo, useState } from 'react';
import { Eye, Send } from 'lucide-react';
import { Button, Field, Modal } from '../ui';
import './WorkflowDock.css';

/* ─────────────────────────────────────────────────────────────────────
 * WorkflowDock — the top bar's right-hand buttons: Preview (opens the
 * customer app in a new tab; hidden when the top bar setting is off) and
 * Publish (for people who can change what gets published). Help and
 * version history live in the sidebar.
 *
 * Auto-save means there is no explicit Save button or contextual primary
 * cycling through unsaved → saved → published states. The Publish
 * button is always live and pushes the current draft to the user app. */
export default function WorkflowDock({ draftState, onPreview, canPublish = true }) {
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
        {onPreview && (
          <button type="button" className="wd-preview" onClick={onPreview} title="Open the customer app in a new tab">
            <Eye size={15} aria-hidden="true" />
            Preview
          </button>
        )}
        {canPublish && (
          <button type="button" className="wd-publish" onClick={() => setPublishModal(true)}>
            <Send size={14} aria-hidden="true" />
            Publish
            {hasPending && <span className="wd-publish__dot" title="Changes waiting to be published" />}
          </button>
        )}
      </div>

      {/* The dialog renders at the root of the dashboard (Modal portals
       *  it): the top bar's blur would otherwise trap it inside the bar. */}
      <Modal
        open={publishModal}
        onClose={() => setPublishModal(false)}
        title="Publish to live"
        subtitle="Puts every draft change live in the customer app straight away."
        icon={Send}
        wide
        footer={(
          <>
            <Button onClick={() => setPublishModal(false)}>Cancel</Button>
            <Button variant="primary" icon={Send} onClick={handlePublishConfirm}>Publish now</Button>
          </>
        )}
      >
        {/* P-34: what is about to go live. With nothing changed the block
         *  still shows, so admins learn where to look next time. */}
        <div className="wd-diff">
          <div className="wd-diff__title">Changes since the last publish</div>
          {diff && (diff.settings.length + diff.rewards.length === 0) ? (
            <div className="wd-diff__empty">
              Nothing has changed. Publishing again re-stamps the live version without changing any values.
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

        <Field label="Change summary (optional)" htmlFor="wd-publish-note">
          <input
            id="wd-publish-note"
            className="ui-input"
            placeholder="e.g. Added a new reward, changed the cashback rate"
            value={publishNote}
            onChange={e => setPublishNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePublishConfirm()}
            autoFocus
          />
        </Field>
      </Modal>
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
  maxCupsPerScan:        'Cups per scan',
  maxCupsToShare:        'Max cups per share',
  featureCupSharing:     'Cup sharing feature',
  featureDonations:      'Donations feature',
  featureDirectRefunds:  'Direct refunds feature',
  maintenanceMode:       'Maintenance mode',
  privacyUrl:            'Privacy URL',
  termsUrl:              'Terms URL',
  cookieUrl:             'Cookie URL',
  privacyPolicyText:     'Privacy policy',
  paymentMethod:         'Payment method',
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
