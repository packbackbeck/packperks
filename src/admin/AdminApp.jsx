import { useEffect, useState } from 'react';
import { AuthProvider, useAuth as useAuthRole } from './auth/AuthContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import OrgOnboardingWizard from './organizations/OrgOnboardingWizard';
import AdminOrganizations from './organizations/AdminOrganizations';
import AuthGate from './auth/AuthGate';
import AdminTopBar from './AdminTopBar';
import AdminSidebar from './AdminSidebar';
import { VENDOR_TABS } from './lib/roles';
import { setAdminDemoMode } from './lib/adminApi';
import AdminOverview from './overview/AdminOverview';
import AdminRewards from './rewards/AdminRewards';
import AdminUsers from './users/AdminUsers';
import AdminSmartBins from './smartbins/AdminSmartBins';
import AdminEmailTemplates from './emailtemplates/AdminEmailTemplates';
import AdminClaims from './claims/AdminClaims';
import AdminCupScans from './cupscans/AdminCupScans';
import AdminWorkspace from './settings/AdminWorkspace';
import AdminHistory from './history/AdminHistory';
import AdminReports from './reports/AdminReports';
import AdminStats from './stats/AdminStats';
import AdminUserBehaviour from './behaviour/AdminUserBehaviour';
import AdminReceiptGenerator from './cupqr/AdminReceiptGenerator';
import AdminTransactions from './transactions/AdminTransactions';
import AdminActivityLog from './activity/AdminActivityLog';
import AdminSupport from './support/AdminSupport';
import AdminDonations from './donations/AdminDonations';
import AdminByoRequests from './byorequests/AdminByoRequests';
import AdminFutureVendors from './futurevendors/AdminFutureVendors';
import AdminAppDesign from './appdesign/AdminAppDesign';
import AdminTikkieLog from './tikkielog/AdminTikkieLog';
import AdminBackupCups from './backupcups/AdminBackupCups';
import { TIKKIE_ONLY_PAGES } from './lib/orgModes';
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
  'transactions', 'donations', 'byorequests', 'futurevendors', 'org', 'organizations', 'settings',
  'history', 'reports', 'stats', 'behaviour', 'support', 'tikkielog', 'backupcups',
  'smartbins', 'emailtemplates',
]);
const DEFAULT_PAGE = 'overview';

function readHashPage() {
  if (typeof window === 'undefined') return DEFAULT_PAGE;
  let raw = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  // B6: #receipts is a legacy bookmark for the old Receipt Check tab, now merged
  // into Claims (its "Review" view). Translate it to claims instead of mounting a
  // second, desync-prone AdminClaims copy. Do this BEFORE the validity check so
  // the old link still resolves rather than falling back to the default page.
  if (raw === 'receipts') raw = 'claims';
  const resolved = VALID_PAGES.has(raw) ? raw : DEFAULT_PAGE;
  // Settings and Organisation are now one merged page; #org redirects to it.
  return resolved === 'org' ? 'settings' : resolved;
}

/* `#overview?as=vendor` — look at the dashboard exactly as a vendor
 * account does. Owner/admin only, and it can only ever REMOVE access:
 * the guard below narrows the visible pages and the shell drops to the
 * vendor permission set, so previewing can't reveal anything the viewer
 * couldn't already reach. It is a rehearsal of the vendor's view, not a
 * way to grant one. */
function readHashPreviewRole() {
  if (typeof window === 'undefined') return null;
  const q = (window.location.hash || '').split('?')[1] || '';
  return new URLSearchParams(q).get('as') === 'vendor' ? 'vendor' : null;
}

// Optional cross-page scroll target carried in the hash query, e.g. a
// notification deep-link `#users?section=merge` scrolls to the merge queue.
function readHashSection() {
  if (typeof window === 'undefined') return null;
  const q = (window.location.hash || '').split('?')[1] || '';
  return new URLSearchParams(q).get('section') || null;
}

