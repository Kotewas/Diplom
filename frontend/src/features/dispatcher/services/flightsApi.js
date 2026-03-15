import { API_BASE_URL } from '../model/constants'

export async function fetchAllFlights() {
  const response = await fetch(`${API_BASE_URL}/api/flights`)
  if (!response.ok) {
    throw new Error(`Flights HTTP ${response.status}`)
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
    throw new Error(`Create flight HTTP ${response.status}`)
  }

  return response.json()
}
