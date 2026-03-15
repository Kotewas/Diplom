import { API_BASE_URL, WEATHER_TTL_MS } from '../model/constants'

export async function fetchWeatherByAirport(airport) {
  const response = await fetch(`${API_BASE_URL}/api/weather/${airport.id}`)
  if (!response.ok) {
    throw new Error(`Weather HTTP ${response.status}`)
  }

  return response.json()
}

export function isWeatherCacheFresh(entry) {
  if (!entry?.fetchedAt) return false
  const age = Date.now() - Date.parse(entry.fetchedAt)
  return age < WEATHER_TTL_MS
}
