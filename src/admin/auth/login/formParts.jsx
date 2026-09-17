import { useState } from 'react';
import {
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  SpinnerIcon,
} from './icons';

/* Building blocks shared by the sign-in and reset-password screens. Styles
 * live in ../LoginPage.css under `.pp-auth`. */

/* Optional icon tile, the page title and a short muted paragraph. */
export function AuthHeading({ icon, tone = 'primary', title, children }) {
  return (
    <>
      {icon && (
        <span className={`pp-auth__tile pp-auth__tile--${tone}`} aria-hidden="true">
          {icon}
        </span>
      )}
      <h1 className="pp-auth__title">{title}</h1>
      {children && <p className="pp-auth__lead">{children}</p>}
    </>
  );
}

/* Label + control + hint. `action` sits at the right of the label row but
 * comes after the input in the DOM, so Tab goes from one field to the next. */
export function Field({ id, label, action, hint, children }) {
  return (
    <div className="pp-auth__field">
      <label className="pp-auth__label" htmlFor={id}>{label}</label>
      {children}
      {action && <div className="pp-auth__action">{action}</div>}
      {hint && <p className="pp-auth__hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

export function TextInput({ code = false, ...props }) {
  return (
    <div className={`pp-auth__control${code ? ' pp-auth__control--code' : ''}`}>
      <input className="pp-auth__input" {...props} />
    </div>
  );
}

/* Password input with a show / hide toggle. */
export function PasswordInput(props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pp-auth__control">
      <input className="pp-auth__input" {...props} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="pp-auth__reveal"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        aria-controls={props.id}
        disabled={props.disabled}
      >
        {shown ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
      </button>
    </div>
  );
}

/* Renders nothing without a message. */
export function FormAlert({ tone = 'error', children }) {
  if (!children) return null;
  return (
    <p
      className={`pp-auth__alert pp-auth__alert--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {tone === 'error' ? <AlertIcon /> : <CheckCircleIcon />}
      <span>{children}</span>
    </p>
  );
}

/* Full-width primary button: trailing arrow, spinner while busy. */
export function PrimaryButton({ type = 'submit', busy = false, busyLabel, disabled, onClick, children }) {
  return (
    <button
      type={type}
      className="pp-auth__submit"
      disabled={disabled}
      onClick={onClick}
      aria-busy={busy || undefined}
    >
      {busy && <SpinnerIcon className="pp-auth__spin" />}
      <span>{busy ? busyLabel : children}</span>
      {!busy && <ArrowRightIcon className="pp-auth__arrow" />}
    </button>
  );
}
