import { useState } from 'react';
import { Check, Eye } from 'lucide-react';
import { Badge, PageHeader, Tabs } from '../ui';
import { useOrg } from '../context/OrgContext';
import { useViewRole } from '../context/ViewRole';
import { resolveEffectiveMode } from '../lib/orgModes';
import { SECTION_ALIASES, SETTINGS_TABS, useSettingsDraft } from './settingsModel';
import FeaturesPanel from './FeaturesPanel';
import PayoutsPanel from './PayoutsPanel';
import RulesPanel from './RulesPanel';
import LocationsPanel from './LocationsPanel';
import LegalPanel from './LegalPanel';
import './SettingsPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * Settings — one organisation's programme: features first, then payouts,
 * rules, locations and the privacy policy. Every change goes to the draft
 * (except the few that belong to shared config and say so); Publish in the
 * top bar puts it live.
 * ───────────────────────────────────────────────────────────────────── */
export default function AdminSettingsPage({ draftState, onNavigate, section }) {
  const org = useOrg();
  const { access } = useViewRole();
  const canEdit = !!access?.canEdit?.('settings');
  const mode = resolveEffectiveMode(org.activeOrgMode, org.activeGroupMode);
  const tabs = SETTINGS_TABS.filter(t => !t.notFor?.includes(mode));
  const draft = useSettingsDraft(draftState);

  const wanted = SECTION_ALIASES[section] || section;
  const [picked, setPicked] = useState(null);
  /* A deep link (?section=payouts) wins until someone picks a tab. */
  const [linkSeen, setLinkSeen] = useState(section);
  if (section !== linkSeen) {
    setLinkSeen(section);
    if (section) setPicked(null);
  }
  const fallback = tabs.some(t => t.id === wanted) ? wanted : 'features';
  const tab = picked && tabs.some(t => t.id === picked) ? picked : fallback;

  const statusLabel = draftState?.isDirty ? 'Unpublished changes' : 'Everything is published';

  const panelProps = { draft, canEdit, mode, org, onNavigate, isMaster: !!access?.isMaster };

  return (
    <div className="ui-page st-page">
      <PageHeader
        title="Settings"
        subtitle={`How ${org.activeOrg?.name || 'this organisation'} works for customers. Changes are saved to your draft; Publish puts them live.`}
      >
        {!canEdit && <Badge tone="neutral" icon={Eye}>View only</Badge>}
        <Badge tone={draftState?.isDirty ? 'warning' : 'success'} icon={draftState?.isDirty ? undefined : Check}>
          {statusLabel}
        </Badge>
      </PageHeader>

      <div className="st-tabs">
        <Tabs tabs={tabs} value={tab} onChange={setPicked} ariaLabel="Settings sections" />
      </div>

      <div className="st-panel" key={tab}>
        {tab === 'features' && <FeaturesPanel {...panelProps} />}
        {tab === 'payouts' && <PayoutsPanel {...panelProps} />}
        {tab === 'rules' && <RulesPanel {...panelProps} />}
        {tab === 'locations' && <LocationsPanel {...panelProps} />}
        {tab === 'legal' && <LegalPanel {...panelProps} />}
      </div>

      {draft.toast && (
        <div className="st-toast" key={draft.toast.ts} role="status" aria-live="polite">
          <Check size={14} aria-hidden="true" />
          <span><b>{draft.toast.direct ? 'Saved' : 'Saved to draft'}</b> · {draft.toast.label}</span>
        </div>
      )}
    </div>
  );
}
