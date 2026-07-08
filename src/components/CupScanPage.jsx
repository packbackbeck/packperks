import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import './ReceiptPage.css'; /* reuse same base styles */
import './CupScanPage.css';
import { parseCupQr } from '../lib/api';

/* Compress a (possibly large) canvas down to a manageable JPEG data-URL.
 *
 * Returns null if the export fails — most commonly when a gallery image
 * tainted the canvas (iOS Safari + HEIC source can do that even though
 * the file came from a local FileReader). The caller is expected to
 * handle null by continuing the scan without a photo, rather than
 * silently dropping the entire claim attempt. */
function compressToJpeg(canvas, maxWidth = 800, quality = 0.65) {
  try {
    if (canvas.width <= maxWidth) return canvas.toDataURL('image/jpeg', quality);
    const scale = maxWidth / canvas.width;
    const out = document.createElement('canvas');
    out.width = maxWidth;
    out.height = Math.round(canvas.height * scale);
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', quality);
  } catch (err) {
    console.error('compressToJpeg failed (returning null):', err);
    return null;
  }
}

function ProcessingOverlay({ count }) {
  return (
    <div className="cup-scan__loading-overlay">
      <div className="cup-scan__loading-spinner" />
      <span className="cup-scan__loading-text">
        Adding {count} cup{count !== 1 ? 's' : ''} to your balance…
      </span>
    </div>
  );
}

/* QR-driven cup return page. Reads the rear camera, decodes any QR in
 * frame via jsQR every ~150ms, and as soon as a parsed cups payload comes
 * out it hands the UUID list off to onScan() which calls the claim-cups
 * edge function. Errors (already-claimed, invalid) bubble up via onError. */
export default function CupScanPage({ onScan, onBack, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastTickRef = useRef(0);
  const handledRef = useRef(false);

  const [cameraError, setCameraError] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [hint, setHint] = useState(null);

  // ── Start camera + decode loop ─────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setCameraActive(true);
        }
        scheduleScan();
      })
      .catch(() => {
        if (mounted) setCameraError('Camera access denied. Scan the counter QR with your phone camera instead.');
      });
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scheduleScan() {
    rafRef.current = requestAnimationFrame(tickScan);
  }

  function tickScan(ts) {
    if (handledRef.current) return;

    // Throttle jsQR to ~6Hz — every frame is wasteful and burns battery.
    if (ts - lastTickRef.current < 150) {
      scheduleScan();
      return;
    }
    lastTickRef.current = ts;

    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      scheduleScan();
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) { scheduleScan(); return; }

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);

    const code = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' });
    if (code?.data) {
      const parsed = parseCupQr(code.data);
      if (parsed) {
        handledRef.current = true;
        // Capture the same frame the decode succeeded on as the scan photo.
        const photoDataUrl = compressToJpeg(canvas);
        setPendingCount(
          (parsed.byo || parsed.batchId) ? 1 /* count unknown until server resolves */ : parsed.cupIds.length,
        );
        streamRef.current?.getTracks().forEach(t => t.stop());
        onScan?.(parsed, { scanType: 'camera', photoDataUrl });
        return;
      }
      setHint("That QR isn't a valid PackPerks cup code.");
    }
    scheduleScan();
  }

  if (pendingCount > 0) return <ProcessingOverlay count={pendingCount} />;

  return (
    <div className="receipt-page cup-scan-page">
      <button className="cup-scan__back" onClick={onBack} aria-label="Go back">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </button>

      <div className="receipt-page__header">
        <h1 className="receipt-page__title">Scan your cup QR</h1>
        <p className="receipt-page__subtitle">
          Point your camera at the PackPerks QR on the café counter.
          We'll add a cup to your balance at that venue.
        </p>
      </div>

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
            {/* Square QR-finder target */}
            <div className="cup-scan__qr-target">
              <span className="cup-scan__qr-corner cup-scan__qr-corner--tl" />
              <span className="cup-scan__qr-corner cup-scan__qr-corner--tr" />
              <span className="cup-scan__qr-corner cup-scan__qr-corner--bl" />
              <span className="cup-scan__qr-corner cup-scan__qr-corner--br" />
              <span className="cup-scan__qr-laser" />
            </div>
          </>
        )}
      </div>

      {hint && <p className="cup-scan__hint">{hint}</p>}

      <p className="cup-scan__caption">
        Point your camera at the QR code on the counter and hold steady in good light.
      </p>
    </div>
  );
}
