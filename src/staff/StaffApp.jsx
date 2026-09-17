import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import StaffLogin from './StaffLogin';
import StaffHome from './StaffHome';
import { errorText, signOut, staffCall, staffSupabase } from './staffApi';
import './staff.css';

/* ─────────────────────────────────────────────────────────────────────
 * PackPerks Staff (/staff): venue staff make cup QR codes on their phone.
 * Its own page title, manifest and login; see staffApi.js and the
 * staff-app edge function.
 * ───────────────────────────────────────────────────────────────────── */

/* Answers that mean this login can't use the staff app at all. */
const LOCKED_OUT = new Set(['not_staff', 'blocked', 'app_off', 'invalid_token', 'missing_token']);

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
      set('meta[name="theme-color"]', 'content', '#F4EBDC'),
    ];
    return () => { document.title = prevTitle; undo.forEach(fn => fn()); };
  }, []);
}

export default function StaffApp() {
  usePageIdentity();
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    staffSupabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = staffSupabase.auth.onAuthStateChange((_event, s) => {
      setSession(s || null);
      if (!s) setMe(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id || null;

  const loadMe = useCallback(async () => {
    setMeError(null);
    try {
      setMe(await staffCall('me'));
    } catch (e) {
      if (LOCKED_OUT.has(e.code)) {
        setNotice(errorText(e));
        await signOut();
      } else {
        setMeError(errorText(e));
      }
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    staffCall('me')
      .then(res => { if (alive) setMe(res); })
      .catch(async (e) => {
        if (!alive) return;
        if (LOCKED_OUT.has(e.code)) {
          setNotice(errorText(e));
          await signOut();
        } else {
          setMeError(errorText(e));
        }
      });
    return () => { alive = false; };
  }, [userId]);

  async function handleSignOut() {
    await signOut();
    setMe(null);
  }

  let body;
  if (session === undefined || (userId && !me && !meError)) {
    body = (
      <div className="st-splash" aria-busy="true">
        <img src="/favicon.svg" alt="" className="st-splash__mark" />
        <span className="st-splash__bar" />
      </div>
    );
  } else if (!userId) {
    body = <StaffLogin notice={notice} onNoticeSeen={() => setNotice(null)} />;
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

  return <div className="st-app">{body}</div>;
}
