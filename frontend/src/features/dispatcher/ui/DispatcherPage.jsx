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
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconDownload,
  IconFileText,
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
  riskLevelLabel,
  safeNumber,
} from '../model/risk'
import {
  getRiskAdjustmentFactor,
} from '../model/meteorologistValidation'
import { loadLeafletAssets } from '../services/leafletLoader'
import {
  applyFlightDecision as applyFlightDecisionApi,
  cancelFlight as cancelFlightApi,
  createFlight as createFlightApi,
  fetchAllFlights,
  fetchFlightHistory,
  refreshAllFlightRisks as refreshAllFlightRisksApi,
  refreshFlightRisk as refreshFlightRiskApi,
  simulateFlightDelayWhatIf as simulateFlightDelayWhatIfApi,
} from '../services/flightsApi'
import { fetchAirports as fetchAirportsApi } from '../services/airportsApi'
import { readFlightsCache, writeFlightsCache } from '../services/flightsCacheStorage'
import {
  fetchMeteorologistChatLog,
  markMeteorologistResponsesSeenForDispatcher,
  readMeteorologistChatLog,
  readNewMeteorologistResponsesForDispatcher,
  saveActiveMeteorologistRequestToBackend,
} from '../services/meteorologistRequestsStorage'
import { DEFAULT_METEOROLOGIST_NEEDS, METEOROLOGIST_NEEDS } from '../model/meteorologistNeeds'
import { fetchWeatherByAirport, isWeatherCacheFresh } from '../services/weatherApi'
import { addAppUpdateListener } from '../services/appUpdatesSocket'
import './DispatcherPage.css'

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
const DEPARTURE_TIME_STEP_MINUTES = 5
const MIN_DEPARTURE_LEAD_MINUTES = 1
const DEFAULT_DEPARTURE_LEAD_MINUTES = 60
const RISK_LEGEND = [
  { label: 'Низкий риск', className: 'dot-low' },
  { label: 'Средний риск', className: 'dot-medium' },
  { label: 'Высокий риск', className: 'dot-high' },
  { label: 'Критический риск', className: 'dot-critical' },
]
const DISPATCHER_DECISION_PENDING = 'PENDING'
const DISPATCHER_DECISION_APPROVE = 'APPROVE'
const DISPATCHER_DECISION_DELAY = 'DELAY'
const DISPATCHER_DECISION_CANCEL = 'CANCEL'
const WHAT_IF_DELAY_OPTIONS = [15, 30, 60, 120]
const RECOVERY_CHECK_INTERVAL_MS = 20000
const URGENT_DEPARTURE_WINDOW_MS = 3 * 60 * 60 * 1000
const CRITICAL_PREDEPARTURE_WINDOW_MS = 1 * 60 * 60 * 1000
const RISK_DATA_STALE_MS = 3 * 60 * 60 * 1000
const FLIGHT_RISK_FILTERS = [
  { value: 'ALL', label: 'Все риски' },
  { value: 'LOW', label: 'Низкий' },
  { value: 'MEDIUM', label: 'Умеренный' },
  { value: 'HIGH', label: 'Высокий' },
  { value: 'CRITICAL', label: 'Критический' },
  { value: 'NO_DATA', label: 'Нет данных' },
]
const FLIGHT_STATUS_FILTERS = [
  { value: 'ALL', label: 'Все статусы' },
  { value: DISPATCHER_DECISION_PENDING, label: 'Ожидает решения' },
  { value: DISPATCHER_DECISION_APPROVE, label: 'Разрешен' },
  { value: DISPATCHER_DECISION_DELAY, label: 'Задержан' },
  { value: DISPATCHER_DECISION_CANCEL, label: 'Отменен' },
  { value: 'COMPLETED', label: 'Завершен' },
]
const DEPARTURE_TIME_FILTERS = [
  { value: 'ALL', label: 'Любое время' },
  { value: 'NEXT_3H', label: 'До 3 часов' },
  { value: 'TODAY', label: 'Сегодня' },
  { value: 'TOMORROW', label: 'Завтра' },
  { value: 'LATER', label: 'Позже' },
]
const DEFAULT_FLIGHT_FILTERS = {
  search: '',
  risk: 'ALL',
  status: 'ALL',
  airport: 'ALL',
  departureTime: 'ALL',
}
const LOCAL_AIRFIELD_CATALOG = [...AIRPORTS_RF, ...HELIPORTS_TVER]
const PLANE_ICON_HTML = `
  <span class="plane-marker-inner">
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M60 30 L36 24 L24 4 L18 6 L24 24 L8 20 L4 24 L18 32 L4 40 L8 44 L24 40 L18 58 L24 60 L36 40 L60 34 Z" />
    </svg>
  </span>
`
const HELICOPTER_ICON_HTML = `
  <span class="plane-marker-inner plane-marker-inner--helicopter">
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M30 4 H34 V18 H47 C54 18 59 23 59 30 C59 37 54 42 47 42 H38 L45 56 H38 L28 42 H19 L15 50 H9 L13 39 C8 36 5 32 5 27 C5 22 9 18 15 18 H30 Z M16 25 C14 25 12 27 12 29 C12 31 14 33 16 33 H47 C50 33 52 31 52 30 C52 27 50 25 47 25 Z M2 8 H62 V13 H2 Z" />
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
  if (score <= 30) return 'green'
  if (score <= 55) return 'yellow'
  if (score <= 75) return 'orange'
  return 'red'
}

function getRiskBadgeColor(score) {
  if (!Number.isFinite(Number(score))) return 'gray'
  if (score <= 30) return 'cyan'
  if (score <= 55) return 'blue'
  if (score <= 75) return 'orange'
  return 'red'
}

function formatRiskBadgeScore(score) {
  if (!Number.isFinite(Number(score))) return '–'
  const normalized = Math.round(Number(score))
  return `${normalized}/100`
}

function asNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getDisplayProgressValue(score) {
  const numeric = asNumberOrNull(score)
  if (numeric == null) return 0
  return Math.max(8, Math.round(numeric))
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

function getAirportDisplayName(airport) {
  if (!airport) return ''
  const code = String(airport.id ?? '').trim()
  const name = String(airport.name ?? '').trim()
  const city = String(airport.city ?? '').trim()
  const label = name || city || 'Без названия'
  return code ? `${code} - ${label}` : label
}

function getAirportFilterLabel(airportId, airport) {
  const code = String(airportId ?? airport?.id ?? '').trim()
  if (airport) {
    return getAirportDisplayName(airport)
  }
  return code ? `${code} - неизвестный аэропорт` : 'Неизвестный аэропорт'
}

function mergeAirportCatalog(primaryCatalog, secondaryCatalog) {
  const byId = new Map()
  ;[...(primaryCatalog ?? []), ...(secondaryCatalog ?? [])].forEach((airport) => {
    const id = String(airport?.id ?? '').trim()
    if (!id) return
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, airport)
      return
    }
    byId.set(id, {
      ...airport,
      name: String(airport?.name ?? '').trim() || existing.name,
      city: String(airport?.city ?? '').trim() || existing.city,
      region: String(airport?.region ?? '').trim() || existing.region,
      lat: Number.isFinite(Number(airport?.lat)) ? airport.lat : existing.lat,
      lon: Number.isFinite(Number(airport?.lon)) ? airport.lon : existing.lon,
    })
  })
  return Array.from(byId.values())
}

function isHeliAirfield(airport) {
  const id = String(airport?.id ?? '').trim()
  const name = String(airport?.name ?? '').trim().toLowerCase()
  return id.endsWith('_HELI') || id.startsWith('RU-TVR-') || name.includes('вертолетная площадка')
}

function haversineDistanceKm(fromAirport, toAirport) {
  const earthRadiusKm = 6371
  const latDistanceRad = ((toAirport.lat - fromAirport.lat) * Math.PI) / 180
  const lonDistanceRad = toRadians(normalizeLongitude(toAirport.lon - fromAirport.lon))
  const startLatRad = toRadians(fromAirport.lat)
  const endLatRad = toRadians(toAirport.lat)

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

function buildOrthodromePath(fromAirport, toAirport) {
  return [
    [fromAirport.lat, fromAirport.lon],
    [toAirport.lat, toAirport.lon],
  ]
}

function getProjectedPathPosition(map, path, fraction) {
  if (!map || !Array.isArray(path) || path.length < 2) return null

  const points = path
    .map((item) => map.latLngToLayerPoint(item))
    .filter(Boolean)
  if (points.length < 2) return null

  const segments = []
  let totalLength = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const length = start.distanceTo(end)
    if (!Number.isFinite(length) || length <= 0) continue
    segments.push({ start, end, length })
    totalLength += length
  }

  if (totalLength <= 0 || segments.length === 0) return null

  const clamped = Math.max(0, Math.min(1, fraction))
  let remaining = totalLength * clamped
  let selected = segments[segments.length - 1]

  for (const segment of segments) {
    if (remaining <= segment.length) {
      selected = segment
      break
    }
    remaining -= segment.length
  }

  const localFraction = Math.max(0, Math.min(1, remaining / selected.length))
  const point = window.L.point(
    selected.start.x + (selected.end.x - selected.start.x) * localFraction,
    selected.start.y + (selected.end.y - selected.start.y) * localFraction,
  )
  const heading = (toDegrees(Math.atan2(selected.end.y - selected.start.y, selected.end.x - selected.start.x)) + 360) % 360

  return {
    latLng: map.layerPointToLatLng(point),
    heading,
  }
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

  const totalMinutes = Math.ceil(diffMs / (1000 * 60))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return `осталось: ${days} д ${hours} ч ${minutes} мин`
  }

  if (hours > 0) {
    return `осталось: ${hours} ч ${minutes} мин`
  }

  return `осталось: ${minutes} мин`
}

function isFlightCompleted(flight, arrivalAt, nowTimestamp) {
  const arrivalDate = parseDateTime(arrivalAt)
  if (!arrivalDate) return false
  return arrivalDate.getTime() <= nowTimestamp
}

function isFlightInProgress(flight, arrivalAt, nowTimestamp) {
  const departureDate = parseDateTime(flight?.departureAt)
  const arrivalDate = parseDateTime(arrivalAt)
  if (!departureDate || !arrivalDate) return false
  return departureDate.getTime() <= nowTimestamp && nowTimestamp < arrivalDate.getTime()
}

function formatFlightTimingStatus(flight, arrivalAt, nowTimestamp) {
  if (isFlightInProgress(flight, arrivalAt, nowTimestamp)) {
    return flight?.aircraftType === TRANSPORT_MODE_HELICOPTER ? 'вертолет в пути' : 'самолет в пути'
  }
  return formatTimeLeftToDeparture(flight?.departureAt, nowTimestamp)
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



function calculateTotalRisk(departureRisk, arrivalRisk, cruiseRisk) {
  return clampScore(
    departureRisk.score * 0.4
      + arrivalRisk.score * 0.4
      + cruiseRisk.score * 0.2,
  )
}

function applyDepartureTimeRisk(risk, departureAt, nowTimestamp = Date.now()) {
  if (!risk || !departureAt) return risk
  const departureDate = parseDateTime(departureAt)
  if (!departureDate) return risk

  const hoursUntilDeparture = Math.floor((departureDate.getTime() - nowTimestamp) / (60 * 60 * 1000))
  const hourOfDay = departureDate.getHours()
  let cruiseBoost = 0
  const timeFactors = []

  if (hoursUntilDeparture >= 0 && hoursUntilDeparture < 3) {
    cruiseBoost += 10
    timeFactors.push('Временной фактор: до вылета менее 3 часов')
  } else if (hoursUntilDeparture >= 0 && hoursUntilDeparture < 12) {
    cruiseBoost += 6
    timeFactors.push('Временной фактор: до вылета менее 12 часов')
  } else if (hoursUntilDeparture >= 24) {
    cruiseBoost += 2
    timeFactors.push('Временной фактор: дальний прогноз')
  }

  if (hourOfDay < 6 || hourOfDay >= 22) {
    cruiseBoost += 3
    timeFactors.push('Временной фактор: ночное время вылета')
  }

  if (cruiseBoost <= 0) return risk

  const cruise = {
    ...(risk.cruise ?? { score: 0, factors: [] }),
    score: clampScore(safeNumber(risk.cruise?.score) + cruiseBoost),
    factors: [...(risk.cruise?.factors ?? []), ...timeFactors],
  }
  const total = calculateTotalRisk(risk.departure, risk.arrival, cruise)

  return {
    ...risk,
    cruise,
    total,
    feasibility: getFeasibility(total),
  }
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

function isDepartureWithinUrgentWindow(flight, nowTimestamp) {
  const departureDate = parseDateTime(flight?.departureAt)
  if (!departureDate) return false
  const diffMs = departureDate.getTime() - nowTimestamp
  return diffMs > 0 && diffMs < URGENT_DEPARTURE_WINDOW_MS
}

function hasFlightRiskData(flight) {
  return Number.isFinite(Number(flight?.totalRisk))
}

function isFlightRiskDataStale(flight, nowTimestamp) {
  const riskUpdatedAt = parseDateTime(
    flight?.riskUpdatedAt ?? flight?.cachedRiskUpdatedAt ?? flight?.createdAt,
  )
  if (!riskUpdatedAt) return true
  return nowTimestamp - riskUpdatedAt.getTime() > RISK_DATA_STALE_MS
}

function needsUrgentWeatherUpdate(flight, nowTimestamp) {
  return isDepartureWithinUrgentWindow(flight, nowTimestamp)
    && hasFlightRiskData(flight)
    && isFlightRiskDataStale(flight, nowTimestamp)
}

function hasUrgentMissingRiskData(flight, nowTimestamp) {
  return isDepartureWithinUrgentWindow(flight, nowTimestamp) && !hasFlightRiskData(flight)
}

function getRiskLevelFilterValue(score) {
  const numeric = asNumberOrNull(score)
  if (numeric == null) return 'NO_DATA'
  if (numeric <= 30) return 'LOW'
  if (numeric <= 55) return 'MEDIUM'
  if (numeric <= 75) return 'HIGH'
  return 'CRITICAL'
}

function getDepartureFilterValue(flight, nowTimestamp) {
  const departureDate = parseDateTime(flight?.departureAt)
  if (!departureDate) return 'LATER'
  const nowDate = new Date(nowTimestamp)
  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
  const startOfDayAfterTomorrow = new Date(startOfTomorrow)
  startOfDayAfterTomorrow.setDate(startOfDayAfterTomorrow.getDate() + 1)

  if (isDepartureWithinUrgentWindow(flight, nowTimestamp)) return 'NEXT_3H'
  if (departureDate >= startOfToday && departureDate < startOfTomorrow) return 'TODAY'
  if (departureDate >= startOfTomorrow && departureDate < startOfDayAfterTomorrow) return 'TOMORROW'
  return 'LATER'
}

function getRiskChangeReason(historyItem) {
  if (historyItem?.dispatcherDecision === DISPATCHER_DECISION_DELAY) {
    return `Задержка рейса${historyItem.dispatcherDecisionDelayMinutes ? ` на ${historyItem.dispatcherDecisionDelayMinutes} мин` : ''}`
  }
  if (historyItem?.dispatcherDecision === DISPATCHER_DECISION_APPROVE) return 'Обновление при разрешении рейса'
  if (historyItem?.dispatcherDecision === DISPATCHER_DECISION_CANCEL) return 'Решение об отмене рейса'
  if (historyItem?.oldTotalRisk !== historyItem?.newTotalRisk) return 'Изменились погодные условия'
  return 'Плановый пересчет'
}

function collectRiskReasons(flight, nowTimestamp) {
  const factors = [
    ...(Array.isArray(flight?.departureRisk?.factors) ? flight.departureRisk.factors : []),
    ...(Array.isArray(flight?.arrivalRisk?.factors) ? flight.arrivalRisk.factors : []),
    ...(Array.isArray(flight?.cruiseRisk?.factors) ? flight.cruiseRisk.factors : []),
  ]
  const normalizedFactors = factors.map((item) => String(item))
  const lowerText = normalizedFactors.join(' ').toLowerCase()
  const reasons = []

  if (/ветер|порыв/.test(lowerText)) reasons.push('сильный ветер')
  if (/видим|туман|дымк/.test(lowerText)) reasons.push('низкая видимость')
  if (/осад|дожд|снег|гроза/.test(lowerText)) reasons.push('осадки')
  if (needsUrgentWeatherUpdate(flight, nowTimestamp)) reasons.push('данные устарели')
  if (hasUrgentMissingRiskData(flight, nowTimestamp)) reasons.push('нет данных по риску')

  normalizedFactors.forEach((factor) => {
    if (!reasons.includes(factor)) reasons.push(factor)
  })

  return reasons.length > 0 ? reasons : ['значимых факторов риска не выявлено']
}


function getRefreshPolicy(departureAt, nowTimestamp) {
  const departureDate = parseDateTime(departureAt)
  if (!departureDate) return { intervalMs: 3 * 60 * 60 * 1000, timeLeftMs: null }
  const timeLeftMs = departureDate.getTime() - nowTimestamp

  if (timeLeftMs > 24 * 60 * 60 * 1000) {
    return { intervalMs: 24 * 60 * 60 * 1000, timeLeftMs }
  }
  if (timeLeftMs > 12 * 60 * 60 * 1000) {
    return { intervalMs: 6 * 60 * 60 * 1000, timeLeftMs }
  }
  return { intervalMs: 3 * 60 * 60 * 1000, timeLeftMs }
}

function getNextRiskUpdateAt(flight, nowTimestamp) {
  const riskUpdatedAt = parseDateTime(
    flight?.riskUpdatedAt ?? flight?.cachedRiskUpdatedAt ?? flight?.createdAt,
  )
  if (!riskUpdatedAt) return null
  const { intervalMs } = getRefreshPolicy(flight?.departureAt, nowTimestamp)
  return new Date(riskUpdatedAt.getTime() + intervalMs)
}

function getRecommendationCategory(code) {
  if (code === 'APPROVE') return 'APPROVE'
  if (code === 'CANCEL') return 'CANCEL'
  if (String(code ?? '').startsWith('DELAY')) return 'DELAY'
  return 'OTHER'
}

function getAutomaticRecommendationCode(totalRisk) {
  const numeric = asNumberOrNull(totalRisk)
  if (numeric == null) return null
  if (numeric > 75) return 'CANCEL'
  if (numeric > 45) return 'DELAY_60'
  return 'APPROVE'
}

function prioritizeRecommendation(recommendations, code) {
  if (!code || !Array.isArray(recommendations) || recommendations.length === 0) return recommendations
  const preferred = recommendations.find((item) => item.code === code)
  if (!preferred) return recommendations
  return [
    {
      ...preferred,
      score: Math.max(preferred.score, recommendations[0]?.score ?? preferred.score),
      reason: `${preferred.reason} Автоматически выбрано по текущему уровню риска.`,
    },
    ...recommendations.filter((item) => item.code !== code),
  ]
}

function getWeatherTrendPenalty(weather) {
  if (!weather) return 0
  const wind = safeNumber(weather.wind?.speed)
  const gust = safeNumber(weather.wind?.gust, wind)
  const visibility = safeNumber(weather.visibility, 10000)
  const precip = getPrecipPerHour(weather)
  const weatherCode = safeNumber(weather.weather?.[0]?.id, 800)

  let penalty = 0
  if (wind >= 10) penalty += 5
  if (wind >= 15) penalty += 7
  if (gust >= 16) penalty += 6
  if (visibility < 5000) penalty += 7
  if (precip >= 0.5) penalty += 6
  if (precip >= 2) penalty += 7
  if (weatherCode >= 200 && weatherCode < 300) penalty += 12
  if (weatherCode === 741 || weatherCode === 701) penalty += 8
  return penalty
}

function buildRiskForecast(risk, weather) {
  if (!risk) return null
  const trendPenalty = getWeatherTrendPenalty(weather)
  const forecastRisk = clampScore(
    safeNumber(risk.total) + trendPenalty,
  )
  const direction = forecastRisk > risk.total + 3
    ? 'повыситься'
    : forecastRisk < risk.total - 3
    ? 'снизиться'
    : 'остаться около текущего уровня'

  return {
    value: forecastRisk,
    level: riskLevelLabel(forecastRisk).toUpperCase(),
    direction,
    text: `Через 2 часа риск может ${direction} до ${riskLevelLabel(forecastRisk).toUpperCase()}.`,
  }
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
  const baseDeparture = risk?.departure && typeof risk.departure === 'object' ? risk.departure : { score: 0, factors: [] }
  const baseArrival = risk?.arrival && typeof risk.arrival === 'object' ? risk.arrival : { score: 0, factors: [] }
  const baseCruise = risk?.cruise && typeof risk.cruise === 'object' ? risk.cruise : { score: 0, factors: [] }

  const depFactors = asFactorsArray(baseDeparture.factors)
  const arrFactors = asFactorsArray(baseArrival.factors)
  const cruiseFactors = asFactorsArray(baseCruise.factors)

  const departure = {
    ...baseDeparture,
    score: clampScore((baseDeparture.score ?? 0) + depBoost),
    factors: [...depFactors, `${scenarioText}${commentSuffix}`],
  }
  const arrival = {
    ...baseArrival,
    score: clampScore((baseArrival.score ?? 0) + arrBoost),
    factors: [...arrFactors, `${scenarioText}${commentSuffix}`],
  }
  const cruise = {
    ...baseCruise,
    score: clampScore((baseCruise.score ?? 0) + cruiseBoost),
    factors: [...cruiseFactors, `${scenarioText}${commentSuffix}`],
  }

  const total = calculateTotalRisk(departure, arrival, cruise)

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

function downloadBlob(filename, blob) {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function columnName(index) {
  let name = ''
  let current = index + 1
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function uint16(value) {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function uint32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]
}

function encodeText(value) {
  return new TextEncoder().encode(value)
}

function createZip(files) {
  const chunks = []
  const centralDirectory = []
  let offset = 0

  files.forEach((file) => {
    const nameBytes = encodeText(file.name)
    const dataBytes = encodeText(file.content)
    const checksum = crc32(dataBytes)
    const localHeader = new Uint8Array([
      ...uint32(0x04034b50),
      ...uint16(20),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(checksum),
      ...uint32(dataBytes.length),
      ...uint32(dataBytes.length),
      ...uint16(nameBytes.length),
      ...uint16(0),
    ])
    chunks.push(localHeader, nameBytes, dataBytes)
    centralDirectory.push({
      nameBytes,
      checksum,
      size: dataBytes.length,
      offset,
    })
    offset += localHeader.length + nameBytes.length + dataBytes.length
  })

  const centralStart = offset
  centralDirectory.forEach((entry) => {
    const header = new Uint8Array([
      ...uint32(0x02014b50),
      ...uint16(20),
      ...uint16(20),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(entry.checksum),
      ...uint32(entry.size),
      ...uint32(entry.size),
      ...uint16(entry.nameBytes.length),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(0),
      ...uint32(entry.offset),
    ])
    chunks.push(header, entry.nameBytes)
    offset += header.length + entry.nameBytes.length
  })

  const centralSize = offset - centralStart
  chunks.push(new Uint8Array([
    ...uint32(0x06054b50),
    ...uint16(0),
    ...uint16(0),
    ...uint16(centralDirectory.length),
    ...uint16(centralDirectory.length),
    ...uint32(centralSize),
    ...uint32(centralStart),
    ...uint16(0),
  ]))

  return new Blob(chunks, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function buildWorksheetXml(rows) {
  const sheetData = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1
    const cells = row.map((value, cellIndex) => {
      const ref = `${columnName(cellIndex)}${rowNumber}`
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
    }).join('')
    return `<row r="${rowNumber}">${cells}</row>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="12" width="22" customWidth="1"/>
  </cols>
  <sheetData>${sheetData}</sheetData>
