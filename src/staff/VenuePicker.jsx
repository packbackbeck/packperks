import { Check } from 'lucide-react';

/* The venues that run the staff app, to pick the one you work at. */
export default function VenuePicker({ venues, value, onChange, disabled }) {
  return (
    <div className="st-venues" role="radiogroup" aria-label="Your venue">
      {venues.map(v => {
        const on = v.id === value;
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`st-venues__item${on ? ' is-on' : ''}`}
            onClick={() => onChange(v.id)}
            disabled={disabled}
          >
            <span className="st-venues__logo">
              {v.logo_url ? <img src={v.logo_url} alt="" /> : <b>{v.name.slice(0, 1)}</b>}
            </span>
            <span className="st-venues__name">{v.name}</span>
            <span className="st-venues__tick" aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</span>
          </button>
        );
      })}
    </div>
  );
}
