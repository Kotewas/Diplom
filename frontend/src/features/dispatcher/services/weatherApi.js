import { API_BASE_URL, WEATHER_TTL_MS } from '../model/constants'
import { fetchWithTimeout } from './httpClient'

async function extractWeatherErrorMessage(response, fallback) {
  try {
    const payload = await response.json()
    if (payload?.message) return payload.message
  } catch {
    // ignore parse issues
  }
  return fallback
}

export async function fetchWeatherByAirport(airport) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/weather/${airport.id}`)
  if (!response.ok) {
    const message = await extractWeatherErrorMessage(response, `Weather HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export function isWeatherCacheFresh(entry) {
  if (!entry?.fetchedAt) return false
  const age = Date.now() - Date.parse(entry.fetchedAt)
  return age < WEATHER_TTL_MS
}
