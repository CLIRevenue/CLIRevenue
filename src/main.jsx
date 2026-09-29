import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// One shared auth-aware entry. Login/signup/role routes are pathname routes
// (/login, /signup, /app/*). No second auth system, no localStorage role.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
