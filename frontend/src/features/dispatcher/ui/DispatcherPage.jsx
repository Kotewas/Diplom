import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Autocomplete,
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
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  Title,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconMessageCircle,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import { AIRPORTS_RF, HELIPORTS_TVER, TVER_REGION_BOUNDS } from '../model/constants'
import {
  clampScore,
  evaluateCruiseRisk,
  evaluateSurfaceRisk,
  getFeasibility,
  getPrecipPerHour,
  getStormWarning,
  evaluateTemporalRisk,
  riskLevelLabel,
} from '../model/risk'
import { loadLeafletAssets } from '../services/leafletLoader'
import {
  applyFlightDecision as applyFlightDecisionApi,
  cancelFlight as cancelFlightApi,
  createFlight as createFlightApi,
  fetchAllFlights,
  refreshFlightRisk as refreshFlightRiskApi,
  simulateFlightDelayWhatIf as simulateFlightDelayWhatIfApi,
} from '../services/flightsApi'
import { fetchAirports as fetchAirportsApi } from '../services/airportsApi'
import { readFlightsCache, writeFlightsCache } from '../services/flightsCacheStorage'
import {
  markMeteorologistResponsesSeenForDispatcher,
  readNewMeteorologistResponsesForDispatcher,
} from '../services/meteorologistRequestsStorage'
import { fetchWeatherByAirport, isWeatherCacheFresh } from '../services/weatherApi'
import './DispatcherPage.css'

const RISK_LEGEND = [
  { label: 'Низкий', className: 'dot-low' },
  { label: 'Умеренный', className: 'dot-medium' },
  { label: 'Высокий', className: 'dot-high' },
  { label: 'Критический', className: 'dot-critical' },
]

const AIRLINE_IATA_CODES = ['SU', 'DP', 'FV', 'UT', 'EO', 'YC', 'WZ', 'RA']
const TRANSPORT_MODE_AIRPLANE = 'AIRPLANE'
const TRANSPORT_MODE_HELICOPTER = 'HELICOPTER'
const HELICOPTER_FLIGHT_PREFIX = 'H'
const AIRPLANE_CRUISE_SPEED_KMH = 820
const AIRPLANE_OPERATIONS_MINUTES = 25
const AIRPLANE_MIN_TOTAL_FLIGHT_MINUTES = 35
const HELICOPTER_CRUISE_SPEED_KMH = 220
const HELICOPTER_OPERATIONS_MINUTES = 12
const HELICOPTER_MIN_TOTAL_FLIGHT_MINUTES = 18
const ROUTE_STEPS = 96
const DEPARTURE_TIME_STEP_MINUTES = 5
const MIN_DEPARTURE_LEAD_MINUTES = 1
const DEFAULT_DEPARTURE_LEAD_MINUTES = 60
const DISPATCHER_DECISION_PENDING = 'PENDING'
const DISPATCHER_DECISION_APPROVE = 'APPROVE'
const DISPATCHER_DECISION_DELAY = 'DELAY'
const DISPATCHER_DECISION_CANCEL = 'CANCEL'
const WHAT_IF_DELAY_OPTIONS = [15, 30, 60, 120]
const RECOVERY_CHECK_INTERVAL_MS = 20000
const RISK_HEATMAP_MAX_POINTS = 240
const ICING_AIRPORTS_LIMIT = 80
const ICING_WEATHER_LOAD_LIMIT = 24
const AIRPORT_SCOPE_PASSENGER = 'PASSENGER'
const AIRPORT_SCOPE_ALL = 'ALL'
const PLANE_ICON_HTML = `
  <span class="plane-marker-inner">
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M60 30 L36 24 L24 4 L18 6 L24 24 L8 20 L4 24 L18 32 L4 40 L8 44 L24 40 L18 58 L24 60 L36 40 L60 34 Z" />
    </svg>
  </span>
`

function pad2(value) {
  return String(value).padStart(2, '0')
}

function toDateTimeLocalInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function roundDateUpToMinuteStep(date, stepMinutes = DEPARTURE_TIME_STEP_MINUTES) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return new Date()

  const safeStep = Math.max(1, stepMinutes)
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)

  const minute = rounded.getMinutes()
  const remainder = minute % safeStep
  if (remainder !== 0) {
    rounded.setMinutes(minute + (safeStep - remainder))
  }

  return rounded
}

function getMinDepartureAtValue(nowTimestamp = Date.now()) {
  const minDate = roundDateUpToMinuteStep(
    new Date(nowTimestamp + MIN_DEPARTURE_LEAD_MINUTES * 60 * 1000),
  )
  return toDateTimeLocalInputValue(minDate)
}

function getDefaultDepartureAtValue(nowTimestamp = Date.now()) {
  const defaultDate = roundDateUpToMinuteStep(
    new Date(nowTimestamp + DEFAULT_DEPARTURE_LEAD_MINUTES * 60 * 1000),
  )
  return toDateTimeLocalInputValue(defaultDate)
}

function createInitialForm(
  nowTimestamp = Date.now(),
  transportMode = TRANSPORT_MODE_AIRPLANE,
) {
  return {
    fromCity: '',
    toCity: '',
    fromAirportId: '',
    toAirportId: '',
    departureAt: getDefaultDepartureAtValue(nowTimestamp),
    airlineCode:
      transportMode === TRANSPORT_MODE_HELICOPTER
        ? HELICOPTER_FLIGHT_PREFIX
        : AIRLINE_IATA_CODES[0],
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

  const localDateTimeMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
  )
  if (localDateTimeMatch) {
    const [, year, month, day, hours, minutes, seconds = '0', fraction = '0'] = localDateTimeMatch
    const milliseconds = Number((fraction + '000').slice(0, 3))
    const localParsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      milliseconds,
    )
    return Number.isNaN(localParsed.getTime()) ? null : localParsed
  }

  const nativeDate = new Date(value)
  if (!Number.isNaN(nativeDate.getTime())) return nativeDate
  return null
}

function normalizeSearchText(value) {
  return String(value ?? '').trim().toLowerCase()
}

function isPassengerAirportCandidate(airport) {
  const airportId = String(airport?.id ?? '').trim().toUpperCase()
  if (!airportId || airportId.endsWith('_HELI')) return false
  if (/^RU-\d+$/i.test(airportId)) return false
  if (/^[A-Z]{3}$/.test(airportId)) return true

  const airportName = normalizeSearchText(airport?.name)
  if (!airportName) return false
  return airportName.includes('международ')
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

function toRadians(value) {
  return (value * Math.PI) / 180
}

function toDegrees(value) {
  return (value * 180) / Math.PI
}

function normalizeLongitude(value) {
  let lon = value
  while (lon > 180) lon -= 360
  while (lon < -180) lon += 360
  return lon
}

function buildOrthodromePath(fromAirport, toAirport, steps = ROUTE_STEPS) {
  const lat1 = toRadians(fromAirport.lat)
  const lon1 = toRadians(fromAirport.lon)
  const lat2 = toRadians(toAirport.lat)
  const lon2 = toRadians(toAirport.lon)
  const angularDistance = 2 * Math.asin(
    Math.sqrt(
      Math.sin((lat2 - lat1) / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
    ),
  )

  if (!Number.isFinite(angularDistance) || angularDistance < 1e-10) {
    return [
      [fromAirport.lat, fromAirport.lon],
      [toAirport.lat, toAirport.lon],
    ]
  }

  const points = []
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps
    const a = Math.sin((1 - fraction) * angularDistance) / Math.sin(angularDistance)
    const b = Math.sin(fraction * angularDistance) / Math.sin(angularDistance)

    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
    const z = a * Math.sin(lat1) + b * Math.sin(lat2)

    const lat = Math.atan2(z, Math.sqrt(x * x + y * y))
    const lon = Math.atan2(y, x)

    points.push([toDegrees(lat), normalizeLongitude(toDegrees(lon))])
  }

  return points
}

function getPathPointAt(path, fraction) {
  if (!Array.isArray(path) || path.length === 0) return null
  if (path.length === 1) return path[0]

  const clamped = Math.max(0, Math.min(1, fraction))
  const scaled = clamped * (path.length - 1)
  const index = Math.floor(scaled)
  const nextIndex = Math.min(path.length - 1, index + 1)
  const localFraction = scaled - index

  const current = path[index]
  const next = path[nextIndex]

  return [
    current[0] + (next[0] - current[0]) * localFraction,
    current[1] + (next[1] - current[1]) * localFraction,
  ]
}

function getPathBearingDegrees(path, fraction) {
  if (!Array.isArray(path) || path.length < 2) return 0

  const clamped = Math.max(0, Math.min(1, fraction))
  const scaled = clamped * (path.length - 1)
  const index = Math.floor(scaled)

  const start = path[Math.max(0, index - 1)]
  const end = path[Math.min(path.length - 1, index + 1)]
  if (!start || !end) return 0

  const lat1 = toRadians(start[0])
  const lon1 = toRadians(start[1])
  const lat2 = toRadians(end[0])
  const lon2 = toRadians(end[1])
  const dLon = lon2 - lon1

  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)

  const bearing = toDegrees(Math.atan2(y, x))
  return (bearing + 360) % 360
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

function isFlightDeparted(flight, nowTimestamp) {
  const departureDate = parseDateTime(flight?.departureAt)
  if (!departureDate) return false
  return departureDate.getTime() <= nowTimestamp
}

function getErrorMessage(cause, fallback) {
  if (cause instanceof Error && cause.message) return cause.message
  if (typeof cause === 'string' && cause.trim()) return cause
  return fallback
}

function isBackendConnectivityError(message) {
  const normalized = String(message ?? '').trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes('нет соединения с backend')
    || normalized.includes('сервер не ответил')
    || normalized.includes('backend недоступен')
    || normalized.includes('network error')
    || normalized.includes('failed to fetch')
  )
}

function getRiskHeatColor(score) {
  if (score <= 30) return '#099268'
  if (score <= 55) return '#f08c00'
  if (score <= 75) return '#f76707'
  return '#e03131'
}

function calculateTotalRisk(departureRisk, arrivalRisk, cruiseRisk, temporalRisk) {
  return clampScore(
    departureRisk.score * 0.34
      + arrivalRisk.score * 0.34
      + cruiseRisk.score * 0.22
      + temporalRisk.score * 0.1,
  )
}

function hasWeatherPayload(weather) {
  if (!weather || typeof weather !== 'object') return false

  return (
    Number.isFinite(Number(weather?.main?.temp))
    || Number.isFinite(Number(weather?.wind?.speed))
    || Number.isFinite(Number(weather?.visibility))
    || Array.isArray(weather?.weather)
  )
}

function getIcingColor(level) {
  if (level === 'severe') return '#1d4ed8'
  if (level === 'warning') return '#2563eb'
  return '#60a5fa'
}

function getFogColor(level) {
  if (level === 'severe') return '#475569'
  if (level === 'warning') return '#64748b'
  return '#94a3b8'
}

function getThunderColor(level) {
  if (level === 'severe') return '#7c3aed'
  if (level === 'warning') return '#8b5cf6'
  return '#a78bfa'
}

function getWindColor(level) {
  if (level === 'severe') return '#e8590c'
  if (level === 'warning') return '#f08c00'
  return '#fab005'
}

function getIcingHazard(weather) {
  if (!weather || typeof weather !== 'object') return null

  const temp = asNumberOrNull(weather?.main?.temp)
  const humidity = asNumberOrNull(weather?.main?.humidity)
  const cloudiness = asNumberOrNull(weather?.clouds?.all)
  const visibility = asNumberOrNull(weather?.visibility)
  const precipPerHour = asNumberOrNull(getPrecipPerHour(weather)) ?? 0
  const weatherCode = asNumberOrNull(weather?.weather?.[0]?.id) ?? 800

  let score = 0
  const reasons = []

  const addReason = (text) => {
    if (!text) return
    if (!reasons.includes(text)) reasons.push(text)
  }

  if (temp != null && temp <= 5 && temp >= -25) {
    score += 16
    addReason(`Температура ${temp.toFixed(1)}°C в потенциальной зоне обледенения`)
  }
  if (temp != null && temp <= 0 && temp >= -15) score += 10

  if (humidity != null && humidity >= 80) {
    score += 12
    addReason(`Влажность ${Math.round(humidity)}%`)
  }
  if (cloudiness != null && cloudiness >= 70) {
    score += 10
    addReason(`Облачность ${Math.round(cloudiness)}%`)
  }

  if (precipPerHour >= 0.2) {
    score += 14
    addReason(`Осадки ${precipPerHour.toFixed(1)} мм/ч`)
  }
  if (precipPerHour >= 1) score += 10

  if (weatherCode === 511 || weatherCode === 611 || weatherCode === 612 || weatherCode === 613) {
    score += 28
    addReason('Ледяной дождь/переохлажденные осадки')
  } else if (weatherCode >= 600 && weatherCode < 700) {
    score += 16
    addReason('Снежные осадки')
  }

  if (visibility != null && visibility < 3000) {
    score += 6
    addReason(`Сниженная видимость ${Math.round(visibility)} м`)
  }

  const finalScore = clampScore(score)
  if (finalScore < 20) return null

  const level = finalScore >= 65 ? 'severe' : finalScore >= 45 ? 'warning' : 'watch'
  const title =
    level === 'severe'
      ? 'Высокий риск оледенения'
      : level === 'warning'
        ? 'Умеренный риск оледенения'
        : 'Слабый риск оледенения'

  return {
    level,
    score: finalScore,
    title,
    reasons,
  }
}

