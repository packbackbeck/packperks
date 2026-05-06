import { useRef, useState, useEffect } from 'react';
import './ReceiptPage.css'; /* reuse same base styles */
import './CupScanPage.css';

const CupIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
    <line x1="6" y1="1" x2="6" y2="4"/>
    <line x1="10" y1="1" x2="10" y2="4"/>
    <line x1="14" y1="1" x2="14" y2="4"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10L8 14L16 6"/>
  </svg>
);

/* Simple 1.5s loading overlay */
function LoadingOverlay() {
  return (
    <div className="cup-scan__loading-overlay">
      <div className="cup-scan__loading-spinner" />
      <span className="cup-scan__loading-text">Verifying your cup…</span>
    </div>
  );
}

export default function CupScanPage({ onSubmit, onBack }) {
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraActive(true);
      })
      .catch(() => {
        if (mounted) setCameraError('Camera access denied. You can upload from your gallery instead.');
      });
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const submit = (dataUrl) => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setLoading(true);
    setTimeout(() => onSubmit(dataUrl), 1500);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    submit(canvas.toDataURL('image/jpeg', 0.85));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => submit(ev.target.result);
    reader.readAsDataURL(file);
  };

  if (loading) return <LoadingOverlay />;

  return (
    <div className="receipt-page cup-scan-page">

      {/* ── Back button ── */}
      <button className="cup-scan__back" onClick={onBack} aria-label="Go back">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </button>

      {/* ── Step pill (single step) ── */}
      <div className="cup-scan__step-pill">
        <div className="cup-scan__step-icon"><CupIcon /></div>
        <span>Scan your returned cup receipt</span>
      </div>

      {/* ── Title ── */}
      <div className="receipt-page__header">
        <h1 className="receipt-page__title">Scan your cup receipt</h1>
        <p className="receipt-page__subtitle">
          Point the camera at the receipt you received when returning your cup. We'll add it to your balance right away.
        </p>
      </div>

      {/* ── Camera viewfinder ── */}
      <div className="receipt-page__viewfinder">
        {cameraError ? (
          <div className="receipt-page__camera-error">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E24400" strokeWidth="1.5" strokeLinecap="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <line x1="4" y1="4" x2="20" y2="20" stroke="#E24400" strokeWidth="1.5"/>
            </svg>
            <span>{cameraError}</span>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="receipt-page__video" autoPlay playsInline muted />
            {!cameraActive && (
              <div className="receipt-page__camera-loading">
                <div className="receipt-page__spinner" />
                <span>Starting camera…</span>
              </div>
            )}
            <div className="receipt-page__corner receipt-page__corner--tl" />
            <div className="receipt-page__corner receipt-page__corner--tr" />
            <div className="receipt-page__corner receipt-page__corner--bl" />
            <div className="receipt-page__corner receipt-page__corner--br" />
          </>
        )}
      </div>

      {/* ── Shutter button ── */}
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
        <button className="receipt-page__gallery-btn" onClick={() => fileRef.current?.click()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Upload from gallery
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="receipt-page__file-input" onChange={handleFileChange} />
      </div>

    </div>
  );
}
