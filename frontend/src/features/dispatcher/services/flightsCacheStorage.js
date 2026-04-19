const FLIGHTS_CACHE_KEY = 'dispatcher.flightsCache.v1'

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readFlightsCache() {
  try {
    const raw = window.localStorage.getItem(FLIGHTS_CACHE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item) => isObject(item) && typeof item.id === 'string')
  } catch {
    return []
  }
}

export function writeFlightsCache(flights) {
  try {
    const safeFlights = Array.isArray(flights) ? flights.filter((item) => isObject(item)) : []
    window.localStorage.setItem(FLIGHTS_CACHE_KEY, JSON.stringify(safeFlights))
  } catch {
    // no-op: do not break UI if localStorage is unavailable
  }
}
