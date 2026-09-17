import { useEffect, useState } from 'react';
import { Building2, History, KeyRound, LayoutGrid, ShieldCheck, Users } from 'lucide-react';
import { useAccess } from '../context/accessCtx';
import { useOrg } from '../context/OrgContext';
import { useViewRole } from '../context/ViewRole';
import { listAllOrganizations } from '../lib/adminApi';
import { Badge, Card, CardBody, EmptyState, PageHeader, Tabs } from '../ui';
import AdminActivityLog from '../activity/AdminActivityLog';
import PeoplePanel from './PeoplePanel';
import RolesPanel from './RolesPanel';
import OrganisationsPanel from './OrganisationsPanel';
import WorkspacePanel from './WorkspacePanel';
import './MasterSettings.css';

const TABS = [
  { id: 'people', label: 'People', icon: Users },
  { id: 'roles', label: 'Roles & permissions', icon: KeyRound },
  { id: 'organisations', label: 'Organisations', icon: Building2 },
  { id: 'workspace', label: 'Workspace', icon: LayoutGrid },
  { id: 'activity', label: 'Activity log', icon: History },
];

/* Deep links: ?section=groups opens Organisations on its Groups view. */
const SECTION_TO = {
  people: ['people'], team: ['people'], roles: ['roles'], permissions: ['roles'],
  organisations: ['organisations', 'organisations'], organisation: ['organisations', 'organisations'],
  groups: ['organisations', 'groups'], regions: ['organisations', 'regions'],
  workspace: ['workspace'], activity: ['activity'],
};

/* ─────────────────────────────────────────────────────────────────────
 * Master Settings — PackBack staff only. Who has access and to what
 * (people, roles, organisations) and which tabs exist at all.
 * ───────────────────────────────────────────────────────────────────── */
export default function AdminMasterSettings({ onNavigate, onAddOrg, section, draftState }) {
  const { access } = useViewRole();
  const { workspace, rolesList } = useAccess();
  const { groupsById } = useOrg();

  const [picked, setPicked] = useState(null);
  const [orgView, setOrgView] = useState(null);
  const [linkSeen, setLinkSeen] = useState(section);
  if (section !== linkSeen) {
    setLinkSeen(section);
    if (section) { setPicked(null); setOrgView(null); }
  }
  const [linkTab, linkView] = SECTION_TO[section] || [];
  const tab = picked || linkTab || 'people';
  const view = orgView || linkView || 'organisations';

  /* Every organisation, archived included, for the people pickers. */
  const [orgs, setOrgs] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!access?.isMaster) return undefined;
    listAllOrganizations().then(list => { if (alive) setOrgs(list); }).catch(() => {});
    return () => { alive = false; };
  }, [access?.isMaster]);

  if (!access?.isMaster) {
    return (
      <div className="ui-page">
        <PageHeader title="Master settings" />
        <Card>
          <EmptyState icon={ShieldCheck} title="For PackBack masters only">
            People, roles, organisations and workspace tabs are managed by a master.
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="ui-page ms-page">
      <PageHeader
        title="Master settings"
        subtitle="Who can use the dashboard, what each role allows, every organisation, and which tabs exist."
      >
        <Badge tone="primary" icon={ShieldCheck}>Master</Badge>
        <Badge tone="neutral">{rolesList.length} roles</Badge>
      </PageHeader>

      <div className="ms-tabs">
        <Tabs tabs={TABS} value={tab} onChange={setPicked} ariaLabel="Master settings sections" />
      </div>

      <div className="ms-panel" key={tab}>
        {tab === 'people' && <PeoplePanel orgs={orgs} groupsById={groupsById} />}
        {tab === 'roles' && <RolesPanel workspace={workspace} />}
        {tab === 'organisations' && (
          <OrganisationsPanel
            onAddOrg={onAddOrg}
            onNavigate={onNavigate}
            draftState={draftState}
            view={view}
            onView={setOrgView}
          />
        )}
        {tab === 'workspace' && <WorkspacePanel />}
        {tab === 'activity' && (
          <Card className="ms-legacy">
            <CardBody flush>
              <AdminActivityLog embedded />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
