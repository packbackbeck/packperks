import { useMemo, useState } from 'react';
import { DoorOpen, Route } from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState, Segmented } from '../../ui';
import { fmtInt } from '../../ui/timeSeries';
import { screenName } from '../behaviourCopy';
import { fmtRate } from '../behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * The flow: which screen follows which.
 *
 * Read from consecutive screen views inside one visit, so it is the path
 * people actually took, not the path the navigation allows. `(entry)` is
 * the screen a visit opened on.
 *
 * Two ways to read it, because there are two questions:
 *   Onwards — I am on this screen; where do people go next?
 *   Back    — people reached this screen; where did they come from?
 *
 * The bar under each row is that step's share of the screen's traffic,
 * and the exit row is the share who went nowhere: the visit ended there.
 * ───────────────────────────────────────────────────────────────────── */

const DIRECTIONS = [
  { id: 'out', label: 'Onwards' },
  { id: 'in', label: 'Back' },
];

export default function FlowCard({ flow = [], screens = [], screen, onScreen, loading, phrase }) {
  const [dir, setDir] = useState('out');

  const byScreen = useMemo(() => Object.fromEntries(screens.map(s => [s.screen, s])), [screens]);

  const entries = useMemo(
    () => flow.filter(f => f.from_screen === '(entry)').sort((a, b) => Number(b.n) - Number(a.n)),
    [flow],
  );
  const entryTotal = entries.reduce((s, f) => s + Number(f.n || 0), 0);

  const steps = useMemo(() => {
    if (!screen) return [];
    const rows = dir === 'out'
      ? flow.filter(f => f.from_screen === screen)
      : flow.filter(f => f.to_screen === screen);
    return rows
      .map(f => ({ screen: dir === 'out' ? f.to_screen : f.from_screen, n: Number(f.n) || 0 }))
      .sort((a, b) => b.n - a.n);
  }, [flow, screen, dir]);

  const row = screen ? byScreen[screen] : null;
  const onward = steps.reduce((s, x) => s + x.n, 0);
  const exits = dir === 'out' && row ? Math.max(0, Number(row.exits || 0)) : 0;
  const total = onward + exits;

  return (
    <Card className="uf-flow">
      <CardHeader
        title="Where customers go next"
        icon={Route}
        subtitle={screen
          ? `${screenName(screen)} · the path visits took ${phrase}`
          : `Pick a screen above to follow the path from it ${phrase}`}
        actions={<Segmented options={DIRECTIONS} value={dir} onChange={setDir} ariaLabel="Flow direction" />}
      />
      <CardBody>
        {loading ? (
          <div className="uf-flow__skeleton" aria-busy="true">
            {[0, 1, 2].map(i => <div key={i} className="uf-flow__skelrow" />)}
          </div>
        ) : !flow.length ? (
          <EmptyState icon={Route} title="No path recorded yet">
            A path needs a visit that opened more than one screen.
          </EmptyState>
        ) : (
          <div className="uf-flow__body">
            <div className="uf-flow__col">
              <h3 className="uf-flow__title">Visits start on</h3>
              {entries.slice(0, 6).map((f) => {
                const share = entryTotal > 0 ? (Number(f.n) / entryTotal) * 100 : 0;
                return (
                  <button
                    key={f.to_screen}
                    type="button"
                    className={`uf-step${f.to_screen === screen ? ' uf-step--on' : ''}`}
                    onClick={() => onScreen?.(f.to_screen)}
                  >
                    <span className="uf-step__fill" style={{ width: `${share}%` }} />
                    <span className="uf-step__name">{screenName(f.to_screen)}</span>
                    <span className="uf-step__n">{fmtInt(f.n)} <em>{fmtRate(share)}</em></span>
                  </button>
                );
              })}
            </div>

            <div className="uf-flow__col">
              <h3 className="uf-flow__title">
                {dir === 'out' ? 'Then they open' : 'They arrived from'}
              </h3>
              {!screen ? (
                <p className="uf-flow__hint">Pick a screen to follow it.</p>
              ) : !steps.length && !exits ? (
                <p className="uf-flow__hint">Nothing followed this screen {phrase}.</p>
              ) : (
                <>
                  {steps.slice(0, 7).map((s) => {
                    const share = total > 0 ? (s.n / total) * 100 : 0;
                    return (
                      <button
                        key={s.screen}
                        type="button"
                        className="uf-step"
                        onClick={() => onScreen?.(s.screen)}
                      >
                        <span className="uf-step__fill" style={{ width: `${share}%` }} />
                        <span className="uf-step__name">{screenName(s.screen)}</span>
                        <span className="uf-step__n">{fmtInt(s.n)} <em>{fmtRate(share)}</em></span>
                      </button>
                    );
                  })}
                  {dir === 'out' && exits > 0 && (
                    <div className="uf-step uf-step--exit">
                      <span className="uf-step__fill" style={{ width: `${total > 0 ? (exits / total) * 100 : 0}%` }} />
                      <span className="uf-step__name"><DoorOpen size={13} aria-hidden="true" /> The visit ended</span>
                      <span className="uf-step__n">{fmtInt(exits)} <em>{fmtRate(total > 0 ? (exits / total) * 100 : 0)}</em></span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
