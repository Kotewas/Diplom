package com.diplom.dispatcher.airport;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/airports")
public class AirportController {

    private final AirportCatalogService airportCatalogService;

    public AirportController(AirportCatalogService airportCatalogService) {
        this.airportCatalogService = airportCatalogService;
    }

    @GetMapping
    public List<AirportDto> getAirports() {
        return airportCatalogService.getAll();
    }
}
