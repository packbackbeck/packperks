import { createPortal } from 'react-dom';
import defaultPolicy from '../../docs/PRIVACY_POLICY.md?raw';
import './PrivacyPolicyView.css';

/* Minimal, dependency-free Markdown → elements renderer — enough for the
 * privacy policy (headings, bold, lists, paragraphs, tables collapse to text). */
function renderMarkdown(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  let list = null;
  const inline = (t) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
      /^\*\*[^*]+\*\*$/.test(chunk)
        ? <strong key={i}>{chunk.slice(2, -2)}</strong>
        : <span key={i}>{chunk}</span>,
    );
  const flush = (key) => { if (list) { out.push(<ul key={`ul-${key}`} className="pp-md__ul">{list}</ul>); list = null; } };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(i); out.push(<hr key={i} className="pp-md__hr" />); }
    else if (/^###?\s/.test(line))      { flush(i); out.push(<h3 key={i} className="pp-md__h3">{inline(line.replace(/^#+\s/, ''))}</h3>); }
    else if (/^#\s/.test(line))    { flush(i); out.push(<h2 key={i} className="pp-md__h2">{inline(line.replace(/^#\s/, ''))}</h2>); }
    else if (/^[-*]\s/.test(line)) { (list ||= []).push(<li key={i}>{inline(line.replace(/^[-*]\s/, ''))}</li>); }
    else if (/^\|/.test(line))     { flush(i); out.push(<p key={i} className="pp-md__row">{inline(line.replace(/\|/g, ' · ').replace(/^[\s·-]+|[\s·-]+$/g, ''))}</p>); }
    else if (line.trim() === '')   { flush(i); }
    else                           { flush(i); out.push(<p key={i} className="pp-md__p">{inline(line)}</p>); }
  });
  flush('end');
  return out;
}

/* Full-screen scrollable privacy & cookie policy. `text` overrides the bundled
 * default (so an org can edit it in the admin dashboard — GDPR item 10). */
export default function PrivacyPolicyView({ text, onClose }) {
  return createPortal(
    <div className="pp-overlay" role="dialog" aria-modal="true" aria-label="Privacy policy">
      <div className="pp-sheet">
        <header className="pp-head">
          <span className="pp-head__title">Privacy &amp; cookies</span>
          <button className="pp-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="pp-body pp-md">{renderMarkdown(text || defaultPolicy)}</div>
      </div>
    </div>,
    document.body,
  );
}
