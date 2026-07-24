import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './FaqSheet.css';

/* Customer FAQ, shown as an accordion popup from the account page.
 * Mirrors the customer section of docs/FAQ.md in plain, reassuring language.
 * Keep answers short; the tone should calm the common worries (lost cups,
 * missing money, privacy). */
const FAQ = [
  {
    q: 'How does it work?',
    a: `Bring your own cup, scan the QR code on the counter, and collect cups. Once you have enough, you get real cashback. There is no app to download and no points that quietly expire.`,
  },
  {
    q: 'Do I need an account or an app?',
    a: `No. It runs in your phone's browser. You can add your email so your cups are saved to you and follow you to a new phone, but you can start collecting straight away without one.`,
  },
  {
    q: 'I scanned but nothing was added, or it says it is being reviewed. Did I lose the cup?',
    a: `No, nothing is lost. To keep things fair there is a small daily limit per venue, so an extra scan can be held for a quick check before it is added. If it was a genuine visit it will show up shortly. If a scan ever fails, just try once more.`,
  },
  {
    q: 'How do I get my cashback?',
    a: `Three steps: collect enough cups for the reward you want, buy that item at the venue and keep the printed receipt, then upload a photo of the receipt in PackPerks. Once it is checked, we send your cashback by a payout link.`,
  },
  {
    q: 'My receipt was not approved. Why, and what now?',
    a: `The screen shows which rule it missed, for example the reward item was not on the receipt, the receipt was too old, or the photo was a screenshot instead of the printed receipt. Your cups stay safe. Fix that point and upload a new receipt with the "Upload a different receipt" button.`,
  },
  {
    q: 'How long until the money arrives?',
    a: `Usually a few days after your receipt is approved. You get an email the moment it is approved, with the link to collect it.`,
  },
  {
    q: 'Do my cups expire?',
    a: `No. Your cups stay in your account, so you can collect at your own pace.`,
  },
  {
    q: 'I changed phones or cleared my browser. Are my cups gone?',
    a: `They are safe if you saved your email. Open PackPerks, choose to sign in, enter that email, and your cups come back to the new device.`,
  },
  {
    q: 'Can I use cups from one location somewhere else?',
    a: `Yes, as long as it is the same venue or brand. Cups you collect stay with that venue, and you can spend them at any of its locations.`,
  },
  {
    q: 'Do you sell my data?',
    a: `No. We use only what is needed to run the programme: your cup balance, your claims, and your email if you added one. No ads and no third-party trackers. You can view, export, or delete your data any time from this account page.`,
  },
  {
    q: 'The QR code will not scan.',
    a: `Hold steady in good light and fill the frame with the code. If your camera is blocked, allow camera access or scan the counter code with your phone's normal camera instead. If it still will not read, let a staff member know so they can check the code.`,
  },
  {
    q: 'Something is wrong and none of this helps.',
    a: `Use the Contact support option on this page. Tell us what happened and your email, and a real person will reply.`,
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
                {isOpen && <p className="faq-item__a">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
