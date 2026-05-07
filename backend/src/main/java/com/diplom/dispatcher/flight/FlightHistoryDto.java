package com.diplom.dispatcher.flight;

import java.time.Instant;

public record FlightHistoryDto(
        String id,
        String flightId,
        Instant changedAt,
        Integer oldTotalRisk,
        Integer newTotalRisk,
        String oldWeather,
        String dispatcherDecision,
        String dispatcherDecisionReason,
        Integer dispatcherDecisionDelayMinutes
) {
}
