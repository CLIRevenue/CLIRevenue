import { useEffect, useState } from 'react'
import { AdvStats } from './AdvertiserUI.jsx'
import { formatCredits } from '../../lib/advertiserApi.js'
import useAppRoute, { navigateApp } from '../../hooks/useAppRoute.js'

const STAR_SVG = (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path d="M12 2l1 4h4l-3 3 1 4-4-3-4 3 1-4h4L12 2z" fill="currentColor" />
  </svg>
)

const SPARKLE_SVG = (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M8 1l1 3h3l-2 2 1 3-3-2-3 2 1-3-3-2h3z" fill="currentColor" />
  </svg>
)

export default function WelcomeOverlay({ wallet, onDismiss }) {
  const [show, setShow] = useState(false)
  const [burst, setBurst] = useState(false)
  const route = useAppRoute()

  useEffect(() => {
    const hasSeen = window.localStorage.getItem('welcomeOverlayShown')
    if (!hasSeen) {
      setShow(true)
      setBurst(true)
      setTimeout(() => setBurst(false), 800)
    }
  }, [wallet, onDismiss])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const available = wallet?.balance_credits ?? 250

  const handleStart = () => {
    navigateApp('/app/advertiser/campaigns')
    dismiss()
  }

  const dismiss = () => {
    window.localStorage.setItem('welcomeOverlayShown', 'true')
    setShow(false)
    onDismiss?.()
  }

  if (!show) return null

  const stars = Array.from({ length: 8 }).map((_, i) => ({
    angle: (i / 8) * Math.PI * 2,
    delay: i * 50,
  }))

  return (
    <div
      className="glass-overlay-full"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div className="glass-card">
        {/* SVG filter from index.html */}
        <svg style={{ display: 'none' }} />

        {/* Star burst */}
        {burst && (
          <div className="welcome-overlay__burst" aria-hidden="true">
            {stars.map((s, i) => (
              <div
                key={i}
                className="welcome-overlay__star"
                style={{
                  '--angle': `${s.angle}rad`,
                  '--delay': `${s.delay}ms`,
                }}
              >
                {STAR_SVG}
              </div>
            ))}
          </div>
        )}

        {/* Sparkle particles */}
        <div className="welcome-overlay__sparkles" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="welcome-overlay__sparkle"
              style={{
                '--i': i,
                '--delay': `${(i * 200) % 3000}ms`,
              }}
            >
              {SPARKLE_SVG}
            </div>
          ))}
        </div>

        <div className="glass-content">
          <h1 id="welcome-title" className="welcome-overlay__title">
            🎉 Welcome to CLIRevenue! 🎉
          </h1>

          <p className="welcome-overlay__subtitle">
            You&apos;ve been gifted
          </p>

          <div className="welcome-overlay__credit">
            <span className="welcome-overlay__amount">250</span>
            <span className="welcome-overlay__unit">FREE CREDITS</span>
          </div>

          <p className="welcome-overlay__tagline">
            ✨ Start your first campaign and watch it grow! ✨
          </p>

          <AdvStats
            items={[
              {
                label: 'Welcome Bonus',
                value: '₹250.00',
                hint: 'instantly available',
                tone: 'live',
              },
              {
                label: 'Total Balance',
                value: formatCredits(250),
                hint: 'ready to spend',
                tone: 'settling',
              },
            ]}
          />

          <div className="welcome-overlay__actions">
            <button
              type="button"
              className="glass-button welcome-overlay__cta"
              onClick={handleStart}
            >
              <span>🚀 Start My First Campaign</span>
            </button>
            <button
              type="button"
              className="glass-button welcome-overlay__dismiss"
              onClick={dismiss}
            >
              <span>Maybe Later</span>
            </button>
          </div>

          <p className="welcome-overlay__note">
            Credits never expire. Use them for any campaign.
          </p>
        </div>
      </div>
    </div>
  )
}
