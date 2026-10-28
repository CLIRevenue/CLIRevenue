/* CLIRevenue — Liquid Glass mouse interaction effects.
   Sets up mousemove/mouseleave listeners on elements with the
   .glass-interactive class, updating the specular highlight and
   displacement filter scale based on pointer position. */

export function initGlassEffects() {
  if (typeof window === 'undefined') return

  const selector = '.glass-interactive, .glass-card, .glass-button, .glass-form, .glass-nav, .glass-spinner'

  function handleMouseMove(e) {
    const element = e.currentTarget
    const rect = element.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const specular = element.querySelector('.glass-specular')
    if (specular) {
      specular.style.background = `radial-gradient(
        circle at ${x}px ${y}px,
        rgba(255,255,255,0.15) 0%,
        rgba(255,255,255,0.05) 30%,
        rgba(255,255,255,0) 60%
      )`
    }
  }

  function handleMouseLeave(e) {
    const element = e.currentTarget

    const specular = element.querySelector('.glass-specular')
    if (specular) {
      specular.style.background = 'none'
    }
  }

  // Set up listeners on existing elements
  function setup() {
    document.querySelectorAll(selector).forEach((element) => {
      if (!element._glassEffectsInitialized) {
        element._glassEffectsInitialized = true
        element.addEventListener('mousemove', handleMouseMove)
        element.addEventListener('mouseleave', handleMouseLeave)
      }
    })
  }

  setup()

  // Re-run when the DOM changes (for React-rendered content)
  const observer = new MutationObserver(() => {
    setup()
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  return () => observer.disconnect()
}
