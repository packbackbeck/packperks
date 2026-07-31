import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

const RULES_SEEN_KEY = 'packperks_receipt_rules_seen';

/* The receipt requirements — shown on the first-time rules screen AND in the
 * "Which photos do we accept?" popup, so both read identically. */
function ReceiptRules({ itemName, isByo = false }) {
  return (
    <>
      <div className="receipt-page__requirements">
        <p className="receipt-page__req-label">Your receipt must be:</p>
        <ul className="receipt-page__req-list">
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10L8 14L16 6"/></svg>
            <span>The <strong>printed receipt</strong> from your purchase{isByo ? '' : ', not the cup-return ticket'}</span>
          </li>
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10L8 14L16 6"/></svg>
            <span>Clearly listing the <strong>{itemName}</strong> you're claiming</span>
          </li>
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10L8 14L16 6"/></svg>
            <span><strong>Dated after</strong> {isByo ? 'you collected your cups' : 'your cup return'}</span>
          </li>
        </ul>
      </div>

      <div className="receipt-page__requirements">
        <p className="receipt-page__req-label">Not accepted</p>
        <ul className="receipt-page__req-list">
          {!isByo && (
          <li className="receipt-page__req-item">
            <svg className="receipt-page__req-icon receipt-page__req-icon--no" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>
            <span>Your <strong>cup-return ticket</strong> (the QR receipt from the bin), that one only adds cups</span>
          </li>
          )}
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
    </>
  );
}

