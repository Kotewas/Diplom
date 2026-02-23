// Функция динамически загружает библиотеку Leaflet (CSS + JS) через CDN
  export function loadLeafletAssets() {
  // Проверка: код должен выполняться только в браузере
  if (typeof window === 'undefined')
    return Promise.reject(new Error('No browser context'))

  // Если Leaflet уже загружен — сразу возвращаем объект библиотеки
  if (window.L) return Promise.resolve(window.L)

  // Если загрузка уже была запущена ранее — возвращаем существующий Promise
  if (window.__leafletPromise) return window.__leafletPromise

  // Создаём Promise для асинхронной загрузки библиотеки
  window.__leafletPromise = new Promise((resolve, reject) => {
    const cssId = 'leaflet-cdn-css'

    // Проверяем, подключены ли стили ранее
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

    // Если скрипт уже существует — ждём его загрузки
    if (existingScript) {
      existingScript.addEventListener(
        'load',
        () => resolve(window.L), // После загрузки возвращаем объект Leaflet
        { once: true }
      )

      existingScript.addEventListener(
        'error',
        () => reject(new Error('Leaflet script load failed')), // Ошибка загрузки
        { once: true }
      )

      return
    }

    // Если скрипта нет — создаём его
    const script = document.createElement('script')
    script.id = scriptId
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.async = true

    // Если библиотека успешно загрузилась — проверяем наличие window.L
    script.onload = () =>
      window.L
        ? resolve(window.L) // Всё успешно
        : reject(new Error('Leaflet unavailable')) // Скрипт есть, но библиотека недоступна

    // Обработка ошибки загрузки
    script.onerror = () =>
      reject(new Error('Leaflet script load failed'))

    // Добавляем скрипт в <body>
    document.body.appendChild(script)
  })

  // Возвращаем Promise загрузки
  return window.__leafletPromise
}