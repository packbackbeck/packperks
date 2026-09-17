import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button, Modal, Segmented } from '../ui';
import { GROUPS, GROUP_TITLE } from './behaviourCopy';

/* ─────────────────────────────────────────────────────────────────────
 * Customize: which section each metric sits in. Primary metrics are the
 * tiles at the top of the page. Saved per browser, like the "Show in"
 * control in each metric's details.
 * ───────────────────────────────────────────────────────────────────── */

const OPTIONS = GROUPS.map(g => ({ id: g.id, label: g.title, title: g.hint }));

export default function ArrangeDialog({ metrics, groupOf, onChange, onReset, changed, onClose }) {
  return (
    <Modal
      open
      wide
      onClose={onClose}
      icon={SlidersHorizontal}
      title="Arrange metrics"
      subtitle="Choose where each metric appears. Primary metrics are the tiles at the top of the page. This only changes the page in this browser."
      footer={(
        <div className="ub-detail__footer">
          <Button variant="ghost" icon={RotateCcw} onClick={onReset} disabled={!changed}>Reset to default</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      )}
    >
      <ul className="ub-arrange">
        {metrics.map((m) => {
          const Icon = m.icon;
          const group = groupOf(m);
          return (
            <li key={m.id} className="ub-arrange__row">
              <span className={`ui-row__icon ui-tone--${m.tone || 'slate'}`}>
                {Icon && <Icon size={15} aria-hidden="true" />}
              </span>
              <span className="ub-arrange__name">
                {m.label}
                {group !== m.group && <span className="ub-arrange__hint">Moved from {GROUP_TITLE[m.group] || m.group}</span>}
              </span>
              <Segmented options={OPTIONS} value={group} onChange={(next) => onChange(m, next)} ariaLabel={`Section for ${m.label}`} />
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
