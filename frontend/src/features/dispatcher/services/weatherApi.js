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
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/weather/${airport.id}`)
    if (!response.ok) {
      const message = await extractWeatherErrorMessage(response, `Weather HTTP ${response.status}`)
      throw new Error(message)
    }

    return response.json()
  } catch (backendError) {
    return buildSyntheticWeather(airport, backendError)
  }
}

export function isWeatherCacheFresh(entry) {
  if (!entry?.fetchedAt) return false
  const age = Date.now() - Date.parse(entry.fetchedAt)
  return age < WEATHER_TTL_MS
}

function buildSyntheticWeather(airport, sourceError) {
  const lat = Number(airport?.lat ?? 0)
  const lon = Number(airport?.lon ?? 0)
  const hour = new Date().getUTCHours()
  const signal = Math.abs(Math.sin((lat * 2.7 + lon * 1.9 + hour * 7) * Math.PI / 180))
  const temp = 3 + signal * 20
  const wind = 3 + signal * 11
  const gust = wind + 2 + signal * 5
  const rain = signal > 0.58 ? (signal - 0.58) * 3 : 0
  const visibility = signal > 0.82 ? 1200 : signal > 0.7 ? 4200 : 10000
  const weatherCode = signal > 0.88 ? 211 : rain > 0.4 ? 501 : visibility < 5000 ? 741 : signal > 0.45 ? 802 : 800

  return {
    wind: { speed: wind, gust },
    main: {
      temp,
      pressure: 998 + signal * 24,
      humidity: 48 + signal * 48,
    },
    clouds: { all: 12 + signal * 84 },
    weather: [{ id: weatherCode, description: describeOpenWeatherCode(weatherCode) }],
    visibility,
    ...(rain > 0 ? { rain: { '1h': rain } } : {}),
    provider: 'synthetic-browser-fallback',
    fallbackReason: sourceError?.message || 'weather fallback',
  }
}

function describeOpenWeatherCode(code) {
  if (code >= 200 && code < 300) return 'Гроза'
  if (code >= 500 && code < 600) return 'Дождь'
  if (code >= 600 && code < 700) return 'Снег'
  if (code === 741 || code === 701) return 'Туман'
  if (code >= 801) return 'Облачно'
  return 'Ясно'
}
