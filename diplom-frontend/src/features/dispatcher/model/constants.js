export const OPENWEATHER_KEY =
  import.meta.env.VITE_OPENWEATHER_API_KEY || '6caf1d630c4003100be8cc71f89d647f'

export const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather'
export const FLIGHTS_STORAGE_KEY = 'dispatcher_flights_v4'
export const WEATHER_TTL_MS = 10 * 60 * 1000

export const AIRCRAFT_MODELS = [
  'Airbus A320',
  'Airbus A321',
  'Boeing 737-800',
  'Sukhoi Superjet 100',
  'MC-21',
]

export const AIRPORTS_RF = [
  { id: 'SVO', name: 'Шереметьево', city: 'Москва', lat: 55.9726, lon: 37.4146, region: 'central' },
  { id: 'DME', name: 'Домодедово', city: 'Москва', lat: 55.4088, lon: 37.9063, region: 'central' },
  { id: 'VKO', name: 'Внуково', city: 'Москва', lat: 55.5915, lon: 37.2615, region: 'central' },
  { id: 'LED', name: 'Пулково', city: 'Санкт-Петербург', lat: 59.8003, lon: 30.2625, region: 'northwest' },
  { id: 'MMK', name: 'Мурманск', city: 'Мурманск', lat: 68.7817, lon: 32.7508, region: 'northwest' },
  { id: 'KGD', name: 'Храброво', city: 'Калининград', lat: 54.89, lon: 20.5926, region: 'northwest' },
  { id: 'AER', name: 'Сочи', city: 'Сочи', lat: 43.4499, lon: 39.9566, region: 'south' },
  { id: 'KRR', name: 'Пашковский', city: 'Краснодар', lat: 45.0347, lon: 39.1705, region: 'south' },
  { id: 'ROV', name: 'Платов', city: 'Ростов-на-Дону', lat: 47.4939, lon: 39.9247, region: 'south' },
  { id: 'SVX', name: 'Кольцово', city: 'Екатеринбург', lat: 56.7431, lon: 60.8027, region: 'ural' },
  { id: 'UFA', name: 'Уфа', city: 'Уфа', lat: 54.5575, lon: 55.8744, region: 'ural' },
  { id: 'OVB', name: 'Толмачево', city: 'Новосибирск', lat: 55.0126, lon: 82.6507, region: 'siberia' },
  { id: 'KJA', name: 'Емельяново', city: 'Красноярск', lat: 56.1729, lon: 92.4933, region: 'siberia' },
  { id: 'IKT', name: 'Иркутск', city: 'Иркутск', lat: 52.268, lon: 104.3886, region: 'siberia' },
  { id: 'VVO', name: 'Кневичи', city: 'Владивосток', lat: 43.3989, lon: 132.148, region: 'far_east' },
  { id: 'KHV', name: 'Новый', city: 'Хабаровск', lat: 48.5272, lon: 135.188, region: 'far_east' },
  { id: 'UUS', name: 'Хомутово', city: 'Южно-Сахалинск', lat: 46.8887, lon: 142.717, region: 'far_east' },
]

export const REGIONS_RF = [
  { id: 'central', name: 'Центральный регион', bounds: [[50, 33], [60, 48]] },
  { id: 'northwest', name: 'Северо-Запад', bounds: [[54, 18], [71, 42]] },
  { id: 'south', name: 'Юг', bounds: [[41, 35], [49, 48]] },
  { id: 'ural', name: 'Урал', bounds: [[51, 50], [61, 67]] },
  { id: 'siberia', name: 'Сибирь', bounds: [[50, 67], [66, 113]] },
  { id: 'far_east', name: 'Дальний Восток', bounds: [[42, 113], [72, 170]] },
]
