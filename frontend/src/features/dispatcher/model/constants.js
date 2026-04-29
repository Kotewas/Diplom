export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
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

export const HELIPORTS_TVER = [
  { id: 'TVR_HELI', name: 'Змеево', city: 'Тверь', lat: 56.8591, lon: 35.7577, region: 'tver' },
  { id: 'TOR_HELI', name: 'Торжок', city: 'Торжок', lat: 57.0397, lon: 34.9628, region: 'tver' },
  { id: 'RZH_HELI', name: 'Ржев', city: 'Ржев', lat: 56.262, lon: 34.3291, region: 'tver' },
  { id: 'KON_HELI', name: 'Конаково', city: 'Конаково', lat: 56.7055, lon: 36.7696, region: 'tver' },
  { id: 'KSH_HELI', name: 'Кашин', city: 'Кашин', lat: 57.3588, lon: 37.6133, region: 'tver' },
  { id: 'BTK_HELI', name: 'Бежецк', city: 'Бежецк', lat: 57.786, lon: 36.69, region: 'tver' },
  { id: 'BLG_HELI', name: 'Бологое', city: 'Бологое', lat: 57.885, lon: 34.053, region: 'tver' },
  { id: 'VVW_HELI', name: 'Вышний Волочек', city: 'Вышний Волочек', lat: 57.591, lon: 34.564, region: 'tver' },
  { id: 'KMR_HELI', name: 'Кимры', city: 'Кимры', lat: 56.873, lon: 37.355, region: 'tver' },
  { id: 'KLZ_HELI', name: 'Калязин', city: 'Калязин', lat: 57.241, lon: 37.852, region: 'tver' },
  { id: 'OST_HELI', name: 'Осташков', city: 'Осташков', lat: 57.146, lon: 33.103, region: 'tver' },
  { id: 'NLD_HELI', name: 'Нелидово', city: 'Нелидово', lat: 56.223, lon: 32.777, region: 'tver' },
  { id: 'UDM_HELI', name: 'Удомля', city: 'Удомля', lat: 57.879, lon: 35.005, region: 'tver' },
  { id: 'TRP_HELI', name: 'Торопец', city: 'Торопец', lat: 56.497, lon: 31.635, region: 'tver' },
  { id: 'STR_HELI', name: 'Старица', city: 'Старица', lat: 56.514, lon: 34.939, region: 'tver' },
  { id: 'LKH_HELI', name: 'Лихославль', city: 'Лихославль', lat: 57.126, lon: 35.466, region: 'tver' },
  { id: 'VSG_HELI', name: 'Весьегонск', city: 'Весьегонск', lat: 58.658, lon: 37.263, region: 'tver' },
  { id: 'ZDV_HELI', name: 'Западная Двина', city: 'Западная Двина', lat: 56.256, lon: 32.074, region: 'tver' },
  { id: 'ANP_HELI', name: 'Андреаполь', city: 'Андреаполь', lat: 56.651, lon: 32.266, region: 'tver' },
  { id: 'KVN_HELI', name: 'Кувшиново', city: 'Кувшиново', lat: 57.026, lon: 34.168, region: 'tver' },
  { id: 'KRH_HELI', name: 'Красный Холм', city: 'Красный Холм', lat: 58.057, lon: 37.120, region: 'tver' },
  { id: 'MKS_HELI', name: 'Максатиха', city: 'Максатиха', lat: 57.801, lon: 35.882, region: 'tver' },
  { id: 'SLZ_HELI', name: 'Селижарово', city: 'Селижарово', lat: 56.852, lon: 33.448, region: 'tver' },
  { id: 'SPR_HELI', name: 'Спирово', city: 'Спирово', lat: 57.418, lon: 34.981, region: 'tver' },
  { id: 'SNK_HELI', name: 'Сонково', city: 'Сонково', lat: 57.780, lon: 37.162, region: 'tver' },
  { id: 'SND_HELI', name: 'Сандово', city: 'Сандово', lat: 58.460, lon: 37.311, region: 'tver' },
  { id: 'BLY_HELI', name: 'Белый', city: 'Белый', lat: 55.840, lon: 32.939, region: 'tver' },
  { id: 'ZBC_HELI', name: 'Зубцов', city: 'Зубцов', lat: 56.176, lon: 34.588, region: 'tver' },
]

export const TVER_REGION_BOUNDS = [[55.8, 33.8], [57.9, 38.4]]

export const REGIONS_RF = [
  { id: 'central', name: 'Центральный регион', bounds: [[50, 33], [60, 48]] },
  { id: 'northwest', name: 'Северо-Запад', bounds: [[54, 18], [71, 42]] },
  { id: 'south', name: 'Юг', bounds: [[41, 35], [49, 48]] },
  { id: 'ural', name: 'Урал', bounds: [[51, 50], [61, 67]] },
  { id: 'siberia', name: 'Сибирь', bounds: [[50, 67], [66, 113]] },
  { id: 'far_east', name: 'Дальний Восток', bounds: [[42, 113], [72, 170]] },
]
