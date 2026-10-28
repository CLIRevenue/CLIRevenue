import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function LiquidChromeBackground() {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x020203)

    const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100)
    camera.position.set(0, 0, 14)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    container.appendChild(renderer.domElement)

    function createEnvironment() {
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 512
      const ctx = canvas.getContext('2d')
      const bg = ctx.createLinearGradient(0, 0, 1024, 512)
      bg.addColorStop(0.0, '#08090d')
      bg.addColorStop(0.15, '#777b83')
      bg.addColorStop(0.23, '#eee6d7')
      bg.addColorStop(0.30, '#9ae0d8')
      bg.addColorStop(0.39, '#29303b')
      bg.addColorStop(0.5, '#08090e')
      bg.addColorStop(0.61, '#d9cbbb')
      bg.addColorStop(0.69, '#81989a')
      bg.addColorStop(0.8, '#272832')
      bg.addColorStop(0.91, '#777980')
      bg.addColorStop(1.0, '#08090d')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, 1024, 512)
      const boxes = [
        { x: 80, y: 35, w: 120, h: 420, color: 'rgba(255,255,255,0.88)' },
        { x: 300, y: 10, w: 105, h: 320, color: 'rgba(103,248,239,0.72)' },
        { x: 575, y: 45, w: 160, h: 390, color: 'rgba(255,218,192,0.84)' },
        { x: 850, y: 10, w: 75, h: 300, color: 'rgba(163,145,255,0.62)' },
      ]
      for (const box of boxes) {
        const gradient = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0)
        gradient.addColorStop(0, 'rgba(255,255,255,0)')
        gradient.addColorStop(0.5, box.color)
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(box.x, box.y, box.w, box.h)
      }
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.mapping = THREE.EquirectangularReflectionMapping
      return texture
    }

    scene.environment = createEnvironment()
    scene.environmentIntensity = 1.45

    scene.add(new THREE.HemisphereLight(0xe3f4ff, 0x151219, 1.5))

    function addLight(color, intensity, position) {
      const light = new THREE.PointLight(color, intensity, 45)
      light.position.set(...position)
      scene.add(light)
      return light
    }
    addLight(0xffffff, 100, [-4, 5, 7])
    addLight(0x78eae7, 55, [5, 1, 4])
    addLight(0xffc0a4, 45, [-2, -4, 5])
    addLight(0x9685ff, 35, [3, 4, -3])

    const chromeMaterial = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1, roughness: 0.19, envMapIntensity: 1.8 })
    const bevelMaterial = new THREE.MeshStandardMaterial({ color: 0x666c76, metalness: 1, roughness: 0.24, envMapIntensity: 1.65 })
    const polishedMaterial = new THREE.MeshStandardMaterial({ color: 0xe7e7e3, metalness: 1, roughness: 0.13, envMapIntensity: 2 })
    const undersideMaterial = new THREE.MeshStandardMaterial({ color: 0x292d36, metalness: 1, roughness: 0.28, envMapIntensity: 1.5 })

    function createRing(options) {
      const outerGroup = new THREE.Group()
      outerGroup.position.set(options.x, options.y, options.z)
      outerGroup.rotation.set(options.rx, options.ry, options.rz)
      scene.add(outerGroup)
      const spinGroup = new THREE.Group()
      outerGroup.add(spinGroup)
      const radius = options.radius
      const tube = options.tube
      const segments = 320
      const body = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 48, segments), chromeMaterial)
      spinGroup.add(body)
      const outer = new THREE.Mesh(new THREE.TorusGeometry(radius, tube * 1.045, 28, segments), bevelMaterial)
      outer.position.z = -tube * 0.1
      spinGroup.add(outer)
      const inner = new THREE.Mesh(new THREE.TorusGeometry(radius, tube * 0.9, 28, segments), polishedMaterial)
      inner.position.z = tube * 0.18
      spinGroup.add(inner)
      const underside = new THREE.Mesh(new THREE.TorusGeometry(radius, tube * 0.96, 20, segments), undersideMaterial)
      underside.position.z = -tube * 0.28
      spinGroup.add(underside)
      return { outerGroup, spinGroup, speed: options.speed }
    }

    const rearRing = createRing({ radius: 4.5, tube: 0.31, x: -2.45, y: 1.95, z: -1.25, rx: 1.02, ry: -0.34, rz: -0.4, speed: 0.32 })
    const frontRing = createRing({ radius: 4.6, tube: 0.42, x: 2.0, y: -1.85, z: 0.55, rx: 0.83, ry: 0.2, rz: 0.31, speed: -0.24 })
    const rings = [rearRing, frontRing]

    let frameId = 0
    let stopped = false

    function animate() {
      if (stopped) return
      frameId = requestAnimationFrame(animate)
      if (!reduceMotion) {
        const t = performance.now() * 0.001
        for (const r of rings) {
          r.spinGroup.rotation.x += r.speed * 0.005
        }
        // subtle camera drift
        camera.position.x = Math.sin(t * 0.15) * 0.3
        camera.position.y = Math.cos(t * 0.12) * 0.2
        camera.lookAt(0, 0, 0)
      }
      renderer.render(scene, camera)
    }

    function handleResize() {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', handleResize)

    animate()

    return () => {
      stopped = true
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
      scene.traverse((object) => {
        if (object.isMesh) {
          object.geometry.dispose()
        }
      })
      chromeMaterial.dispose()
      bevelMaterial.dispose()
      polishedMaterial.dispose()
      undersideMaterial.dispose()
      if (scene.environment) scene.environment.dispose()
      renderer.dispose()
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div className="liquid-chrome-bg" aria-hidden="true">
      <div className="liquid-chrome-bg__scene" ref={containerRef} />
      <div className="liquid-chrome-bg__vignette" />
    </div>
  )
}

export default LiquidChromeBackground
