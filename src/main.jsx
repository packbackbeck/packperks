import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AdminApp from './admin/AdminApp.jsx'
import MockupMaster from './mockup/MockupMaster.jsx'
import ConsentGate from './components/ConsentGate.jsx'
import ModelChooser from './components/ModelChooser.jsx'
import SupportForm from './components/SupportForm.jsx'
import { RegionProvider } from './lib/RegionContext.jsx'
import CollectPreview from './components/CollectPreview.jsx'

const path = window.location.pathname
const isAdmin = path.startsWith('/admin')
const isMockup = path.startsWith('/mockup')
// Standalone contact-support pages. /vendor-support is intentionally unlinked —
// share the URL directly with vendors. (Check vendor first: distinct prefixes.)
const isVendorSupport = path.startsWith('/vendor-support')
const isSupport = path.startsWith('/support')
// The bare root has no venue slug. Show the model chooser instead of booting the
// customer app (which would resolve a fallback org — historically Burger King).
const isRoot = path === '/' || path === ''

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isMockup
      ? <MockupMaster />
      : isAdmin
        ? <AdminApp />
        : isVendorSupport
          ? <SupportForm audience="vendor" />
          : isSupport
            ? <SupportForm audience="user" />
            : isRoot
              ? <ModelChooser />
              : <RegionProvider>
                  <ConsentGate><App /></ConsentGate>
                  {/* Dev-only: ?collect=<amount> previews the collect sheet
                      over the live store, so the payout screen can be shown
                      without an approved claim to hand. Stripped in prod. */}
                  <CollectPreview />
                </RegionProvider>}
  </StrictMode>,
)

// Register the service worker for the customer app only (not admin/mockup) so
// browser push + "Add to Home Screen" install work. The SW has no fetch/cache
// handler, so it's HMR-safe. Real push delivery is wired in Phase 2.
if ('serviceWorker' in navigator && !isAdmin && !isMockup) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
  })
}
