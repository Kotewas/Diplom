package com.diplom.dispatcher.flight;

import com.diplom.dispatcher.airport.AirportCatalogService;
import com.diplom.dispatcher.airport.AirportDto;
import com.diplom.dispatcher.weather.WeatherService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
    private static final String AIRCRAFT_TYPE_AIRPLANE = "AIRPLANE";
    private static final String AIRCRAFT_TYPE_HELICOPTER = "HELICOPTER";
    private static final double AIRPLANE_CRUISE_SPEED_KMH = 820.0;
    private static final long AIRPLANE_OPERATIONS_MINUTES = 25;
    private static final long AIRPLANE_MIN_TOTAL_FLIGHT_MINUTES = 35;
    private static final double HELICOPTER_CRUISE_SPEED_KMH = 220.0;
    private static final long HELICOPTER_OPERATIONS_MINUTES = 12;
    private static final long HELICOPTER_MIN_TOTAL_FLIGHT_MINUTES = 18;
    private static final Pattern AIRPLANE_FLIGHT_NUMBER_PATTERN = Pattern.compile("^[A-Z]{2}[1-9][0-9]{0,3}$");
    private static final Pattern HELICOPTER_FLIGHT_NUMBER_PATTERN = Pattern.compile("^H[1-9][0-9]{0,3}$");
    private static final int MIN_DELAY_MINUTES = 5;
    private static final int MAX_DELAY_MINUTES = 360;
    private static final int AUTO_APPROVE_MAX_RISK = 45;
    private static final int AUTO_DELAY_MAX_RISK = 75;
    private static final int AUTO_DELAY_MINUTES = 30;

    private final FlightRepository flightRepository;
    private final FlightHistoryRepository flightHistoryRepository;
    private final AirportCatalogService airportCatalogService;
    private final WeatherService weatherService;
    private final ObjectMapper objectMapper;

    public FlightService(
            FlightRepository flightRepository,
            FlightHistoryRepository flightHistoryRepository,
            AirportCatalogService airportCatalogService,
            WeatherService weatherService,
            ObjectMapper objectMapper
    ) {
        this.flightRepository = flightRepository;
        this.flightHistoryRepository = flightHistoryRepository;
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

    public List<FlightHistoryDto> getFlightHistory(String flightId) {
        if (!flightRepository.existsById(flightId)) {
            throw new IllegalArgumentException("Рейс не найден: " + flightId);
        }
        return flightHistoryRepository.findAllByFlightIdOrderByChangedAtDesc(flightId).stream()
                .map(this::toHistoryDto)
                .toList();
    }

    public FlightDto createFlight(CreateFlightRequest request) {
        validateRequest(request);

        Instant now = Instant.now();
        String aircraftType = resolveAircraftType(request.aircraftType());
        String normalizedFlightNumber = normalizeFlightNumber(request.flightNumber());

        FlightEntity entity = new FlightEntity();
        entity.setId(generateFlightId());
        entity.setCreatedAt(now);
        entity.setFlightNumber(normalizedFlightNumber);
        entity.setAircraftType(aircraftType);
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
        applyAutomaticDecision(entity, now);

        FlightEntity saved = flightRepository.save(entity);
        return toDto(saved);
    }

    public FlightDto refreshRiskNow(String flightId) {
        FlightEntity flight = findFlightOrThrow(flightId);
        int oldTotalRisk = flight.getTotalRisk();
        JsonNode oldWeather = captureFlightWeatherSnapshot(flight);
        recalculateRisk(flight, Instant.now());
        FlightEntity saved = flightRepository.save(flight);
        saveFlightHistoryEvent(saved, oldTotalRisk, saved.getTotalRisk(), oldWeather, saved.getDispatcherDecision(), saved.getDispatcherDecisionReason(), saved.getDispatcherDecisionDelayMinutes());
        return toDto(saved);
    }

    public FlightDto applyDispatcherDecision(String flightId, ApplyDecisionRequest request) {
        FlightEntity flight = findFlightOrThrow(flightId);

        DispatcherDecision decision = resolveDispatcherDecision(request.decision());
        if (decision == DispatcherDecision.PENDING) {
            throw new IllegalArgumentException("Решение PENDING нельзя применить вручную");
        }

        String reason = request.reason() == null ? "" : request.reason().trim();
        if (reason.isBlank()) {
            throw new IllegalArgumentException("Укажите объяснение решения диспетчера");
        }

        int oldTotalRisk = flight.getTotalRisk();
        JsonNode oldWeather = captureFlightWeatherSnapshot(flight);
        Instant now = Instant.now();

        if (decision == DispatcherDecision.DELAY) {
            int delayMinutes = validateDelayMinutes(request.delayMinutes());
            flight.setDepartureAt(flight.getDepartureAt().plusMinutes(delayMinutes));
            if (flight.getArrivalAt() != null) {
                flight.setArrivalAt(flight.getArrivalAt().plusMinutes(delayMinutes));
            }
            flight.setDispatcherDecisionDelayMinutes(delayMinutes);
            recalculateRisk(flight, now);
        } else {
            flight.setDispatcherDecisionDelayMinutes(null);
            if (decision == DispatcherDecision.APPROVE) {
                recalculateRisk(flight, now);
            }
        }

        flight.setDispatcherDecision(decision);
        flight.setDispatcherDecisionReason(reason);
        flight.setDispatcherDecisionAt(now);

        FlightEntity saved = flightRepository.save(flight);
        saveFlightHistoryEvent(saved, oldTotalRisk, saved.getTotalRisk(), oldWeather, decision, reason, flight.getDispatcherDecisionDelayMinutes());
        return toDto(saved);
    }

    public WhatIfDelayResponse simulateDelay(String flightId, int delayMinutes) {
        FlightEntity flight = findFlightOrThrow(flightId);
        int safeDelay = validateDelayMinutes(delayMinutes);

        AirportDto fromAirport = airportCatalogService.getById(flight.getFromAirportId())
                .orElseThrow(() -> new IllegalArgumentException("Airport is not found: " + flight.getFromAirportId()));
        AirportDto toAirport = airportCatalogService.getById(flight.getToAirportId())
                .orElseThrow(() -> new IllegalArgumentException("Airport is not found: " + flight.getToAirportId()));

        JsonNode depWeather = weatherService.getWeatherByAirportId(flight.getFromAirportId());
        JsonNode arrWeather = weatherService.getWeatherByAirportId(flight.getToAirportId());

        FlightRiskDto departureRisk = evaluateSurfaceRisk(depWeather);
        FlightRiskDto arrivalRisk = evaluateSurfaceRisk(arrWeather);
        FlightRiskDto cruiseRisk = evaluateCruiseRisk(fromAirport, toAirport, depWeather, arrWeather);
        int currentRisk = clampScore(
                departureRisk.score() * 0.4
                        + arrivalRisk.score() * 0.4
                        + cruiseRisk.score() * 0.2
        );

        int simulatedRisk = adjustRiskForDelay(currentRisk, safeDelay, depWeather, arrWeather);
        LocalDateTime currentDeparture = flight.getDepartureAt();
        LocalDateTime currentArrival = flight.getArrivalAt() != null
                ? flight.getArrivalAt()
                : estimateArrivalAt(
                        flight.getDepartureAt(),
                        flight.getFromAirportId(),
                        flight.getToAirportId(),
                        resolveAircraftType(flight.getAircraftType())
                );
        LocalDateTime simulatedDeparture = currentDeparture == null ? null : currentDeparture.plusMinutes(safeDelay);
        LocalDateTime simulatedArrival = currentArrival == null ? null : currentArrival.plusMinutes(safeDelay);
        int delta = simulatedRisk - currentRisk;

        String recommendation;
        if (delta <= -10) {
            recommendation = "Задержка существенно снижает риск";
        } else if (delta <= -4) {
            recommendation = "Задержка умеренно снижает риск";
        } else if (delta < 4) {
            recommendation = "Задержка почти не меняет уровень риска";
        } else {
            recommendation = "Задержка повышает риск, рекомендуется повторная проверка";
        }

        return new WhatIfDelayResponse(
                currentRisk,
                simulatedRisk,
                delta,
                currentDeparture,
                simulatedDeparture,
                currentArrival,
                simulatedArrival,
                getFeasibility(currentRisk),
                getFeasibility(simulatedRisk),
                recommendation
        );
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
                int oldTotalRisk = flight.getTotalRisk();
                JsonNode oldWeather = captureFlightWeatherSnapshot(flight);
                recalculateRisk(flight, now);
                changed.add(flight);
                saveFlightHistoryEvent(flight, oldTotalRisk, flight.getTotalRisk(), oldWeather, flight.getDispatcherDecision(), flight.getDispatcherDecisionReason(), flight.getDispatcherDecisionDelayMinutes());
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
            flight.setArrivalAt(estimateArrivalAt(
                    flight.getDepartureAt(),
                    flight.getFromAirportId(),
                    flight.getToAirportId(),
                    resolveAircraftType(flight.getAircraftType())
            ));
        }

        flight.setRiskUpdatedAt(now);
        applyAutomaticDecision(flight, now);
    }

    private void applyAutomaticDecision(FlightEntity flight, Instant now) {
        if (flight == null) {
            return;
        }

        DispatcherDecision currentDecision = flight.getDispatcherDecision();
        boolean isManualDecision = currentDecision != null
                && currentDecision != DispatcherDecision.PENDING
                && !isAutomaticDecisionReason(flight.getDispatcherDecisionReason());
        if (isManualDecision) {
            return;
        }

        int totalRisk = flight.getTotalRisk() == null ? 0 : flight.getTotalRisk();
        DispatcherDecision nextDecision;
        Integer nextDelayMinutes = null;
        String nextReason;

        if (totalRisk > AUTO_DELAY_MAX_RISK) {
            nextDecision = DispatcherDecision.CANCEL;
            nextReason = "AUTO: высокий риск, автоматическая отмена";
        } else if (totalRisk > AUTO_APPROVE_MAX_RISK) {
            nextDecision = DispatcherDecision.DELAY;
            nextDelayMinutes = AUTO_DELAY_MINUTES;
            nextReason = "AUTO: повышенный риск, автоматическая задержка";
        } else {
            nextDecision = DispatcherDecision.APPROVE;
            nextReason = "AUTO: риск приемлем, автоматическое разрешение";
        }

        boolean changed = currentDecision != nextDecision
                || !equalsNullable(flight.getDispatcherDecisionDelayMinutes(), nextDelayMinutes)
                || !nextReason.equals(flight.getDispatcherDecisionReason());
        if (!changed) {
            return;
        }

        flight.setDispatcherDecision(nextDecision);
        flight.setDispatcherDecisionDelayMinutes(nextDelayMinutes);
        flight.setDispatcherDecisionReason(nextReason);
        flight.setDispatcherDecisionAt(now);
    }

    private boolean isAutomaticDecisionReason(String reason) {
        return reason != null && reason.startsWith("AUTO:");
    }

    private boolean equalsNullable(Integer left, Integer right) {
        return left == null ? right == null : left.equals(right);
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

        String aircraftType = resolveAircraftType(request.aircraftType());
        String normalizedFlightNumber = normalizeFlightNumber(request.flightNumber());
        boolean isValidNumber = AIRCRAFT_TYPE_HELICOPTER.equals(aircraftType)
                ? HELICOPTER_FLIGHT_NUMBER_PATTERN.matcher(normalizedFlightNumber).matches()
                : AIRPLANE_FLIGHT_NUMBER_PATTERN.matcher(normalizedFlightNumber).matches();
        if (!isValidNumber) {
            if (AIRCRAFT_TYPE_HELICOPTER.equals(aircraftType)) {
                throw new IllegalArgumentException("Номер вертолета должен быть в формате H и 1-4 цифры без ведущего нуля (пример: H123)");
            }
            throw new IllegalArgumentException("Номер рейса должен быть в формате IATA: 2 буквы и 1-4 цифры без ведущего нуля (пример: SU123)");
        }

        LocalDateTime now = LocalDateTime.now();
        List<FlightEntity> flightsWithSameNumber = flightRepository.findAllByFlightNumber(normalizedFlightNumber);
        boolean hasActiveFlightWithSameNumber = flightsWithSameNumber.stream().anyMatch(existing -> {
            LocalDateTime existingDeparture = existing.getDepartureAt();
            LocalDateTime existingArrival = existing.getArrivalAt();
            if (existingDeparture == null) {
                return true;
            }
            if (existingDeparture.isAfter(now)) {
                return true; // еще не вылетел
            }
            if (existingArrival == null) {
                return true; // нет факта завершения
            }
            return existingArrival.isAfter(now); // в полете
        });
        if (hasActiveFlightWithSameNumber) {
            throw new IllegalArgumentException("Этот номер рейса уже занят активным рейсом (не вылетел или в полете)");
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

    private DispatcherDecision resolveDispatcherDecision(String rawDecision) {
        if (rawDecision == null || rawDecision.isBlank()) {
            return DispatcherDecision.PENDING;
        }
        try {
            return DispatcherDecision.valueOf(rawDecision.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Неизвестный тип решения диспетчера: " + rawDecision);
        }
    }

    private int validateDelayMinutes(Integer delayMinutes) {
        if (delayMinutes == null) {
            throw new IllegalArgumentException("Укажите величину задержки в минутах");
        }
        if (delayMinutes < MIN_DELAY_MINUTES || delayMinutes > MAX_DELAY_MINUTES) {
            throw new IllegalArgumentException("Задержка должна быть в диапазоне 5-360 минут");
        }
        if (delayMinutes % 5 != 0) {
            throw new IllegalArgumentException("Задержка должна быть кратна 5 минутам");
        }
        return delayMinutes;
    }

    private int adjustRiskForDelay(int currentRisk, int delayMinutes, JsonNode depWeather, JsonNode arrWeather) {
        double depWind = safeNumber(depWeather.path("wind").path("speed"), 0);
        double arrWind = safeNumber(arrWeather.path("wind").path("speed"), 0);
        double depGust = safeNumber(depWeather.path("wind").path("gust"), depWind);
        double arrGust = safeNumber(arrWeather.path("wind").path("gust"), arrWind);
        double depPrecip = Math.max(
                safeNumber(depWeather.path("rain").path("1h"), 0),
                safeNumber(depWeather.path("snow").path("1h"), 0)
        );
        double arrPrecip = Math.max(
                safeNumber(arrWeather.path("rain").path("1h"), 0),
                safeNumber(arrWeather.path("snow").path("1h"), 0)
        );
        int depCode = (int) safeNumber(depWeather.path("weather").path(0).path("id"), 800);
        int arrCode = (int) safeNumber(arrWeather.path("weather").path(0).path("id"), 800);

        int dangerSignals = 0;
        if (depCode >= 200 && depCode < 300) dangerSignals += 3;
        if (arrCode >= 200 && arrCode < 300) dangerSignals += 3;
        if (depWind >= 15 || arrWind >= 15) dangerSignals += 2;
        if (depGust >= 20 || arrGust >= 20) dangerSignals += 2;
        if (depPrecip >= 2 || arrPrecip >= 2) dangerSignals += 2;
        if (depCode == 741 || depCode == 701 || arrCode == 741 || arrCode == 701) dangerSignals += 1;

        double baseEffect = Math.min(24, delayMinutes * 0.22);
        double reductionMultiplier = 0.25 + (dangerSignals * 0.18);

        int adjustedRisk;
        if (dangerSignals == 0 && currentRisk < 45) {
            adjustedRisk = clampScore(currentRisk + Math.min(5, delayMinutes * 0.05));
        } else {
            adjustedRisk = clampScore(currentRisk - baseEffect * reductionMultiplier);
        }

        return adjustedRisk;
    }

    private String resolveAircraftType(String aircraftTypeRaw) {
        if (aircraftTypeRaw == null || aircraftTypeRaw.isBlank()) {
            return AIRCRAFT_TYPE_AIRPLANE;
        }
        return AIRCRAFT_TYPE_HELICOPTER.equalsIgnoreCase(aircraftTypeRaw)
                ? AIRCRAFT_TYPE_HELICOPTER
                : AIRCRAFT_TYPE_AIRPLANE;
    }

    private String generateFlightId() {
        return "flight_" + Instant.now().toEpochMilli() + "_" + UUID.randomUUID().toString().substring(0, 8);
    }

    private FlightDto toDto(FlightEntity entity) {
        LocalDateTime arrivalAt = entity.getArrivalAt() != null
                ? entity.getArrivalAt()
                : estimateArrivalAt(
                entity.getDepartureAt(),
                entity.getFromAirportId(),
                entity.getToAirportId(),
                resolveAircraftType(entity.getAircraftType())
        );

        return new FlightDto(
                entity.getId(),
                entity.getCreatedAt(),
                entity.getFlightNumber(),
                resolveAircraftType(entity.getAircraftType()),
                entity.getDepartureAt(),
                arrivalAt,
                entity.getFromAirportId(),
                entity.getToAirportId(),
                new FlightRiskDto(entity.getDepartureRiskScore(), fromJson(entity.getDepartureRiskFactors())),
                new FlightRiskDto(entity.getArrivalRiskScore(), fromJson(entity.getArrivalRiskFactors())),
                new FlightRiskDto(entity.getCruiseRiskScore(), fromJson(entity.getCruiseRiskFactors())),
                entity.getTotalRisk(),
                new FeasibilityDto(entity.getFeasibilityLabel(), entity.getFeasibilityClassName()),
                entity.getRiskUpdatedAt(),
                (entity.getDispatcherDecision() == null ? DispatcherDecision.PENDING : entity.getDispatcherDecision()).name(),
                entity.getDispatcherDecisionReason(),
                entity.getDispatcherDecisionAt(),
                entity.getDispatcherDecisionDelayMinutes()
        );
    }

    private void saveFlightHistoryEvent(
            FlightEntity flight,
            Integer oldTotalRisk,
            Integer newTotalRisk,
            JsonNode oldWeather,
            DispatcherDecision dispatcherDecision,
            String dispatcherDecisionReason,
            Integer dispatcherDecisionDelayMinutes
    ) {
        FlightHistoryEntity history = new FlightHistoryEntity();
        history.setId("flight_history_" + Instant.now().toEpochMilli() + "_" + UUID.randomUUID().toString().substring(0, 8));
        history.setFlightId(flight.getId());
        history.setChangedAt(Instant.now());
        history.setOldTotalRisk(oldTotalRisk);
        history.setNewTotalRisk(newTotalRisk);
        history.setOldWeather(oldWeather == null ? "" : oldWeather.toString());
        history.setDispatcherDecision(dispatcherDecision == null ? DispatcherDecision.PENDING : dispatcherDecision);
        history.setDispatcherDecisionReason(dispatcherDecisionReason == null ? "" : dispatcherDecisionReason);
        history.setDispatcherDecisionDelayMinutes(dispatcherDecisionDelayMinutes);
        flightHistoryRepository.save(history);
    }

    private FlightHistoryDto toHistoryDto(FlightHistoryEntity entity) {
        return new FlightHistoryDto(
                entity.getId(),
                entity.getFlightId(),
                entity.getChangedAt(),
                entity.getOldTotalRisk(),
                entity.getNewTotalRisk(),
                entity.getOldWeather(),
                entity.getDispatcherDecision().name(),
                entity.getDispatcherDecisionReason(),
                entity.getDispatcherDecisionDelayMinutes()
        );
    }

    private JsonNode captureFlightWeatherSnapshot(FlightEntity flight) {
        ObjectNode snapshot = objectMapper.createObjectNode();
        snapshot.set("departure", weatherService.getWeatherByAirportId(flight.getFromAirportId()));
        snapshot.set("arrival", weatherService.getWeatherByAirportId(flight.getToAirportId()));
        return snapshot;
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
        return estimateArrivalAt(
                request.departureAt(),
                request.fromAirportId(),
                request.toAirportId(),
                resolveAircraftType(request.aircraftType())
        );
    }

    private LocalDateTime estimateArrivalAt(
            LocalDateTime departureAt,
            String fromAirportId,
            String toAirportId,
            String aircraftType
    ) {
        if (departureAt == null || fromAirportId == null || toAirportId == null) {
            return null;
        }

        AirportDto fromAirport = airportCatalogService.getById(fromAirportId).orElse(null);
        AirportDto toAirport = airportCatalogService.getById(toAirportId).orElse(null);
        if (fromAirport == null || toAirport == null) {
            return null;
        }

        boolean helicopter = AIRCRAFT_TYPE_HELICOPTER.equals(resolveAircraftType(aircraftType));
        double cruiseSpeed = helicopter ? HELICOPTER_CRUISE_SPEED_KMH : AIRPLANE_CRUISE_SPEED_KMH;
        long operationsMinutes = helicopter ? HELICOPTER_OPERATIONS_MINUTES : AIRPLANE_OPERATIONS_MINUTES;
        long minTotalMinutes = helicopter ? HELICOPTER_MIN_TOTAL_FLIGHT_MINUTES : AIRPLANE_MIN_TOTAL_FLIGHT_MINUTES;

        double distanceKm = haversineDistanceKm(fromAirport.lat(), fromAirport.lon(), toAirport.lat(), toAirport.lon());
        long enrouteMinutes = Math.round((distanceKm / cruiseSpeed) * 60.0);
        long totalMinutes = Math.max(minTotalMinutes, enrouteMinutes + operationsMinutes);
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