function AdminShell() {
  const [page, setPageState] = useState(readHashPage);
  const draftState = useAdminDraft();
  const { profile } = useAuthRole();
  const { activeOrgId, activeOrgSlug, activeOrgMode } = useOrg();

  /* Vendor-view preview (`?as=vendor`). Kept in state so leaving it is a
   * single click rather than a URL edit. */
  const [previewRole, setPreviewRole] = useState(readHashPreviewRole);

  /* The role the dashboard actually renders as. Previewing is allowed
   * only from a role that already outranks the one being previewed. */
  const realRole = profile?.role || null;
  const canPreview = realRole === 'owner' || realRole === 'admin';
  const previewing = canPreview && previewRole === 'vendor';
  const effectiveRole = previewing ? 'vendor' : realRole;
  const isVendorView = effectiveRole === 'vendor';

  const [wizardOpen, setWizardOpen] = useState(false);
  /* When another page (e.g. Cup Scans) wants to hand off to the Users
   * page with a specific customer opened, it calls onNavigate('users',
   * { focusUserId }). We stash the id here and pass it to AdminUsers,
   * which selects that user and then clears it via onFocusConsumed. */
  const [focusUserId, setFocusUserId] = useState(null);
  /* Cross-page scroll target for the Organizations page (currently only
   * 'groups', fired by the group gear + "Manage groups" in the switcher). */
  const [focusOrgSection, setFocusOrgSection] = useState(null);
  /* Scroll target parsed from a notification deep-link hash (e.g.
   * `#users?section=merge` → scroll the Users page to the merge queue). */
  const [deepSection, setDeepSection] = useState(readHashSection);

  /* Track which pages have been visited so we can keep them mounted
   * after first visit. Set is fine here — React's reference equality
   * isn't checked because we only ever add, never remove. */
  const [visited, setVisited] = useState(() => new Set([page]));

  /* Demo numbers: the org's own switch, and only ever for the vendor
   * view. An owner looking at their own dashboard always sees the truth —
   * otherwise the toggle would quietly lie to the person who set it. */
  const demoNumbers = !!(draftState?.draft?.settings?.vendorDemoNumbers
    ?? draftState?.published?.settings?.vendorDemoNumbers);
  const demoActive = isVendorView && demoNumbers;
  // Set before the pages read it. Remounting them is handled by the <main>
  // key below, the same mechanism an org switch already uses.
  setAdminDemoMode(demoActive);

  /* Wrap setPage so URL hash and visited-set stay in sync. An optional
   * second arg carries cross-page intent (currently { focusUserId }). */
  function setPage(next, opts) {
    if (next === 'org') next = 'settings'; // merged page
    if (!VALID_PAGES.has(next)) return;
    if (opts?.focusUserId) setFocusUserId(opts.focusUserId);
    if (opts?.section) setFocusOrgSection(opts.section);
    setPageState(next);
    setVisited(prev => prev.has(next) ? prev : new Set([...prev, next]));
    // Update the hash without a scroll jump.
    if (typeof window !== 'undefined') {
      const target = '#' + next + (readHashPreviewRole() ? '?as=vendor' : '');
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
      setDeepSection(readHashSection());
      setPreviewRole(readHashPreviewRole());
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

  /* Tikkie-only orgs: hiding sidebar items alone doesn't block a route —
   * hash edits, bookmarks and the command palette all bypass it. This
   * effect is the actual gate: any page outside the tikkie-only set snaps
   * to the payout log. (Mode loads async, so it also catches the case
   * where the page rendered before the mode arrived.) */
  useEffect(() => {
    if (activeOrgMode === 'tikkie_only' && !TIKKIE_ONLY_PAGES.has(page)) {
      setPage('tikkielog');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgMode, page]);

  /* Vendor route guard. Same reasoning as the tikkie-only gate above: the
   * sidebar hides the other tabs, but hash edits and bookmarks don't care
   * what the sidebar renders. */
  useEffect(() => {
    if (isVendorView && !VENDOR_TABS.includes(page)) setPage(VENDOR_TABS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVendorView, page]);

  function exitVendorPreview() {
    setPreviewRole(null);
    if (typeof window !== 'undefined') {
      history.replaceState(null, '', window.location.pathname + window.location.search + '#' + page);
    }
  }

  function handlePreview() {
    // Multi-org: open the active org's user app slug so the preview
    // matches what's actually being edited.
    // We read activeOrg via useOrg() up above to avoid stale closures.
    const slug = activeOrgSlug;
    window.open(slug ? `/${slug}/` : '/', '_blank');
  }


  return (
    <div className={`admin-app${previewing ? ' admin-app--previewing' : ''}`}>
      {previewing && (
        <div className="vendor-preview-bar" role="status">
          <span className="vendor-preview-bar__dot" aria-hidden="true" />
          <span className="vendor-preview-bar__text">
            Viewing as a <strong>vendor</strong> — five pages, read-only.
            {demoNumbers
              ? ' Demo numbers are on, so these figures are illustrative.'
              : ' Demo numbers are off, so these are your real figures.'}
          </span>
          <button type="button" className="vendor-preview-bar__exit" onClick={exitVendorPreview}>
            Back to my view
          </button>
        </div>
      )}
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
          role={effectiveRole}
          onAddOrg={() => setWizardOpen(true)}
        />
        {/* Keying <main> by activeOrgId forces every admin page to
            remount + re-fetch whenever the user switches orgs. The
            top-level shell (topbar, sidebar) stays mounted so the
            switch feels instant and doesn't lose hash routing. */}
        <main className="admin-app__main" key={`${activeOrgId || 'bootstrap'}${demoActive ? ':demo' : ''}`}>
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
            {/* One Users page for every mode — it hides the cup/reward
                columns for Redirect Refund (profiles + accounts). */}
            <AdminUsers onNavigate={setPage} focusUserId={focusUserId} onFocusConsumed={() => setFocusUserId(null)} focusSection={page === 'users' ? deepSection : null} onSectionConsumed={() => setDeepSection(null)} />
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
            <AdminOrganizations onNavigate={setPage} onAddOrg={() => setWizardOpen(true)} focusSection={focusOrgSection} onSectionConsumed={() => setFocusOrgSection(null)} />
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
          <KeepAlive id="byorequests" activeId={page} visited={visited}>
            <AdminByoRequests onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="futurevendors" activeId={page} visited={visited}>
            <AdminFutureVendors onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="tikkielog" activeId={page} visited={visited}>
            <AdminTikkieLog onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="smartbins" activeId={page} visited={visited}>
            <AdminSmartBins />
          </KeepAlive>
          <KeepAlive id="emailtemplates" activeId={page} visited={visited}>
            <AdminEmailTemplates />
          </KeepAlive>
          <KeepAlive id="backupcups" activeId={page} visited={visited}>
            <AdminBackupCups onNavigate={setPage} />
          </KeepAlive>
          <KeepAlive id="support" activeId={page} visited={visited}>
            <AdminSupport onNavigate={setPage} />
          </KeepAlive>
          {/* B6: the old `#receipts` slot mounted a SECOND live AdminClaims copy
              (its own data + approve actions, desynced from #claims). Removed —
              readHashPage() now translates #receipts → claims, so old bookmarks
              land on the single Claims instance. */}
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
