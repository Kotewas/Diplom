package com.diplom.dispatcher.airport;

public record AirportDto(
        String id,
        String name,
        String city,
        double lat,
        double lon,
        String region
) {
}
