import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AIRPORTS_RF,
  REGIONS_RF,
} from '../model/constants'
import {
  buildCurvedRoute,
  clampScore,
  evaluateCruiseRisk,
  evaluateSurfaceRisk,
  getFeasibility,
  getPrecipPerHour,
  safeNumber,
} from '../model/risk'
import { loadFlights, saveFlights } from '../model/storage'
import { loadLeafletAssets } from '../services/leafletLoader'
import { fetchWeatherByAirport, isWeatherCacheFresh } from '../services/weatherApi'
import './DispatcherPage.css'

const RISK_LEGEND = [
  { label: 'Низкий', className: 'dot-low' },
  { label: 'Умеренный', className: 'dot-medium' },
  { label: 'Высокий', className: 'dot-high' },
  { label: 'Критический', className: 'dot-critical' },
]

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

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : 'n/a'
}

function getRegionAirports(regionId) {
  return AIRPORTS_RF.filter((airport) => airport.region === regionId)
}

export default function DispatcherPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const regionLayerRef = useRef(null)
  const airportLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const weatherCacheRef = useRef({})

  const [leafletReady, setLeafletReady] = useState(false)
  const [leafletError, setLeafletError] = useState('')

  const [selectedRegionId, setSelectedRegionId] = useState('central')
  const [hoveredRegionId, setHoveredRegionId] = useState(null)

  const [form, setForm] = useState(createInitialForm)
  const [flights, setFlights] = useState(loadFlights)
  const [selectedFlightId, setSelectedFlightId] = useState(null)
  const [selectedWeatherAirportId, setSelectedWeatherAirportId] = useState('')

  const [weatherByAirport, setWeatherByAirport] = useState({})
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [error, setError] = useState('')

  const airportsById = useMemo(
    () => Object.fromEntries(AIRPORTS_RF.map((airport) => [airport.id, airport])),
    [],
  )

  const cities = useMemo(
    () => [...new Set(AIRPORTS_RF.map((airport) => airport.city))].sort((a, b) => a.localeCompare(b)),
    [],
  )

  const fromAirportOptions = useMemo(() => {
    if (!form.fromCity) return []
    return AIRPORTS_RF.filter((airport) => airport.city === form.fromCity)
  }, [form.fromCity])

  const toAirportOptions = useMemo(() => {
    if (!form.toCity) return []
    return AIRPORTS_RF.filter((airport) => airport.city === form.toCity)
  }, [form.toCity])

  const selectedFrom = form.fromAirportId ? airportsById[form.fromAirportId] : null
  const selectedTo = form.toAirportId ? airportsById[form.toAirportId] : null

  const activeFlight = useMemo(
    () => flights.find((flight) => flight.id === selectedFlightId) ?? null,
    [flights, selectedFlightId],
  )

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

  const hoveredRegion = useMemo(
    () => REGIONS_RF.find((region) => region.id === hoveredRegionId) ?? null,
    [hoveredRegionId],
  )

  const hoveredRegionAirports = useMemo(
    () => (hoveredRegion ? getRegionAirports(hoveredRegion.id) : []),
    [hoveredRegion],
  )

  const selectedWeatherAirport = selectedWeatherAirportId
    ? airportsById[selectedWeatherAirportId]
    : null

  const selectedWeather = selectedWeatherAirportId
    ? weatherByAirport[selectedWeatherAirportId]?.data
    : null

  useEffect(() => {
    saveFlights(flights)
  }, [flights])

  useEffect(() => {
    weatherCacheRef.current = weatherByAirport
  }, [weatherByAirport])

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

    // Ensure map renders when container is visible.
    setTimeout(() => map.invalidateSize(), 0)

    regionLayerRef.current = L.layerGroup().addTo(map)
    airportLayerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [leafletReady])

  useEffect(() => {
    if (!mapRef.current || !regionLayerRef.current) return

    const L = window.L
    const layer = regionLayerRef.current
    layer.clearLayers()

    REGIONS_RF.forEach((region) => {
      const regionAirports = getRegionAirports(region.id)
      const airportLabels = regionAirports.map((airport) => airport.id).join(', ')
      const isActive = region.id === selectedRegionId

      const rectangle = L.rectangle(region.bounds, {
        color: isActive ? '#54b0ff' : '#6b849b',
        weight: isActive ? 2 : 1,
        fillColor: isActive ? '#2a5373' : '#2f4250',
        fillOpacity: isActive ? 0.22 : 0.1,
        dashArray: '4 6',
      })

      rectangle.bindTooltip(`${region.name}: ${airportLabels}`, {
        sticky: true,
        direction: 'center',
        opacity: 0.92,
      })

      rectangle.on('mouseover', () => setHoveredRegionId(region.id))
      rectangle.on('mouseout', () => setHoveredRegionId(null))
      rectangle.on('click', () => {
        setSelectedRegionId(region.id)
        mapRef.current.fitBounds(region.bounds, { padding: [20, 20] })
      })

      rectangle.addTo(layer)
    })
  }, [selectedRegionId])

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

  const selectAirportForRoute = useCallback(
    (airportId) => {
      const airport = airportsById[airportId]
      if (!airport) return

      setError('')
      setSelectedFlightId(null)
      setSelectedRegionId(airport.region)

      setForm((prev) => {
        if (!prev.fromAirportId || (prev.fromAirportId && prev.toAirportId)) {
          return {
            ...prev,
            fromCity: airport.city,
            fromAirportId: airport.id,
            toCity: prev.fromAirportId && prev.toAirportId ? '' : prev.toCity,
            toAirportId: prev.fromAirportId && prev.toAirportId ? '' : prev.toAirportId,
          }
        }

        if (prev.fromAirportId === airport.id) {
          return {
            ...prev,
            toCity: '',
            toAirportId: '',
          }
        }

        return {
          ...prev,
          toCity: airport.city,
          toAirportId: airport.id,
        }
      })
    },
    [airportsById],
  )

  useEffect(() => {
    if (!mapRef.current || !airportLayerRef.current) return

    const L = window.L
    const layer = airportLayerRef.current
    layer.clearLayers()

    if (!activeRoute) return
    const activeIds = [activeRoute.from.id, activeRoute.to.id]

    AIRPORTS_RF.forEach((airport) => {
      if (activeIds && !activeIds.includes(airport.id)) return
      const isSelected = airport.id === form.fromAirportId || airport.id === form.toAirportId
      const isHoveredRegion = hoveredRegionId && airport.region === hoveredRegionId

      const marker = L.circleMarker([airport.lat, airport.lon], {
        radius: isSelected ? 8 : isHoveredRegion ? 7 : 6,
        color: '#171717',
        weight: isSelected ? 2 : 1,
        fillColor: '#ffd633',
        fillOpacity: isSelected ? 0.98 : isHoveredRegion ? 0.9 : 0.78,
      })

      marker.bindTooltip(`${airport.id} - ${airport.city}`, {
        direction: 'top',
        offset: [0, -6],
      })

      marker.on('click', () => {
        openAirportWeather(airport.id)
        if (!selectedFlightId) {
          selectAirportForRoute(airport.id)
        }
      })

      marker.addTo(layer)
    })
  }, [
    activeRoute,
    form.fromAirportId,
    form.toAirportId,
    hoveredRegionId,
    openAirportWeather,
    selectedFlightId,
    selectAirportForRoute,
  ])

  useEffect(() => {
    if (!mapRef.current || !routeLayerRef.current) return

    const L = window.L
    const layer = routeLayerRef.current
    layer.clearLayers()

    if (!activeRoute?.from || !activeRoute?.to) return

    const routePoints = buildCurvedRoute(activeRoute.from, activeRoute.to)

    L.polyline(routePoints, {
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

  const createFlight = async () => {
    if (!selectedFrom || !selectedTo) {
      setError('Выберите аэропорт вылета и прилета.')
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

      setFlights((prev) => [flight, ...prev])
      setSelectedFlightId(flight.id)
      setSelectedWeatherAirportId(selectedFrom.id)
    } catch {
      setError('Не удалось получить погоду. Проверьте API ключ и сеть.')
    } finally {
      setIsEvaluating(false)
    }
  }

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
                  setForm((prev) => ({ ...prev, fromCity: city, fromAirportId: '' }))
                }}
              >
                <option value="">Выберите город</option>
                {cities.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </label>

            <label className="route-field">
              Город назначения
              <select
                value={form.toCity}
                onChange={(event) => {
                  const city = event.target.value
                  setForm((prev) => ({ ...prev, toCity: city, toAirportId: '' }))
                }}
              >
                <option value="">Выберите город</option>
                {cities.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </label>

            <label className="route-field">
              Аэропорт отправления
              <select
                value={form.fromAirportId}
                onChange={(event) => {
                  const airportId = event.target.value
                  setForm((prev) => ({ ...prev, fromAirportId: airportId }))
                  if (airportId) openAirportWeather(airportId)
                }}
              >
                <option value="">Выберите аэропорт</option>
                {fromAirportOptions.map((airport) => (
                  <option key={airport.id} value={airport.id}>
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
                  setForm((prev) => ({ ...prev, toAirportId: airportId }))
                  if (airportId) openAirportWeather(airportId)
                }}
              >
                <option value="">Выберите аэропорт</option>
                {toAirportOptions.map((airport) => (
                  <option key={airport.id} value={airport.id}>
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

            {hoveredRegion && (
              <aside className="hover-region-card">
                <h4>{hoveredRegion.name}</h4>
                <p>Аэропорты:</p>
                <div className="hover-airports">
                  {hoveredRegionAirports.map((airport) => (
                    <span key={airport.id}>{airport.id}</span>
                  ))}
                </div>
              </aside>
            )}

            {leafletError && <p className="inline-error map-error">{leafletError}</p>}
            <div ref={mapContainerRef} className="leaflet-map" />
          </div>

          <section className="bottom-params">
            <article className="weather-point-card">
              <h3>Погода выбранной точки</h3>
              {selectedWeatherAirport && selectedWeather ? (
                <>
                  <p>
                    <strong>{selectedWeatherAirport.id}</strong> - {selectedWeatherAirport.name}, {selectedWeatherAirport.city}
                  </p>
                  <div className="weather-grid">
                    <div><span>Описание</span><strong>{selectedWeather.weather?.[0]?.description ?? 'n/a'}</strong></div>
                    <div><span>Температура</span><strong>{safeNumber(selectedWeather.main?.temp).toFixed(1)} C</strong></div>
                    <div><span>Ощущается</span><strong>{safeNumber(selectedWeather.main?.feels_like).toFixed(1)} C</strong></div>
                    <div><span>Ветер</span><strong>{safeNumber(selectedWeather.wind?.speed).toFixed(1)} м/с</strong></div>
                    <div><span>Порывы</span><strong>{safeNumber(selectedWeather.wind?.gust).toFixed(1)} м/с</strong></div>
                    <div><span>Видимость</span><strong>{(safeNumber(selectedWeather.visibility, 0) / 1000).toFixed(1)} км</strong></div>
                    <div><span>Давление</span><strong>{safeNumber(selectedWeather.main?.pressure)} гПа</strong></div>
                    <div><span>Влажность</span><strong>{safeNumber(selectedWeather.main?.humidity)}%</strong></div>
                    <div><span>Облачность</span><strong>{safeNumber(selectedWeather.clouds?.all)}%</strong></div>
                    <div><span>Осадки</span><strong>{getPrecipPerHour(selectedWeather).toFixed(1)} мм/ч</strong></div>
                  </div>
                </>
              ) : (
                <p className="muted">Нажмите на точку аэропорта на карте, чтобы увидеть параметры погоды.</p>
              )}
            </article>

          </section>
        </section>
      </section>

    </main>
  )
}
