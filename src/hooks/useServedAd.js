/* =============================================================
   CLIRevenue — the served-ad hook
   -------------------------------------------------------------
   This is the whole data layer behind a virtual ad surface, and it is
   deliberately thin: request the ad, wait for it to become viewable,
   and let go. It never renders, never measures money, and never
   decides which advertiser won.

   The states it exposes are the ones the slot has to be able to speak:

     loading   a request is in flight
     ready     an ad was served and the SDK is watching it for viewability
     nofill    the server had nothing to sell — inventory, not failure
     error     the request was rejected or could not be answered
     offline   the request could not leave the device
     disabled  this build may not ask for ads at all

   `nofill` and `offline` are not error branches dressed up as success.
   A 204 is the server answering correctly with an empty shelf, and the
   slot says so in the same typeface it uses for everything else.

   Delivery state lives in one object keyed by a request token, rather
   than in three independent useState calls. When the placement or a
   retry changes the token, the render that notices the difference also
   resets the object, so the effect below never writes state during its
   own body — only from a promise callback, which is where an answer
   actually comes from.
   ============================================================= */

import { useCallback, useEffect, useRef, useState } from 'react'

import { PLACEMENTS } from '../data/placements.js'
import { disposeClient, getClient } from '../lib/clirevenue.js'

export const AD_STATE = {
  LOADING: 'loading',
  READY: 'ready',
  NOFILL: 'nofill',
  ERROR: 'error',
  OFFLINE: 'offline',
  DISABLED: 'disabled',
}

const offlineDevice = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false

function describeFailure(error) {
  if (!error) return null
  return {
    name: typeof error.name === 'string' && error.name ? error.name : 'Error',
    message: String(error.message ?? error).slice(0, 240),
  }
}

/* Exported so the mapping from a failure to a slot state can be tested
   without a DOM. `online` is the browser's own claim about the network;
   pass what the caller observed. */
export function classifyAdFailure(error, online = true) {
  if (!online) return AD_STATE.OFFLINE
  if (error && error.name === 'CLIRevenueNetworkError') return AD_STATE.OFFLINE
  return AD_STATE.ERROR
}

export function describeAdFailure(error) {
  return describeFailure(error)
}

/* Activating the slot's control reports a click only when the ad has
   somewhere to send the visitor. `landingUrl` is nullable in the served
   contract, and without one the control is a plain button that expands the
   detail panel — a disclosure, not a click-through. Exported as a pure
   predicate so the rule is directly testable rather than buried in a
   callback, and so a component module need not export anything but a
   component. */
export function activationReportsClick(state, served) {
  return state === AD_STATE.READY && Boolean(served) && Boolean(served.ad.landingUrl)
}

const OFF = { token: 'off', state: AD_STATE.DISABLED, served: null, failure: null }

export function useServedAd(placementId) {
  const placement = PLACEMENTS[placementId] || null
  const containerRef = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [current, setCurrent] = useState(OFF)

  const retry = useCallback(() => setAttempt((previous) => previous + 1), [])

  const client = getClient()
  const placementKey = placement && placement.delivery !== false ? placement.key : null
  const enabled = Boolean(placementKey) && Boolean(client)
  const token = enabled ? `${placementKey}#${attempt}` : OFF.token

  /* A new request, or a build that may not ask for ads, resets the
     surface. Doing it here rather than in the effect keeps the effect
     body free of synchronous writes. */
  if (current.token !== token) {
    setCurrent({ token, state: enabled ? AD_STATE.LOADING : AD_STATE.DISABLED, served: null, failure: null })
  }

  /* Delivery. The cache in the SDK collapses a remount inside its
     60-second window into the same request, and the idempotency key is
     stable across retries, so a slow network cannot turn one view into
     two impressions. */
  useEffect(() => {
    if (!enabled) return undefined

    const requestToken = token
    const key = placementKey
    let cancelled = false

    Promise.resolve()
      .then(() => client.getAd(key))
      .then(
        (ad) => {
          if (cancelled) return
          setCurrent((previous) => {
            if (previous.token !== requestToken) return previous
            return {
              token: requestToken,
              state: ad ? AD_STATE.READY : AD_STATE.NOFILL,
              served: ad || null,
              failure: null,
            }
          })
        },
        (error) => {
          if (cancelled) return
          setCurrent((previous) => {
            if (previous.token !== requestToken) return previous
            return {
              token: requestToken,
              state: classifyAdFailure(error, !offlineDevice()),
              served: null,
              failure: describeFailure(error),
            }
          })
        },
      )

    return () => {
      cancelled = true
    }
  }, [client, enabled, placementKey, token])

  const { state, served, failure } = current

  /* Viewability. The SDK owns the threshold and the dwell timer; this
     hook only hands it an element and stands aside. */
  useEffect(() => {
    if (state !== AD_STATE.READY || !served) return undefined
    const node = containerRef.current
    if (!node || !client) return undefined
    return client.watchViewability(served, node)
  }, [client, state, served])

  /* Unmount. The client holds observers and a window listener; leaving
     either attached would keep a destroyed impression firing into a
     surface that no longer exists. `getClient()` rebuilds on demand, so
     this is safe and idempotent. */
  useEffect(() => () => disposeClient(), [])

  const copy =
    state === AD_STATE.READY
      ? null
      : (placement && (placement[state] || placement.loading)) || null

  return {
    state,
    served,
    failure,
    retry,
    containerRef,
    copy,
    headline: (copy && copy.headline) || '',
    support: (copy && copy.support) || '',
  }
}

export default useServedAd
