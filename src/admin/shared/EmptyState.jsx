import './EmptyState.css';

/* ─────────────────────────────────────────────────────────────────────
 * EmptyState — friendly placeholder for tables that have no rows yet.
 *
 * Replaces the bare "No claims found" / "No users found" lines that
 * showed up on fresh franchises. A brand-new BK location with zero
 * activity used to see a barren grey row; now they see a small
 * illustration + a one-sentence explanation + an optional next-action
 * button.
 *
 *   <EmptyState
 *     icon={<svg>…</svg>}
 *     title="No claims yet"
 *     body="Customers will appear here once they submit their first cashback receipt."
 *     primaryAction={{ label: 'Generate test QR', onClick: ... }}
 *   />
 *
 * Visually distinct from a "filter found nothing" state — that one
 * should keep using a terse "No results match this filter" message,
 * since the user is one click away from clearing the filter. */
export default function EmptyState({ icon, title, body, primaryAction, secondaryAction, tone = 'neutral' }) {
  return (
    <div className={`empty-state empty-state--${tone}`}>
      <div className="empty-state__art">
        {icon || (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
        )}
      </div>
      <h3 className="empty-state__title">{title}</h3>
      {body && <p className="empty-state__body">{body}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="empty-state__actions">
          {primaryAction && (
            <button
              type="button"
              className="empty-state__btn empty-state__btn--primary"
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              className="empty-state__btn empty-state__btn--ghost"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
