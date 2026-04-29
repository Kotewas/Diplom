export function toRad(value) {
  return (value * Math.PI) / 180
}

export function haversineDistanceKm(from, to) {
  const earthRadiusKm = 6371
  const dLat = toRad(to.lat - from.lat)
  const dLon = toRad(to.lon - from.lon)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

export function getPrecipPerHour(weather) {
  const rain = safeNumber(weather?.rain?.['1h'])
  const snow = safeNumber(weather?.snow?.['1h'])
  return Math.max(rain, snow)
}

export function evaluateSurfaceRisk(weather) {
  if (!weather) {
    return { score: 85, factors: ['Нет метеоданных для аэропорта'] }
  }

  const wind = safeNumber(weather.wind?.speed)
  const gust = safeNumber(weather.wind?.gust, wind)
  const visibility = safeNumber(weather.visibility, 10000)
  const pressure = safeNumber(weather.main?.pressure, 1013)
  const temp = safeNumber(weather.main?.temp, 15)
  const cloudiness = safeNumber(weather.clouds?.all)
  const precipPerHour = getPrecipPerHour(weather)
  const weatherCode = safeNumber(weather.weather?.[0]?.id, 800)

  let score = 0
  const factors = []

  if (wind >= 8) {
    score += 8
    factors.push(`Умеренный ветер ${wind.toFixed(1)} м/с`)
  }

  if (wind >= 12) {
    score += 10
    factors.push(`Ветер ${wind.toFixed(1)} м/с`)
  }

  if (wind >= 18) score += 12

  if (gust >= 12) {
    score += 7
    factors.push(`Порывы ${gust.toFixed(1)} м/с`)
  }

  if (gust >= 20) {
    score += 12
  }

  if (visibility < 8000) {
    score += 6
    factors.push(`Сниженная видимость ${visibility} м`)
  }

  if (visibility < 5000) {
    score += 10
    factors.push(`Видимость ${visibility} м`)
  }

  if (visibility < 1500) score += 18

  if (pressure < 995 || pressure > 1030) {
    score += 5
    factors.push(`Нестабильное давление ${pressure} гПа`)
  }

  if (pressure < 985 || pressure > 1035) {
    score += 6
    factors.push(`Давление ${pressure} гПа`)
  }

  if (temp <= -30 || temp >= 38) {
    score += 8
    factors.push(`Экстремальная температура ${temp.toFixed(1)} C`)
  }

  if (cloudiness >= 85) {
    score += 4
    factors.push(`Плотная облачность ${Math.round(cloudiness)}%`)
  }

  if (precipPerHour >= 0.2) {
    score += 6
    factors.push(`Осадки ${precipPerHour.toFixed(1)} мм/ч`)
  }

  if (precipPerHour >= 1) {
    score += 8
  }

  if (weatherCode >= 200 && weatherCode < 300) {
    score += 34
    factors.push('Грозовая активность')
  } else if (weatherCode >= 300 && weatherCode < 600) {
    score += 14
    factors.push('Осадки')
  } else if (weatherCode === 741 || weatherCode === 701) {
    score += 16
    factors.push('Туман / дымка')
  }

  return { score: clampScore(score), factors }
}

export function evaluateCruiseRisk(fromAirport, toAirport, depWeather, arrWeather) {
  const distanceKm = haversineDistanceKm(fromAirport, toAirport)
  const depWind = safeNumber(depWeather?.wind?.speed)
  const arrWind = safeNumber(arrWeather?.wind?.speed)
  const depPressure = safeNumber(depWeather?.main?.pressure, 1013)
  const arrPressure = safeNumber(arrWeather?.main?.pressure, 1013)

  let score = 10
  const factors = []

  if (distanceKm >= 2000) {
    score += 10
    factors.push('Дальний маршрут')
  }

  if (distanceKm >= 4000) score += 12

  const avgAbsLat = (Math.abs(fromAirport.lat) + Math.abs(toAirport.lat)) / 2
  if (avgAbsLat >= 50) {
    score += 12
    factors.push('Вероятная зона струйных течений')
  }

  const windProxy = Math.max(depWind, arrWind)
  if (windProxy >= 14) {
    score += 10
    factors.push('Сильный ветровой фон в концах маршрута')
  }

  if (windProxy >= 20) score += 10

  const pressureDelta = Math.abs(depPressure - arrPressure)
  if (pressureDelta >= 20) {
    score += 8
    factors.push('Высокий барический контраст')
  }

  if (pressureDelta >= 35) score += 8

  return { score: clampScore(score), distanceKm, factors }
}

function parseDepartureDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed

  // local datetime fallback (YYYY-MM-DDTHH:mm)
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/)
    if (match) {
      const [, y, m, d, h, min] = match
      const local = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), 0, 0)
      return Number.isNaN(local.getTime()) ? null : local
    }
  }

  return null
}

