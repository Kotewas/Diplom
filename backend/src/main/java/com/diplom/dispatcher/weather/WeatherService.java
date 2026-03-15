package com.diplom.dispatcher.weather;

import com.diplom.dispatcher.airport.AirportCatalogService;
import com.diplom.dispatcher.airport.AirportDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
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
        this.restTemplate = new RestTemplate();
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

        JsonNode fresh = fetchWeather(airport);
        cache.put(airportId, new CachedWeather(fresh, Instant.now()));
        return fresh;
    }

    private JsonNode fetchWeather(AirportDto airport) {
        if (weatherApiKey == null || weatherApiKey.isBlank()) {
            throw new IllegalStateException("OpenWeather API key is not configured. Set app.weather.api-key");
        }

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

    private record CachedWeather(JsonNode data, Instant fetchedAt) {
        private boolean isFresh(Duration ttl) {
            return fetchedAt.plus(ttl).isAfter(Instant.now());
        }
    }
}
