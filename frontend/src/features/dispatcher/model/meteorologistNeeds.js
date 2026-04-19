export const METEOROLOGIST_NEEDS = [
  {
    key: 'metar',
    label: 'Фактическая погода (METAR)',
    responseLabel: 'METAR (фактическая погода)',
    placeholder: 'Например: UUEE 251200Z 22008MPS 9999 SCT020 06/M01 Q1018',
  },
  {
    key: 'taf',
    label: 'Прогноз (TAF)',
    responseLabel: 'TAF (прогноз)',
    placeholder: 'Например: TAF UUEE 251100Z 2512/2612 21007MPS 9999 BKN020',
  },
  {
    key: 'thunderstorm',
    label: 'Опасные явления: гроза',
    responseLabel: 'Грозовая обстановка',
    placeholder: 'Укажите наличие грозы, интенсивность, район и ожидаемое время.',
  },
  {
    key: 'icing',
    label: 'Опасные явления: обледенение',
    responseLabel: 'Риск обледенения',
    placeholder: 'Укажите эшелоны/районы риска обледенения и интенсивность.',
  },
  {
    key: 'landingWind',
    label: 'Условия посадки: ветер',
    responseLabel: 'Ветер на посадке',
    placeholder: 'Например: 240° 10 м/с, боковая составляющая умеренная.',
  },
  {
    key: 'landingGusts',
    label: 'Условия посадки: порывы ветра',
    responseLabel: 'Порывы ветра на посадке',
    placeholder: 'Например: порывы до 16 м/с в период 14:00-16:00 UTC.',
  },
  {
    key: 'landingVisibility',
    label: 'Условия посадки: видимость',
    responseLabel: 'Видимость на посадке',
    placeholder: 'Например: 3200-5000 м, возможное ухудшение при осадках.',
  },
  {
    key: 'routeConditions',
    label: 'Условия на маршруте',
    responseLabel: 'Погодные условия на маршруте',
    placeholder: 'Кратко опишите условия по маршруту и потенциальные риски.',
  },
]

export const DEFAULT_METEOROLOGIST_NEEDS = Object.fromEntries(
  METEOROLOGIST_NEEDS.map((item) => [item.key, true]),
)
