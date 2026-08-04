import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './FaqSheet.css';

/* Customer FAQ, shown as an accordion popup from the account page. Plain,
 * reassuring language covering the BYO flow, collecting cups, receipts and
 * cashback. Some answers carry a bullet list and/or a support link. */
const FAQ = [
  {
    q: 'What is PackPerks BYO and how does it work?',
    a: `Bring your reusable cup, buy an eligible drink and scan the PackPerks QR code. Collect cups to unlock a cashback reward. After unlocking it, buy the reward item, upload the printed receipt and receive cashback after approval.`,
  },
  {
    q: 'Do I need to download an app or create an account?',
    a: `No app is needed. PackPerks works in your phone’s browser.\nYou can start without an account, but adding your email saves your cups, lets you recover your progress and allows you to claim cashback.`,
  },
  {
    q: 'How do I collect cups, and is there a limit?',
    a: `Buy an eligible drink in your reusable cup and scan once for each drink.\nA collection limit applies. PackPerks will tell you when the limit has been reached.`,
  },
  {
    q: 'I scanned, but my cup did not appear. What should I do?',
    a: `Refresh the page, check your internet connection and confirm that you scanned the correct QR code.\nScan once more only if no confirmation appeared. Do not scan repeatedly because duplicate scans may be reviewed.`,
  },
  {
    q: 'Why is my cup being reviewed?',
    a: `A cup may be reviewed if the collection limit was reached, the QR code was scanned several times or the activity appeared unusual.\nA genuine cup may still be added after review.`,
  },
  {
    q: 'Do I receive the reward for free at the counter?',
    a: `No. After unlocking the reward, buy the exact reward item normally. Keep the original printed receipt and upload it through PackPerks to claim cashback.`,
  },
  {
    q: 'What receipt is accepted?',
    a: `Upload a clear photo of the original printed receipt showing:`,
    bullets: ['The venue', 'Purchase date', 'Reward item', 'Amount paid'],
    afterBullets: `Screenshots, edited images, copied receipts and previously used receipts are not accepted.`,
  },
  {
    q: 'What happens after I upload my receipt?',
    a: `Your claim will appear as pending while PackPerks reviews it.\nAfter approval, you will receive an email with a secure payout link or payment instructions. Review and payment may take up to seven days.`,
  },
  {
    q: 'Why was my receipt rejected?',
    a: `A receipt may be rejected if it is unclear, too old, missing the reward item, already used, edited or not an original printed receipt.\nYou may upload another valid receipt when PackPerks shows that option.`,
  },
  {
    q: 'Where can I get help?',
    a: `Use the PackPerks customer support form:`,
    link: { href: '/support', label: 'Open the support form' },
  },
];

export default function FaqSheet({ onClose }) {
  const [open, setOpen] = useState(0); // index of the expanded item; -1 for none

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div className="faq-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Frequently asked questions">
      <div className="faq-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="faq-head">
          <div>
            <span className="faq-head__eyebrow">Help</span>
            <h2 className="faq-head__title">Frequently asked questions</h2>
          </div>
          <button className="faq-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="faq-body">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className={`faq-item${isOpen ? ' faq-item--open' : ''}`}>
                <button
                  type="button"
                  className="faq-item__q"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                >
                  <span>{item.q}</span>
                  <svg className="faq-item__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="faq-item__a">
                    {item.a.split('\n').map((line, li) => <p key={li} className="faq-item__p">{line}</p>)}
                    {item.bullets && (
                      <ul className="faq-item__list">
                        {item.bullets.map((b, bi) => <li key={bi}>{b}</li>)}
                      </ul>
                    )}
                    {item.afterBullets && <p className="faq-item__p">{item.afterBullets}</p>}
                    {item.link && (
                      <a className="faq-item__link" href={item.link.href} target="_blank" rel="noopener noreferrer">
                        {item.link.label}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
