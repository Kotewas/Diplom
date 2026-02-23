export function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function safeNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function getPrecipPerHour(weather) {
  const rain = safeNumber(weather?.rain?.['1h'])
  const snow = safeNumber(weather?.snow?.['1h'])
  const values = [rain, snow].filter((v) => v != null)
  if (values.length === 0) 
  return null // нет данных об осадках
  return Math.max(...values)
}

export function evaluateSurfaceRisk(weather) {
  if (!weather) {
    return {
      score: 90,
      factors: ['Нет метеоданных для аэропорта (решение на диспетчере)'],
      missing: ['weather'],
    }
  }

const missing = []
const factors = []
let score = 0

  const wind = safeNumber(weather?.wind?.speed)
  if (wind == null) missing.push('wind.speed')

  const gust = safeNumber(weather?.wind?.gust)
  
  if (gust == null) missing.push('wind.gust')

  const visibility = safeNumber(weather?.visibility)
  if (visibility == null) missing.push('visibility')

  const pressure = safeNumber(weather?.main?.pressure)
  if (pressure == null) missing.push('main.pressure')

  const temp = safeNumber(weather?.main?.temp)
  if (temp == null) missing.push('main.temp')

  const weatherCode = safeNumber(weather?.weather?.[0]?.id)
  if (weatherCode == null) missing.push('weather[0].id')

  
  const criticalMissing = []
  if (wind == null) criticalMissing.push('Скорость ветра')
  if (visibility == null) criticalMissing.push('Видимость')
  if (weatherCode == null) criticalMissing.push('Тип явления (код погоды)')

  if (criticalMissing.length > 0) {
    return {
      score: 90,
      factors: [
        'Метеоданные неполные — решение на диспетчере',
        `Не подтянулось: ${criticalMissing.join(', ')}`,
      ],
      missing,
    }
  }


  if (wind >= 12) {
    score += 16
    factors.push(`Ветер ${wind.toFixed(1)} м/с`)
  }
  if (wind >= 18) score += 15

 
  if (gust != null && gust >= 20) {
    score += 18
    factors.push(`Порывы ${gust.toFixed(1)} м/с`)
  }

  if (visibility < 5000) {
    score += 12
    factors.push(`Видимость ${visibility} м`)
  }
  if (visibility < 1500) score += 20

  if (pressure != null && (pressure < 985 || pressure > 1035)) {
    score += 8
    factors.push(`Давление ${pressure} гПа`)
  }

  if (temp != null && (temp <= -30 || temp >= 38)) {
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

  if (missing.length > 0) {
    factors.push(`Часть параметров не подтянулась: ${missing.join(', ')}`)
  }

  return { score: clampScore(score), factors, missing }
}

export function evaluateCruiseRisk(fromAirport, toAirport, depWeather, arrWeather) {
  const missing = []
  const factors = []
  let score = 10

  const depWind = safeNumber(depWeather?.wind?.speed)
  if (depWind == null) missing.push('dep wind.speed')

  const arrWind = safeNumber(arrWeather?.wind?.speed)
  if (arrWind == null) missing.push('arr wind.speed')

  const depPressure = safeNumber(depWeather?.main?.pressure)
  if (depPressure == null) missing.push('dep main.pressure')

  const arrPressure = safeNumber(arrWeather?.main?.pressure)
  if (arrPressure == null) missing.push('arr main.pressure')

  if (depWind == null || arrWind == null) {
    return {
      score: 90,
      factors: [
        'Метеоданные неполные для оценки маршрута — решение на диспетчере',
        `Не подтянулось: ${missing.join(', ')}`,
      ],
      missing,
    }
  }

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

  if (depPressure != null && arrPressure != null) {
    const pressureDelta = Math.abs(depPressure - arrPressure)
    if (pressureDelta >= 20) {
      score += 8
      factors.push('Высокий барический контраст')
    }
    if (pressureDelta >= 35) score += 8
  } else {
    factors.push('Нет данных о давлении для оценки барического контраста')
  }

  if (missing.length > 0) {
    factors.push(`Часть параметров не подтянулась: ${missing.join(', ')}`)
  }

  return { score: clampScore(score), factors, missing }
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
