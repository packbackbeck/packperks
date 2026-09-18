import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import StaffLogin from './StaffLogin';
import StaffHome from './StaffHome';
import StaffWaiting from './StaffWaiting';
import { errorText, signOut, staffCall, staffSupabase } from './staffApi';
import { ToneContext, useStaffTheme } from './staffTheme';
import './staff.css';

/* ─────────────────────────────────────────────────────────────────────
 * PackPerks Staff (/staff): venue staff make cup QR codes on their phone.
 * Its own page title, manifest and login; see staffApi.js and the
 * staff-app edge function. The app wears the venue's customer-app colours.
 *
 * /staff?preview=<orgId> is the dashboard's preview: the venue's look with
 * sample codes, no login and nothing saved.
 * ───────────────────────────────────────────────────────────────────── */

/* Answers that mean this login can't use the staff app at all. */
const LOCKED_OUT = new Set(['blocked', 'app_off', 'invalid_token', 'missing_token']);

const PREVIEW_ID = (() => {
  try { return new URLSearchParams(window.location.search).get('preview'); } catch { return null; }
})();

function usePageIdentity() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'PackPerks Staff';
    const set = (selector, attr, value) => {
      const el = document.querySelector(selector);
      if (!el) return () => {};
      const before = el.getAttribute(attr);
      el.setAttribute(attr, value);
      return () => el.setAttribute(attr, before);
    };
    const undo = [
      set('link[rel="manifest"]', 'href', '/staff.webmanifest'),
      set('meta[name="apple-mobile-web-app-title"]', 'content', 'PP Staff'),
    ];
    return () => { document.title = prevTitle; undo.forEach(fn => fn()); };
  }, []);
}

function Splash() {
  return (
    <div className="st-splash" aria-busy="true">
      <img src="/favicon.svg" alt="" className="st-splash__mark" />
      <span className="st-splash__bar" />
    </div>
  );
}

function Shell({ colors, children }) {
  const theme = useStaffTheme(colors);
  return (
    <ToneContext.Provider value={theme.tones}>
      <div className="st-app" style={theme.vars || undefined}>{children}</div>
    </ToneContext.Provider>
  );
}

function PreviewApp() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    staffCall('preview', { org_id: PREVIEW_ID })
      .then(res => setMe({
        profile: { id: 'preview', name: 'Sam Rivera', email: 'sam@example.com', avatar_url: null },
        venue: res.venue,
        design: res.design,
        limits: res.limits,
      }))
      .catch(e => setError(errorText(e)));
  }, []);
  return (
    <Shell colors={me?.design?.colors}>
      {error ? <div className="st-splash"><p className="st-splash__text">{error}</p></div>
        : me ? <StaffHome me={me} demo /> : <Splash />}
    </Shell>
  );
}

function RealApp() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState(null);
  const [waiting, setWaiting] = useState(null);   // { kind: 'pending' | 'join', ...answer }
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    staffSupabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = staffSupabase.auth.onAuthStateChange((_event, s) => {
      setSession(s || null);
      if (!s) { setMe(null); setWaiting(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id || null;

  const handle = useCallback(async (e) => {
    if (e.code === 'pending_approval') setWaiting({ kind: 'pending', ...e.data });
    else if (e.code === 'not_staff' && e.data.venues?.length) setWaiting({ kind: 'join', ...e.data });
    else if (LOCKED_OUT.has(e.code) || e.code === 'not_staff') {
      setNotice(errorText(e));
      await signOut();
    } else {
      setMeError(errorText(e));
    }
  }, []);

  const loadMe = useCallback(async () => {
    setMeError(null);
    try {
      setMe(await staffCall('me'));
      setWaiting(null);
    } catch (e) {
      await handle(e);
    }
  }, [handle]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    staffCall('me')
      .then(res => { if (alive) { setMe(res); setWaiting(null); } })
      .catch(e => { if (alive) handle(e); });
    return () => { alive = false; };
  }, [userId, handle]);

  async function handleSignOut() {
    await signOut();
    setMe(null);
    setWaiting(null);
  }

  let body;
  let colors = me?.design?.colors;
  if (session === undefined || (userId && !me && !meError && !waiting)) {
    body = <Splash />;
  } else if (!userId) {
    body = <StaffLogin notice={notice} onNoticeSeen={() => setNotice(null)} />;
  } else if (waiting) {
    colors = waiting.design?.colors;
    body = <StaffWaiting state={waiting} onCheck={loadMe} onSignOut={handleSignOut} />;
  } else if (meError) {
    body = (
      <div className="st-splash">
        <p className="st-splash__text">{meError}</p>
        <button type="button" className="st-btn st-btn--primary" onClick={loadMe}>
          <RefreshCw size={16} aria-hidden="true" /> Try again
        </button>
        <button type="button" className="st-link" onClick={handleSignOut}>Sign out</button>
      </div>
    );
  } else {
    body = <StaffHome me={me} userId={userId} onMe={setMe} onSignOut={handleSignOut} />;
  }

  return <Shell colors={colors}>{body}</Shell>;
}

export default function StaffApp() {
  usePageIdentity();
  return PREVIEW_ID ? <PreviewApp /> : <RealApp />;
}
