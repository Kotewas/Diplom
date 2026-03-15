package com.diplom.dispatcher.flight;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FlightRepository extends JpaRepository<FlightEntity, String> {

    List<FlightEntity> findAllByOrderByCreatedAtDesc();
}
