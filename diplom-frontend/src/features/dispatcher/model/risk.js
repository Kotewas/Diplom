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
  const weatherCode = safeNumber(weather.weather?.[0]?.id, 800)

  let score = 0
  const factors = []

  if (wind >= 12) {
    score += 16
    factors.push(`Ветер ${wind.toFixed(1)} м/с`)
  }

  if (wind >= 18) score += 15

  if (gust >= 20) {
    score += 18
    factors.push(`Порывы ${gust.toFixed(1)} м/с`)
  }

  if (visibility < 5000) {
    score += 12
    factors.push(`Видимость ${visibility} м`)
  }

  if (visibility < 1500) score += 20

  if (pressure < 985 || pressure > 1035) {
    score += 8
    factors.push(`Давление ${pressure} гПа`)
  }

  if (temp <= -30 || temp >= 38) {
    score += 8
    factors.push(`Экстремальная температура ${temp.toFixed(1)} C`)
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
