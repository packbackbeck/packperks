import './Spinner.css';

/* Big circular loading indicator used by admin tables while their initial
 * fetch is in flight. Replaces the tiny grey "Loading…" text we had
 * before so users get unambiguous feedback that something is happening. */
export default function Spinner({ label = 'Loading…' }) {
  return (
    <div className="admin-spinner">
      <span className="admin-spinner__ring" aria-hidden="true" />
      <span className="admin-spinner__label">{label}</span>
    </div>
  );
}
