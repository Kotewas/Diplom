package com.diplom.dispatcher.flight;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

public record CreateFlightRequest(
        @NotBlank String flightNumber,
        @NotNull LocalDateTime departureAt,
        LocalDateTime arrivalAt,
        @NotBlank String fromAirportId,
        @NotBlank String toAirportId,
        @NotNull FlightRiskDto departureRisk,
        @NotNull FlightRiskDto arrivalRisk,
        @NotNull FlightRiskDto cruiseRisk,
        @NotNull Integer totalRisk,
        @NotNull FeasibilityDto feasibility
) {
}