export default function ReceiptPage({ reward, onSubmit, onBack, orgName, isByo = false }) {
  const brand = orgName || 'the café';  // D.11.2: BYO venues are cafés, not restaurants
  const itemName = reward?.name || 'item';
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const streamRef = useRef(null);
  // A shot the user just took (data URL). While set, the frame shows a still
  // preview with "Looks good" / "Retake" instead of the live camera + shutter.
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  // Pinch-to-zoom factor (1 = no zoom). Applied as a CSS scale on the live
  // video and used to centre-crop the capture so the saved photo matches what
  // the user framed. Clamped to [1, MAX_ZOOM].
  const MAX_ZOOM = 4;
  const [zoom, setZoom] = useState(1);
  const pinchRef = useRef({ startDist: 0, startZoom: 1 });
  // Two screens: 'rules' (what the receipt must be) → 'camera' (take the shot).
  // The rules screen is only shown the FIRST time someone claims cashback;
  // after that they land straight on the camera and can re-open the rules via
  // the "Which photos do we accept?" button.
  const [step, setStep] = useState(() => {
    try { return localStorage.getItem(RULES_SEEN_KEY) ? 'camera' : 'rules'; }
    catch { return 'rules'; }
  });
  // "Which photos do we accept?" popup on the camera screen.
  const [rulesPopup, setRulesPopup] = useState(false);

  const goToCamera = () => {
    try { localStorage.setItem(RULES_SEEN_KEY, '1'); } catch { /* private mode */ }
    setStep('camera');
  };

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

  /* Reset the zoom whenever we (re)enter the live camera. */
  useEffect(() => { if (step === 'camera' && !capturedPhoto) setZoom(1); }, [step, capturedPhoto]);

  /* Capture from video into a still preview (NOT submitted yet). Centre-crop by
   * the current zoom so the saved photo matches what the user framed on screen. */
  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const z = Math.max(1, zoom);
    const sw = vw / z, sh = vh / z;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.85));
  };

  /* "Retake" — drop the preview and return to the live camera. */
  const handleRetake = () => { setCapturedPhoto(null); setZoom(1); };

  /* Upload from gallery → route through the SAME preview/confirm step as the
   * camera, so every path gets a "Looks good / Retake" check before submitting. */
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCapturedPhoto(ev.target.result);
    reader.readAsDataURL(file);
  };

  /* ── Pinch-to-zoom on the live camera (two fingers) ── */
  const touchDist = (touches) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const handleTouchStart = (e) => {
    if (capturedPhoto) return;
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: touchDist(e.touches), startZoom: zoom };
    }
  };
  const handleTouchMove = (e) => {
    if (capturedPhoto) return;
    if (e.touches.length === 2 && pinchRef.current.startDist) {
      const ratio = touchDist(e.touches) / pinchRef.current.startDist;
      const next = Math.min(MAX_ZOOM, Math.max(1, pinchRef.current.startZoom * ratio));
      setZoom(next);
    }
  };
  const handleTouchEnd = (e) => {
    if (e.touches.length < 2) pinchRef.current.startDist = 0;
  };

  return (
    <div className="receipt-page">

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
      <ReceiptRules itemName={itemName} isByo={isByo} />

      {/* Understood → move to the camera screen */}
      <button className="receipt-page__understood" onClick={goToCamera}>
        Understood, take the photo
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
      </>
      ) : (
      <>
      {/* ── Screen 2: take the photo ── */}
      <div className="receipt-page__header">
        <h1 className="receipt-page__title receipt-page__title--sm">Take a photo of your receipt<br />with the purchased reward</h1>
      </div>

      {/* ── Camera viewfinder ── the shutter now lives INSIDE the frame, and
            pinch-to-zoom is handled on this element (touch-action:none keeps the
            gesture from scrolling/zooming the page). */}
      <div
        className="receipt-page__viewfinder"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {cameraError ? (
          <div className="receipt-page__camera-error">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E24400" strokeWidth="1.5" strokeLinecap="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
              <line x1="4" y1="4" x2="20" y2="20" stroke="#E24400" strokeWidth="1.5"/>
            </svg>
            <span>{cameraError}</span>
          </div>
        ) : capturedPhoto ? (
          /* Still preview of the shot the user just took. */
          <img src={capturedPhoto} alt="Your receipt photo" className="receipt-page__preview-img" />
        ) : (
          <>
            <video
              ref={videoRef}
              className="receipt-page__video"
              autoPlay
              playsInline
              muted
              style={{ transform: `scale(${zoom})` }}
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
            {/* Pinch-to-zoom hint / live level */}
            {cameraActive && (
              zoom > 1
                ? <div className="receipt-page__zoom-badge">{zoom.toFixed(1)}×</div>
                : <div className="receipt-page__zoom-hint">Pinch to zoom</div>
            )}
            {/* Shutter — overlaid at the bottom of the frame */}
            <button
              className="receipt-page__shutter"
              onClick={handleCapture}
              disabled={!cameraActive}
              aria-label="Take photo"
            >
              <div className="receipt-page__shutter-ring">
                <div className="receipt-page__shutter-dot" />
              </div>
            </button>
          </>
        )}
      </div>

      {capturedPhoto ? (
        /* ── Preview confirm: keep it or retake ── */
        <div className="receipt-page__confirm">
          <button className="receipt-page__confirm-btn receipt-page__confirm-btn--retake" onClick={handleRetake}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            Retake
          </button>
          <button className="receipt-page__confirm-btn receipt-page__confirm-btn--keep" onClick={() => onSubmit(capturedPhoto)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            Looks good
          </button>
        </div>
      ) : (
        /* Shown for both the live camera AND the camera-denied state — the
           gallery is the fallback the error message points to, and Go home must
           always be reachable. */
        <>
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
          </div>

          {/* ── Which photos do we accept? → re-opens the rules ── */}
          <button type="button" className="receipt-page__rules-link" onClick={() => setRulesPopup(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            Which photos do we accept?
          </button>

          {/* ── Go home — replaces the old top Cancel button ── */}
          {onBack && (
            <button type="button" className="receipt-page__gohome" onClick={onBack}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" />
              </svg>
              Go home
            </button>
          )}

          {/* Privacy note — kept at the very bottom of the flow. */}
          <p className="receipt-page__privacy-note">
            Your photo is checked automatically to verify the purchase (processed by our
            AI provider in the US, not used to train models) and deleted after review.
          </p>
        </>
      )}

      {/* Gallery file input — kept mounted so the ref is always available. */}
      <input ref={fileRef} type="file" accept="image/*" className="receipt-page__file-input" onChange={handleFileChange} />
      </>
      )}

      {/* ── Rules popup (same content as the first-time rules screen) ──
          Portaled to <body> so it escapes .receipt-page's retained page-slide-in
          transform (which would otherwise make this fixed overlay's containing
          block the 375px page column instead of the full viewport). */}
      {rulesPopup && createPortal(
        <div className="receipt-rules-modal" onClick={() => setRulesPopup(false)}>
          <div className="receipt-rules-modal__card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Which photos do we accept?">
            <div className="receipt-rules-modal__head">
              <h2 className="receipt-rules-modal__title">Which photos do we accept?</h2>
              <button type="button" className="receipt-rules-modal__close" onClick={() => setRulesPopup(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <ReceiptRules itemName={itemName} isByo={isByo} />
          </div>
        </div>,
        document.body,
      )}

    </div>
  );
}
