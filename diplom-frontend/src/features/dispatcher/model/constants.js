export const OPENWEATHER_KEY =
  import.meta.env.VITE_OPENWEATHER_API_KEY || '6caf1d630c4003100be8cc71f89d647f'

export const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather'
export const WEATHER_TTL_MS = 10 * 60 * 1000

export const AIRPORTS_RF = [
  { id: 'SVO', name: 'Шереметьево', city: 'Москва', lat: 55.9726, lon: 37.4146 },
  { id: 'DME', name: 'Домодедово', city: 'Москва', lat: 55.4088, lon: 37.9063 },
  { id: 'VKO', name: 'Внуково', city: 'Москва', lat: 55.5915, lon: 37.2615},
  { id: 'LED', name: 'Пулково', city: 'Санкт-Петербург', lat: 59.8003, lon: 30.2625},
  { id: 'MMK', name: 'Мурманск', city: 'Мурманск', lat: 68.7817, lon: 32.7508},
  { id: 'KGD', name: 'Храброво', city: 'Калининград', lat: 54.89, lon: 20.5926},
  { id: 'AER', name: 'Сочи', city: 'Сочи', lat: 43.4499, lon: 39.9566},
  { id: 'KRR', name: 'Пашковский', city: 'Краснодар', lat: 45.0347, lon: 39.1705},
  { id: 'ROV', name: 'Платов', city: 'Ростов-на-Дону', lat: 47.4939, lon: 39.9247},
  { id: 'SVX', name: 'Кольцово', city: 'Екатеринбург', lat: 56.7431, lon: 60.8027},
  { id: 'UFA', name: 'Уфа', city: 'Уфа', lat: 54.5575, lon: 55.8744},
  { id: 'OVB', name: 'Толмачево', city: 'Новосибирск', lat: 55.0126, lon: 82.6507},
  { id: 'KJA', name: 'Емельяново', city: 'Красноярск', lat: 56.1729, lon: 92.4933 },
  { id: 'IKT', name: 'Иркутск', city: 'Иркутск', lat: 52.268, lon: 104.3886 },
  { id: 'VVO', name: 'Кневичи', city: 'Владивосток', lat: 43.3989, lon: 132.148 },
  { id: 'KHV', name: 'Новый', city: 'Хабаровск', lat: 48.5272, lon: 135.188 },
  { id: 'UUS', name: 'Хомутово', city: 'Южно-Сахалинск', lat: 46.8887, lon: 142.717 },
]
