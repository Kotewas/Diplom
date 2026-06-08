package com.diplom.dispatcher.flight;

import java.time.Instant;
import java.util.Map;

public record MeteorologistRequestDto(
        String id,
        Instant createdAt,
        String status,
        String dispatcherName,
        MeteorologistRequestFormDto form,
        Map<String, Boolean> needs,
        String requestText,
        Boolean dataComplete,
        Map<String, String> responseByNeed,
        String meteorologistMessage,
        Boolean responseComplete,
        Integer emptyFieldsCount,
        Instant answeredAt
) {
}
