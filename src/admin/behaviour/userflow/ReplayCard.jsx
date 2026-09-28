import { useRef } from 'react';
import {
  Monitor, Play, Smartphone, Tablet, Video, VideoOff, Zap,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState } from '../../ui';
import { fmtInt } from '../../ui/timeSeries';
import { fmtDuration } from '../../lib/behaviourFormat';
import ReplayPlayer from './ReplayPlayer';
import useFitHeight from './useFitHeight';

/* ─────────────────────────────────────────────────────────────────────
 * Session replay: the visits on the left, the one picked played back on
 * the right (ReplayPlayer).
 *
 * A visit captured while the venue had replay on carries an rrweb
 * recording of the customer's own screen, masked (see uxCapture.js); one
 * from before recordings existed is stepped through over the venue's app
 * as it is today. Either way every tap is drawn and named, and the list of
 * what happened runs beside it.
 *
 * It only lists visits captured while the venue had replay switched on
 * (`ux_sessions.replay`, written by ux-ingest from the venue's own
 * setting), so turning it off hides everything it was off for rather
 * than quietly keeping it.
 * ───────────────────────────────────────────────────────────────────── */

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

function when(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function ReplayCard({
  sessions = [], replayOn, loading, phrase, selected, onSelect, replay, replayLoading, recording = null,
  onOpenSettings, slug,
}) {
  const fit = useRef(null);
  useFitHeight(fit);

  if (!replayOn) {
    return (
      <Card className="uf-replay">
        <CardHeader title="Session replay" icon={VideoOff} subtitle="Off for this venue" />
        <CardBody>
          <EmptyState
            icon={VideoOff}
            title="Replay is switched off for this venue"
            action={onOpenSettings && <Button variant="outline" onClick={onOpenSettings}>Open Capture settings</Button>}
          >
            Someone turned it off in Capture settings. Nothing is kept for replay while it is off, and
            visits captured during that time stay unlistable even after it is turned back on — so this
            shows the gap honestly rather than quietly filling it in.
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="uf-replay">
      <CardHeader
        title="Session replay"
        icon={Video}
        subtitle={`Visits captured ${phrase}. Pick one to watch it, with every tap marked and named.`}
        actions={<Badge tone="violet">{fmtInt(sessions.length)} visits</Badge>}
      />
      <CardBody flush>
        <div className="uf-replay__body" ref={fit}>
          <div className="uf-replay__list" role="list">
            {loading && <div className="uf-replay__skel" aria-busy="true" />}
            {!loading && !sessions.length && (
              <p className="uf-replay__empty">No visit was captured for replay {phrase}.</p>
            )}
            {sessions.map((s) => {
              const Icon = DEVICE_ICON[s.device] || Smartphone;
              return (
                <button
                  key={s.session_id}
                  type="button"
                  role="listitem"
                  className={`uf-visit${s.session_id === selected ? ' uf-visit--on' : ''}`}
                  onClick={() => onSelect(s.session_id)}
                >
                  <span className="uf-visit__icon"><Icon size={14} aria-hidden="true" /></span>
                  <span className="uf-visit__main">
                    <strong>{when(s.started_at)}</strong>
                    <em>
                      {fmtDuration(Number(s.duration_ms) || 0) || '0 sec'} · {fmtInt(s.screens)} screens · {fmtInt(s.clicks)} taps
                    </em>
                  </span>
                  {Number(s.rage) > 0 && (
                    <span className="uf-visit__rage" title="Rage taps in this visit">
                      <Zap size={12} aria-hidden="true" />{fmtInt(s.rage)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="uf-replay__stage">
            {!selected ? (
              <EmptyState icon={Play} title="Pick a visit">
                Choose one on the left to watch it: the screens they opened, how far they scrolled and
                every tap, with the name of what they pressed.
              </EmptyState>
            ) : replayLoading || recording === null ? (
              /* The steps and the recording arrive separately; the player
                 waits for both, or it would start stepping through the
                 visit and then swap to the recording under the viewer. */
              <div className="uf-replay__loading" aria-busy="true">Loading the visit…</div>
            ) : !(replay?.events?.length) && !(Array.isArray(recording) && recording.length > 1) ? (
              <EmptyState icon={Play} title="Nothing to play">
                This visit has no steps left — it may have fallen outside the venue’s retention window.
              </EmptyState>
            ) : (
              <ReplayPlayer
                key={selected}
                replay={replay}
                recording={recording}
                slug={slug}
                device={replay?.session?.device || 'mobile'}
              />
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
