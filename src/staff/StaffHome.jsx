import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import logo from '../assets/images/packperks-logo.svg';
import QrStage from './QrStage';
import CupWheel from './CupWheel';
import CodeSheet from './CodeSheet';
import ProfileSheet from './ProfileSheet';
import Avatar from './Avatar';
import { demoCalls } from './demoCalls';
import {
  countdown, cupsLabel, dayLabel, errorText, PACKAGE_LABEL, staffCall, STATUS_META, timeLabel,
} from './staffApi';

/* The least time the making animation plays, so a fast answer still reads
 * as something happening. */
const MIN_MAKING_MS = 1100;
const POLL_MS = 3000;
/* How long the green "collected" square stays before going back to idle. */
const SCANNED_MS = 7000;

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

/* When a code stops working, by this phone's clock. A code made here
 * counts down from the moment it arrived, so a phone clock a few seconds
 * off the server's doesn't show 15:05. */
const expiresAt = (code) => (code?.localExpires ?? new Date(code.expires_at).getTime());

/* Tells the code's real state from the clock too, so an expired code
 * reads as expired without waiting for the server. */
function liveStatus(code, now) {
  if (code?.status === 'waiting' && expiresAt(code) <= now) return { ...code, status: 'expired' };
  return code;
}

/* The one line under the square. */
function StatusLine({ code, making, remaining }) {
  let text;
  let tone = '';
  if (making) text = 'Making the code…';
  else if (!code) text = 'Choose the cups, then show the code';
  else if (code.status === 'waiting') {
    text = <>{cupsLabel(code.cups)}<span className="st-status__sep">·</span>works for <b>{countdown(remaining)}</b></>;
    if (remaining < 60_000) tone = ' st-status--urgent';
  } else if (code.status === 'claimed' || code.status === 'partly_claimed') {
    text = <>Collected at <b>{timeLabel(code.claimed_at || code.created_at)}</b></>;
    tone = ' st-status--good';
  } else if (code.status === 'cancelled') {
    text = <>Cancelled at <b>{timeLabel(code.cancelled_at || code.created_at)}</b></>;
  } else {
    text = <>Expired at <b>{timeLabel(code.expires_at)}</b></>;
  }
  return <p className={`st-status${tone}`} aria-live="polite">{text}</p>;
}

