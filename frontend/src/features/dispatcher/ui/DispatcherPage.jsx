import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Modal,
  NativeSelect,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconMessageCircle,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
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
import {
  cancelFlight as cancelFlightApi,
  createFlight as createFlightApi,
  fetchAllFlights,
  refreshFlightRisk as refreshFlightRiskApi,
} from '../services/flightsApi'
import { readFlightsCache, writeFlightsCache } from '../services/flightsCacheStorage'
import { fetchWeatherByAirport, isWeatherCacheFresh } from '../services/weatherApi'
import './DispatcherPage.css'

const RISK_LEGEND = [
  { label: 'Низкий', className: 'dot-low' },
  { label: 'Умеренный', className: 'dot-medium' },
  { label: 'Высокий', className: 'dot-high' },
  { label: 'Критический', className: 'dot-critical' },
]

const AIRLINE_IATA_CODES = ['SU', 'DP', 'FV', 'UT', 'EO', 'YC', 'WZ', 'RA']

function createInitialForm() {
  return {
    fromCity: '',
    toCity: '',
    fromAirportId: '',
    toAirportId: '',
    departureAt: '',
    airlineCode: AIRLINE_IATA_CODES[0],
    flightDigits: '',
  }
}

function getRiskColor(score) {
  if (score <= 30) return 'teal'
  if (score <= 55) return 'yellow'
  if (score <= 75) return 'orange'
  return 'red'
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

function formatRiskUpdatedAgo(value, nowTimestamp) {
  const updatedAt = parseDateTime(value)
  if (!updatedAt) return 'последнее обновление: нет данных'

  const diffMs = Math.max(0, nowTimestamp - updatedAt.getTime())
  const totalMinutes = Math.floor(diffMs / (1000 * 60))

  if (totalMinutes < 1) return 'последнее обновление: только что'
  if (totalMinutes < 60) return `последнее обновление: ${totalMinutes} мин назад`

  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) {
    const minutes = totalMinutes % 60
    if (minutes === 0) return `последнее обновление: ${hours} ч назад`
    return `последнее обновление: ${hours} ч ${minutes} мин назад`
  }

  const days = Math.floor(hours / 24)
  return `последнее обновление: ${days} д назад`
}

