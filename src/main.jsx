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
