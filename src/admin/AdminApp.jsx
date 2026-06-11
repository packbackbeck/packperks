import { useEffect, useState } from 'react';
import { AuthProvider, useAuth as useAuthRole } from './auth/AuthContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import OrgOnboardingWizard from './organizations/OrgOnboardingWizard';
import AdminOrganizations from './organizations/AdminOrganizations';
import AuthGate from './auth/AuthGate';
import AdminTopBar from './AdminTopBar';
import AdminSidebar from './AdminSidebar';
import AdminOverview from './overview/AdminOverview';
import AdminRewards from './rewards/AdminRewards';
import AdminUsers from './users/AdminUsers';
import AdminClaims from './claims/AdminClaims';
import AdminCupScans from './cupscans/AdminCupScans';
import AdminWorkspace from './settings/AdminWorkspace';
import AdminHistory from './history/AdminHistory';
import AdminReports from './reports/AdminReports';
import AdminStats from './stats/AdminStats';
import AdminUserBehaviour from './behaviour/AdminUserBehaviour';
import AdminReceiptCheck from './receipts/AdminReceiptCheck';
import AdminReceiptGenerator from './cupqr/AdminReceiptGenerator';
import AdminTransactions from './transactions/AdminTransactions';
import AdminActivityLog from './activity/AdminActivityLog';
import AdminSupport from './support/AdminSupport';
import AdminDonations from './donations/AdminDonations';
import AdminAppDesign from './appdesign/AdminAppDesign';
import { useAdminDraft } from './hooks/useAdminDraft';
import './AdminApp.css';

/* Keep-alive page wrapper.
 *
 * MUST live at module scope (not inside AdminApp): a component defined inside
 * another component's render gets a new function identity on every render, so
 * React would unmount + remount the whole page subtree on every AdminApp
 * re-render — wiping in-page state such as the selected reward, scroll, and
 * filters. With a stable identity here, a visited page stays mounted and just
 * toggles `hidden`, which is the whole point of keep-alive.
 */
