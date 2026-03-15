package com.diplom.dispatcher.flight;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

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
}
