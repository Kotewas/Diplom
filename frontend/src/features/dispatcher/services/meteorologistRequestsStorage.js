import { API_BASE_URL } from '../model/constants'
import { fetchWithTimeout } from './httpClient'

const ACTIVE_REQUEST_KEY = 'dispatcher.activeMeteorologistRequest'
const CHAT_LOG_KEY = 'dispatcher.meteorologistChatLog'
const DISPATCHER_LAST_SEEN_RESPONSE_KEY = 'dispatcher.lastSeenMeteorologistResponseId'
const METEOROLOGIST_READ_REQUESTS_KEY = 'dispatcher.readMeteorologistRequestIds'

async function extractErrorMessage(response, fallback) {
  const contentType = response.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const payload = await response.json()
      return payload?.message || payload?.error || fallback
    }
    const text = (await response.text()).trim()
    return text || fallback
  } catch {
    return fallback
  }
}

export async function fetchMeteorologistChatLog() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/meteorologist/requests`)
  if (!response.ok) {
    const message = await extractErrorMessage(response, `Meteorologist requests HTTP ${response.status}`)
    throw new Error(message)
  }

  const requests = await response.json()
  const chatLog = buildChatLogFromRequests(Array.isArray(requests) ? requests : [])
  writeChatLog(chatLog)
  return chatLog
}

export async function saveActiveMeteorologistRequestToBackend(payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/meteorologist/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: payload?.id,
      dispatcherName: payload?.dispatcherName || 'Диспетчер рейсов',
      flightNumber: payload?.form?.flightNumber || '',
      fromAirportId: payload?.form?.fromAirportId || '',
      toAirportId: payload?.form?.toAirportId || '',
      etd: normalizeDateTimeLocal(payload?.form?.etd),
      eta: normalizeDateTimeLocal(payload?.form?.eta),
      dispatcherComment: payload?.form?.dispatcherComment || '',
      needs: payload?.needs || {},
      requestText: payload?.requestText || '',
      dataComplete: payload?.dataComplete ?? true,
    }),
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Create meteorologist request HTTP ${response.status}`)
    throw new Error(message)
  }

  const savedRequest = normalizeRequestDto(await response.json())
  saveMeteorologistRequestSnapshotToLocalStorage(savedRequest)
  return savedRequest
}

export async function updateActiveMeteorologistResponseToBackend(requestId, responseByNeed, meteorologistMessage = '') {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/meteorologist/requests/${encodeURIComponent(requestId)}/response`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      responseByNeed: responseByNeed || {},
      meteorologistMessage: String(meteorologistMessage ?? '').trim(),
    }),
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Meteorologist response HTTP ${response.status}`)
    throw new Error(message)
  }

  const savedRequest = normalizeRequestDto(await response.json())
  saveMeteorologistRequestSnapshotToLocalStorage(savedRequest)
  return savedRequest
}

export function saveActiveMeteorologistRequest(payload) {
  const normalized = {
    ...payload,
    dispatcherName: payload?.dispatcherName || 'Диспетчер',
    dataComplete: payload?.dataComplete ?? true,
  }

  try {
    writeActiveMeteorologistRequest(normalized)
    upsertChatMessages([{
      id: `chat-in-${normalized.id}`,
      requestId: normalized.id,
      direction: 'incoming',
      messageType: 'dispatcher_request',
      createdAt: normalized.createdAt || new Date().toISOString(),
      dispatcherName: normalized.dispatcherName,
      flightNumber: normalized.form?.flightNumber || '',
      text: `Пришел запрос от ${normalized.dispatcherName}`,
      requestSnapshot: normalized,
      isRead: false,
      isAnswered: false,
    }])
  } catch {
    // Keep UI functional even if localStorage is blocked.
  }
}

