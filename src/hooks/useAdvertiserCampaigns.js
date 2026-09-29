import { useCallback, useEffect, useState } from 'react'
import { fetchAdvertiserCampaigns } from '../lib/advertiserApi.js'

function toCampaignsError(e) {
  const status = e.status
  if (status === 401) return 'Session expired. Please sign in again.'
  if (status === 404) return 'Campaigns endpoint not found. Check Edge Function deployment.'
  return e.message || 'Could not load campaigns.'
}

export default function useAdvertiserCampaigns() {
  const [state, setState] = useState({ loading: true, campaigns: [], error: '' })

  // Initial load: first setState happens only after the awaited fetch, so
  // the mount effect never synchronously updates state.
  const load = useCallback(async () => {
    try {
      const campaigns = await fetchAdvertiserCampaigns()
      setState({ loading: false, campaigns, error: '' })
    } catch (e) {
      setState({ loading: false, campaigns: [], error: toCampaignsError(e) })
    }
  }, [])

  // Retry path (event handlers): may flip loading synchronously.
  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    await load()
  }, [load])

  useEffect(() => {
    // Async boundary: kick the loader off without synchronously mutating
    // state from the effect body itself.
    void (async () => {
      await load()
    })()
  }, [load])

  return { ...state, refresh, setCampaigns: (campaigns) => setState((s) => ({ ...s, campaigns })) }
}
