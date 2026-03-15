package com.diplom.dispatcher.flight;

import com.diplom.dispatcher.airport.AirportCatalogService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class FlightService {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };
    private static final double EARTH_RADIUS_KM = 6371.0;
    private static final double AVERAGE_CRUISE_SPEED_KMH = 820.0;
    private static final long AIRPORT_OPERATIONS_MINUTES = 25;
    private static final long MIN_TOTAL_FLIGHT_MINUTES = 35;

    private final FlightRepository flightRepository;
    private final AirportCatalogService airportCatalogService;
    private final ObjectMapper objectMapper;

    public FlightService(
            FlightRepository flightRepository,
            AirportCatalogService airportCatalogService,
            ObjectMapper objectMapper
    ) {
        this.flightRepository = flightRepository;
        this.airportCatalogService = airportCatalogService;
        this.objectMapper = objectMapper;
    }

    public List<FlightDto> getAllFlights() {
        return flightRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(this::toDto)
                .toList();
    }

    public FlightDto createFlight(CreateFlightRequest request) {
        validateRequest(request);

        FlightEntity entity = new FlightEntity();
        entity.setId(generateFlightId());
        entity.setCreatedAt(Instant.now());
        entity.setFlightNumber(request.flightNumber().trim().toUpperCase());
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

        FlightEntity saved = flightRepository.save(entity);
        return toDto(saved);
    }

    private void validateRequest(CreateFlightRequest request) {
        if (request.fromAirportId().equals(request.toAirportId())) {
            throw new IllegalArgumentException("From and to airports cannot be the same");
        }

        boolean hasFromAirport = airportCatalogService.getById(request.fromAirportId()).isPresent();
        boolean hasToAirport = airportCatalogService.getById(request.toAirportId()).isPresent();

        if (!hasFromAirport || !hasToAirport) {
            throw new IllegalArgumentException("One or both airports are unknown");
        }
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

        var fromAirport = airportCatalogService.getById(fromAirportId).orElse(null);
        var toAirport = airportCatalogService.getById(toAirportId).orElse(null);
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