function KeepAlive({ id, activeId, visited, children }) {
  if (!visited.has(id)) return null;
  return <div hidden={activeId !== id}>{children}</div>;
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <AuthGate>
        <OrgProvider>
          <AdminShell />
        </OrgProvider>
      </AuthGate>
    </AuthProvider>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * URL routing model.
 *
 * The admin shell uses a single piece of React state (`page`) to track
 * the active tab, but mirrors it to `window.location.hash` so:
 *
 *   • A browser reload returns to the last-active tab (no more
 *     unwanted bounce-to-Overview).
 *   • The hash is a real link admins can share with teammates
 *     ("look at the claim view: /admin#claims").
 *   • The browser back/forward buttons navigate between tabs.
 *
 * Pages are also kept-alive once visited. The first time the admin
 * visits e.g. Claims, it mounts and fetches; subsequent visits just
 * `display: block` it back in, preserving filter / sort / scroll
 * state. Pages not yet visited stay unmounted so the first-paint
 * cost is the same as before.
 *
 * `cupqr` and `receipts` aren't shown in the sidebar but are real
 * routes — `cupqr` is its own page, `receipts` is a legacy redirect
 * that resolves to Claims.
 * ───────────────────────────────────────────────────────────────────── */
const VALID_PAGES = new Set([
  'overview', 'rewards', 'appdesign', 'users', 'claims', 'cupscans', 'cupqr',
  'transactions', 'donations', 'org', 'organizations', 'settings',
  'history', 'reports', 'stats', 'behaviour', 'support', 'receipts',
]);
const DEFAULT_PAGE = 'overview';

function readHashPage() {
  if (typeof window === 'undefined') return DEFAULT_PAGE;
  const raw = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  const resolved = VALID_PAGES.has(raw) ? raw : DEFAULT_PAGE;
  // Settings and Organisation are now one merged page; #org redirects to it.
  return resolved === 'org' ? 'settings' : resolved;
}

function AdminShell() {
  const [page, setPageState] = useState(readHashPage);
  const draftState = useAdminDraft();
  const { profile } = useAuthRole();
  const { activeOrgId, activeOrgSlug } = useOrg();
  const [wizardOpen, setWizardOpen] = useState(false);

  /* Track which pages have been visited so we can keep them mounted
   * after first visit. Set is fine here — React's reference equality
   * isn't checked because we only ever add, never remove. */
  const [visited, setVisited] = useState(() => new Set([page]));

  /* Wrap setPage so URL hash and visited-set stay in sync. */
  function setPage(next) {
    if (next === 'org') next = 'settings'; // merged page
    if (!VALID_PAGES.has(next)) return;
    setPageState(next);
    setVisited(prev => prev.has(next) ? prev : new Set([...prev, next]));
    // Update the hash without a scroll jump.
    if (typeof window !== 'undefined') {
      const target = '#' + next;
      if (window.location.hash !== target) {
        history.replaceState(null, '', window.location.pathname + window.location.search + target);
      }
    }
  }

  /* Listen for back/forward + manual hash edits so the active tab
   * always matches the URL. */
  useEffect(() => {
    function onHashChange() {
      const next = readHashPage();
      setPageState(next);
      setVisited(prev => prev.has(next) ? prev : new Set([...prev, next]));
    }
    window.addEventListener('hashchange', onHashChange);
    // If the page loaded with no hash, normalise to the default so
    // a reload doesn't see an empty URL.
    if (!window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search + '#' + DEFAULT_PAGE);
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function handlePreview() {
    // Multi-org: open the active org's user app slug so the preview
    // matches what's actually being edited.
    // We read activeOrg via useOrg() up above to avoid stale closures.
    const slug = activeOrgSlug;
    window.open(slug ? `/${slug}/` : '/', '_blank');
  }


  return (
    <div className="admin-app">
      <AdminTopBar
        draftState={draftState}
        onNavigate={setPage}
        onPreview={handlePreview}
        onOpenSupport={() => setPage('support')}
      />
      <div className="admin-app__body">
        <AdminSidebar
          activePage={page}
          onNavigate={setPage}
          draftState={draftState}
          role={profile?.role}
          onAddOrg={() => setWizardOpen(true)}
        />
        {/* Keying <main> by activeOrgId forces every admin page to
            remount + re-fetch whenever the user switches orgs. The
            top-level shell (topbar, sidebar) stays mounted so the
            switch feels instant and doesn't lose hash routing. */}
        <main className="admin-app__main" key={activeOrgId || 'bootstrap'}>
          <KeepAlive id="overview" activeId={page} visited={visited}>
            <AdminOverview draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="rewards" activeId={page} visited={visited}>
            <AdminRewards draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="appdesign" activeId={page} visited={visited}>
            <AdminAppDesign draftState={draftState} />
          </KeepAlive>
          <KeepAlive id="users" activeId={page} visited={visited}>
            <AdminUsers onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="claims" activeId={page} visited={visited}>
            <AdminClaims onNavigate={setPage} draftState={draftState} />
          </KeepAlive>
          <KeepAlive id="cupscans" activeId={page} visited={visited}>
            <AdminCupScans onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="cupqr" activeId={page} visited={visited}>
            <AdminReceiptGenerator onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="transactions" activeId={page} visited={visited}>
            <AdminTransactions onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="organizations" activeId={page} visited={visited}>
            <AdminOrganizations onNavigate={setPage} onAddOrg={() => setWizardOpen(true)} />
          </KeepAlive>
          <KeepAlive id="settings" activeId={page} visited={visited}>
            <AdminWorkspace draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="history" activeId={page} visited={visited}>
            <AdminHistory draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="reports" activeId={page} visited={visited}>
            <AdminReports onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="stats" activeId={page} visited={visited}>
            <AdminStats onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="behaviour" activeId={page} visited={visited}>
            <AdminUserBehaviour onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="donations" activeId={page} visited={visited}>
            <AdminDonations onNavigate={setPage} draftState={draftState} />
          </KeepAlive>
          <KeepAlive id="support" activeId={page} visited={visited}>
            <AdminSupport onNavigate={setPage} />
          </KeepAlive>
          {/* `receipts` was the old standalone Receipt Check tab — it
           *  redirects to Claims (which now has a "Review" view mode
           *  covering the same workflow). Keep it as its own keep-alive
           *  slot in case the URL hash has #receipts from old bookmarks. */}
          <KeepAlive id="receipts" activeId={page} visited={visited}>
            <AdminClaims onNavigate={setPage} draftState={draftState} />
          </KeepAlive>
        </main>
      </div>

      {/* Create-org wizard — modal portal sibling so it overlays the
          whole shell. State lives here so the switcher (sidebar) and
          the Organisations management page (main area) can both
          trigger it through the same `onAddOrg` callback. */}
      {wizardOpen && (
        <OrgOnboardingWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
