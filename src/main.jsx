import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AdminApp from './admin/AdminApp.jsx'
import MockupMaster from './mockup/MockupMaster.jsx'
import ConsentGate from './components/ConsentGate.jsx'
import ModelChooser from './components/ModelChooser.jsx'
import { RegionProvider } from './lib/RegionContext.jsx'

const path = window.location.pathname
const isAdmin = path.startsWith('/admin')
const isMockup = path.startsWith('/mockup')
// The bare root has no venue slug. Show the model chooser instead of booting the
// customer app (which would resolve a fallback org — historically Burger King).
const isRoot = path === '/' || path === ''

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isMockup
      ? <MockupMaster />
      : isAdmin
        ? <AdminApp />
        : isRoot
          ? <ModelChooser />
          : <RegionProvider><ConsentGate><App /></ConsentGate></RegionProvider>}
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
