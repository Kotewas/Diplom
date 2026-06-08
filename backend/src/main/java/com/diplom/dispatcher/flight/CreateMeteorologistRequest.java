package com.diplom.dispatcher.flight;

import java.time.LocalDateTime;
import java.util.Map;

public record CreateMeteorologistRequest(
        String id,
        String dispatcherName,
        String flightNumber,
        String fromAirportId,
        String toAirportId,
        LocalDateTime etd,
        LocalDateTime eta,
        String dispatcherComment,
        Map<String, Boolean> needs,
        String requestText,
        Boolean dataComplete
) {
}