export function evaluateTemporalRisk(departureAt, isHelicopter = false) {
  const departureDate = parseDepartureDate(departureAt)
  if (!departureDate) {
    return { score: 0, factors: [] }
  }

  const now = new Date()
  const leadMinutes = Math.round((departureDate.getTime() - now.getTime()) / (1000 * 60))
  const hour = departureDate.getHours()

  let score = 0
  const factors = []

  if (leadMinutes < 0) {
    score += 22
    factors.push('Время вылета уже прошло')
  } else if (leadMinutes < 30) {
    score += 12
    factors.push('Очень короткое окно подготовки рейса')
  } else if (leadMinutes < 90) {
    score += 6
    factors.push('Короткое окно подготовки рейса')
  } else if (leadMinutes > 24 * 60) {
    score += 9
    factors.push('Дальний горизонт планирования, прогноз менее стабильный')
  } else if (leadMinutes > 12 * 60) {
    score += 5
    factors.push('Увеличенная неопределенность прогноза')
  }

  if (hour >= 22 || hour < 6) {
    score += isHelicopter ? 15 : 11
    factors.push('Ночной интервал вылета')
  } else if (hour >= 6 && hour < 8) {
    score += 3
    factors.push('Ранний утренний интервал вылета')
  } else if (hour >= 20 && hour < 22) {
    score += 4
    factors.push('Поздний вечерний интервал вылета')
  }

  return { score: clampScore(score), factors }
}

export function getFeasibility(totalRisk) {
  if (totalRisk <= 30) return { label: 'Высокая реализуемость', className: 'risk-low' }
  if (totalRisk <= 55) return { label: 'Средняя реализуемость', className: 'risk-medium' }
  if (totalRisk <= 75) return { label: 'Низкая реализуемость', className: 'risk-high' }
  return { label: 'Не рекомендовано', className: 'risk-critical' }
}

export function riskLevelLabel(score) {
  if (score <= 30) return 'Низкий'
  if (score <= 55) return 'Умеренный'
  if (score <= 75) return 'Высокий'
  return 'Критический'
}

export function getStormWarning(weather) {
  if (!weather) return null

  const wind = safeNumber(weather.wind?.speed)
  const gust = safeNumber(weather.wind?.gust, wind)
  const visibility = safeNumber(weather.visibility, 10000)
  const precipPerHour = getPrecipPerHour(weather)
  const weatherCode = safeNumber(weather.weather?.[0]?.id, 800)

  let level = 'none'
  const reasons = []

  const markWarning = (reason) => {
    if (level === 'none') level = 'warning'
    reasons.push(reason)
  }

  const markSevere = (reason) => {
    level = 'severe'
    reasons.push(reason)
  }

  if (wind >= 15) markWarning(`Сильный ветер ${wind.toFixed(1)} м/с`)
  if (wind >= 20) markSevere(`Штормовой ветер ${wind.toFixed(1)} м/с`)

  if (gust >= 20) markWarning(`Опасные порывы ${gust.toFixed(1)} м/с`)
  if (gust >= 25) markSevere(`Очень сильные порывы ${gust.toFixed(1)} м/с`)

  if (visibility < 3000) markWarning(`Низкая видимость ${Math.round(visibility)} м`)
  if (visibility < 1000) markSevere(`Критическая видимость ${Math.round(visibility)} м`)

  if (precipPerHour >= 2) markWarning(`Сильные осадки ${precipPerHour.toFixed(1)} мм/ч`)
  if (precipPerHour >= 5) markSevere(`Очень сильные осадки ${precipPerHour.toFixed(1)} мм/ч`)

  if (weatherCode >= 200 && weatherCode < 300) {
    markSevere('Грозовая активность по маршруту')
  } else if (weatherCode === 701 || weatherCode === 741) {
    markWarning('Туман/дымка')
  } else if (weatherCode >= 502 && weatherCode < 600) {
    markWarning('Ливневые осадки')
  }

  if (reasons.length === 0) return null

  return {
    level,
    title: level === 'severe' ? 'Штормовое предупреждение' : 'Предупреждение о неблагоприятной погоде',
    reasons,
  }
}

export function buildCurvedRoute(fromAirport, toAirport) {
  if (!fromAirport || !toAirport) return []

  const points = []
  const steps = 48
  const distanceKm = haversineDistanceKm(fromAirport, toAirport)
  const arcBoost = Math.min(6, distanceKm / 1500)

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const lat =
      fromAirport.lat +
      (toAirport.lat - fromAirport.lat) * t +
      Math.sin(Math.PI * t) * arcBoost

    const lon = fromAirport.lon + (toAirport.lon - fromAirport.lon) * t
    points.push([lat, lon])
  }

  return points
}
