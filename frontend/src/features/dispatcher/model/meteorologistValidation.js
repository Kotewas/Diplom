import { METEOROLOGIST_NEEDS } from './meteorologistNeeds'

/**
 * Валидирует, что запрос от диспетчера содержит все необходимые данные
 * @returns { isValid: boolean, missingFields: string[] }
 */
export function validateDispatcherRequest(form) {
  const errors = []

  if (!form.flightNumber || !form.flightNumber.trim()) {
    errors.push('номер рейса')
  }

  if (!form.fromAirportId || !form.fromAirportId.trim()) {
    errors.push('аэропорт вылета')
  }

  if (!form.toAirportId || !form.toAirportId.trim()) {
    errors.push('аэропорт назначения')
  }

  if (!form.etd || !form.etd.trim()) {
    errors.push('плановое время вылета')
  }

  if (!form.eta || !form.eta.trim()) {
    errors.push('плановое время прилета')
  }

  return {
    isValid: errors.length === 0,
    missingFields: errors,
  }
}

/**
 * Валидирует, что метеоролог заполнил все требуемые данные
 * @returns { isValid: boolean, missingFields: string[], fieldsMissing: { [key]: boolean } }
 */
export function validateMeteorologistResponse(responseByNeed, neededKeys) {
  const fieldsMissing = {}
  const errors = []

  neededKeys.forEach((key) => {
    const value = responseByNeed[key]
    const isEmpty = !value || (typeof value === 'string' && !value.trim())

    fieldsMissing[key] = isEmpty

    if (isEmpty) {
      const needItem = METEOROLOGIST_NEEDS.find((item) => item.key === key)
      if (needItem) {
        errors.push(needItem.responseLabel)
      }
    }
  })

  return {
    isValid: errors.length === 0,
    missingFields: errors,
    fieldsMissing,
  }
}

/**
 * Проверяет, полны ли метеоданные от метеоролога по ответу
 */
export function areMeteorologistDataComplete(responseByNeed, requestNeeds) {
  if (!responseByNeed || !requestNeeds) {
    return false
  }

  const neededKeys = Object.entries(requestNeeds)
    .filter(([, isNeeded]) => isNeeded)
    .map(([key]) => key)

  const validation = validateMeteorologistResponse(responseByNeed, neededKeys)
  return validation.isValid
}

/**
 * Вычисляет коэффициент риска в зависимости от полноты метеоданных
 * Если данные неполные, риск повышается
 */
export function getRiskAdjustmentFactor(responseByNeed, requestNeeds) {
  if (areMeteorologistDataComplete(responseByNeed, requestNeeds)) {
    return 1.0 // Полные данные - коэффициент 1.0 (не меняется)
  }

  if (!responseByNeed || !requestNeeds) {
    return 1.15 // Нет данных вообще - повышаем на 15%
  }

  const neededKeys = Object.entries(requestNeeds)
    .filter(([, isNeeded]) => isNeeded)
    .map(([key]) => key)

  const filledCount = neededKeys.filter((key) => {
    const value = responseByNeed[key]
    return value && (typeof value !== 'string' || value.trim())
  }).length

  const ratio = filledCount / neededKeys.length
  if (ratio >= 0.75) {
    return 1.08 // 75%+ данных - повышаем на 8%
  }
  if (ratio >= 0.5) {
    return 1.12 // 50-75% данных - повышаем на 12%
  }

  return 1.15 // Менее 50% данных - повышаем на 15%
}