</worksheet>`
}

function downloadXlsx(filename, rows) {
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Аналитика" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

  downloadBlob(filename, createZip([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/worksheets/sheet1.xml', content: buildWorksheetXml(rows) },
  ]))
}

function getAircraftTypeLabel(type) {
  return type === TRANSPORT_MODE_HELICOPTER ? 'Вертолет' : 'Самолет'
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

/**
 * Backend сохраняет реальный перерасчет риска по METAR/TAF.
 * На фронте оставляем только отметку о неполноте ответа, чтобы не удваивать риск.
 */
function applyMeteoDataRiskAdjustment(risk, meteoDataInfo) {
  if (!risk || !meteoDataInfo) {
    return risk
  }

  const { responseComplete, responseByNeed, needs } = meteoDataInfo
  
  if (responseComplete) {
    return risk
  }

  return {
    ...risk,
    meteorologistDataIncomplete: true,
    meteorologistMissingDataFactor: getRiskAdjustmentFactor(responseByNeed, needs),
  }
}

export default function DispatcherPage({
  onRequestMeteorologist,
  initialTab = 'monitoring',
  dispatcherNotice = null,
  onDispatcherNoticeShown,
  onTabUrlChange,
}) {
  const cachedFlightsOnLoad = useMemo(() => readFlightsCache(), [])
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)

  const airportLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const planeLayerRef = useRef(null)
  const weatherCacheRef = useRef({})
  const recoveryModeRef = useRef(false)
  const previousRecommendationRef = useRef(null)
  const previousRiskRef = useRef(null)
  const urgentMeteoRequestedFlightsRef = useRef(new Set())
  const notificationLastShownAtRef = useRef({})
  const notificationMutedUntilRef = useRef({})

  const [leafletReady, setLeafletReady] = useState(false)
  const [leafletError, setLeafletError] = useState('')
  const [activeTab, setActiveTab] = useState(
    initialTab === 'flights' || initialTab === 'analytics' ? initialTab : 'monitoring',
  )
  const [transportMode, setTransportMode] = useState(TRANSPORT_MODE_AIRPLANE)

  const [form, setForm] = useState(() => createInitialForm(Date.now(), TRANSPORT_MODE_AIRPLANE))
  const [airportCatalog, setAirportCatalog] = useState(() => LOCAL_AIRFIELD_CATALOG)

  const [activeFlight, setActiveFlight] = useState(null)
  const [allFlights, setAllFlights] = useState(() =>
    hydrateFlightsWithRiskTimestamps(cachedFlightsOnLoad, [], new Date().toISOString()),
  )
  const [isLoadingFlights, setIsLoadingFlights] = useState(() => cachedFlightsOnLoad.length === 0)
  const [flightsError, setFlightsError] = useState('')
  const [flightActionError, setFlightActionError] = useState('')
  const [flightActionById, setFlightActionById] = useState({})
  const [isRefreshingAllRisks, setIsRefreshingAllRisks] = useState(false)
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
  const [activeFlightHistory, setActiveFlightHistory] = useState([])
  const [activeFlightHistoryError, setActiveFlightHistoryError] = useState('')
  const [isActiveFlightHistoryLoading, setIsActiveFlightHistoryLoading] = useState(false)
  const [historyFlight, setHistoryFlight] = useState(null)
  const [historyModalItems, setHistoryModalItems] = useState([])
  const [historyModalError, setHistoryModalError] = useState('')
  const [isHistoryModalLoading, setIsHistoryModalLoading] = useState(false)
  const [flightFilters, setFlightFilters] = useState(DEFAULT_FLIGHT_FILTERS)
  const [flightAirportFilterInput, setFlightAirportFilterInput] = useState('')
  const [meteoResponseFlight, setMeteoResponseFlight] = useState(null)

  const [selectedWeatherAirportId, setSelectedWeatherAirportId] = useState('')
  const [weatherByAirport, setWeatherByAirport] = useState({})
  const [notifications, setNotifications] = useState([])
  const [autoRecommendationNotice, setAutoRecommendationNotice] = useState(null)

  const [isEvaluating, setIsEvaluating] = useState(false)
  const [isPreviewEvaluating, setIsPreviewEvaluating] = useState(false)
  const [previewRisk, setPreviewRisk] = useState(null)
  const [error, setError] = useState('')
  const [emergencyScenario, setEmergencyScenario] = useState({
    active: false,
    type: 'RUNWAY_RESTRICTION',
    level: 'MEDIUM',
    comment: '',
  })
  const [showDepartedFlights, setShowDepartedFlights] = useState(true)
  const [meteorologistUpdateNotice, setMeteorologistUpdateNotice] = useState(null)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [recoveryStartedAt, setRecoveryStartedAt] = useState('')
  const [recoveryReason, setRecoveryReason] = useState('')
  const [recoveryRecoveredAt, setRecoveryRecoveredAt] = useState('')
  const [isRecoveryChecking, setIsRecoveryChecking] = useState(false)
  const [timeTick, setTimeTick] = useState(() => Date.now())
  const [planeTick, setPlaneTick] = useState(() => Date.now())
  const [activeFlightMeteoData, setActiveFlightMeteoData] = useState(null)
  const [highlightedFlightId, setHighlightedFlightId] = useState('')
  const [meteorologistChatLog, setMeteorologistChatLog] = useState(() => readMeteorologistChatLog())
  const minDepartureAt = useMemo(() => getMinDepartureAtValue(timeTick), [timeTick])
  const isHelicopterMode = transportMode === TRANSPORT_MODE_HELICOPTER

  const allAirfields = useMemo(
    () => (Array.isArray(airportCatalog) && airportCatalog.length > 0 ? airportCatalog : LOCAL_AIRFIELD_CATALOG),
    [airportCatalog],
  )

  const availableAirfields = useMemo(
    () =>
      allAirfields.filter((airport) => {
        if (String(airport?.region ?? '').trim().toLowerCase() === 'казахстан') return false
        const isHeliPoint = isHeliAirfield(airport)
        return transportMode === TRANSPORT_MODE_HELICOPTER ? isHeliPoint : !isHeliPoint
      }),
    [allAirfields, transportMode],
  )
  const selectableAirfields = useMemo(() => availableAirfields, [availableAirfields])

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
  const citySet = useMemo(() => new Set(cities), [cities])
  const cityAutocompleteData = useMemo(
    () => cities.map((city) => ({ value: city })),
    [cities],
  )
  const hasValidFromCity = citySet.has(form.fromCity)
  const hasValidToCity = citySet.has(form.toCity)

  const fromAirportOptions = useMemo(() => {
    const normalizedCity = normalizeSearchText(form.fromCity)
    if (!normalizedCity || !hasValidFromCity) return []
    return selectableAirfields.filter(
      (airport) => normalizeSearchText(airport.city).startsWith(normalizedCity),
    )
  }, [form.fromCity, hasValidFromCity, selectableAirfields])

  const toAirportOptions = useMemo(() => {
    const normalizedCity = normalizeSearchText(form.toCity)
    if (!normalizedCity || !hasValidToCity) return []
    return selectableAirfields.filter(
      (airport) => normalizeSearchText(airport.city).startsWith(normalizedCity),
    )
  }, [form.toCity, hasValidToCity, selectableAirfields])

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
  const isFallbackWeather = String(selectedWeather?.provider ?? '').includes('fallback')
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
    () => filteredFlights.filter((flight) => isFlightCompleted(flight, getFlightArrivalForTable(flight), timeTick)).length,
    [filteredFlights, getFlightArrivalForTable, timeTick],
  )
  const visibleFlights = useMemo(
    () => {
      const search = normalizeSearchText(flightFilters.search)
      return filteredFlights
        .filter((flight) => (
          flightFilters.status === 'COMPLETED'
          || showDepartedFlights
          || !isFlightCompleted(flight, getFlightArrivalForTable(flight), timeTick)
        ))
        .filter((flight) => {
          const completed = isFlightCompleted(flight, getFlightArrivalForTable(flight), timeTick)
          if (search && !normalizeSearchText(flight?.flightNumber).includes(search)) return false
          if (flightFilters.risk !== 'ALL' && getRiskLevelFilterValue(flight?.totalRisk) !== flightFilters.risk) {
            return false
          }
          if (flightFilters.status === 'COMPLETED') {
            return completed
          }
          if (
            flightFilters.status !== 'ALL'
            && (flight?.dispatcherDecision ?? DISPATCHER_DECISION_PENDING) !== flightFilters.status
          ) {
            return false
          }
          if (
            flightFilters.airport !== 'ALL'
            && flight?.fromAirportId !== flightFilters.airport
            && flight?.toAirportId !== flightFilters.airport
          ) {
            return false
          }
          if (
            flightFilters.departureTime !== 'ALL'
            && !completed
            && getDepartureFilterValue(flight, timeTick) !== flightFilters.departureTime
          ) {
            return false
          }
          return true
        })
    },
    [filteredFlights, flightFilters, getFlightArrivalForTable, showDepartedFlights, timeTick],
  )
  const pendingMeteoByFlightNumber = useMemo(() => {
    const pending = {}
    meteorologistChatLog.forEach((item) => {
      if (item?.direction !== 'incoming') return
      if (item?.messageType !== 'dispatcher_request') return
      if (item?.isAnswered) return
      const flightNumber = String(item?.flightNumber ?? '').trim()
      if (!flightNumber) return
      pending[flightNumber] = true
    })
    return pending
  }, [meteorologistChatLog])
  const meteoResponseByFlightNumber = useMemo(() => {
    const responses = {}
    meteorologistChatLog.forEach((item) => {
      if (item?.direction !== 'outgoing') return
      if (item?.messageType !== 'meteorologist_response') return
      const flightNumber = String(item?.flightNumber ?? item?.requestSnapshot?.form?.flightNumber ?? '').trim()
      if (!flightNumber) return
      const previous = responses[flightNumber]
      const previousTime = Date.parse(previous?.createdAt ?? '') || 0
      const nextTime = Date.parse(item?.createdAt ?? '') || 0
      if (!previous || nextTime >= previousTime) {
        responses[flightNumber] = item
      }
    })
    return responses
  }, [meteorologistChatLog])
  const meteoResponsesByFlightNumber = useMemo(() => {
    const responses = {}
    meteorologistChatLog.forEach((item) => {
      if (item?.direction !== 'outgoing') return
      if (item?.messageType !== 'meteorologist_response') return
      const flightNumber = String(item?.flightNumber ?? item?.requestSnapshot?.form?.flightNumber ?? '').trim()
      if (!flightNumber) return
      responses[flightNumber] = [...(responses[flightNumber] ?? []), item]
    })
    Object.values(responses).forEach((items) => {
      items.sort((left, right) => (Date.parse(right?.createdAt ?? '') || 0) - (Date.parse(left?.createdAt ?? '') || 0))
    })
    return responses
  }, [meteorologistChatLog])
  const flightAirportFilterOptions = useMemo(() => {
    return [
      { value: 'ALL', label: 'Все аэропорты' },
      ...allAirfields
        .filter((airport) => airport?.id && !isHeliAirfield(airport))
        .slice()
        .sort((left, right) => getAirportDisplayName(left).localeCompare(getAirportDisplayName(right)))
        .map((airport) => {
          return {
            value: airport.id,
            label: getAirportFilterLabel(airport.id, airport),
          }
        }),
    ]
  }, [allAirfields])
  const flightAirportFilterData = useMemo(
    () => flightAirportFilterOptions
      .filter((item) => item.value !== 'ALL')
      .map((item) => item.label),
    [flightAirportFilterOptions],
  )
  const flightSummary = useMemo(() => {
    const activeFlights = filteredFlights.filter((flight) => !isFlightCompleted(flight, getFlightArrivalForTable(flight), timeTick))
    return {
      critical: activeFlights.filter((flight) => asNumberOrNull(flight.totalRisk) != null && Number(flight.totalRisk) > 75).length,
      awaitingData: activeFlights.filter((flight) => hasUrgentMissingRiskData(flight, timeTick)).length,
      delayed: activeFlights.filter((flight) => flight.dispatcherDecision === DISPATCHER_DECISION_DELAY).length,
    }
  }, [filteredFlights, getFlightArrivalForTable, timeTick])
  const analytics = useMemo(() => {
    const modeFlightNumbers = new Set(
      filteredFlights
        .map((flight) => String(flight?.flightNumber ?? '').trim())
        .filter(Boolean),
    )
    const meteorologistRequestsForMode = meteorologistChatLog.filter((item) => {
      if (item?.direction !== 'incoming' || item?.messageType !== 'dispatcher_request') return false
      const flightNumber = String(item?.flightNumber ?? '').trim()
      return flightNumber && modeFlightNumbers.has(flightNumber)
    }).length
    const riskBuckets = FLIGHT_RISK_FILTERS.filter((item) => item.value !== 'ALL').map((item) => ({
      ...item,
      count: filteredFlights.filter((flight) => getRiskLevelFilterValue(flight?.totalRisk) === item.value).length,
    }))
    return {
      riskBuckets,
      delayed: filteredFlights.filter((flight) => flight.dispatcherDecision === DISPATCHER_DECISION_DELAY).length,
      total: filteredFlights.length,
      meteorologistRequests: meteorologistRequestsForMode,
    }
  }, [filteredFlights, meteorologistChatLog])
  const weatherPieData = useMemo(() => {
    const calm = analytics.riskBuckets.find((item) => item.value === 'LOW')?.count ?? 0
    const warning = analytics.riskBuckets.find((item) => item.value === 'MEDIUM')?.count ?? 0
    const severe = (analytics.riskBuckets.find((item) => item.value === 'HIGH')?.count ?? 0)
      + (analytics.riskBuckets.find((item) => item.value === 'CRITICAL')?.count ?? 0)
      + (analytics.riskBuckets.find((item) => item.value === 'NO_DATA')?.count ?? 0)
    const total = Math.max(1, calm + warning + severe)
    const calmPct = Math.round((calm / total) * 100)
    const warningPct = Math.round((warning / total) * 100)
    const severePct = 100 - calmPct - warningPct
    return { calm, warning, severe, calmPct, warningPct, severePct, total }
  }, [analytics.riskBuckets])

  const buildAnalyticsCsvForFlights = useCallback((sourceFlights, title) => {
    const flights = Array.isArray(sourceFlights) ? sourceFlights : []
    const flightNumbers = new Set(
      flights
        .map((flight) => String(flight?.flightNumber ?? '').trim())
        .filter(Boolean),
    )
    const meteorologistRequestsCount = meteorologistChatLog.filter((item) => {
      if (item?.direction !== 'incoming' || item?.messageType !== 'dispatcher_request') return false
      const flightNumber = String(item?.flightNumber ?? '').trim()
      return flightNumber && flightNumbers.has(flightNumber)
    }).length
    const delayedCount = flights.filter((flight) => flight.dispatcherDecision === DISPATCHER_DECISION_DELAY).length
    const riskRows = FLIGHT_RISK_FILTERS
      .filter((item) => item.value !== 'ALL')
      .map((item) => [
        item.label,
        flights.filter((flight) => getRiskLevelFilterValue(flight?.totalRisk) === item.value).length,
      ])
    const aircraftRows = flights.map((flight) => {
      const fromAirport = allAirportsById[flight.fromAirportId]
      const toAirport = allAirportsById[flight.toAirportId]
      return [
        flight.flightNumber,
        getAircraftTypeLabel(flight.aircraftType),
        `${flight.fromAirportId} - ${flight.toAirportId}`,
        fromAirport ? getAirportDisplayName(fromAirport) : flight.fromAirportId,
        toAirport ? getAirportDisplayName(toAirport) : flight.toAirportId,
        formatDateTime(flight.departureAt),
        formatDateTime(getFlightArrivalForTable(flight)),
        flight.totalRisk ?? '',
        riskLevelLabel(flight.totalRisk ?? 0),
        decisionLabel(flight.dispatcherDecision),
      ]
    })

    const rows = [
      ['Аналитика', title],
      ['Сформировано', new Date().toLocaleString('ru-RU')],
      [],
      ['Показатель', 'Значение'],
      ['Всего рейсов', flights.length],
      ['Задержано рейсов', delayedCount],
      ['Запросов метеорологу', meteorologistRequestsCount],
      [],
      ['Распределение риска', 'Количество'],
      ...riskRows,
      [],
      ['Рейс', 'Тип', 'Маршрут', 'Пункт вылета', 'Пункт прилета', 'Вылет', 'Прилет', 'Риск', 'Уровень риска', 'Решение'],
      ...aircraftRows,
    ]
    const suffix = title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '') || 'analytics'
    downloadXlsx(`analytics-${suffix}.xlsx`, rows)
  }, [allAirportsById, getFlightArrivalForTable, meteorologistChatLog])

  const exportAnalytics = useCallback((scope) => {
    if (scope === TRANSPORT_MODE_AIRPLANE) {
      buildAnalyticsCsvForFlights(
        allFlights.filter((flight) => (flight.aircraftType || TRANSPORT_MODE_AIRPLANE) === TRANSPORT_MODE_AIRPLANE),
        'Самолеты',
      )
      return
    }
    if (scope === TRANSPORT_MODE_HELICOPTER) {
      buildAnalyticsCsvForFlights(
        allFlights.filter((flight) => flight.aircraftType === TRANSPORT_MODE_HELICOPTER),
        'Вертолеты',
      )
      return
    }
  }, [allFlights, buildAnalyticsCsvForFlights])

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

  const pushNotification = useCallback((type, title, message, key = `${type}:${title}:${message}`, action = null) => {
    const now = Date.now()
    const mutedUntil = notificationMutedUntilRef.current[key] ?? 0
    if (mutedUntil > now) return

    const lastShownAt = notificationLastShownAtRef.current[key] ?? 0
    if (now - lastShownAt < 15000) return
    notificationLastShownAtRef.current[key] = now

    const id = `${type}-${now}-${Math.random().toString(16).slice(2)}`
    setNotifications((prev) => {
      const withoutSameKey = prev.filter((item) => item.key !== key)
      return [
        { id, key, type, title, message, action, createdAt: new Date().toISOString() },
        ...withoutSameKey,
      ].slice(0, 4)
    })

    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id))
    }, 9000)
  }, [])

  const dismissNotification = useCallback((id, key) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id))
    if (key) {
      notificationMutedUntilRef.current[key] = Date.now() + 30000
    }
  }, [])

  const switchDispatcherTab = useCallback((nextTab) => {
    const safeTab = nextTab === 'flights' || nextTab === 'analytics' ? nextTab : 'monitoring'
    setActiveTab(safeTab)
    onTabUrlChange?.(safeTab)
  }, [onTabUrlChange])

  useEffect(() => {
    if (!dispatcherNotice) return
    pushNotification(
      dispatcherNotice.type || 'success',
      dispatcherNotice.title || 'Готово',
      dispatcherNotice.message || '',
      `dispatcher-notice-${dispatcherNotice.title || 'notice'}-${dispatcherNotice.message || ''}`,
    )
    onDispatcherNoticeShown?.()
  }, [dispatcherNotice, onDispatcherNoticeShown, pushNotification])

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
        setAirportCatalog(mergeAirportCatalog(LOCAL_AIRFIELD_CATALOG, airports))
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

  const applyMeteorologistChatLog = useCallback((nextLog) => {
    const safeLog = Array.isArray(nextLog) ? nextLog : []
    setMeteorologistChatLog(safeLog)
    const newResponses = readNewMeteorologistResponsesForDispatcher(safeLog)
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
      responseComplete: newestResponse.requestSnapshot?.responseComplete !== false,
      emptyFieldsCount: Number(newestResponse.requestSnapshot?.emptyFieldsCount ?? 0),
    })

    // Обновляем метеоданные активного рейса если это его ответ
    if (activeFlight && newestResponse.requestSnapshot?.form?.flightNumber === activeFlight.flightNumber) {
      setActiveFlightMeteoData({
        responseComplete: newestResponse.requestSnapshot?.responseComplete,
        responseByNeed: newestResponse.requestSnapshot?.responseByNeed,
        needs: newestResponse.requestSnapshot?.needs,
      })
    }
  }, [activeFlight])

  const checkMeteorologistUpdates = useCallback(async () => {
    try {
      const nextLog = await fetchMeteorologistChatLog()
      applyMeteorologistChatLog(nextLog)
    } catch (cause) {
      parseBackendFailure(cause, 'Не удалось загрузить запросы метеорологу из базы данных.')
    }
  }, [applyMeteorologistChatLog, parseBackendFailure])

  const refreshFlightsFromBackend = useCallback(async () => {
    const flights = await fetchAllFlights()
    setFlightsError('')
    deactivateRecoveryMode()
    setAllFlights((prev) =>
      hydrateFlightsWithRiskTimestamps(
        Array.isArray(flights) ? flights : [],
        prev,
        new Date().toISOString(),
      ),
    )
  }, [deactivateRecoveryMode])

  useEffect(() => {
    void checkMeteorologistUpdates()

    const removeListener = addAppUpdateListener((event) => {
      if (!event?.type || event.type === 'CONNECTED') return

      if (event.type.startsWith('METEOROLOGIST_')) {
        void checkMeteorologistUpdates()
      }

      if (event.type.startsWith('FLIGHT_') || event.type.startsWith('METEOROLOGIST_')) {
        void refreshFlightsFromBackend().catch((cause) => {
          parseBackendFailure(cause, 'Не удалось обновить рейсы по WebSocket-событию.')
        })
      }
    })

    return removeListener
  }, [checkMeteorologistUpdates, parseBackendFailure, refreshFlightsFromBackend])

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

    airportLayerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)
    planeLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
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
      if (!airportId) {
        setError('Выберите аэропорт, чтобы посмотреть погоду.')
        return
      }

      const airport = airportsById[airportId]
      if (!airport) {
        setError('Аэропорт не найден. Пожалуйста, выберите значение из списка.')
        return
      }

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
    [airportsById, ensureWeather, parseBackendFailure],
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
        const totalRisk = calculateTotalRisk(departureRisk, arrivalRisk, cruiseRisk)
        const baseRisk = {
          total: totalRisk,
          departure: departureRisk,
          arrival: arrivalRisk,
          cruise: cruiseRisk,
          feasibility: getFeasibility(totalRisk),
        }

        setPreviewRisk(applyDepartureTimeRisk(baseRisk, form.departureAt))
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
      const lat = Number(airport?.lat)
      const lon = Number(airport?.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

      const weather = weatherByAirport[airport.id]?.data
      const wind = weather ? `${Math.round(safeNumber(weather.wind?.speed, 0))} м/с` : 'нет данных'
      const visibility = weather ? `${(safeNumber(weather.visibility, 0) / 1000).toFixed(1)} км` : 'нет данных'
      const surfaceRisk = weather ? Math.round(evaluateSurfaceRisk(weather).score) : null
      const riskLevel = surfaceRisk == null
        ? 'NO DATA'
        : surfaceRisk > 75
        ? 'HIGH'
        : surfaceRisk > 55
        ? 'MEDIUM'
        : 'LOW'
      const hoverDetails = `
        <div>
          <div><strong>${getAirportDisplayName(airport)}</strong></div>
          <div>Ветер: ${wind}</div>
          <div>Видимость: ${visibility}</div>
          <div>Риск: ${riskLevel}</div>
        </div>
      `

      const marker = L.marker([lat, lon], {
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
        .bindPopup(hoverDetails, {
          closeButton: false,
          autoClose: false,
          className: `route-endpoint-tooltip route-endpoint-tooltip--${role}`,
          offset: [0, -8],
        })
        .on('mouseover', () => marker.openPopup())
        .on('mouseout', () => marker.closePopup())
        .bindTooltip(`${label}: ${getAirportDisplayName(airport)}`, {
          direction: 'top',
          permanent: true,
          offset: [0, -26],
          className: `route-endpoint-tooltip route-endpoint-tooltip--${role}`,
        })
        .addTo(layer)
    })
  }, [activeRoute, openAirportWeather, weatherByAirport])



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

    const projectedPosition = getProjectedPathPosition(mapRef.current, orthodromePath, progress)
    if (!projectedPosition) return
    const markerHtml = activeFlight.aircraftType === TRANSPORT_MODE_HELICOPTER
      ? HELICOPTER_ICON_HTML
      : PLANE_ICON_HTML

    const marker = L.marker(projectedPosition.latLng, {
      interactive: false,
      icon: L.divIcon({
        className: 'plane-marker',
        html: markerHtml,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
      zIndexOffset: 1200,
    }).addTo(layer)

    const markerInner = marker.getElement()?.querySelector('.plane-marker-inner')
    if (markerInner) {
      markerInner.style.transform = `rotate(${projectedPosition.heading}deg)`
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
      const totalRisk = calculateTotalRisk(departureRisk, arrivalRisk, cruiseRisk)
      const scenarioAdjustedRisk = applyEmergencyScenarioToRisk(
        {
          departure: departureRisk,
          arrival: arrivalRisk,
          cruise: cruiseRisk,
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

      const nowIso = new Date().toISOString()
      const hydratedSavedFlight = withRiskTimestamp(savedFlight, mapFlightsById(allFlights), nowIso)
      setAllFlights((prev) => {
        const hydratedSaved = withRiskTimestamp(savedFlight, mapFlightsById(prev), nowIso)
        return [hydratedSaved, ...prev.filter((flight) => flight.id !== savedFlight.id)]
      })
      setActiveFlight(hydratedSavedFlight)
      setSelectedWeatherAirportId(savedFlight.fromAirportId)
      setForm(createInitialForm(Date.now(), transportMode))
      setPreviewRisk(null)
      setError('')
      setActiveTab('monitoring')
      pushNotification(
        'success',
        'Рейс успешно создан',
        `${savedFlight.flightNumber}: ${savedFlight.fromAirportId} - ${savedFlight.toAirportId}.`,
        `flight-created-${savedFlight.id}`,
        {
          type: 'open-flight',
          flightId: savedFlight.id,
          aircraftType: savedFlight.aircraftType || transportMode,
        },
      )
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
    Promise.all([
      flight.fromAirportId ? ensureWeather(flight.fromAirportId) : Promise.resolve(null),
      flight.toAirportId ? ensureWeather(flight.toAirportId) : Promise.resolve(null),
    ]).catch(() => {
      // Weather errors are surfaced by the monitoring widgets; keep route navigation usable.
    })
  }, [ensureWeather])

  const handleNotificationClick = useCallback((notification) => {
    if (notification?.action?.type !== 'open-flight') return
    const flight = allFlights.find((item) => item.id === notification.action.flightId)
    if (!flight) {
      if (notification.action.aircraftType) setTransportMode(notification.action.aircraftType)
      setFlightFilters(DEFAULT_FLIGHT_FILTERS)
      setFlightAirportFilterInput('')
      setHighlightedFlightId(notification.action.flightId || '')
      switchDispatcherTab('flights')
      dismissNotification(notification.id, notification.key)
      return
    }
    setTransportMode(flight.aircraftType || notification.action.aircraftType || TRANSPORT_MODE_AIRPLANE)
    setActiveFlight(flight)
    setSelectedWeatherAirportId(flight.fromAirportId)
    setFlightFilters(DEFAULT_FLIGHT_FILTERS)
    setFlightAirportFilterInput('')
    setHighlightedFlightId(flight.id)
    switchDispatcherTab('flights')
    dismissNotification(notification.id, notification.key)
  }, [allFlights, dismissNotification, switchDispatcherTab])

  const openHistoryModal = useCallback((flight) => {
    if (!flight?.id) return
    setHistoryFlight(flight)
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
        if (historyFlight?.id === flightId) {
          const history = await fetchFlightHistory(flightId)
          setHistoryModalItems(Array.isArray(history) ? history : [])
        }
      } catch (cause) {
        const failure = parseBackendFailure(cause, 'Не удалось обновить риск по рейсу.')
        setFlightActionError(
          failure.message,
        )
      } finally {
        setFlightActionPending(flightId, 'refresh', false)
      }
    },
    [deactivateRecoveryMode, historyFlight?.id, parseBackendFailure, setFlightActionPending, updateFlightInState],
  )

  const handleRefreshAllRisks = useCallback(async () => {
    setFlightActionError('')
    setIsRefreshingAllRisks(true)

    try {
      const refreshedFlights = await refreshAllFlightRisksApi()
      deactivateRecoveryMode()
      const safeFlights = Array.isArray(refreshedFlights) ? refreshedFlights : []
      const refreshedById = mapFlightsById(safeFlights)
      const nowIso = new Date().toISOString()

      setAllFlights((prev) => {
        const knownById = mapFlightsById(prev)
        return prev.map((flight) => {
          const refreshed = refreshedById[flight.id]
          return refreshed ? withRiskTimestamp(refreshed, knownById, nowIso) : flight
        })
      })
      setActiveFlight((prev) => {
        if (!prev?.id || !refreshedById[prev.id]) return prev
        return withRiskTimestamp(refreshedById[prev.id], { [prev.id]: prev }, nowIso)
      })
      if (historyFlight?.id && refreshedById[historyFlight.id]) {
        const history = await fetchFlightHistory(historyFlight.id)
        setHistoryModalItems(Array.isArray(history) ? history : [])
      }
      pushNotification(
        'success',
        'Риски обновлены',
        safeFlights.length > 0
          ? `Пересчитано рейсов: ${safeFlights.length}. История обновлений записана.`
          : 'Нет активных рейсов, которым требуется пересчет.',
        'refresh-all-risks',
      )
    } catch (cause) {
      const failure = parseBackendFailure(cause, 'Не удалось обновить риски по всем рейсам.')
      setFlightActionError(failure.message)
    } finally {
      setIsRefreshingAllRisks(false)
    }
  }, [deactivateRecoveryMode, historyFlight?.id, parseBackendFailure, pushNotification])

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
      if (historyFlight?.id === decisionFlight.id) {
        const history = await fetchFlightHistory(decisionFlight.id)
        setHistoryModalItems(Array.isArray(history) ? history : [])
      }
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
    historyFlight?.id,
    parseBackendFailure,
    setFlightActionPending,
    updateFlightInState,
  ])

  const printFlightReport = useCallback(async (flight) => {
    if (!flight?.id) return

    const fromAirport = allAirportsById[flight.fromAirportId]
    const toAirport = allAirportsById[flight.toAirportId]
    const arrivalAt = getFlightArrivalForTable(flight)
    const generatedAt = new Date()
    const depFactors = Array.isArray(flight?.departureRisk?.factors) ? flight.departureRisk.factors : []
    const arrFactors = Array.isArray(flight?.arrivalRisk?.factors) ? flight.arrivalRisk.factors : []
    const cruiseFactors = Array.isArray(flight?.cruiseRisk?.factors) ? flight.cruiseRisk.factors : []
    let historyItems = []
    try {
      const history = await fetchFlightHistory(flight.id)
      historyItems = Array.isArray(history) ? history : []
    } catch {
      historyItems = []
    }
    const historyRows = historyItems.length
      ? historyItems.map((item) => `
        <tr>
          <td>${escapeHtml(formatDateTime(item.changedAt))}</td>
          <td>${escapeHtml(getRiskChangeReason(item))}</td>
          <td>${escapeHtml(item.oldTotalRisk == null ? 'нет' : `${item.oldTotalRisk}/100`)}</td>
          <td>${escapeHtml(item.newTotalRisk == null ? 'нет' : `${item.newTotalRisk}/100`)}</td>
          <td>${escapeHtml(decisionLabel(item.dispatcherDecision))}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5">История пока пуста.</td></tr>'

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
    .history-table th {
      width: auto;
      text-align: left;
    }
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

    <section class="section">
      <h2>5. История рейса</h2>
      <table class="history-table">
        <thead>
          <tr>
            <th>Дата и время</th>
            <th>Событие</th>
            <th>Старый риск</th>
            <th>Новый риск</th>
            <th>Решение</th>
          </tr>
        </thead>
        <tbody>
          ${historyRows}
        </tbody>
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

  useEffect(() => {
    if (!highlightedFlightId || activeTab !== 'flights') return undefined
    const timer = window.setTimeout(() => setHighlightedFlightId(''), 3000)
    return () => window.clearTimeout(timer)
  }, [activeTab, highlightedFlightId])

  const displayedRisk = activeRisk ?? previewRisk
  const adjustedDisplayedRisk = useMemo(
    () => applyMeteoDataRiskAdjustment(displayedRisk, activeFlightMeteoData),
    [displayedRisk, activeFlightMeteoData],
  )
  const effectiveRisk = useMemo(
    () => safeApplyEmergencyRisk(adjustedDisplayedRisk, emergencyScenario),
    [adjustedDisplayedRisk, emergencyScenario],
  )

  // Очищаем метеоданные когда меняется активный рейс
  useEffect(() => {
    if (!activeFlight) {
      setActiveFlightMeteoData(null)
    }
  }, [activeFlight])

  useEffect(() => {
    if (!activeFlight?.id) {
      setActiveFlightHistory([])
      setActiveFlightHistoryError('')
      setIsActiveFlightHistoryLoading(false)
      return undefined
    }

    let cancelled = false
    setIsActiveFlightHistoryLoading(true)
    setActiveFlightHistoryError('')

    fetchFlightHistory(activeFlight.id)
      .then((history) => {
        if (!cancelled) setActiveFlightHistory(Array.isArray(history) ? history : [])
      })
      .catch((cause) => {
        if (cancelled) return
        const failure = parseBackendFailure(cause, 'Не удалось загрузить историю пересчетов риска.')
        setActiveFlightHistory([])
        setActiveFlightHistoryError(failure.message)
      })
      .finally(() => {
        if (!cancelled) setIsActiveFlightHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeFlight?.id, parseBackendFailure])

  useEffect(() => {
    if (!historyFlight?.id) {
      setHistoryModalItems([])
      setHistoryModalError('')
      setIsHistoryModalLoading(false)
      return undefined
    }

    let cancelled = false
    setIsHistoryModalLoading(true)
    setHistoryModalError('')

    fetchFlightHistory(historyFlight.id)
      .then((history) => {
        if (!cancelled) setHistoryModalItems(Array.isArray(history) ? history : [])
      })
      .catch((cause) => {
        if (cancelled) return
        const failure = parseBackendFailure(cause, 'Не удалось загрузить историю рейса.')
        setHistoryModalItems([])
        setHistoryModalError(failure.message)
      })
      .finally(() => {
        if (!cancelled) setIsHistoryModalLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [historyFlight?.id, parseBackendFailure])

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
  const baseSystemRecommendations = useMemo(
    () =>
      safeBuildRecommendations({
        risk: effectiveRisk,
        emergencyScenario,
        selectedStormWarning,
        needsMeteoRequest,
      }),
    [effectiveRisk, emergencyScenario, needsMeteoRequest, selectedStormWarning],
  )
  const automaticRecommendationCode = useMemo(
    () => getAutomaticRecommendationCode(effectiveRisk?.total),
    [effectiveRisk?.total],
  )
  const systemRecommendations = useMemo(
    () => prioritizeRecommendation(baseSystemRecommendations, automaticRecommendationCode),
    [automaticRecommendationCode, baseSystemRecommendations],
  )
  const riskForecast = useMemo(() => {
    return buildRiskForecast(effectiveRisk, selectedWeather)
  }, [effectiveRisk, selectedWeather])
  const activeFlightMeteoResponse = activeFlight?.flightNumber
    ? meteoResponseByFlightNumber[activeFlight.flightNumber]
    : null

  useEffect(() => {
    if (!effectiveRisk || systemRecommendations.length === 0) return

    const currentTop = systemRecommendations[0]
    const currentCategory = getRecommendationCategory(currentTop.code)
    const previousCategory = previousRecommendationRef.current?.category
    const previousRisk = previousRiskRef.current
    const currentRisk = safeNumber(effectiveRisk.total)
    const riskRaised = previousRisk != null && currentRisk >= previousRisk + 5

    if (riskRaised) {
      pushNotification(
        'risk',
        'Риск повышен',
        `Итоговый риск вырос с ${previousRisk}/100 до ${currentRisk}/100.`,
        `risk-up-${activeFlight?.id ?? 'preview'}`,
      )
    }

    const approveToDelay = previousCategory === 'APPROVE' && currentCategory === 'DELAY'
    const delayToCancel = previousCategory === 'DELAY' && currentCategory === 'CANCEL'
    if (riskRaised && (approveToDelay || delayToCancel)) {
      const notice = {
        from: previousRecommendationRef.current.title,
        to: currentTop.title,
        createdAt: new Date().toISOString(),
      }
      setAutoRecommendationNotice(notice)
      pushNotification(
        'recommendation',
        'Рекомендация изменена автоматически',
        `${notice.from} → ${notice.to}`,
        `recommendation-change-${activeFlight?.id ?? 'preview'}`,
      )
    }

    previousRecommendationRef.current = {
      code: currentTop.code,
      title: currentTop.title,
      category: currentCategory,
    }
    previousRiskRef.current = currentRisk
  }, [activeFlight?.id, effectiveRisk, pushNotification, systemRecommendations])

  useEffect(() => {
    const activeFlights = filteredFlights.filter((flight) => !isFlightCompleted(flight, getFlightArrivalForTable(flight), timeTick))
    const staleFlight = activeFlights.find((flight) => needsUrgentWeatherUpdate(flight, timeTick))
    if (staleFlight) {
      pushNotification(
        'stale',
        'Данные устарели',
        `Рейс ${staleFlight.flightNumber}: до вылета меньше 3 часов, нужен свежий расчет.`,
        `stale-${staleFlight.id}`,
      )
    }

    const decisionRequired = activeFlights.find((flight) => {
      const decision = flight?.dispatcherDecision ?? DISPATCHER_DECISION_PENDING
      const risk = asNumberOrNull(flight?.totalRisk)
      return decision === DISPATCHER_DECISION_PENDING && risk != null && risk > 55
    })
    if (decisionRequired) {
      pushNotification(
        'decision',
        'Требуется решение диспетчера',
        `Рейс ${decisionRequired.flightNumber}: риск ${decisionRequired.totalRisk}/100.`,
        `decision-${decisionRequired.id}`,
      )
    }
  }, [filteredFlights, getFlightArrivalForTable, pushNotification, timeTick])

  useEffect(() => {
    visibleFlights.forEach((flight) => {
      if (!flight?.id) return
      const isUrgentMissing = hasUrgentMissingRiskData(flight, timeTick) || needsUrgentWeatherUpdate(flight, timeTick)
      if (!isUrgentMissing) return

      const flightNumber = String(flight?.flightNumber ?? '').trim()
      if (!flightNumber) return
      if (pendingMeteoByFlightNumber[flightNumber]) return
      if (urgentMeteoRequestedFlightsRef.current.has(flight.id)) return

      const requestPayload = {
        id: `auto-urgent-${flight.id}-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: 'new',
        dispatcherName: 'Диспетчер рейсов',
        form: {
          flightNumber,
          fromAirportId: flight.fromAirportId ?? '',
          toAirportId: flight.toAirportId ?? '',
          etd: toDateTimeLocalValue(flight.departureAt),
          eta: toDateTimeLocalValue(getFlightArrivalForTable(flight)),
          dispatcherComment: 'Автоматический срочный запрос: до вылета менее 3 часов.',
        },
        needs: DEFAULT_METEOROLOGIST_NEEDS,
        requestText: 'Автоматический срочный запрос метеоданных',
        dataComplete: false,
      }

      void saveActiveMeteorologistRequestToBackend(requestPayload)
        .then(() => checkMeteorologistUpdates())
        .catch((cause) => {
          parseBackendFailure(cause, 'Не удалось сохранить срочный запрос метеорологу в базе данных.')
          urgentMeteoRequestedFlightsRef.current.delete(flight.id)
        })
      urgentMeteoRequestedFlightsRef.current.add(flight.id)
      pushNotification(
        'urgent-meteo',
        'Срочный запрос метеорологу',
        `Рейс ${flightNumber}: до вылета менее 3 часов, отправлен автоматический запрос.`,
        `urgent-meteo-${flight.id}`,
      )
    })
  }, [checkMeteorologistUpdates, getFlightArrivalForTable, parseBackendFailure, pendingMeteoByFlightNumber, pushNotification, timeTick, visibleFlights])
  return (
    <Stack className="dispatcher-app" gap="md">
      {notifications.length > 0 && (
        <Stack gap="xs" className="notification-stack">
          {notifications.map((item) => (
            <Alert
              key={item.id}
              className={item.action ? 'notification-alert notification-alert--clickable' : 'notification-alert'}
              color={
                item.type === 'api'
                  ? 'red'
                  : item.type === 'risk' || item.type === 'recommendation'
                  ? 'orange'
                  : item.type === 'decision'
                  ? 'yellow'
                  : 'blue'
              }
              radius="md"
              icon={<IconAlertTriangle size={16} />}
              withCloseButton
              onClose={(event) => {
                event?.stopPropagation?.()
                dismissNotification(item.id, item.key)
              }}
              onClick={() => handleNotificationClick(item)}
              title={item.title}
            >
              <Text size="sm">{item.message}</Text>
            </Alert>
          ))}
        </Stack>
      )}

      <Paper withBorder radius="xl" p="md" className="surface-card surface-card--tabs">
        <Stack gap="sm">
          <Group justify="space-between" gap="md" wrap="wrap">
            <Title order={3}>Панель диспетчера</Title>
            <SegmentedControl
              radius="xl"
              size="md"
              value={activeTab}
              onChange={(nextTab) => {
                switchDispatcherTab(nextTab)
              }}
              data={[
                { value: 'monitoring', label: 'Мониторинг' },
                { value: 'flights', label: 'Рейсы' },
                { value: 'analytics', label: 'Аналитика' },
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
            {!meteorologistUpdateNotice.responseComplete && (
              <Text size="sm" c="red">
                Метеоролог отправил неполные данные{meteorologistUpdateNotice.emptyFieldsCount > 0 ? ` (${meteorologistUpdateNotice.emptyFieldsCount} незаполн.)` : ''}.
              </Text>
            )}
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
                  const flight = allFlights.find((item) => item.flightNumber === meteorologistUpdateNotice.flightNumber)
                  if (flight?.aircraftType) {
                    setTransportMode(flight.aircraftType)
                  }
                  setFlightFilters(DEFAULT_FLIGHT_FILTERS)
                  setFlightAirportFilterInput('')
                  switchDispatcherTab('flights')
                  if (flight?.id) {
                    setActiveFlight(flight)
                    setSelectedWeatherAirportId(flight.fromAirportId)
                    setHighlightedFlightId(flight.id)
                  }
                  setMeteorologistUpdateNotice(null)
                }}
              >
                Перейти к рейсам
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}

      {activeFlightMeteoData && !activeFlightMeteoData.responseComplete && (
        <Alert
          color="orange"
          radius="md"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title="Неполные метеоданные"
          withCloseButton
          onClose={() => setActiveFlightMeteoData(null)}
        >
          <Stack gap={4}>
            <Text size="sm">
              Метеоролог заполнил не все требуемые данные. Риск рассчитывается с повышенным коэффициентом для безопасности.
            </Text>
            <Text size="xs" c="dimmed">
              Решение о полете принимается за диспетчером с учетом неполной информации.
            </Text>
          </Stack>
        </Alert>
      )}

      {activeTab === 'monitoring' && activeFlight && activeFlightMeteoResponse && (
        <Alert
          color="teal"
          radius="md"
          variant="light"
          icon={<IconMessageCircle size={18} />}
          title="Есть ответ метеоролога"
        >
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="sm">
              По рейсу <strong>{activeFlight.flightNumber}</strong> доступен ответ метеоролога.
            </Text>
            <Button
              size="xs"
              radius="xl"
              variant="light"
              onClick={() => setMeteoResponseFlight(activeFlight)}
            >
              Посмотреть ответ
            </Button>
          </Group>
        </Alert>
      )}

      {activeTab === 'monitoring' && isFallbackWeather && selectedWeatherAirport && (
        <Alert
          color="yellow"
          radius="md"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title="Используется резервный источник погоды"
        >
          <Text size="sm">
            Для точки <strong>{selectedWeatherAirport.id}</strong> параметры рассчитаны по резервной модели,
            потому что основной погодный backend сейчас недоступен.
          </Text>
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
                  </Group>

                  {effectiveRisk ? (
                    <Group spacing="xs" wrap="wrap" style={{ marginBottom: 8 }}>
                      <Badge color={getRiskBadgeColor(effectiveRisk.total)} variant="filled">
                        Итого {formatRiskBadgeScore(effectiveRisk.total)}
                      </Badge>
                      <Badge color={getRiskBadgeColor(effectiveRisk.departure?.score)} variant="outline">
                        Взлет {formatRiskBadgeScore(effectiveRisk.departure?.score)}
                      </Badge>
                      <Badge color={getRiskBadgeColor(effectiveRisk.arrival?.score)} variant="outline">
                        Посадка {formatRiskBadgeScore(effectiveRisk.arrival?.score)}
                      </Badge>
                      <Badge color={getRiskBadgeColor(effectiveRisk.cruise?.score)} variant="outline">
                        Маршрут {formatRiskBadgeScore(effectiveRisk.cruise?.score)}
                      </Badge>
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Маркеры риска появятся после выбора маршрута и времени вылета.
                    </Text>
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
                      disabled={!hasValidFromCity}
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
                      <option value="">
                        {!hasValidFromCity
                          ? 'Сначала выберите город'
                          : isHelicopterMode ? 'Выберите площадку' : 'Выберите аэропорт'}
                      </option>
                      {fromAirportOptions.map((airport) => (
                        <option key={airport.id} value={airport.id}>
                          {isHelicopterMode
                            ? `${String(airport.name || airport.city || airport.id)} (${String(airport.city || 'без города')})`
                            : getAirportDisplayName(airport)}
                        </option>
                      ))}
                    </NativeSelect>

                    <NativeSelect
                      label={isHelicopterMode ? 'Площадка назначения' : 'Аэропорт назначения'}
                      value={form.toAirportId}
                      disabled={!hasValidToCity}
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
                      <option value="">
                        {!hasValidToCity
                          ? 'Сначала выберите город'
                          : isHelicopterMode ? 'Выберите площадку' : 'Выберите аэропорт'}
                      </option>
                      {toAirportOptions.map((airport) => (
                        <option key={airport.id} value={airport.id}>
                          {isHelicopterMode
                            ? `${String(airport.name || airport.city || airport.id)} (${String(airport.city || 'без города')})`
                            : getAirportDisplayName(airport)}
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
                        const rawDepartureAt = event.target.value
                        const departureDate = parseDateTime(rawDepartureAt)
                        const minDepartureDate = parseDateTime(minDepartureAt)
                        const departureAt =
                          departureDate && minDepartureDate && departureDate.getTime() < minDepartureDate.getTime()
                            ? minDepartureAt
                            : rawDepartureAt
                        setActiveFlight(null)
                        setForm((prev) => ({ ...prev, departureAt }))
                        if (departureAt !== rawDepartureAt) {
                          setError('Нельзя выбрать прошедшую дату и время вылета.')
                        } else if (error === 'Нельзя выбрать прошедшую дату и время вылета.') {
                          setError('')
                        }
                      }}
                    />

                    {!isHelicopterMode && (
                      <NativeSelect
                        label="Код авиакомпании (IATA)"
                        value={form.airlineCode}
                        onChange={(event) => {
                          const airlineCode = event.target.value.toUpperCase()
                          setForm((prev) => ({ ...prev, airlineCode }))
                        }}
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

                    <Group position="apart" align="center" style={{ width: '100%' }}>
                      <Text size="sm" fw={500}>
                        Демонстрационный сценарий ЧС
                      </Text>
                      <Switch
                        checked={emergencyScenario.active}
                        onChange={(event) => {
                          const isActive = event.currentTarget.checked
                          setEmergencyScenario((prev) => ({ ...prev, active: isActive }))
                        }}
                      />
                    </Group>

                    {emergencyScenario.active && (
                      <>
                        <NativeSelect
                          label="Тип сценария ЧС"
                          value={emergencyScenario.type}
                          onChange={(event) => {
                            const type = event.target.value
                            setEmergencyScenario((prev) => ({ ...prev, type }))
                          }}
                        >
                          <option value="RUNWAY_RESTRICTION">Ограничение ВПП/площадки</option>
                          <option value="THUNDERSTORM_FRONT">Грозовой фронт</option>
                          <option value="LOW_VISIBILITY_EVENT">Резкое ухудшение видимости</option>
                          <option value="AIRSPACE_RESTRICTION">Ограничение воздушного пространства</option>
                          <option value="ATC_CAPACITY">Перегрузка сектора</option>
                          <option value="EMERGENCY">Чрезвычайная ситуация</option>
                        </NativeSelect>

                        <NativeSelect
                          label="Уровень сценария"
                          value={emergencyScenario.level}
                          onChange={(event) => {
                            const level = event.target.value
                            setEmergencyScenario((prev) => ({ ...prev, level }))
                          }}
                        >
                          <option value="LOW">Низкий</option>
                          <option value="MEDIUM">Средний</option>
                          <option value="HIGH">Высокий</option>
                        </NativeSelect>

                        <Textarea
                          label="Комментарий к сценарию"
                          placeholder="Дополнительная информация для диспетчера"
                          value={emergencyScenario.comment}
                          onChange={(event) => {
                            const comment = event.target.value
                            setEmergencyScenario((prev) => ({ ...prev, comment }))
                          }}
                          minRows={2}
                        />
                      </>
                    )}
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
                      {autoRecommendationNotice && (
                        <Alert
                          color="orange"
                          radius="md"
                          variant="light"
                          icon={<IconAlertTriangle size={16} />}
                          withCloseButton
                          onClose={() => setAutoRecommendationNotice(null)}
                          title="Рекомендация изменена автоматически"
                        >
                          {autoRecommendationNotice.from} → {autoRecommendationNotice.to}
                        </Alert>
                      )}
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
                              {formatRiskBadgeScore(effectiveRisk.departure.score)} ({riskLevelLabel(effectiveRisk.departure.score)})
                            </Text>
                          </Group>
                          <Progress value={getDisplayProgressValue(effectiveRisk.departure.score)} color={getRiskColor(effectiveRisk.departure.score)} />

                          <Group justify="space-between">
                            <Text size="sm">Посадка</Text>
                            <Text size="sm" fw={600}>
                              {formatRiskBadgeScore(effectiveRisk.arrival.score)} ({riskLevelLabel(effectiveRisk.arrival.score)})
                            </Text>
                          </Group>
                          <Progress value={getDisplayProgressValue(effectiveRisk.arrival.score)} color={getRiskColor(effectiveRisk.arrival.score)} />

                          <Group justify="space-between">
                            <Text size="sm">{isHelicopterMode ? 'Маршрут' : 'Эшелон ~12 км'}</Text>
                            <Text size="sm" fw={600}>
                              {formatRiskBadgeScore(effectiveRisk.cruise.score)} ({riskLevelLabel(effectiveRisk.cruise.score)})
                            </Text>
                          </Group>
                          <Progress value={getDisplayProgressValue(effectiveRisk.cruise.score)} color={getRiskColor(effectiveRisk.cruise.score)} />

                          <Divider />
                          <Group justify="space-between">
                            <Text fw={700}>Итоговый риск</Text>
                            <Text fw={700}>
                              {formatRiskBadgeScore(effectiveRisk.total)} ({riskLevelLabel(effectiveRisk.total)})
                            </Text>
                          </Group>
                          <Progress value={getDisplayProgressValue(effectiveRisk.total)} color={getRiskColor(effectiveRisk.total)} size="lg" radius="xl" />

                          {riskForecast && (
                            <Alert
                              color={riskForecast.value > effectiveRisk.total ? 'yellow' : 'teal'}
                              radius="md"
                              variant="light"
                              icon={<IconAlertTriangle size={16} />}
                              title="Прогноз изменения риска"
                            >
                              <Stack gap={3}>
                                <Text size="sm">{riskForecast.text}</Text>
                                <Text size="xs" c="dimmed">
                                  Прогноз учитывает текущий ветер, видимость и осадки.
                                </Text>
                              </Stack>
                            </Alert>
                          )}

                          <Divider />
                          <Stack gap={6}>
                            <Text fw={700}>Причины риска</Text>
                            {(activeFlight
                              ? collectRiskReasons(activeFlight, timeTick)
                              : [
                                  ...(effectiveRisk.departure?.factors ?? []),
                                  ...(effectiveRisk.arrival?.factors ?? []),
                                  ...(effectiveRisk.cruise?.factors ?? []),
                                ]
                            ).slice(0, 8).map((reason) => (
                              <Group key={reason} gap={6} wrap="nowrap">
                                <span className="risk-reason-dot" />
                                <Text size="sm">{reason}</Text>
                              </Group>
                            ))}
                          </Stack>

                          {activeFlight && (
                            <>
                              <Divider />
                              <Stack gap={6}>
                                <Group justify="space-between" align="center">
                                  <Text fw={700}>История пересчетов риска</Text>
                                  {isActiveFlightHistoryLoading && <Badge variant="light">загрузка</Badge>}
                                </Group>
                                {activeFlightHistoryError ? (
                                  <Text size="sm" c="red">{activeFlightHistoryError}</Text>
                                ) : activeFlightHistory.length === 0 ? (
                                  <Text size="sm" c="dimmed">История пока пуста.</Text>
                                ) : (
                                  activeFlightHistory.slice(0, 5).map((item) => (
                                    <Paper key={item.id} withBorder radius="md" p="xs" className="history-item">
                                      <Group justify="space-between" gap="xs" align="flex-start">
                                        <Text size="xs" c="dimmed">{formatDateTime(item.changedAt)}</Text>
                                        <Text size="sm" fw={700} className="history-risk-text">
                                          {item.oldTotalRisk == null ? 'нет' : formatRiskBadgeScore(item.oldTotalRisk)} → {item.newTotalRisk == null ? 'нет' : formatRiskBadgeScore(item.newTotalRisk)}
                                        </Text>
                                      </Group>
                                      <Text size="sm">{getRiskChangeReason(item)}</Text>
                                    </Paper>
                                  ))
                                )}
                              </Stack>
                            </>
                          )}
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
                label={`Показывать завершенные рейсы (${departedFlightsCount})`}
              />
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <Paper withBorder radius="md" p="sm" className="critical-tile critical-tile--risk">
                <Text size="xs" c="dimmed">Критические рейсы</Text>
                <Text fw={800} size="xl">{flightSummary.critical}</Text>
              </Paper>
              <Paper withBorder radius="md" p="sm" className="critical-tile critical-tile--data">
                <Text size="xs" c="dimmed">Ожидают данных</Text>
                <Text fw={800} size="xl">{flightSummary.awaitingData}</Text>
              </Paper>
              <Paper withBorder radius="md" p="sm" className="critical-tile critical-tile--delay">
                <Text size="xs" c="dimmed">Задержаны</Text>
                <Text fw={800} size="xl">{flightSummary.delayed}</Text>
              </Paper>
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
              <TextInput
                label="Поиск по рейсу"
                placeholder="Например: SU123"
                value={flightFilters.search}
                onChange={(event) => {
                  const search = event.target.value
                  setFlightFilters((prev) => ({ ...prev, search }))
                }}
              />
              <NativeSelect
                label="Уровень риска"
                value={flightFilters.risk}
                onChange={(event) => {
                  const risk = event.target.value
                  setFlightFilters((prev) => ({ ...prev, risk }))
                }}
              >
                {FLIGHT_RISK_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </NativeSelect>
              <NativeSelect
                label="Статус"
                value={flightFilters.status}
                onChange={(event) => {
                  const status = event.target.value
                  setFlightFilters((prev) => ({ ...prev, status }))
                }}
              >
                {FLIGHT_STATUS_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </NativeSelect>
              <Autocomplete
                label="Аэропорт"
                placeholder="Начните вводить аэропорт"
                data={flightAirportFilterData}
                value={flightAirportFilterInput}
                onChange={(value) => {
                  setFlightAirportFilterInput(value)
                  const option = flightAirportFilterOptions.find((item) => item.label === value)
                  if (option) {
                    setFlightFilters((prev) => ({ ...prev, airport: option.value }))
                  } else if (!value.trim()) {
                    setFlightFilters((prev) => ({ ...prev, airport: 'ALL' }))
                  }
                }}
                onOptionSubmit={(value) => {
                  const option = flightAirportFilterOptions.find((item) => item.label === value)
                  if (!option) return
                  setFlightAirportFilterInput(option.label)
                  setFlightFilters((prev) => ({ ...prev, airport: option.value }))
                }}
                onBlur={() => {
                  const option = flightAirportFilterOptions.find((item) => item.value === flightFilters.airport)
                  setFlightAirportFilterInput(option?.value === 'ALL' ? '' : option?.label ?? '')
                }}
                selectFirstOptionOnChange
                maxDropdownHeight={340}
                autoComplete="off"
              />
              <NativeSelect
                label="Время вылета"
                value={flightFilters.departureTime}
                onChange={(event) => {
                  const departureTime = event.target.value
                  setFlightFilters((prev) => ({ ...prev, departureTime }))
                }}
              >
                {DEPARTURE_TIME_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </NativeSelect>
            </SimpleGrid>
            <Group justify="flex-end">
              <Button
                variant="light"
                radius="xl"
                leftSection={<IconRefresh size={16} />}
                loading={isRefreshingAllRisks}
                onClick={handleRefreshAllRisks}
                disabled={isRecoveryMode}
              >
                Обновить все риски
              </Button>
              <Button
                variant="default"
                radius="xl"
                onClick={() => {
                  setFlightFilters(DEFAULT_FLIGHT_FILTERS)
                  setFlightAirportFilterInput('')
                }}
              >
                Сбросить фильтры
              </Button>
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
                Рейсов по текущим фильтрам нет.
              </Text>
            ) : (
              <>
                <Box className="flights-table-wrap">
                  <Table highlightOnHover stickyHeader withTableBorder>
                  <colgroup>
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '22%' }} />
                  </colgroup>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Рейс</Table.Th>
                      <Table.Th>Тип</Table.Th>
                      <Table.Th>Маршрут</Table.Th>
                      <Table.Th className="col-departure">Вылет</Table.Th>
                      <Table.Th className="col-arrival">Прилет</Table.Th>
                      <Table.Th className="col-risk">Риск</Table.Th>
                      <Table.Th className="col-decision">Решение</Table.Th>
                      <Table.Th className="col-actions">Действия</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleFlights.map((flight) => {
                      const estimatedArrivalAt = getFlightArrivalForTable(flight)
                      const completed = isFlightCompleted(flight, estimatedArrivalAt, timeTick)
                      const inProgress = isFlightInProgress(flight, estimatedArrivalAt, timeTick)
                      const riskScore = asNumberOrNull(flight.totalRisk)
                      const riskUpdatedAt =
                        flight?.riskUpdatedAt ?? flight?.cachedRiskUpdatedAt ?? flight?.createdAt ?? null
                      const actionState = flightActionById[flight.id] ?? {}
                      const isRefreshing = Boolean(actionState.refresh)
                      const isCancelling = Boolean(actionState.cancel)
                      const isDeciding = Boolean(actionState.decision)
                      const isActionPending = isRefreshing || isCancelling || isDeciding
                      const isBackendActionsBlocked = isRecoveryMode || isActionPending
                      const urgentMissingData = hasUrgentMissingRiskData(flight, timeTick)
                      const urgentStaleData = needsUrgentWeatherUpdate(flight, timeTick)
                      const nextRiskUpdateAt = completed ? null : getNextRiskUpdateAt(flight, timeTick)
                      const meteoResponse = meteoResponseByFlightNumber[flight.flightNumber]

                      return (
                        <Table.Tr
                          key={flight.id}
                          className={`flight-row${completed ? ' flight-row--departed' : ''}${urgentMissingData ? ' flight-row--urgent-missing' : ''}${urgentStaleData ? ' flight-row--urgent-stale' : ''}${highlightedFlightId === flight.id ? ' flight-row--highlighted' : ''}`}
                          onClick={() => {
                            openFlightFromList(flight)
                          }}
                        >
                          <Table.Td>{flight.flightNumber}</Table.Td>
                          <Table.Td className="flight-type-cell">
                            <Badge
                              variant="light"
                              color={flight.aircraftType === TRANSPORT_MODE_HELICOPTER ? 'grape' : 'blue'}
                            >
                              {flight.aircraftType === TRANSPORT_MODE_HELICOPTER ? 'Вертолет' : 'Самолет'}
                            </Badge>
                          </Table.Td>
                          <Table.Td className="flight-route-cell">
                            {flight.fromAirportId} - {flight.toAirportId}
                          </Table.Td>
                          <Table.Td className="flight-departure-cell col-departure">
                            <Stack gap={2}>
                              <Text size="sm">{formatDateTime(flight.departureAt)}</Text>
                              <Text size="xs" c="dimmed">
                                {formatFlightTimingStatus(flight, estimatedArrivalAt, timeTick)}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td className="col-arrival">{formatDateTime(estimatedArrivalAt)}</Table.Td>
                          <Table.Td className="col-risk">
                            <Stack gap={2}>
                              <Group gap={8} align="center">
                                <Badge
                                  variant="dot"
                                  color={getRiskColor(riskScore ?? 0)}
                                >
                                  {riskScore == null ? 'нет данных' : `${riskScore}/100`}
                                </Badge>
                              </Group>
                              <Text size="xs" c="dimmed" className="risk-meta-line">
                                {formatRiskUpdatedAgo(riskUpdatedAt, timeTick)}
                              </Text>
                              <Text size="xs" c="dimmed" className="risk-meta-line">
                                Следующее обновление: {nextRiskUpdateAt
                                  ? nextRiskUpdateAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                                  : 'не требуется'}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td className="col-decision">
                            <Stack gap={2}>
                              <Badge
                                variant="light"
                                color={inProgress ? 'blue' : completed ? 'grape' : decisionColor(flight.dispatcherDecision)}
                                className={!completed ? 'decision-badge-clickable' : ''}
                                onClick={(event) => {
                                  if (completed) return
                                  event.stopPropagation()
                                  openDecisionModal(flight)
                                }}
                              >
                                {inProgress ? 'В пути' : completed ? 'Завершен' : decisionLabel(flight.dispatcherDecision)}
                              </Badge>
                              {flight.dispatcherDecisionDelayMinutes ? (
                                <Text size="xs" c="dimmed">
                                  задержка: {flight.dispatcherDecisionDelayMinutes} мин
                                </Text>
                              ) : null}
                              {flight.dispatcherDecisionReason ? (
                                <Text size="xs" c="dimmed">
                                  {flight.dispatcherDecisionReason}
                                </Text>
                              ) : null}
                            </Stack>
                          </Table.Td>
                          <Table.Td className="flight-actions-cell col-actions">
                            <div className={`flight-actions-wrap${!completed ? ' flight-actions-wrap--with-icons' : ''}`}>
                              <div className="flight-actions-grid">
                                <Button
                                  className="flight-action-button"
                                  variant="default"
                                  radius="xl"
                                  size="xs"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openHistoryModal(flight)
                                  }}
                                >
                                  История
                                </Button>
                                {meteoResponse && (
                                  <Button
                                    className="flight-action-button"
                                    variant="light"
                                    color="teal"
                                    radius="xl"
                                    size="xs"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setMeteoResponseFlight(flight)
                                    }}
                                    disabled={isActionPending}
                                  >
                                    Ответ метеоролога
                                  </Button>
                                )}
                                {!completed && !meteoResponse && (
                                  <Button
                                    className="flight-action-button"
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
                                )}
                                <Group gap={6} wrap="nowrap" className="flight-action-icons">
                                  <ActionIcon
                                    variant="default"
                                    radius="xl"
                                    size="lg"
                                    title="Отчет"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      printFlightReport(flight)
                                    }}
                                    disabled={isActionPending}
                                  >
                                    <IconFileText size={16} />
                                  </ActionIcon>
                                  {!completed && (
                                    <>
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
                                        title="Удалить рейс"
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
                              </div>
                            </div>
                          </Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
                </Box>
              </>
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

      {activeTab === 'analytics' && (
        <Paper withBorder radius="xl" p="lg" className="surface-card">
          <Stack gap="md">
            <Group justify="space-between" align="center" wrap="wrap">
              <Title order={4}>Аналитика</Title>
              <Group gap="xs" wrap="wrap" justify="flex-end">
                <Badge variant="light" color={isHelicopterMode ? 'grape' : 'blue'}>
                  {transportMode === TRANSPORT_MODE_HELICOPTER ? 'Вертолеты' : 'Самолеты'}
                </Badge>
                <Button
                  size="xs"
                  radius="xl"
                  variant="light"
                  color={transportMode === TRANSPORT_MODE_HELICOPTER ? 'grape' : 'blue'}
                  leftSection={<IconDownload size={14} />}
                  onClick={() => exportAnalytics(transportMode)}
                >
                  {transportMode === TRANSPORT_MODE_HELICOPTER ? 'Выгрузить вертолеты' : 'Выгрузить самолеты'}
                </Button>
              </Group>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <Paper withBorder radius="md" p="md" className="metric-tile">
                <Text size="xs" c="dimmed">Всего рейсов</Text>
                <Text fw={800} size="xl">{analytics.total}</Text>
              </Paper>
              <Paper withBorder radius="md" p="md" className="metric-tile">
                <Text size="xs" c="dimmed">Задержано рейсов</Text>
                <Text fw={800} size="xl">{analytics.delayed}</Text>
              </Paper>
              <Paper withBorder radius="md" p="md" className="metric-tile">
                <Text size="xs" c="dimmed">Запросов метеорологу</Text>
                <Text fw={800} size="xl">{analytics.meteorologistRequests}</Text>
              </Paper>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
              <Card withBorder radius="lg" padding="md" className="surface-card surface-card--subtle">
                <Stack gap="sm">
                  <Title order={5}>Количество рейсов по рискам</Title>
                  {analytics.riskBuckets.map((bucket) => {
                    const percent = analytics.total > 0 ? (bucket.count / analytics.total) * 100 : 0
                    return (
                      <Stack key={bucket.value} gap={4}>
                        <Group justify="space-between">
                          <Text size="sm">{bucket.label}</Text>
                          <Text size="sm" fw={700}>{bucket.count}</Text>
                        </Group>
                        <div className="analytics-bar">
                          <div
                            className={`analytics-bar-fill analytics-bar-fill--${bucket.value.toLowerCase()}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </Stack>
                    )
                  })}
                </Stack>
              </Card>

              <Card withBorder radius="lg" padding="md" className="surface-card surface-card--subtle">
                <Stack gap="sm">
                  <Title order={5}>Операционные показатели</Title>
                  <Stack gap={8}>
                    <Group justify="space-between">
                      <Text size="sm">Задержано</Text>
                      <Badge color="yellow" variant="light">{analytics.delayed}</Badge>
                    </Group>
                    <Progress
                      value={analytics.total > 0 ? (analytics.delayed / analytics.total) * 100 : 0}
                      color="yellow"
                      radius="xl"
                    />
                    <Group justify="space-between">
                      <Text size="sm">Запросов метеорологу</Text>
                      <Badge color="blue" variant="light">{analytics.meteorologistRequests}</Badge>
                    </Group>
                    <Progress
                      value={Math.min(100, analytics.meteorologistRequests * 10)}
                      color="blue"
                      radius="xl"
                    />
                  </Stack>
                </Stack>
              </Card>
            </SimpleGrid>

            <Card withBorder radius="lg" padding="md" className="surface-card surface-card--subtle">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Title order={5}>Погодная динамика (круговая диаграмма)</Title>
                  <Badge variant="light">{weatherPieData.total}</Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  Доли по последним погодным снимкам: низкий, средний и высокий риск.
                </Text>
                {analytics.total === 0 ? (
                  <Text size="sm" c="dimmed">
                    Нет данных для диаграммы.
                  </Text>
                ) : (
                  <Group align="center" gap="xl" wrap="wrap">
                    <div
                      className="weather-pie"
                      style={{
                        background: `conic-gradient(#12b886 0 ${weatherPieData.calmPct}%, #fab005 ${weatherPieData.calmPct}% ${weatherPieData.calmPct + weatherPieData.warningPct}%, #fa5252 ${weatherPieData.calmPct + weatherPieData.warningPct}% 100%)`,
                      }}
                    />
                    <Stack gap={6}>
                      <Group gap={8}><span className="pie-legend-dot pie-legend-dot--calm" /><Text size="sm">Низкий: {weatherPieData.calm} ({weatherPieData.calmPct}%)</Text></Group>
                      <Group gap={8}><span className="pie-legend-dot pie-legend-dot--warning" /><Text size="sm">Средний: {weatherPieData.warning} ({weatherPieData.warningPct}%)</Text></Group>
                      <Group gap={8}><span className="pie-legend-dot pie-legend-dot--severe" /><Text size="sm">Высокий: {weatherPieData.severe} ({weatherPieData.severePct}%)</Text></Group>
                    </Stack>
                  </Group>
                )}
              </Stack>
            </Card>
          </Stack>
        </Paper>
      )}

      <Modal
        opened={Boolean(meteoResponseFlight)}
        onClose={() => setMeteoResponseFlight(null)}
        centered
        radius="xl"
        size="lg"
        title="Ответ метеоролога"
      >
        {(() => {
          const response = meteoResponseFlight
            ? meteoResponseByFlightNumber[meteoResponseFlight.flightNumber]
            : null
          const allResponses = meteoResponseFlight
            ? meteoResponsesByFlightNumber[meteoResponseFlight.flightNumber] ?? []
            : []
          const snapshot = response?.requestSnapshot
          const responseByNeed = snapshot?.responseByNeed ?? {}
          const message = snapshot?.meteorologistMessage ?? ''

          return (
            <Stack gap="md">
              <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                <Text size="sm" c="dimmed">
                  Рейс <strong>{meteoResponseFlight?.flightNumber}</strong> |{' '}
                  {meteoResponseFlight?.fromAirportId} - {meteoResponseFlight?.toAirportId}
                </Text>
                <Button
                  variant="light"
                  color="yellow"
                  radius="xl"
                  size="xs"
                  leftSection={<IconMessageCircle size={14} />}
                  onClick={() => {
                    if (!meteoResponseFlight) return
                    onRequestMeteorologist?.({
                      flightNumber: meteoResponseFlight.flightNumber ?? '',
                      fromAirportId: meteoResponseFlight.fromAirportId ?? '',
                      toAirportId: meteoResponseFlight.toAirportId ?? '',
                      etd: toDateTimeLocalValue(meteoResponseFlight.departureAt),
                      eta: toDateTimeLocalValue(getFlightArrivalForTable(meteoResponseFlight)),
                    })
                    setMeteoResponseFlight(null)
                  }}
                >
                  Новый запрос метеорологу
                </Button>
              </Group>
              <Text size="sm">
                Отправлено: {formatDateTime(response?.createdAt ?? snapshot?.answeredAt)}
              </Text>
              {message && (
                <Alert color="blue" radius="md" variant="light" title="Сообщение диспетчеру">
                  <Text size="sm">{message}</Text>
                </Alert>
              )}
              <Stack gap="xs">
                {METEOROLOGIST_NEEDS
                  .filter((need) => snapshot?.needs?.[need.key])
                  .map((need) => (
                    <Paper key={need.key} withBorder radius="md" p="sm">
                      <Text size="sm" fw={700}>{need.responseLabel}</Text>
                      <Text size="sm" c={responseByNeed[need.key] ? undefined : 'dimmed'}>
                        {responseByNeed[need.key] || 'не заполнено'}
                      </Text>
                    </Paper>
                  ))}
              </Stack>
              {allResponses.length > 1 && (
                <>
                  <Divider label="Предыдущие ответы" labelPosition="left" />
                  <Stack gap="xs">
                    {allResponses.slice(1).map((historyItem) => {
                      const historySnapshot = historyItem?.requestSnapshot
                      const historyMessage = historySnapshot?.meteorologistMessage ?? ''
                      const historyResponseByNeed = historySnapshot?.responseByNeed ?? {}
                      const historyNeeds = historySnapshot?.needs ?? {}
                      const historyFilledNeeds = METEOROLOGIST_NEEDS.filter((need) => (
                        historyNeeds[need.key] || historyResponseByNeed[need.key]
                      ))
                      return (
                        <Paper key={historyItem.id} withBorder radius="md" p="sm">
                          <Stack gap={4}>
                            <Text size="xs" c="dimmed">
                              {formatDateTime(historyItem.createdAt ?? historySnapshot?.answeredAt)}
                            </Text>
                            {historyMessage && (
                              <Alert color="blue" radius="md" variant="light" title="Сообщение диспетчеру">
                                <Text size="sm">{historyMessage}</Text>
                              </Alert>
                            )}
                            {historyFilledNeeds.length > 0 ? (
                              <Stack gap={6}>
                                {historyFilledNeeds.map((need) => (
                                  <Box key={need.key}>
                                    <Text size="xs" fw={700}>{need.responseLabel}</Text>
                                    <Text size="sm" c={historyResponseByNeed[need.key] ? undefined : 'dimmed'}>
                                      {historyResponseByNeed[need.key] || 'не заполнено'}
                                    </Text>
                                  </Box>
                                ))}
                              </Stack>
                            ) : (
                              <Text size="sm" c="dimmed">
                                {historyItem.text || 'Данные успешно отправлены'}
                              </Text>
                            )}
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                </>
              )}
            </Stack>
          )
        })()}
      </Modal>

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

          {decisionForm.decision === DISPATCHER_DECISION_DELAY && (
            <Stack gap="xs">
              <Group gap="xs" wrap="wrap">
                <TextInput
                  label="Задержка, минут"
                  type="number"
                  min={5}
                  step={5}
                  value={decisionForm.delayMinutes}
                  onChange={(event) => {
                    const delayMinutes = event.target.value
                    setDecisionForm((prev) => ({ ...prev, delayMinutes }))
                  }}
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
              </Stack>
            </Alert>
          )}

          <Textarea
            label="Объяснение решения"
            minRows={3}
            autosize
            value={decisionForm.reason}
            onChange={(event) => {
              const reason = event.target.value
              setDecisionForm((prev) => ({ ...prev, reason }))
            }}
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

      <Modal
        opened={Boolean(historyFlight)}
        onClose={() => setHistoryFlight(null)}
        centered
        radius="xl"
        title="История рейса"
        size="lg"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {historyFlight?.flightNumber} | {historyFlight?.fromAirportId} - {historyFlight?.toAirportId}
          </Text>
          {isHistoryModalLoading ? (
            <Text c="dimmed">Загружаем историю...</Text>
          ) : historyModalError ? (
            <Alert color="red">{historyModalError}</Alert>
          ) : historyModalItems.length === 0 ? (
            <Text c="dimmed">История пока пуста.</Text>
          ) : (
            <Box className="flights-table-wrap">
              <Table withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Время</Table.Th>
                    <Table.Th>Событие</Table.Th>
                    <Table.Th>Риск</Table.Th>
                    <Table.Th>Комментарий</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {historyModalItems.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>{formatDateTime(item.changedAt)}</Table.Td>
                      <Table.Td>{getRiskChangeReason(item)}</Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={700} className="history-risk-text">
                          {item.oldTotalRisk == null ? 'нет' : formatRiskBadgeScore(item.oldTotalRisk)} → {item.newTotalRisk == null ? 'нет' : formatRiskBadgeScore(item.newTotalRisk)}
                        </Text>
                      </Table.Td>
                      <Table.Td>{item.dispatcherDecisionReason || '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
        </Stack>
      </Modal>
    </Stack>
  )
}
