// React hooks for component state, side effects and memoization.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AIRPORTS_RF } from '../model/constants'
import {
  clampScore,
  evaluateCruiseRisk,
  evaluateSurfaceRisk,
  getFeasibility,
  getPrecipPerHour,
  riskLevelLabel,
  safeNumber,
} from '../model/risk'
import { loadLeafletAssets } from '../services/leafletLoader'
import { fetchWeatherByAirport, isWeatherCacheFresh } from '../services/weatherApi'
import './DispatcherPage.css'

// Visual legend for risk levels displayed on top of the map.
const RISK_LEGEND = [
  { label: 'Низкий', className: 'dot-low' },
  { label: 'Умеренный', className: 'dot-medium' },
  { label: 'Высокий', className: 'dot-high' },
  { label: 'Критический', className: 'dot-critical' },
]

// Form default values.
function createInitialForm() {
  return {
    fromCity: '',
    toCity: '',
    fromAirportId: '',
    toAirportId: '',
    departureAt: '',
    flightNumber: '',
  }
}

// Convert numeric score to CSS class.
function getRiskClass(score) {
  if (score <= 30) return 'risk-low'
  if (score <= 55) return 'risk-medium'
  if (score <= 75) return 'risk-high'
  return 'risk-critical'
}

// Format helpers for weather fields in UI.
function formatFixedOrNA(value, digits = 1) {
  const numeric = safeNumber(value)
  return numeric == null ? 'нет данных' : numeric.toFixed(digits)
}

function formatIntOrNA(value) {
  const numeric = safeNumber(value)
  return numeric == null ? 'нет данных' : String(Math.round(numeric))
}

function formatVisibilityKmOrNA(value) {
  const numeric = safeNumber(value)
  return numeric == null ? 'нет данных' : (numeric / 1000).toFixed(1)
}

// Validate route before risk calculation.
function validateRoute(formState) {
  if (formState.fromCity && formState.toCity && formState.fromCity === formState.toCity) {
    return 'Город вылета и город прилета не должны совпадать'
  }

  if (
    formState.fromAirportId &&
    formState.toAirportId &&
    formState.fromAirportId === formState.toAirportId
  ) {
    return 'Аэропорт вылета и аэропорт прилета не должны совпадать'
  }

  return ''
}

