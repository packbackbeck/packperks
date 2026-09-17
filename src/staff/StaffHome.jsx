import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CupSoda, History, Package, QrCode, RefreshCw } from 'lucide-react';
import logo from '../assets/images/packperks-logo.svg';
import QrStage from './QrStage';
import CupWheel from './CupWheel';
import CodeSheet from './CodeSheet';
import ProfileSheet from './ProfileSheet';
import Avatar from './Avatar';
import {
  countdown, cupsLabel, dayLabel, errorText, PACKAGE_LABEL, staffCall, STATUS_META, timeLabel,
} from './staffApi';

/* The least time the making animation plays, so a fast answer still reads
 * as something happening. */
const MIN_MAKING_MS = 900;
const POLL_MS = 3000;

const localMidnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/* Tells the code's real state from the clock too, so an expired code
 * reads as expired without waiting for the server. */
function liveStatus(code, now) {
  if (code?.status === 'waiting' && new Date(code.expires_at).getTime() <= now) return { ...code, status: 'expired', url: code.url };
  return code;
}

export default function StaffHome({ me, userId, onMe, onSignOut }) {
  const { venue, limits } = me;
  const [cups, setCups] = useState(1);
  const [pkg, setPkg] = useState(limits.packages[0] || 'cup');
  const [making, setMaking] = useState(false);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState(null);
  const [codes, setCodes] = useState(null);
  const [today, setToday] = useState({ codes: 0, cups: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState(null);
  const [openCode, setOpenCode] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const stageRef = useRef(null);

  const anyWaiting = current?.status === 'waiting' || (codes || []).some(c => c.status === 'waiting');
  const now = useNow(anyWaiting || !!openCode);
  const shown = liveStatus(current, now);
  const remaining = shown ? new Date(shown.expires_at).getTime() - now : 0;

  const mergeCode = useCallback((code) => {
    if (!code) return;
    setCodes(list => (list ? list.map(c => (c.id === code.id ? code : c)) : list));
    // Keep the link on screen so a finished code fades out instead of vanishing.
    setCurrent(c => (c && c.id === code.id ? { ...code, url: code.url || c.url } : c));
    setOpenCode(c => (c && c.id === code.id ? code : c));
  }, []);

  const loadList = useCallback(async () => {
    try {
      const res = await staffCall('list', { day_start: localMidnight() });
      setCodes(res.codes);
      setToday(res.today);
      setHasMore(res.has_more);
      setListError(null);
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    staffCall('list', { day_start: localMidnight() })
      .then(res => {
        if (!alive) return;
        setCodes(res.codes);
        setToday(res.today);
        setHasMore(res.has_more);
      })
      .catch(e => { if (alive) setListError(errorText(e)); });
    const onVisible = () => { if (document.visibilityState === 'visible') loadList(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [loadList]);

  /* While a code is on screen and not collected yet, ask every few seconds
   * whether it has been scanned. */
  const currentId = current?.status === 'waiting' ? current.id : null;
  useEffect(() => {
    if (!currentId) return undefined;
    let stopped = false;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await staffCall('status', { id: currentId });
        if (stopped) return;
        if (res.code.status !== 'waiting') {
          mergeCode(res.code);
          if (res.code.status === 'claimed' || res.code.status === 'partly_claimed') {
            navigator.vibrate?.([12, 60, 18]);
          }
        }
      } catch { /* try again on the next tick */ }
    }, POLL_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [currentId, mergeCode]);

  async function make() {
    if (making) return;
    setError(null);
    setMaking(true);
    setCurrent(null);
    const started = Date.now();
    try {
      const res = await staffCall('mint', { cups, package_type: pkg });
      const wait = MIN_MAKING_MS - (Date.now() - started);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      setCurrent(res.code);
      setCodes(list => [res.code, ...(list || [])]);
      setToday(t => ({ codes: t.codes + 1, cups: t.cups + res.code.cups }));
      navigator.vibrate?.(10);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setMaking(false);
    }
  }

  async function loadMore() {
    const last = codes?.[codes.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await staffCall('list', { before: last.created_at });
      setCodes(list => [...(list || []), ...res.codes]);
      setHasMore(res.has_more);
    } catch (e) {
      setListError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function showAgain(code) {
    setOpenCode(null);
    setCurrent(code);
    stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onCodeChanged(code) {
    mergeCode(code);
    if (code.status === 'cancelled') {
      setToday(t => ({ codes: Math.max(0, t.codes - 1), cups: Math.max(0, t.cups - code.cups) }));
    }
  }

  // Group the log by day.
  const groups = [];
  for (const c of (codes || []).map(c => liveStatus(c, now))) {
    const label = dayLabel(c.created_at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(c);
    else groups.push({ label, items: [c] });
  }

  return (
    <div className="st-home">
      <section className="st-screen" ref={stageRef}>
        <header className="st-top">
          <div className="st-top__brand">
            <img src={logo} alt="PackPerks" className="st-top__logo" />
            <span className="st-tag">Staff</span>
          </div>
          <button type="button" className="st-top__me" onClick={() => setProfileOpen(true)} aria-label="Your profile">
            <Avatar profile={me.profile} size={38} />
          </button>
        </header>

        <div className="st-stage-wrap">
          <QrStage code={shown} making={making} remainingMs={remaining} venueName={venue.name} />
        </div>

        <div className="st-controls">
          <div className="st-tile st-tile--wheel">
            <div className="st-tile__side">
              <label className="st-tile__label" htmlFor="st-cups"><CupSoda size={14} aria-hidden="true" />Cups</label>
              <span className="st-tile__hint">Scroll, or tap to type</span>
            </div>
            <CupWheel id="st-cups" value={cups} max={limits.max_cups} onChange={setCups} disabled={making} />
          </div>
          <label className="st-tile st-tile--select">
            <span className="st-tile__label"><Package size={14} aria-hidden="true" />Package</span>
            <span className="st-select">
              <select value={pkg} onChange={e => setPkg(e.target.value)} disabled={making}>
                {limits.packages.map(p => <option key={p} value={p}>{PACKAGE_LABEL[p] || p}</option>)}
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </span>
            <span className="st-tile__hint">More package types are coming</span>
          </label>
        </div>

        {error && <p className="st-alert st-alert--tight" role="alert">{error}</p>}

        <button type="button" className={`st-cta${making ? ' st-cta--busy' : ''}`} onClick={make} disabled={making}>
          <span className="st-cta__shine" aria-hidden="true" />
          {making ? <span className="st-spin st-spin--light" /> : <QrCode size={21} aria-hidden="true" />}
          <span>{making ? 'Making code' : `Show QR code for ${cupsLabel(cups)}`}</span>
        </button>

        <span className="st-peek" aria-hidden="true"><History size={13} /> History below</span>
      </section>

      <section className="st-log" aria-labelledby="st-log-title">
        <div className="st-log__head">
          <h2 id="st-log-title" className="st-log__title">History</h2>
          <button type="button" className="st-iconbtn" onClick={loadList} aria-label="Refresh history">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="st-today">
          <div><b>{today.codes}</b><span>{today.codes === 1 ? 'code' : 'codes'} today</span></div>
          <div><b>{today.cups}</b><span>{today.cups === 1 ? 'cup' : 'cups'} today</span></div>
        </div>

        {listError && <p className="st-alert" role="alert">{listError}</p>}
        {codes === null && !listError && (
          <div className="st-log__skeleton" aria-hidden="true"><i /><i /><i /></div>
        )}
        {codes && codes.length === 0 && (
          <div className="st-empty">
            <QrCode size={26} aria-hidden="true" />
            <p>Codes you make show up here, with whether the customer collected them.</p>
          </div>
        )}

        {groups.map(g => (
          <div key={g.label} className="st-log__group">
            <h3 className="st-log__day">{g.label}</h3>
            <ul className="st-log__list">
              {g.items.map(c => {
                const meta = STATUS_META[c.status] || STATUS_META.expired;
                const left = new Date(c.expires_at).getTime() - now;
                return (
                  <li key={c.id}>
                    <button type="button" className="st-row" onClick={() => setOpenCode(c)}>
                      <span className={`st-row__icon st-tone--${meta.tone}`}><CupSoda size={18} aria-hidden="true" /></span>
                      <span className="st-row__main">
                        <span className="st-row__title">{cupsLabel(c.cups)}</span>
                        <span className="st-row__sub">{timeLabel(c.created_at)} · {PACKAGE_LABEL[c.package_type] || c.package_type}</span>
                      </span>
                      <span className={`st-pill st-tone--${meta.tone}`}>
                        {c.status === 'waiting' ? countdown(left) : meta.label}
                      </span>
                      <ChevronRight size={16} className="st-row__chev" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {hasMore && (
          <button type="button" className="st-btn st-btn--quiet st-log__more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show older codes'}
          </button>
        )}
      </section>

      {openCode && (
        <CodeSheet
          code={liveStatus(openCode, now)}
          now={now}
          onClose={() => setOpenCode(null)}
          onShow={showAgain}
          onChanged={onCodeChanged}
        />
      )}
      <ProfileSheet
        key={profileOpen ? 'open' : 'closed'}
        open={profileOpen}
        me={me}
        userId={userId}
        onClose={() => setProfileOpen(false)}
        onUpdated={onMe}
        onSignOut={onSignOut}
      />
    </div>
  );
}
