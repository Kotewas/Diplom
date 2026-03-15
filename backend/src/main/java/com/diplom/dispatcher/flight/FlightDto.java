package com.diplom.dispatcher.flight;

import java.time.Instant;
import java.time.LocalDateTime;

public record FlightDto(
        String id,
        Instant createdAt,
        String flightNumber,
        LocalDateTime departureAt,
        LocalDateTime arrivalAt,
        String fromAirportId,
        String toAirportId,
        FlightRiskDto departureRisk,
        FlightRiskDto arrivalRisk,
        FlightRiskDto cruiseRisk,
        Integer totalRisk,
        FeasibilityDto feasibility
) {
}
