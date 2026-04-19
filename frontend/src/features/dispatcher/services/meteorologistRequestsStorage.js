const ACTIVE_REQUEST_KEY = 'dispatcher.activeMeteorologistRequest'
const CHAT_LOG_KEY = 'dispatcher.meteorologistChatLog'

export function saveActiveMeteorologistRequest(payload) {
  const normalized = {
    ...payload,
    dispatcherName: payload?.dispatcherName || 'Диспетчер',
  }

  try {
    window.localStorage.setItem(ACTIVE_REQUEST_KEY, JSON.stringify(normalized))
    appendChatMessage({
      id: `chat-in-${normalized.id}-${Date.now()}`,
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
    })
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

export function updateActiveMeteorologistResponse(responseByNeed) {
  const activeRequest = readActiveMeteorologistRequest()
  if (!activeRequest) return null

  const answeredAt = new Date().toISOString()
  const updated = {
    ...activeRequest,
    status: 'answered',
    answeredAt,
    responseByNeed,
  }

  markIncomingNotificationAnswered(activeRequest.id)

  appendChatMessage({
    id: `chat-out-${activeRequest.id}-${Date.now()}`,
    requestId: activeRequest.id,
    direction: 'outgoing',
    messageType: 'meteorologist_response',
    createdAt: answeredAt,
    dispatcherName: activeRequest.dispatcherName || 'Диспетчер',
    flightNumber: activeRequest.form?.flightNumber || '',
    text: 'Данные успешно отправлены',
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

export function markIncomingNotificationRead(requestId) {
  if (!requestId) return readMeteorologistChatLog()

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

function appendChatMessage(message) {
  const existing = readMeteorologistChatLog()
  const next = [message, ...existing].slice(0, 100)

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
