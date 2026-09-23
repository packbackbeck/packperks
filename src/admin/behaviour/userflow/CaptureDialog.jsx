import { useMemo, useState } from 'react';
import {
  AlertTriangle, Eye, Flame, MoveVertical, ShieldCheck, SlidersHorizontal, Trash2, Video,
} from 'lucide-react';
import { Badge, Button, Field, Modal, Switch } from '../../ui';
import { fmtInt } from '../../ui/timeSeries';

/* ─────────────────────────────────────────────────────────────────────
 * Capture settings.
 *
 * One venue's answer to "what may this app record?". It is written to
 * `ux:capture:<orgId>` — its own app_config row, so publishing the design
 * draft can never wipe it — and the ux-ingest edge function reads the
 * same row before it stores anything. So these are not UI preferences:
 * a switch off here stops the data at the server, not at the chart.
 *
 * Two changes are consequential enough to confirm in words rather than
 * with a switch that silently flips:
 *   • Turning replay on, which is a new promise to the customer.
 *   • Shortening retention, which deletes on the next nightly run.
 * Everything else saves on Save, and the dialog says plainly what is
 * already true: nothing is captured without the Analytical cookie.
 * ───────────────────────────────────────────────────────────────────── */

const SAMPLES = [100, 50, 25, 10, 5];
const RETENTIONS = [14, 30, 60, 90, 180, 365];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function CaptureDialog({ config, onSave, onClose, canEdit, stats }) {
  const [draft, setDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);

  // The dialog opens on whatever the venue has now; a reload underneath it
  // restarts the draft rather than editing a stale one.
  const [from, setFrom] = useState(config);
  if (from !== config) { setFrom(config); setDraft(config); }

  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const dirty = useMemo(() => !same(draft, config), [draft, config]);

  const shortened = Number(draft.retentionDays) < Number(config.retentionDays);
  const replayNew = draft.replay && !config.replay;

  async function save() {
    // The two changes worth a sentence, asked once, before anything moves.
    if (!confirm && (replayNew || shortened)) {
      setConfirm(replayNew ? 'replay' : 'retention');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setError(e?.message || 'That did not save.');
      setBusy(false);
      setConfirm(null);
    }
  }

  if (confirm === 'replay') {
    return (
      <Modal
        open
        onClose={() => setConfirm(null)}
        title="Turn session replay on?"
        subtitle="This changes what the venue keeps about one customer, not just the totals."
        icon={Video}
        iconTone="amber"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Back</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Turn replay on'}</Button>
          </>
        )}
      >
        <p className="uf-dlg__p">
          Heatmaps are sums: thousands of taps with nobody in them. A replay is one visit, watched back
          step by step. It is still reconstructed — the page is never recorded, so nothing typed or shown
          on screen exists to play — but it is one person’s path, and that is a different promise.
        </p>
        <p className="uf-dlg__p">
          Only visits captured from now on can be replayed. Make sure the venue’s privacy policy covers it
          before you switch it on.
        </p>
      </Modal>
    );
  }

  if (confirm === 'retention') {
    return (
      <Modal
        open
        onClose={() => setConfirm(null)}
        title="Shorten how long taps are kept?"
        subtitle={`From ${config.retentionDays} days to ${draft.retentionDays}.`}
        icon={Trash2}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Back</Button>
            <Button variant="danger" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Shorten and delete'}</Button>
          </>
        )}
      >
        <p className="uf-dlg__p">
          Anything older than {draft.retentionDays} days is deleted on the next nightly run and cannot be
          recovered. Heatmaps and replays for those days go with it; the tiles on the main tab, which come
          from a different table, are untouched.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Capture settings"
      subtitle="What this venue’s app may record, and for how long."
      icon={SlidersHorizontal}
      wide
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!canEdit || !dirty || busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      )}
    >
      {error && (
        <p className="uf-dlg__error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" /> {error}
        </p>
      )}

      <div className="uf-dlg__consent">
        <span className="uf-dlg__consenticon"><ShieldCheck size={16} aria-hidden="true" /></span>
        <div>
          <p className="uf-dlg__consenttitle">Only customers who accepted analytics are ever captured</p>
          <p className="uf-dlg__consentsub">
            Nothing below overrides that. A customer on essential-only cookies is invisible here, whatever
            these switches say, and no text they typed or field they filled is recorded in any case.
          </p>
        </div>
      </div>

      <div className="uf-dlg__rows">
        <label className="uf-dlg__row">
          <span className="uf-dlg__rowicon ui-tone--violet"><Eye size={15} aria-hidden="true" /></span>
          <span className="uf-dlg__rowtext">
            <strong>Capture</strong>
            <em>The master switch. Off means the app records nothing new for this venue.</em>
          </span>
          <Switch checked={!!draft.enabled} onChange={v => set({ enabled: v })} disabled={!canEdit} label="Capture" />
        </label>

        <label className={`uf-dlg__row${draft.enabled ? '' : ' uf-dlg__row--off'}`}>
          <span className="uf-dlg__rowicon ui-tone--amber"><Flame size={15} aria-hidden="true" /></span>
          <span className="uf-dlg__rowtext">
            <strong>Taps</strong>
            <em>Where a thumb lands, and the name of the control under it. The heatmap and the button table.</em>
          </span>
          <Switch checked={!!draft.clicks} onChange={v => set({ clicks: v })} disabled={!canEdit || !draft.enabled} label="Taps" />
        </label>

        <label className={`uf-dlg__row${draft.enabled ? '' : ' uf-dlg__row--off'}`}>
          <span className="uf-dlg__rowicon ui-tone--teal"><MoveVertical size={15} aria-hidden="true" /></span>
          <span className="uf-dlg__rowtext">
            <strong>Scrolling</strong>
            <em>How far down a screen each visit got. Scroll reach and the scroll view of the heatmap.</em>
          </span>
          <Switch checked={!!draft.scroll} onChange={v => set({ scroll: v })} disabled={!canEdit || !draft.enabled} label="Scrolling" />
        </label>

        <label className={`uf-dlg__row${draft.enabled ? '' : ' uf-dlg__row--off'}`}>
          <span className="uf-dlg__rowicon ui-tone--slate"><SlidersHorizontal size={15} aria-hidden="true" /></span>
          <span className="uf-dlg__rowtext">
            <strong>Screen layouts</strong>
            <em>Where the controls sat, as fractions of the page — the wireframe the heat is drawn on. Never a screenshot.</em>
          </span>
          <Switch checked={!!draft.layouts} onChange={v => set({ layouts: v })} disabled={!canEdit || !draft.enabled} label="Screen layouts" />
        </label>

        <label className={`uf-dlg__row${draft.enabled ? '' : ' uf-dlg__row--off'}`}>
          <span className="uf-dlg__rowicon ui-tone--rose"><Video size={15} aria-hidden="true" /></span>
          <span className="uf-dlg__rowtext">
            <strong>Session replay</strong>
            <em>Keep visits so one can be watched back step by step. Off by default: a replay is one person’s path, not a total.</em>
          </span>
          <Switch checked={!!draft.replay} onChange={v => set({ replay: v })} disabled={!canEdit || !draft.enabled} label="Session replay" />
        </label>
      </div>

      <div className="uf-dlg__grid">
        <Field
          label="How many visits"
          hint="Sampling keeps a busy venue’s table small. Rates and averages hold; counts are that share of the real thing."
        >
          <div className="uf-dlg__chips">
            {SAMPLES.map(s => (
              <button
                key={s}
                type="button"
                className={`uf-chip${Number(draft.sample) === s ? ' uf-chip--on' : ''}`}
                onClick={() => canEdit && set({ sample: s })}
                disabled={!canEdit || !draft.enabled}
              >
                {s === 100 ? 'Every visit' : `${s}%`}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Keep taps for"
          hint="Tap-level data is the shortest-lived thing PackPerks holds. Deleted on the nightly run once it is older than this."
        >
          <div className="uf-dlg__chips">
            {RETENTIONS.map(d => (
              <button
                key={d}
                type="button"
                className={`uf-chip${Number(draft.retentionDays) === d ? ' uf-chip--on' : ''}`}
                onClick={() => canEdit && set({ retentionDays: d })}
                disabled={!canEdit}
              >
                {d < 30 ? `${d} days` : d === 365 ? '1 year' : `${Math.round(d / 30)} months`}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {stats && (
        <p className="uf-dlg__stats">
          <Badge tone={draft.enabled ? 'emerald' : 'slate'}>{draft.enabled ? 'Capturing' : 'Paused'}</Badge>
          {fmtInt(stats.sessions)} visits and {fmtInt(stats.taps)} taps are held for this venue right now.
        </p>
      )}

      {!canEdit && (
        <p className="uf-dlg__readonly">
          Your role can see these settings but not change them.
        </p>
      )}
    </Modal>
  );
}
