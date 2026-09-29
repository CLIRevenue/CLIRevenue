import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

const ROLE_HOME = {
  advertiser: '/app/advertiser',
  developer: '/app/developer',
  admin: '/app/admin',
}

export function roleHome(role) {
  return ROLE_HOME[role] || null
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
