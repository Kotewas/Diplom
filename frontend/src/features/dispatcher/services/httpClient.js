const DEFAULT_TIMEOUT_MS = 12000

function withTimeoutMessage(error, timeoutMs) {
  if (error?.name === 'AbortError') {
    return new Error(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} сек. Проверьте backend.`)
  }

  return new Error('Нет соединения с backend. Проверьте, что сервер запущен и доступен.')
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    throw withTimeoutMessage(error, timeoutMs)
  } finally {
    clearTimeout(timeoutId)
  }
}