function toDateTimeLocalValue(value) {
  const date = parseDateTime(value)
  if (!date) return ''

  const pad = (part) => String(part).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function mapFlightsById(flights) {
  return Object.fromEntries(
    (Array.isArray(flights) ? flights : [])
      .filter((flight) => flight?.id)
      .map((flight) => [flight.id, flight]),
  )
}

function withRiskTimestamp(flight, knownById, fallbackTimestamp) {
  const known = flight?.id ? knownById?.[flight.id] : null
  const riskUpdatedAt =
    flight?.riskUpdatedAt ??
    flight?.cachedRiskUpdatedAt ??
    known?.riskUpdatedAt ??
    known?.cachedRiskUpdatedAt ??
    fallbackTimestamp

  return {
    ...flight,
    cachedRiskUpdatedAt: riskUpdatedAt,
  }
}

function hydrateFlightsWithRiskTimestamps(flights, knownFlights = [], fallbackTimestamp = new Date().toISOString()) {
  const knownById = mapFlightsById(knownFlights)
  return (Array.isArray(flights) ? flights : []).map((flight) =>
    withRiskTimestamp(flight, knownById, fallbackTimestamp),
  )
}

export default function DispatcherPage({ onRequestMeteorologist, initialTab = 'monitoring' }) {
  const cachedFlightsOnLoad = useMemo(() => readFlightsCache(), [])
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const airportLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const weatherCacheRef = useRef({})

  const [leafletReady, setLeafletReady] = useState(false)
  const [leafletError, setLeafletError] = useState('')
  const [activeTab, setActiveTab] = useState(
    initialTab === 'flights' ? initialTab : 'monitoring',
  )

  const [form, setForm] = useState(createInitialForm)

  const [activeFlight, setActiveFlight] = useState(null)
  const [allFlights, setAllFlights] = useState(() =>
    hydrateFlightsWithRiskTimestamps(cachedFlightsOnLoad, [], new Date().toISOString()),
  )
  const [isLoadingFlights, setIsLoadingFlights] = useState(() => cachedFlightsOnLoad.length === 0)
  const [flightsError, setFlightsError] = useState('')
  const [flightActionError, setFlightActionError] = useState('')
  const [flightActionById, setFlightActionById] = useState({})
  const [flightToDelete, setFlightToDelete] = useState(null)

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
    writeFlightsCache(allFlights)
  }, [allFlights])

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
        setFlightsError('')
        setAllFlights((prev) =>
          hydrateFlightsWithRiskTimestamps(
            Array.isArray(flights) ? flights : [],
            prev,
            new Date().toISOString(),
          ),
        )
      })
      .catch((cause) => {
        if (!cancelled) {
          const cachedFlights = readFlightsCache()
          if (cachedFlights.length > 0) {
            setAllFlights((prev) =>
              hydrateFlightsWithRiskTimestamps(cachedFlights, prev, new Date().toISOString()),
            )
            setFlightsError('Backend недоступен. Показаны сохраненные рейсы из локального кэша.')
          } else {
            setFlightsError(cause instanceof Error ? cause.message : 'Не удалось загрузить список рейсов с backend.')
          }
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
    if (!leafletReady || activeTab !== 'monitoring' || !mapContainerRef.current || mapRef.current) return

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
      airportLayerRef.current = null
      routeLayerRef.current = null
    }
  }, [activeTab, leafletReady])

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

    if (!form.departureAt || !form.airlineCode || !form.flightDigits.trim()) {
      setError('Укажите дату/время вылета и номер рейса.')
      return
    }

    if (!/^[A-Z]{2}$/.test(form.airlineCode)) {
      setError('Код авиакомпании должен содержать 2 латинские буквы (IATA).')
      return
    }

    if (!/^[1-9][0-9]{0,3}$/.test(form.flightDigits.trim())) {
      setError('Цифровая часть номера рейса: 1-4 цифры без ведущего нуля.')
      return
    }

    const departureDate = parseDateTime(form.departureAt)
    if (!departureDate || departureDate.getTime() <= Date.now()) {
      setError('Нельзя создать рейс в прошлом')
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

      const fullFlightNumber = `${form.airlineCode}${form.flightDigits.trim()}`

      const savedFlight = await createFlightApi({
        flightNumber: fullFlightNumber,
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
      setAllFlights((prev) => {
        const nowIso = new Date().toISOString()
        const hydratedSaved = withRiskTimestamp(savedFlight, mapFlightsById(prev), nowIso)
        return [hydratedSaved, ...prev.filter((flight) => flight.id !== savedFlight.id)]
      })
      setSelectedWeatherAirportId(selectedFrom.id)
      setForm(createInitialForm())
      setActiveTab('monitoring')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать рейс. Проверьте backend и доступ к погодному API.')
    } finally {
      setIsEvaluating(false)
    }
  }

  const openFlightFromList = useCallback((flight) => {
    if (!flight) return
    setActiveFlight(flight)
    setSelectedWeatherAirportId(flight.fromAirportId)
    setActiveTab('monitoring')
  }, [])

  const setFlightActionPending = useCallback((flightId, action, pending) => {
    setFlightActionById((prev) => ({
      ...prev,
      [flightId]: {
        ...(prev[flightId] ?? {}),
        [action]: pending,
      },
    }))
  }, [])

  const handleRefreshRisk = useCallback(
    async (flightId) => {
      setFlightActionError('')
      setFlightActionPending(flightId, 'refresh', true)

      try {
        const refreshedFlight = await refreshFlightRiskApi(flightId)
        setAllFlights((prev) => {
          const nowIso = new Date().toISOString()
          const knownById = mapFlightsById(prev)
          const nextFlight = withRiskTimestamp(refreshedFlight, knownById, nowIso)
          return prev.map((flight) => (flight.id === nextFlight.id ? nextFlight : flight))
        })
        setActiveFlight((prev) => {
          if (prev?.id !== refreshedFlight.id) return prev
          return withRiskTimestamp(
            refreshedFlight,
            prev ? { [prev.id]: prev } : {},
            new Date().toISOString(),
          )
        })
      } catch (cause) {
        setFlightActionError(
          cause instanceof Error ? cause.message : 'Не удалось обновить риск по рейсу.',
        )
      } finally {
        setFlightActionPending(flightId, 'refresh', false)
      }
    },
    [setFlightActionPending],
  )

  const handleCancelFlight = useCallback(
    async (flight) => {
      if (!flight?.id) return

      setFlightActionError('')
      setFlightActionPending(flight.id, 'cancel', true)

      try {
        await cancelFlightApi(flight.id)

        const flightsFromServer = await fetchAllFlights()
        const nextFlights = hydrateFlightsWithRiskTimestamps(
          Array.isArray(flightsFromServer) ? flightsFromServer : [],
          allFlights,
          new Date().toISOString(),
        )
        setAllFlights(nextFlights)

        setActiveFlight((prev) => {
          if (!prev?.id) return prev
          return nextFlights.find((item) => item.id === prev.id) ?? null
        })

        setSelectedWeatherAirportId((prev) =>
          prev && (prev === flight.fromAirportId || prev === flight.toAirportId) ? '' : prev,
        )
      } catch (cause) {
        setFlightActionError(cause instanceof Error ? cause.message : 'Не удалось отменить рейс.')
      } finally {
        setFlightActionPending(flight.id, 'cancel', false)
      }
    },
    [allFlights, setFlightActionPending],
  )

  const requestCancelFlight = useCallback((flight) => {
    if (!flight?.id) return
    setFlightToDelete(flight)
  }, [])

  const confirmCancelFlight = useCallback(() => {
    if (!flightToDelete?.id) return
    handleCancelFlight(flightToDelete)
    setFlightToDelete(null)
  }, [flightToDelete, handleCancelFlight])

  useEffect(() => {
    if (!flightToDelete) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setFlightToDelete(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flightToDelete])

  useEffect(() => {
    if (activeTab !== 'monitoring') return
    if (!mapRef.current) return
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 0)
    return () => clearTimeout(timer)
  }, [activeTab])

  const displayedRisk = activeRisk ?? previewRisk

  return (
    <Stack className="dispatcher-app" gap="md">
      <Paper withBorder radius="xl" p="md" className="surface-card surface-card--tabs">
        <Group justify="space-between" gap="md" wrap="wrap">
          <Title order={3}>Панель диспетчера</Title>
          <SegmentedControl
            radius="xl"
            size="md"
            value={activeTab}
            onChange={setActiveTab}
            data={[
              { value: 'monitoring', label: 'Мониторинг' },
              { value: 'flights', label: 'Рейсы' },
            ]}
          />
        </Group>
      </Paper>

      {activeTab === 'monitoring' && (
        <Grid gutter="md">
          <Grid.Col span={{ base: 12, xl: 4 }}>
            <Paper withBorder radius="xl" p="lg" className="surface-card">
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <Title order={4}>Создание рейса</Title>
                  <Badge variant="light" color="teal">
                    live risk
                  </Badge>
                </Group>

                <div className="form-grid">
                  <NativeSelect
                    label="Город отправления"
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
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </NativeSelect>

                  <NativeSelect
                    label="Город назначения"
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
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </NativeSelect>

                  <NativeSelect
                    label="Аэропорт отправления"
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
                      <option key={airport.id} value={airport.id}>
                        {airport.id} - {airport.name}
                      </option>
                    ))}
                  </NativeSelect>

                  <NativeSelect
                    label="Аэропорт назначения"
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
                      <option key={airport.id} value={airport.id}>
                        {airport.id} - {airport.name}
                      </option>
                    ))}
                  </NativeSelect>

                  <TextInput
                    label="Дата и время вылета"
                    type="datetime-local"
                    value={form.departureAt}
                    onChange={(event) => setForm((prev) => ({ ...prev, departureAt: event.target.value }))}
                  />

                  <NativeSelect
                    label="Код авиакомпании (IATA)"
                    value={form.airlineCode}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, airlineCode: event.target.value.toUpperCase() }))
                    }
                  >
                    {AIRLINE_IATA_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </NativeSelect>

                  <TextInput
                    label="Цифры рейса"
                    inputMode="numeric"
                    placeholder="123"
                    value={form.flightDigits}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '').slice(0, 4)
                      setForm((prev) => ({ ...prev, flightDigits: digits }))
                    }}
                  />
                </div>

                <Button radius="xl" size="md" onClick={createFlight} loading={isEvaluating}>
                  Создать рейс
                </Button>

                {error && (
                  <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />}>
                    {error}
                  </Alert>
                )}
              </Stack>
            </Paper>
          </Grid.Col>

          <Grid.Col span={{ base: 12, xl: 8 }}>
            <Paper withBorder radius="xl" p="lg" className="surface-card">
              <Stack gap="md">
                <Title order={4}>Результат мониторинга</Title>

                <div className="map-stage">
                  <div className="risk-legend">
                    {RISK_LEGEND.map((item) => (
                      <div key={item.label} className="legend-item">
                        <span className={`legend-dot ${item.className}`} />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>

                  {leafletError && (
                    <Alert className="map-error" color="red" icon={<IconAlertCircle size={16} />}>
                      {leafletError}
                    </Alert>
                  )}
                  <div ref={mapContainerRef} className="leaflet-map" />
                </div>

                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  <Card withBorder radius="lg" padding="md" className="surface-card surface-card--subtle">
                    <Stack gap="sm">
                      <Title order={5}>Погода выбранной точки</Title>
                      {selectedWeatherAirport && selectedWeather ? (
                        <>
                          <Text fw={600}>
                            {selectedWeatherAirport.id} - {selectedWeatherAirport.name},{' '}
                            {selectedWeatherAirport.city}
                          </Text>
                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Описание</Text>
                              <Text fw={600}>{selectedWeather.weather?.[0]?.description ?? 'нет данных'}</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Температура</Text>
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.main?.temp)} °C</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Ощущается</Text>
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.main?.feels_like)} °C</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Ветер</Text>
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.wind?.speed)} м/с</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Порывы</Text>
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.wind?.gust)} м/с</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Видимость</Text>
                              <Text fw={600}>{formatVisibilityKmOrNA(selectedWeather.visibility)} км</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Давление</Text>
                              <Text fw={600}>{formatIntOrNA(selectedWeather.main?.pressure)} гПа</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Влажность</Text>
                              <Text fw={600}>{formatIntOrNA(selectedWeather.main?.humidity)}%</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Облачность</Text>
                              <Text fw={600}>{formatIntOrNA(selectedWeather.clouds?.all)}%</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              <Text size="xs" c="dimmed">Осадки</Text>
                              <Text fw={600}>{formatFixedOrNA(getPrecipPerHour(selectedWeather))} мм/ч</Text>
                            </Paper>
                          </SimpleGrid>
                        </>
                      ) : (
                        <Text c="dimmed">
                          Нажмите на точку аэропорта на карте, чтобы увидеть параметры погоды.
                        </Text>
                      )}
                    </Stack>
                  </Card>

                  <Card withBorder radius="lg" padding="md" className="surface-card surface-card--subtle">
                    <Stack gap="sm">
                      <Title order={5}>Оценка риска по погоде</Title>
                      {displayedRisk ? (
                        <>
                          {!activeRisk && previewRisk && (
                            <Text c="dimmed" size="sm">Предварительная оценка до создания рейса.</Text>
                          )}

                          <Group justify="space-between">
                            <Text size="sm">Взлет</Text>
                            <Text size="sm" fw={600}>
                              {displayedRisk.departure.score}/100 ({riskLevelLabel(displayedRisk.departure.score)})
                            </Text>
                          </Group>
                          <Progress value={displayedRisk.departure.score} color={getRiskColor(displayedRisk.departure.score)} />

                          <Group justify="space-between">
                            <Text size="sm">Посадка</Text>
                            <Text size="sm" fw={600}>
                              {displayedRisk.arrival.score}/100 ({riskLevelLabel(displayedRisk.arrival.score)})
                            </Text>
                          </Group>
                          <Progress value={displayedRisk.arrival.score} color={getRiskColor(displayedRisk.arrival.score)} />

                          <Group justify="space-between">
                            <Text size="sm">Эшелон ~12 км</Text>
                            <Text size="sm" fw={600}>
                              {displayedRisk.cruise.score}/100 ({riskLevelLabel(displayedRisk.cruise.score)})
                            </Text>
                          </Group>
                          <Progress value={displayedRisk.cruise.score} color={getRiskColor(displayedRisk.cruise.score)} />

                          <Divider />
                          <Group justify="space-between">
                            <Text fw={700}>Итоговый риск</Text>
                            <Text fw={700}>
                              {displayedRisk.total}/100 ({riskLevelLabel(displayedRisk.total)})
                            </Text>
                          </Group>
                          <Progress value={displayedRisk.total} color={getRiskColor(displayedRisk.total)} size="lg" radius="xl" />
                        </>
                      ) : isPreviewEvaluating ? (
                        <Text c="dimmed">Предварительный расчет риска...</Text>
                      ) : (
                        <Text c="dimmed">
                          Создайте рейс, чтобы получить расчет риска по текущим погодным условиям.
                        </Text>
                      )}
                    </Stack>
                  </Card>
                </SimpleGrid>
              </Stack>
            </Paper>
          </Grid.Col>
        </Grid>
      )}

      {activeTab === 'flights' && (
        <Paper withBorder radius="xl" p="lg" className="surface-card">
          <Stack gap="md">
            <Title order={4}>Все рейсы</Title>
            {isLoadingFlights ? (
              <Text c="dimmed">Загружаем рейсы...</Text>
            ) : allFlights.length === 0 ? (
              <Text c="dimmed">Пока нет созданных рейсов.</Text>
            ) : (
              <Box className="flights-table-wrap">
                <Table highlightOnHover stickyHeader withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Рейс</Table.Th>
                      <Table.Th>Маршрут</Table.Th>
                      <Table.Th>Вылет</Table.Th>
                      <Table.Th>Прилет</Table.Th>
                      <Table.Th>Риск</Table.Th>
                      <Table.Th>Действия</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {allFlights.map((flight) => {
                      const estimatedArrivalAt = getFlightArrivalForTable(flight)
                      const riskScore = asNumberOrNull(flight.totalRisk)
                      const riskUpdatedAt =
                        flight?.riskUpdatedAt ?? flight?.cachedRiskUpdatedAt ?? flight?.createdAt ?? null
                      const actionState = flightActionById[flight.id] ?? {}
                      const isRefreshing = Boolean(actionState.refresh)
                      const isCancelling = Boolean(actionState.cancel)
                      const isActionPending = isRefreshing || isCancelling

                      return (
                        <Table.Tr
                          key={flight.id}
                          className="flight-row"
                          onClick={() => openFlightFromList(flight)}
                        >
                          <Table.Td>{flight.flightNumber}</Table.Td>
                          <Table.Td>
                            {flight.fromAirportId} - {flight.toAirportId}
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              <Text size="sm">{formatDateTime(flight.departureAt)}</Text>
                              <Text size="xs" c="dimmed">
                                {formatTimeLeftToDeparture(flight.departureAt, timeTick)}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>{formatDateTime(estimatedArrivalAt)}</Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              <Group gap={8} align="center">
                                <Badge variant="dot" color={getRiskColor(riskScore ?? 0)}>
                                  {riskScore == null ? 'нет данных' : `${riskScore}/100`}
                                </Badge>
                              </Group>
                              <Text size="xs" c="dimmed">
                                {formatRiskUpdatedAgo(riskUpdatedAt, timeTick)}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap" className="flight-actions">
                              <Button
                                variant="light"
                                color="yellow"
                                radius="xl"
                                size="xs"
                                leftSection={<IconMessageCircle size={14} />}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onRequestMeteorologist?.({
                                    flightNumber: flight.flightNumber ?? '',
                                    fromAirportId: flight.fromAirportId ?? '',
                                    toAirportId: flight.toAirportId ?? '',
                                    etd: toDateTimeLocalValue(flight.departureAt),
                                    eta: toDateTimeLocalValue(estimatedArrivalAt),
                                  })
                                }}
                                disabled={isActionPending}
                              >
                                Метеоролог
                              </Button>
                              <ActionIcon
                                variant="subtle"
                                color="blue"
                                size="lg"
                                radius="xl"
                                title="Обновить риск"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleRefreshRisk(flight.id)
                                }}
                                disabled={isActionPending}
                              >
                                <IconRefresh size={16} />
                              </ActionIcon>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                size="lg"
                                radius="xl"
                                title="Отменить рейс"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  requestCancelFlight(flight)
                                }}
                                disabled={isActionPending}
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
              </Box>
            )}

            {flightsError && (
              <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />}>
                {flightsError}
              </Alert>
            )}
            {flightActionError && (
              <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />}>
                {flightActionError}
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      <Modal
        opened={Boolean(flightToDelete)}
        onClose={() => setFlightToDelete(null)}
        centered
        radius="xl"
        title="Подтверждение удаления"
      >
        <Stack gap="md">
          <Text>
            Удалить рейс <strong>{flightToDelete?.flightNumber}</strong> ({flightToDelete?.fromAirportId} -{' '}
            {flightToDelete?.toAirportId})?
          </Text>
          <Group justify="flex-end">
            <Button variant="default" radius="xl" onClick={() => setFlightToDelete(null)}>
              Нет
            </Button>
            <Button color="red" radius="xl" onClick={confirmCancelFlight}>
              Да, удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
