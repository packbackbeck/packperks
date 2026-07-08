import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AdminApp from './admin/AdminApp.jsx'
import MockupMaster from './mockup/MockupMaster.jsx'
import ConsentGate from './components/ConsentGate.jsx'

const path = window.location.pathname
const isAdmin = path.startsWith('/admin')
const isMockup = path.startsWith('/mockup')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isMockup
      ? <MockupMaster />
      : isAdmin
        ? <AdminApp />
        : <ConsentGate><App /></ConsentGate>}
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
