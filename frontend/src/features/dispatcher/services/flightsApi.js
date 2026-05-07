import { API_BASE_URL } from '../model/constants'
import { fetchWithTimeout } from './httpClient'

async function extractErrorMessage(response, fallback) {
  const contentType = response.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const payload = await response.json()
      if (payload?.message) {
        return payload.message
      }
      if (payload?.error) {
        return payload.error
      }
    } else {
      const text = (await response.text()).trim()
      if (text) {
        return text.slice(0, 240)
      }
    }
  } catch {
    // ignore parse errors, fallback below
  }
  return fallback
}

export async function fetchAllFlights() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/flights`)
  if (!response.ok) {
    const message = await extractErrorMessage(response, `Flights HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export async function createFlight(payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/flights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Create flight HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export async function refreshFlightRisk(flightId) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/flights/${flightId}/refresh-risk`, {
    method: 'POST',
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Refresh risk HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export async function fetchFlightHistory(flightId) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/flights/${flightId}/history`)
  if (!response.ok) {
    const message = await extractErrorMessage(response, `Flight history HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export async function cancelFlight(flightId) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/flights/${flightId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Cancel flight HTTP ${response.status}`)
    throw new Error(message)
  }
}

export async function applyFlightDecision(flightId, payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/flights/${flightId}/decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Decision HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export async function simulateFlightDelayWhatIf(flightId, delayMinutes) {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/flights/${flightId}/what-if-delay?minutes=${encodeURIComponent(delayMinutes)}`,
  )

  if (!response.ok) {
    const message = await extractErrorMessage(response, `What-if HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}
