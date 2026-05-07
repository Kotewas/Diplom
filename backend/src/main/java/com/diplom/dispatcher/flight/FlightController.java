package com.diplom.dispatcher.flight;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.util.List;

@RestController
@RequestMapping("/api/flights")
public class FlightController {

    private final FlightService flightService;

    public FlightController(FlightService flightService) {
        this.flightService = flightService;
    }

    @GetMapping
    public List<FlightDto> getFlights() {
        return flightService.getAllFlights();
    }

    @PostMapping
    public FlightDto createFlight(@Valid @RequestBody CreateFlightRequest request) {
        return flightService.createFlight(request);
    }

    @PostMapping("/{flightId}/refresh-risk")
    public FlightDto refreshRisk(@PathVariable String flightId) {
        return flightService.refreshRiskNow(flightId);
    }

    @PostMapping("/{flightId}/decision")
    public FlightDto applyDecision(@PathVariable String flightId, @Valid @RequestBody ApplyDecisionRequest request) {
        return flightService.applyDispatcherDecision(flightId, request);
    }

    @GetMapping("/{flightId}/history")
    public List<FlightHistoryDto> getHistory(@PathVariable String flightId) {
        return flightService.getFlightHistory(flightId);
    }

    @GetMapping("/{flightId}/what-if-delay")
    public WhatIfDelayResponse simulateDelay(
            @PathVariable String flightId,
            @RequestParam("minutes") int delayMinutes
    ) {
        return flightService.simulateDelay(flightId, delayMinutes);
    }

    @DeleteMapping("/{flightId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancelFlight(@PathVariable String flightId) {
        flightService.cancelFlight(flightId);
    }
}
