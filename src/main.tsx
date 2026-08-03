import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/noto-sans-arabic/wght.css'
import '@fontsource-variable/alexandria/wght.css'
import '@fontsource-variable/ibm-plex-sans/wght.css'
import App from './App'
import './index.css'
import { applyStoredTheme } from './components/ThemeToggle'
import { applyStoredAccent } from './lib/theme'
import AppErrorBoundary from './components/AppErrorBoundary'
import { installClientIncidentReporting } from './lib/clientIncident'

applyStoredTheme()
applyStoredAccent()
installClientIncidentReporting()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
)
