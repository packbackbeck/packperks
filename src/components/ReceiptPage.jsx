import { useRef, useState, useEffect } from 'react';
import './ReceiptPage.css';

/* ── Step icons (inline SVG) ── */
const CupStepIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Takeaway/reusable cup with a lid — on-theme for "collect cups". */}
    <path d="M6 8h12l-1.15 11.13A2 2 0 0 1 14.86 21H9.14a2 2 0 0 1-1.99-1.87L6 8z"/>
    <path d="M5 8h14"/>
    <path d="M8.5 4h7l.9 4H7.6l.9-4z"/>
  </svg>
);

const PhotoStepIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10L8 14L16 6"/>
  </svg>
);

const CashStepIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <circle cx="12" cy="12" r="2.5"/>
    <path d="M6 12h.01M18 12h.01"/>
  </svg>
);

const STEPS = [
  { icon: <CupStepIcon />, label: 'Collect cups', done: true },
  { icon: <PhotoStepIcon />, label: 'Photo receipt', done: false, active: true },
  { icon: <CashStepIcon />, label: 'Get cashback', done: false },
];

export default function ReceiptPage({ reward, onSubmit, onBack, orgName }) {
  const brand = orgName || 'the café';  // D.11.2: BYO venues are cafés, not restaurants
  const itemName = reward?.name || 'item';
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const streamRef = useRef(null);
  // Two screens: 'rules' (what the receipt must be) → 'camera' (take the shot).
  const [step, setStep] = useState('rules');

  /* Scroll to top so the stepper + header are visible first — on each screen. */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step]);

  /* Start the camera only once the user reaches the camera screen. */
  useEffect(() => {
    if (step !== 'camera') return;
    let mounted = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraActive(true);
      })
      .catch(() => {
        if (mounted) setCameraError('Camera access denied. Please allow camera or upload from gallery.');
      });
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [step]);

  /* Capture from video */
  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    onSubmit(canvas.toDataURL('image/jpeg', 0.85));
  };

  /* Upload from gallery */
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onSubmit(ev.target.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="receipt-page">

      {/* ── Exit button ── */}
      {onBack && (
        <button className="receipt-page__exit" onClick={onBack} aria-label="Cancel and go back">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Cancel
        </button>
      )}

      {/* ── Progress stepper ── */}
      <div className="receipt-page__stepper">
        {STEPS.map((step, i) => (
          <div key={i} className={`receipt-page__step ${step.done ? 'receipt-page__step--done' : ''} ${step.active ? 'receipt-page__step--active' : ''}`}>
            <div className="receipt-page__step-icon">
              {step.done ? <CheckIcon /> : step.icon}
            </div>
            <span className="receipt-page__step-label">{step.label}</span>
            {i < STEPS.length - 1 && <div className="receipt-page__step-line" />}
          </div>
        ))}
      </div>

      {step === 'rules' ? (
      <>
      {/* ── Screen 1: what the receipt must be ── */}
      <div className="receipt-page__header">
        <h1 className="receipt-page__title">Before you take the photo</h1>
      </div>

      {/* ── Receipt requirements ── */}
      <div className="receipt-page__requirements">
        <p className="receipt-page__req-label">Your receipt must be:</p>
        <ul className="receipt-page__req-list">
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10L8 14L16 6"/></svg>
            <span>The <strong>printed store receipt</strong> from your purchase, not the cup-return ticket</span>
          </li>
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10L8 14L16 6"/></svg>
            <span>Clearly listing the <strong>{itemName}</strong> you're claiming</span>
          </li>
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10L8 14L16 6"/></svg>
            <span><strong>Fully readable</strong>, with no blur, glare, or cropped edges</span>
          </li>
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10L8 14L16 6"/></svg>
            <span><strong>Dated after</strong> your cup return</span>
          </li>
        </ul>
      </div>

      {/* ── What does NOT count (clears up the most common questions) ── */}
      <div className="receipt-page__requirements">
        <p className="receipt-page__req-label">Not accepted</p>
        <ul className="receipt-page__req-list">
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon receipt-page__req-icon--no" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>
            <span>Your <strong>cup-return ticket</strong> (the QR receipt from the bin) — that one only adds cups</span>
          </li>
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon receipt-page__req-icon--no" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>
            <span>A <strong>bank app</strong> or online-order receipt, or any screenshot</span>
          </li>
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon receipt-page__req-icon--no" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>
            <span>A <strong>photo of the checkout screen</strong> at a self-service till</span>
          </li>
        </ul>
      </div>

      {/* Understood → move to the camera screen */}
      <button className="receipt-page__understood" onClick={() => setStep('camera')}>
        Understood — take the photo
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
      </>
      ) : (
      <>
      {/* ── Screen 2: take the photo ── */}
      <div className="receipt-page__header">
        <h1 className="receipt-page__title">Take a photo of your store receipt</h1>
      </div>

      {/* ── Camera viewfinder ── */}
      <div className="receipt-page__viewfinder">
        {cameraError ? (
          <div className="receipt-page__camera-error">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E24400" strokeWidth="1.5" strokeLinecap="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
              <line x1="4" y1="4" x2="20" y2="20" stroke="#E24400" strokeWidth="1.5"/>
            </svg>
            <span>{cameraError}</span>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="receipt-page__video"
              autoPlay
              playsInline
              muted
            />
            {!cameraActive && (
              <div className="receipt-page__camera-loading">
                <div className="receipt-page__spinner" />
                <span>Starting camera…</span>
              </div>
            )}
            {/* Corner guides */}
            <div className="receipt-page__corner receipt-page__corner--tl" />
            <div className="receipt-page__corner receipt-page__corner--tr" />
            <div className="receipt-page__corner receipt-page__corner--bl" />
            <div className="receipt-page__corner receipt-page__corner--br" />
          </>
        )}
      </div>

      {/* ── Capture button ── */}
      {!cameraError && (
        <button className="receipt-page__shutter" onClick={handleCapture} disabled={!cameraActive} aria-label="Take photo">
          <div className="receipt-page__shutter-ring">
            <div className="receipt-page__shutter-dot" />
          </div>
        </button>
      )}

      {/* ── Gallery option ── */}
      <div className="receipt-page__gallery">
        <span className="receipt-page__gallery-or">or</span>
        <button
          className="receipt-page__gallery-btn"
          onClick={() => fileRef.current?.click()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Upload from gallery
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="receipt-page__file-input" onChange={handleFileChange} />
      </div>

      {/* ── Delivery timing ── */}
      <div className="receipt-page__eta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>We'll review your receipt and send you a Tikkie link to collect your cashback — <strong>within 7 days maximum</strong>.</span>
      </div>

      {/* Privacy note — kept at the very bottom of the flow. */}
      <p className="receipt-page__privacy-note">
        Your photo is checked automatically to verify the purchase (processed by our
        AI provider in the US, not used to train models) and deleted after review.
      </p>
      </>
      )}

    </div>
  );
}
