import { OPENWEATHER_KEY, WEATHER_API_URL, WEATHER_TTL_MS } from '../model/constants'

export async function fetchWeatherByAirport(airport) {
  const params = new URLSearchParams({
    lat: String(airport.lat),
    lon: String(airport.lon),
    appid: OPENWEATHER_KEY,
    units: 'metric',
    lang: 'ru',
  })

  const response = await fetch(`${WEATHER_API_URL}?${params.toString()}`)
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