function getFogHazard(weather) {
  if (!weather || typeof weather !== 'object') return null

  const visibility = asNumberOrNull(weather?.visibility)
  const humidity = asNumberOrNull(weather?.main?.humidity)
  const cloudiness = asNumberOrNull(weather?.clouds?.all)
  const weatherCode = asNumberOrNull(weather?.weather?.[0]?.id) ?? 800

  let score = 0
  const reasons = []

  const addReason = (text) => {
    if (!text) return
    if (!reasons.includes(text)) reasons.push(text)
  }

  if (visibility != null && visibility < 8000) {
    score += 14
    addReason(`Сниженная видимость ${Math.round(visibility)} м`)
  }
  if (visibility != null && visibility < 5000) score += 12
  if (visibility != null && visibility < 2500) score += 16
  if (visibility != null && visibility < 1000) {
    score += 20
    addReason('Очень низкая видимость')
  }

  if (humidity != null && humidity >= 85) {
    score += 8
    addReason(`Влажность ${Math.round(humidity)}%`)
  }
  if (cloudiness != null && cloudiness >= 80) {
    score += 6
    addReason(`Облачность ${Math.round(cloudiness)}%`)
  }

  if (weatherCode === 741 || weatherCode === 701 || weatherCode === 721) {
    score += 24
    addReason('Туман/дымка по коду погоды')
  } else if (weatherCode === 731 || weatherCode === 751 || weatherCode === 761) {
    score += 10
    addReason('Пылевые/аэрозольные явления')
  }

  const finalScore = clampScore(score)
  if (finalScore < 20) return null

  const level = finalScore >= 70 ? 'severe' : finalScore >= 45 ? 'warning' : 'watch'
  const title =
    level === 'severe'
      ? 'Критическая видимость'
      : level === 'warning'
        ? 'Риск тумана'
        : 'Фон тумана'

  return {
    level,
    score: finalScore,
    title,
    reasons,
  }
}

function getThunderHazard(weather) {
  if (!weather || typeof weather !== 'object') return null

  const weatherCode = asNumberOrNull(weather?.weather?.[0]?.id) ?? 800
  const wind = asNumberOrNull(weather?.wind?.speed) ?? 0
  const gust = asNumberOrNull(weather?.wind?.gust) ?? wind
  const precipPerHour = asNumberOrNull(getPrecipPerHour(weather)) ?? 0
  const cloudiness = asNumberOrNull(weather?.clouds?.all)

  let score = 0
  const reasons = []

  const addReason = (text) => {
    if (!text) return
    if (!reasons.includes(text)) reasons.push(text)
  }

  if (weatherCode >= 200 && weatherCode < 300) {
    score += 56
    addReason('Грозовая активность по коду погоды')
  }
  if (weatherCode >= 500 && weatherCode < 600 && precipPerHour >= 2) {
    score += 18
    addReason(`Ливневые осадки ${precipPerHour.toFixed(1)} мм/ч`)
  }
  if (weatherCode >= 300 && weatherCode < 400) score += 8

  if (gust >= 14) {
    score += 10
    addReason(`Порывы ${gust.toFixed(1)} м/с`)
  }
  if (gust >= 20) score += 12
  if (wind >= 12) score += 8

  if (cloudiness != null && cloudiness >= 90) {
    score += 8
    addReason(`Высокая облачность ${Math.round(cloudiness)}%`)
  }

  const finalScore = clampScore(score)
  if (finalScore < 20) return null

  const level = finalScore >= 70 ? 'severe' : finalScore >= 45 ? 'warning' : 'watch'
  const title =
    level === 'severe'
      ? 'Шторм/гроза'
      : level === 'warning'
        ? 'Вероятность грозы'
        : 'Грозовой фон'

  return {
    level,
    score: finalScore,
    title,
    reasons,
  }
}

