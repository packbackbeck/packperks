import { useEffect, useMemo, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { AuthProvider, useAuth as useAuthRole } from './auth/AuthContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import { AccessProvider } from './context/AccessProvider';
import { useAccess } from './context/accessCtx';
import OrgOnboardingWizard from './organizations/OrgOnboardingWizard';
import AuthGate from './auth/AuthGate';
import AdminTopBar from './AdminTopBar';
import AdminSidebar from './AdminSidebar';
import { ViewRoleCtx, readVendorPreviewFlag } from './context/ViewRole';
import { setAdminDemoMode } from './lib/adminApi';
import { resolveEffectiveMode } from './lib/orgModes';
import { LEVELS, TABS, TAB_ALIASES, TAB_BY_ID, previewAccess, tabAvailability } from './lib/access';
import { Button, Card, EmptyState } from './ui';
import AdminOverview from './overview/AdminOverview';
import AdminRewards from './rewards/AdminRewards';
import AdminUsers from './users/AdminUsers';
import AdminSmartBins from './smartbins/AdminSmartBins';
import AdminEmailTemplates from './emailtemplates/AdminEmailTemplates';
import AdminClaims from './claims/AdminClaims';
import AdminCupScans from './cupscans/AdminCupScans';
import AdminSettingsPage from './settings/AdminSettingsPage';
import AdminMasterSettings from './master/AdminMasterSettings';
import AdminHistory from './history/AdminHistory';
import AdminReports from './reports/AdminReports';
import AdminStats from './stats/AdminStats';
import AdminUserBehaviour from './behaviour/AdminUserBehaviour';
import AdminReceiptGenerator from './cupqr/AdminReceiptGenerator';
import AdminTransactions from './transactions/AdminTransactions';
import AdminSupport from './support/AdminSupport';
import AdminDonations from './donations/AdminDonations';
import AdminByoRequests from './byorequests/AdminByoRequests';
import AdminFutureVendors from './futurevendors/AdminFutureVendors';
import AdminAppDesign from './appdesign/AdminAppDesign';
import AdminTikkieLog from './tikkielog/AdminTikkieLog';
import AdminBackupCups from './backupcups/AdminBackupCups';
import { useAdminDraft } from './hooks/useAdminDraft';
import './ui/ui.css';
import './AdminApp.css';

/* Keep-alive page wrapper. Must live at module scope: a component defined
 * inside another's render gets a new identity each render, and React would
 * remount the page and lose its state. */
function KeepAlive({ id, activeId, visited, children }) {
  if (!visited.has(id)) return null;
  return <div hidden={activeId !== id}>{children}</div>;
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <AuthGate>
        <AccessProvider>
          <OrgProvider>
            <AdminShell />
          </OrgProvider>
        </AccessProvider>
      </AuthGate>
    </AuthProvider>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Routing: one piece of state (`page`) mirrored to the URL hash, so a
 * reload keeps the tab, links can be shared and back/forward work.
 * Visited pages stay mounted (KeepAlive). Which pages exist, and which
 * this account may open, comes from lib/access.js.
 * ───────────────────────────────────────────────────────────────────── */
const DEFAULT_PAGE = 'overview';
const SIDEBAR_KEY = 'pp_admin_sidebar_collapsed';

function resolvePage(raw) {
  const id = TAB_ALIASES[raw] || raw;
  return TAB_BY_ID[id] ? id : null;
}

function readHash() {
  if (typeof window === 'undefined') return { page: DEFAULT_PAGE, section: null };
  const [path, query = ''] = (window.location.hash || '').replace(/^#\/?/, '').split('?');
  const raw = path.trim();
  const params = new URLSearchParams(query);
  return {
    page: resolvePage(raw) || DEFAULT_PAGE,
    // #organizations used to be its own page; it is now a Master Settings tab.
    section: params.get('section') || (raw === 'organizations' ? 'organisations' : raw === 'org' ? 'organisation' : null),
  };
}

function readCollapsed() {
  try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
}

function AdminShell() {
  const initial = readHash();
  const [page, setPageState] = useState(initial.page);
  const [section, setSection] = useState(initial.section);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const draftState = useAdminDraft();
  const { profile } = useAuthRole();
  const { access, roles, workspace } = useAccess();
  const { activeOrg, activeOrgId, activeOrgSlug, activeOrgMode, activeGroupMode, status: orgStatus } = useOrg();

  /* Vendor preview (`?as=vendor`): a staff account looking at the dashboard
   * exactly as a vendor does. It can only narrow what is shown. */
  const [previewRole, setPreviewRole] = useState(() => (readVendorPreviewFlag() ? 'vendor' : null));
  const canPreview = !!access && access.level !== 'vendor';
  const previewing = canPreview && previewRole === 'vendor';
  const effectiveAccess = useMemo(
    () => (previewing ? previewAccess(access, roles) : access),
    [previewing, access, roles],
  );
  const isVendorView = effectiveAccess?.level === 'vendor';

  const [wizardOpen, setWizardOpen] = useState(false);
  const [focusUserId, setFocusUserId] = useState(null);
  const [visited, setVisited] = useState(() => new Set([initial.page]));

  const settings = draftState?.draft?.settings || draftState?.published?.settings || null;
  const mode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const availabilityCtx = {
    access: effectiveAccess,
    mode,
    settings,
    hasGroup: !!activeOrg?.group_id,
    workspace,
  };
  const tabs = TABS.filter(t => tabAvailability(t, availabilityCtx).visible);
  const allowedPages = new Set(tabs.map(t => t.id));
  const firstTab = tabs[0]?.id || 'support';
  const current = tabAvailability(TAB_BY_ID[page], availabilityCtx);

  /* Demo numbers: the venue's switch, only ever in the vendor view. */
  const demoNumbers = !!(draftState?.draft?.settings?.vendorDemoNumbers
    ?? draftState?.published?.settings?.vendorDemoNumbers);
  const demoActive = isVendorView && demoNumbers;
  setAdminDemoMode(demoActive);

  function setPage(next, opts) {
    const id = resolvePage(next);
    if (!id) return;
    if (opts?.focusUserId) setFocusUserId(opts.focusUserId);
    setSection(opts?.section || null);
    setPageState(id);
    setVisited(prev => (prev.has(id) ? prev : new Set([...prev, id])));
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams();
      if (readVendorPreviewFlag()) q.set('as', 'vendor');
      if (opts?.section) q.set('section', opts.section);
      const target = `#${id}${q.toString() ? `?${q}` : ''}`;
      if (window.location.hash !== target) {
        history.replaceState(null, '', window.location.pathname + window.location.search + target);
      }
    }
  }

  useEffect(() => {
    function onHashChange() {
      const h = readHash();
      setPageState(h.page);
      setSection(h.section);
      setPreviewRole(readVendorPreviewFlag() ? 'vendor' : null);
      setVisited(prev => (prev.has(h.page) ? prev : new Set([...prev, h.page])));
    }
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search + '#' + DEFAULT_PAGE);
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /* A page this venue's programme doesn't have (a Deferred Tikkie venue on
   * Claims, say) just moves to the first page it does have. A page switched
   * off for this account or venue shows why instead (below). */
  const shouldRedirect = orgStatus === 'ready' && !current.visible
    && (current.reason === 'mode' || current.reason === 'group' || current.reason === 'unknown');
  if (shouldRedirect && firstTab !== page) {
    setPageState(firstTab);
    setSection(null);
    setVisited(prev => (prev.has(firstTab) ? prev : new Set([...prev, firstTab])));
  }
  /* Keep the address bar on the page actually shown. */
  useEffect(() => {
    if (readHash().page === page) return;
    const q = readVendorPreviewFlag() ? '?as=vendor' : '';
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${page}${q}`);
  }, [page]);

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  function exitVendorPreview() {
    setPreviewRole(null);
    history.replaceState(null, '', window.location.pathname + window.location.search + '#' + page);
  }

  function handlePreview() {
    window.open(activeOrgSlug ? `/${activeOrgSlug}/` : '/', '_blank');
  }

  const blocked = !current.visible && !shouldRedirect;
  const roleLabel = effectiveAccess?.role
    ? (effectiveAccess.role.label === LEVELS[effectiveAccess.level]?.label
      ? effectiveAccess.role.label
      : `${effectiveAccess.role.label} · ${LEVELS[effectiveAccess.level]?.label}`)
    : profile?.role;

  return (
    <div
      className={`admin-app${previewing ? ' admin-app--previewing' : ''}${collapsed ? ' admin-app--collapsed' : ''}`}
      style={{ '--sidebar-w': collapsed ? '72px' : '248px' }}
    >
      <AdminSidebar
        tabs={tabs}
        activePage={page}
        onNavigate={setPage}
        onAddOrg={() => setWizardOpen(true)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        canManageOrgs={!!effectiveAccess?.isMaster}
        roleLabel={roleLabel}
      />
      <AdminTopBar
        draftState={draftState}
        onNavigate={setPage}
        onPreview={handlePreview}
        onOpenSupport={() => setPage('support')}
        allowedPages={allowedPages}
        canSeeSettings={allowedPages.has('settings')}
        canPublish={['settings', 'rewards', 'appdesign'].some(t => effectiveAccess?.canEdit?.(t))}
      />
      <ViewRoleCtx.Provider value={{ viewRole: isVendorView ? 'vendor' : profile?.role, isVendorView, previewing, access: effectiveAccess, allowedPages }}>
        <div className="admin-app__body">
          {previewing && (
            <div className="vendor-preview-bar" role="status">
              <span className="vendor-preview-bar__dot" aria-hidden="true" />
              <span className="vendor-preview-bar__text">
                Viewing as a <strong>vendor</strong>: {tabs.length} page{tabs.length === 1 ? '' : 's'}, read-only.
                {demoNumbers
                  ? ' Demo numbers are on, so these figures are illustrative.'
                  : ' Demo numbers are off, so these are the real figures.'}
              </span>
              <button type="button" className="vendor-preview-bar__exit" onClick={exitVendorPreview}>
                Back to my view
              </button>
            </div>
          )}
          <main className="admin-app__main" key={`${activeOrgId || 'bootstrap'}${demoActive ? ':demo' : ''}`}>
            {blocked ? (
              <PageUnavailable
                tab={TAB_BY_ID[page]}
                reason={current.reason}
                roleLabel={effectiveAccess?.role?.label}
                orgName={activeOrg?.name}
                onBack={() => setPage(firstTab)}
                backLabel={TAB_BY_ID[firstTab]?.label}
              />
            ) : (
              <>
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
                  <AdminUsers
                    onNavigate={setPage}
                    focusUserId={focusUserId}
                    onFocusConsumed={() => setFocusUserId(null)}
                    focusSection={page === 'users' ? section : null}
                    onSectionConsumed={() => setSection(null)}
                  />
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
                <KeepAlive id="settings" activeId={page} visited={visited}>
                  <AdminSettingsPage
                    draftState={draftState}
                    onNavigate={setPage}
                    section={page === 'settings' ? section : null}
                  />
                </KeepAlive>
                <KeepAlive id="master" activeId={page} visited={visited}>
                  <AdminMasterSettings
                    draftState={draftState}
                    onNavigate={setPage}
                    onAddOrg={() => setWizardOpen(true)}
                    section={page === 'master' ? section : null}
                  />
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
              </>
            )}
          </main>
        </div>
      </ViewRoleCtx.Provider>

      {wizardOpen && (
        <OrgOnboardingWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

const REASONS = {
  role: (tab, role) => `Your role${role ? `, ${role},` : ''} doesn't include ${tab.label}.`,
  workspace: (tab) => `${tab.label} is switched off for everyone.`,
  feature: (tab, _role, org) => `${tab.label} is switched off in the settings${org ? ` for ${org}` : ''}.`,
};

function PageUnavailable({ tab, reason, roleLabel, orgName, onBack, backLabel }) {
  if (!tab) return null;
  const text = (REASONS[reason] || REASONS.role)(tab, roleLabel, orgName);
  const who = reason === 'feature' ? 'Turn it back on in Settings → Features.' : 'A master can change that in Master Settings.';
  return (
    <div className="ui-page">
      <Card>
        <EmptyState
          icon={EyeOff}
          title="This page is not available"
          action={backLabel && <Button variant="outline" onClick={onBack}>Go to {backLabel}</Button>}
        >
          {text} {who}
        </EmptyState>
      </Card>
    </div>
  );
}
