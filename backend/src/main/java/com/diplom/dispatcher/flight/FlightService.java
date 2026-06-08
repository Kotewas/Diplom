package com.diplom.dispatcher.flight;

import com.diplom.dispatcher.airport.AirportCatalogService;
import com.diplom.dispatcher.airport.AirportDto;
import com.diplom.dispatcher.realtime.AppUpdateWebSocketHandler;
import com.diplom.dispatcher.weather.WeatherService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class FlightService {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };
    private static final TypeReference<Map<String, Boolean>> BOOLEAN_MAP = new TypeReference<>() {
    };
    private static final TypeReference<Map<String, String>> STRING_MAP = new TypeReference<>() {
    };
    private static final TypeReference<List<MeteorologistRequestDto>> METEOROLOGIST_REQUEST_LIST = new TypeReference<>() {
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
    private static final Pattern AVIATION_WIND_PATTERN = Pattern.compile("\\b(?<dir>\\d{3}|VRB)(?<speed>\\d{2,3})(?:G(?<gust>\\d{2,3}))?(?<unit>MPS|KT)\\b");
    private static final Pattern AVIATION_VISIBILITY_PATTERN = Pattern.compile("\\b(?<visibility>\\d{4})\\b");
    private static final Pattern AVIATION_PRESSURE_PATTERN = Pattern.compile("\\bQ(?<pressure>\\d{4})\\b");
    private static final Pattern AVIATION_TEMP_PATTERN = Pattern.compile("\\b(?<temp>M?\\d{2})/(?<dew>M?\\d{2})\\b");
    private static final Pattern AVIATION_CLOUD_PATTERN = Pattern.compile("\\b(?<cloud>FEW|SCT|BKN|OVC|VV)(?<height>\\d{3}|///)?(?:CB|TCU)?\\b");
    private static final Pattern WIND_SPEED_TEXT_PATTERN = Pattern.compile("(?i)(?<speed>\\d{1,2}(?:[.,]\\d+)?)\\s*(?<unit>м/с|m/s|mps|kt|kts|узл?|узлов)");
    private static final Pattern AVIATION_ICAO_PATTERN = Pattern.compile("\\b[A-Z]{4}\\b");
    private static final Pattern AVIATION_TIME_PATTERN = Pattern.compile("\\b\\d{6}Z\\b");
    private static final Pattern TAF_PERIOD_PATTERN = Pattern.compile("\\b\\d{4}/\\d{4}\\b");
    private static final Pattern LANDING_WIND_TEXT_PATTERN = Pattern.compile("(?iu)\\b(?:\\d{3}|VRB)\\s*(?:°|град(?:ус(?:ов|а)?)?|deg(?:rees?)?)?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*(?:м/с|m/s|mps|kt|kts|узл?|узлов)");
    private static final Pattern LANDING_GUST_TEXT_PATTERN = Pattern.compile("(?iu)\\b(?:(?:G|порыв\\w*\\s*(?:до)?|до)\\s*)?\\d{1,2}(?:[.,]\\d+)?\\s*(?:м/с|m/s|mps|kt|kts|узл?|узлов)");
    private static final Pattern LANDING_VISIBILITY_TEXT_PATTERN = Pattern.compile("\\b\\d{3,5}\\b");
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
    private final AppUpdateWebSocketHandler appUpdateWebSocketHandler;

    public FlightService(
            FlightRepository flightRepository,
            FlightHistoryRepository flightHistoryRepository,
            AirportCatalogService airportCatalogService,
            WeatherService weatherService,
            ObjectMapper objectMapper,
            AppUpdateWebSocketHandler appUpdateWebSocketHandler
    ) {
        this.flightRepository = flightRepository;
        this.flightHistoryRepository = flightHistoryRepository;
        this.airportCatalogService = airportCatalogService;
        this.weatherService = weatherService;
        this.objectMapper = objectMapper;
        this.appUpdateWebSocketHandler = appUpdateWebSocketHandler;
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

        FlightRiskDto departureRisk = request.departureRisk();
        FlightRiskDto arrivalRisk = request.arrivalRisk();
        FlightRiskDto cruiseRisk = withDepartureTimeFactors(request.cruiseRisk(), request.departureAt(), LocalDateTime.now());
        int totalRisk = calculateTotalRisk(departureRisk, arrivalRisk, cruiseRisk);
        FeasibilityDto feasibility = getFeasibility(totalRisk);

        entity.setDepartureRiskScore(departureRisk.score());
        entity.setArrivalRiskScore(arrivalRisk.score());
        entity.setCruiseRiskScore(cruiseRisk.score());
        entity.setTotalRisk(totalRisk);

        entity.setDepartureRiskFactors(toJson(departureRisk.factors()));
        entity.setArrivalRiskFactors(toJson(arrivalRisk.factors()));
        entity.setCruiseRiskFactors(toJson(cruiseRisk.factors()));

        entity.setFeasibilityLabel(feasibility.label());
        entity.setFeasibilityClassName(feasibility.className());
        entity.setRiskUpdatedAt(now);
        applyAutomaticDecision(entity, now);

        FlightEntity saved = flightRepository.save(entity);
        broadcastFlightUpdate("FLIGHT_CREATED", saved);
        return toDto(saved);
    }

    public FlightDto refreshRiskNow(String flightId) {
        FlightEntity flight = findFlightOrThrow(flightId);
        int oldTotalRisk = flight.getTotalRisk();
        JsonNode oldWeather = captureFlightWeatherSnapshot(flight);
        recalculateRisk(flight, Instant.now());
        FlightEntity saved = flightRepository.save(flight);
        saveFlightHistoryEvent(saved, oldTotalRisk, saved.getTotalRisk(), oldWeather, saved.getDispatcherDecision(), saved.getDispatcherDecisionReason(), saved.getDispatcherDecisionDelayMinutes());
        broadcastFlightUpdate("FLIGHT_RISK_REFRESHED", saved);
        return toDto(saved);
    }

    @Transactional
    public List<FlightDto> refreshAllRisksNow() {
        List<FlightEntity> flights = flightRepository.findAllByOrderByCreatedAtDesc();
        if (flights.isEmpty()) {
            return List.of();
        }

        Instant now = Instant.now();
        List<FlightEntity> refreshed = new ArrayList<>();
        for (FlightEntity flight : flights) {
            LocalDateTime arrivalAt = flight.getArrivalAt();
            if (arrivalAt != null && !arrivalAt.isAfter(LocalDateTime.now())) {
                continue;
            }
            try {
                int oldTotalRisk = flight.getTotalRisk() == null ? 0 : flight.getTotalRisk();
                JsonNode oldWeather = captureFlightWeatherSnapshot(flight);
                recalculateRisk(flight, now);
                saveFlightHistoryEvent(
                        flight,
                        oldTotalRisk,
                        flight.getTotalRisk(),
                        oldWeather,
                        flight.getDispatcherDecision(),
                        "Массовый перерасчет риска по актуальной формуле",
                        flight.getDispatcherDecisionDelayMinutes()
                );
                refreshed.add(flight);
            } catch (Exception ignored) {
                // Keep other flights refreshable even if one route/weather point fails.
            }
        }

        if (refreshed.isEmpty()) {
            return List.of();
        }

        List<FlightEntity> saved = flightRepository.saveAll(refreshed);
        appUpdateWebSocketHandler.broadcast("FLIGHT_RISKS_REFRESHED", "all", String.valueOf(saved.size()));
        return saved.stream().map(this::toDto).toList();
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
        broadcastFlightUpdate("FLIGHT_DECISION_APPLIED", saved);
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

    public List<MeteorologistRequestDto> getMeteorologistRequests() {
        return flightRepository.findAllByMeteorologistRequestIdIsNotNullOrderByMeteorologistRequestCreatedAtDesc().stream()
                .flatMap((flight) -> {
                    List<MeteorologistRequestDto> requests = new ArrayList<>();
                    MeteorologistRequestDto current = toMeteorologistRequestDto(flight);
                    if (current.id() != null && !current.id().isBlank()) {
                        requests.add(current);
                    }
                    requests.addAll(fromMeteorologistRequestHistory(flight.getMeteorologistRequestHistory()));
                    return requests.stream();
                })
                .sorted(Comparator.comparing(
                        MeteorologistRequestDto::createdAt,
                        Comparator.nullsLast(Comparator.reverseOrder())
                ))
                .toList();
    }

    @Transactional
    public MeteorologistRequestDto createMeteorologistRequest(CreateMeteorologistRequest request) {
        FlightEntity flight = findFlightForMeteorologistRequest(request);
        Instant now = Instant.now();
        Map<String, Boolean> needs = request.needs() == null || request.needs().isEmpty()
                ? defaultMeteorologistNeeds()
                : new LinkedHashMap<>(request.needs());

        archiveCurrentMeteorologistRequest(flight);
        flight.setMeteorologistRequestId(resolveMeteorologistRequestId(flight, request));
        flight.setMeteorologistRequestStatus("new");
        flight.setMeteorologistRequestCreatedAt(now);
        flight.setMeteorologistDispatcherName(blankToDefault(request.dispatcherName(), "Диспетчер рейсов"));
        flight.setMeteorologistDispatcherComment(blankToDefault(request.dispatcherComment(), ""));
        flight.setMeteorologistRequestNeeds(toJsonMap(needs));
        flight.setMeteorologistRequestText(blankToDefault(request.requestText(), buildMeteorologistRequestText(request, needs)));
        flight.setMeteorologistResponseByNeed(toJsonMap(Map.of()));
        flight.setMeteorologistMessage("");
        flight.setMeteorologistResponseComplete(null);
        flight.setMeteorologistEmptyFieldsCount(null);
        flight.setMeteorologistAnsweredAt(null);

        FlightEntity saved = flightRepository.save(flight);
        appUpdateWebSocketHandler.broadcast(
                "METEOROLOGIST_REQUEST_CREATED",
                saved.getMeteorologistRequestId(),
                saved.getFlightNumber()
        );
        return toMeteorologistRequestDto(saved);
    }

    @Transactional
    public MeteorologistRequestDto submitMeteorologistResponse(
            String requestId,
            SubmitMeteorologistResponseRequest request
    ) {
        FlightEntity flight = flightRepository.findAllByMeteorologistRequestId(requestId).stream()
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Запрос метеорологу не найден: " + requestId));

        int oldTotalRisk = flight.getTotalRisk() == null ? 0 : flight.getTotalRisk();
        JsonNode oldWeather = captureFlightWeatherSnapshot(flight);
        Map<String, Boolean> needs = fromBooleanMapJson(flight.getMeteorologistRequestNeeds());
        Map<String, String> responseByNeed = request.responseByNeed() == null
                ? Map.of()
                : new LinkedHashMap<>(request.responseByNeed());
        validateMeteorologistResponseFormat(responseByNeed);
        long emptyFieldsCount = needs.entrySet().stream()
                .filter(Map.Entry::getValue)
                .map(Map.Entry::getKey)
                .filter((key) -> {
                    String value = responseByNeed.get(key);
                    return value == null || value.trim().isBlank();
                })
                .count();

        flight.setMeteorologistRequestStatus("answered");
        flight.setMeteorologistResponseByNeed(toJsonMap(responseByNeed));
        flight.setMeteorologistMessage(blankToDefault(request.meteorologistMessage(), ""));
        flight.setMeteorologistResponseComplete(emptyFieldsCount == 0);
        flight.setMeteorologistEmptyFieldsCount((int) emptyFieldsCount);
        Instant now = Instant.now();
        flight.setMeteorologistAnsweredAt(now);
        recalculateRiskFromMeteorologist(flight, responseByNeed, now);

        FlightEntity saved = flightRepository.save(flight);
        saveFlightHistoryEvent(
                saved,
                oldTotalRisk,
                saved.getTotalRisk(),
                oldWeather,
                saved.getDispatcherDecision(),
                "Перерасчет по данным метеоролога: " + blankToDefault(request.meteorologistMessage(), "METAR/TAF и уточняющие параметры"),
                saved.getDispatcherDecisionDelayMinutes()
        );
        appUpdateWebSocketHandler.broadcast(
                "METEOROLOGIST_RESPONSE_SUBMITTED",
                saved.getMeteorologistRequestId(),
                saved.getFlightNumber()
        );
        broadcastFlightUpdate("FLIGHT_RISK_REFRESHED", saved);
        return toMeteorologistRequestDto(saved);
    }

    @Transactional
    public void cancelFlight(String flightId) {
        if (!flightRepository.existsById(flightId)) {
            throw new IllegalArgumentException("Рейс не найден: " + flightId);
        }

        FlightEntity flight = findFlightOrThrow(flightId);
        flightRepository.deleteById(flightId);
        flightRepository.flush();
        appUpdateWebSocketHandler.broadcast("FLIGHT_DELETED", flightId, flight.getFlightNumber());
    }

    @Scheduled(fixedDelayString = "${app.risk-refresh.tick-ms:3600000}")
    public void refreshDueFlightRisksBySchedule() {
        List<FlightEntity> flights = flightRepository.findAllByOrderByCreatedAtDesc();
        refreshDueFlightRisks(flights);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void refreshExistingFlightRisksOnStartup() {
        refreshAllRisksNow();
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
            appUpdateWebSocketHandler.broadcast("FLIGHT_RISKS_REFRESHED", "scheduled", String.valueOf(changed.size()));
        }
    }

    private FlightEntity findFlightOrThrow(String flightId) {
        return flightRepository.findById(flightId)
                .orElseThrow(() -> new IllegalArgumentException("Рейс не найден: " + flightId));
    }

    private void broadcastFlightUpdate(String type, FlightEntity flight) {
        if (flight == null) return;
        appUpdateWebSocketHandler.broadcast(type, flight.getId(), flight.getFlightNumber());
    }

    private FlightEntity findFlightForMeteorologistRequest(CreateMeteorologistRequest request) {
        String normalizedFlightNumber = normalizeFlightNumber(request.flightNumber());
        if (normalizedFlightNumber.isBlank()) {
            throw new IllegalArgumentException("Укажите номер рейса для запроса метеорологу");
        }

        List<FlightEntity> candidates = flightRepository.findAllByFlightNumber(normalizedFlightNumber);
        if (candidates.isEmpty()) {
            throw new IllegalArgumentException("Сначала создайте рейс, затем отправляйте запрос метеорологу: " + normalizedFlightNumber);
        }

        String fromAirportId = normalizeAirportId(request.fromAirportId());
        String toAirportId = normalizeAirportId(request.toAirportId());
        LocalDateTime etd = request.etd();

        return candidates.stream()
                .filter((flight) -> fromAirportId.isBlank() || Objects.equals(normalizeAirportId(flight.getFromAirportId()), fromAirportId))
                .filter((flight) -> toAirportId.isBlank() || Objects.equals(normalizeAirportId(flight.getToAirportId()), toAirportId))
                .filter((flight) -> etd == null || Objects.equals(flight.getDepartureAt(), etd))
                .findFirst()
                .orElseGet(() -> candidates.get(0));
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
        cruiseRisk = withDepartureTimeFactors(cruiseRisk, flight.getDepartureAt(), LocalDateTime.now());

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

    private void recalculateRiskFromMeteorologist(
            FlightEntity flight,
            Map<String, String> responseByNeed,
            Instant now
    ) {
        AirportDto fromAirport = airportCatalogService.getById(flight.getFromAirportId())
                .orElseThrow(() -> new IllegalArgumentException("Airport is not found: " + flight.getFromAirportId()));
        AirportDto toAirport = airportCatalogService.getById(flight.getToAirportId())
                .orElseThrow(() -> new IllegalArgumentException("Airport is not found: " + flight.getToAirportId()));

        JsonNode fallbackDepartureWeather = weatherService.getWeatherByAirportId(flight.getFromAirportId());
        JsonNode fallbackArrivalWeather = weatherService.getWeatherByAirportId(flight.getToAirportId());
        JsonNode metarWeather = parseAviationWeather(responseByNeed.get("metar"), fallbackDepartureWeather, "METAR");
        JsonNode tafWeather = parseAviationWeather(responseByNeed.get("taf"), fallbackArrivalWeather, "TAF");

        JsonNode departureWeather = metarWeather == null ? fallbackDepartureWeather : metarWeather;
        JsonNode arrivalWeather = tafWeather == null
                ? (metarWeather == null ? fallbackArrivalWeather : metarWeather)
                : tafWeather;

        FlightRiskDto departureRisk = withMeteorologistSurfaceFactors(
                evaluateSurfaceRisk(departureWeather),
                responseByNeed,
                false
        );
        FlightRiskDto arrivalRisk = withMeteorologistSurfaceFactors(
                evaluateSurfaceRisk(arrivalWeather),
                responseByNeed,
                true
        );
        FlightRiskDto cruiseRisk = withMeteorologistCruiseFactors(
                evaluateCruiseRisk(fromAirport, toAirport, departureWeather, arrivalWeather),
                responseByNeed
        );
        cruiseRisk = withDepartureTimeFactors(cruiseRisk, flight.getDepartureAt(), LocalDateTime.now());

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
        flight.setRiskUpdatedAt(now);
        applyAutomaticDecision(flight, now);
    }

    private JsonNode parseAviationWeather(String rawReport, JsonNode fallbackWeather, String reportType) {
        if (rawReport == null || rawReport.isBlank()) {
            return null;
        }

        String report = rawReport.trim().toUpperCase(Locale.ROOT);
        ObjectNode weather = objectMapper.createObjectNode();
        ObjectNode windNode = weather.putObject("wind");
        ObjectNode mainNode = weather.putObject("main");
        ObjectNode cloudsNode = weather.putObject("clouds");
        ObjectNode sourceNode = weather.putObject("aviationSource");
        sourceNode.put("type", reportType);
        sourceNode.put("raw", rawReport.trim());

        double windSpeed = safeNumber(fallbackWeather.path("wind").path("speed"), 0);
        double windGust = safeNumber(fallbackWeather.path("wind").path("gust"), windSpeed);
        double visibility = safeNumber(fallbackWeather.path("visibility"), 10000);
        double pressure = safeNumber(fallbackWeather.path("main").path("pressure"), 1013);
        double temp = safeNumber(fallbackWeather.path("main").path("temp"), 15);
        double humidity = safeNumber(fallbackWeather.path("main").path("humidity"), 60);
        double cloudiness = safeNumber(fallbackWeather.path("clouds").path("all"), 0);
        int weatherCode = (int) safeNumber(fallbackWeather.path("weather").path(0).path("id"), 800);
        String description = fallbackWeather.path("weather").path(0).path("description").asText("Ясно");
        double rain = 0;
        double snow = 0;

        var windMatcher = AVIATION_WIND_PATTERN.matcher(report);
        if (windMatcher.find()) {
            double multiplier = "KT".equals(windMatcher.group("unit")) ? 0.514444 : 1.0;
            windSpeed = Integer.parseInt(windMatcher.group("speed")) * multiplier;
            String gust = windMatcher.group("gust");
            windGust = gust == null ? windSpeed : Integer.parseInt(gust) * multiplier;
            String direction = windMatcher.group("dir");
            if (!"VRB".equals(direction)) {
                windNode.put("deg", Integer.parseInt(direction));
            }
        }

        if (report.contains("CAVOK")) {
            visibility = 10000;
            cloudiness = Math.min(cloudiness, 10);
        } else {
            var visibilityMatcher = AVIATION_VISIBILITY_PATTERN.matcher(report);
            while (visibilityMatcher.find()) {
                int value = Integer.parseInt(visibilityMatcher.group("visibility"));
                if (value >= 50) {
                    visibility = Math.min(value, 10000);
                    break;
                }
            }
        }

        var pressureMatcher = AVIATION_PRESSURE_PATTERN.matcher(report);
        if (pressureMatcher.find()) {
            pressure = Integer.parseInt(pressureMatcher.group("pressure"));
        }

        var tempMatcher = AVIATION_TEMP_PATTERN.matcher(report);
        if (tempMatcher.find()) {
            temp = parseSignedAviationNumber(tempMatcher.group("temp"));
        }

        var cloudMatcher = AVIATION_CLOUD_PATTERN.matcher(report);
        while (cloudMatcher.find()) {
            cloudiness = Math.max(cloudiness, cloudinessPercent(cloudMatcher.group("cloud")));
        }

        if (containsAny(report, "TS", "VCTS", "TSRA", "CB")) {
            weatherCode = 211;
            description = "Гроза по " + reportType;
            rain = Math.max(rain, report.contains("RA") ? 1.2 : 0);
            cloudiness = Math.max(cloudiness, 90);
        } else if (containsAny(report, "SN", "SHSN")) {
            weatherCode = 601;
            description = "Снег по " + reportType;
            snow = Math.max(snow, 0.8);
        } else if (containsAny(report, "RA", "SHRA", "DZ", "FZRA")) {
            weatherCode = 501;
            description = "Осадки по " + reportType;
            rain = Math.max(rain, 0.8);
        } else if (containsAny(report, "FG", "BR", "HZ")) {
            weatherCode = 741;
            description = "Туман/дымка по " + reportType;
            visibility = Math.min(visibility, report.contains("FG") ? 1200 : 5000);
        } else if (cloudiness >= 70) {
            weatherCode = 803;
            description = "Облачность по " + reportType;
        }

        windNode.put("speed", windSpeed);
        windNode.put("gust", windGust);
        mainNode.put("temp", temp);
        mainNode.put("pressure", pressure);
        mainNode.put("humidity", humidity);
        cloudsNode.put("all", cloudiness);
        weather.put("visibility", visibility);
        if (rain > 0) {
            weather.putObject("rain").put("1h", rain);
        }
        if (snow > 0) {
            weather.putObject("snow").put("1h", snow);
        }
        weather.put("provider", "meteorologist-" + reportType.toLowerCase(Locale.ROOT));
        var weatherArray = weather.putArray("weather");
        var weatherItem = weatherArray.addObject();
        weatherItem.put("id", weatherCode);
        weatherItem.put("description", description);
        return weather;
    }

    private FlightRiskDto withMeteorologistSurfaceFactors(
            FlightRiskDto baseRisk,
            Map<String, String> responseByNeed,
            boolean landingPhase
    ) {
        double score = baseRisk.score() == null ? 0 : baseRisk.score();
        List<String> factors = new ArrayList<>(baseRisk.factors() == null ? List.of() : baseRisk.factors());

        if (landingPhase) {
            String wind = blankToDefault(responseByNeed.get("landingWind"), "");
            String gusts = blankToDefault(responseByNeed.get("landingGusts"), "");
            String visibility = blankToDefault(responseByNeed.get("landingVisibility"), "");
            Double windValue = windSpeedFromText(wind);
            Double gustValue = windSpeedFromText(gusts);
            Double visibilityValue = firstNumber(visibility);
            if (windValue != null && windValue >= 10) {
                score += windValue >= 16 ? 14 : 8;
                factors.add("Метеоролог: ветер на посадке " + formatOneDecimal(windValue) + " м/с");
            }
            if (gustValue != null && gustValue >= 14) {
                score += gustValue >= 22 ? 14 : 8;
                factors.add("Метеоролог: порывы на посадке до " + formatOneDecimal(gustValue) + " м/с");
            }
            if (visibilityValue != null && visibilityValue < 5000) {
                score += visibilityValue < 1500 ? 18 : 10;
                factors.add("Метеоролог: видимость на посадке " + Math.round(visibilityValue) + " м");
            }
        }

        String thunderstorm = blankToDefault(responseByNeed.get("thunderstorm"), "");
        if (containsRiskText(thunderstorm, "гроз", "ts", "cb", "cumulonimbus")) {
            score += 18;
            factors.add("Метеоролог: указана грозовая обстановка");
        }

        String icing = blankToDefault(responseByNeed.get("icing"), "");
        if (containsRiskText(icing, "облед", "icing", "ice", "лед")) {
            score += 10;
            factors.add("Метеоролог: указан риск обледенения");
        }

        return new FlightRiskDto(clampScore(score), factors);
    }

    private FlightRiskDto withMeteorologistCruiseFactors(
            FlightRiskDto baseRisk,
            Map<String, String> responseByNeed
    ) {
        double score = baseRisk.score() == null ? 0 : baseRisk.score();
        List<String> factors = new ArrayList<>(baseRisk.factors() == null ? List.of() : baseRisk.factors());
        String route = blankToDefault(responseByNeed.get("routeConditions"), "");
        if (containsRiskText(route, "гроз", "ts", "cb", "турбул", "icing", "облед", "сдвиг", "wind shear")) {
            score += 14;
            factors.add("Метеоролог: опасные условия на маршруте");
        }
        if (containsRiskText(route, "сильн", "опас", "ухудш", "огранич")) {
            score += 6;
            factors.add("Метеоролог: ограничения по маршруту");
        }
        return new FlightRiskDto(clampScore(score), factors);
    }

    private FlightRiskDto withDepartureTimeFactors(
            FlightRiskDto baseRisk,
            LocalDateTime departureAt,
            LocalDateTime now
    ) {
        if (departureAt == null || now == null) {
            return baseRisk;
        }

        double score = baseRisk.score() == null ? 0 : baseRisk.score();
        List<String> factors = new ArrayList<>(baseRisk.factors() == null ? List.of() : baseRisk.factors());
        long hoursUntilDeparture = Duration.between(now, departureAt).toHours();
        int hourOfDay = departureAt.getHour();

        if (hoursUntilDeparture >= 0 && hoursUntilDeparture < 3) {
            score += 10;
            factors.add("Временной фактор: до вылета менее 3 часов");
        } else if (hoursUntilDeparture >= 0 && hoursUntilDeparture < 12) {
            score += 6;
            factors.add("Временной фактор: до вылета менее 12 часов");
        } else if (hoursUntilDeparture >= 24) {
            score += 2;
            factors.add("Временной фактор: дальний прогноз");
        }

        if (hourOfDay < 6 || hourOfDay >= 22) {
            score += 3;
            factors.add("Временной фактор: ночное время вылета");
        }

        return new FlightRiskDto(clampScore(score), factors);
    }

    private void validateMeteorologistResponseFormat(Map<String, String> responseByNeed) {
        List<String> errors = new ArrayList<>();

        String metar = normalizeAviationReport(responseByNeed.get("metar"));
        if (!metar.isBlank()
                && (!AVIATION_ICAO_PATTERN.matcher(metar).find()
                || !AVIATION_TIME_PATTERN.matcher(metar).find()
                || !AVIATION_WIND_PATTERN.matcher(metar).find()
                || !(metar.contains("CAVOK") || AVIATION_VISIBILITY_PATTERN.matcher(metar).find())
                || !AVIATION_CLOUD_PATTERN.matcher(metar).find()
                || !AVIATION_TEMP_PATTERN.matcher(metar).find()
                || !AVIATION_PRESSURE_PATTERN.matcher(metar).find())) {
            errors.add("METAR должен быть в формате: UUEE 251200Z 22008MPS 9999 SCT020 06/M01 Q1018");
        }

        String taf = normalizeAviationReport(responseByNeed.get("taf"));
        if (!taf.isBlank()
                && (!AVIATION_ICAO_PATTERN.matcher(taf).find()
                || !AVIATION_TIME_PATTERN.matcher(taf).find()
                || !TAF_PERIOD_PATTERN.matcher(taf).find()
                || !AVIATION_WIND_PATTERN.matcher(taf).find()
                || !(taf.contains("CAVOK") || AVIATION_VISIBILITY_PATTERN.matcher(taf).find())
                || !AVIATION_CLOUD_PATTERN.matcher(taf).find())) {
            errors.add("TAF должен быть в формате: TAF UUEE 251100Z 2512/2612 21007MPS 9999 BKN020");
        }

        validateTextField(responseByNeed, "thunderstorm", "(?iu).*(нет|отсутств|гроза|грозов|tsra|vcts|\\bts\\b|\\bcb\\b|cumulonimbus|ливн|молни).*", "Грозовая обстановка должна содержать авиационное описание или 'нет гроз'", errors);
        validateTextField(responseByNeed, "icing", "(?iu).*(нет|отсутств|облед|icing|ice|измороз|слаб|умерен|сильн|эшелон|fl\\d{2,3}).*", "Обледенение должно содержать авиационное описание или 'нет обледенения'", errors);
        validateNoFullReportField(responseByNeed, "landingWind", "В поле ветра на посадке нужен только ветер, например 220 8 м/с, а не полный METAR", errors);
        validatePatternField(responseByNeed, "landingWind", LANDING_WIND_TEXT_PATTERN, "Ветер на посадке укажите как 240 10 м/с, 240 градусов 10 м/с или 24010MPS", errors);
        validatePatternField(responseByNeed, "landingGusts", LANDING_GUST_TEXT_PATTERN, "Порывы укажите как '16 м/с', 'порывы до 16 м/с' или G22KT", errors);
        validateNoFullReportField(responseByNeed, "landingVisibility", "В поле видимости нужна только видимость, например 9999 м или 3200-5000 м, а не полный METAR", errors);
        validateLandingVisibility(responseByNeed.get("landingVisibility"), errors);
        validateTextField(responseByNeed, "routeConditions", "(?iu).*(нет|спокойн|без\\s+опас|гроза|турбулентн|turbulence|turb|облед|icing|сдвиг|wind shear|осад|туман|видим|ветер|фронт|cb|ts).*", "Условия на маршруте должны содержать авиационное описание, например 'риск турбулентности', или 'без опасных явлений'", errors);

        if (!errors.isEmpty()) {
            throw new IllegalArgumentException(String.join("; ", errors));
        }
    }

    private void validateTextField(Map<String, String> responseByNeed, String key, String regex, String error, List<String> errors) {
        String value = blankToDefault(responseByNeed.get(key), "");
        if (!value.isBlank() && !Pattern.compile(regex).matcher(value).matches()) {
            errors.add(error);
        }
    }

    private void validatePatternField(Map<String, String> responseByNeed, String key, Pattern pattern, String error, List<String> errors) {
        String value = blankToDefault(responseByNeed.get(key), "");
        if (!value.isBlank() && !pattern.matcher(value).find()) {
            errors.add(error);
        }
    }

    private void validateNoFullReportField(Map<String, String> responseByNeed, String key, String error, List<String> errors) {
        String value = normalizeAviationReport(responseByNeed.get(key));
        if (!value.isBlank()
                && AVIATION_ICAO_PATTERN.matcher(value).find()
                && AVIATION_TIME_PATTERN.matcher(value).find()) {
            errors.add(error);
        }
    }

    private void validateLandingVisibility(String rawVisibility, List<String> errors) {
        String value = blankToDefault(rawVisibility, "");
        if (value.isBlank()) {
            return;
        }
        var matcher = LANDING_VISIBILITY_TEXT_PATTERN.matcher(value);
        while (matcher.find()) {
            int visibility = Integer.parseInt(matcher.group());
            if (visibility >= 100 && visibility <= 10000) {
                return;
            }
        }
        errors.add("Видимость на посадке укажите в метрах от 100 до 10000");
    }

    private String normalizeAviationReport(String value) {
        return blankToDefault(value, "").toUpperCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
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

    private int calculateTotalRisk(FlightRiskDto departureRisk, FlightRiskDto arrivalRisk, FlightRiskDto cruiseRisk) {
        return clampScore(
                departureRisk.score() * 0.4
                        + arrivalRisk.score() * 0.4
                        + cruiseRisk.score() * 0.2
        );
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

    private int parseSignedAviationNumber(String value) {
        if (value == null || value.isBlank()) {
            return 0;
        }
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        if (normalized.startsWith("M")) {
            return -Integer.parseInt(normalized.substring(1));
        }
        return Integer.parseInt(normalized);
    }

    private int cloudinessPercent(String cloudCode) {
        if (cloudCode == null) {
            return 0;
        }
        return switch (cloudCode) {
            case "FEW" -> 20;
            case "SCT" -> 45;
            case "BKN" -> 75;
            case "OVC", "VV" -> 95;
            default -> 0;
        };
    }

    private boolean containsAny(String source, String... needles) {
        if (source == null || source.isBlank()) {
            return false;
        }
        String normalized = source.toUpperCase(Locale.ROOT);
        for (String needle : needles) {
            if (normalized.contains(needle.toUpperCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }

    private boolean containsRiskText(String source, String... needles) {
        if (source == null || source.isBlank()) {
            return false;
        }
        String normalized = source.toLowerCase(Locale.ROOT);
        for (String needle : needles) {
            if (normalized.contains(needle.toLowerCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }

    private Double firstNumber(String source) {
        if (source == null || source.isBlank()) {
            return null;
        }
        var matcher = Pattern.compile("[-+]?\\d+(?:[.,]\\d+)?").matcher(source);
        if (!matcher.find()) {
            return null;
        }
        return Double.parseDouble(matcher.group().replace(',', '.'));
    }

    private Double windSpeedFromText(String source) {
        if (source == null || source.isBlank()) {
            return null;
        }
        var matcher = WIND_SPEED_TEXT_PATTERN.matcher(source);
        Double value = null;
        String unit = "";
        while (matcher.find()) {
            value = Double.parseDouble(matcher.group("speed").replace(',', '.'));
            unit = matcher.group("unit").toLowerCase(Locale.ROOT);
        }
        if (value == null) {
            return firstNumber(source);
        }
        if (unit.startsWith("kt") || unit.startsWith("уз")) {
            return value * 0.514444;
        }
        return value;
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

    private MeteorologistRequestDto toMeteorologistRequestDto(FlightEntity entity) {
        LocalDateTime arrivalAt = entity.getArrivalAt() != null
                ? entity.getArrivalAt()
                : estimateArrivalAt(
                entity.getDepartureAt(),
                entity.getFromAirportId(),
                entity.getToAirportId(),
                resolveAircraftType(entity.getAircraftType())
        );

        return new MeteorologistRequestDto(
                entity.getMeteorologistRequestId(),
                entity.getMeteorologistRequestCreatedAt(),
                blankToDefault(entity.getMeteorologistRequestStatus(), "new"),
                blankToDefault(entity.getMeteorologistDispatcherName(), "Диспетчер рейсов"),
                new MeteorologistRequestFormDto(
                        entity.getFlightNumber(),
                        entity.getFromAirportId(),
                        entity.getToAirportId(),
                        entity.getDepartureAt(),
                        arrivalAt,
                        blankToDefault(entity.getMeteorologistDispatcherComment(), "")
                ),
                fromBooleanMapJson(entity.getMeteorologistRequestNeeds()),
                blankToDefault(entity.getMeteorologistRequestText(), ""),
                true,
                fromStringMapJson(entity.getMeteorologistResponseByNeed()),
                blankToDefault(entity.getMeteorologistMessage(), ""),
                entity.getMeteorologistResponseComplete(),
                entity.getMeteorologistEmptyFieldsCount(),
                entity.getMeteorologistAnsweredAt()
        );
    }

    private void archiveCurrentMeteorologistRequest(FlightEntity flight) {
        if (flight.getMeteorologistRequestId() == null || flight.getMeteorologistRequestId().isBlank()) {
            return;
        }

        MeteorologistRequestDto snapshot = toMeteorologistRequestDto(flight);
        List<MeteorologistRequestDto> history = new ArrayList<>(fromMeteorologistRequestHistory(flight.getMeteorologistRequestHistory()));
        history.removeIf((item) -> Objects.equals(item.id(), snapshot.id()));
        history.add(0, snapshot);
        if (history.size() > 30) {
            history = history.subList(0, 30);
        }
        flight.setMeteorologistRequestHistory(toJsonValue(history));
    }

    private List<MeteorologistRequestDto> fromMeteorologistRequestHistory(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            List<MeteorologistRequestDto> parsed = objectMapper.readValue(json, METEOROLOGIST_REQUEST_LIST);
            return parsed == null ? List.of() : parsed.stream()
                    .filter(Objects::nonNull)
                    .toList();
        } catch (Exception exception) {
            return List.of();
        }
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

    private String toJsonValue(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot serialize value", exception);
        }
    }

    private String toJsonMap(Map<?, ?> value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot serialize meteorologist data", exception);
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

    private Map<String, Boolean> fromBooleanMapJson(String value) {
        try {
            if (value == null || value.isBlank()) {
                return Map.of();
            }
            return objectMapper.readValue(value, BOOLEAN_MAP);
        } catch (Exception exception) {
            return Map.of();
        }
    }

    private Map<String, String> fromStringMapJson(String value) {
        try {
            if (value == null || value.isBlank()) {
                return Map.of();
            }
            return objectMapper.readValue(value, STRING_MAP);
        } catch (Exception exception) {
            return Map.of();
        }
    }

    private Map<String, Boolean> defaultMeteorologistNeeds() {
        Map<String, Boolean> needs = new LinkedHashMap<>();
        needs.put("departureWeather", true);
        needs.put("arrivalWeather", true);
        needs.put("routeWeather", true);
        needs.put("visibility", true);
        needs.put("wind", true);
        needs.put("recommendation", true);
        return needs;
    }

    private String resolveMeteorologistRequestId(FlightEntity flight, CreateMeteorologistRequest request) {
        if (request.id() != null && !request.id().isBlank()) {
            return request.id().trim();
        }
        return "req-" + Instant.now().toEpochMilli() + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private String buildMeteorologistRequestText(CreateMeteorologistRequest request, Map<String, Boolean> needs) {
        return String.join("\n",
                "Номер рейса: " + blankToDefault(request.flightNumber(), "не указан"),
                "Аэропорт вылета: " + blankToDefault(request.fromAirportId(), "не указан"),
                "Аэропорт назначения: " + blankToDefault(request.toAirportId(), "не указан"),
                "Плановое время вылета (ETD): " + (request.etd() == null ? "не указано" : request.etd()),
                "Плановое время прилета (ETA): " + (request.eta() == null ? "не указано" : request.eta()),
                "Требуются метеоданные: " + String.join(", ", needs.entrySet().stream()
                        .filter(Map.Entry::getValue)
                        .map(Map.Entry::getKey)
                        .toList()),
                "Комментарий диспетчера: " + blankToDefault(request.dispatcherComment(), "")
        );
    }

    private String blankToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private String normalizeAirportId(String airportId) {
        return airportId == null ? "" : airportId.trim().toUpperCase(Locale.ROOT);
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
