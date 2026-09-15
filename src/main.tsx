import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

window.__READY__ = false
window.__LAST_ERROR__ = null

window.addEventListener('error', (event) => {
  window.__LAST_ERROR__ = event.error?.stack || event.message || 'Unknown runtime error'
})
window.addEventListener('unhandledrejection', (event) => {
  window.__LAST_ERROR__ = String(event.reason?.stack || event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
