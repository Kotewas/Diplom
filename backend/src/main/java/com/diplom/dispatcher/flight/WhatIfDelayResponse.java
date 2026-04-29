package com.diplom.dispatcher.flight;

import java.time.LocalDateTime;

public record WhatIfDelayResponse(
        int currentTotalRisk,
        int simulatedTotalRisk,
        int riskDelta,
        LocalDateTime currentDepartureAt,
        LocalDateTime simulatedDepartureAt,
        LocalDateTime currentArrivalAt,
        LocalDateTime simulatedArrivalAt,
        FeasibilityDto currentFeasibility,
        FeasibilityDto simulatedFeasibility,
        String recommendation
) {
}
