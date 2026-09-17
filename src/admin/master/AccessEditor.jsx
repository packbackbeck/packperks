import { useMemo, useState } from 'react';
import { Search, TriangleAlert } from 'lucide-react';
import { LEVELS, LEVEL_ORDER } from '../lib/access';
import { OrgAvatar } from '../context/OrgSwitcher';
import { Switch } from '../ui';
import { roleCounts } from './masterApi';

/* Pick a role and the organisations it applies to. Controlled:
 * value = { roleKey, orgIds, allOrgs }. */
export default function AccessEditor({ value, onChange, roles, orgs, groupsById, lockedRole, lockedReason, idPrefix = 'acc' }) {
  const [query, setQuery] = useState('');
  const role = roles.find(r => r.key === value.roleKey) || null;
  const isMaster = role?.level === 'master';

  const grouped = LEVEL_ORDER.map(level => ({
    level,
    roles: roles.filter(r => r.level === level),
  })).filter(g => g.roles.length);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = orgs.filter(o => !o.deleted_at);
    return q ? list.filter(o => `${o.name} ${o.slug}`.toLowerCase().includes(q)) : list;
  }, [orgs, query]);

  const selected = new Set(value.orgIds);
  const toggleOrg = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ ...value, orgIds: [...next] });
  };

  return (
    <div className="ms-access">
      <section className="ms-access__block" aria-labelledby={`${idPrefix}-role`}>
        <p className="ms-access__label" id={`${idPrefix}-role`}>Role</p>
        <div className="ms-role-options" role="radiogroup" aria-labelledby={`${idPrefix}-role`}>
          {grouped.map(g => (
            <div key={g.level} className="ms-role-options__group">
              <p className="ms-role-options__level">
                <span className={`ms-level-dot ms-level-dot--${g.level}`} aria-hidden="true" />
                {LEVELS[g.level].label} level
              </p>
              {g.roles.map(r => {
                const c = roleCounts(r);
                const checked = value.roleKey === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={!!lockedRole && !checked}
                    className={`ms-role-option${checked ? ' ms-role-option--on' : ''}`}
                    onClick={() => onChange({ ...value, roleKey: r.key })}
                  >
                    <span className={`ms-radio${checked ? ' ms-radio--on' : ''}`} aria-hidden="true" />
                    <span className="ms-role-option__main">
                      <span className="ms-role-option__name">{r.label}</span>
                      <span className="ms-role-option__desc">{r.description || LEVELS[r.level].description}</span>
                    </span>
                    <span className="ms-role-option__meta">
                      {r.level === 'master' ? 'Everything' : `${c.edit} change · ${c.view} view`}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {lockedRole && lockedReason && <p className="ms-note">{lockedReason}</p>}
      </section>

      <section className="ms-access__block" aria-labelledby={`${idPrefix}-orgs`}>
        <div className="ms-access__row">
          <p className="ms-access__label" id={`${idPrefix}-orgs`}>Organisations</p>
          {!isMaster && (
            <label className="ms-inline-switch">
              <span>All organisations, including new ones</span>
              <Switch
                checked={value.allOrgs}
                label="All organisations"
                onChange={v => onChange({ ...value, allOrgs: v })}
              />
            </label>
          )}
        </div>
        {isMaster ? (
          <p className="ms-note">Masters see every organisation.</p>
        ) : value.allOrgs ? (
          <p className="ms-note">They see all {orgs.filter(o => !o.deleted_at).length} organisations now, and any added later.</p>
        ) : (
          <>
            <div className="ms-orgpick">
              <div className="ms-orgpick__head">
                <span className="ms-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    className="ms-search__input"
                    placeholder="Find an organisation"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    aria-label="Find an organisation"
                  />
                </span>
                <span className="ms-orgpick__count">{selected.size} selected</span>
                <button
                  type="button"
                  className="ms-link"
                  onClick={() => onChange({ ...value, orgIds: [...new Set([...value.orgIds, ...shown.map(o => o.id)])] })}
                >
                  Select shown
                </button>
                <button type="button" className="ms-link" onClick={() => onChange({ ...value, orgIds: [] })}>
                  Clear
                </button>
              </div>
              <ul className="ms-orgpick__list">
                {shown.map(o => {
                  const on = selected.has(o.id);
                  const group = o.group_id ? groupsById?.[o.group_id] : null;
                  return (
                    <li key={o.id}>
                      <label className={`ms-orgpick__item${on ? ' ms-orgpick__item--on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleOrg(o.id)} />
                        <OrgAvatar org={o} size={24} />
                        <span className="ms-orgpick__name">{o.name}</span>
                        {group && <span className="ms-chip">{group.name}</span>}
                      </label>
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="ms-orgpick__empty">No organisation matches “{query}”.</li>}
              </ul>
            </div>
            {selected.size === 0 && (
              <p className="ms-warn"><TriangleAlert size={13} aria-hidden="true" /> Pick at least one, or they will see nothing.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
