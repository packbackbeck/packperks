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
import AdminSettings from './settings/AdminSettings';
import AdminHistory from './history/AdminHistory';
import AdminReports from './reports/AdminReports';
import AdminReceiptCheck from './receipts/AdminReceiptCheck';
import AdminCupQr from './cupqr/AdminCupQr';
import AdminTransactions from './transactions/AdminTransactions';
import AdminOrg from './organization/AdminOrg';
import AdminActivityLog from './activity/AdminActivityLog';
import AdminSupport from './support/AdminSupport';
import AdminDonations from './donations/AdminDonations';
import { useAdminDraft } from './hooks/useAdminDraft';
import './AdminApp.css';

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
  'overview', 'rewards', 'users', 'claims', 'cupscans', 'cupqr',
  'transactions', 'donations', 'org', 'organizations', 'settings',
  'history', 'reports', 'support', 'receipts',
]);
const DEFAULT_PAGE = 'overview';

function readHashPage() {
  if (typeof window === 'undefined') return DEFAULT_PAGE;
  const raw = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  return VALID_PAGES.has(raw) ? raw : DEFAULT_PAGE;
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

  /* Keep-alive page wrapper.
   *
   * Once a page has been visited it stays mounted with `hidden` toggled
   * — so filters, scroll, in-memory state survive tab switches. Pages
   * that haven't been visited yet stay unmounted, preserving the
   * lazy-first-load behaviour. */
  function KeepAlive({ id, children }) {
    const isActive = page === id;
    const wasVisited = visited.has(id);
    if (!wasVisited) return null;
    return <div hidden={!isActive}>{isActive ? children : children}</div>;
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
          <KeepAlive id="overview">
            <AdminOverview draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="rewards">
            <AdminRewards draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="users">
            <AdminUsers onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="claims">
            <AdminClaims onNavigate={setPage} draftState={draftState} />
          </KeepAlive>
          <KeepAlive id="cupscans">
            <AdminCupScans onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="cupqr">
            <AdminCupQr onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="transactions">
            <AdminTransactions onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="org">
            <AdminOrg onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="organizations">
            <AdminOrganizations onNavigate={setPage} onAddOrg={() => setWizardOpen(true)} />
          </KeepAlive>
          <KeepAlive id="settings">
            <AdminSettings draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="history">
            <AdminHistory draftState={draftState} onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="reports">
            <AdminReports onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="donations">
            <AdminDonations onNavigate={setPage} draftState={draftState} />
          </KeepAlive>
          <KeepAlive id="support">
            <AdminSupport onNavigate={setPage} />
          </KeepAlive>
          {/* `receipts` was the old standalone Receipt Check tab — it
           *  redirects to Claims (which now has a "Review" view mode
           *  covering the same workflow). Keep it as its own keep-alive
           *  slot in case the URL hash has #receipts from old bookmarks. */}
          <KeepAlive id="receipts">
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
