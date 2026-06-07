import { API_BASE_URL } from '../model/constants'
import { fetchWithTimeout } from './httpClient'

async function extractErrorMessage(response, fallback) {
  try {
    const payload = await response.json()
    if (payload?.message) {
      return payload.message
    }
  } catch {
    // ignore parse errors
  }
  return fallback
}

export async function fetchAirports() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/airports`)
  if (!response.ok) {
    const message = await extractErrorMessage(response, `Airports HTTP ${response.status}`)
    throw new Error(message)
  }

  const payload = await response.json()
  if (!Array.isArray(payload)) return []
  return payload
    .map(normalizeAirport)
    .filter(Boolean)
}

function normalizeAirport(raw) {
  if (!raw || typeof raw !== 'object') return null

  const id = String(raw.id ?? '').trim()
  const name = String(raw.name ?? '').trim()
  const city = String(raw.city ?? '').trim()
  const region = String(raw.region ?? '').trim()
  const lat = Number(raw.lat)
  const lon = Number(raw.lon)

  // Invalid coordinates may crash map marker rendering in Leaflet.
  if (!id || !name || !city || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  return { id, name, city, region, lat, lon }
}
