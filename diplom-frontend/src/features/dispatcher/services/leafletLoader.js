export function loadLeafletAssets() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser context'))
  if (window.L) return Promise.resolve(window.L)
  if (window.__leafletPromise) return window.__leafletPromise

  window.__leafletPromise = new Promise((resolve, reject) => {
    const cssId = 'leaflet-cdn-css'
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link')
      link.id = cssId
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.crossOrigin = ''
      document.head.appendChild(link)
    }

    const scriptId = 'leaflet-cdn-js'
    const existingScript = document.getElementById(scriptId)

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.L), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Leaflet script load failed')), {
        once: true,
      })
      return
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.async = true
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet unavailable')))
    script.onerror = () => reject(new Error('Leaflet script load failed'))

    document.body.appendChild(script)
  })

  return window.__leafletPromise
}
