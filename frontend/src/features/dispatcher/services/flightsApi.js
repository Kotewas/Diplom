import { API_BASE_URL } from '../model/constants'

async function extractErrorMessage(response, fallback) {
  try {
    const payload = await response.json()
    if (payload?.message) {
      return payload.message
    }
  } catch {
    // ignore parse errors, fallback below
  }
  return fallback
}

export async function fetchAllFlights() {
  const response = await fetch(`${API_BASE_URL}/api/flights`)
  if (!response.ok) {
    const message = await extractErrorMessage(response, `Flights HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export async function createFlight(payload) {
  const response = await fetch(`${API_BASE_URL}/api/flights`, {
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
  const response = await fetch(`${API_BASE_URL}/api/flights/${flightId}/refresh-risk`, {
    method: 'POST',
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Refresh risk HTTP ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

export async function cancelFlight(flightId) {
  const response = await fetch(`${API_BASE_URL}/api/flights/${flightId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Cancel flight HTTP ${response.status}`)
    throw new Error(message)
  }
}