export default function DispatcherPage() {
  // Leaflet map and layers refs.
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const airportLayerRef = useRef(null)
  const routeLayerRef = useRef(null)

  // Weather cache ref mirrors state to avoid stale closures in async calls.
  const weatherCacheRef = useRef({})

  // Map loading state.
  const [leafletReady, setLeafletReady] = useState(false)
  const [leafletError, setLeafletError] = useState('')

  // Form and current calculated flight.
  const [form, setForm] = useState(createInitialForm)
  const [activeFlight, setActiveFlight] = useState(null)

  // Selected weather point and weather storage.
  const [selectedWeatherAirportId, setSelectedWeatherAirportId] = useState('')
  const [weatherByAirport, setWeatherByAirport] = useState({})

  // UI process flags.
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [error, setError] = useState('')

  // Fast airport lookup by id.
  const airportsById = useMemo(
    () => Object.fromEntries(AIRPORTS_RF.map((airport) => [airport.id, airport])),
    [],
  )

  // Unique sorted city list for selects.
  const cities = useMemo(
    () => [...new Set(AIRPORTS_RF.map((airport) => airport.city))].sort((a, b) => a.localeCompare(b)),
    [],
  )

  // Filter airport options by selected city.
  const fromAirportOptions = useMemo(() => {
    if (!form.fromCity) return []
    return AIRPORTS_RF.filter((airport) => airport.city === form.fromCity)
  }, [form.fromCity])

  const toAirportOptions = useMemo(() => {
    if (!form.toCity) return []
    return AIRPORTS_RF.filter((airport) => airport.city === form.toCity)
  }, [form.toCity])

  // Airports selected in form.
  const selectedFrom = form.fromAirportId ? airportsById[form.fromAirportId] : null
  const selectedTo = form.toAirportId ? airportsById[form.toAirportId] : null

  // Active route source: calculated flight first, form fallback second.
  const activeRoute = useMemo(() => {
    if (activeFlight) {
      return {
        from: airportsById[activeFlight.fromAirportId],
        to: airportsById[activeFlight.toAirportId],
      }
    }

    if (!selectedFrom || !selectedTo) return null
    return { from: selectedFrom, to: selectedTo }
  }, [activeFlight, airportsById, selectedFrom, selectedTo])

  // Weather selected by clicking a map marker.
  const selectedWeatherAirport = selectedWeatherAirportId ? airportsById[selectedWeatherAirportId] : null
  const selectedWeather = selectedWeatherAirportId ? weatherByAirport[selectedWeatherAirportId]?.data : null

  // Prepared risk view model for the right-bottom card.
  const activeRisk = useMemo(() => {
    if (!activeFlight) return null
    return {
      total: activeFlight.totalRisk,
      departure: activeFlight.departureRisk,
      arrival: activeFlight.arrivalRisk,
      cruise: activeFlight.cruiseRisk,
      feasibility: activeFlight.feasibility,
    }
  }, [activeFlight])

  // Keep ref in sync with state cache.
  useEffect(() => {
    weatherCacheRef.current = weatherByAirport
  }, [weatherByAirport])

  // Load Leaflet scripts/styles once.
  useEffect(() => {
    let cancelled = false

    loadLeafletAssets()
      .then(() => {
        if (!cancelled) setLeafletReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setLeafletError('Не удалось загрузить карту Leaflet. Проверьте доступ к сети.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Create map instance after Leaflet is ready.
  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current || mapRef.current) return

    const L = window.L
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      minZoom: 2,
      maxZoom: 11,
      attributionControl: false,
      worldCopyJump: false,
      preferCanvas: true,
    }).setView([60, 95], 3)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)

    // Ensure proper first paint when container appears.
    setTimeout(() => map.invalidateSize(), 0)

    airportLayerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [leafletReady])

  // Load weather with stale-safe cache.
  const ensureWeather = useCallback(
    async (airportId) => {
      const cached = weatherCacheRef.current[airportId]
      if (isWeatherCacheFresh(cached)) {
        return cached.data
      }

      const airport = airportsById[airportId]
      const data = await fetchWeatherByAirport(airport)

      setWeatherByAirport((prev) => ({
        ...prev,
        [airportId]: { data, fetchedAt: new Date().toISOString() },
      }))

      return data
    },
    [airportsById],
  )

  // Open weather card for airport clicked on map.
  const openAirportWeather = useCallback(
    async (airportId) => {
      setSelectedWeatherAirportId(airportId)
      try {
        await ensureWeather(airportId)
      } catch {
        setError('Не удалось получить погодные параметры точки.')
      }
    },
    [ensureWeather],
  )

  // Draw only active-route airport points.
  useEffect(() => {
    if (!mapRef.current || !airportLayerRef.current) return

    const L = window.L
    const layer = airportLayerRef.current
    layer.clearLayers()

    if (!activeRoute?.from || !activeRoute?.to) return
    const activeIds = [activeRoute.from.id, activeRoute.to.id]

    AIRPORTS_RF.forEach((airport) => {
      if (!activeIds.includes(airport.id)) return
      const isSelected = airport.id === form.fromAirportId || airport.id === form.toAirportId

      const marker = L.circleMarker([airport.lat, airport.lon], {
        radius: isSelected ? 8 : 6,
        color: '#171717',
        weight: isSelected ? 2 : 1,
        fillColor: '#ffd633',
        fillOpacity: isSelected ? 0.98 : 0.78,
      })

      marker.on('click', () => {
        openAirportWeather(airport.id)
      })

      marker.addTo(layer)
    })
  }, [activeRoute, form.fromAirportId, form.toAirportId, openAirportWeather])

  // Draw route line and fit map to route.
  useEffect(() => {
    if (!mapRef.current || !routeLayerRef.current) return

    const L = window.L
    const layer = routeLayerRef.current
    layer.clearLayers()

    if (!activeRoute?.from || !activeRoute?.to) return

    const linePoints = [
      [activeRoute.from.lat, activeRoute.from.lon],
      [activeRoute.to.lat, activeRoute.to.lon],
    ]

    L.polyline(linePoints, {
      color: '#0c0c0c',
      weight: 2.8,
      opacity: 0.95,
      dashArray: '7 6',
    }).addTo(layer)

    L.circleMarker([activeRoute.from.lat, activeRoute.from.lon], {
      radius: 8,
      color: '#111',
      weight: 2,
      fillColor: '#ffd633',
      fillOpacity: 0.95,
    })
      .on('click', () => {
        openAirportWeather(activeRoute.from.id)
      })
      .addTo(layer)

    L.circleMarker([activeRoute.to.lat, activeRoute.to.lon], {
      radius: 8,
      color: '#111',
      weight: 2,
      fillColor: '#ffd633',
      fillOpacity: 0.95,
    })
      .on('click', () => {
        openAirportWeather(activeRoute.to.id)
      })
      .addTo(layer)

    mapRef.current.fitBounds(
      [
        [activeRoute.from.lat, activeRoute.from.lon],
        [activeRoute.to.lat, activeRoute.to.lon],
      ],
      { padding: [40, 40], maxZoom: 6 },
    )
  }, [activeRoute, openAirportWeather])

  // Create flight from form and compute weather risks.
  const createFlight = async () => {
    if (!selectedFrom || !selectedTo) {
      setError('Выберите аэропорт вылета и прилета.')
      return
    }

    const routeValidationError = validateRoute(form)
    if (routeValidationError) {
      setError(routeValidationError)
      return
    }

    if (!form.departureAt || !form.flightNumber.trim()) {
      setError('Укажите дату/время вылета и номер рейса.')
      return
    }

    setError('')
    setIsEvaluating(true)

    try {
      const [depWeather, arrWeather] = await Promise.all([
        ensureWeather(selectedFrom.id),
        ensureWeather(selectedTo.id),
      ])

      const departureRisk = evaluateSurfaceRisk(depWeather)
      const arrivalRisk = evaluateSurfaceRisk(arrWeather)
      const cruiseRisk = evaluateCruiseRisk(selectedFrom, selectedTo, depWeather, arrWeather)
      const totalRisk = clampScore(
        departureRisk.score * 0.4 + arrivalRisk.score * 0.4 + cruiseRisk.score * 0.2,
      )

      const flight = {
        id: `flight_${Date.now()}`,
        createdAt: new Date().toISOString(),
        flightNumber: form.flightNumber.trim().toUpperCase(),
        departureAt: form.departureAt,
        fromAirportId: selectedFrom.id,
        toAirportId: selectedTo.id,
        departureRisk,
        arrivalRisk,
        cruiseRisk,
        totalRisk,
        feasibility: getFeasibility(totalRisk),
      }

      setActiveFlight(flight)
      setSelectedWeatherAirportId(selectedFrom.id)
    } catch {
      setError('Не удалось получить погоду. Проверьте API ключ и сеть.')
    } finally {
      setIsEvaluating(false)
    }
  }

  // Post-render map size fix for hidden-to-visible mount cases.
  useEffect(() => {
    if (!mapRef.current) return

    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 0)

    return () => clearTimeout(timer)
  }, [])

  return (
    <main className="dispatcher-app">
      <section className="content-grid">
        <aside className="panel flight-creator">
          <h2>Создание рейса</h2>

          <div className="form-grid">
            <label className="route-field">
              Город отправления
              <select
                value={form.fromCity}
                onChange={(event) => {
                  const city = event.target.value
                  setForm((prev) => {
                    const next = { ...prev, fromCity: city, fromAirportId: '' }
                    const routeValidationError = validateRoute(next)
                    setError(routeValidationError)
                    return next
                  })
                }}
              >
                <option value="">Выберите город</option>
                {cities.map((city) => (
                  <option key={city} value={city} disabled={city === form.toCity}>
                    {city}
                  </option>
                ))}
              </select>
            </label>

            <label className="route-field">
              Город назначения
              <select
                value={form.toCity}
                onChange={(event) => {
                  const city = event.target.value
                  setForm((prev) => {
                    const next = { ...prev, toCity: city, toAirportId: '' }
                    const routeValidationError = validateRoute(next)
                    setError(routeValidationError)
                    return next
                  })
                }}
              >
                <option value="">Выберите город</option>
                {cities.map((city) => (
                  <option key={city} value={city} disabled={city === form.fromCity}>
                    {city}
                  </option>
                ))}
              </select>
            </label>

            <label className="route-field">
              Аэропорт отправления
              <select
                value={form.fromAirportId}
                onChange={(event) => {
                  const airportId = event.target.value
                  setForm((prev) => {
                    const next = { ...prev, fromAirportId: airportId }
                    const routeValidationError = validateRoute(next)
                    setError(routeValidationError)
                    return next
                  })
                  if (airportId) openAirportWeather(airportId)
                }}
              >
                <option value="">Выберите аэропорт</option>
                {fromAirportOptions.map((airport) => (
                  <option key={airport.id} value={airport.id} disabled={airport.id === form.toAirportId}>
                    {airport.id} - {airport.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="route-field">
              Аэропорт назначения
              <select
                value={form.toAirportId}
                onChange={(event) => {
                  const airportId = event.target.value
                  setForm((prev) => {
                    const next = { ...prev, toAirportId: airportId }
                    const routeValidationError = validateRoute(next)
                    setError(routeValidationError)
                    return next
                  })
                  if (airportId) openAirportWeather(airportId)
                }}
              >
                <option value="">Выберите аэропорт</option>
                {toAirportOptions.map((airport) => (
                  <option key={airport.id} value={airport.id} disabled={airport.id === form.fromAirportId}>
                    {airport.id} - {airport.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Дата и время вылета
              <input
                type="datetime-local"
                value={form.departureAt}
                onChange={(event) => setForm((prev) => ({ ...prev, departureAt: event.target.value }))}
              />
            </label>

            <label>
              Номер рейса
              <input
                type="text"
                placeholder="SU123"
                value={form.flightNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, flightNumber: event.target.value }))}
              />
            </label>
          </div>

          <button type="button" className="primary-btn" onClick={createFlight} disabled={isEvaluating}>
            {isEvaluating ? 'Расчет риска...' : 'Создать рейс'}
          </button>

          {error && <p className="inline-error">{error}</p>}
        </aside>

        <section className="panel monitoring-panel">
          <h2>Результат мониторинга</h2>

          <div className="map-stage">
            <div className="risk-legend">
              {RISK_LEGEND.map((item) => (
                <div key={item.label} className="legend-item">
                  <span className={`legend-dot ${item.className}`} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>

            {leafletError && <p className="inline-error map-error">{leafletError}</p>}
            <div ref={mapContainerRef} className="leaflet-map" />
          </div>

          <section className="bottom-params">
            <article className="weather-point-card">
              <h3>Погода выбранной точки</h3>
              {selectedWeatherAirport && selectedWeather ? (
                <>
                  <p>
                    <strong>{selectedWeatherAirport.id}</strong> - {selectedWeatherAirport.name},{' '}
                    {selectedWeatherAirport.city}
                  </p>
                  <div className="weather-grid">
                    <div>
                      <span>Описание</span>
                      <strong>{selectedWeather.weather?.[0]?.description ?? 'нет данных'}</strong>
                    </div>
                    <div>
                      <span>Температура</span>
                      <strong>{formatFixedOrNA(selectedWeather.main?.temp)} C</strong>
                    </div>
                    <div>
                      <span>Ощущается</span>
                      <strong>{formatFixedOrNA(selectedWeather.main?.feels_like)} C</strong>
                    </div>
                    <div>
                      <span>Ветер</span>
                      <strong>{formatFixedOrNA(selectedWeather.wind?.speed)} м/с</strong>
                    </div>
                    <div>
                      <span>Порывы</span>
                      <strong>{formatFixedOrNA(selectedWeather.wind?.gust)} м/с</strong>
                    </div>
                    <div>
                      <span>Видимость</span>
                      <strong>{formatVisibilityKmOrNA(selectedWeather.visibility)} км</strong>
                    </div>
                    <div>
                      <span>Давление</span>
                      <strong>{formatIntOrNA(selectedWeather.main?.pressure)} гПа</strong>
                    </div>
                    <div>
                      <span>Влажность</span>
                      <strong>{formatIntOrNA(selectedWeather.main?.humidity)}%</strong>
                    </div>
                    <div>
                      <span>Облачность</span>
                      <strong>{formatIntOrNA(selectedWeather.clouds?.all)}%</strong>
                    </div>
                    <div>
                      <span>Осадки</span>
                      <strong>{formatFixedOrNA(getPrecipPerHour(selectedWeather))} мм/ч</strong>
                    </div>
                  </div>
                </>
              ) : (
                <p className="muted">Нажмите на точку аэропорта на карте, чтобы увидеть параметры погоды.</p>
              )}
            </article>

            <article className="weather-point-card">
              <h3>Оценка риска по погоде</h3>
              {activeRisk ? (
                <div className="risk-block">
                  <div className="risk-row">
                    <span>Взлет</span>
                    <strong>
                      {activeRisk.departure.score}/100 ({riskLevelLabel(activeRisk.departure.score)})
                    </strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${getRiskClass(activeRisk.departure.score)}`}
                      style={{ width: `${activeRisk.departure.score}%` }}
                    />
                  </div>

                  <div className="risk-row">
                    <span>Посадка</span>
                    <strong>
                      {activeRisk.arrival.score}/100 ({riskLevelLabel(activeRisk.arrival.score)})
                    </strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${getRiskClass(activeRisk.arrival.score)}`}
                      style={{ width: `${activeRisk.arrival.score}%` }}
                    />
                  </div>

                  <div className="risk-row">
                    <span>Эшелон ~12 км</span>
                    <strong>
                      {activeRisk.cruise.score}/100 ({riskLevelLabel(activeRisk.cruise.score)})
                    </strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${getRiskClass(activeRisk.cruise.score)}`}
                      style={{ width: `${activeRisk.cruise.score}%` }}
                    />
                  </div>

                  <div className="risk-row total">
                    <span>Итоговый риск</span>
                    <strong>{activeRisk.total}/100 ({riskLevelLabel(activeRisk.total)})</strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${activeRisk.feasibility.className}`}
                      style={{ width: `${activeRisk.total}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="muted">Создайте рейс, чтобы получить расчет риска по текущим погодным условиям.</p>
              )}
            </article>
          </section>
        </section>
      </section>
    </main>
  )
}
