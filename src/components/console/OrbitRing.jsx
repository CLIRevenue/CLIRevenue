/* =============================================================
   CLIRevenue — the agent drum (Redesigned)
   -------------------------------------------------------------
   A redesigned drum component using CSS and the new design system.
   Replaces the WebGL implementation with a CSS-based visualization
   that uses the CLIRevenue Telemetry Architecture design tokens.
   ============================================================= */

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion.js'
import { adSlot } from '../../data/demo.js'

gsap.registerPlugin(ScrollTrigger)

const DRUM_SEGMENTS = 8
const SEGMENT_DATA = [
  { name: 'CLAUDE CODE', category: 'AI CODING AGENT', provider: 'ANTHROPIC', status: 'ACTIVE', logoColor: '#D97757' },
  { name: 'CODEX', category: 'CODING AGENT', provider: 'OPENAI', status: 'READY', logoColor: '#ffffff' },
  { name: 'CLINE', category: 'VS CODE AGENT', provider: 'CLINE', status: 'ACTIVE', logoColor: '#ffffff' },
  { name: 'OPENCODE', category: 'TERMINAL AGENT', provider: 'OPEN SOURCE', status: 'READY', logoColor: '#ffffff' },
  { name: 'GEMINI CLI', category: 'AI CODING AGENT', provider: 'GOOGLE', status: 'READY', logoColor: '#5B8DEF' },
  { name: 'AIDER', category: 'PAIR PROGRAMMING', provider: 'OPEN SOURCE', status: 'ACTIVE', logoColor: '#14B014' },
  { name: 'COPILOT CLI', category: 'CODE SUGGESTIONS', provider: 'GITHUB', status: 'READY', logoColor: '#ffffff' },
  { name: 'LOCAL / SELF-HOSTED', category: 'LOCAL RUNTIME', provider: 'OLLAMA · LLAMA.CPP', status: 'READY', logoColor: '#ffffff' }
]

function OrbitRing() {
  const containerRef = useRef(null)
  const [progress, setProgress] = useState(0)
  const isReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (isReducedMotion) return

    const container = containerRef.current
    if (!container) return

    // Create ScrollTrigger for drum rotation
    const scrollTrigger = ScrollTrigger.create({
      trigger: container,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => {
        setProgress(self.progress)
      }
    })

    // Cleanup
    return () => {
      scrollTrigger.kill()
    }
  }, [isReducedMotion])

  if (isReducedMotion) {
    // Static fallback for reduced motion
    return (
      <div className="orbit-ring-reduced" ref={containerRef}>
        <div className="orbit-ring-content">
          {SEGMENT_DATA.map((segment, index) => (
            <div key={index} className="orbit-segment">
              <div className="orbit-segment-label">{segment.name}</div>
              <div className="orbit-segment-status">{segment.status}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="orbit-ring" ref={containerRef}>
      <div className="orbit-ring-container">
        <div className="orbit-ring-content" style={{ transform: `rotateY(${progress * 360}deg)` }}>
          {SEGMENT_DATA.map((segment, index) => {
            const angle = (index / DRUM_SEGMENTS) * 360
            const opacity = Math.abs(Math.cos((angle - progress * 360) * Math.PI / 180))
            const scale = 0.8 + 0.2 * opacity
            
            return (
              <div 
                key={index} 
                className="orbit-segment"
                style={{
                  transform: `rotateY(${angle}deg) translateZ(200px) rotateY(${-angle}deg) scale(${scale})`,
                  opacity: 0.3 + 0.7 * opacity
                }}
              >
                <div className="orbit-segment-face">
                  <div className="orbit-segment-logo" style={{ backgroundColor: segment.logoColor }}>
                    {segment.name.charAt(0)}
                  </div>
                  <div className="orbit-segment-label">{segment.name}</div>
                  <div className="orbit-segment-category">{segment.category}</div>
                  <div className="orbit-segment-provider">{segment.provider}</div>
                  <div className="orbit-segment-status">{segment.status}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default OrbitRing