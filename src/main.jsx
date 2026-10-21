import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// The theme is committed before render: `light-theme` is a real class in
// index.css (matched token-for-token by its dark :root), and applying it on
// the document element before React mounts means the chosen paper -- and
// every token it carries -- paints once, without a dark-first flash. The
// OS preference is read once at load; no listener, no store, no toggle.
if (window.matchMedia('(prefers-color-scheme: light)').matches) {
  document.documentElement.classList.add('light-theme')
}
import App from './App.jsx'

// One shared auth-aware entry. Login/signup/role routes are pathname routes
// (/login, /signup, /app/*). No second auth system, no localStorage role.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
