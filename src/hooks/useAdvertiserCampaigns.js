import { useCallback, useEffect, useState } from 'react'
import { fetchAdvertiserCampaigns } from '../lib/advertiserApi.js'
import { campaignErrorMessage } from '../lib/campaignErrors.js'

function toCampaignsError(e) {
  return campaignErrorMessage(e, 'Could not load campaigns.')
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

  const upsertCampaign = useCallback((campaign) => {
    if (!campaign?.id) return
    setState((s) => {
      const idx = s.campaigns.findIndex((c) => c.id === campaign.id)
      const campaigns = idx >= 0
        ? s.campaigns.map((c, i) => (i === idx ? { ...c, ...campaign } : c))
        : [campaign, ...s.campaigns]
      return { ...s, campaigns, error: '' }
    })
  }, [])

  return {
    ...state,
    refresh,
    upsertCampaign,
    setCampaigns: (campaigns) => setState((s) => ({ ...s, campaigns })),
  }
}
