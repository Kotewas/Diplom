package com.diplom.dispatcher.weather;

import com.diplom.dispatcher.airport.AirportCatalogService;
import com.diplom.dispatcher.airport.AirportDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WeatherService {
    private final AirportCatalogService airportCatalogService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    private final String weatherBaseUrl;
    private final String weatherApiKey;
    private final Duration ttl;

    private final Map<String, CachedWeather> cache = new ConcurrentHashMap<>();

    public WeatherService(
            AirportCatalogService airportCatalogService,
            ObjectMapper objectMapper,
            @Value("${app.weather.base-url:https://api.openweathermap.org/data/2.5/weather}") String weatherBaseUrl,
            @Value("${app.weather.api-key:}") String weatherApiKey,
            @Value("${app.weather.ttl-ms:600000}") long ttlMs
    ) {
        this.airportCatalogService = airportCatalogService;
        this.objectMapper = objectMapper;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(2500);
        requestFactory.setReadTimeout(3000);
        this.restTemplate = new RestTemplate(requestFactory);
        this.weatherBaseUrl = weatherBaseUrl;
        this.weatherApiKey = weatherApiKey;
        this.ttl = Duration.ofMillis(ttlMs);
    }

    public JsonNode getWeatherByAirportId(String airportId) {
        CachedWeather cachedWeather = cache.get(airportId);
        if (cachedWeather != null && cachedWeather.isFresh(ttl)) {
            return cachedWeather.data();
        }

        AirportDto airport = airportCatalogService.getById(airportId)
                .orElseThrow(() -> new IllegalArgumentException("Airport is not found: " + airportId));

        JsonNode fresh;
        try {
            fresh = fetchWeather(airport);
        } catch (Exception exception) {
            fresh = buildSyntheticWeather(airport, exception);
        }

        cache.put(airportId, new CachedWeather(fresh, Instant.now()));
        return fresh;
    }

    private JsonNode fetchWeather(AirportDto airport) {
        if (weatherApiKey == null || weatherApiKey.isBlank()) {
            throw new IllegalStateException("OpenWeatherMap API key is not configured");
        }
        return fetchFromOpenWeather(airport);
    }

    private JsonNode fetchFromOpenWeather(AirportDto airport) {
        URI uri = UriComponentsBuilder
                .fromHttpUrl(weatherBaseUrl)
                .queryParam("lat", airport.lat())
                .queryParam("lon", airport.lon())
                .queryParam("appid", weatherApiKey)
                .queryParam("units", "metric")
                .queryParam("lang", "ru")
                .build(true)
                .toUri();

        ResponseEntity<String> response = restTemplate.getForEntity(uri, String.class);
        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
            throw new IllegalStateException("Weather API error: HTTP " + response.getStatusCode().value());
        }

        try {
            return objectMapper.readTree(response.getBody());
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot parse weather API response", exception);
        }
    }

    private double safeNumber(JsonNode value, double fallback) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            return fallback;
        }
        return value.isNumber() ? value.asDouble() : fallback;
    }

    private String describeOpenWeatherCode(int openWeatherCode) {
        if (openWeatherCode >= 200 && openWeatherCode < 300) {
            return "Гроза";
        }
        if (openWeatherCode >= 500 && openWeatherCode < 600) {
            return "Дождь";
        }
        if (openWeatherCode >= 600 && openWeatherCode < 700) {
            return "Снег";
        }
        if (openWeatherCode == 741 || openWeatherCode == 701) {
            return "Туман";
        }
        if (openWeatherCode >= 801) {
            return "Облачно";
        }
        return "Ясно";
    }

    private JsonNode buildSyntheticWeather(AirportDto airport, Exception sourceError) {
        double lat = airport.lat();
        double lon = airport.lon();

        double signal = Math.abs(Math.sin(Math.toRadians(lat * 2.3 + lon * 1.7)));
        double temp = 4 + signal * 18;
        double pressure = 1003 + signal * 16;
        double wind = 2 + signal * 8;
        double gust = wind + 1.5 + signal * 4;
        double cloudCover = 15 + signal * 75;
        double rain = signal > 0.62 ? (signal - 0.62) * 1.8 : 0;

        int weatherCode = signal > 0.87
                ? 211
                : signal > 0.65
                ? 501
                : signal > 0.48
                ? 802
                : 800;

        String description = switch (weatherCode) {
            case 211 -> "Гроза";
            case 501 -> "Дождь";
            case 802 -> "Облачно";
            default -> "Ясно";
        };

        ObjectNode normalized = objectMapper.createObjectNode();
        ObjectNode windNode = normalized.putObject("wind");
        windNode.put("speed", wind);
        windNode.put("gust", gust);

        ObjectNode mainNode = normalized.putObject("main");
        mainNode.put("temp", temp);
        mainNode.put("pressure", pressure);

        ObjectNode cloudsNode = normalized.putObject("clouds");
        cloudsNode.put("all", cloudCover);

        if (rain > 0) {
            normalized.putObject("rain").put("1h", rain);
        }

        ArrayNode weatherArray = normalized.putArray("weather");
        ObjectNode weatherNode = weatherArray.addObject();
        weatherNode.put("id", weatherCode);
        weatherNode.put("description", description);

        normalized.put("visibility", 10000);
        normalized.put("provider", "synthetic-fallback");
        normalized.put("fallbackReason", sourceError == null ? "unknown" : sourceError.getMessage());

        return normalized;
    }

    private record CachedWeather(JsonNode data, Instant fetchedAt) {
        private boolean isFresh(Duration ttl) {
            return fetchedAt.plus(ttl).isAfter(Instant.now());
        }
    }
}
