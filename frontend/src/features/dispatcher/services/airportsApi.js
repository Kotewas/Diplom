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
  return Array.isArray(payload) ? payload : []
}
