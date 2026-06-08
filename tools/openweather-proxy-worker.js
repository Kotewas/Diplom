// Cloudflare Worker: прокси к OpenWeather.
// Зачем: с некоторых (в т.ч. РФ) хостингов IP api.openweathermap.org недоступен
// (TCP timeout), хотя ключ и сам API рабочие. Worker крутится на стороне Cloudflare,
// которая до OpenWeather достучаться может, и просто пробрасывает запрос.
//
// Деплой (домен НЕ нужен, URL вида имя.логин.workers.dev даётся бесплатно):
//   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker
//   2. Вставить этот код, Deploy. Скопировать выданный *.workers.dev адрес.
//   3. На сервере в .env:  WEATHER_BASE_URL=https://имя.логин.workers.dev
//   4. docker compose up -d --build backend
//
// Бэкенд продолжает слать ?lat=&lon=&appid=&units=&lang= — Worker дёргает
// OpenWeather со своей стороны и возвращает JSON как есть. Источник остаётся OpenWeather.

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const upstream = "https://api.openweathermap.org/data/2.5/weather" + incoming.search;

    const resp = await fetch(upstream, {
      // подстраховка таймаута на стороне Cloudflare
      cf: { cacheTtl: 60, cacheEverything: false },
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
};
