import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Clock, EyeOff, PauseCircle, Unplug } from 'lucide-react';
import { IS_PACKPULSE_EMBED, supabase } from '../../lib/supabase';
import { normalizeMode } from '../../lib/copyPresets';
import { StaticAuthProvider } from '../auth/AuthContext';
import { StaticOrgProvider } from '../context/OrgContext';
import { AccessCtx } from '../context/accessCtx';
import { ViewRoleCtx } from '../context/ViewRole';
import { setActiveOrgCountry, setActiveOrgId } from '../context/orgState';
import { setAdminDemoMode } from '../lib/adminApi';
import { Card, EmptyState, TileDisplayContext } from '../ui';
import AdminOverview from '../overview/AdminOverview';
import AdminStats from '../stats/AdminStats';
import AdminReports from '../reports/AdminReports';
import AdminUserBehaviour from '../behaviour/AdminUserBehaviour';
import '../ui/ui.css';
import '../ui/dark.css';
import '../AdminApp.css';
import './PackPulseEmbed.css';

/* ─────────────────────────────────────────────────────────────────────
 * /packpulse-embed — one PackPerks venue inside PackPulse.
 *
 * PackPulse's server asks packpulse-link for an embed URL and puts it in an
 * iframe. The URL's fragment carries a one-time ticket (#t=…&p=page&theme=
 * &o=parent origin); this page trades it for a session of the connection's
 * own login, which reads only the packpulse_* views of its venue (see
 * src/lib/supabase.js and migration 057). The pages are the dashboard's
 * own, shown the way a vendor sees them: read-only, no staff-only cards.
 *
 * Talking to PackPulse (window.postMessage, both ways checked by origin):
 *   out  { source: 'packperks', type: 'ready', page, pages, venue }
 *        { source: 'packperks', type: 'page', page }
 *        { source: 'packperks', type: 'size', height }
 *        { source: 'packperks', type: 'session_ended', reason }
 *   in   { source: 'packpulse', type: 'navigate', page }
 *        { source: 'packpulse', type: 'theme', theme: 'light' | 'dark' }
 * The whole contract is in docs/packpulse/INTEGRATION.md.
 * ───────────────────────────────────────────────────────────────────── */

const EMBED_PAGES = ['overview', 'behaviour', 'stats', 'reports'];
const SESSION_CHECK_MS = 5 * 60 * 1000;

function readFragment() {
  const q = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  return {
    ticket: q.get('t') || '',
    page: q.get('p') || 'overview',
    theme: q.get('theme') === 'dark' ? 'dark' : 'light',
    origin: q.get('o') || '',
  };
}

/* Read once when the page loads (React may render twice in development),
 * and take the ticket out of the address bar straight away. */
const START = IS_PACKPULSE_EMBED ? readFragment() : null;
if (IS_PACKPULSE_EMBED) {
  try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

/* An origin PackPulse may run on: https anywhere, or this machine. The
 * server checks it too; this only guards the page's own messages. */
const cleanOrigin = (o) => (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o) ? o : '');

/* The ticket and the token it buys each work once, so the exchange runs
 * once per ticket even when React runs the effect twice (development). */
const sessions = new Map();
function openSession(ticket) {
  if (!sessions.has(ticket)) sessions.set(ticket, exchange(ticket));
  return sessions.get(ticket);
}

