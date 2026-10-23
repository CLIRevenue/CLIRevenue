import { useEffect, useRef } from 'react'
import useAppRoute from './useAppRoute.js'
import { registerPageView } from '../lib/siteStatsApi.js'

export function usePageViewTracking() {
  const route = useAppRoute()
  const isFirstVisit = useRef(true)
  const currentPathRef = useRef('')

  useEffect(() => {
    const cleanPath = route?.clean || '/'
    
    if (currentPathRef.current === window.location.pathname) {
      return
    }
    currentPathRef.current = window.location.pathname

    const tracked = sessionStorage.getItem('clirevenue.view_event' + window.location.pathname)
    if (tracked) return

    import('../lib/siteStatsApi.js').then(({ registerPageView }) => {
      registerPageView().then(() => {
        sessionStorage.setItem('clirevenue.view_event' + window.location.pathname, '1')
      }).catch(() => {
        // silently ignore
      })
    }).catch(() => {
      // silently ignore
    })
  }, [])
}