export default function StaffHome({ me, userId, onMe, onSignOut, demo = false }) {
  const { venue, limits } = me;
  // The dashboard's preview answers locally (demoCalls.js).
  const call = useMemo(() => (demo ? demoCalls(venue) : staffCall), [demo, venue]);
  const [cups, setCups] = useState(1);
  const [pkg, setPkg] = useState(limits.packages[0] || 'cup');
  const [making, setMaking] = useState(false);
  // Set when the cups or package are touched. A code still on screen keeps
  // the button off until then, so one tap can't make a second code by mistake.
  const [touched, setTouched] = useState(false);
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
  // `now` ticks once a second, so cap at the code's life to never show 15:01.
  const life = (limits.code_minutes || 15) * 60_000;
  const remaining = shown ? Math.min(expiresAt(shown) - now, life) : 0;

  const locked = !touched && shown?.status === 'waiting' && remaining > 0;

  /* A scanned code lights the square green, then after a few seconds the
   * square goes back to idle, ready for the next customer. */
  const scannedId = shown && (shown.status === 'claimed' || shown.status === 'partly_claimed') ? shown.id : null;
  useEffect(() => {
    if (!scannedId) return undefined;
    const t = setTimeout(() => setCurrent(c => (c && c.id === scannedId ? null : c)), SCANNED_MS);
    return () => clearTimeout(t);
  }, [scannedId]);
  const touch = () => setTouched(true);
  const pickCups = (n) => { setCups(n); setTouched(true); };

  const mergeCode = useCallback((code) => {
    if (!code) return;
    setCodes(list => (list ? list.map(c => (c.id === code.id ? code : c)) : list));
    // Keep the link on screen so a finished code fades out instead of vanishing.
    setCurrent(c => (c && c.id === code.id ? { ...code, url: code.url || c.url, localExpires: c.localExpires } : c));
    setOpenCode(c => (c && c.id === code.id ? code : c));
  }, []);

  const loadList = useCallback(async () => {
    try {
      const res = await call('list', { day_start: localMidnight() });
      setCodes(res.codes);
      setToday(res.today);
      setHasMore(res.has_more);
      setListError(null);
    } catch (e) {
      setListError(errorText(e));
    }
  }, [call]);

  useEffect(() => {
    let alive = true;
    call('list', { day_start: localMidnight() })
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
  }, [call, loadList]);

  /* While a code is on screen and not collected yet, ask every few seconds
   * whether it has been scanned. */
  const currentId = current?.status === 'waiting' ? current.id : null;
  useEffect(() => {
    if (!currentId) return undefined;
    let stopped = false;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await call('status', { id: currentId });
        if (stopped) return;
        if (res.code.status !== 'waiting') {
          mergeCode(res.code);
          if (res.code.status === 'claimed' || res.code.status === 'partly_claimed') navigator.vibrate?.([12, 60, 18]);
        }
      } catch { /* try again on the next tick */ }
    }, POLL_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [call, currentId, mergeCode]);

  async function make() {
    if (making) return;
    setError(null);
    setMaking(true);
    setCurrent(null);
    const started = Date.now();
    try {
      const res = await call('mint', { cups, package_type: pkg });
      const wait = MIN_MAKING_MS - (Date.now() - started);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const life = new Date(res.code.expires_at).getTime() - new Date(res.code.created_at).getTime();
      setCurrent({ ...res.code, localExpires: Date.now() + life });
      setTouched(false);
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
      const res = await call('list', { before: last.created_at, day_start: localMidnight() });
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
    setTouched(false);
    stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onCodeChanged(code) {
    mergeCode(code);
    if (code.status === 'cancelled') {
      setToday(t => ({ codes: Math.max(0, t.codes - 1), cups: Math.max(0, t.cups - code.cups) }));
    }
  }

  // Group the history by day.
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
          <div className="st-brand">
            <img src={logo} alt="PackPerks" className="st-brand__logo" />
            <span className="st-brand__rule" aria-hidden="true" />
            <span className="st-brand__app">Staff</span>
          </div>
          <button type="button" className="st-me" onClick={() => !demo && setProfileOpen(true)} aria-label="Your profile">
            <Avatar profile={me.profile} size={36} />
          </button>
        </header>

        <div className="st-main">
          {venue.logo_url
            ? <img className="st-venue-logo" src={venue.logo_url} alt={venue.name} />
            : <p className="st-venue">{venue.name}</p>}
          <QrStage
            code={shown}
            making={making}
            status={<StatusLine code={shown} making={making} remaining={remaining} />}
          />

          <div className="st-panel">
            <div className="st-panel__cell st-panel__cell--cups" onPointerDown={touch}>
              <label className="st-panel__label" htmlFor="st-cups">Cups</label>
              <CupWheel id="st-cups" value={cups} max={limits.max_cups} onChange={pickCups} disabled={making} />
            </div>
            <span className="st-panel__rule" aria-hidden="true" />
            <label className="st-panel__cell st-panel__cell--pkg" onPointerDown={touch}>
              <span className="st-panel__label">Package</span>
              <span className="st-pick">
                <span className="st-pick__value">{PACKAGE_LABEL[pkg] || pkg}</span>
                <ChevronDown size={18} aria-hidden="true" />
                <select value={pkg} onChange={e => { setPkg(e.target.value); touch(); }} disabled={making} aria-label="Package type">
                  {limits.packages.map(p => <option key={p} value={p}>{PACKAGE_LABEL[p] || p}</option>)}
                </select>
              </span>
            </label>
          </div>

          {error && <p className="st-alert" role="alert">{error}</p>}

          <button
            type="button"
            className={`st-cta${locked && !making ? ' st-cta--locked' : ''}`}
            onClick={make}
            disabled={making || locked}
            aria-describedby={locked ? 'st-cta-hint' : undefined}
          >
            {making ? <span className="st-spin st-spin--light" aria-hidden="true" /> : null}
            {making ? 'Making the code' : 'Show QR code'}
          </button>
          {locked && <span id="st-cta-hint" className="st-sr">Change the cups or package to make a new code</span>}
        </div>
      </section>

      <section className="st-log" aria-labelledby="st-log-title">
        <div className="st-log__head">
          <div>
            <h2 id="st-log-title" className="st-log__title">History</h2>
            <p className="st-log__today">
              Today: {today.codes} {today.codes === 1 ? 'code' : 'codes'}, {cupsLabel(today.cups)}
            </p>
          </div>
          <button type="button" className="st-iconbtn" onClick={loadList} aria-label="Refresh history">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>

        {listError && <p className="st-alert" role="alert">{listError}</p>}
        {codes === null && !listError && (
          <div className="st-log__skeleton" aria-hidden="true"><i /><i /><i /></div>
        )}
        {codes && codes.length === 0 && (
          <p className="st-empty">Codes you make show up here, with whether the customer collected them.</p>
        )}

        {groups.map(g => (
          <div key={g.label} className="st-log__group">
            <h3 className="st-log__day">{g.label}</h3>
            <ul className="st-log__list">
              {g.items.map(c => {
                const meta = STATUS_META[c.status] || STATUS_META.expired;
                const left = Math.min(new Date(c.expires_at).getTime() - now, life);
                return (
                  <li key={c.id}>
                    <button type="button" className="st-row" onClick={() => setOpenCode(c)}>
                      <span className="st-row__count">{c.cups}</span>
                      <span className="st-row__main">
                        <span className="st-row__title">{cupsLabel(c.cups)}</span>
                        <span className="st-row__sub">{timeLabel(c.created_at)} · {PACKAGE_LABEL[c.package_type] || c.package_type}</span>
                      </span>
                      <span className={`st-state st-state--${meta.tone}`}>
                        <i aria-hidden="true" />
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
          call={call}
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