function getWindHazard(weather) {
  if (!weather || typeof weather !== 'object') return null

  const wind = asNumberOrNull(weather?.wind?.speed) ?? 0
  const gust = asNumberOrNull(weather?.wind?.gust) ?? wind

  let score = 0
  const reasons = []

  const addReason = (text) => {
    if (!text) return
    if (!reasons.includes(text)) reasons.push(text)
  }

  if (wind >= 10) {
    score += 16
    addReason(`Устойчивый ветер ${wind.toFixed(1)} м/с`)
  }
  if (wind >= 14) score += 14
  if (wind >= 18) score += 16

  if (gust >= 15) {
    score += 14
    addReason(`Порывы ${gust.toFixed(1)} м/с`)
  }
  if (gust >= 20) score += 14
  if (gust >= 25) {
    score += 18
    addReason('Опасные шквальные порывы')
  }

  const finalScore = clampScore(score)
  if (finalScore < 20) return null

  const level = finalScore >= 70 ? 'severe' : finalScore >= 45 ? 'warning' : 'watch'
  const title =
    level === 'severe'
      ? 'Сильный ветер'
      : level === 'warning'
        ? 'Повышенный ветер'
        : 'Ветровой фон'

  return {
    level,
    score: finalScore,
    title,
    reasons,
  }
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

function decisionLabel(decision) {
  switch (decision) {
    case DISPATCHER_DECISION_APPROVE:
      return 'Разрешен'
    case DISPATCHER_DECISION_DELAY:
      return 'Задержан'
    case DISPATCHER_DECISION_CANCEL:
      return 'Отменен'
    default:
      return 'Ожидает решения'
  }
}

function decisionColor(decision) {
  switch (decision) {
    case DISPATCHER_DECISION_APPROVE:
      return 'teal'
    case DISPATCHER_DECISION_DELAY:
      return 'yellow'
    case DISPATCHER_DECISION_CANCEL:
      return 'red'
    default:
      return 'gray'
  }
}

function emergencyTypeMeta(type) {
  switch (type) {
    case 'RUNWAY_RESTRICTION':
      return { title: 'Ограничение ВПП/площадки', penalty: 28, focus: 'surface' }
    case 'THUNDERSTORM_FRONT':
      return { title: 'Грозовой фронт', penalty: 24, focus: 'route' }
    case 'LOW_VISIBILITY_EVENT':
      return { title: 'Резкое ухудшение видимости', penalty: 22, focus: 'surface' }
    case 'AIRSPACE_RESTRICTION':
      return { title: 'Ограничение воздушного пространства', penalty: 18, focus: 'route' }
    case 'ATC_CAPACITY':
      return { title: 'Перегрузка диспетчерского сектора', penalty: 14, focus: 'all' }
    default:
      return { title: 'Чрезвычайная ситуация', penalty: 20, focus: 'all' }
  }
}

function emergencyLevelMultiplier(level) {
  if (level === 'HIGH') return 1.35
  if (level === 'MEDIUM') return 1
  return 0.7
}

function asFactorsArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function applyEmergencyScenarioToRisk(risk, emergencyScenario) {
  if (!risk || !emergencyScenario?.active) return risk

  const meta = emergencyTypeMeta(emergencyScenario.type)
  const multiplier = emergencyLevelMultiplier(emergencyScenario.level)
  const penalty = Math.round(meta.penalty * multiplier)

  let depBoost = Math.round(penalty * 0.45)
  let arrBoost = Math.round(penalty * 0.45)
  let cruiseBoost = Math.round(penalty * 0.35)

  if (meta.focus === 'surface') {
    depBoost = Math.round(penalty * 0.6)
    arrBoost = Math.round(penalty * 0.55)
    cruiseBoost = Math.round(penalty * 0.2)
  } else if (meta.focus === 'route') {
    depBoost = Math.round(penalty * 0.28)
    arrBoost = Math.round(penalty * 0.28)
    cruiseBoost = Math.round(penalty * 0.72)
  }

  const scenarioText = `Сценарий ЧС: ${meta.title} (${emergencyScenario.level})`
  const commentText = emergencyScenario.comment?.trim()
  const commentSuffix = commentText ? `; комментарий: ${commentText}` : ''
  const depFactors = asFactorsArray(risk?.departure?.factors)
  const arrFactors = asFactorsArray(risk?.arrival?.factors)
  const cruiseFactors = asFactorsArray(risk?.cruise?.factors)

  const departure = {
    ...risk.departure,
    score: clampScore((risk.departure?.score ?? 0) + depBoost),
    factors: [...depFactors, `${scenarioText}${commentSuffix}`],
  }
  const arrival = {
    ...risk.arrival,
    score: clampScore((risk.arrival?.score ?? 0) + arrBoost),
    factors: [...arrFactors, `${scenarioText}${commentSuffix}`],
  }
  const cruise = {
    ...risk.cruise,
    score: clampScore((risk.cruise?.score ?? 0) + cruiseBoost),
    factors: [...cruiseFactors, `${scenarioText}${commentSuffix}`],
  }

  const total = clampScore(
    departure.score * 0.4 + arrival.score * 0.4 + cruise.score * 0.2,
  )

  return {
    ...risk,
    departure,
    arrival,
    cruise,
    total,
    feasibility: getFeasibility(total),
    emergencyAdjustment: {
      label: meta.title,
      level: emergencyScenario.level,
      penalty,
      comment: commentText,
    },
  }
}

function buildSystemRecommendations({
  risk,
  emergencyScenario,
  selectedStormWarning,
  needsMeteoRequest = false,
}) {
  if (!risk || typeof risk !== 'object') return []

  const totalRisk = Number.isFinite(Number(risk.total)) ? Number(risk.total) : 0
  const stormLevel = selectedStormWarning?.level
  const emergencyActive = Boolean(emergencyScenario?.active)
  const emergencyPenalty = Number(risk?.emergencyAdjustment?.penalty ?? 0)
  const emergencyType = emergencyScenario?.type

  const approveScore = clampScore(
    95 - totalRisk - (stormLevel === 'severe' ? 22 : stormLevel ? 10 : 0) - (emergencyActive ? 16 : 0),
  )
  const delay30Score = clampScore(
    totalRisk + 8 + emergencyPenalty * 0.35 + (stormLevel === 'severe' ? 18 : stormLevel ? 10 : 2),
  )
  const delay60Score = clampScore(
    totalRisk + 14 + emergencyPenalty * 0.55 + (stormLevel === 'severe' ? 24 : stormLevel ? 12 : 4),
  )
  const cancelScore = clampScore(
    (totalRisk - 55) * 1.7
      + (stormLevel === 'severe' ? 20 : 0)
      + (emergencyType === 'RUNWAY_RESTRICTION' ? 18 : 0)
      + emergencyPenalty * 0.45,
  )

  const recommendations = [
    {
      code: 'APPROVE',
      title: 'Разрешить вылет',
      score: approveScore,
      color: 'teal',
      reason: 'Риск и внешние ограничения в приемлемой зоне.',
    },
    {
      code: 'DELAY_30',
      title: 'Задержать на 30 минут',
      score: delay30Score,
      color: 'yellow',
      reason: 'Короткая задержка может снизить операционную нагрузку.',
    },
    {
      code: 'DELAY_60',
      title: 'Задержать на 60 минут',
      score: delay60Score,
      color: 'orange',
      reason: 'Ожидание окна погоды/сектора может заметно снизить риск.',
    },
    {
      code: 'CANCEL',
      title: 'Отменить/перенаправить рейс',
      score: cancelScore,
      color: 'red',
      reason: 'Суммарный риск близок к недопустимому уровню.',
    },
  ]

  if (needsMeteoRequest) {
    const meteoScore = clampScore(
      72 + totalRisk * 0.25 + (stormLevel === 'severe' ? 12 : stormLevel ? 7 : 0) + (emergencyActive ? 8 : 0),
    )
    recommendations.push({
      code: 'REQUEST_METEO',
      title: 'Повторный запрос метеоданных',
      score: meteoScore,
      color: 'blue',
      reason: 'Погодные данные по маршруту отсутствуют или устарели.',
    })
  }

  return recommendations
    .filter((item) => item && Number.isFinite(Number(item.score)))
    .sort((left, right) => right.score - left.score)
}

function safeApplyEmergencyRisk(risk, emergencyScenario) {
  try {
    return applyEmergencyScenarioToRisk(risk, emergencyScenario)
  } catch {
    return risk
  }
}

function safeBuildRecommendations(input) {
  try {
    const result = buildSystemRecommendations(input)
    return Array.isArray(result) ? result : []
  } catch {
    return []
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toDateTimeLocalValue(value) {
  const date = parseDateTime(value)
  if (!date) return ''
  return toDateTimeLocalInputValue(date)
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
  const heatLayerRef = useRef(null)
  const icingLayerRef = useRef(null)
  const fogLayerRef = useRef(null)
  const thunderLayerRef = useRef(null)
  const windLayerRef = useRef(null)
  const airportLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const planeLayerRef = useRef(null)
  const weatherCacheRef = useRef({})
  const recoveryModeRef = useRef(false)

  const [leafletReady, setLeafletReady] = useState(false)
  const [leafletError, setLeafletError] = useState('')
  const [activeTab, setActiveTab] = useState(
    initialTab === 'flights' ? initialTab : 'monitoring',
  )
  const [transportMode, setTransportMode] = useState(TRANSPORT_MODE_AIRPLANE)

  const [form, setForm] = useState(() => createInitialForm(Date.now(), TRANSPORT_MODE_AIRPLANE))
  const [airportCatalog, setAirportCatalog] = useState(() => [...AIRPORTS_RF, ...HELIPORTS_TVER])

  const [activeFlight, setActiveFlight] = useState(null)
  const [allFlights, setAllFlights] = useState(() =>
    hydrateFlightsWithRiskTimestamps(cachedFlightsOnLoad, [], new Date().toISOString()),
  )
  const [isLoadingFlights, setIsLoadingFlights] = useState(() => cachedFlightsOnLoad.length === 0)
  const [flightsError, setFlightsError] = useState('')
  const [flightActionError, setFlightActionError] = useState('')
  const [flightActionById, setFlightActionById] = useState({})
  const [flightToDelete, setFlightToDelete] = useState(null)
  const [decisionFlight, setDecisionFlight] = useState(null)
  const [decisionForm, setDecisionForm] = useState({
    decision: DISPATCHER_DECISION_APPROVE,
    reason: '',
    delayMinutes: '30',
  })
  const [decisionWhatIf, setDecisionWhatIf] = useState(null)
  const [decisionError, setDecisionError] = useState('')
  const [isDecisionSubmitting, setIsDecisionSubmitting] = useState(false)
  const [isDecisionWhatIfLoading, setIsDecisionWhatIfLoading] = useState(false)

  const [selectedWeatherAirportId, setSelectedWeatherAirportId] = useState('')
  const [weatherByAirport, setWeatherByAirport] = useState({})

  const [isEvaluating, setIsEvaluating] = useState(false)
  const [isPreviewEvaluating, setIsPreviewEvaluating] = useState(false)
  const [previewRisk, setPreviewRisk] = useState(null)
  const [error, setError] = useState('')
  const emergencyScenario = useMemo(() => ({
    active: false,
    type: 'RUNWAY_RESTRICTION',
    level: 'MEDIUM',
    comment: '',
  }), [])
  const [showDepartedFlights, setShowDepartedFlights] = useState(false)
  const [showRiskHeatmap, setShowRiskHeatmap] = useState(true)
  const [showIcingLayer, setShowIcingLayer] = useState(true)
  const [showFogLayer, setShowFogLayer] = useState(true)
  const [showThunderLayer, setShowThunderLayer] = useState(true)
  const [showWindLayer, setShowWindLayer] = useState(true)
  const [airportScope, setAirportScope] = useState(AIRPORT_SCOPE_PASSENGER)
  const [meteorologistUpdateNotice, setMeteorologistUpdateNotice] = useState(null)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [recoveryStartedAt, setRecoveryStartedAt] = useState('')
  const [recoveryReason, setRecoveryReason] = useState('')
  const [recoveryRecoveredAt, setRecoveryRecoveredAt] = useState('')
  const [isRecoveryChecking, setIsRecoveryChecking] = useState(false)
  const [timeTick, setTimeTick] = useState(() => Date.now())
  const [planeTick, setPlaneTick] = useState(() => Date.now())
  const minDepartureAt = useMemo(() => getMinDepartureAtValue(timeTick), [timeTick])
  const isHelicopterMode = transportMode === TRANSPORT_MODE_HELICOPTER

  const allAirfields = useMemo(
    () => (Array.isArray(airportCatalog) && airportCatalog.length > 0 ? airportCatalog : [...AIRPORTS_RF, ...HELIPORTS_TVER]),
    [airportCatalog],
  )

  const availableAirfields = useMemo(
    () =>
      allAirfields.filter((airport) => {
        const isHeliPoint = String(airport?.id ?? '').endsWith('_HELI')
        return transportMode === TRANSPORT_MODE_HELICOPTER ? isHeliPoint : !isHeliPoint
      }),
    [allAirfields, transportMode],
  )
  const selectableAirfields = useMemo(() => {
    if (transportMode === TRANSPORT_MODE_HELICOPTER) {
      return availableAirfields
    }
    if (airportScope === AIRPORT_SCOPE_PASSENGER) {
      const passengerAirfields = availableAirfields.filter((airport) => isPassengerAirportCandidate(airport))
      return passengerAirfields.length > 0 ? passengerAirfields : availableAirfields
    }
    return availableAirfields
  }, [airportScope, availableAirfields, transportMode])

  const airportsById = useMemo(
    () => Object.fromEntries(availableAirfields.map((airport) => [airport.id, airport])),
    [availableAirfields],
  )
  const allAirportsById = useMemo(
    () => Object.fromEntries(allAirfields.map((airport) => [airport.id, airport])),
    [allAirfields],
  )

  const getFlightArrivalForTable = useCallback(
    (flight) => {
      if (flight?.arrivalAt) return flight.arrivalAt

      const fromAirport = airportsById[flight?.fromAirportId]
      const toAirport = airportsById[flight?.toAirportId]
      const departureAt = parseDateTime(flight?.departureAt)

      if (!fromAirport || !toAirport || !departureAt) return null

      const flightType = flight?.aircraftType || TRANSPORT_MODE_AIRPLANE
      const isHelicopter = flightType === TRANSPORT_MODE_HELICOPTER
      const cruiseSpeed = isHelicopter ? HELICOPTER_CRUISE_SPEED_KMH : AIRPLANE_CRUISE_SPEED_KMH
      const operationsMinutes = isHelicopter ? HELICOPTER_OPERATIONS_MINUTES : AIRPLANE_OPERATIONS_MINUTES
      const minTotalMinutes = isHelicopter ? HELICOPTER_MIN_TOTAL_FLIGHT_MINUTES : AIRPLANE_MIN_TOTAL_FLIGHT_MINUTES

      const distanceKm = haversineDistanceKm(fromAirport, toAirport)
      const enrouteMinutes = Math.round((distanceKm / cruiseSpeed) * 60)
      const totalMinutes = Math.max(minTotalMinutes, enrouteMinutes + operationsMinutes)

      return new Date(departureAt.getTime() + totalMinutes * 60 * 1000)
    },
    [airportsById],
  )

  const cities = useMemo(
    () => [...new Set(selectableAirfields.map((airport) => airport.city))].sort((a, b) => a.localeCompare(b)),
    [selectableAirfields],
  )
  const cityAutocompleteData = useMemo(
    () => cities.map((city) => ({ value: city })),
    [cities],
  )

  const fromAirportOptions = useMemo(() => {
    const normalizedCity = normalizeSearchText(form.fromCity)
    if (!normalizedCity) return selectableAirfields
    return selectableAirfields.filter(
      (airport) => normalizeSearchText(airport.city).includes(normalizedCity),
    )
  }, [form.fromCity, selectableAirfields])

  const toAirportOptions = useMemo(() => {
    const normalizedCity = normalizeSearchText(form.toCity)
    if (!normalizedCity) return selectableAirfields
    return selectableAirfields.filter(
      (airport) => normalizeSearchText(airport.city).includes(normalizedCity),
    )
  }, [form.toCity, selectableAirfields])

  useEffect(() => {
    if (transportMode === TRANSPORT_MODE_HELICOPTER) return

    const selectableIds = new Set(selectableAirfields.map((airport) => airport.id))
    setForm((prev) => {
      let changed = false
      const next = { ...prev }

      if (next.fromAirportId && !selectableIds.has(next.fromAirportId)) {
        next.fromAirportId = ''
        changed = true
      }
      if (next.toAirportId && !selectableIds.has(next.toAirportId)) {
        next.toAirportId = ''
        changed = true
      }

      return changed ? next : prev
    })
  }, [selectableAirfields, transportMode])

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

  const orthodromePath = useMemo(() => {
    if (!activeRoute?.from || !activeRoute?.to) return []
    return buildOrthodromePath(activeRoute.from, activeRoute.to)
  }, [activeRoute])

  const selectedWeatherAirport = selectedWeatherAirportId ? airportsById[selectedWeatherAirportId] : null
  const selectedWeather = selectedWeatherAirportId ? weatherByAirport[selectedWeatherAirportId]?.data : null
  const isFallbackWeather = selectedWeather?.provider === 'synthetic-fallback'
  const selectedStormWarning = useMemo(
    () => getStormWarning(selectedWeather),
    [selectedWeather],
  )
  const renderMetricLabel = useCallback(
    (label) => (
      <Group gap={4} align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">{label}</Text>
        {isFallbackWeather && (
          <Tooltip
            label="Параметр рассчитан по резервному источнику погоды"
            withArrow
            openDelay={120}
          >
            <span style={{ display: 'inline-flex', lineHeight: 0 }}>
              <IconAlertTriangle size={12} color="#f08c00" />
            </span>
          </Tooltip>
        )}
      </Group>
    ),
    [isFallbackWeather],
  )

  const activeRisk = useMemo(() => {
    if (!activeFlight) return null
    return {
      total: activeFlight.totalRisk,
      departure: activeFlight.departureRisk,
      arrival: activeFlight.arrivalRisk,
      cruise: activeFlight.cruiseRisk,
      temporal: activeFlight.temporalRisk ?? activeFlight.temporal,
      feasibility: activeFlight.feasibility,
    }
  }, [activeFlight])

  const filteredFlights = useMemo(
    () =>
      allFlights.filter((flight) => {
        const flightType = flight?.aircraftType || TRANSPORT_MODE_AIRPLANE
        return flightType === transportMode
      }),
    [allFlights, transportMode],
  )
  const departedFlightsCount = useMemo(
    () => filteredFlights.filter((flight) => isFlightDeparted(flight, timeTick)).length,
    [filteredFlights, timeTick],
  )
  const visibleFlights = useMemo(
    () =>
      showDepartedFlights
        ? filteredFlights
        : filteredFlights.filter((flight) => !isFlightDeparted(flight, timeTick)),
    [filteredFlights, showDepartedFlights, timeTick],
  )
  const icingAirportIds = useMemo(() => {
    const uniqueAirportIds = new Set()
    const addAirport = (airportId) => {
      if (!airportId || uniqueAirportIds.size >= ICING_AIRPORTS_LIMIT) return
      if (!allAirportsById[airportId]) return
      uniqueAirportIds.add(airportId)
    }

    filteredFlights.forEach((flight) => {
      if (isFlightDeparted(flight, timeTick)) return
      addAirport(flight?.fromAirportId)
      addAirport(flight?.toAirportId)
    })

    addAirport(activeRoute?.from?.id)
    addAirport(activeRoute?.to?.id)
    addAirport(selectedWeatherAirportId)

    if (uniqueAirportIds.size === 0) {
      const fallbackSampleLimit = transportMode === TRANSPORT_MODE_HELICOPTER ? 28 : 56
      const fallbackAirfields = availableAirfields.slice(0, fallbackSampleLimit)
      fallbackAirfields.forEach((airfield) => addAirport(airfield?.id))
    }

    return Array.from(uniqueAirportIds)
  }, [
    activeRoute,
    allAirportsById,
    availableAirfields,
    filteredFlights,
    selectedWeatherAirportId,
    timeTick,
    transportMode,
  ])

  const riskHeatPoints = useMemo(() => {
    const points = []
    const nowTimestamp = Number(timeTick)

    filteredFlights.forEach((flight) => {
      if (isFlightDeparted(flight, nowTimestamp)) return

      const fromAirport = allAirportsById[flight?.fromAirportId]
      const toAirport = allAirportsById[flight?.toAirportId]
      if (!fromAirport || !toAirport) return

      const departureScore = asNumberOrNull(flight?.departureRisk?.score ?? flight?.totalRisk)
      const arrivalScore = asNumberOrNull(flight?.arrivalRisk?.score ?? flight?.totalRisk)

      points.push({
        id: `${flight.id}-dep`,
        lat: fromAirport.lat,
        lon: fromAirport.lon,
        score: departureScore == null ? 0 : departureScore,
        label: `Вылет ${flight.flightNumber}`,
      })
      points.push({
        id: `${flight.id}-arr`,
        lat: toAirport.lat,
        lon: toAirport.lon,
        score: arrivalScore == null ? 0 : arrivalScore,
        label: `Посадка ${flight.flightNumber}`,
      })
    })

    if (points.length === 0) {
      icingAirportIds.forEach((airportId) => {
        const airport = allAirportsById[airportId]
        const weather = weatherByAirport[airportId]?.data
        if (!airport || !weather) return

        const surfaceRisk = evaluateSurfaceRisk(weather)
        points.push({
          id: `wx-${airportId}`,
          lat: airport.lat,
          lon: airport.lon,
          score: surfaceRisk.score,
          label: `Погода ${airportId}`,
        })
      })
    }

    return points.slice(0, RISK_HEATMAP_MAX_POINTS)
  }, [allAirportsById, filteredFlights, icingAirportIds, timeTick, weatherByAirport])

  const icingHazardPoints = useMemo(
    () =>
      icingAirportIds
        .map((airportId) => {
          const airport = allAirportsById[airportId]
          const weather = weatherByAirport[airportId]?.data
          const hazard = getIcingHazard(weather)
          if (!airport || !hazard) return null
          return {
            airportId,
            airport,
            hazard,
          }
        })
        .filter(Boolean),
    [allAirportsById, icingAirportIds, weatherByAirport],
  )
  const fogHazardPoints = useMemo(
    () =>
      icingAirportIds
        .map((airportId) => {
          const airport = allAirportsById[airportId]
          const weather = weatherByAirport[airportId]?.data
          const hazard = getFogHazard(weather)
          if (!airport || !hazard) return null
          return {
            airportId,
            airport,
            hazard,
          }
        })
        .filter(Boolean),
    [allAirportsById, icingAirportIds, weatherByAirport],
  )
  const thunderHazardPoints = useMemo(
    () =>
      icingAirportIds
        .map((airportId) => {
          const airport = allAirportsById[airportId]
          const weather = weatherByAirport[airportId]?.data
          const hazard = getThunderHazard(weather)
          if (!airport || !hazard) return null
          return {
            airportId,
            airport,
            hazard,
          }
        })
        .filter(Boolean),
    [allAirportsById, icingAirportIds, weatherByAirport],
  )
  const windHazardPoints = useMemo(
    () =>
      icingAirportIds
        .map((airportId) => {
          const airport = allAirportsById[airportId]
          const weather = weatherByAirport[airportId]?.data
          const hazard = getWindHazard(weather)
          if (!airport || !hazard) return null
          return {
            airportId,
            airport,
            hazard,
          }
        })
        .filter(Boolean),
    [allAirportsById, icingAirportIds, weatherByAirport],
  )
  useEffect(() => {
    recoveryModeRef.current = isRecoveryMode
  }, [isRecoveryMode])

  const activateRecoveryMode = useCallback((reason) => {
    if (!recoveryModeRef.current) {
      setRecoveryStartedAt(new Date().toISOString())
    }
    setIsRecoveryMode(true)
    setRecoveryReason(reason || 'Нет соединения с backend. Работаем по сохраненным данным.')
  }, [])

  const deactivateRecoveryMode = useCallback(() => {
    if (recoveryModeRef.current) {
      setRecoveryRecoveredAt(new Date().toISOString())
    }
    setIsRecoveryMode(false)
    setRecoveryStartedAt('')
    setRecoveryReason('')
  }, [])

  const parseBackendFailure = useCallback(
    (cause, fallbackMessage) => {
      const message = getErrorMessage(cause, fallbackMessage)
      const connectivity = isBackendConnectivityError(message)
      if (connectivity) {
        activateRecoveryMode(message)
      }
      return { message, connectivity }
    },
    [activateRecoveryMode],
  )

  const checkRecoveryNow = useCallback(async () => {
    setIsRecoveryChecking(true)
    try {
      const flights = await fetchAllFlights()
      setFlightsError('')
      setAllFlights((prev) =>
        hydrateFlightsWithRiskTimestamps(
          Array.isArray(flights) ? flights : [],
          prev,
          new Date().toISOString(),
        ),
      )
      deactivateRecoveryMode()
    } catch (cause) {
      const failure = parseBackendFailure(cause, 'Не удалось проверить восстановление backend.')
      if (failure.connectivity) {
        setFlightsError('Связь с backend еще не восстановлена. Работаем в режиме восстановления.')
      } else {
        setFlightsError(failure.message)
      }
    } finally {
      setIsRecoveryChecking(false)
    }
  }, [deactivateRecoveryMode, parseBackendFailure])

  useEffect(() => {
    weatherCacheRef.current = weatherByAirport
  }, [weatherByAirport])

  useEffect(() => {
    let cancelled = false

    fetchAirportsApi()
      .then((airports) => {
        if (cancelled) return
        if (!Array.isArray(airports) || airports.length === 0) return
        setAirportCatalog(airports)
        deactivateRecoveryMode()
      })
      .catch((cause) => {
        // fallback to local constants if backend catalog is temporarily unavailable
        if (cancelled) return
        parseBackendFailure(cause, 'Не удалось загрузить справочник аэропортов с backend.')
      })

    return () => {
      cancelled = true
    }
  }, [deactivateRecoveryMode, parseBackendFailure])

  const checkMeteorologistUpdates = useCallback(() => {
    const newResponses = readNewMeteorologistResponsesForDispatcher()
    if (!Array.isArray(newResponses) || newResponses.length === 0) return

    const newestResponse = newResponses[0]
    if (!newestResponse?.id) return

    markMeteorologistResponsesSeenForDispatcher(newestResponse.id)

    const flightNumber =
      newestResponse.flightNumber ||
      newestResponse.requestSnapshot?.form?.flightNumber ||
      'неизвестного рейса'

    setMeteorologistUpdateNotice({
      id: newestResponse.id,
      flightNumber,
      count: newResponses.length,
      createdAt: newestResponse.createdAt || new Date().toISOString(),
    })
  }, [])

  useEffect(() => {
    checkMeteorologistUpdates()

    const intervalId = setInterval(() => {
      checkMeteorologistUpdates()
    }, 5000)

    const handleStorage = () => {
      checkMeteorologistUpdates()
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('storage', handleStorage)
    }
  }, [checkMeteorologistUpdates])

  useEffect(() => {
    if (!isRecoveryMode) return undefined

    const intervalId = setInterval(() => {
      checkRecoveryNow()
    }, RECOVERY_CHECK_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [checkRecoveryNow, isRecoveryMode])

  useEffect(() => {
    setForm((prev) => ({
      ...createInitialForm(Date.now(), transportMode),
      departureAt: prev?.departureAt || getDefaultDepartureAtValue(Date.now()),
    }))
    setSelectedWeatherAirportId('')
  }, [transportMode])

  useEffect(() => {
    setActiveFlight((prev) => {
      if (!prev) return prev
      const flightType = prev.aircraftType || TRANSPORT_MODE_AIRPLANE
      return flightType === transportMode ? prev : null
    })
  }, [transportMode])

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
    if (activeTab !== 'monitoring') return undefined

    const intervalId = setInterval(() => {
      setPlaneTick(Date.now())
    }, 10000)

    return () => clearInterval(intervalId)
  }, [activeTab])

  useEffect(() => {
    let cancelled = false

    fetchAllFlights()
      .then((flights) => {
        if (cancelled) return
        setFlightsError('')
        deactivateRecoveryMode()
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
          const failure = parseBackendFailure(cause, 'Не удалось загрузить список рейсов с backend.')
          const cachedFlights = readFlightsCache()
          if (cachedFlights.length > 0) {
            setAllFlights((prev) =>
              hydrateFlightsWithRiskTimestamps(cachedFlights, prev, new Date().toISOString()),
            )
            setFlightsError(
              failure.connectivity
                ? 'Активирован режим восстановления. Backend недоступен, показаны рейсы из локального кэша.'
                : failure.message,
            )
          } else {
            setFlightsError(
              failure.connectivity
                ? 'Активирован режим восстановления. Нет связи с backend и нет локального кэша рейсов.'
                : failure.message,
            )
          }
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFlights(false)
      })

    return () => {
      cancelled = true
    }
  }, [deactivateRecoveryMode, parseBackendFailure])

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
    const initialCenter = transportMode === TRANSPORT_MODE_HELICOPTER ? [56.9, 35.9] : [60, 95]
    const initialZoom = transportMode === TRANSPORT_MODE_HELICOPTER ? 7 : 3
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      minZoom: 2,
      maxZoom: 11,
      attributionControl: false,
      worldCopyJump: false,
      preferCanvas: true,
    }).setView(initialCenter, initialZoom)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)

    setTimeout(() => map.invalidateSize(), 0)

    heatLayerRef.current = L.layerGroup().addTo(map)
    icingLayerRef.current = L.layerGroup().addTo(map)
    fogLayerRef.current = L.layerGroup().addTo(map)
    thunderLayerRef.current = L.layerGroup().addTo(map)
    windLayerRef.current = L.layerGroup().addTo(map)
    airportLayerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)
    planeLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      heatLayerRef.current = null
      icingLayerRef.current = null
      fogLayerRef.current = null
      thunderLayerRef.current = null
      windLayerRef.current = null
      airportLayerRef.current = null
      routeLayerRef.current = null
      planeLayerRef.current = null
    }
  }, [activeTab, leafletReady, transportMode])

  useEffect(() => {
    if (activeTab !== 'monitoring' || !mapRef.current) return
    if (activeRoute?.from && activeRoute?.to) return

    if (transportMode === TRANSPORT_MODE_HELICOPTER) {
      mapRef.current.fitBounds(TVER_REGION_BOUNDS, { padding: [30, 30], maxZoom: 8 })
      return
    }

    mapRef.current.setView([60, 95], 3)
  }, [activeRoute, activeTab, transportMode])

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
      } catch (cause) {
        const failure = parseBackendFailure(cause, 'Не удалось получить погодные параметры точки.')
        setError(
          failure.connectivity
            ? 'Режим восстановления: backend недоступен, погодные параметры временно не обновляются.'
            : failure.message,
        )
      }
    },
    [ensureWeather, parseBackendFailure],
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
        const temporalRisk = evaluateTemporalRisk(form.departureAt, isHelicopterMode)
        const totalRisk = calculateTotalRisk(departureRisk, arrivalRisk, cruiseRisk, temporalRisk)

        setPreviewRisk({
          total: totalRisk,
          departure: departureRisk,
          arrival: arrivalRisk,
          cruise: cruiseRisk,
          temporal: temporalRisk,
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
  }, [activeFlight, ensureWeather, form, isHelicopterMode, selectedFrom, selectedTo])

  useEffect(() => {
    if (!mapRef.current || !airportLayerRef.current) return

    const L = window.L
    const layer = airportLayerRef.current
    layer.clearLayers()

    if (!activeRoute?.from || !activeRoute?.to) return

    ;[
      { airport: activeRoute.from, role: 'from', label: 'Вылет' },
      { airport: activeRoute.to, role: 'to', label: 'Прилет' },
    ].forEach(({ airport, role, label }) => {
      const marker = L.marker([airport.lat, airport.lon], {
        icon: L.divIcon({
          className: 'route-endpoint-wrapper',
          html: `
            <span class="route-endpoint route-endpoint--${role}">
              <span class="route-endpoint-pin"></span>
              <span class="route-endpoint-code">${airport.id}</span>
            </span>
          `,
          iconSize: [124, 34],
          iconAnchor: [8, 8],
        }),
      })

      marker
        .on('click', () => {
          openAirportWeather(airport.id)
        })
        .bindTooltip(`${label}: ${airport.id} - ${airport.name}`, {
          direction: 'top',
          permanent: true,
          offset: [0, -26],
          className: `route-endpoint-tooltip route-endpoint-tooltip--${role}`,
        })
        .addTo(layer)
    })
  }, [activeRoute, openAirportWeather])

  useEffect(() => {
    if (!mapRef.current || !heatLayerRef.current) return

    const L = window.L
    const layer = heatLayerRef.current
    layer.clearLayers()

    if (!showRiskHeatmap || riskHeatPoints.length === 0) return

    riskHeatPoints.forEach((point) => {
      const safeScore = clampScore(point.score ?? 0)
      const radiusMeters = isHelicopterMode
        ? 1800 + safeScore * 130
        : 18000 + safeScore * 1700

      L.circle([point.lat, point.lon], {
        radius: radiusMeters,
        color: getRiskHeatColor(safeScore),
        weight: 1,
        opacity: 0.42,
        fillColor: getRiskHeatColor(safeScore),
        fillOpacity: 0.14 + safeScore * 0.0032,
      })
        .bindTooltip(`${point.label}: ${safeScore}/100`, { direction: 'top', sticky: true })
        .addTo(layer)
    })
  }, [isHelicopterMode, riskHeatPoints, showRiskHeatmap])

  useEffect(() => {
    const hasAnyHazardLayerEnabled =
      showIcingLayer || showFogLayer || showThunderLayer || showWindLayer
    if (activeTab !== 'monitoring' || !hasAnyHazardLayerEnabled) return undefined

    const idsToLoad = icingAirportIds.filter((airportId) => {
      const cached = weatherCacheRef.current[airportId]
      return !isWeatherCacheFresh(cached)
    })
    if (idsToLoad.length === 0) return undefined

    let cancelled = false
    const chunk = idsToLoad.slice(0, ICING_WEATHER_LOAD_LIMIT)

    Promise.all(
      chunk.map(async (airportId) => {
        if (cancelled) return
        try {
          await ensureWeather(airportId)
        } catch {
          // icing overlay is optional: ignore per-point weather failures
        }
      }),
    ).catch(() => {
      // keep UI responsive even if part of requests failed
    })

    return () => {
      cancelled = true
    }
  }, [
    activeTab,
    ensureWeather,
    icingAirportIds,
    showFogLayer,
    showIcingLayer,
    showThunderLayer,
    showWindLayer,
    weatherByAirport,
  ])

  useEffect(() => {
    if (!mapRef.current || !icingLayerRef.current) return

    const L = window.L
    const layer = icingLayerRef.current
    layer.clearLayers()

    if (!showIcingLayer || icingHazardPoints.length === 0) return

    icingHazardPoints.forEach((point) => {
      const color = getIcingColor(point.hazard.level)
      const score = clampScore(point.hazard.score ?? 0)
      const zoneRadius = isHelicopterMode
        ? 2200 + score * 90
        : 14000 + score * 820

      L.circle([point.airport.lat, point.airport.lon], {
        radius: zoneRadius,
        color,
        weight: 1.2,
        opacity: 0.3,
        fillColor: color,
        fillOpacity: 0.08 + score * 0.0022,
      }).addTo(layer)

      L.circleMarker([point.airport.lat, point.airport.lon], {
        radius: 6 + Math.round(score / 16),
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      })
        .bindTooltip(
          `${point.airport.id}: ${point.hazard.title} (${score}/100)${
            point.hazard.reasons.length ? `; ${point.hazard.reasons.join('; ')}` : ''
          }`,
          { direction: 'top', sticky: true },
        )
        .addTo(layer)
    })
  }, [icingHazardPoints, isHelicopterMode, showIcingLayer])

  useEffect(() => {
    if (!mapRef.current || !fogLayerRef.current) return

    const L = window.L
    const layer = fogLayerRef.current
    layer.clearLayers()

    if (!showFogLayer || fogHazardPoints.length === 0) return

    fogHazardPoints.forEach((point) => {
      const color = getFogColor(point.hazard.level)
      const score = clampScore(point.hazard.score ?? 0)
      const zoneRadius = isHelicopterMode
        ? 2000 + score * 90
        : 12000 + score * 650

      L.circle([point.airport.lat, point.airport.lon], {
        radius: zoneRadius,
        color,
        weight: 1.1,
        opacity: 0.28,
        fillColor: color,
        fillOpacity: 0.09 + score * 0.002,
      }).addTo(layer)

      L.circleMarker([point.airport.lat, point.airport.lon], {
        radius: 5 + Math.round(score / 20),
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.88,
      })
        .bindTooltip(
          `${point.airport.id}: ${point.hazard.title} (${score}/100)${
            point.hazard.reasons.length ? `; ${point.hazard.reasons.join('; ')}` : ''
          }`,
          { direction: 'top', sticky: true },
        )
        .addTo(layer)
    })
  }, [fogHazardPoints, isHelicopterMode, showFogLayer])

  useEffect(() => {
    if (!mapRef.current || !thunderLayerRef.current) return

    const L = window.L
    const layer = thunderLayerRef.current
    layer.clearLayers()

    if (!showThunderLayer || thunderHazardPoints.length === 0) return

    thunderHazardPoints.forEach((point) => {
      const color = getThunderColor(point.hazard.level)
      const score = clampScore(point.hazard.score ?? 0)
      const zoneRadius = isHelicopterMode
        ? 2300 + score * 100
        : 13000 + score * 760

      L.circle([point.airport.lat, point.airport.lon], {
        radius: zoneRadius,
        color,
        weight: 1.1,
        opacity: 0.3,
        fillColor: color,
        fillOpacity: 0.1 + score * 0.0022,
      }).addTo(layer)

      L.circleMarker([point.airport.lat, point.airport.lon], {
        radius: 5 + Math.round(score / 18),
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      })
        .bindTooltip(
          `${point.airport.id}: ${point.hazard.title} (${score}/100)${
            point.hazard.reasons.length ? `; ${point.hazard.reasons.join('; ')}` : ''
          }`,
          { direction: 'top', sticky: true },
        )
        .addTo(layer)
    })
  }, [isHelicopterMode, showThunderLayer, thunderHazardPoints])

  useEffect(() => {
    if (!mapRef.current || !windLayerRef.current) return

    const L = window.L
    const layer = windLayerRef.current
    layer.clearLayers()

    if (!showWindLayer || windHazardPoints.length === 0) return

    windHazardPoints.forEach((point) => {
      const color = getWindColor(point.hazard.level)
      const score = clampScore(point.hazard.score ?? 0)
      const zoneRadius = isHelicopterMode
        ? 2100 + score * 95
        : 12500 + score * 700

      L.circle([point.airport.lat, point.airport.lon], {
        radius: zoneRadius,
        color,
        weight: 1.1,
        opacity: 0.28,
        fillColor: color,
        fillOpacity: 0.09 + score * 0.0021,
      }).addTo(layer)

      L.circleMarker([point.airport.lat, point.airport.lon], {
        radius: 5 + Math.round(score / 20),
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      })
        .bindTooltip(
          `${point.airport.id}: ${point.hazard.title} (${score}/100)${
            point.hazard.reasons.length ? `; ${point.hazard.reasons.join('; ')}` : ''
          }`,
          { direction: 'top', sticky: true },
        )
        .addTo(layer)
    })
  }, [isHelicopterMode, showWindLayer, windHazardPoints])

  useEffect(() => {
    if (!mapRef.current || !routeLayerRef.current) return

    const L = window.L
    const layer = routeLayerRef.current
    layer.clearLayers()

    if (!activeRoute?.from || !activeRoute?.to) return

    if (orthodromePath.length > 1) {
      L.polyline(orthodromePath, {
        color: '#4dabf7',
        weight: 9,
        opacity: 0.26,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer)

      L.polyline(orthodromePath, {
        color: '#1971c2',
        weight: 3.6,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer)

      L.polyline(orthodromePath, {
        color: '#ffffff',
        weight: 1.4,
        opacity: 0.66,
        dashArray: '8 10',
      }).addTo(layer)
    }

    const boundsSource = orthodromePath.length > 0
      ? orthodromePath
      : [
          [activeRoute.from.lat, activeRoute.from.lon],
          [activeRoute.to.lat, activeRoute.to.lon],
        ]

    mapRef.current.fitBounds(boundsSource, { padding: [40, 40], maxZoom: 6 })
  }, [activeRoute, orthodromePath])

  useEffect(() => {
    if (!mapRef.current || !planeLayerRef.current) return

    const L = window.L
    const layer = planeLayerRef.current
    layer.clearLayers()

    if (!activeFlight || !activeRoute?.from || !activeRoute?.to) return

    const departureAt = parseDateTime(activeFlight.departureAt)
    const arrivalAt = parseDateTime(getFlightArrivalForTable(activeFlight))
    if (!departureAt || !arrivalAt) return

    const departureMs = departureAt.getTime()
    const arrivalMs = arrivalAt.getTime()
    if (!Number.isFinite(departureMs) || !Number.isFinite(arrivalMs) || arrivalMs <= departureMs) return

    const nowMs = planeTick
    if (nowMs < departureMs || nowMs > arrivalMs) return

    const progress = (nowMs - departureMs) / (arrivalMs - departureMs)
    if (!orthodromePath || orthodromePath.length < 2) return

    const markerPoint = getPathPointAt(orthodromePath, progress)
    if (!markerPoint) return

    const heading = getPathBearingDegrees(orthodromePath, progress)
    const marker = L.marker(markerPoint, {
      interactive: false,
      icon: L.divIcon({
        className: 'plane-marker',
        html: PLANE_ICON_HTML,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
      zIndexOffset: 1200,
    }).addTo(layer)

    const markerInner = marker.getElement()?.querySelector('.plane-marker-inner')
    if (markerInner) {
      markerInner.style.transform = `rotate(${heading}deg)`
    }
  }, [
    activeFlight,
    activeRoute,
    getFlightArrivalForTable,
    orthodromePath,
    planeTick,
  ])

  const createFlight = async () => {
    if (isRecoveryMode) {
      setError('Режим восстановления после сбоя: создание рейсов временно недоступно до восстановления backend.')
      return
    }

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

    if (!isHelicopterMode && !/^[A-Z]{2}$/.test(form.airlineCode)) {
      setError('Код авиакомпании должен содержать 2 латинские буквы (IATA).')
      return
    }

    if (!/^[1-9][0-9]{0,3}$/.test(form.flightDigits.trim())) {
      setError('Цифровая часть номера рейса: 1-4 цифры без ведущего нуля.')
      return
    }

    const departureDate = parseDateTime(form.departureAt)
    const minDepartureDate = parseDateTime(minDepartureAt)
    if (!departureDate || !minDepartureDate || departureDate.getTime() < minDepartureDate.getTime()) {
      setError('Укажите корректное время вылета (не раньше текущего времени).')
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
      const temporalRisk = evaluateTemporalRisk(form.departureAt, isHelicopterMode)
      const totalRisk = calculateTotalRisk(departureRisk, arrivalRisk, cruiseRisk, temporalRisk)
      const scenarioAdjustedRisk = applyEmergencyScenarioToRisk(
        {
          departure: departureRisk,
          arrival: arrivalRisk,
          cruise: cruiseRisk,
          temporal: temporalRisk,
          total: totalRisk,
          feasibility: getFeasibility(totalRisk),
        },
        emergencyScenario,
      )

      const fullFlightNumber = isHelicopterMode
        ? `${HELICOPTER_FLIGHT_PREFIX}${form.flightDigits.trim()}`
        : `${form.airlineCode}${form.flightDigits.trim()}`

      const savedFlight = await createFlightApi({
        flightNumber: fullFlightNumber,
        aircraftType: transportMode,
        departureAt: form.departureAt,
        arrivalAt: null,
        fromAirportId: selectedFrom.id,
        toAirportId: selectedTo.id,
        departureRisk: scenarioAdjustedRisk.departure,
        arrivalRisk: scenarioAdjustedRisk.arrival,
        cruiseRisk: scenarioAdjustedRisk.cruise,
        totalRisk: scenarioAdjustedRisk.total,
        feasibility: scenarioAdjustedRisk.feasibility,
      })

      const savedFlightWithTemporal = {
        ...savedFlight,
        temporalRisk: savedFlight?.temporalRisk ?? scenarioAdjustedRisk?.temporal,
      }

      setActiveFlight(savedFlightWithTemporal)
      setAllFlights((prev) => {
        const nowIso = new Date().toISOString()
        const hydratedSaved = withRiskTimestamp(savedFlightWithTemporal, mapFlightsById(prev), nowIso)
        return [hydratedSaved, ...prev.filter((flight) => flight.id !== savedFlight.id)]
      })
      setSelectedWeatherAirportId(selectedFrom.id)
      setForm(createInitialForm(Date.now(), transportMode))
      setActiveTab('monitoring')
    } catch (cause) {
      const failure = parseBackendFailure(cause, 'Не удалось создать рейс. Проверьте backend и доступ к погодному API.')
      setError(failure.message)
    } finally {
      setIsEvaluating(false)
    }
  }

  const openFlightFromList = useCallback((flight) => {
    if (!flight) return
    setTransportMode(flight.aircraftType || TRANSPORT_MODE_AIRPLANE)
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

  const updateFlightInState = useCallback((updatedFlight) => {
    if (!updatedFlight?.id) return
    setAllFlights((prev) => {
      const nowIso = new Date().toISOString()
      const knownById = mapFlightsById(prev)
      const nextFlight = withRiskTimestamp(updatedFlight, knownById, nowIso)
      return prev.map((flight) => (flight.id === nextFlight.id ? nextFlight : flight))
    })
    setActiveFlight((prev) => {
      if (prev?.id !== updatedFlight.id) return prev
      return withRiskTimestamp(
        updatedFlight,
        prev ? { [prev.id]: prev } : {},
        new Date().toISOString(),
      )
    })
  }, [])

  const handleRefreshRisk = useCallback(
    async (flightId) => {
      setFlightActionError('')
      setFlightActionPending(flightId, 'refresh', true)

      try {
        const refreshedFlight = await refreshFlightRiskApi(flightId)
        deactivateRecoveryMode()
        updateFlightInState(refreshedFlight)
      } catch (cause) {
        const failure = parseBackendFailure(cause, 'Не удалось обновить риск по рейсу.')
        setFlightActionError(
          failure.message,
        )
      } finally {
        setFlightActionPending(flightId, 'refresh', false)
      }
    },
    [deactivateRecoveryMode, parseBackendFailure, setFlightActionPending, updateFlightInState],
  )

  const handleCancelFlight = useCallback(
    async (flight) => {
      if (!flight?.id) return

      setFlightActionError('')
      setFlightActionPending(flight.id, 'cancel', true)

      try {
        await cancelFlightApi(flight.id)

        const flightsFromServer = await fetchAllFlights()
        deactivateRecoveryMode()
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
        const failure = parseBackendFailure(cause, 'Не удалось отменить рейс.')
        setFlightActionError(failure.message)
      } finally {
        setFlightActionPending(flight.id, 'cancel', false)
      }
    },
    [allFlights, deactivateRecoveryMode, parseBackendFailure, setFlightActionPending],
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

  const openDecisionModal = useCallback((flight) => {
    if (!flight?.id) return
    setDecisionFlight(flight)
    setDecisionForm({
      decision: flight.dispatcherDecision === DISPATCHER_DECISION_PENDING
        ? DISPATCHER_DECISION_APPROVE
        : (flight.dispatcherDecision ?? DISPATCHER_DECISION_APPROVE),
      reason: '',
      delayMinutes: String(flight.dispatcherDecisionDelayMinutes ?? 30),
    })
    setDecisionWhatIf(null)
    setDecisionError('')
  }, [])

  const closeDecisionModal = useCallback(() => {
    setDecisionFlight(null)
    setDecisionWhatIf(null)
    setDecisionError('')
    setIsDecisionSubmitting(false)
    setIsDecisionWhatIfLoading(false)
  }, [])

  const runDelayWhatIf = useCallback(async () => {
    if (!decisionFlight?.id) return

    const delayMinutes = Number(decisionForm.delayMinutes)
    if (!Number.isInteger(delayMinutes) || delayMinutes < 5) {
      setDecisionError('Для what-if укажите задержку от 5 минут.')
      return
    }

    setDecisionError('')
    setIsDecisionWhatIfLoading(true)
    try {
      const simulation = await simulateFlightDelayWhatIfApi(decisionFlight.id, delayMinutes)
      deactivateRecoveryMode()
      setDecisionWhatIf(simulation)
    } catch (cause) {
      const failure = parseBackendFailure(cause, 'Не удалось рассчитать what-if сценарий.')
      setDecisionError(failure.message)
    } finally {
      setIsDecisionWhatIfLoading(false)
    }
  }, [decisionFlight?.id, decisionForm.delayMinutes, deactivateRecoveryMode, parseBackendFailure])

  const applyDecision = useCallback(async () => {
    if (!decisionFlight?.id) return

    const reason = decisionForm.reason.trim()
    if (!reason) {
      setDecisionError('Добавьте объяснение решения диспетчера.')
      return
    }

    let delayMinutes = null
    if (decisionForm.decision === DISPATCHER_DECISION_DELAY) {
      const parsedDelay = Number(decisionForm.delayMinutes)
      if (!Number.isInteger(parsedDelay) || parsedDelay < 5 || parsedDelay > 360 || parsedDelay % 5 !== 0) {
        setDecisionError('Задержка должна быть от 5 до 360 минут и кратна 5.')
        return
      }
      delayMinutes = parsedDelay
    }

    setDecisionError('')
    setIsDecisionSubmitting(true)
    setFlightActionPending(decisionFlight.id, 'decision', true)
    try {
      const updatedFlight = await applyFlightDecisionApi(decisionFlight.id, {
        decision: decisionForm.decision,
        reason,
        delayMinutes,
      })
      deactivateRecoveryMode()
      updateFlightInState(updatedFlight)
      closeDecisionModal()
    } catch (cause) {
      const failure = parseBackendFailure(cause, 'Не удалось применить решение диспетчера.')
      setDecisionError(failure.message)
    } finally {
      setIsDecisionSubmitting(false)
      setFlightActionPending(decisionFlight.id, 'decision', false)
    }
  }, [
    closeDecisionModal,
    decisionFlight?.id,
    decisionForm,
    deactivateRecoveryMode,
    parseBackendFailure,
    setFlightActionPending,
    updateFlightInState,
  ])

  const printFlightReport = useCallback((flight) => {
    if (!flight?.id) return

    const fromAirport = allAirportsById[flight.fromAirportId]
    const toAirport = allAirportsById[flight.toAirportId]
    const arrivalAt = getFlightArrivalForTable(flight)
    const generatedAt = new Date()
    const depFactors = Array.isArray(flight?.departureRisk?.factors) ? flight.departureRisk.factors : []
    const arrFactors = Array.isArray(flight?.arrivalRisk?.factors) ? flight.arrivalRisk.factors : []
    const cruiseFactors = Array.isArray(flight?.cruiseRisk?.factors) ? flight.cruiseRisk.factors : []

    const reportHtml = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Отчет по рейсу ${escapeHtml(flight.flightNumber)}</title>
  <style>
    :root { color-scheme: light; }
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #eef2f7;
      color: #111827;
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif;
      line-height: 1.35;
    }
    .toolbar {
      max-width: 900px;
      margin: 0 auto 14px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .toolbar button {
      border: 1px solid #c5cdd8;
      border-radius: 8px;
      padding: 8px 12px;
      background: #fff;
      font-size: 13px;
      cursor: pointer;
    }
    .sheet {
      background: #fff;
      max-width: 900px;
      margin: 0 auto;
      border: 1px solid #d7dee8;
      border-radius: 14px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
      padding: 26px 28px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      border-bottom: 2px solid #e5eaf1;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .title { margin: 0; font-size: 24px; }
    .subtle { color: #64748b; font-size: 13px; }
    .section { margin-top: 16px; }
    .section h2 {
      margin: 0 0 8px;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: .03em;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      border: 1px solid #dbe3ee;
      padding: 8px 10px;
      vertical-align: top;
    }
    th {
      width: 34%;
      text-align: left;
      background: #f7f9fc;
      font-weight: 600;
      color: #334155;
    }
    .risk-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .risk-item {
      border: 1px solid #dbe3ee;
      border-radius: 10px;
      padding: 10px 12px;
      background: #fafcff;
    }
    .risk-title { color: #64748b; font-size: 12px; margin-bottom: 2px; }
    .risk-value { font-size: 18px; font-weight: 700; }
    .factors { margin: 8px 0 0 18px; padding: 0; }
    .factors li { margin-bottom: 4px; }
    .signatures {
      margin-top: 26px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    .sign {
      border-top: 1px solid #94a3b8;
      padding-top: 6px;
      color: #475569;
      font-size: 13px;
      min-height: 40px;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .toolbar { display: none; }
      .sheet { box-shadow: none; border: none; border-radius: 0; max-width: none; margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">Печать отчета</button>
  </div>

  <article class="sheet">
    <header class="header">
      <div>
        <h1 class="title">Отчет по рейсу ${escapeHtml(flight.flightNumber)}</h1>
        <div class="subtle">Форма: Оперативный диспетчерский отчет</div>
      </div>
      <div class="subtle">
        <div><strong>Сформирован:</strong> ${escapeHtml(generatedAt.toLocaleString('ru-RU'))}</div>
        <div><strong>ID рейса:</strong> ${escapeHtml(flight.id)}</div>
      </div>
    </header>

    <section class="section">
      <h2>1. Основные сведения</h2>
      <table>
        <tr><th>Тип воздушного судна</th><td>${escapeHtml(flight.aircraftType === TRANSPORT_MODE_HELICOPTER ? 'Вертолет' : 'Самолет')}</td></tr>
        <tr><th>Маршрут</th><td>${escapeHtml(flight.fromAirportId)} - ${escapeHtml(flight.toAirportId)}</td></tr>
        <tr><th>Пункт вылета</th><td>${escapeHtml(fromAirport?.name ?? 'нет данных')}</td></tr>
        <tr><th>Пункт прилета</th><td>${escapeHtml(toAirport?.name ?? 'нет данных')}</td></tr>
        <tr><th>Плановый вылет</th><td>${escapeHtml(formatDateTime(flight.departureAt))}</td></tr>
        <tr><th>Плановый прилет</th><td>${escapeHtml(formatDateTime(arrivalAt))}</td></tr>
      </table>
    </section>

    <section class="section">
      <h2>2. Оценка рисков</h2>
      <div class="risk-grid">
        <div class="risk-item"><div class="risk-title">Взлет</div><div class="risk-value">${escapeHtml(flight?.departureRisk?.score ?? 'нет данных')}/100</div></div>
        <div class="risk-item"><div class="risk-title">Посадка</div><div class="risk-value">${escapeHtml(flight?.arrivalRisk?.score ?? 'нет данных')}/100</div></div>
        <div class="risk-item"><div class="risk-title">Маршрут</div><div class="risk-value">${escapeHtml(flight?.cruiseRisk?.score ?? 'нет данных')}/100</div></div>
        <div class="risk-item"><div class="risk-title">Итог</div><div class="risk-value">${escapeHtml(flight?.totalRisk ?? 'нет данных')}/100 (${escapeHtml(riskLevelLabel(flight?.totalRisk ?? 0))})</div></div>
      </div>
    </section>

    <section class="section">
      <h2>3. Ключевые метеофакторы</h2>
      <table>
        <tr>
          <th>Факторы взлета</th>
          <td><ul class="factors">${depFactors.length ? depFactors.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>нет данных</li>'}</ul></td>
        </tr>
        <tr>
          <th>Факторы посадки</th>
          <td><ul class="factors">${arrFactors.length ? arrFactors.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>нет данных</li>'}</ul></td>
        </tr>
        <tr>
          <th>Факторы по маршруту</th>
          <td><ul class="factors">${cruiseFactors.length ? cruiseFactors.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>нет данных</li>'}</ul></td>
        </tr>
      </table>
    </section>

    <section class="section">
      <h2>4. Решение диспетчера</h2>
      <table>
        <tr><th>Статус решения</th><td>${escapeHtml(decisionLabel(flight?.dispatcherDecision))}</td></tr>
        <tr><th>Время решения</th><td>${escapeHtml(formatDateTime(flight?.dispatcherDecisionAt))}</td></tr>
        <tr><th>Задержка</th><td>${escapeHtml(flight?.dispatcherDecisionDelayMinutes ? `${flight.dispatcherDecisionDelayMinutes} мин` : 'нет')}</td></tr>
        <tr><th>Обоснование</th><td>${escapeHtml(flight?.dispatcherDecisionReason || 'не указано')}</td></tr>
      </table>
    </section>

    <section class="signatures">
      <div class="sign">Диспетчер (ФИО, подпись)</div>
      <div class="sign">Руководитель смены (ФИО, подпись)</div>
    </section>
  </article>
</body>
</html>`

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setFlightActionError('Браузер заблокировал окно отчета. Разрешите pop-up для этого сайта.')
      return
    }

    printWindow.document.open()
    printWindow.document.write(reportHtml)
    printWindow.document.close()
    printWindow.focus()
    printWindow.scrollTo(0, 0)
  }, [allAirportsById, getFlightArrivalForTable])

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
  const effectiveRisk = useMemo(
    () => safeApplyEmergencyRisk(displayedRisk, emergencyScenario),
    [displayedRisk, emergencyScenario],
  )
  const recommendationRouteAirportIds = useMemo(() => {
    if (activeFlight?.fromAirportId && activeFlight?.toAirportId) {
      return [activeFlight.fromAirportId, activeFlight.toAirportId]
    }
    if (selectedFrom?.id && selectedTo?.id) {
      return [selectedFrom.id, selectedTo.id]
    }
    return []
  }, [activeFlight, selectedFrom, selectedTo])
  const needsMeteoRequest = useMemo(() => {
    if (recommendationRouteAirportIds.length < 2) return false

    const [fromAirportId, toAirportId] = recommendationRouteAirportIds
    const fromWeather = weatherByAirport[fromAirportId]?.data
    const toWeather = weatherByAirport[toAirportId]?.data

    return !hasWeatherPayload(fromWeather) || !hasWeatherPayload(toWeather)
  }, [recommendationRouteAirportIds, weatherByAirport])
  const systemRecommendations = useMemo(
    () =>
      safeBuildRecommendations({
        risk: effectiveRisk,
        emergencyScenario,
        selectedStormWarning,
        needsMeteoRequest,
      }),
    [effectiveRisk, emergencyScenario, needsMeteoRequest, selectedStormWarning],
  )
  return (
    <Stack className="dispatcher-app" gap="md">
      <Paper withBorder radius="xl" p="md" className="surface-card surface-card--tabs">
        <Stack gap="sm">
          <Group justify="space-between" gap="md" wrap="wrap">
            <Group gap="xs" wrap="wrap">
              <Title order={3}>Панель диспетчера</Title>
              <Badge variant="light" color={isRecoveryMode ? 'orange' : 'teal'}>
                {isRecoveryMode ? 'RECOVERY MODE' : 'LIVE'}
              </Badge>
            </Group>
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

          <Group justify="flex-end">
            <SegmentedControl
              radius="xl"
              size="sm"
              value={transportMode}
              onChange={(nextMode) => {
                setTransportMode(nextMode)
                setError('')
              }}
              data={[
                { value: TRANSPORT_MODE_AIRPLANE, label: 'Самолеты' },
                { value: TRANSPORT_MODE_HELICOPTER, label: 'Вертолеты' },
              ]}
            />
          </Group>
        </Stack>
      </Paper>

      {isRecoveryMode && (
        <Alert
          color="orange"
          radius="md"
          icon={<IconAlertTriangle size={18} />}
          title="Режим восстановления после сбоя"
        >
          <Stack gap={6}>
            <Text size="sm">
              Работаем по сохраненным данным. Изменение рейсов и пересчет рисков временно ограничены.
            </Text>
            <Text size="xs" c="dimmed">
              Сбой зафиксирован: {formatDateTime(recoveryStartedAt)}. {recoveryReason}
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                radius="xl"
                variant="light"
                onClick={checkRecoveryNow}
                loading={isRecoveryChecking}
              >
                Проверить восстановление
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}

      {!isRecoveryMode && recoveryRecoveredAt && (
        <Alert
          color="teal"
          radius="md"
          variant="light"
          icon={<IconAlertCircle size={18} />}
          withCloseButton
          onClose={() => setRecoveryRecoveredAt('')}
          title="Связь с backend восстановлена"
        >
          <Text size="sm">Система снова в live-режиме. Время восстановления: {formatDateTime(recoveryRecoveredAt)}.</Text>
        </Alert>
      )}

      {meteorologistUpdateNotice && (
        <Alert
          color="yellow"
          radius="md"
          icon={<IconAlertTriangle size={18} />}
          title="Обновление от метеоролога"
          withCloseButton
          onClose={() => setMeteorologistUpdateNotice(null)}
        >
          <Stack gap={4}>
            <Text size="sm">
              Данные по рейсу <strong>{meteorologistUpdateNotice.flightNumber}</strong> поменялись. Проверьте риск.
            </Text>
            {meteorologistUpdateNotice.count > 1 && (
              <Text size="xs" c="dimmed">
                Также есть еще обновлений: {meteorologistUpdateNotice.count - 1}.
              </Text>
            )}
            <Group gap="xs">
              <Button
                size="xs"
                radius="xl"
                variant="light"
                onClick={() => {
                  setActiveTab('flights')
                  setMeteorologistUpdateNotice(null)
                }}
              >
                Перейти к рейсам
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}

      {activeTab === 'monitoring' && (
        <Grid gutter="md">
          <Grid.Col span={{ base: 12, xl: 4 }}>
            <Stack gap="md">
              <Paper withBorder radius="xl" p="lg" className="surface-card">
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <Title order={4}>Создание рейса</Title>
                    <Badge variant="light" color="teal">
                      live risk
                    </Badge>
                  </Group>

                  {transportMode === TRANSPORT_MODE_AIRPLANE && (
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Text size="xs" c="dimmed">Показывать аэропорты</Text>
                      <SegmentedControl
                        size="xs"
                        radius="xl"
                        value={airportScope}
                        onChange={setAirportScope}
                        data={[
                          { value: AIRPORT_SCOPE_PASSENGER, label: 'Пассажирские' },
                          { value: AIRPORT_SCOPE_ALL, label: 'Все' },
                        ]}
                      />
                    </Group>
                  )}

                  <div className="form-grid">
                    <Autocomplete
                      label="Город вылета"
                      placeholder="Начните вводить город"
                      data={cityAutocompleteData}
                      value={form.fromCity}
                      onChange={(city) => {
                        setActiveFlight(null)
                        setForm((prev) => {
                          const next = { ...prev, fromCity: city, fromAirportId: '' }
                          const routeValidationError = validateRoute(next)
                          setError(routeValidationError)
                          return next
                        })
                      }}
                      selectFirstOptionOnChange
                      maxDropdownHeight={340}
                      autoComplete="off"
                    />

                    <Autocomplete
                      label="Город назначения"
                      placeholder="Начните вводить город"
                      data={cityAutocompleteData}
                      value={form.toCity}
                      onChange={(city) => {
                        setActiveFlight(null)
                        setForm((prev) => {
                          const next = { ...prev, toCity: city, toAirportId: '' }
                          const routeValidationError = validateRoute(next)
                          setError(routeValidationError)
                          return next
                        })
                      }}
                      selectFirstOptionOnChange
                      maxDropdownHeight={340}
                      autoComplete="off"
                    />

                    <NativeSelect
                      label={isHelicopterMode ? 'Площадка вылета' : 'Аэропорт отправления'}
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
                      <option value="">{isHelicopterMode ? 'Выберите площадку' : 'Выберите аэропорт'}</option>
                      {fromAirportOptions.map((airport) => (
                        <option key={airport.id} value={airport.id}>
                          {isHelicopterMode
                            ? `${airport.name} (${airport.city})`
                            : `${airport.id} - ${airport.name}${
                                airportScope === AIRPORT_SCOPE_ALL
                                  ? (isPassengerAirportCandidate(airport) ? ' [пасс.]' : ' [проч.]')
                                  : ''
                              }`}
                        </option>
                      ))}
                    </NativeSelect>

                    <NativeSelect
                      label={isHelicopterMode ? 'Площадка назначения' : 'Аэропорт назначения'}
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
                      <option value="">{isHelicopterMode ? 'Выберите площадку' : 'Выберите аэропорт'}</option>
                      {toAirportOptions.map((airport) => (
                        <option key={airport.id} value={airport.id}>
                          {isHelicopterMode
                            ? `${airport.name} (${airport.city})`
                            : `${airport.id} - ${airport.name}${
                                airportScope === AIRPORT_SCOPE_ALL
                                  ? (isPassengerAirportCandidate(airport) ? ' [пасс.]' : ' [проч.]')
                                  : ''
                              }`}
                        </option>
                      ))}
                    </NativeSelect>

                    <TextInput
                      label="Дата и время вылета"
                      type="datetime-local"
                      min={minDepartureAt}
                      step={DEPARTURE_TIME_STEP_MINUTES * 60}
                      value={form.departureAt}
                      onChange={(event) => {
                        const departureAt = event.target.value
                        setActiveFlight(null)
                        setForm((prev) => ({ ...prev, departureAt }))
                      }}
                    />

                    {!isHelicopterMode && (
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
                    )}

                    <TextInput
                      label={isHelicopterMode ? 'Номер борта' : 'Цифры рейса'}
                      inputMode="numeric"
                      placeholder="Например: 123"
                      value={form.flightDigits}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, '').slice(0, 4)
                        setForm((prev) => ({ ...prev, flightDigits: digits }))
                      }}
                    />
                  </div>

                  <Button
                    radius="xl"
                    size="md"
                    onClick={createFlight}
                    loading={isEvaluating}
                    disabled={isRecoveryMode}
                  >
                    Создать рейс
                  </Button>

                  {isRecoveryMode && (
                    <Alert color="orange" radius="md" variant="light" icon={<IconAlertTriangle size={16} />}>
                      Активен режим восстановления: создание новых рейсов временно недоступно.
                    </Alert>
                  )}

                  {error && (
                    <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />}>
                      {error}
                    </Alert>
                  )}
                </Stack>
              </Paper>

              <Card withBorder radius="lg" padding="md" className="surface-card surface-card--subtle">
                <Stack gap="sm">
                  <Title order={5}>Рейтинг рекомендаций системы</Title>
                  {effectiveRisk ? (
                    <>
                      {systemRecommendations.slice(0, 5).map((item, index) => (
                        <Stack key={item.code} gap={4}>
                          <Group justify="space-between" align="center">
                            <Group gap={8}>
                              <Badge color={index === 0 ? 'teal' : 'gray'} variant="light">
                                #{index + 1}
                              </Badge>
                              <Text size="sm" fw={600}>{item.title}</Text>
                            </Group>
                            <Badge color={item.color} variant="dot">
                              {item.score}/100
                            </Badge>
                          </Group>
                          <Progress value={item.score} color={item.color} radius="xl" size="sm" />
                          <Text size="xs" c="dimmed">{item.reason}</Text>
                        </Stack>
                      ))}

                      <Alert
                        color={systemRecommendations[0]?.score >= 70 ? 'teal' : 'yellow'}
                        radius="md"
                        variant="light"
                      >
                        Приоритетное действие: <strong>{systemRecommendations[0]?.title ?? 'нет данных'}</strong>
                      </Alert>
                    </>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Рейтинг появится после расчета риска.
                    </Text>
                  )}
                </Stack>
              </Card>

            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, xl: 8 }}>
            <Paper withBorder radius="xl" p="lg" className="surface-card">
              <Stack gap="md">
                <Group justify="space-between" wrap="wrap" gap="sm">
                  <Title order={4}>Результат мониторинга</Title>
                  <Badge variant="light" color={isHelicopterMode ? 'grape' : 'blue'}>
                    {isHelicopterMode ? 'Вертолеты: Тверская область' : 'Самолеты: РФ'}
                  </Badge>
                </Group>

                <div className="map-stage">
                  <div className="risk-legend">
                    {RISK_LEGEND.map((item) => (
                      <div key={item.label} className="legend-item">
                        <span className={`legend-dot ${item.className}`} />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="map-layer-controls">
                    <div className="layer-switch-item layer-switch-item--heat">
                      <Group align="center" wrap="nowrap" gap={6}>
                        <Switch
                          size="xs"
                          color="teal"
                          checked={showRiskHeatmap}
                          onChange={(event) => setShowRiskHeatmap(Boolean(event.currentTarget.checked))}
                        />
                        <Text size="xs" fw={600} className="layer-switch-label">Теплокарта</Text>
                      </Group>
                    </div>

                    <div className="layer-switch-item layer-switch-item--icing">
                      <Group align="center" wrap="nowrap" gap={6}>
                        <Switch
                          size="xs"
                          color="blue"
                          checked={showIcingLayer}
                          onChange={(event) => setShowIcingLayer(Boolean(event.currentTarget.checked))}
                        />
                        <Text size="xs" fw={600} className="layer-switch-label">Оледенение</Text>
                      </Group>
                    </div>

                    <div className="layer-switch-item layer-switch-item--fog">
                      <Group align="center" wrap="nowrap" gap={6}>
                        <Switch
                          size="xs"
                          color="gray"
                          checked={showFogLayer}
                          onChange={(event) => setShowFogLayer(Boolean(event.currentTarget.checked))}
                        />
                        <Text size="xs" fw={600} className="layer-switch-label">Туман</Text>
                      </Group>
                    </div>

                    <div className="layer-switch-item layer-switch-item--thunder">
                      <Group align="center" wrap="nowrap" gap={6}>
                        <Switch
                          size="xs"
                          color="violet"
                          checked={showThunderLayer}
                          onChange={(event) => setShowThunderLayer(Boolean(event.currentTarget.checked))}
                        />
                        <Text size="xs" fw={600} className="layer-switch-label">Гроза</Text>
                      </Group>
                    </div>

                    <div className="layer-switch-item layer-switch-item--wind">
                      <Group align="center" wrap="nowrap" gap={6}>
                        <Switch
                          size="xs"
                          color="orange"
                          checked={showWindLayer}
                          onChange={(event) => setShowWindLayer(Boolean(event.currentTarget.checked))}
                        />
                        <Text size="xs" fw={600} className="layer-switch-label">Ветер</Text>
                      </Group>
                    </div>
                  </div>
                  {activeRoute?.from && activeRoute?.to && (
                    <div className="route-direction-chip">
                      {activeRoute.from.id} → {activeRoute.to.id}
                    </div>
                  )}

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
                          <Group gap={6} align="center">
                            <Text fw={600}>
                              {selectedWeatherAirport.id} - {selectedWeatherAirport.name},{' '}
                              {selectedWeatherAirport.city}
                            </Text>
                          </Group>
                          {selectedStormWarning && (
                            <Alert
                              color={selectedStormWarning.level === 'severe' ? 'red' : 'yellow'}
                              radius="md"
                              icon={<IconAlertTriangle size={18} />}
                              title={selectedStormWarning.title}
                            >
                              <Text size="sm">{selectedStormWarning.reasons.join('; ')}.</Text>
                            </Alert>
                          )}
                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Описание')}
                              <Text fw={600}>
                                {(selectedWeather.weather?.[0]?.description ?? 'нет данных')
                                  .replace(/\s*\(резервная модель\)\s*/gi, '')
                                  .trim()}
                              </Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Температура')}
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.main?.temp)} °C</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Ощущается')}
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.main?.feels_like)} °C</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Ветер')}
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.wind?.speed)} м/с</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Порывы')}
                              <Text fw={600}>{formatFixedOrNA(selectedWeather.wind?.gust)} м/с</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Видимость')}
                              <Text fw={600}>{formatVisibilityKmOrNA(selectedWeather.visibility)} км</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Давление')}
                              <Text fw={600}>{formatIntOrNA(selectedWeather.main?.pressure)} гПа</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Влажность')}
                              <Text fw={600}>{formatIntOrNA(selectedWeather.main?.humidity)}%</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Облачность')}
                              <Text fw={600}>{formatIntOrNA(selectedWeather.clouds?.all)}%</Text>
                            </Paper>
                            <Paper withBorder radius="md" p="xs" className="metric-tile">
                              {renderMetricLabel('Осадки')}
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
                      {effectiveRisk ? (
                        <>
                          {!activeRisk && previewRisk && (
                            <Text c="dimmed" size="sm">Предварительная оценка до создания рейса.</Text>
                          )}
                          {effectiveRisk?.emergencyAdjustment && (
                            <Alert color="red" radius="md" variant="light" icon={<IconAlertTriangle size={16} />}>
                              Учтен сценарий ЧС: {effectiveRisk.emergencyAdjustment.label}. Корректировка риска: +
                              {effectiveRisk.emergencyAdjustment.penalty}.
                            </Alert>
                          )}

                          <Group justify="space-between">
                            <Text size="sm">Взлет</Text>
                            <Text size="sm" fw={600}>
                              {effectiveRisk.departure.score}/100 ({riskLevelLabel(effectiveRisk.departure.score)})
                            </Text>
                          </Group>
                          <Progress value={effectiveRisk.departure.score} color={getRiskColor(effectiveRisk.departure.score)} />

                          <Group justify="space-between">
                            <Text size="sm">Посадка</Text>
                            <Text size="sm" fw={600}>
                              {effectiveRisk.arrival.score}/100 ({riskLevelLabel(effectiveRisk.arrival.score)})
                            </Text>
                          </Group>
                          <Progress value={effectiveRisk.arrival.score} color={getRiskColor(effectiveRisk.arrival.score)} />

                          <Group justify="space-between">
                            <Text size="sm">{isHelicopterMode ? 'Маршрут' : 'Эшелон ~12 км'}</Text>
                            <Text size="sm" fw={600}>
                              {effectiveRisk.cruise.score}/100 ({riskLevelLabel(effectiveRisk.cruise.score)})
                            </Text>
                          </Group>
                          <Progress value={effectiveRisk.cruise.score} color={getRiskColor(effectiveRisk.cruise.score)} />

                          {effectiveRisk.temporal && (
                            <>
                              <Group justify="space-between">
                                <Text size="sm">Временной фактор</Text>
                                <Text size="sm" fw={600}>
                                  {effectiveRisk.temporal.score}/100 ({riskLevelLabel(effectiveRisk.temporal.score)})
                                </Text>
                              </Group>
                              <Progress
                                value={effectiveRisk.temporal.score}
                                color={getRiskColor(effectiveRisk.temporal.score)}
                              />
                            </>
                          )}

                          <Divider />
                          <Group justify="space-between">
                            <Text fw={700}>Итоговый риск</Text>
                            <Text fw={700}>
                              {effectiveRisk.total}/100 ({riskLevelLabel(effectiveRisk.total)})
                            </Text>
                          </Group>
                          <Progress value={effectiveRisk.total} color={getRiskColor(effectiveRisk.total)} size="lg" radius="xl" />
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
            <Group justify="space-between" align="center" wrap="wrap">
              <Title order={4}>Все рейсы</Title>
              <Switch
                checked={showDepartedFlights}
                onChange={(event) => setShowDepartedFlights(Boolean(event.currentTarget.checked))}
                label={`Показывать ушедшие рейсы (${departedFlightsCount})`}
              />
            </Group>
            {isLoadingFlights ? (
              <Text c="dimmed">Загружаем рейсы...</Text>
            ) : filteredFlights.length === 0 ? (
              <Text c="dimmed">
                Пока нет созданных рейсов для режима{' '}
                {transportMode === TRANSPORT_MODE_HELICOPTER ? '«Вертолеты»' : '«Самолеты»'}.
              </Text>
            ) : visibleFlights.length === 0 ? (
              <Text c="dimmed">
                Активных рейсов нет. Включите «Показывать ушедшие рейсы», чтобы увидеть архив.
              </Text>
            ) : (
              <Box className="flights-table-wrap">
                <Table highlightOnHover stickyHeader withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Рейс</Table.Th>
                      <Table.Th>Тип</Table.Th>
                      <Table.Th>Маршрут</Table.Th>
                      <Table.Th>Вылет</Table.Th>
                      <Table.Th>Прилет</Table.Th>
                      <Table.Th>Риск</Table.Th>
                      <Table.Th>Решение</Table.Th>
                      <Table.Th>Действия</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleFlights.map((flight) => {
                      const estimatedArrivalAt = getFlightArrivalForTable(flight)
                      const departed = isFlightDeparted(flight, timeTick)
                      const riskScore = asNumberOrNull(flight.totalRisk)
                      const riskUpdatedAt =
                        flight?.riskUpdatedAt ?? flight?.cachedRiskUpdatedAt ?? flight?.createdAt ?? null
                      const actionState = flightActionById[flight.id] ?? {}
                      const isRefreshing = Boolean(actionState.refresh)
                      const isCancelling = Boolean(actionState.cancel)
                      const isDeciding = Boolean(actionState.decision)
                      const isActionPending = isRefreshing || isCancelling || isDeciding
                      const isBackendActionsBlocked = isRecoveryMode || isActionPending

                      return (
                        <Table.Tr
                          key={flight.id}
                          className={`flight-row${departed ? ' flight-row--departed' : ''}`}
                          onClick={() => {
                            if (departed) return
                            openFlightFromList(flight)
                          }}
                        >
                          <Table.Td>{flight.flightNumber}</Table.Td>
                          <Table.Td>
                            <Badge
                              variant="light"
                              color={flight.aircraftType === TRANSPORT_MODE_HELICOPTER ? 'grape' : 'blue'}
                            >
                              {flight.aircraftType === TRANSPORT_MODE_HELICOPTER ? 'Вертолет' : 'Самолет'}
                            </Badge>
                          </Table.Td>
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
                            <Stack gap={2}>
                              <Badge variant="light" color={decisionColor(flight.dispatcherDecision)}>
                                {decisionLabel(flight.dispatcherDecision)}
                              </Badge>
                              {flight.dispatcherDecisionDelayMinutes ? (
                                <Text size="xs" c="dimmed">
                                  задержка: {flight.dispatcherDecisionDelayMinutes} мин
                                </Text>
                              ) : null}
                              {flight.dispatcherDecisionReason ? (
                                <Text size="xs" c="dimmed" lineClamp={2}>
                                  {flight.dispatcherDecisionReason}
                                </Text>
                              ) : null}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Group gap="xs" wrap="wrap" className="flight-actions">
                              <Button
                                variant="default"
                                radius="xl"
                                size="xs"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  printFlightReport(flight)
                                }}
                                disabled={isActionPending}
                              >
                                Отчет
                              </Button>
                              {!departed && (
                                <>
                                  <Button
                                    variant="light"
                                    color="blue"
                                    radius="xl"
                                    size="xs"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openDecisionModal(flight)
                                  }}
                                    disabled={isBackendActionsBlocked}
                                  >
                                    Решение
                                  </Button>
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
                                    disabled={isBackendActionsBlocked}
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
                                    disabled={isBackendActionsBlocked}
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </>
                              )}
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
        opened={Boolean(decisionFlight)}
        onClose={closeDecisionModal}
        centered
        radius="xl"
        title="Решение диспетчера"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {decisionFlight?.flightNumber} | {decisionFlight?.fromAirportId} - {decisionFlight?.toAirportId}
          </Text>

          <SegmentedControl
            fullWidth
            radius="xl"
            value={decisionForm.decision}
            onChange={(nextDecision) => {
              setDecisionForm((prev) => ({ ...prev, decision: nextDecision }))
              setDecisionWhatIf(null)
              setDecisionError('')
            }}
            data={[
              { value: DISPATCHER_DECISION_APPROVE, label: 'Разрешить' },
              { value: DISPATCHER_DECISION_DELAY, label: 'Задержать' },
              { value: DISPATCHER_DECISION_CANCEL, label: 'Отменить' },
            ]}
            disabled={isRecoveryMode}
          />

          {isRecoveryMode && (
            <Alert color="orange" radius="md" variant="light" icon={<IconAlertTriangle size={16} />}>
              Режим восстановления: backend недоступен, применение решений временно отключено.
            </Alert>
          )}

          {decisionForm.decision === DISPATCHER_DECISION_DELAY && (
            <Stack gap="xs">
              <Group gap="xs" wrap="wrap">
                <TextInput
                  label="Задержка, минут"
                  type="number"
                  min={5}
                  step={5}
                  value={decisionForm.delayMinutes}
                  onChange={(event) =>
                    setDecisionForm((prev) => ({ ...prev, delayMinutes: event.target.value }))
                  }
                />
                <Button
                  variant="light"
                  radius="xl"
                  mt={26}
                  onClick={runDelayWhatIf}
                  loading={isDecisionWhatIfLoading}
                  disabled={isRecoveryMode}
                >
                  Рассчитать what-if
                </Button>
              </Group>

              <Group gap="xs" wrap="wrap">
                {WHAT_IF_DELAY_OPTIONS.map((minutes) => (
                  <Button
                    key={minutes}
                    variant="subtle"
                    radius="xl"
                    size="xs"
                    onClick={() =>
                      setDecisionForm((prev) => ({ ...prev, delayMinutes: String(minutes) }))
                    }
                    disabled={isRecoveryMode}
                  >
                    +{minutes} мин
                  </Button>
                ))}
              </Group>
            </Stack>
          )}

          {decisionWhatIf && (
            <Alert color={decisionWhatIf.riskDelta <= 0 ? 'teal' : 'yellow'} radius="md">
              <Stack gap={2}>
                <Text size="sm">
                  Текущий риск: <strong>{decisionWhatIf.currentTotalRisk}/100</strong>
                </Text>
                <Text size="sm">
                  После задержки: <strong>{decisionWhatIf.simulatedTotalRisk}/100</strong>{' '}
                  ({decisionWhatIf.riskDelta > 0 ? '+' : ''}{decisionWhatIf.riskDelta})
                </Text>
                <Text size="sm">{decisionWhatIf.recommendation}</Text>
                <Text size="xs" c="dimmed">
                  Новый вылет: {formatDateTime(decisionWhatIf.simulatedDepartureAt)} | Новый прилет:{' '}
                  {formatDateTime(decisionWhatIf.simulatedArrivalAt)}
                </Text>
              </Stack>
            </Alert>
          )}

          <Textarea
            label="Объяснение решения"
            minRows={3}
            autosize
            value={decisionForm.reason}
            onChange={(event) =>
              setDecisionForm((prev) => ({ ...prev, reason: event.target.value }))
            }
            placeholder="Например: риск грозы на маршруте, решение о задержке до стабилизации условий."
            disabled={isRecoveryMode}
          />

          {decisionError && (
            <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />}>
              {decisionError}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" radius="xl" onClick={closeDecisionModal}>
              Отмена
            </Button>
            <Button
              radius="xl"
              color={decisionForm.decision === DISPATCHER_DECISION_CANCEL ? 'red' : 'blue'}
              onClick={applyDecision}
              loading={isDecisionSubmitting}
              disabled={isRecoveryMode}
            >
              Применить решение
            </Button>
          </Group>
        </Stack>
      </Modal>

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
