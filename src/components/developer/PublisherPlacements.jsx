import { useCallback, useEffect, useState } from 'react'
import { Panel } from '../console/ui.jsx'
import { AdvEmpty, AdvPageHead } from '../advertiser/AdvertiserUI.jsx'
import { provisionPublisher } from '../../lib/publisherApi.js'
import { listPublisherKeys } from '../../lib/publisherKeysApi.js'

export default function PublisherPlacements() {
  const [placements, setPlacements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newPlacement, setNewPlacement] = useState({
    placementKey: '',
    name: '',
    enabled: true,
  })

  // Fetch the publisher's publishable key
  const [publishableKey, setPublishableKey] = useState(null)
  const [fetchingKey, setFetchingKey] = useState(true)
  const [keyError, setKeyError] = useState('')

  // Fetch placements using the publishable key
  const fetchPlacements = useCallback(async () => {
    if (!publishableKey) {
      setError('Publishable key not available')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      // We need to call the CLI placements endpoint with the publishable key
      // We'll create a helper function to do this
      const res = await fetch('/api/cli/placements', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-clirevenue-publisher-key': publishableKey,
        },
      })
      if (!res.ok) {
        throw new Error(`Failed to fetch placements: ${res.status}`)
      }
      const data = await res.json()
      setPlacements(data.placements ?? [])
    } catch (err) {
      console.error('Failed to fetch placements:', err)
      setError('Could not load placements. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [publishableKey])

  // Fetch the publishable key
  const fetchPublishableKey = useCallback(async () => {
    setFetchingKey(true)
    setKeyError('')
    try {
      // First, ensure we have a publisher provisioned
      await provisionPublisher()
      // Now, list the publisher keys to get one that we can use
      const keys = await listPublisherKeys()
      if (keys.length === 0) {
        throw new Error('No publisher keys found')
      }
      // We'll use the first key's publishableKey? But listPublisherKeys doesn't return it.
      // We need to get the publishable key by creating a key if none exists?
      // Actually, we can use the provisionPublisher function to get the key.
      const provisioning = await provisionPublisher()
      if (provisioning.key && provisioning.key.publishableKey) {
        setPublishableKey(provisioning.key.publishableKey)
      } else {
        throw new Error('Could not obtain publishable key')
      }
    } catch (err) {
      console.error('Failed to get publishable key:', err)
      setKeyError('Could not obtain publisher key. Please try again.')
    } finally {
      setFetchingKey(false)
    }
  }, [])

  // Create a new placement
  const createPlacement = useCallback(async () => {
    if (!publishableKey) {
      setError('Publishable key not available')
      return
    }
    if (!newPlacement.placementKey.trim()) {
      setError('Please enter a placement key')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/cli/placements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-clirevenue-publisher-key': publishableKey,
        },
        body: JSON.stringify({
          placementKey: newPlacement.placementKey.trim(),
          name: newPlacement.name.trim() || null,
          enabled: newPlacement.enabled,
        }),
      })
      if (!res.ok) {
        throw new Error(`Failed to create placement: ${res.status}`)
      }
      const data = await res.json()
      // Add the new placement to the list
      setPlacements(prev => [...prev, data.placement])
      setNewPlacement({
        placementKey: '',
        name: '',
        enabled: true,
      })
    } catch (err) {
      console.error('Failed to create placement:', err)
      setError('Could not create placement. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [publishableKey, newPlacement])

  // Effects
  useEffect(() => {
    // Async boundary: kick the loader off without synchronously mutating
    // state from the effect body itself.
    void (async () => {
      await fetchPublishableKey()
    })()
  }, [fetchPublishableKey])

  useEffect(() => {
    // Async boundary: kick the loader off without synchronously mutating
    // state from the effect body itself.
    void (async () => {
      if (publishableKey) {
        await fetchPlacements()
      }
    })()
  }, [publishableKey, fetchPlacements])

  if (fetchingKey) {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Placements"
          title="Loading publisher key…"
        />
        <div className="panel adv-panel" aria-label="Loading">
          <p className="adv-panel__sub">Fetching your publisher key…</p>
        </div>
      </Panel>
    )
  }

  if (keyError) {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Placements"
          title="Error loading publisher key"
        />
        <div className="panel adv-panel" aria-label="Error">
          <p className="adv-panel__sub">{keyError}</p>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={fetchPublishableKey}
          >
            Try again
          </button>
        </div>
      </Panel>
    )
  }

  if (!publishableKey) {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Placements"
          title="Publisher key not available"
        />
        <div className="panel adv-panel" aria-label="Empty">
          <p className="adv-panel__sub">Unable to obtain your publisher key. Please check your account.</p>
        </div>
      </Panel>
    )
  }

  if (loading) {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Placements"
          title="Loading placements…"
        />
        <div class="panel adv-panel" aria-label="Loading">
          <p className="adv-panel__sub">Fetching your placements…</p>
        </div>
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Placements"
          title="Error loading placements"
        />
        <div class="panel adv-panel" aria-label="Error">
          <p className="adv-panel__sub">{error}</p>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={fetchPlacements}
          >
            Try again
          </button>
        </div>
      </Panel>
    )
  }

  return (
    <>
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Placements"
          title="Manage your placements"
          body="Each placement represents a named advertising surface on your publisher account. You can create additional placements for different sections of your site."
        />
        <div className="panel adv-panel" aria-label="Placements list">
          {placements.length === 0 ? (
            <AdvEmpty
              mark="No placements"
              title="You have no placements yet"
              body="A placement is a named slot on your publisher’s surface. Create your first placement to get started."
              actionLabel="Create a placement"
              onAction={() => setCreating(true)}
            />
          ) : (
            <>
              <div className="setup__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setCreating(true)}
                >
                  Create new placement
                </button>
              </div>
              <table className="key-table">
                <thead>
                  <tr>
                    <th>Placement Key</th>
                    <th>Name</th>
                    <th>Enabled</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {placements.map((placement) => (
                    <tr key={placement.id}>
                      <td>
                        <code className="key-prefix">{placement.key}</code>
                      </td>
                      <td>{placement.name || '—'}</td>
                      <td>
                        {placement.enabled ? (
                          <span className="badge badge--outline badge--live">
                            Enabled
                          </span>
                        ) : (
                          <span className="badge badge--outline badge--error">
                            Disabled
                          </span>
                        )}
                      </td>
                      <td>
                        {/* We cannot update or delete placements via the publisher-facing endpoints */}
                        {/* So we only show the placement and note that modifications are not available */}
                        <span className="setup__note">
                          View only — edit via <code>clirevenue editor</code>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Panel>

      {creating && (
        <Panel className="adv-panel">
          <AdvPageHead
            index="D?"
            label="Placements"
            title="Creating a new placement"
          />
          <div className="panel adv-panel" aria-label="Creating placement">
            <p className="adv-panel__sub">
              Enter a placement key (e.g., "homepage-banner", "sidebar-ad") and a name.
            </p>
            <div className="setup__keyplate">
              <div className="setup__fact-row">
                <span className="setup__fact-label">Placement key</span>
                <div className="setup__keyrow">
                  <input
                    type="text"
                    value={newPlacement.placementKey}
                    onChange={(e) => setNewPlacement({ ...newPlacement, placementKey: e.target.value })}
                    placeholder="e.g., homepage-banner"
                    className="input input--text input--md"
                  />
                </div>
                <p className="setup__note">
                  Lowercase letters, digits, hyphens and underscores only. Must start with a letter or digit.
                </p>
              </div>
              <div className="setup__fact-row">
                <span className="setup__fact-label">Name</span>
                <div className="setup__keyrow">
                  <input
                    type="text"
                    value={newPlacement.name}
                    onChange={(e) => setNewPlacement({ ...newPlacement, name: e.target.value })}
                    placeholder="e.g., Homepage Banner"
                    className="input input--text input--md"
                  />
                </div>
              </div>
              <div className="setup__fact-row">
                <span className="setup__fact-label">Enabled</span>
                <div className="setup__keyrow">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={newPlacement.enabled}
                      onChange={(e) => setNewPlacement({ ...newPlacement, enabled: e.target.checked })}
                    />
                    <span className="toggle__slider" aria-hidden="true"></span>
                  </label>
                </div>
              </div>
              <div className="setup__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={createPlacement}
                  disabled={creating}
                >
                  {creating ? 'Creating…' : 'Create placement'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              </div>
               {error && (
                 <p className="setup__text-error">
                   {error}
                 </p>
               )}
            </div>
          </div>
        </Panel>
      )}
    </>
  )
}