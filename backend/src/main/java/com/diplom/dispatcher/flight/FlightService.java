package com.diplom.dispatcher.flight;

import com.diplom.dispatcher.airport.AirportCatalogService;
import com.diplom.dispatcher.airport.AirportDto;
import com.diplom.dispatcher.weather.WeatherService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class FlightService {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };
    private static final double EARTH_RADIUS_KM = 6371.0;
    private static final double AVERAGE_CRUISE_SPEED_KMH = 820.0;
    private static final long AIRPORT_OPERATIONS_MINUTES = 25;
    private static final long MIN_TOTAL_FLIGHT_MINUTES = 35;
    private static final Pattern FLIGHT_NUMBER_PATTERN = Pattern.compile("^[A-Z]{2}[1-9][0-9]{0,3}$");

    private final FlightRepository flightRepository;
    private final AirportCatalogService airportCatalogService;
    private final WeatherService weatherService;
    private final ObjectMapper objectMapper;

    public FlightService(
            FlightRepository flightRepository,
            AirportCatalogService airportCatalogService,
            WeatherService weatherService,
            ObjectMapper objectMapper
    ) {
        this.flightRepository = flightRepository;
        this.airportCatalogService = airportCatalogService;
        this.weatherService = weatherService;
        this.objectMapper = objectMapper;
    }

    public List<FlightDto> getAllFlights() {
        List<FlightEntity> flights = flightRepository.findAllByOrderByCreatedAtDesc();
        refreshDueFlightRisks(flights);
        return flights.stream()
                .map(this::toDto)
                .toList();
    }

    public FlightDto createFlight(CreateFlightRequest request) {
        validateRequest(request);

        Instant now = Instant.now();
        String normalizedFlightNumber = normalizeFlightNumber(request.flightNumber());

        FlightEntity entity = new FlightEntity();
        entity.setId(generateFlightId());
        entity.setCreatedAt(now);
        entity.setFlightNumber(normalizedFlightNumber);
        entity.setDepartureAt(request.departureAt());
        entity.setArrivalAt(resolveArrivalAt(request));
        entity.setFromAirportId(request.fromAirportId());
        entity.setToAirportId(request.toAirportId());

        entity.setDepartureRiskScore(request.departureRisk().score());
        entity.setArrivalRiskScore(request.arrivalRisk().score());
        entity.setCruiseRiskScore(request.cruiseRisk().score());
        entity.setTotalRisk(request.totalRisk());

        entity.setDepartureRiskFactors(toJson(request.departureRisk().factors()));
        entity.setArrivalRiskFactors(toJson(request.arrivalRisk().factors()));
        entity.setCruiseRiskFactors(toJson(request.cruiseRisk().factors()));

        entity.setFeasibilityLabel(request.feasibility().label());
        entity.setFeasibilityClassName(request.feasibility().className());
        entity.setRiskUpdatedAt(now);

        FlightEntity saved = flightRepository.save(entity);
        return toDto(saved);
    }

    public FlightDto refreshRiskNow(String flightId) {
        FlightEntity flight = findFlightOrThrow(flightId);
        recalculateRisk(flight, Instant.now());
        FlightEntity saved = flightRepository.save(flight);
        return toDto(saved);
    }

    @Transactional
    public void cancelFlight(String flightId) {
        if (!flightRepository.existsById(flightId)) {
            throw new IllegalArgumentException("Рейс не найден: " + flightId);
        }

        flightRepository.deleteById(flightId);
        flightRepository.flush();
    }

    @Scheduled(fixedDelayString = "${app.risk-refresh.tick-ms:3600000}")
    public void refreshDueFlightRisksBySchedule() {
        List<FlightEntity> flights = flightRepository.findAllByOrderByCreatedAtDesc();
        refreshDueFlightRisks(flights);
    }

    private void refreshDueFlightRisks(List<FlightEntity> flights) {
        if (flights == null || flights.isEmpty()) {
            return;
        }

        Instant now = Instant.now();
        LocalDateTime nowLocal = LocalDateTime.now();
        List<FlightEntity> changed = new ArrayList<>();

        for (FlightEntity flight : flights) {
            if (!isRiskRefreshDue(flight, now, nowLocal)) {
                continue;
            }

            try {
                recalculateRisk(flight, now);
                changed.add(flight);
            } catch (Exception ignored) {
                // Keep old risk if weather API is temporarily unavailable.
            }
        }

        if (!changed.isEmpty()) {
            flightRepository.saveAll(changed);
        }
    }

    private FlightEntity findFlightOrThrow(String flightId) {
        return flightRepository.findById(flightId)
                .orElseThrow(() -> new IllegalArgumentException("Рейс не найден: " + flightId));
    }

    private boolean isRiskRefreshDue(FlightEntity flight, Instant now, LocalDateTime nowLocal) {
        LocalDateTime departureAt = flight.getDepartureAt();
        if (departureAt == null || !departureAt.isAfter(nowLocal)) {
            return false;
        }

        Duration untilDeparture = Duration.between(nowLocal, departureAt);
        Duration refreshInterval = resolveRefreshInterval(untilDeparture);

        Instant lastUpdate = flight.getRiskUpdatedAt() != null
                ? flight.getRiskUpdatedAt()
                : flight.getCreatedAt();

        if (lastUpdate == null) {
            return true;
        }

        return !lastUpdate.plus(refreshInterval).isAfter(now);
    }

    private Duration resolveRefreshInterval(Duration untilDeparture) {
        long hours = untilDeparture.toHours();

        if (hours < 12) {
            return Duration.ofHours(3);
        }
        if (hours < 24) {
            return Duration.ofHours(6);
        }
        return Duration.ofHours(24);
    }

    private void recalculateRisk(FlightEntity flight, Instant now) {
        AirportDto fromAirport = airportCatalogService.getById(flight.getFromAirportId())
                .orElseThrow(() -> new IllegalArgumentException("Airport is not found: " + flight.getFromAirportId()));
        AirportDto toAirport = airportCatalogService.getById(flight.getToAirportId())
                .orElseThrow(() -> new IllegalArgumentException("Airport is not found: " + flight.getToAirportId()));

        JsonNode depWeather = weatherService.getWeatherByAirportId(flight.getFromAirportId());
        JsonNode arrWeather = weatherService.getWeatherByAirportId(flight.getToAirportId());

        FlightRiskDto departureRisk = evaluateSurfaceRisk(depWeather);
        FlightRiskDto arrivalRisk = evaluateSurfaceRisk(arrWeather);
        FlightRiskDto cruiseRisk = evaluateCruiseRisk(fromAirport, toAirport, depWeather, arrWeather);

        int totalRisk = clampScore(
                departureRisk.score() * 0.4
                        + arrivalRisk.score() * 0.4
                        + cruiseRisk.score() * 0.2
        );

        FeasibilityDto feasibility = getFeasibility(totalRisk);

        flight.setDepartureRiskScore(departureRisk.score());
        flight.setArrivalRiskScore(arrivalRisk.score());
        flight.setCruiseRiskScore(cruiseRisk.score());
        flight.setTotalRisk(totalRisk);

        flight.setDepartureRiskFactors(toJson(departureRisk.factors()));
        flight.setArrivalRiskFactors(toJson(arrivalRisk.factors()));
        flight.setCruiseRiskFactors(toJson(cruiseRisk.factors()));

        flight.setFeasibilityLabel(feasibility.label());
        flight.setFeasibilityClassName(feasibility.className());

        if (flight.getArrivalAt() == null) {
            flight.setArrivalAt(estimateArrivalAt(flight.getDepartureAt(), flight.getFromAirportId(), flight.getToAirportId()));
        }

        flight.setRiskUpdatedAt(now);
    }

    private FlightRiskDto evaluateSurfaceRisk(JsonNode weather) {
        if (weather == null || weather.isMissingNode()) {
            return new FlightRiskDto(85, List.of("Нет метеоданных для аэропорта"));
        }

        double wind = safeNumber(weather.path("wind").path("speed"), 0);
        double gust = safeNumber(weather.path("wind").path("gust"), wind);
        double visibility = safeNumber(weather.path("visibility"), 10000);
        double pressure = safeNumber(weather.path("main").path("pressure"), 1013);
        double temp = safeNumber(weather.path("main").path("temp"), 15);
        double cloudiness = safeNumber(weather.path("clouds").path("all"), 0);
        double rainPerHour = safeNumber(weather.path("rain").path("1h"), 0);
        double snowPerHour = safeNumber(weather.path("snow").path("1h"), 0);
        double precipPerHour = Math.max(rainPerHour, snowPerHour);
        int weatherCode = (int) safeNumber(weather.path("weather").path(0).path("id"), 800);

        double score = 0;
        List<String> factors = new ArrayList<>();

        if (wind >= 8) {
            score += 8;
            factors.add("Умеренный ветер " + formatOneDecimal(wind) + " м/с");
        }

        if (wind >= 12) {
            score += 10;
            factors.add("Ветер " + formatOneDecimal(wind) + " м/с");
        }
        if (wind >= 18) {
            score += 12;
        }

        if (gust >= 12) {
            score += 7;
            factors.add("Порывы " + formatOneDecimal(gust) + " м/с");
        }

        if (gust >= 20) {
            score += 12;
        }

        if (visibility < 8000) {
            score += 6;
            factors.add("Сниженная видимость " + Math.round(visibility) + " м");
        }

        if (visibility < 5000) {
            score += 10;
            factors.add("Видимость " + Math.round(visibility) + " м");
        }
        if (visibility < 1500) {
            score += 18;
        }

        if (pressure < 995 || pressure > 1030) {
            score += 5;
            factors.add("Нестабильное давление " + Math.round(pressure) + " гПа");
        }

        if (pressure < 985 || pressure > 1035) {
            score += 6;
            factors.add("Давление " + Math.round(pressure) + " гПа");
        }

        if (temp <= -30 || temp >= 38) {
            score += 8;
            factors.add("Экстремальная температура " + formatOneDecimal(temp) + " C");
        }

        if (cloudiness >= 85) {
            score += 4;
            factors.add("Плотная облачность " + Math.round(cloudiness) + "%");
        }

        if (precipPerHour >= 0.2) {
            score += 6;
            factors.add("Осадки " + formatOneDecimal(precipPerHour) + " мм/ч");
        }
        if (precipPerHour >= 1) {
            score += 8;
        }

        if (weatherCode >= 200 && weatherCode < 300) {
            score += 34;
            factors.add("Грозовая активность");
        } else if (weatherCode >= 300 && weatherCode < 600) {
            score += 14;
            factors.add("Осадки");
        } else if (weatherCode == 741 || weatherCode == 701) {
            score += 16;
            factors.add("Туман / дымка");
        }

        return new FlightRiskDto(clampScore(score), factors);
    }

    private FlightRiskDto evaluateCruiseRisk(
            AirportDto fromAirport,
            AirportDto toAirport,
            JsonNode depWeather,
            JsonNode arrWeather
    ) {
        double distanceKm = haversineDistanceKm(fromAirport.lat(), fromAirport.lon(), toAirport.lat(), toAirport.lon());
        double depWind = safeNumber(depWeather.path("wind").path("speed"), 0);
        double arrWind = safeNumber(arrWeather.path("wind").path("speed"), 0);
        double depPressure = safeNumber(depWeather.path("main").path("pressure"), 1013);
        double arrPressure = safeNumber(arrWeather.path("main").path("pressure"), 1013);

        double score = 10;
        List<String> factors = new ArrayList<>();

        if (distanceKm >= 2000) {
            score += 10;
            factors.add("Дальний маршрут");
        }
        if (distanceKm >= 4000) {
            score += 12;
        }

        double avgAbsLat = (Math.abs(fromAirport.lat()) + Math.abs(toAirport.lat())) / 2;
        if (avgAbsLat >= 50) {
            score += 12;
            factors.add("Вероятная зона струйных течений");
        }

        double windProxy = Math.max(depWind, arrWind);
        if (windProxy >= 14) {
            score += 10;
            factors.add("Сильный ветровой фон в концах маршрута");
        }
        if (windProxy >= 20) {
            score += 10;
        }

        double pressureDelta = Math.abs(depPressure - arrPressure);
        if (pressureDelta >= 20) {
            score += 8;
            factors.add("Высокий барический контраст");
        }
        if (pressureDelta >= 35) {
            score += 8;
        }

        return new FlightRiskDto(clampScore(score), factors);
    }

    private int clampScore(double value) {
        return Math.max(0, Math.min(100, (int) Math.round(value)));
    }

    private FeasibilityDto getFeasibility(int totalRisk) {
        if (totalRisk <= 30) {
            return new FeasibilityDto("Высокая реализуемость", "risk-low");
        }
        if (totalRisk <= 55) {
            return new FeasibilityDto("Средняя реализуемость", "risk-medium");
        }
        if (totalRisk <= 75) {
            return new FeasibilityDto("Низкая реализуемость", "risk-high");
        }
        return new FeasibilityDto("Не рекомендовано", "risk-critical");
    }

    private double safeNumber(JsonNode value, double fallback) {
        if (value == null || value.isMissingNode() || value.isNull()) {
            return fallback;
        }
        return value.isNumber() ? value.asDouble() : fallback;
    }

    private String formatOneDecimal(double value) {
        return String.format(Locale.US, "%.1f", value);
    }

    private void validateRequest(CreateFlightRequest request) {
        if (request.fromAirportId().equals(request.toAirportId())) {
            throw new IllegalArgumentException("Аэропорт вылета и аэропорт прилета не должны совпадать");
        }

        if (!request.departureAt().isAfter(LocalDateTime.now())) {
            throw new IllegalArgumentException("Нельзя создать рейс в прошлом");
        }

        if (request.arrivalAt() != null && !request.departureAt().isBefore(request.arrivalAt())) {
            throw new IllegalArgumentException("Вылет должен быть раньше прилета");
        }

        String normalizedFlightNumber = normalizeFlightNumber(request.flightNumber());
        if (!FLIGHT_NUMBER_PATTERN.matcher(normalizedFlightNumber).matches()) {
            throw new IllegalArgumentException("Номер рейса должен быть в формате IATA: 2 буквы и 1-4 цифры без ведущего нуля (пример: SU123)");
        }

        List<FlightEntity> flightsWithSameNumber = flightRepository.findAllByFlightNumber(normalizedFlightNumber);
        boolean hasAnotherRouteForSameNumber = flightsWithSameNumber.stream().anyMatch(existing ->
                !existing.getFromAirportId().equals(request.fromAirportId())
                        || !existing.getToAirportId().equals(request.toAirportId())
        );
        if (hasAnotherRouteForSameNumber) {
            throw new IllegalArgumentException("Один номер рейса может использоваться только для одного маршрута");
        }

        if (flightRepository.existsByFlightNumberAndDepartureAt(normalizedFlightNumber, request.departureAt())) {
            throw new IllegalArgumentException("Дубликат: рейс с таким номером и временем вылета уже существует");
        }

        boolean hasFromAirport = airportCatalogService.getById(request.fromAirportId()).isPresent();
        boolean hasToAirport = airportCatalogService.getById(request.toAirportId()).isPresent();

        if (!hasFromAirport || !hasToAirport) {
            throw new IllegalArgumentException("One or both airports are unknown");
        }
    }

    private String normalizeFlightNumber(String flightNumber) {
        return flightNumber == null ? "" : flightNumber.trim().toUpperCase();
    }

    private String generateFlightId() {
        return "flight_" + Instant.now().toEpochMilli() + "_" + UUID.randomUUID().toString().substring(0, 8);
    }

    private FlightDto toDto(FlightEntity entity) {
        LocalDateTime arrivalAt = entity.getArrivalAt() != null
                ? entity.getArrivalAt()
                : estimateArrivalAt(entity.getDepartureAt(), entity.getFromAirportId(), entity.getToAirportId());

        return new FlightDto(
                entity.getId(),
                entity.getCreatedAt(),
                entity.getFlightNumber(),
                entity.getDepartureAt(),
                arrivalAt,
                entity.getFromAirportId(),
                entity.getToAirportId(),
                new FlightRiskDto(entity.getDepartureRiskScore(), fromJson(entity.getDepartureRiskFactors())),
                new FlightRiskDto(entity.getArrivalRiskScore(), fromJson(entity.getArrivalRiskFactors())),
                new FlightRiskDto(entity.getCruiseRiskScore(), fromJson(entity.getCruiseRiskFactors())),
                entity.getTotalRisk(),
                new FeasibilityDto(entity.getFeasibilityLabel(), entity.getFeasibilityClassName())
        );
    }

    private String toJson(List<String> value) {
        try {
            return objectMapper.writeValueAsString(value == null ? List.of() : value);
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot serialize factors", exception);
        }
    }

    private List<String> fromJson(String value) {
        try {
            if (value == null || value.isBlank()) {
                return List.of();
            }
            return objectMapper.readValue(value, STRING_LIST);
        } catch (Exception exception) {
            return List.of();
        }
    }

    private LocalDateTime resolveArrivalAt(CreateFlightRequest request) {
        if (request.arrivalAt() != null) {
            return request.arrivalAt();
        }
        return estimateArrivalAt(request.departureAt(), request.fromAirportId(), request.toAirportId());
    }

    private LocalDateTime estimateArrivalAt(LocalDateTime departureAt, String fromAirportId, String toAirportId) {
        if (departureAt == null || fromAirportId == null || toAirportId == null) {
            return null;
        }

        AirportDto fromAirport = airportCatalogService.getById(fromAirportId).orElse(null);
        AirportDto toAirport = airportCatalogService.getById(toAirportId).orElse(null);
        if (fromAirport == null || toAirport == null) {
            return null;
        }

        double distanceKm = haversineDistanceKm(fromAirport.lat(), fromAirport.lon(), toAirport.lat(), toAirport.lon());
        long enrouteMinutes = Math.round((distanceKm / AVERAGE_CRUISE_SPEED_KMH) * 60.0);
        long totalMinutes = Math.max(MIN_TOTAL_FLIGHT_MINUTES, enrouteMinutes + AIRPORT_OPERATIONS_MINUTES);
        return departureAt.plusMinutes(totalMinutes);
    }

    private double haversineDistanceKm(double lat1, double lon1, double lat2, double lon2) {
        double latDistanceRad = Math.toRadians(lat2 - lat1);
        double lonDistanceRad = Math.toRadians(lon2 - lon1);
        double startLatRad = Math.toRadians(lat1);
        double endLatRad = Math.toRadians(lat2);

        double a = Math.sin(latDistanceRad / 2) * Math.sin(latDistanceRad / 2)
                + Math.cos(startLatRad) * Math.cos(endLatRad)
                * Math.sin(lonDistanceRad / 2) * Math.sin(lonDistanceRad / 2);

        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return EARTH_RADIUS_KM * c;
    }
}
