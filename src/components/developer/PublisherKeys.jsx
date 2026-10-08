import { useCallback, useEffect, useState } from 'react'
import { Panel } from '../console/ui.jsx'
import { AdvEmpty, AdvPageHead } from '../advertiser/AdvertiserUI.jsx'
import CopyButton from '../CopyButton.jsx'
import { listPublisherKeys, createPublisherKey, revokePublisherKey } from '../../lib/publisherKeysApi.js'

/* Status vocabulary */
const OUTCOME = {
  idle: { tone: 'idle', label: 'Idle' },
  loading: { tone: 'busy', label: 'Loading…' },
  ready: { tone: 'ok', label: 'Ready' },
  error: { tone: 'warn', label: 'Error' },
  creating: { tone: 'busy', label: 'Creating…' },
  created: { tone: 'ok', label: 'Created!' },
  revoking: { tone: 'busy', label: 'Revoking…' },
  revoked: { tone: 'ok', label: 'Revoked!' },
}

const MASK = '•'.repeat(16)

export default function PublisherKeys() {
  const [tab, setTab] = useState('list') // 'list' or 'creating'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [keys, setKeys] = useState([])
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState(null) // { key: ..., rawKey: string }
  const [revokingKeyId, setRevokingKeyId] = useState(null) // keyId being revoked
  const [newLabel, setNewLabel] = useState('')

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const keyList = await listPublisherKeys()
      setKeys(keyList)
      setError(null)
    } catch (err) {
      console.error('Failed to list publisher keys:', err)
      setError('Could not load publisher keys. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleCreateKey = useCallback(async () => {
    if (!newLabel.trim()) {
      setError('Please enter a label for the new key')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const result = await createPublisherKey(newLabel)
      setCreatedKey(result)
      setTab('created')
      setCreating(false)
      // Optionally, we can clear the label and refetch keys after a delay
      // but we keep the created key visible until the user dismisses it.
    } catch (err) {
      console.error('Failed to create publisher key:', err)
      setError('Could not create publisher key. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [newLabel])

  const handleRevokeKey = useCallback(async (keyId) => {
    setRevokingKeyId(keyId)
    setError(null)
    try {
      await revokePublisherKey(keyId)
      // Remove the key from the list optimistically
      setKeys(prev => prev.filter(k => k.id !== keyId))
      setRevokingKeyId(null)
      // Optionally show a temporary success message
    } catch (err) {
      console.error('Failed to revoke publisher key:', err)
      setError('Could not revoke publisher key. Please try again.')
    } finally {
      setRevokingKeyId(null)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const handleDismissCreated = useCallback(() => {
    setTab('list')
    setCreatedKey(null)
    // Optionally refetch keys to see the new key in the list
    fetchKeys()
  }, [fetchKeys])

  const handleNewLabelChange = useCallback((e) => {
    setNewLabel(e.target.value)
    setError(null)
  }, [])

  if (loading) {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Publisher Keys"
          title="Loading publisher keys…"
        />
        <div className="panel adv-panel" aria-label="Loading">
          <p className="adv-panel__sub">Fetching your publisher keys…</p>
        </div>
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Publisher Keys"
          title="Error loading publisher keys"
        />
        <div className="panel adv-panel" aria-label="Error">
          <p className="adv-panel__sub">{error}</p>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={fetchKeys}
          >
            Try again
          </button>
        </div>
      </Panel>
    )
  }

  if (tab === 'creating') {
    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Publisher Keys"
          title="Creating a new publisher key"
        />
        <div className="panel adv-panel" aria-label="Creating key">
          <p className="adv-panel__sub">
            Enter a label for the new key (e.g., "Production site", "Staging blog").
          </p>
          <div className="setup__keyplate">
            <span className="setup__fact-label">Label</span>
            <div className="setup__keyrow">
              <input
                type="text"
                value={newLabel}
                onChange={handleNewLabelChange}
                placeholder="e.g., Production site"
                className="input input--text input--md"
              />
            </div>
          </div>
          <div className="setup__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleCreateKey}
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create key'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setTab('list')}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="setup__note" style={{ color: '#dc2626' }}>
              {error}
            </p>
          )}
        </div>
      </Panel>
    )
  }

  if (tab === 'created') {
    const { key, rawKey } = createdKey
    const fragment = key?.key_prefix || null
    const display = rawKey
      ? `${rawKey.slice(0, 8)}${MASK}`
      : `${fragment || 'pk_test_'}${MASK}`

    return (
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Publisher Keys"
          title="Publisher key created"
        />
        <div className="panel adv-panel" aria-label="Key created">
          <p className="adv-panel__sub">
            Your new publisher key has been created. The full key is shown below
            and will never be displayed again. Copy it now.
          </p>

          <div className="setup__keyplate">
            <span className="setup__fact-label">Publishable key</span>
            <div className="setup__keyrow">
              <code className="setup__keyvalue" data-masked="no">
                {display}
              </code>
              <span className="setup__keyactions">
                <CopyButton text={rawKey} label="key" baseClass="setup__copy" />
              </span>
            </div>
            <p className="setup__note">
              Copy it now. Only the SHA-256 hash is stored, so this is the one
              time the full value exists outside your browser — a reload of this
              page will bring back the fragment, not the key.
            </p>
          </div>

          <div className="setup__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={handleDismissCreated}
            >
              I've copied the key
            </button>
          </div>
        </div>
      </Panel>
    )
  }

  // Default tab: list
  return (
    <>
      <Panel className="adv-panel">
        <AdvPageHead
          index="D?"
          label="Publisher Keys"
          title="Manage your publisher keys"
        />
        <div className="panel adv-panel" aria-label="Publisher keys">
          <p className="adv-panel__sub">
            Each key represents a separate integration or installation. You can
            create additional keys for different environments or services, and
            revoke keys that are no longer in use.
          </p>
          {keys.length === 0 ? (
            <AdvEmpty
              mark="No keys"
              title="You have no publisher keys yet"
              body="A publisher key is what authorizes your SDK integrations to request ads. Create your first key to get started."
              actionLabel="Create a key"
              onAction={() => setTab('creating')}
            />
          ) : (
            <>
              <div className="setup__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setTab('creating')}
                >
                  Create new key
                </button>
              </div>
              <table className="key-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Key Prefix</th>
                    <th>Created</th>
                    <th>Last Used</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.label || '-'}</td>
                      <td>
                        <code className="key-prefix">{key.key_prefix}</code>
                      </td>
                      <td>{new Date(key.created_at).toLocaleString()}</td>
                      <td>
                        {key.last_used_at ? (
                          new Date(key.last_used_at).toLocaleString()
                        ) : (
                          <span className="text--muted">Never</span>
                        )}
                      </td>
                      <td>
                        {key.revoked_at ? (
                          <span className="badge badge--outline badge--error">
                            Revoked
                          </span>
                        ) : (
                          <span className="badge badge--outline badge--live">
                            Active
                          </span>
                        )}
                      </td>
                      <td>
                        {key.revoked_at ? null : (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleRevokeKey(key.id)}
                            disabled={revokingKeyId === key.id}
                          >
                            {revokingKeyId === key.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Panel>
    </>
  )
}
