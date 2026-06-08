package com.diplom.dispatcher.flight;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/meteorologist/requests")
public class MeteorologistController {

    private final FlightService flightService;

    public MeteorologistController(FlightService flightService) {
        this.flightService = flightService;
    }

    @GetMapping
    public List<MeteorologistRequestDto> getRequests() {
        return flightService.getMeteorologistRequests();
    }

    @PostMapping
    public MeteorologistRequestDto createRequest(@RequestBody CreateMeteorologistRequest request) {
        return flightService.createMeteorologistRequest(request);
    }

    @PostMapping("/{requestId}/response")
    public MeteorologistRequestDto submitResponse(
            @PathVariable String requestId,
            @RequestBody SubmitMeteorologistResponseRequest request
    ) {
        return flightService.submitMeteorologistResponse(requestId, request);
    }
}
