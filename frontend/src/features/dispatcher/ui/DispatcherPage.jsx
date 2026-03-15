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
import { fetchAllFlights, createFlight as createFlightApi } from '../services/flightsApi'
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

function getRiskClass(score) {
  if (score <= 30) return 'risk-low'
  if (score <= 55) return 'risk-medium'
  if (score <= 75) return 'risk-high'
  return 'risk-critical'
}

function asNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function formatFixedOrNA(value, digits = 1) {
  const numeric = asNumberOrNull(value)
  return numeric == null ? 'нет данных' : numeric.toFixed(digits)
}

function formatIntOrNA(value) {
  const numeric = asNumberOrNull(value)
  return numeric == null ? 'нет данных' : String(Math.round(numeric))
}

function formatVisibilityKmOrNA(value) {
  const numeric = asNumberOrNull(value)
  return numeric == null ? 'нет данных' : (numeric / 1000).toFixed(1)
}

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

function parseDateTime(value) {
  if (!value) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'number') {
    const fromTimestamp = new Date(value)
    return Number.isNaN(fromTimestamp.getTime()) ? null : fromTimestamp
  }

  if (typeof value !== 'string') return null

  const nativeDate = new Date(value)
  if (!Number.isNaN(nativeDate.getTime())) return nativeDate

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
  )
  if (!match) return null

  const [, year, month, day, hours, minutes, seconds = '0', fraction = '0'] = match
  const milliseconds = Number((fraction + '000').slice(0, 3))

  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
    milliseconds,
  )

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function haversineDistanceKm(fromAirport, toAirport) {
  const earthRadiusKm = 6371
  const latDistanceRad = ((toAirport.lat - fromAirport.lat) * Math.PI) / 180
  const lonDistanceRad = ((toAirport.lon - fromAirport.lon) * Math.PI) / 180
  const startLatRad = (fromAirport.lat * Math.PI) / 180
  const endLatRad = (toAirport.lat * Math.PI) / 180

  const a =
    Math.sin(latDistanceRad / 2) * Math.sin(latDistanceRad / 2) +
    Math.cos(startLatRad) *
      Math.cos(endLatRad) *
      Math.sin(lonDistanceRad / 2) *
      Math.sin(lonDistanceRad / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function formatDateTime(value) {
  const date = parseDateTime(value)
  if (!date) return 'нет данных'
  return date.toLocaleString('ru-RU')
}

function formatTimeLeftToDeparture(value, nowTimestamp) {
  const departureDate = parseDateTime(value)
  if (!departureDate) return 'осталось: нет данных'

  const diffMs = departureDate.getTime() - nowTimestamp
  if (diffMs <= 0) return 'вылет уже прошел'

  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  return `осталось: ${days} д ${hours} ч`
}

export default function DispatcherPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const airportLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const weatherCacheRef = useRef({})

  const [leafletReady, setLeafletReady] = useState(false)
  const [leafletError, setLeafletError] = useState('')
  const [activeTab, setActiveTab] = useState('monitoring')

  const [form, setForm] = useState(createInitialForm)

  const [activeFlight, setActiveFlight] = useState(null)
  const [allFlights, setAllFlights] = useState([])
  const [isLoadingFlights, setIsLoadingFlights] = useState(true)
  const [flightsError, setFlightsError] = useState('')

  const [selectedWeatherAirportId, setSelectedWeatherAirportId] = useState('')
  const [weatherByAirport, setWeatherByAirport] = useState({})

  const [isEvaluating, setIsEvaluating] = useState(false)
  const [isPreviewEvaluating, setIsPreviewEvaluating] = useState(false)
  const [previewRisk, setPreviewRisk] = useState(null)
  const [error, setError] = useState('')
  const [timeTick, setTimeTick] = useState(() => Date.now())

  const airportsById = useMemo(
    () => Object.fromEntries(AIRPORTS_RF.map((airport) => [airport.id, airport])),
    [],
  )

  const getFlightArrivalForTable = useCallback(
    (flight) => {
      if (flight?.arrivalAt) return flight.arrivalAt

      const fromAirport = airportsById[flight?.fromAirportId]
      const toAirport = airportsById[flight?.toAirportId]
      const departureAt = parseDateTime(flight?.departureAt)

      if (!fromAirport || !toAirport || !departureAt) return null

      const distanceKm = haversineDistanceKm(fromAirport, toAirport)
      const enrouteMinutes = Math.round((distanceKm / 820) * 60)
      const totalMinutes = Math.max(35, enrouteMinutes + 25)

      return new Date(departureAt.getTime() + totalMinutes * 60 * 1000)
    },
    [airportsById],
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

  const selectedWeatherAirport = selectedWeatherAirportId ? airportsById[selectedWeatherAirportId] : null
  const selectedWeather = selectedWeatherAirportId ? weatherByAirport[selectedWeatherAirportId]?.data : null

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

  useEffect(() => {
    weatherCacheRef.current = weatherByAirport
  }, [weatherByAirport])

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTimeTick(Date.now())
    }, 60000)

    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    let cancelled = false

    fetchAllFlights()
      .then((flights) => {
        if (cancelled) return
        setAllFlights(Array.isArray(flights) ? flights : [])
      })
      .catch(() => {
        if (!cancelled) {
          setFlightsError('Не удалось загрузить список рейсов с backend.')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFlights(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

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

    setTimeout(() => map.invalidateSize(), 0)

    airportLayerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [leafletReady])

  const ensureWeather = useCallback(
    async (airportId) => {
      const cached = weatherCacheRef.current[airportId]
      if (isWeatherCacheFresh(cached)) {
        return cached.data
      }

      const airport = airportsById[airportId]
      if (!airport) {
        throw new Error('Airport is not found')
      }

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

  useEffect(() => {
    if (activeFlight) {
      setPreviewRisk(null)
      setIsPreviewEvaluating(false)
      return
    }

    if (!selectedFrom || !selectedTo) {
      setPreviewRisk(null)
      setIsPreviewEvaluating(false)
      return
    }

    const routeValidationError = validateRoute(form)
    if (routeValidationError) {
      setPreviewRisk(null)
      setIsPreviewEvaluating(false)
      return
    }

    let cancelled = false
    setIsPreviewEvaluating(true)

    Promise.all([ensureWeather(selectedFrom.id), ensureWeather(selectedTo.id)])
      .then(([depWeather, arrWeather]) => {
        if (cancelled) return

        const departureRisk = evaluateSurfaceRisk(depWeather)
        const arrivalRisk = evaluateSurfaceRisk(arrWeather)
        const cruiseRisk = evaluateCruiseRisk(selectedFrom, selectedTo, depWeather, arrWeather)
        const totalRisk = clampScore(
          departureRisk.score * 0.4 + arrivalRisk.score * 0.4 + cruiseRisk.score * 0.2,
        )

        setPreviewRisk({
          total: totalRisk,
          departure: departureRisk,
          arrival: arrivalRisk,
          cruise: cruiseRisk,
          feasibility: getFeasibility(totalRisk),
        })
      })
      .catch(() => {
        if (!cancelled) setPreviewRisk(null)
      })
      .finally(() => {
        if (!cancelled) setIsPreviewEvaluating(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeFlight, ensureWeather, form, selectedFrom, selectedTo])

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

      const savedFlight = await createFlightApi({
        flightNumber: form.flightNumber.trim().toUpperCase(),
        departureAt: form.departureAt,
        arrivalAt: null,
        fromAirportId: selectedFrom.id,
        toAirportId: selectedTo.id,
        departureRisk,
        arrivalRisk,
        cruiseRisk,
        totalRisk,
        feasibility: getFeasibility(totalRisk),
      })

      setActiveFlight(savedFlight)
      setAllFlights((prev) => [savedFlight, ...prev.filter((flight) => flight.id !== savedFlight.id)])
      setSelectedWeatherAirportId(selectedFrom.id)
      setForm(createInitialForm())
      setActiveTab('monitoring')
    } catch {
      setError('Не удалось создать рейс. Проверьте backend и доступ к погодному API.')
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

  const openFlightFromList = useCallback((flight) => {
    if (!flight) return
    setActiveFlight(flight)
    setSelectedWeatherAirportId(flight.fromAirportId)
    setActiveTab('monitoring')
  }, [])

  useEffect(() => {
    if (activeTab !== 'monitoring') return
    if (!mapRef.current) return
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 0)
    return () => clearTimeout(timer)
  }, [activeTab])

  return (
    <main className="dispatcher-app">
      <section className="tabs-row panel">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'monitoring' ? 'active' : ''}`}
          onClick={() => setActiveTab('monitoring')}
        >
          Мониторинг
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'flights' ? 'active' : ''}`}
          onClick={() => setActiveTab('flights')}
        >
          Рейсы
        </button>
      </section>

      <section className={`content-grid ${activeTab === 'monitoring' ? '' : 'is-hidden'}`}>
        <aside className="panel flight-creator">
          <h2>Создание рейса</h2>

          <div className="form-grid">
            <label className="route-field">
              Город отправления
              <select
                value={form.fromCity}
                onChange={(event) => {
                  setActiveFlight(null)
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
                  setActiveFlight(null)
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
                  setActiveFlight(null)
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
                  setActiveFlight(null)
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
              {activeRisk || previewRisk ? (
                <div className="risk-block">
                  {!activeRisk && previewRisk && (
                    <p className="muted">Предварительная оценка до создания рейса.</p>
                  )}
                  <div className="risk-row">
                    <span>Взлет</span>
                    <strong>
                      {(activeRisk ?? previewRisk).departure.score}/100 ({riskLevelLabel((activeRisk ?? previewRisk).departure.score)})
                    </strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${getRiskClass((activeRisk ?? previewRisk).departure.score)}`}
                      style={{ width: `${(activeRisk ?? previewRisk).departure.score}%` }}
                    />
                  </div>

                  <div className="risk-row">
                    <span>Посадка</span>
                    <strong>
                      {(activeRisk ?? previewRisk).arrival.score}/100 ({riskLevelLabel((activeRisk ?? previewRisk).arrival.score)})
                    </strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${getRiskClass((activeRisk ?? previewRisk).arrival.score)}`}
                      style={{ width: `${(activeRisk ?? previewRisk).arrival.score}%` }}
                    />
                  </div>

                  <div className="risk-row">
                    <span>Эшелон ~12 км</span>
                    <strong>
                      {(activeRisk ?? previewRisk).cruise.score}/100 ({riskLevelLabel((activeRisk ?? previewRisk).cruise.score)})
                    </strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${getRiskClass((activeRisk ?? previewRisk).cruise.score)}`}
                      style={{ width: `${(activeRisk ?? previewRisk).cruise.score}%` }}
                    />
                  </div>

                  <div className="risk-row total">
                    <span>Итоговый риск</span>
                    <strong>
                      {(activeRisk ?? previewRisk).total}/100 ({riskLevelLabel((activeRisk ?? previewRisk).total)})
                    </strong>
                  </div>
                  <div className="risk-track">
                    <div
                      className={`risk-fill ${(activeRisk ?? previewRisk).feasibility.className}`}
                      style={{ width: `${(activeRisk ?? previewRisk).total}%` }}
                    />
                  </div>
                </div>
              ) : isPreviewEvaluating ? (
                <p className="muted">Предварительный расчет риска...</p>
              ) : (
                <p className="muted">Создайте рейс, чтобы получить расчет риска по текущим погодным условиям.</p>
              )}
            </article>
          </section>
        </section>
      </section>

      {activeTab === 'flights' && (
      <section className="panel flights-panel">
        <h2>Все рейсы</h2>
        {isLoadingFlights ? (
          <p className="muted">Загружаем рейсы...</p>
        ) : allFlights.length === 0 ? (
          <p className="muted">Пока нет созданных рейсов.</p>
        ) : (
          <div className="flights-table-wrap">
            <table className="flights-table">
              <thead>
                <tr>
                  <th>Рейс</th>
                  <th>Маршрут</th>
                  <th>Вылет</th>
                  <th>Прилет</th>
                  <th>Риск</th>
                </tr>
              </thead>
              <tbody>
                {allFlights.map((flight) => (
                  <tr key={flight.id} onClick={() => openFlightFromList(flight)}>
                    <td>{flight.flightNumber}</td>
                    <td>
                      {flight.fromAirportId} - {flight.toAirportId}
                    </td>
                    <td>
                      <div className="departure-cell">
                        <span>{formatDateTime(flight.departureAt)}</span>
                        <span className="departure-remaining">{formatTimeLeftToDeparture(flight.departureAt, timeTick)}</span>
                      </div>
                    </td>
                    <td>{formatDateTime(getFlightArrivalForTable(flight))}</td>
                    <td>{safeNumber(flight.totalRisk, 0)}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {flightsError && <p className="inline-error">{flightsError}</p>}
      </section>
      )}
    </main>
  )
}
