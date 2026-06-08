package com.diplom.dispatcher.flight;

import java.time.LocalDateTime;

public record MeteorologistRequestFormDto(
        String flightNumber,
        String fromAirportId,
        String toAirportId,
        LocalDateTime etd,
        LocalDateTime eta,
        String dispatcherComment
) {
}