export function readActiveMeteorologistRequest() {
  try {
    const raw = window.localStorage.getItem(ACTIVE_REQUEST_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function updateActiveMeteorologistResponse(responseByNeed, meteorologistMessage = '') {
  const activeRequest = readActiveMeteorologistRequest()
  if (!activeRequest) return null

  const answeredAt = new Date().toISOString()
  
  // Вычисляем полноту ответа
  const requestedNeedKeys = Object.entries(activeRequest.needs || {})
    .filter(([, isNeeded]) => isNeeded)
    .map(([key]) => key)
  
  const emptyCount = requestedNeedKeys.filter(key => {
    const value = responseByNeed[key]
    return !value || (typeof value === 'string' && !value.trim())
  }).length
  
  const responseComplete = emptyCount === 0
  
  const updated = {
    ...activeRequest,
    status: 'answered',
    answeredAt,
    responseByNeed,
    meteorologistMessage: String(meteorologistMessage ?? '').trim(),
    responseComplete,
    emptyFieldsCount: emptyCount,
  }

  markIncomingNotificationAnswered(activeRequest.id)

  appendChatMessage({
    id: `chat-out-${activeRequest.id}-${answeredAt}`,
    requestId: activeRequest.id,
    direction: 'outgoing',
    messageType: 'meteorologist_response',
    createdAt: answeredAt,
    dispatcherName: activeRequest.dispatcherName || 'Диспетчер',
    flightNumber: activeRequest.form?.flightNumber || '',
    text: responseComplete 
      ? 'Данные успешно отправлены' 
      : `Данные отправлены (${emptyCount} незаполн. полей)`,
    requestSnapshot: updated,
  })

  clearActiveMeteorologistRequest()
  return updated
}

export function clearActiveMeteorologistRequest() {
  try {
    window.localStorage.removeItem(ACTIVE_REQUEST_KEY)
  } catch {
    // no-op
  }
}

export function readMeteorologistChatLog() {
  try {
    const raw = window.localStorage.getItem(CHAT_LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function readNewMeteorologistResponsesForDispatcher(sourceLog) {
  const chatLog = Array.isArray(sourceLog) ? sourceLog : readMeteorologistChatLog()
  const responses = chatLog.filter(
    (item) => item?.direction === 'outgoing' && item?.messageType === 'meteorologist_response' && item?.id,
  )
  if (responses.length === 0) return []

  const lastSeenResponseId = readDispatcherLastSeenMeteorologistResponseId()

  if (!lastSeenResponseId) {
    return [responses[0]]
  }

  const lastSeenIndex = responses.findIndex((item) => item.id === lastSeenResponseId)
  if (lastSeenIndex === -1) {
    return [responses[0]]
  }

  return responses.slice(0, lastSeenIndex)
}

export function countMeteorologistRequests(sourceLog) {
  const chatLog = Array.isArray(sourceLog) ? sourceLog : readMeteorologistChatLog()
  return chatLog.filter(
    (item) => item?.direction === 'incoming' && item?.messageType === 'dispatcher_request',
  ).length
}

export function markMeteorologistResponsesSeenForDispatcher(responseId) {
  if (!responseId) return
  writeDispatcherLastSeenMeteorologistResponseId(responseId)
}

export function markLatestMeteorologistResponseSeenForDispatcher(sourceLog) {
  const chatLog = Array.isArray(sourceLog) ? sourceLog : readMeteorologistChatLog()
  const newestResponse = chatLog.find(
    (item) => item?.direction === 'outgoing' && item?.messageType === 'meteorologist_response' && item?.id,
  )
  if (newestResponse?.id) {
    writeDispatcherLastSeenMeteorologistResponseId(newestResponse.id)
  }
}

export function markIncomingNotificationRead(requestId) {
  if (!requestId) return readMeteorologistChatLog()
  rememberReadRequestId(requestId)

  const updatedLog = readMeteorologistChatLog().map((item) => {
    if (item.direction !== 'incoming') return item
    if (item.requestId !== requestId) return item

    return {
      ...item,
      isRead: true,
    }
  })

  writeChatLog(updatedLog)
  return updatedLog
}

function buildChatLogFromRequests(requests) {
  const readRequestIds = readReadRequestIds()
  return requests.flatMap((requestDto) => {
    const request = normalizeRequestDto(requestDto)
    if (!request?.id) return []

    const incoming = {
      id: `chat-in-${request.id}`,
      requestId: request.id,
      direction: 'incoming',
      messageType: 'dispatcher_request',
      createdAt: request.createdAt || new Date().toISOString(),
      dispatcherName: request.dispatcherName,
      flightNumber: request.form?.flightNumber || '',
      text: `Пришел запрос от ${request.dispatcherName || 'Диспетчер'}`,
      requestSnapshot: request,
      isRead: readRequestIds.has(request.id) || request.status === 'answered',
      isAnswered: request.status === 'answered',
    }

    if (request.status !== 'answered') {
      return [incoming]
    }

    return [
      {
        id: `chat-out-${request.id}-${request.answeredAt || ''}`,
        requestId: request.id,
        direction: 'outgoing',
        messageType: 'meteorologist_response',
        createdAt: request.answeredAt || request.createdAt || new Date().toISOString(),
        dispatcherName: request.dispatcherName || 'Диспетчер',
        flightNumber: request.form?.flightNumber || '',
        text: request.responseComplete === false
          ? `Данные отправлены (${request.emptyFieldsCount || 0} незаполн. полей)`
          : 'Данные успешно отправлены',
        requestSnapshot: request,
      },
      incoming,
    ]
  })
}

function saveMeteorologistRequestSnapshotToLocalStorage(request) {
  const normalized = normalizeRequestDto(request)
  if (!normalized?.id) return

  if (normalized.status !== 'answered') {
    writeActiveMeteorologistRequest(normalized)
  } else {
    clearActiveMeteorologistRequestIfMatches(normalized.id)
  }

  upsertChatMessages(buildChatLogFromRequests([normalized]))
}

function normalizeRequestDto(request) {
  if (!request || typeof request !== 'object') return null
  return {
    id: request.id,
    createdAt: request.createdAt,
    status: request.status || 'new',
    dispatcherName: request.dispatcherName || 'Диспетчер рейсов',
    form: {
      flightNumber: request.form?.flightNumber || '',
      fromAirportId: request.form?.fromAirportId || '',
      toAirportId: request.form?.toAirportId || '',
      etd: request.form?.etd || '',
      eta: request.form?.eta || '',
      dispatcherComment: request.form?.dispatcherComment || '',
    },
    needs: request.needs || {},
    requestText: request.requestText || '',
    dataComplete: request.dataComplete ?? true,
    responseByNeed: request.responseByNeed || {},
    meteorologistMessage: request.meteorologistMessage || '',
    responseComplete: request.responseComplete,
    emptyFieldsCount: request.emptyFieldsCount || 0,
    answeredAt: request.answeredAt || '',
  }
}

function normalizeDateTimeLocal(value) {
  if (!value) return null
  const text = String(value).trim()
  return text || null
}

function readReadRequestIds() {
  try {
    const raw = window.localStorage.getItem(METEOROLOGIST_READ_REQUESTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
  } catch {
    return new Set()
  }
}

function rememberReadRequestId(requestId) {
  try {
    const ids = readReadRequestIds()
    ids.add(String(requestId))
    window.localStorage.setItem(METEOROLOGIST_READ_REQUESTS_KEY, JSON.stringify([...ids]))
  } catch {
    // no-op
  }
}

function writeActiveMeteorologistRequest(request) {
  try {
    window.localStorage.setItem(ACTIVE_REQUEST_KEY, JSON.stringify(request))
  } catch {
    // no-op
  }
}

function clearActiveMeteorologistRequestIfMatches(requestId) {
  if (!requestId) return
  const activeRequest = readActiveMeteorologistRequest()
  if (activeRequest?.id === requestId) {
    clearActiveMeteorologistRequest()
  }
}

function appendChatMessage(message) {
  const existing = readMeteorologistChatLog()
  const next = [message, ...existing].slice(0, 100)

  writeChatLog(next)
}

function upsertChatMessages(messages) {
  const safeMessages = Array.isArray(messages)
    ? messages.filter((item) => item?.id)
    : []
  if (safeMessages.length === 0) return

  const incomingIds = new Set(safeMessages.map((item) => item.id))
  const existing = readMeteorologistChatLog().filter((item) => !incomingIds.has(item?.id))
  const next = [...safeMessages, ...existing]
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .slice(0, 100)

  writeChatLog(next)
}

function markIncomingNotificationAnswered(requestId) {
  if (!requestId) return

  const updatedLog = readMeteorologistChatLog().map((item) => {
    if (item.direction !== 'incoming') return item
    if (item.requestId !== requestId) return item

    return {
      ...item,
      isRead: true,
      isAnswered: true,
    }
  })

  writeChatLog(updatedLog)
}

function writeChatLog(log) {
  try {
    window.localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(Array.isArray(log) ? log : []))
  } catch {
    // no-op
  }
}

function readDispatcherLastSeenMeteorologistResponseId() {
  try {
    const raw = window.localStorage.getItem(DISPATCHER_LAST_SEEN_RESPONSE_KEY)
    return raw ? String(raw) : ''
  } catch {
    return ''
  }
}

function writeDispatcherLastSeenMeteorologistResponseId(responseId) {
  try {
    window.localStorage.setItem(DISPATCHER_LAST_SEEN_RESPONSE_KEY, String(responseId))
  } catch {
    // no-op
  }
}
