package com.diplom.dispatcher.flight;

import java.util.List;

public record FlightRiskDto(
        Integer score,
        List<String> factors
) {
}