async function exchange(ticket) {
  if (!ticket) return { ended: 'no_ticket' };
  const { data, error } = await supabase.functions.invoke('packpulse-link', { body: { action: 'redeem', ticket } });
  if (error || !data?.token_hash) {
    let code = 'ticket_expired';
    let linkStatus = null;
    try { const body = await error?.context?.json?.(); code = body?.error || code; linkStatus = body?.status || null; } catch { /* ignore */ }
    return {
      ended: code === 'not_active' ? (linkStatus === 'paused' ? 'paused' : 'ended')
        : code === 'page_off' ? 'page_off' : 'expired',
    };
  }

  const { data: signedIn, error: otpErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
  if (otpErr) return { ended: 'expired' };

  const { data: org } = await supabase.from('organizations')
    .select('id, name, slug, country, brand_color, logo_url, partner_brand_name, email_domain_hint, group_id, group_active, created_at, updated_at')
    .eq('id', data.org_id).maybeSingle();
  if (!org) return { ended: 'ended' };

  const keys = [`published:${org.id}`];
  if (org.group_id) keys.push(`published:group:${org.group_id}`);
  const { data: cfg } = await supabase.from('app_config').select('key, value').in('key', keys);
  const published = (cfg || []).find(r => r.key === `published:${org.id}`)?.value || { settings: {} };
  const groupCfg = org.group_id ? (cfg || []).find(r => r.key === `published:group:${org.group_id}`)?.value : null;

  const pages = EMBED_PAGES.filter(p => data.pages?.[p]);
  return {
    org,
    published,
    groupMode: org.group_id ? normalizeMode(groupCfg?.settings?.mode) : null,
    pages,
    page: pages.includes(data.page) ? data.page : pages[0],
    parentOrigin: data.parent_origin || '',
    userId: signedIn?.user?.id || null,
  };
}

function KeepAlive({ id, activeId, visited, children }) {
  if (!visited.has(id)) return null;
  return <div hidden={activeId !== id}>{children}</div>;
}

export default function PackPulseEmbed() {
  const [start] = useState(() => START || readFragment());
  const [state, setState] = useState({ phase: 'loading' });
  const parentOrigin = useRef(cleanOrigin(start.origin));

  const post = useCallback((msg) => {
    if (window.parent === window || !parentOrigin.current) return;
    try { window.parent.postMessage({ source: 'packperks', ...msg }, parentOrigin.current); } catch { /* ignore */ }
  }, []);

  useEffect(() => { applyTheme(start.theme); }, [start.theme]);

  /* Ticket → session → the venue and its published settings. */
  useEffect(() => {
    let alive = true;
    openSession(start.ticket).then((r) => {
      if (!alive) return;
      if (r.ended) {
        setState({ phase: 'ended', reason: r.ended });
        if (r.ended !== 'no_ticket') post({ type: 'session_ended', reason: r.ended });
        return;
      }
      if (cleanOrigin(r.parentOrigin || '')) parentOrigin.current = r.parentOrigin;
      setActiveOrgId(r.org.id);
      setActiveOrgCountry(r.org.country);
      setState({ phase: 'ready', ...r });
    });
    return () => { alive = false; };
  }, [start.ticket, post]);

  /* Paused or ended in PackPerks while open: the data views go empty at
   * once; this tells the viewer why. */
  useEffect(() => {
    if (state.phase !== 'ready') return undefined;
    let alive = true;
    async function check() {
      const { data } = await supabase.rpc('packpulse_session');
      if (!alive) return;
      if (!data || data.status !== 'active') {
        const reason = data?.status === 'paused' ? 'paused' : 'ended';
        setState({ phase: 'ended', reason });
        post({ type: 'session_ended', reason });
      }
    }
    const timer = setInterval(check, SESSION_CHECK_MS);
    window.addEventListener('focus', check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [state.phase, post]);

  if (state.phase === 'loading') {
    return (
      <div className="admin-app pp-embed pp-embed--center" aria-busy="true">
        <div className="pp-embed__spinner" aria-label="Loading" />
      </div>
    );
  }
  if (state.phase === 'ended') return <Ended reason={state.reason} />;
  return <EmbedShell state={state} setState={setState} post={post} parentOrigin={parentOrigin} />;
}

function EmbedShell({ state, setState, post, parentOrigin }) {
  const { org, published, groupMode, pages, page } = state;
  const [visited, setVisited] = useState(() => new Set([page]));
  const allowed = useMemo(() => new Set(pages), [pages]);
  const settings = published?.settings || {};
  // Vendors see demo numbers when the venue turned them on; PackPulse sees
  // exactly what a vendor sees.
  const demo = !!settings.vendorDemoNumbers;
  setAdminDemoMode(demo);

  const go = useCallback((next) => {
    if (!allowed.has(next)) return;
    setState(s => ({ ...s, page: next }));
    setVisited(v => (v.has(next) ? v : new Set([...v, next])));
    post({ type: 'page', page: next });
  }, [allowed, setState, post]);

  /* PackPulse drives the page and the theme. */
  useEffect(() => {
    function onMessage(e) {
      if (!parentOrigin.current || e.origin !== parentOrigin.current) return;
      const d = e.data;
      if (!d || d.source !== 'packpulse') return;
      if (d.type === 'navigate' && typeof d.page === 'string') go(d.page);
      if (d.type === 'theme') applyTheme(d.theme);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [go, parentOrigin]);

  /* Ready, and the content's height for a parent that sizes the frame. */
  useEffect(() => {
    post({
      type: 'ready', page, pages,
      venue: { name: org.name, slug: org.slug, logo_url: org.logo_url, brand_color: org.brand_color },
    });
    let last = 0;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (Math.abs(h - last) > 4) { last = h; post({ type: 'size', height: h }); }
    });
    ro.observe(document.body);
    return () => ro.disconnect();
    // Once per session: later page changes post 'page'.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const access = useMemo(() => ({
    level: 'vendor',
    role: { key: 'packpulse', label: 'PackPulse', level: 'vendor', tabs: Object.fromEntries(pages.map(p => [p, 'view'])) },
    isMaster: false,
    tabAccess: (id) => (allowed.has(id) ? 'view' : 'hidden'),
    canEdit: () => false,
    allOrgs: false,
    orgIds: [org.id],
  }), [allowed, pages, org.id]);

  const noop = useCallback(() => {}, []);
  const orgValue = useMemo(() => ({
    activeOrg: org,
    activeOrgId: org.id,
    activeOrgSlug: org.slug,
    availableOrgs: [org],
    status: 'ready',
    error: null,
    switchOrg: noop,
    refresh: noop,
    groups: [],
    groupsById: {},
    // No group scope here: the connection covers this venue only.
    activeGroupId: null,
    activeGroup: null,
    groupMembers: [],
    groupMemberIds: [],
    statsScope: 'org',
    setStatsScope: noop,
    scopeOrgIds: [org.id],
    activeOrgSharing: settings.featureCupSharing === true,
    activeGroupMode: groupMode,
    activeOrgMode: settings.mode || null,
    activeOrgSettings: settings,
    modeReady: true,
  }), [org, settings, groupMode, noop]);

  const authValue = useMemo(() => ({
    session: null,
    profile: { id: state.userId, role: 'vendor', access_role: 'vendor', email: null, display_name: 'PackPulse' },
    status: 'authenticated',
    error: null,
    recovering: false,
    endRecovery: noop,
    refresh: noop,
    signOut: noop,
    setProfile: noop,
  }), [state.userId, noop]);

  const accessValue = useMemo(() => ({
    access, roles: {}, rolesList: [], rolesSource: 'packpulse', rolesError: null,
    workspace: {}, loaded: true, reload: noop, saveRole: noop, deleteRole: noop, saveWorkspace: noop,
    topbar: {}, saveTopbar: noop, display: {}, saveDisplay: noop,
  }), [access, noop]);

  const viewRole = useMemo(() => ({
    viewRole: 'vendor', isVendorView: true, previewing: false, access, allowedPages: allowed,
  }), [access, allowed]);

  const draftState = useMemo(() => ({
    draft: published, published, updateDraft: noop, loading: false,
  }), [published, noop]);

  return (
    <StaticAuthProvider value={authValue}>
      <AccessCtx.Provider value={accessValue}>
        <StaticOrgProvider value={orgValue}>
          <ViewRoleCtx.Provider value={viewRole}>
            <TileDisplayContext.Provider value={{ sparklines: true }}>
              <div className="admin-app pp-embed">
                {demo && (
                  <div className="pp-embed__demo" role="status">
                    Demo numbers are on for {org.name}, so these figures are illustrative.
                  </div>
                )}
                <main className="admin-app__main pp-embed__main">
                  <KeepAlive id="overview" activeId={page} visited={visited}>
                    <AdminOverview draftState={draftState} onNavigate={go} embedded />
                  </KeepAlive>
                  <KeepAlive id="stats" activeId={page} visited={visited}>
                    <AdminStats onNavigate={go} />
                  </KeepAlive>
                  <KeepAlive id="behaviour" activeId={page} visited={visited}>
                    <AdminUserBehaviour onNavigate={go} />
                  </KeepAlive>
                  <KeepAlive id="reports" activeId={page} visited={visited}>
                    <AdminReports embedded />
                  </KeepAlive>
                </main>
              </div>
            </TileDisplayContext.Provider>
          </ViewRoleCtx.Provider>
        </StaticOrgProvider>
      </AccessCtx.Provider>
    </StaticAuthProvider>
  );
}

const ENDED = {
  expired: { icon: Clock, title: 'This view has expired', text: 'Open the page again in PackPulse to load it.' },
  paused: { icon: PauseCircle, title: 'This connection is paused', text: 'PackBack paused sharing this venue with PackPulse. It comes back when they resume it.' },
  ended: { icon: Unplug, title: 'This connection has ended', text: 'This venue is no longer shared with PackPulse. Ask your PackBack contact to connect it again.' },
  page_off: { icon: EyeOff, title: 'This page is not shared', text: 'PackBack does not share this page of the venue with PackPulse.' },
  no_ticket: { icon: CircleAlert, title: 'Open this from PackPulse', text: 'This page shows a PackPerks venue inside PackPulse, and only works when PackPulse opens it.' },
};

function Ended({ reason }) {
  const e = ENDED[reason] || ENDED.expired;
  return (
    <div className="admin-app pp-embed pp-embed--center">
      <div className="ui-page pp-embed__ended">
        <Card>
          <EmptyState icon={e.icon} title={e.title}>{e.text}</EmptyState>
        </Card>
      </div>
    </div>
  );
}
