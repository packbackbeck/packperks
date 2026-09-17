import { ArrowRight, Users } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader } from '../ui';
import { DEFAULT_DESIGN } from './designDefaults';
import { DEFAULT_SETTINGS } from '../hooks/useAdminDraft';
import { COPY_GROUPS, featureOn } from './designModel';
import { Callout, CountedField } from './DesignFields';

/* Copy: every word this page controls, grouped by the screen it appears on.
 * A venue in a group shows the group's home and account copy instead; the
 * page says so and shows what customers actually read. */
export default function CopyPanel({ design, settings, groupCopy, groupName, isMaster, readOnly, onDesignCopy, onSetting, onReveal }) {
  const sections = design.sections;

  function valueOf(f) {
    return (f.source === 'settings' ? settings[f.key] : design.copy[f.key]) ?? '';
  }
  function defaultOf(f) {
    return f.source === 'settings' ? DEFAULT_SETTINGS[f.key] : DEFAULT_DESIGN.copy[f.key];
  }
  function groupValueOf(f) {
    if (!groupCopy) return null;
    if (f.key === 'heroHeadline') return groupCopy.heroHeadline;
    if (f.key === 'heroSubtext') return groupCopy.mode === 'byo' ? '' : groupCopy.heroSubtext;
    return groupCopy.designCopy?.[f.key] ?? null;
  }
  function hiddenNote(f) {
    if (f.feature && !featureOn(settings, f.feature)) return `Hidden: ${f.featureLabel} is off`;
    if (f.section && sections[f.section] === false) return 'Hidden in Sections';
    return null;
  }

  return (
    <div className="dz-stack">
      {groupCopy && (
        <Callout
          tone="warning"
          icon={Users}
          title="Customers read the group’s copy"
          action={isMaster && (
            <Button size="sm" iconRight={ArrowRight} onClick={() => { window.location.hash = 'master?section=groups'; }}>
              Edit group copy
            </Button>
          )}
        >
          This venue is in {groupName ? `the “${groupName}” group` : 'a group'}, so the app shows the group’s headline and
          account buttons instead of the text below. You can still edit it here; it takes over if the venue leaves the group.
          {!isMaster && ' A PackBack admin can change the group’s copy.'}
        </Callout>
      )}

      {COPY_GROUPS.map(g => {
        const off = g.feature && !featureOn(settings, g.feature);
        const overridden = groupCopy && g.groupCopy;
        return (
          <Card key={g.id} className={g.quiet ? 'dz-card--quiet' : undefined}>
            <CardHeader
              icon={g.icon}
              title={g.title}
              subtitle={g.subtitle}
              actions={(
                <>
                  {overridden && <Badge tone="warning">Group copy shown</Badge>}
                  {off && <Badge tone="neutral">{g.featureLabel} off</Badge>}
                </>
              )}
            />
            <CardBody>
              <div className={`dz-fields${g.fields.some(f => f.multiline) ? ' dz-fields--one' : ''}`}>
                {g.fields.map(f => {
                  const value = valueOf(f);
                  const def = defaultOf(f);
                  const groupValue = overridden ? groupValueOf(f) : null;
                  const hidden = hiddenNote(f);
                  const emptyNote = f.emptyNote || (f.fallback ? `Left empty, the app shows “${f.fallback}”.` : null);
                  return (
                    <CountedField
                      key={f.key}
                      label={f.label}
                      value={value}
                      soft={f.soft}
                      hard={f.hard}
                      multiline={f.multiline}
                      rows={2}
                      placeholder={f.fallback || def || ''}
                      maxLength={f.source === 'design' ? f.hard + 8 : undefined}
                      hint={groupValue != null
                        ? (groupValue ? `Customers see: “${groupValue}”` : 'Customers in this group see no text here.')
                        : f.hint}
                      emptyNote={emptyNote}
                      badge={hidden && <Badge tone="neutral">{hidden}</Badge>}
                      onChange={(v) => (f.source === 'settings' ? onSetting(f.key, v) : onDesignCopy(f.key, v))}
                      onFocus={g.screen ? () => onReveal(g.screen) : undefined}
                      action={!readOnly && def != null && value !== def && (
                        <button type="button" className="dz-link" onClick={() => (f.source === 'settings' ? onSetting(f.key, def) : onDesignCopy(f.key, def))}>
                          Use default
                        </button>
                      )}
                    />
                  );
                })}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
