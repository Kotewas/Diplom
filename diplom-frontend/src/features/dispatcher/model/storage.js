import { FLIGHTS_STORAGE_KEY } from './constants'

export function loadFlights() {
  try {
    const raw = localStorage.getItem(FLIGHTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFlights(flights) {
  localStorage.setItem(FLIGHTS_STORAGE_KEY, JSON.stringify(flights))
}
