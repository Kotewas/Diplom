package com.diplom.dispatcher.flight;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FlightHistoryRepository extends JpaRepository<FlightHistoryEntity, String> {

    List<FlightHistoryEntity> findAllByFlightIdOrderByChangedAtDesc(String flightId);
}
