package com.diplom.dispatcher.flight;

import java.time.Instant;
import java.time.LocalDateTime;

public record FlightDto(
        String id,
        Instant createdAt,
        String flightNumber,
        String aircraftType,
        LocalDateTime departureAt,
        LocalDateTime arrivalAt,
        String fromAirportId,
        String toAirportId,
        FlightRiskDto departureRisk,
        FlightRiskDto arrivalRisk,
        FlightRiskDto cruiseRisk,
        Integer totalRisk,
        FeasibilityDto feasibility,
        Instant riskUpdatedAt,
        String dispatcherDecision,
        String dispatcherDecisionReason,
        Instant dispatcherDecisionAt,
        Integer dispatcherDecisionDelayMinutes
) {
}
