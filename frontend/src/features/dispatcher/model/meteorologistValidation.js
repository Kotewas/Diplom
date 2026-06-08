import { METEOROLOGIST_NEEDS } from './meteorologistNeeds'

const METAR_REQUIRED_PATTERNS = [
  {
    pattern: /\b[A-Z]{4}\b/,
    message: 'ICAO-код аэропорта, например UUEE',
  },
  {
    pattern: /\b\d{6}Z\b/,
    message: 'время наблюдения в формате 251200Z',
  },
  {
    pattern: /\b(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?(?:MPS|KT)\b/,
    message: 'ветер в формате 22008MPS или 22015G22KT',
  },
  {
    pattern: /\b(?:CAVOK|9999|\d{4})\b/,
    message: 'видимость, например 9999 или 3200',
  },
  {
    pattern: /\b(?:FEW|SCT|BKN|OVC|VV)(?:\d{3}|\/\/\/)?(?:CB|TCU)?\b/,
    message: 'облачность, например SCT020 или BKN015CB',
  },
  {
    pattern: /\bM?\d{2}\/M?\d{2}\b/,
    message: 'температура/точка росы, например 06/M01',
  },
  {
    pattern: /\bQ\d{4}\b/,
    message: 'давление QNH, например Q1018',
  },
]

const TAF_REQUIRED_PATTERNS = [
  {
    pattern: /^(?:TAF\s+)?[A-Z]{4}\b/,
    message: 'TAF должен начинаться с TAF UUEE или UUEE',
  },
  {
    pattern: /\b\d{6}Z\b/,
    message: 'время выпуска в формате 251100Z',
  },
  {
    pattern: /\b\d{4}\/\d{4}\b/,
    message: 'период прогноза, например 2512/2612',
  },
  {
    pattern: /\b(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?(?:MPS|KT)\b/,
    message: 'ветер в формате 21007MPS или 22015G22KT',
  },
  {
    pattern: /\b(?:CAVOK|9999|\d{4})\b/,
    message: 'видимость, например 9999 или 4000',
  },
  {
    pattern: /\b(?:FEW|SCT|BKN|OVC|VV)(?:\d{3}|\/\/\/)?(?:CB|TCU)?\b/,
    message: 'облачность, например BKN020',
  },
]

const FIELD_VALIDATORS = {
  metar(value) {
    return validateAviationReport(value, METAR_REQUIRED_PATTERNS, 'METAR')
  },
  taf(value) {
    return validateAviationReport(value, TAF_REQUIRED_PATTERNS, 'TAF')
  },
  thunderstorm(value) {
    return validateKeywordText(value, /(нет|отсутств|гроза|грозов|tsra|vcts|\bts\b|\bcb\b|cumulonimbus|ливн|молни)/i,
      'Укажите грозовую обстановку: например "нет гроз" или "TSRA/CB в районе посадки".')
  },
  icing(value) {
    return validateKeywordText(value, /(нет|отсутств|облед|icing|ice|измороз|слаб|умерен|сильн|эшелон|fl\d{2,3})/i,
      'Укажите риск обледенения: например "нет обледенения" или "умеренное обледенение FL080-FL120".')
  },
  landingWind(value) {
    const normalized = normalizeReportText(value)
    if (/\b[A-Z]{4}\b.*\b\d{6}Z\b/.test(normalized)) {
      return 'Сюда нужен только ветер на посадке, а не полный METAR. Например: "220 8 м/с".'
    }
    if (!/\b(?:\d{3}|VRB)\s*(?:°|ГРАД(?:УС(?:ОВ|А)?)?|DEG(?:REES?)?)?\s*\d{1,2}(?:[.,]\d+)?\s*(?:М\/С|M\/S|MPS|KT|KTS|УЗЛ?|УЗЛОВ)/i.test(normalized)) {
      return 'Ветер на посадке должен содержать направление и скорость, например "240 10 м/с", "240 градусов 10 м/с" или "24010MPS".'
    }
    return ''
  },
  landingGusts(value) {
    const normalized = normalizeReportText(value)
    if (!/\b(?:(?:G|ПОРЫВ\w*\s*(?:ДО)?|ДО)\s*)?\d{1,2}(?:[.,]\d+)?\s*(?:М\/С|M\/S|MPS|KT|KTS|УЗЛ?|УЗЛОВ)/i.test(normalized)) {
      return 'Порывы укажите числом с единицами, например "16 м/с", "порывы до 16 м/с" или "G22KT".'
    }
    return ''
  },
  landingVisibility(value) {
    const normalized = normalizeReportText(value)
    if (/\b[A-Z]{4}\b.*\b\d{6}Z\b/.test(normalized)) {
      return 'Сюда нужна только видимость на посадке, а не полный METAR. Например: "9999 м" или "3200-5000 м".'
    }
    const numbers = [...normalized.matchAll(/\b\d{3,5}\b/g)]
      .map((match) => Number(match[0]))
      .filter((number) => Number.isFinite(number))
    if (!numbers.some((number) => number >= 100 && number <= 10000)) {
      return 'Видимость укажите в метрах от 100 до 10000, например "3200 м" или "3200-5000 м".'
    }
    return ''
  },
  routeConditions(value) {
    const text = String(value ?? '').trim()
    if (/\bтурбул\b/i.test(text)) {
      return 'Допишите слово полностью: например "риск турбулентности" или "турбулентность на участке маршрута".'
    }
    return validateKeywordText(text, /(нет|спокойн|без\s+опас|гроза|турбулентн|turbulence|turb|облед|icing|сдвиг|wind shear|осад|туман|видим|ветер|фронт|cb|ts)/i,
      'Опишите маршрут авиационными терминами: например "без опасных явлений" или "CB/турбулентность на участке маршрута".')
  },
}

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
  const fieldErrors = {}
  const errors = []

  neededKeys.forEach((key) => {
    const value = responseByNeed[key]
    const isEmpty = !value || (typeof value === 'string' && !value.trim())

    fieldsMissing[key] = isEmpty

    if (isEmpty) {
      const needItem = METEOROLOGIST_NEEDS.find((item) => item.key === key)
      if (needItem) {
        errors.push(needItem.responseLabel)
        fieldErrors[key] = `Заполните поле "${needItem.responseLabel}".`
      }
      return
    }

    const validator = FIELD_VALIDATORS[key]
    const formatError = validator?.(value)
    if (formatError) {
      fieldErrors[key] = formatError
      const needItem = METEOROLOGIST_NEEDS.find((item) => item.key === key)
      errors.push(`${needItem?.responseLabel || key}: ${formatError}`)
    }
  })

  return {
    isValid: errors.length === 0,
    missingFields: errors,
    fieldsMissing,
    fieldErrors,
  }
}

function normalizeReportText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

function validateAviationReport(value, rules, reportName) {
  const normalized = normalizeReportText(value)
  const missing = rules
    .filter((rule) => !rule.pattern.test(normalized))
    .map((rule) => rule.message)

  if (missing.length === 0) return ''
  return `${reportName} заполнен не по авиационному формату. Нужно: ${missing.join('; ')}.`
}

function validateKeywordText(value, pattern, message) {
  const normalized = String(value ?? '').trim()
  if (normalized.length < 3 || !pattern.test(normalized)) {
    return message
  }
  return ''
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
